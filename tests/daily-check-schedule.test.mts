import assert from 'node:assert/strict'
import test from 'node:test'
import { DailyCheckSchedule } from '../electron/daily-check-schedule.ts'
import { PluginCatalogAutoCheckSchedule } from '../electron/plugin-catalog-updates.ts'

const DAY = Date.UTC(2026, 10, 11, 8)

function harness(overrides: Partial<ConstructorParameters<typeof DailyCheckSchedule<string>>[0]> = {}) {
  let enabled = true
  let lastDay: string | null = null
  const calls = { check: 0, notify: [] as string[] }
  let now = DAY
  const schedule = new DailyCheckSchedule<string>({
    isEnabled: () => enabled,
    getLastCheckedDay: () => lastDay,
    setLastCheckedDay: day => { lastDay = day },
    check: async () => { calls.check += 1; return 'result' },
    notify: result => calls.notify.push(result),
    now: () => now,
    ...overrides,
  })
  return { schedule, calls, setEnabled: (value: boolean) => { enabled = value }, setNow: (value: number) => { now = value }, lastDay: () => lastDay }
}

test('does nothing and never checks while disabled', async () => {
  const h = harness()
  h.setEnabled(false)
  assert.equal(await h.schedule.checkIfDue(), 'disabled')
  assert.equal(h.calls.check, 0)
  assert.equal(h.lastDay(), null)
})

test('checks once per UTC day and wakes again on the next day', async () => {
  const h = harness()
  assert.equal(await h.schedule.checkIfDue(), 'checked')
  assert.equal(await h.schedule.checkIfDue(), 'already-checked')
  assert.equal(h.calls.check, 1)
  h.setNow(DAY + 24 * 3_600_000)
  assert.equal(await h.schedule.checkIfDue(), 'checked')
  assert.equal(h.calls.check, 2)
  assert.deepEqual(h.calls.notify, ['result', 'result'])
})

test('rejects re-entrant runs and records the day before checking so failures do not retry the same day', async () => {
  let release!: () => void
  let started = 0
  const h = harness({ check: () => { started += 1; return new Promise<string>(resolve => { release = () => resolve('late') }) } })
  const first = h.schedule.checkIfDue()
  assert.equal(await h.schedule.checkIfDue(), 'already-running')
  release()
  assert.equal(await first, 'checked')
  assert.equal(started, 1)

  const failing = harness({ check: async () => { throw new Error('offline') } })
  assert.equal(await failing.schedule.checkIfDue(), 'failed')
  assert.equal(failing.lastDay(), '2026-11-11')
  assert.equal(await failing.schedule.checkIfDue(), 'already-checked')
})

test('invalid results and non-finite clocks are failures without notifying', async () => {
  const invalid = harness({ isValidResult: () => false })
  assert.equal(await invalid.schedule.checkIfDue(), 'failed')
  assert.deepEqual(invalid.calls.notify, [])
  const clock = harness()
  clock.setNow(Number.NaN)
  assert.equal(await clock.schedule.checkIfDue(), 'failed')
  assert.equal(clock.calls.check, 0)
})

test('the plugin catalog schedule keeps its count bounds on top of the shared rules', async () => {
  for (const [count, expected] of [[0, 'checked'], [500, 'checked'], [501, 'failed'], [-1, 'failed'], [1.5, 'failed']] as const) {
    const notified: number[] = []
    let day: string | null = null
    const schedule = new PluginCatalogAutoCheckSchedule({
      isEnabled: () => true, getLastCheckedDay: () => day, setLastCheckedDay: value => { day = value },
      check: async () => count, notify: value => notified.push(value), now: () => DAY,
    })
    assert.equal(await schedule.checkIfDue(), expected, String(count))
    assert.equal(notified.length, expected === 'checked' ? 1 : 0)
  }
})
