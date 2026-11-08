import assert from 'node:assert/strict'
import test from 'node:test'
import {
  floorToHour,
  latestUsageBlocks,
  USAGE_BLOCK_MS,
  usageBlockView,
  type UsageBlockEntry,
} from '../src/utils/usage-blocks.ts'

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
const BASE = Date.UTC(2026, 10, 7, 9, 0, 0)

function entry(adapterId: string, at: number, input = 100, output = 50): UsageBlockEntry {
  return { adapterId, occurredAt: at, tokenInput: input, tokenOutput: output, tokenCacheRead: 7, tokenCacheWrite: 3 }
}

test('a block starts at the first usage floored to the hour and lasts five hours', () => {
  const [block] = latestUsageBlocks([entry('claude-code', BASE + 23 * MINUTE), entry('claude-code', BASE + 2 * HOUR)])
  assert.equal(block!.startAt, BASE)
  assert.equal(block!.endAt, BASE + USAGE_BLOCK_MS)
  assert.equal(block!.firstActivityAt, BASE + 23 * MINUTE)
  assert.equal(block!.lastActivityAt, BASE + 2 * HOUR)
  assert.equal(block!.tokenInput, 200)
  assert.equal(block!.tokenOutput, 100)
  assert.equal(block!.tokenCacheRead, 14)
  assert.equal(block!.records, 2)
  assert.equal(floorToHour(BASE + 59 * MINUTE), BASE)
})

test('usage past the block end opens a new block even without a five-hour gap', () => {
  const blocks = latestUsageBlocks([
    entry('codex', BASE + 10 * MINUTE),
    entry('codex', BASE + 4 * HOUR),
    entry('codex', BASE + 5 * HOUR + 15 * MINUTE),
  ])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.startAt, BASE + 5 * HOUR)
  assert.equal(blocks[0]!.records, 1)
})

test('a gap of five hours or more closes the block; the next one re-floors to its own hour', () => {
  // ccusage rule: gap measured from the last activity, not the block start.
  const blocks = latestUsageBlocks([
    entry('claude-code', BASE),
    entry('claude-code', BASE + 5 * HOUR + 40 * MINUTE),
  ])
  assert.equal(blocks[0]!.startAt, BASE + 5 * HOUR)
  assert.equal(blocks[0]!.tokenInput, 100)
})

test('agents get independent blocks and input order does not matter', () => {
  const entries = [
    entry('codex', BASE + 3 * HOUR),
    entry('claude-code', BASE + 30 * MINUTE),
    entry('codex', BASE + 1 * HOUR),
    entry('claude-code', BASE + 90 * MINUTE),
  ]
  const forward = latestUsageBlocks(entries)
  const reversed = latestUsageBlocks([...entries].reverse())
  assert.deepEqual(forward, reversed)
  assert.deepEqual(forward.map(block => [block.adapterId, block.startAt, block.records]), [
    ['claude-code', BASE, 2],
    ['codex', BASE + HOUR, 2],
  ])
})

test('usageBlockView reports elapsed, remaining and burn rate at a fixed clock', () => {
  const [block] = latestUsageBlocks([
    entry('claude-code', BASE + 30 * MINUTE, 600, 0),
    entry('claude-code', BASE + 60 * MINUTE, 600, 0),
  ])
  const now = BASE + 90 * MINUTE
  const view = usageBlockView(block!, now)
  assert.equal(view.active, true)
  assert.equal(view.tokens, 1200)
  assert.equal(view.elapsedMs, 90 * MINUTE)
  assert.equal(view.remainingMs, USAGE_BLOCK_MS - 90 * MINUTE)
  // 1200 tokens over the 60 minutes since the first activity.
  assert.equal(view.burnRatePerMinute, 20)
})

test('a block is inactive after its end or after five idle hours, and never reports negative time', () => {
  const [block] = latestUsageBlocks([entry('codex', BASE + 10 * MINUTE)])
  const ended = usageBlockView(block!, BASE + USAGE_BLOCK_MS + MINUTE)
  assert.equal(ended.active, false)
  assert.equal(ended.remainingMs, 0)
  assert.equal(ended.elapsedMs, USAGE_BLOCK_MS)
  const early = usageBlockView(block!, BASE + 10 * MINUTE)
  assert.equal(early.burnRatePerMinute, 0)
  assert.ok(early.elapsedMs >= 0)
})

test('non-finite timestamps are ignored and an empty input yields no blocks', () => {
  assert.deepEqual(latestUsageBlocks([]), [])
  assert.deepEqual(latestUsageBlocks([entry('codex', Number.NaN)]), [])
})

test('blocks floor to the local hour in half- and quarter-hour time zones', () => {
  // 2026-11-07 03:50 UTC is 09:20 in India (+5:30), 09:35 in Nepal (+5:45), 13:20 in Adelaide (+9:30).
  const at = Date.UTC(2026, 10, 7, 3, 50, 0)
  for (const [offset, localStartUtc] of [
    [330, Date.UTC(2026, 10, 7, 3, 30, 0)],
    [345, Date.UTC(2026, 10, 7, 3, 15, 0)],
    [570, Date.UTC(2026, 10, 7, 3, 30, 0)],
    [0, Date.UTC(2026, 10, 7, 3, 0, 0)],
    [-210, Date.UTC(2026, 10, 7, 3, 30, 0)],
  ] as const) {
    assert.equal(floorToHour(at, offset), localStartUtc, `offset ${offset}`)
    const [block] = latestUsageBlocks([entry('claude-code', at)], () => offset)
    assert.equal(block!.startAt, localStartUtc, `block offset ${offset}`)
    // The local wall-clock minute of the start is always :00.
    assert.equal(new Date(block!.startAt + offset * 60_000).getUTCMinutes(), 0)
  }
})
