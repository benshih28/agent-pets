import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import type { PermissionAuditRecord } from './permission-broker'

const MAX_AUDIT_RECORDS = 500

export function appendPermissionAudit(filePath: string, record: Readonly<PermissionAuditRecord>): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const records = readPermissionAudit(filePath)
  records.push(sanitizeAuditRecord(record))
  const bounded = records.slice(-MAX_AUDIT_RECORDS)
  const tempPath = `${filePath}.${process.pid}.tmp`
  const descriptor = fs.openSync(tempPath, 'w', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(bounded, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  renameSyncWithRetry(tempPath, filePath)
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600) } catch {}
  }
}

function readPermissionAudit(filePath: string): PermissionAuditRecord[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(value)
      ? value.filter((item): item is PermissionAuditRecord => Boolean(item && typeof item === 'object'))
      : []
  } catch {
    return []
  }
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
  }
}
