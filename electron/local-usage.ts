import { createHash } from 'node:crypto'
import { constants as fsConstants, type Dirent } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { safeModelId, type HistoryStore } from './history.ts'
import { MAX_TOKEN_COUNT } from './event-normalizer.ts'
import { asRecord } from './value-guards.ts'
import type { HistoryTokenUsageRecord } from '../src/types/history.ts'

export type UsageProvider = 'codex' | 'claude-code'

interface UsageRoot {
  provider: UsageProvider
  adapterId: 'codex' | 'claude-code'
  agentId: 'codex' | 'claude'
  directory: string
}

export interface ParsedUsage extends HistoryTokenUsageRecord {
  dedupeKey: string
  cwd?: string
}

interface TokenCounters {
  /** Provider-reported input including any cached portion (Codex semantics). */
  input: number
  cached: number
  output: number
}

export interface IncrementalLocalUsageParserState {
  readOffset: number
  nextLineNumber: number
  previousCodexTotal: TokenCounters | null
  codexCwd: string | undefined
  /** token_count events carry no session id; the hook reports this same id, so it is the join key. */
  codexSessionId?: string
  codexModel?: string
  lastTimestamp: number | undefined
  discardingLongLine: boolean
}

interface LocalUsageFileCacheEntry extends IncrementalLocalUsageParserState {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  readEnd: number
}

export interface ProjectPathResolver {
  // Must register the project (not a read-only lookup): a project known only from historical logs still needs a row so its token totals are reachable from the History filter.
  trackSeen(value: unknown, seenAt?: number): { projectId: string } | null
}

export interface LocalUsageConfigDirs {
  claude: string
  codex: string
}

export interface LocalUsageReaderOptions {
  homeDir: string
  /** Read at the start of every scan: CLAUDE_CONFIG_DIR／CODEX_HOME may only be known after the login-shell lookup. */
  configDirs?: () => LocalUsageConfigDirs
  history: HistoryStore
  now?: () => number
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  maxLineBytes?: number
  maxScanMs?: number
  importBatchRecords?: number
  clock?: () => number
  projectRouting?: ProjectPathResolver | null
  /** Called with every fresh record, already imported or not, so a downstream ledger can upsert idempotently. */
  onRecordsImported?: (records: readonly HistoryTokenUsageRecord[]) => void
}

export interface LocalUsageScanResult {
  filesScanned: number
  filesSkipped: number
  recordsParsed: number
  recordsImported: number
  filesDeferred: number
  pending: boolean
  /** 0 means the scan made no progress. */
  bytesRead: number
}

export interface LocalUsageScanDiagnostics extends LocalUsageScanResult {
  finishedAt: number
  durationMs: number
}

const YIELD_EVERY = 25
const PARSE_SLICE_BYTES = 1024 * 1024
// node:sqlite 寫入是同步的（單批 500 筆約佔住主執行緒 31ms、100 筆約 7ms），所以用小批次並在批次間讓出事件迴圈。
const DEFAULT_IMPORT_BATCH_RECORDS = 100
const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_FILES = 2_000
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_LINE_BYTES = 256 * 1024
const DEFAULT_MAX_SCAN_MS = 4_000
const MAX_WALK_DEPTH = 8

function digest(value: string, length = 48): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined
}

function token(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TOKEN_COUNT
    ? value
    : 0
}

function tokenSum(value: Record<string, unknown>, fields: string[]): number {
  return Math.min(MAX_TOKEN_COUNT, fields.reduce((sum, field) => sum + token(value[field]), 0))
}

function outputCount(value: Record<string, unknown>): number {
  const output = token(value.output_tokens)
  return output > 0 ? output : token(value.reasoning_output_tokens)
}

// No file-mtime fallback: it moves on every append, so a record dated by it would slip past the History cutoff and be re-counted.
// Undated lines inherit the latest real timestamp earlier in the same file (JSONL is append-only); with none, the record is dropped.
function timestamp(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Some JSONL producers use Unix seconds while others use milliseconds.
    return value < 100_000_000_000 ? value * 1_000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

// UTF-8 位元組數介於 UTF-16 長度的 1～3 倍之間，只有落在灰色地帶才需要 Buffer.byteLength。
function lineTooLong(line: string, maxLineBytes: number): boolean {
  if (line.length > maxLineBytes) return true
  if (line.length * 3 <= maxLineBytes) return false
  return Buffer.byteLength(line, 'utf8') > maxLineBytes
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line))
  } catch {
    return null
  }
}

function usageId(provider: UsageProvider, stableKey: string): string {
  return digest(`agent-pets:${provider}:${stableKey}`)
}

function claudeUsage(
  record: Record<string, unknown>,
  message: Record<string, unknown>,
  usage: Record<string, unknown>,
  fileKey: string,
  lineNumber: number,
  inheritedAt: number | undefined,
): ParsedUsage | null {
  // Fresh input only: cache reads are re-sent context (often >90% of a long session) and cache writes are reported separately; folding them in would inflate the total.
  const input = token(usage.input_tokens)
  const cacheRead = token(usage.cache_read_input_tokens)
  const topLevelCacheCreation = token(usage.cache_creation_input_tokens)
  const cacheCreation = asRecord(usage.cache_creation)
  const cacheCreationNested = cacheCreation
    ? tokenSum(cacheCreation, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'])
    : 0
  const output = outputCount(usage)
  const cacheWrite = Math.min(MAX_TOKEN_COUNT, cacheCreationNested || topLevelCacheCreation)
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null

  const sessionId = text(record.session_id) ?? text(record.sessionId) ?? fileKey
  const messageId = text(message.id)
  const requestId = text(record.request_id) ?? text(record.requestId) ?? text(message.request_id)
  const stableKey = messageId
    ? `message:${messageId}:${requestId ?? ''}`
    : `line:${fileKey}:${lineNumber}`
  const occurredAt = timestamp(record.timestamp ?? message.timestamp, inheritedAt)
  if (occurredAt === undefined) return null
  const model = safeModelId(message.model)
  return {
    ...(model ? { model } : {}),
    adapterId: 'claude-code',
    agentId: 'claude',
    sessionId,
    sourceEventId: usageId('claude-code', stableKey),
    occurredAt,
    input,
    output,
    cacheRead,
    cacheWrite,
    quality: 'exact',
    dedupeKey: stableKey,
    cwd: text(record.cwd),
  }
}

interface CodexUsageResult {
  // Null for a first sighting, a repeated snapshot, or a post-reset event.
  record: ParsedUsage | null
  // Always populated so the caller can rebase its baseline even when `record` is null.
  cumulative: TokenCounters
}

function codexUsage(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  info: Record<string, unknown>,
  usage: Record<string, unknown>,
  fileKey: string,
  lineNumber: number,
  inheritedAt: number | undefined,
  previousTotal: TokenCounters | null,
  fileCwd: string | undefined,
  fileModel: string | undefined,
  fileSessionId: string | undefined,
): CodexUsageResult | null {
  const totalUsage = asRecord(info.total_token_usage)
  // last_token_usage is a context snapshot that may repeat on rate-limit-only events, so never treat it as fresh spend when the cumulative counter is present.
  if (!totalUsage) return null
  const currentTotal: TokenCounters = {
    input: token(totalUsage.input_tokens),
    cached: token(totalUsage.cached_input_tokens),
    output: outputCount(totalUsage),
  }
  // A drop below the previous cumulative total means compaction or a resumed/forked thread rebased the counter, not a refund:
  // count zero new tokens and rebase, since the post-reset value as fresh spend could spike the total.
  const rawInput = previousTotal ? Math.max(0, currentTotal.input - previousTotal.input) : currentTotal.input
  // Codex reports cached_input_tokens as a subset of input_tokens (and exposes no cache writes).
  const cacheRead = Math.min(
    rawInput,
    previousTotal ? Math.max(0, currentTotal.cached - previousTotal.cached) : currentTotal.cached,
  )
  const input = rawInput - cacheRead
  const output = previousTotal ? Math.max(0, currentTotal.output - previousTotal.output) : currentTotal.output
  if (input === 0 && output === 0 && cacheRead === 0) return { record: null, cumulative: currentTotal }

  const sessionId = text(record.session_id)
    ?? text(record.sessionId)
    ?? text(payload.session_id)
    ?? text(payload.sessionId)
    ?? fileSessionId
    ?? fileKey
  const stableKey = `line:${fileKey}:${lineNumber}`
  const occurredAt = timestamp(record.timestamp ?? payload.timestamp, inheritedAt)
  if (occurredAt === undefined) return { record: null, cumulative: currentTotal }
  return {
    record: {
      ...(fileModel ? { model: fileModel } : {}),
      adapterId: 'codex',
      agentId: 'codex',
      sessionId,
      sourceEventId: usageId('codex', stableKey),
      occurredAt,
      input,
      output,
      cacheRead,
      cacheWrite: 0,
      quality: 'exact',
      dedupeKey: stableKey,
      cwd: fileCwd,
    },
    cumulative: currentTotal,
  }
}

export function parseLocalUsageLine(
  provider: UsageProvider,
  line: string,
  fileKey: string,
  lineNumber: number,
  inheritedAt?: number,
): ParsedUsage | null {
  if (provider !== 'claude-code') return null
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null
  const record = parseObject(line)
  if (!record) return null

  if (record.type === 'assistant') {
    const message = asRecord(record.message)
    const usage = asRecord(message?.usage)
    if (!message || !usage) return null
    return claudeUsage(record, message, usage, fileKey, lineNumber, inheritedAt)
  }

  return null
}

interface UsageFile {
  path: string
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

interface DirectoryListing {
  mtimeMs: number
  ino: number
  cachedAt: number
  entries: Array<{ name: string, kind: 'file' | 'directory' | 'other' }>
}

export interface UsageScanCache {
  directories: Map<string, DirectoryListing>
  verifiedFiles: Map<string, { dev: number, ino: number, realPath: string }>
}

export function createUsageScanCache(): UsageScanCache {
  return { directories: new Map(), verifiedFiles: new Map() }
}

const LISTING_MAX_AGE_MS = 10 * 60_000
// A directory modified this recently might still gain entries within the same timestamp tick, so it is re-read instead of cached.
const LISTING_SETTLE_MS = 2_000
const MAX_CACHED_DIRECTORIES = 4096
const MAX_VERIFIED_FILES = 8192

// Codex stores sessions as YYYY/MM/DD; a date directory ending before the cutoff cannot hold importable records.
export function isExpiredDateDirectory(parts: readonly string[], cutoffMs: number): boolean {
  const [year, month, day] = parts
  if (year === undefined || !/^\d{4}$/.test(year)) return false
  const y = Number(year)
  if (month === undefined) return Date.UTC(y + 1, 0, 1) <= cutoffMs - DAY_MS
  if (!/^\d{2}$/.test(month)) return false
  const m = Number(month) - 1
  if (day === undefined) return Date.UTC(y, m + 1, 1) <= cutoffMs - DAY_MS
  if (!/^\d{2}$/.test(day)) return false
  // One day of slack for local-time vs UTC directory naming.
  return Date.UTC(y, m, Number(day) + 1) <= cutoffMs - DAY_MS
}

async function filesUnder(
  root: string,
  maxFiles: number,
  minMtimeMs: number,
  cache: UsageScanCache = createUsageScanCache(),
  pruneDates = false,
  nowMs = Date.now(),
): Promise<UsageFile[]> {
  const files: UsageFile[] = []
  let realRoot: string
  let rootStat
  try {
    rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return files
    realRoot = await realpath(root)
  } catch {
    return files
  }

  const isWithinRoot = (candidate: string): boolean => {
    const relativePath = relative(realRoot, candidate)
    return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
  }

  let visited = 0
  const visit = async (directory: string, directoryStat: { mtimeMs: number, ino: number }, depth: number, parts: string[]): Promise<void> => {
    if (files.length >= maxFiles || depth > MAX_WALK_DEPTH) return
    let listing = cache.directories.get(directory)
    if (
      !listing || listing.mtimeMs !== directoryStat.mtimeMs || listing.ino !== directoryStat.ino
      || nowMs - listing.cachedAt > LISTING_MAX_AGE_MS
    ) {
      let dirents: Dirent[]
      try {
        dirents = await readdir(directory, { withFileTypes: true })
      } catch {
        cache.directories.delete(directory)
        return
      }
      listing = {
        mtimeMs: directoryStat.mtimeMs,
        ino: directoryStat.ino,
        cachedAt: nowMs,
        entries: dirents.map(entry => ({
          name: entry.name,
          kind: entry.isSymbolicLink() ? 'other' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        })),
      }
      if (nowMs - directoryStat.mtimeMs > LISTING_SETTLE_MS) {
        cache.directories.delete(directory)
        cache.directories.set(directory, listing)
        while (cache.directories.size > MAX_CACHED_DIRECTORIES) {
          const oldest = cache.directories.keys().next().value
          if (oldest === undefined) break
          cache.directories.delete(oldest)
        }
      } else {
        cache.directories.delete(directory)
      }
    }
    for (const entry of listing.entries) {
      if (files.length >= maxFiles) return
      if (entry.kind === 'other') continue
      if (entry.kind === 'directory' && pruneDates && isExpiredDateDirectory([...parts, entry.name], minMtimeMs)) continue
      visited += 1
      if (visited % YIELD_EVERY === 0) await yieldToEventLoop()
      const candidate = join(directory, entry.name)
      let stat
      try { stat = await lstat(candidate) } catch { continue }
      if (stat.isSymbolicLink()) continue
      if (stat.isFile() && stat.mtimeMs < minMtimeMs) continue
      if (stat.isDirectory()) {
        let realCandidate: string
        try { realCandidate = await realpath(candidate) } catch { continue }
        if (!isWithinRoot(realCandidate)) continue
        await visit(candidate, stat, depth + 1, [...parts, entry.name])
      } else if (stat.isFile() && extname(entry.name).toLowerCase() === '.jsonl') {
        // Containment is verified once per (path, dev, ino); an unchanged identity is trusted afterwards.
        const known = cache.verifiedFiles.get(candidate)
        let realCandidate: string
        if (known && known.dev === stat.dev && known.ino === stat.ino) {
          realCandidate = known.realPath
        } else {
          try { realCandidate = await realpath(candidate) } catch { continue }
          if (!isWithinRoot(realCandidate)) continue
          cache.verifiedFiles.delete(candidate)
          cache.verifiedFiles.set(candidate, { dev: stat.dev, ino: stat.ino, realPath: realCandidate })
          while (cache.verifiedFiles.size > MAX_VERIFIED_FILES) {
            const oldest = cache.verifiedFiles.keys().next().value
            if (oldest === undefined) break
            cache.verifiedFiles.delete(oldest)
          }
        }
        files.push({ path: realCandidate, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs })
      }
    }
  }

  await visit(realRoot, rootStat, 0, [])
  return files
}

export function parseUsageFile(
  provider: UsageProvider,
  fileKey: string,
  content: string,
  maxLineBytes: number,
): ParsedUsage[] {
  const records = new Map<string, ParsedUsage>()
  const lines = content.split(/\r?\n/)
  let lastAt: number | undefined

  if (provider === 'codex') {
    let previousCodexTotal: TokenCounters | null = null
    // Codex reports the workspace path only once, on the leading session_meta line; later token_count events inherit it.
    let codexCwd: string | undefined
    let codexModel: string | undefined
    let codexSessionId: string | undefined
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line || lineTooLong(line, maxLineBytes)) continue
      const wantsCwd = (codexCwd === undefined || codexSessionId === undefined) && line.includes('"session_meta"')
      const wantsModel = line.includes('"turn_context"') || (codexModel === undefined && line.includes('"session_meta"'))
      if (!wantsCwd && !wantsModel && !line.includes('"token_count"')) continue
      const record = parseObject(line)
      if (!record) continue
      if (wantsCwd) {
        codexCwd = codexSessionCwd(record) ?? codexCwd
        codexSessionId = codexMetaSessionId(record) ?? codexSessionId
      }
      if (wantsModel) codexModel = codexContextModel(record) ?? codexModel
      lastAt = timestamp(record.timestamp, lastAt)
      const result = parseCodexUsageRecord(record, fileKey, index + 1, lastAt, previousCodexTotal, codexCwd, codexModel, codexSessionId)
      if (!result) continue
      // Rebase even when no record was produced, or a reset would leave a stale total that every later delta is computed against.
      previousCodexTotal = result.cumulative
      if (result.record) records.set(result.record.dedupeKey, result.record)
    }
    return [...records.values()]
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || lineTooLong(line, maxLineBytes)) continue
    const parsed = parseLocalUsageLine(provider, line, fileKey, index + 1, lastAt)
    if (!parsed) continue
    lastAt = parsed.occurredAt
    // Claude streaming records may repeat a message id with cumulative usage; keep the latest.
    records.set(parsed.dedupeKey, parsed)
  }
  return [...records.values()]
}

export function createIncrementalLocalUsageParserState(): IncrementalLocalUsageParserState {
  return {
    readOffset: 0,
    nextLineNumber: 1,
    previousCodexTotal: null,
    codexCwd: undefined,
    lastTimestamp: undefined,
    discardingLongLine: false,
  }
}

function parseUsageLine(
  provider: UsageProvider,
  line: string,
  fileKey: string,
  lineNumber: number,
  maxLineBytes: number,
  state: IncrementalLocalUsageParserState,
): ParsedUsage | null {
  if (!line || lineTooLong(line, maxLineBytes)) return null
  if (provider === 'claude-code') {
    const parsed = parseLocalUsageLine(provider, line, fileKey, lineNumber, state.lastTimestamp)
    if (parsed) state.lastTimestamp = parsed.occurredAt
    return parsed
  }
  const wantsCwd = (state.codexCwd === undefined || state.codexSessionId === undefined) && line.includes('"session_meta"')
  const wantsModel = line.includes('"turn_context"') || (state.codexModel === undefined && line.includes('"session_meta"'))
  if (!wantsCwd && !wantsModel && !line.includes('"token_count"')) return null
  const record = parseObject(line)
  if (!record) return null
  if (wantsCwd) {
    state.codexCwd = codexSessionCwd(record) ?? state.codexCwd
    state.codexSessionId = codexMetaSessionId(record) ?? state.codexSessionId
  }
  if (wantsModel) state.codexModel = codexContextModel(record) ?? state.codexModel
  state.lastTimestamp = timestamp(record.timestamp, state.lastTimestamp)
  const result = parseCodexUsageRecord(
    record,
    fileKey,
    lineNumber,
    state.lastTimestamp,
    state.previousCodexTotal,
    state.codexCwd,
    state.codexModel,
    state.codexSessionId,
  )
  if (!result) return null
  state.previousCodexTotal = result.cumulative
  return result.record
}

export function parseIncrementalLocalUsageChunk(
  provider: UsageProvider,
  fileKey: string,
  bytes: Buffer,
  chunkStartOffset: number,
  maxLineBytes: number,
  state: IncrementalLocalUsageParserState,
): ParsedUsage[] {
  const records = new Map<string, ParsedUsage>()
  let cursor = 0
  let absoluteOffset = chunkStartOffset

  if (state.discardingLongLine) {
    const newline = bytes.indexOf(0x0a)
    if (newline < 0) {
      state.readOffset = chunkStartOffset + bytes.length
      return []
    }
    cursor = newline + 1
    absoluteOffset += cursor
    state.nextLineNumber += 1
    state.discardingLongLine = false
  }

  while (cursor < bytes.length) {
    const newline = bytes.indexOf(0x0a, cursor)
    if (newline < 0) break
    let end = newline
    if (end > cursor && bytes[end - 1] === 0x0d) end -= 1
    const lineBytes = bytes.subarray(cursor, end)
    if (lineBytes.length <= maxLineBytes) {
      const line = lineBytes.toString('utf8')
      const parsed = parseUsageLine(
        provider,
        line,
        fileKey,
        state.nextLineNumber,
        maxLineBytes,
        state,
      )
      if (parsed) records.set(parsed.dedupeKey, parsed)
    }
    state.nextLineNumber += 1
    cursor = newline + 1
    absoluteOffset = chunkStartOffset + cursor
  }

  const remainingBytes = bytes.length - cursor
  if (remainingBytes > maxLineBytes) {
    state.discardingLongLine = true
    state.readOffset = chunkStartOffset + bytes.length
  } else {
    state.readOffset = absoluteOffset
  }
  return [...records.values()]
}

function* interleaveByRoot(perRoot: ReadonlyArray<{ root: UsageRoot, files: UsageFile[] }>): Generator<{ root: UsageRoot, file: UsageFile }> {
  const longest = perRoot.reduce((max, entry) => Math.max(max, entry.files.length), 0)
  for (let index = 0; index < longest; index += 1) {
    for (const { root, files } of perRoot) {
      const file = files[index]
      if (file) yield { root, file }
    }
  }
}

type UsageFileHandle = Awaited<ReturnType<typeof open>>

// Does not follow a final symlink and re-checks the opened inode is the one the walk verified (no swap between stat and open).
async function openVerifiedUsageFile(
  filePath: string,
  expected: Pick<UsageFile, 'dev' | 'ino'>,
): Promise<{ handle: UsageFileHandle, size: number } | null> {
  let handle: UsageFileHandle | null = null
  try {
    const noFollow = (fsConstants as typeof fsConstants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
      await handle.close().catch(() => undefined)
      return null
    }
    return { handle, size: opened.size }
  } catch {
    if (handle) await handle.close().catch(() => undefined)
    return null
  }
}

// Codex rollout files announce the model on each `turn_context` line (and some
// builds also on `session_meta`); token_count events that follow inherit it.
function codexContextModel(record: Record<string, unknown>): string | undefined {
  if (record.type !== 'turn_context' && record.type !== 'session_meta') return undefined
  const payload = asRecord(record.payload)
  const model = payload ? safeModelId(payload.model) : ''
  return model || undefined
}

function codexSessionCwd(record: Record<string, unknown>): string | undefined {
  if (record.type !== 'session_meta') return undefined
  const payload = asRecord(record.payload)
  return payload ? text(payload.cwd) : undefined
}

// The rollout's thread id: what Codex hooks report as session_id. Newer builds
// write `session_id` next to `id`; both hold the same UUID.
function codexMetaSessionId(record: Record<string, unknown>): string | undefined {
  if (record.type !== 'session_meta') return undefined
  const payload = asRecord(record.payload)
  return payload ? text(payload.session_id) ?? text(payload.id) : undefined
}

function parseCodexUsageRecord(
  record: Record<string, unknown>,
  fileKey: string,
  lineNumber: number,
  inheritedAt: number | undefined,
  previousTotal: TokenCounters | null,
  fileCwd: string | undefined,
  fileModel: string | undefined,
  fileSessionId: string | undefined,
): CodexUsageResult | null {
  if (record.type !== 'event_msg') return null
  const payload = asRecord(record.payload)
  if (!payload || payload.type !== 'token_count') return null
  const info = asRecord(payload.info)
  const usage = info ? asRecord(info.last_token_usage) : null
  if (!info || !usage) return null
  return codexUsage(record, payload, info, usage, fileKey, lineNumber, inheritedAt, previousTotal, fileCwd, fileModel, fileSessionId)
}

export class LocalUsageReader {
  private readonly configDirs: () => LocalUsageConfigDirs
  private readonly history: HistoryStore
  private readonly now: () => number
  private readonly maxFiles: number
  private readonly maxFileBytes: number
  private readonly maxTotalBytes: number
  private readonly maxLineBytes: number
  private readonly projectRouting: ProjectPathResolver | null
  private readonly maxScanMs: number
  private readonly clock: () => number
  private readonly importBatchRecords: number
  private readonly onRecordsImported: ((records: readonly HistoryTokenUsageRecord[]) => void) | null
  private readonly fileCache = new Map<string, LocalUsageFileCacheEntry>()
  private readonly scanCaches = new Map<string, UsageScanCache>()
  private activeScan: Promise<LocalUsageScanResult> | null = null
  private diagnostics: LocalUsageScanDiagnostics | null = null

  constructor(options: LocalUsageReaderOptions) {
    const { homeDir } = options
    this.configDirs = options.configDirs ?? (() => ({ claude: join(homeDir, '.claude'), codex: join(homeDir, '.codex') }))
    this.history = options.history
    this.now = options.now ?? Date.now
    this.maxFiles = Math.max(1, Math.min(DEFAULT_MAX_FILES, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES)))
    this.maxFileBytes = Math.max(64 * 1024, Math.min(DEFAULT_MAX_FILE_BYTES, Math.floor(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)))
    this.maxTotalBytes = Math.max(this.maxFileBytes, Math.min(DEFAULT_MAX_TOTAL_BYTES, Math.floor(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)))
    this.maxLineBytes = Math.max(4 * 1024, Math.min(DEFAULT_MAX_LINE_BYTES, Math.floor(options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES)))
    this.projectRouting = options.projectRouting ?? null
    this.maxScanMs = Math.max(50, Math.min(60_000, Math.floor(options.maxScanMs ?? DEFAULT_MAX_SCAN_MS)))
    this.clock = options.clock ?? (() => performance.now())
    this.importBatchRecords = Math.max(1, Math.min(5_000, Math.floor(options.importBatchRecords ?? DEFAULT_IMPORT_BATCH_RECORDS)))
    this.onRecordsImported = options.onRecordsImported ?? null
  }

  scan(): Promise<LocalUsageScanResult> {
    if (this.activeScan) return this.activeScan
    this.activeScan = this.scanNow().finally(() => {
      this.activeScan = null
    })
    return this.activeScan
  }

  getDiagnostics(): LocalUsageScanDiagnostics | null {
    return this.diagnostics
  }

  private async scanNow(): Promise<LocalUsageScanResult> {
    const startedAt = Date.now()
    const dirs = this.configDirs()
    const roots: UsageRoot[] = [
      { provider: 'codex', adapterId: 'codex', agentId: 'codex', directory: join(dirs.codex, 'sessions') },
      { provider: 'claude-code', adapterId: 'claude-code', agentId: 'claude', directory: join(dirs.claude, 'projects') },
      { provider: 'claude-code', adapterId: 'claude-code', agentId: 'claude', directory: join(dirs.claude, 'transcripts') },
    ]
    const result: LocalUsageScanResult = {
      filesScanned: 0, filesSkipped: 0, recordsParsed: 0, recordsImported: 0, filesDeferred: 0, pending: false, bytesRead: 0,
    }
    const cutoff = Math.max(
      this.history.getLocalUsageCutoff(),
      this.now() - this.history.getRetentionDays() * DAY_MS,
    )
    let remainingFiles = this.maxFiles
    let remainingBytes = this.maxTotalBytes

    // Interleave roots so a slow or large Codex tree can never starve the Claude roots of the read budget.
    const perRoot: Array<{ root: UsageRoot, files: UsageFile[] }> = []
    for (const root of roots) {
      if (remainingFiles <= 0) break
      const files = await filesUnder(root.directory, remainingFiles, cutoff, this.scanCaches.get(root.directory) ?? this.newScanCache(root.directory), root.provider === 'codex', this.now())
      remainingFiles -= files.length
      perRoot.push({ root, files })
    }
    // The budget starts after the walk, or directory listing time could leave every file deferred.
    const deadline = this.clock() + this.maxScanMs
    let scanBytes = 0

    for (const { root, file } of interleaveByRoot(perRoot)) {
      const { path: filePath, ...stat } = file
      await yieldToEventLoop()
      const cacheKey = `${root.provider}:${filePath}`
      const previous = this.fileCache.get(cacheKey)
      const sameFile = previous && previous.dev === stat.dev && previous.ino === stat.ino
      if (
        sameFile && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size
        && previous.readEnd >= stat.size
      ) {
        this.rememberFile(cacheKey, previous)
        continue
      }
      const appendedOnly = Boolean(sameFile && previous && stat.size > previous.size)
      const resumePartial = Boolean(sameFile && previous && previous.readEnd < previous.size && stat.size >= previous.size)
      const parserState = (appendedOnly || resumePartial) && previous
        ? {
            readOffset: previous.readOffset,
            nextLineNumber: previous.nextLineNumber,
            previousCodexTotal: previous.previousCodexTotal,
            codexCwd: previous.codexCwd,
            codexModel: previous.codexModel,
            codexSessionId: previous.codexSessionId,
            lastTimestamp: previous.lastTimestamp,
            discardingLongLine: previous.discardingLongLine,
          }
        : createIncrementalLocalUsageParserState()
      const readStart = appendedOnly || resumePartial ? parserState.readOffset : 0
      // At least one slice is read per scan so a budget-limited scan always makes progress.
      if (remainingBytes <= 0 || (scanBytes > 0 && this.clock() >= deadline)) {
        // Leave this file's cache entry untouched so the next scan resumes here instead of dropping the file.
        result.filesDeferred += 1
        continue
      }
      const readEnd = Math.min(stat.size, readStart + this.maxFileBytes, readStart + remainingBytes)
      const opened = await openVerifiedUsageFile(filePath, stat)
      if (!opened) { result.filesSkipped += 1; continue }
      const fileKey = digest(`${root.provider}:${filePath}`)
      const records = new Map<string, ParsedUsage>()
      let position = readStart
      // Deferred only when a budget stopped the read, never when the file simply ended early.
      let stoppedOnBudget = false
      try {
        const end = Math.min(readEnd, opened.size)
        let carry: Buffer = Buffer.alloc(0)
        while (position < end) {
          const want = Math.min(PARSE_SLICE_BYTES, end - position)
          const slice = Buffer.allocUnsafe(want)
          const { bytesRead } = await opened.handle.read(slice, 0, want, position)
          if (bytesRead <= 0) break
          position += bytesRead
          remainingBytes -= bytesRead
          scanBytes += bytesRead
          const fresh = slice.subarray(0, bytesRead)
          const chunk = carry.length > 0 ? Buffer.concat([carry, fresh]) : fresh
          const chunkStart = position - chunk.length
          for (const record of parseIncrementalLocalUsageChunk(
            root.provider, fileKey, chunk, chunkStart, this.maxLineBytes, parserState,
          )) records.set(record.dedupeKey, record)
          carry = Buffer.from(chunk.subarray(Math.max(0, parserState.readOffset - chunkStart)))
          if (position < end) {
            if (this.clock() >= deadline) { stoppedOnBudget = true; break }
            await yieldToEventLoop()
          }
        }
        if (!stoppedOnBudget && readEnd < stat.size && position >= readEnd) stoppedOnBudget = true
      } catch {
        result.filesSkipped += 1
        continue
      } finally {
        await opened.handle.close().catch(() => undefined)
      }
      result.filesScanned += 1
      if (stoppedOnBudget) result.filesDeferred += 1
      const unique = [...records.values()]
      result.recordsParsed += unique.length
      result.recordsImported += await this.importRecords(unique, cutoff)
      this.rememberFile(cacheKey, { ...stat, ...parserState, readEnd: position })
    }
    result.bytesRead = scanBytes
    result.pending = result.filesDeferred > 0
    this.diagnostics = { ...result, finishedAt: Date.now(), durationMs: Date.now() - startedAt }
    return result
  }

  private async importRecords(records: ParsedUsage[], cutoff: number): Promise<number> {
    const fresh = records.filter(record => record.occurredAt > cutoff)
    // Resolve each distinct cwd once (including negative results); trackSeen gets the newest usage time.
    const latestByCwd = new Map<string, number>()
    for (const record of fresh) {
      if (!record.cwd) continue
      latestByCwd.set(record.cwd, Math.max(latestByCwd.get(record.cwd) ?? 0, record.occurredAt))
    }
    const projectByCwd = new Map<string, string | undefined>()
    for (const [cwd, seenAt] of latestByCwd) {
      projectByCwd.set(cwd, this.projectRouting?.trackSeen(cwd, seenAt)?.projectId)
    }
    let imported = 0
    for (let offset = 0; offset < fresh.length; offset += this.importBatchRecords) {
      const batch = fresh.slice(offset, offset + this.importBatchRecords).map(record => ({
        ...record,
        projectId: record.cwd ? projectByCwd.get(record.cwd) : undefined,
      }))
      imported += this.history.recordTokenUsageBatch(batch)
      if (this.onRecordsImported) {
        // A downstream ledger failure must never stop History from importing.
        try { this.onRecordsImported(batch) } catch (error) { console.error('Local usage consumer failed', error) }
      }
      if (offset + this.importBatchRecords < fresh.length) await yieldToEventLoop()
    }
    return imported
  }

  private newScanCache(directory: string): UsageScanCache {
    const cache = createUsageScanCache()
    this.scanCaches.set(directory, cache)
    return cache
  }

  private rememberFile(key: string, entry: LocalUsageFileCacheEntry): void {
    this.fileCache.delete(key)
    this.fileCache.set(key, entry)
    while (this.fileCache.size > this.maxFiles) {
      const oldest = this.fileCache.keys().next().value
      if (oldest === undefined) return
      this.fileCache.delete(oldest)
    }
  }
}
