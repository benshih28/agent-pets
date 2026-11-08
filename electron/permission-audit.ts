import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PermissionAuditRecord } from './permission-broker'
import { renameSyncWithRetry } from './fs-rename.ts'

// Append-only JSON Lines: one small append per decision instead of reading,
// rewriting and fsyncing the whole file, so a burst of requests cannot block
// the main thread. The file is trimmed to the newest records now and then.
const MAX_AUDIT_RECORDS = 500
const TRIM_EVERY = 100
// Never read more than this from disk; a larger file is read from its tail only.
const MAX_AUDIT_READ_BYTES = 512 * 1024
let appendsSinceTrim = 0

export function appendPermissionAudit(filePath: string, record: Readonly<PermissionAuditRecord>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(sanitizeAuditRecord(record))}\n`, { encoding: 'utf8', mode: 0o600 })
  appendsSinceTrim += 1
  if (appendsSinceTrim >= TRIM_EVERY) {
    appendsSinceTrim = 0
    trimPermissionAudit(filePath)
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600) } catch {}
  }
}

export function readPermissionAudit(filePath: string, limit = MAX_AUDIT_RECORDS): PermissionAuditRecord[] {
  let text: string
  try {
    text = readTail(filePath, MAX_AUDIT_READ_BYTES)
  } catch {
    return []
  }
  const records: PermissionAuditRecord[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        records.push(sanitizeAuditRecord(value as PermissionAuditRecord))
      }
    } catch {
      // A torn final line (crash mid-append) is skipped, not fatal.
    }
  }
  return records.slice(-Math.max(1, limit))
}

export function clearPermissionAudit(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // Nothing to clear.
  }
  appendsSinceTrim = 0
}

function readTail(filePath: string, maxBytes: number): string {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(descriptor).size
    if (size <= maxBytes) return fs.readFileSync(descriptor, 'utf8')
    const buffer = Buffer.alloc(maxBytes)
    fs.readSync(descriptor, buffer, 0, maxBytes, size - maxBytes)
    const text = buffer.toString('utf8')
    // The first line is probably cut in half.
    return text.slice(text.indexOf('\n') + 1)
  } finally {
    fs.closeSync(descriptor)
  }
}

/**
 * Startup housekeeping: trims an oversized audit file left by earlier runs (the append counter
 * only lives in memory) and deletes the legacy `permission-audit.json` once.
 */
export function trimPermissionAuditOnStartup(filePath: string, legacyJsonPath?: string): void {
  try {
    if (legacyJsonPath) fs.rmSync(legacyJsonPath, { force: true })
  } catch {}
  try {
    const stat = fs.statSync(filePath)
    if (stat.isFile() && stat.size > MAX_AUDIT_READ_BYTES / 4) trimPermissionAudit(filePath)
  } catch {}
}

function trimPermissionAudit(filePath: string): void {
  const records = readPermissionAudit(filePath, MAX_AUDIT_RECORDS)
  const tempPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSyncWithRetry(tempPath, filePath)
}

function sanitizeAuditRecord(record: Readonly<PermissionAuditRecord>): PermissionAuditRecord {
  return {
    requestId: record.requestId,
    adapterId: record.adapterId,
    agentId: record.agentId,
    sessionId: record.sessionId,
    generation: record.generation,
    receivedAt: record.receivedAt,
    resolvedAt: record.resolvedAt,
    status: record.status,
    ...(record.decision ? { decision: record.decision } : {}),
    ...(record.decidedBy ? { decidedBy: record.decidedBy } : {}),
    terminalReason: record.terminalReason,
    ...(typeof record.action === 'string' ? { action: record.action.slice(0, 80) } : {}),
    ...(record.risk ? { risk: record.risk } : {}),
  }
}
