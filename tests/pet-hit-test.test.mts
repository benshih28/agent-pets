import assert from 'node:assert/strict'
import test from 'node:test'
import { PASSTHROUGH_RESYNC_MS, decidePassthrough, hasOpaquePixel } from '../src/utils/pet-hit-test.ts'

test('a neighbourhood with one opaque pixel counts as a hit', () => {
  const block = new Uint8ClampedArray(9 * 9 * 4)
  assert.equal(hasOpaquePixel(block), false)
  block[(4 * 9 + 6) * 4 + 3] = 200
  assert.equal(hasOpaquePixel(block), true)
  block[(4 * 9 + 6) * 4 + 3] = 10
  assert.equal(hasOpaquePixel(block), false)
})

test('passthrough sends on change and re-asserts a stale unchanged value', () => {
  assert.deepEqual(decidePassthrough(true, false, 1_000, 1_010), { send: true, next: true })
  assert.deepEqual(decidePassthrough(true, true, 1_000, 1_100), { send: false, next: true })
  assert.deepEqual(decidePassthrough(true, true, 1_000, 1_000 + PASSTHROUGH_RESYNC_MS), { send: true, next: true })
})
