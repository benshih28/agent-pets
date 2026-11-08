// Measures main-thread event loop lag while a history store ingests a
// realistic burst of hook events (500 events over 10 seconds, the event
// server's per-window ceiling). Run with `pnpm bench:lag`.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { HistoryStore } from '../../electron/history.ts'

const EVENTS = 500
const DURATION_MS = 10_000
const dir = mkdtempSync(join(tmpdir(), 'ap-lag-'))
const store = new HistoryStore(join(dir, 'history.sqlite'))
const histogram = monitorEventLoopDelay({ resolution: 5 })
histogram.enable()

const started = Date.now()
for (let index = 0; index < EVENTS; index += 1) {
  store.recordEvent({
    source: 'codex',
    sessionId: `session-${index % 8}`,
    state: index % 25 === 0 ? 'success' : 'tool-running',
    timestamp: started + index * (DURATION_MS / EVENTS),
    project: 'bench',
    projectId: 'bench-project',
  }, 'aang-airbender')
  await new Promise(resolve => setTimeout(resolve, DURATION_MS / EVENTS))
}
histogram.disable()
store.close()
rmSync(dir, { recursive: true, force: true })
const ms = value => (value / 1e6).toFixed(2)
console.log(JSON.stringify({
  events: EVENTS,
  eventLoopDelayMs: { mean: ms(histogram.mean), p99: ms(histogram.percentile(99)), max: ms(histogram.max) },
}, null, 2))
