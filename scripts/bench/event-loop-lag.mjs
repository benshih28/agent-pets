// Measures main-thread event loop lag while a history store ingests a
// realistic burst of hook events (500 events over 10 seconds, the event
// server's per-window ceiling). Run with `pnpm bench:lag`.
// `pnpm bench:lag:check`（--check）會再與 event-loop-lag.baseline.json 的門檻比對，超過即 exit 1。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const measured = { mean: ms(histogram.mean), p99: ms(histogram.percentile(99)), max: ms(histogram.max) }
console.log(JSON.stringify({ events: EVENTS, eventLoopDelayMs: measured }, null, 2))

if (process.argv.includes('--check')) {
  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'event-loop-lag.baseline.json')
  const { medians, thresholds } = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const failures = Object.entries(thresholds)
    .filter(([key, limit]) => Number(measured[key]) > limit)
    .map(([key, limit]) => `${key}: ${measured[key]}ms > threshold ${limit}ms (baseline median ${medians[key]}ms)`)
  if (failures.length > 0) {
    console.error(`Event loop lag regression:\n${failures.join('\n')}`)
    process.exit(1)
  }
  console.log('Event loop lag within baseline thresholds.')
}
