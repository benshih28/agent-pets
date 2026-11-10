import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOAST_ERROR_MS,
  TOAST_SUCCESS_MS,
  TOAST_WAITING_MS,
  describeTool,
  formatElapsedShort,
  toastDurationFor,
} from '../src/utils/pet-toast.ts'

test('failures linger longer than successes', () => {
  assert.equal(toastDurationFor('success'), TOAST_SUCCESS_MS)
  assert.equal(toastDurationFor('error'), TOAST_ERROR_MS)
  assert.ok(TOAST_ERROR_MS > TOAST_SUCCESS_MS)
})

test('elapsed time is compact and hidden for trivial runs', () => {
  assert.equal(formatElapsedShort(undefined), null)
  assert.equal(formatElapsedShort(2_000), null)
  assert.equal(formatElapsedShort(45_000), '45s')
  assert.equal(formatElapsedShort(134_000), '2m 14s')
  assert.equal(formatElapsedShort(3_900_000), '1h 05m')
  assert.equal(formatElapsedShort(Number.NaN), null)
})

test('tool identifiers map to readable categories', () => {
  assert.equal(describeTool('Bash').key, 'pet.tool.run')
  assert.equal(describeTool('Edit').key, 'pet.tool.edit')
  assert.equal(describeTool('Grep').key, 'pet.tool.search')
  assert.equal(describeTool('Read').key, 'pet.tool.read')
  assert.deepEqual(describeTool('mcp__github__create_issue'), { key: 'pet.tool.mcp', params: { server: 'github' } })
  const odd = describeTool('<script>'.padEnd(60, 'x'))
  assert.equal(odd.key, 'pet.tool.generic')
  assert.ok(odd.params.name.length <= 28)
  assert.ok(!odd.params.name.includes('<'))
})

// 短任務不出聲的門檻已移到音效 registry，測試在 tests/sound-registry.test.mts。
test('waiting reminders have their own lifetime', () => {
  assert.equal(toastDurationFor('waiting'), TOAST_WAITING_MS)
})
