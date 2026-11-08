import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOAST_ERROR_MS,
  TOAST_SUCCESS_MS,
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

import { TOAST_WAITING_MS, SUCCESS_SOUND_MIN_MS, shouldPlaySuccessSound } from '../src/utils/pet-toast.ts'

test('waiting reminders have their own lifetime and short tasks stay silent', () => {
  assert.equal(toastDurationFor('waiting'), TOAST_WAITING_MS)
  assert.equal(shouldPlaySuccessSound(undefined), true)
  assert.equal(shouldPlaySuccessSound(SUCCESS_SOUND_MIN_MS - 1), false)
  assert.equal(shouldPlaySuccessSound(SUCCESS_SOUND_MIN_MS), true)
})
