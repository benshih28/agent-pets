import assert from 'node:assert/strict'
import test from 'node:test'
import { withAnswerableClaudeNotice } from '../electron/claude-permission-notice.ts'
import type { AdapterNormalizeResult } from '../src/types/agent-adapter.ts'

function waiting(source: string, sessionId = 's1'): AdapterNormalizeResult {
  return {
    ok: true,
    event: { source: source as never, sessionId, state: 'waiting-permission', timestamp: 1, permissionNotice: { responseMode: 'external_only' } },
  }
}

test('an answerable Claude prompt loses the external-only notice', () => {
  const calls: string[] = []
  const context = { enabled: true, hasRecentRequest: (source: string, sessionId: string) => { calls.push(`${source}:${sessionId}`); return true } }
  for (const source of ['claude', 'claude-desktop']) {
    const result = withAnswerableClaudeNotice(waiting(source), context)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.event.permissionNotice, undefined)
      assert.equal(result.event.state, 'waiting-permission')
    }
  }
  assert.deepEqual(calls, ['claude:s1', 'claude-desktop:s1'])
})

test('the notice stays when the feature is off, no request exists, or the agent is not Claude', () => {
  const kept = (result: AdapterNormalizeResult) => result.ok && result.event.permissionNotice?.responseMode === 'external_only'
  assert.ok(kept(withAnswerableClaudeNotice(waiting('claude'), { enabled: false, hasRecentRequest: () => true })))
  assert.ok(kept(withAnswerableClaudeNotice(waiting('claude'), { enabled: true, hasRecentRequest: () => false })))
  assert.ok(kept(withAnswerableClaudeNotice(waiting('codex'), { enabled: true, hasRecentRequest: () => true })))
  const failed: AdapterNormalizeResult = { ok: false, error: 'x' }
  assert.equal(withAnswerableClaudeNotice(failed, { enabled: true, hasRecentRequest: () => true }), failed)
})
