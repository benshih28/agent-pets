import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveUpdateInsight } from '../public/update-insights.js'

test('turns normalized fields into a compact change and scope cue', () => {
  assert.deepEqual(deriveUpdateInsight({
    product: 'claude-code',
    category: 'developer-tool',
    changeType: 'fixed',
    title: 'Fixed session recovery',
  }), {
    change: '修正',
    scope: 'Claude Code · 開發工具',
    attention: { label: '未標示必要動作', tone: 'neutral' },
  })
})

test('prioritizes explicit replacement and lifecycle action signals', () => {
  assert.deepEqual(deriveUpdateInsight({
    product: 'model',
    category: 'new-model',
    changeType: 'deprecated',
    replacement: 'gpt-next',
    summary: 'Pricing is also changing.',
  }).attention, { label: '改用 gpt-next', tone: 'critical' })

  assert.deepEqual(deriveUpdateInsight({
    product: 'api',
    category: 'api-change',
    changeType: 'removed',
  }).attention, { label: '需要規劃遷移', tone: 'critical' })
})

test('detects bounded compatibility, cost, limit, and security cues without AI inference', () => {
  const base = { product: 'api', category: 'api-change', changeType: 'improved' }
  assert.equal(deriveUpdateInsight({ ...base, summary: 'This release has breaking changes.' }).attention.label, '檢查相容性')
  assert.equal(deriveUpdateInsight({ ...base, summary: 'The new pricing lowers input costs.' }).attention.label, '檢查成本')
  assert.equal(deriveUpdateInsight({ ...base, summary: 'Default rate limits have changed.' }).attention.label, '檢查限制')
  assert.equal(deriveUpdateInsight({ ...base, summary: 'New compliance and permission controls.' }).attention.label, '檢查安全／合規')
})
