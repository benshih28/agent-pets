import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentFamilyKey } from '../src/types/agent.ts'
import { asRecord } from './value-guards.ts'

// 從 agent 自己寫的對話紀錄檔判斷「回合是不是已經結束」。
//
// 為什麼需要：agent 不保證會送結束事件。使用者按 Esc 中斷、拒絕工具時，Claude Code 與 Codex 都不送 Stop，
// 寵物會停在 thinking／tool-running。紀錄檔結尾有明確的事實（Claude 的中斷訊息、Codex 的
// turn_aborted／task_complete），用它判斷比猜時間準，長時間的思考或 build 也不會被誤判。
//
// 安全邊界：
// - 檔案位置由主程序從 agent 設定目錄與 session id 自己組出來，不接受事件帶來的路徑。
// - session id 先過白名單（不含路徑分隔字元與 `.`）才拿去比對檔名。
// - 只讀檔尾固定大小，只取出「結束了沒、什麼時候」，對話內容不保存、不記錄、不離開這個函式。
// - 紀錄格式不是公開契約：看不懂就當成「還在進行」，最壞情況等同沒有這個功能（由狀態期限接手）。

export const TRANSCRIPT_TAIL_BYTES = 64 * 1024
/** 與 src/types/id-patterns.ts 的精神相同，但更嚴：這裡的值會用來比對檔名。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

export interface TranscriptTurnEnd {
  /** 紀錄檔裡那筆結束紀錄的時間。 */
  endedAt: number
  reason: 'interrupted' | 'completed'
}

/** 'open'：回合還在進行。null：這筆紀錄跟回合邊界無關，繼續往前看。 */
type RecordVerdict = TranscriptTurnEnd | 'open' | null

/** 找紀錄檔時用到的檔案系統操作；測試可以換掉。失敗一律當成「沒有」。 */
export interface TranscriptFs {
  list(directory: string): Promise<string[]>
  isFile(filePath: string): Promise<boolean>
}

interface TranscriptFormat {
  /** 找出這個 session 的紀錄檔；找不到回 null。 */
  locate(configDir: string, sessionId: string, fs: TranscriptFs): Promise<string | null>
  classify(record: Record<string, unknown>): RecordVerdict
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

// --- Claude Code：<config>/projects/<專案 slug>/<sessionId>.jsonl -----------------------------------

// Claude Code 在使用者中斷回合時寫入的 user 訊息，整則就是這段文字。
const CLAUDE_INTERRUPT_TEXT = /^\[Request interrupted by user(?: for tool use)?\]$/

function claudeUserText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.length !== 1) return null
  const block = content[0] as { type?: unknown, text?: unknown } | null
  return block && block.type === 'text' && typeof block.text === 'string' ? block.text : null
}

const claudeFormat: TranscriptFormat = {
  async locate(configDir, sessionId, fs) {
    const projects = join(configDir, 'projects')
    for (const project of await fs.list(projects)) {
      const candidate = join(projects, project, `${sessionId}.jsonl`)
      if (await fs.isFile(candidate)) return candidate
    }
    return null
  },
  classify(record) {
    // 子代理的紀錄不代表主回合。
    if (record.isSidechain === true) return null
    if (record.type !== 'user' && record.type !== 'assistant') return null
    const at = timestampMs(record.timestamp)
    if (at === null) return null
    if (record.type === 'assistant') return 'open'
    const text = claudeUserText(record.message)
    return text !== null && CLAUDE_INTERRUPT_TEXT.test(text.trim()) ? { endedAt: at, reason: 'interrupted' } : 'open'
  },
}

// --- Codex：<config>/sessions/<年>/<月>/<日>/rollout-<時間>-<sessionId>.jsonl -------------------------

const CODEX_DATE_PART = /^\d{2,4}$/

const codexFormat: TranscriptFormat = {
  async locate(configDir, sessionId, fs) {
    const root = join(configDir, 'sessions')
    const suffix = `-${sessionId}.jsonl`
    const newestFirst = (names: string[]) => names.filter(name => CODEX_DATE_PART.test(name)).sort().reverse()
    // 新的在前：正在跑的 session 幾乎都在最近幾天的目錄裡。
    for (const year of newestFirst(await fs.list(root))) {
      for (const month of newestFirst(await fs.list(join(root, year)))) {
        for (const day of newestFirst(await fs.list(join(root, year, month)))) {
          const directory = join(root, year, month, day)
          const match = (await fs.list(directory)).find(name => name.startsWith('rollout-') && name.endsWith(suffix))
          if (match) return join(directory, match)
        }
      }
    }
    return null
  },
  classify(record) {
    if (record.type !== 'event_msg') return null
    const kind = asRecord(record.payload)?.type
    if (kind === 'task_started') return 'open'
    if (kind !== 'task_complete' && kind !== 'turn_aborted') return null
    const at = timestampMs(record.timestamp)
    return at === null ? null : { endedAt: at, reason: kind === 'turn_aborted' ? 'interrupted' : 'completed' }
  },
}

// 每個家族都要明確填：有紀錄檔可讀就給格式，沒有就填 null（由狀態期限處理）。
const TRANSCRIPT_FORMATS = Object.freeze({
  claude: claudeFormat,
  codex: codexFormat,
  opencode: null,
} as const satisfies Record<AgentFamilyKey, TranscriptFormat | null>)

export function familyHasTranscript(family: AgentFamilyKey): boolean {
  return TRANSCRIPT_FORMATS[family] !== null
}

const realFs: TranscriptFs = {
  async list(directory) {
    try { return await readdir(directory) } catch { return [] }
  },
  async isFile(filePath) {
    try { return (await lstat(filePath)).isFile() } catch { return false }
  },
}

/** 紀錄檔的位置；session id 不合格、家族沒有紀錄檔或找不到都回 null。 */
export async function locateTranscript(
  family: AgentFamilyKey,
  configDir: string,
  sessionId: string,
  fs: TranscriptFs = realFs,
): Promise<string | null> {
  const format = TRANSCRIPT_FORMATS[family]
  if (!format || !SESSION_ID_PATTERN.test(sessionId)) return null
  return format.locate(configDir, sessionId, fs)
}

/**
 * 從檔尾的文字往回找第一筆能判斷回合邊界的紀錄。`truncated` 表示這段文字不是從檔案開頭讀的，
 * 第一行可能是半行，直接丟掉。
 */
export function turnEndFromTail(family: AgentFamilyKey, tail: string, truncated: boolean): TranscriptTurnEnd | null {
  const format = TRANSCRIPT_FORMATS[family]
  if (!format) return null
  const lines = tail.split('\n')
  const first = truncated ? 1 : 0
  for (let index = lines.length - 1; index >= first; index -= 1) {
    const line = lines[index]!.trim()
    if (!line) continue
    let record: Record<string, unknown> | null
    try { record = asRecord(JSON.parse(line)) } catch { continue }
    if (!record) continue
    const verdict = format.classify(record)
    if (verdict === null) continue
    return verdict === 'open' ? null : verdict
  }
  return null
}

export interface TranscriptFingerprint {
  size: number
  mtimeMs: number
}

export interface TranscriptProbe {
  fingerprint: TranscriptFingerprint
  /** 檔案跟上次看到的一樣時不重讀，回 'unchanged'。 */
  turnEnd: TranscriptTurnEnd | null | 'unchanged'
}

/** 讀紀錄檔結尾並判斷；檔案不存在、不是一般檔案或讀取失敗回 null。 */
export async function probeTranscript(
  family: AgentFamilyKey,
  filePath: string,
  previous?: TranscriptFingerprint,
): Promise<TranscriptProbe | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    // 不跟隨最後一層符號連結：紀錄檔應該是 agent 自己寫的一般檔案。
    const noFollow = (fsConstants as typeof fsConstants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow)
    const stat = await handle.stat()
    if (!stat.isFile()) return null
    const fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs }
    if (previous && previous.size === fingerprint.size && previous.mtimeMs === fingerprint.mtimeMs) {
      return { fingerprint, turnEnd: 'unchanged' }
    }
    const length = Math.min(stat.size, TRANSCRIPT_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, stat.size - length)
    const tail = buffer.subarray(0, bytesRead).toString('utf8')
    return { fingerprint, turnEnd: turnEndFromTail(family, tail, stat.size > length) }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
