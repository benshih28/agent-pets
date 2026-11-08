import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestValueCoalescer, createOrderedBatchCoalescer } from '../electron/ipc/broadcast-coalescer.ts'

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

test('latest-value coalescing preserves the final projection in 1,000 seeded event-loop batches', () => {
  const random = seededRandom(0x18_03_2026)
  for (let sample = 0; sample < 1_000; sample += 1) {
    const scheduled: Array<() => void> = []
    const delivered: number[] = []
    const enqueue = createLatestValueCoalescer(value => delivered.push(value), callback => scheduled.push(callback))
    const count = 1 + Math.floor(random() * 100)
    let expected = 0
    for (let index = 0; index < count; index += 1) {
      expected = Math.floor(random() * 10_000)
      enqueue(expected)
    }
    assert.equal(scheduled.length, 1, `scheduled callbacks for case ${sample}`)
    scheduled.shift()!()
    assert.deepEqual(delivered, [expected], `final projection for case ${sample}`)
  }
})

test('ordered batch coalescing preserves every event and original order in 1,000 seeded batches', () => {
  const random = seededRandom(0x18_03_2026)
  for (let sample = 0; sample < 1_000; sample += 1) {
    const scheduled: Array<() => void> = []
    const delivered: number[] = []
    const enqueue = createOrderedBatchCoalescer(values => delivered.push(...values), callback => scheduled.push(callback))
    const expected = Array.from({ length: 1 + Math.floor(random() * 100) }, () => Math.floor(random() * 10_000))
    expected.forEach(enqueue)
    assert.equal(scheduled.length, 1, `scheduled callbacks for case ${sample}`)
    scheduled.shift()!()
    assert.deepEqual(delivered, expected, `ordered batch for case ${sample}`)
  }
})

test('bounded ordered coalescer sheds non-priority items first and keeps terminal ones', () => {
  const scheduled: Array<() => void> = []
  const delivered: string[] = []
  const dropped: string[] = []
  const enqueue = createOrderedBatchCoalescer<string>(
    values => delivered.push(...values),
    callback => scheduled.push(callback),
    { maxPending: 3, isPriority: value => value.startsWith('!'), onDrop: value => dropped.push(value) },
  )
  for (const value of ['a', '!done', 'b', 'c', 'd', '!err']) enqueue(value)
  scheduled.shift()!()
  assert.deepEqual(delivered, ['!done', 'd', '!err'])
  assert.deepEqual(dropped, ['a', 'b', 'c'])
})

test('a full queue of priority items never drops the arriving non-priority item into the queue', () => {
  const scheduled: Array<() => void> = []
  const delivered: string[] = []
  const enqueue = createOrderedBatchCoalescer<string>(
    values => delivered.push(...values),
    callback => scheduled.push(callback),
    { maxPending: 2, isPriority: value => value.startsWith('!') },
  )
  for (const value of ['!1', '!2', 'x', '!3']) enqueue(value)
  scheduled.shift()!()
  assert.deepEqual(delivered, ['!2', '!3'])
})

test('O(1) overflow matches the reference findIndex+splice behaviour on 2,000 seeded floods', () => {
  const reference = (values: string[], maxPending: number, isPriority: (v: string) => boolean): { out: string[], dropped: string[] } => {
    const pending: string[] = []
    const dropped: string[] = []
    for (const value of values) {
      if (pending.length >= maxPending) {
        let victim = pending.findIndex(item => !isPriority(item))
        if (victim < 0) {
          if (!isPriority(value)) { dropped.push(value); continue }
          victim = 0
        }
        dropped.push(pending.splice(victim, 1)[0]!)
      }
      pending.push(value)
    }
    return { out: pending, dropped }
  }
  const random = seededRandom(99)
  for (let sample = 0; sample < 2_000; sample += 1) {
    const maxPending = 1 + Math.floor(random() * 8)
    const values = Array.from({ length: Math.floor(random() * 60) }, (_, i) => `${random() < 0.3 ? '!' : ''}${i}`)
    const isPriority = (v: string): boolean => v.startsWith('!')
    const expected = reference(values, maxPending, isPriority)
    const scheduled: Array<() => void> = []
    const out: string[] = []
    const dropped: string[] = []
    const enqueue = createOrderedBatchCoalescer<string>(v => out.push(...v), c => scheduled.push(c), { maxPending, isPriority, onDrop: v => dropped.push(v) })
    values.forEach(enqueue)
    scheduled.shift()?.()
    assert.deepEqual(out, expected.out, `delivered ${sample}`)
    assert.deepEqual(dropped, expected.dropped, `dropped ${sample}`)
  }
})

test('overflow does O(1) priority checks per push, not O(maxPending)', () => {
  let checks = 0
  const enqueue = createOrderedBatchCoalescer<number>(() => {}, () => {}, { maxPending: 1000, isPriority: () => { checks += 1; return false } })
  for (let i = 0; i < 1000; i += 1) enqueue(i)
  checks = 0
  for (let i = 0; i < 20_000; i += 1) enqueue(i)
  assert.ok(checks <= 20_000 * 2, `priority checks ${checks}`)
})
