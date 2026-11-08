import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canRunAutonomousBehavior,
  chooseAutonomousBehavior,
  ShimejiScheduler,
  SHIMEJI_IDLE_DELAY_MS,
  SHIMEJI_SLEEP_AFTER_MS,
  SHIMEJI_WALK_STEP_PX,
} from '../electron/shimeji-behavior.ts'
import { parsePetBehaviorManifest } from '../electron/pet-behavior-manifest.ts'

function context(overrides: Partial<Parameters<typeof canRunAutonomousBehavior>[0]> = {}) {
  return {
    enabled: true,
    reactionsEnabled: true,
    dndEnabled: false,
    reducedMotion: false,
    powerSave: false,
    documentVisible: true,
    isDragging: false,
    windowMode: 'normal' as const,
    currentState: 'offline',
    activeSessionCount: 0,
    pendingPermission: false,
    canWalk: true,
    canSleep: true,
    idleMs: 0,
    ...overrides,
  }
}

test('authoritative agent state and window modes preempt autonomous behavior', () => {
  assert.equal(canRunAutonomousBehavior(context({ currentState: 'thinking', activeSessionCount: 1 })), false)
  assert.equal(chooseAutonomousBehavior(context({ pendingPermission: true, random: 0.1 })), 'idle')
  assert.equal(chooseAutonomousBehavior(context({ dndEnabled: true, random: 0.1 })), 'idle')
  assert.equal(chooseAutonomousBehavior(context({ windowMode: 'edge', random: 0.1 })), 'idle')
  assert.equal(chooseAutonomousBehavior(context({ isDragging: true, random: 0.1 })), 'idle')
})

test('idle policy selects walk and sleep deterministically with safe thresholds', () => {
  assert.equal(chooseAutonomousBehavior(context({ random: 0.4 })), 'walk')
  assert.equal(chooseAutonomousBehavior(context({ canWalk: false, random: 0.4 })), 'idle')
  assert.equal(
    chooseAutonomousBehavior(context({ idleMs: SHIMEJI_SLEEP_AFTER_MS, random: 0.1 })),
    'sleep',
  )
  assert.equal(
    chooseAutonomousBehavior(context({ idleMs: SHIMEJI_SLEEP_AFTER_MS, canSleep: false, canWalk: false, random: 0.1 })),
    'idle',
  )
})

test('scheduler bounds walking cadence and clears a walk on preemption', () => {
  const scheduler = new ShimejiScheduler()
  const idle = context({ random: 0.4 })
  const first = scheduler.next(idle)
  assert.equal(first.behavior, 'walk')
  assert.equal(Math.abs(first.walkDeltaX ?? 0), SHIMEJI_WALK_STEP_PX)
  assert.ok(first.delayMs >= 1_500)

  const interrupted = scheduler.next(context({ currentState: 'waiting-input', activeSessionCount: 1 }))
  assert.deepEqual(interrupted, { behavior: 'idle', delayMs: SHIMEJI_IDLE_DELAY_MS })
  const resumed = scheduler.next(idle)
  assert.equal(resumed.behavior, 'walk')
})

test('behavior manifest accepts only bounded rows and frame timings', () => {
  assert.deepEqual(
    parsePetBehaviorManifest({
      walk: { row: 1, frames: 8, frameDurations: [100, 2_000] },
      sleep: { row: 5 },
      ignored: { row: 1 },
    }),
    { walk: { row: 1, frames: 8, frameDurations: [100, 2_000] }, sleep: { row: 5 } },
  )
  assert.equal(parsePetBehaviorManifest({ walk: { row: 99 } }), undefined)
  assert.equal(parsePetBehaviorManifest({ sleep: { row: 1, frames: 0 } }), undefined)
})

test('sleep persists across ticks until the scheduler is reset', () => {
  const scheduler = new ShimejiScheduler()
  const sleepy = context({ idleMs: SHIMEJI_SLEEP_AFTER_MS, random: 0.1 })
  assert.equal(scheduler.next(sleepy).behavior, 'sleep')
  assert.equal(scheduler.isSleeping, true)
  // A roll that would normally walk still keeps sleeping.
  assert.equal(scheduler.next({ ...sleepy, random: 0.5 }).behavior, 'sleep')
  scheduler.reset()
  assert.equal(scheduler.isSleeping, false)
  assert.equal(scheduler.next(context({ random: 0.5 })).behavior, 'walk')
})

test('idle pauses vary between 8 and 25 seconds', () => {
  const scheduler = new ShimejiScheduler()
  const short = scheduler.next(context({ canWalk: false, random: 0 })).delayMs
  const long = scheduler.next(context({ canWalk: false, random: 0.999 })).delayMs
  assert.equal(short, 8_000)
  assert.ok(long > 24_000 && long <= 25_000)
})
