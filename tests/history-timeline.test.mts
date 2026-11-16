import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildTimelineRows } from '../src/utils/history-timeline.ts'
import type { HistorySessionTimelineEntry } from '../src/types/history.ts'

const entries: HistorySessionTimelineEntry[] = [
  { occurredAt: 1000, state: 'thinking' },
  { occurredAt: 4000, state: 'tool-running', toolName: 'Bash' },
  { occurredAt: 9000, state: 'success' },
]

test('descending order lists the newest entry first', () => {
  assert.deepEqual(buildTimelineRows(entries, 12000, 'desc').map(row => row.occurredAt), [9000, 4000, 1000])
})

test('ascending order keeps the chronological order', () => {
  assert.deepEqual(buildTimelineRows(entries, 12000, 'asc').map(row => row.occurredAt), [1000, 4000, 9000])
})

test('spans and keys do not depend on the display order', () => {
  const byKey = (order: 'asc' | 'desc') => new Map(buildTimelineRows(entries, 12000, order).map(row => [row.key, row.spanMs]))
  assert.deepEqual(byKey('desc'), byKey('asc'))
  assert.deepEqual([...byKey('asc').values()], [3000, 5000, null])
})

test('the last entry lasts until the session end unless it is terminal', () => {
  const rows = buildTimelineRows(entries.slice(0, 2), 12000, 'desc')
  assert.equal(rows[0].spanMs, 8000)
  assert.equal(buildTimelineRows([], 12000, 'desc').length, 0)
})

test('the input is not mutated and an end before the last entry clamps to zero', () => {
  const copy = structuredClone(entries)
  buildTimelineRows(copy, 0, 'desc')
  assert.deepEqual(copy, entries)
  assert.equal(buildTimelineRows(entries.slice(0, 1), 0, 'asc')[0].spanMs, 0)
})

test('the session detail defaults to newest first and offers an order toggle', () => {
  const source = readFileSync(new URL('../src/components/growth/HistorySessionDetail.vue', import.meta.url), 'utf8')
  assert.match(source, /ref<TimelineOrder>\('desc'\)/)
  assert.match(source, /<SegmentedControl[^>]*v-if="timeline\.length > 0"[\s\S]*?v-model="timelineOrder"/)
  assert.match(source, /sessionTimelineOrder/)
  assert.doesNotMatch(source, /\.sort\(/)
})
