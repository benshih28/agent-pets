import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendPermissionAudit, clearPermissionAudit, readPermissionAudit } from '../electron/permission-audit.ts'
import type { PermissionAuditRecord } from '../electron/permission-broker.ts'
import { removeTempTree } from './support/temp-dir.mts'

test('persistent permission audit remains bounded and excludes sensitive fields', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-pets-audit-'))
  const filePath = path.join(directory, 'permission-audit.jsonl')
  try {
    for (let index = 0; index < 505; index += 1) {
      // 呼叫端可能夾帶審計紀錄以外的敏感欄位（結構型別允許），驗證落盤時會被剔除。
      const leaky: PermissionAuditRecord & { description: string; responseHandle: string } = {
        requestId: `request-${index}`,
        adapterId: 'opencode-cli',
        agentId: 'opencode-cli',
        sessionId: 'session-1',
        generation: 1,
        receivedAt: index,
        resolvedAt: index + 1,
        status: 'denied',
        decision: 'deny',
        decidedBy: 'bubble',
        terminalReason: 'delivered',
        action: 'bash',
        risk: 'high',
        description: 'secret description',
        responseHandle: 'secret handle',
      }
      appendPermissionAudit(filePath, leaky)
    }
    const serialized = readFileSync(filePath, 'utf8')
    const records = readPermissionAudit(filePath)
    assert.ok(records.length <= 600)
    assert.equal(records[records.length - 1].requestId, 'request-504')
    assert.equal(readPermissionAudit(filePath, 10).length, 10)
    assert.equal(serialized.includes('secret description'), false)
    assert.equal(serialized.includes('secret handle'), false)
  } finally {
    removeTempTree(directory)
  }
})

test('audit can be cleared and tolerates a torn last line', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-pets-audit-'))
  const filePath = path.join(directory, 'permission-audit.jsonl')
  try {
    appendPermissionAudit(filePath, {
      requestId: 'r', adapterId: 'a', agentId: 'a', sessionId: 's', generation: 1,
      receivedAt: 1, resolvedAt: 2, status: 'allowed', decidedBy: 'panel', terminalReason: 'delivered',
    })
    writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}{"requestId":"torn`)
    assert.equal(readPermissionAudit(filePath).length, 1)
    assert.equal(readPermissionAudit(filePath)[0].decidedBy, 'panel')
    clearPermissionAudit(filePath)
    assert.deepEqual(readPermissionAudit(filePath), [])
  } finally {
    removeTempTree(directory)
  }
})

test('startup trim shrinks an oversized audit file, drops the legacy json and reads are bounded', async () => {
  const { trimPermissionAuditOnStartup } = await import('../electron/permission-audit.ts')
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-pets-audit-'))
  const filePath = path.join(directory, 'permission-audit.jsonl')
  const legacy = path.join(directory, 'permission-audit.json')
  try {
    writeFileSync(legacy, '[]')
    const line = (index: number) => JSON.stringify({
      requestId: `r-${index}`, adapterId: 'a', agentId: 'a', sessionId: 's', generation: 1,
      receivedAt: index, resolvedAt: index, status: 'denied', terminalReason: 'delivered', action: 'bash', risk: 'high',
    })
    writeFileSync(filePath, Array.from({ length: 5000 }, (_, index) => line(index)).join('\n') + '\n')
    assert.ok(readPermissionAudit(filePath, 10_000).length < 5000, 'reads only the bounded tail')
    trimPermissionAuditOnStartup(filePath, legacy)
    const remaining = readFileSync(filePath, 'utf8').trim().split('\n')
    assert.equal(remaining.length, 500)
    assert.equal(JSON.parse(remaining.at(-1)!).requestId, 'r-4999')
    assert.throws(() => readFileSync(legacy), /ENOENT/)
  } finally {
    removeTempTree(directory)
  }
})
