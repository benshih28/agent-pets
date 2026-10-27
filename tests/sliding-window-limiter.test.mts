import assert from 'node:assert/strict'
import test from 'node:test'
import { SlidingWindowLimiter } from '../electron/sliding-window-limiter.ts'

interface Entry {
  at: number
  scope?: string
}

function referencePrepare(entries: Entry[], now: number, windowMs: number): Entry[] {
  return entries.filter(entry => now - entry.at < windowMs)
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x1_0000_0000
  }
}

test('sliding window limiter matches array-filter behavior for 1,000 fixed-seed operation sequences', () => {
  const random = seededRandom(0x18_03_2026)
  const windowMs = 10_000

  for (let sample = 0; sample < 1_000; sample += 1) {
    const limiter = new SlidingWindowLimiter(windowMs, 4)
    let reference: Entry[] = []
    let now = Math.floor(random() * 30_000)
    const operations = 40 + Math.floor(random() * 61)

    for (let step = 0; step < operations; step += 1) {
      const timeDelta = Math.floor(random() * 4_001) - (random() < 0.08 ? 8_000 : 0)
      now = Math.max(0, now + timeDelta)
      const operation = Math.floor(random() * 10)

      if (operation < 6) {
        reference = referencePrepare(reference, now, windowMs)
        const limit = 1 + Math.floor(random() * 20)
        const oldest = reference[0]?.at ?? now
        const expected = {
          allowed: reference.length < limit,
          retryAfterMs: Math.max(1, windowMs - (now - oldest)),
        }
        assert.deepEqual(limiter.check(now, limit), expected, `sample ${sample}, step ${step}`)
      } else if (operation < 9) {
        reference = referencePrepare(reference, now, windowMs)
        const scope = `scope-${Math.floor(random() * 5)}`
        limiter.record(now, scope)
        reference.push({ at: now, scope })
      } else {
        reference = referencePrepare(reference, now, windowMs)
        limiter.prune(now)
      }

      if (random() < 0.04) {
        const scope = `scope-${Math.floor(random() * 5)}`
        limiter.removeScope(scope)
        reference = reference.filter(entry => entry.scope !== scope)
      }
      assert.equal(limiter.size, reference.length, `size at sample ${sample}, step ${step}`)
    }
  }
})

test('sliding window limiter preserves the first insertion retry time after a clock rollback', () => {
  const limiter = new SlidingWindowLimiter(10_000, 2)
  limiter.record(10_000, 'first')
  limiter.record(12_000, 'second')
  limiter.record(2_000, 'third')
  const result = limiter.check(3_000, 3)
  assert.deepEqual(result, { allowed: false, retryAfterMs: 17_000 })
  assert.equal(limiter.earliestTimestamp, 2_000)
})
