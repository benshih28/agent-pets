import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TOASTS, clearToasts, defaultDuration, dismissToast, pushToast, useToast } from '../src/composables/useToast.ts'

test('toast queue caps visible toasts and drops the oldest first', () => {
  clearToasts()
  const ids = Array.from({ length: MAX_TOASTS + 2 }, (_, i) => pushToast({ message: `m${i}`, duration: 0 }))
  const { toasts } = useToast()
  assert.equal(toasts.length, MAX_TOASTS)
  assert.deepEqual(toasts.map((x) => x.id), ids.slice(-MAX_TOASTS))
  clearToasts()
  assert.equal(toasts.length, 0)
})

test('toast defaults: danger lingers longer, explicit duration wins, dismiss is idempotent', () => {
  clearToasts()
  assert.ok(defaultDuration('danger') > defaultDuration('neutral'))
  const id = pushToast({ tone: 'success', duration: 0 })
  const { toasts } = useToast()
  assert.equal(toasts[0].duration, 0)
  dismissToast(id)
  dismissToast(id)
  assert.equal(toasts.length, 0)
})

test('toast auto-dismisses after its duration', async () => {
  clearToasts()
  pushToast({ duration: 10 })
  const { toasts } = useToast()
  assert.equal(toasts.length, 1)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(toasts.length, 0)
})
