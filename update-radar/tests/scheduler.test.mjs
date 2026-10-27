import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFeedScheduler,
  inspectFeedFreshness,
  regularRefreshDelay,
  X_REFRESH_INTERVAL_MS,
  X_REFRESH_JITTER_MS,
  X_RETRY_DELAYS_MS,
} from '../src/scheduler.mjs'

const hour = 60 * 60 * 1000
const minute = 60 * 1000

function healthyFeed(generatedAt = '2026-10-22T00:00:00.000Z') {
  return {
    schemaVersion: 1,
    generatedAt,
    sources: [{ id: 'openai-api', status: 'ok' }],
  }
}

test('freshness requires a valid recent feed with every source healthy', () => {
  const nowMs = Date.parse('2026-10-22T00:30:00.000Z')
  assert.deepEqual(
    inspectFeedFreshness(healthyFeed(), { nowMs, maxAgeMs: hour }),
    { due: false, reason: 'feed_fresh', ageMs: 30 * minute, remainingMs: 30 * minute },
  )
  assert.equal(inspectFeedFreshness(null, { nowMs }).reason, 'feed_invalid')
  assert.equal(inspectFeedFreshness({ ...healthyFeed(), generatedAt: 'invalid' }, { nowMs }).reason, 'generated_at_invalid')
  assert.equal(inspectFeedFreshness({ ...healthyFeed(), sources: [{ status: 'stale' }] }, { nowMs }).reason, 'source_degraded')
  assert.equal(inspectFeedFreshness(healthyFeed(), { nowMs: nowMs + hour }).reason, 'feed_expired')
})

test('source-specific freshness uses source fetchedAt and ignores disabled optional sources', () => {
  const nowMs = Date.parse('2026-10-22T02:00:00.000Z')
  const feed = {
    schemaVersion: 1,
    generatedAt: '2026-10-22T01:59:00.000Z',
    sources: [
      { id: 'openai-api', status: 'ok', fetchedAt: '2026-10-22T00:00:00.000Z' },
      { id: 'tibo-x', status: 'disabled', fetchedAt: '2026-10-22T01:59:00.000Z' },
    ],
  }
  assert.equal(inspectFeedFreshness(feed, { nowMs, maxAgeMs: hour, sourceIds: ['openai-api'] }).reason, 'feed_expired')
  assert.equal(inspectFeedFreshness(feed, { nowMs, maxAgeMs: hour, sourceIds: ['tibo-x'] }).reason, 'feed_fresh')
  assert.equal(inspectFeedFreshness(feed, { nowMs, sourceIds: ['missing'] }).reason, 'sources_missing')
})

test('regular refresh delay applies bounded jitter', () => {
  assert.equal(regularRefreshDelay({ intervalMs: hour, jitterMs: 5 * minute, random: () => 0 }), 55 * minute)
  assert.equal(regularRefreshDelay({ intervalMs: hour, jitterMs: 5 * minute, random: () => 0.5 }), hour)
  assert.equal(regularRefreshDelay({ intervalMs: hour, jitterMs: 5 * minute, random: () => 1 }), 65 * minute)
})

test('Tibo public-page schedule uses the ten-minute low-load policy', () => {
  assert.equal(X_REFRESH_INTERVAL_MS, 10 * minute)
  assert.equal(X_REFRESH_JITTER_MS, minute)
  assert.deepEqual(X_RETRY_DELAYS_MS, [2 * minute, 5 * minute, 10 * minute])
})

test('fresh feed schedules its remaining lifetime without collecting immediately', async () => {
  const scheduled = []
  let collects = 0
  const scheduler = createFeedScheduler({
    feedPath: '/unused',
    collect: async () => {
      collects += 1
      return healthyFeed()
    },
    readFreshness: async () => ({ due: false, reason: 'feed_fresh', remainingMs: 25 * minute }),
    random: () => 0.5,
    setTimer: (callback, delayMs) => {
      scheduled.push({ callback, delayMs })
      return 1
    },
    clearTimer: () => {},
  })

  await scheduler.start()
  assert.equal(collects, 0)
  assert.equal(scheduled[0].delayMs, 25 * minute)
  scheduler.stop()
})

test('due feed collects once and degraded sources use progressive retry delays', async () => {
  const scheduled = []
  let collects = 0
  const scheduler = createFeedScheduler({
    feedPath: '/unused',
    collect: async () => {
      collects += 1
      return { ...healthyFeed(), sources: [{ id: 'openai-api', status: 'stale' }] }
    },
    readFreshness: async () => ({ due: true, reason: 'feed_expired' }),
    setTimer: (callback, delayMs) => {
      scheduled.push({ callback, delayMs })
      return scheduled.length
    },
    clearTimer: () => {},
  })

  await scheduler.start()
  assert.equal(collects, 1)
  assert.equal(scheduled.at(-1).delayMs, 15 * minute)

  await scheduler.runNow()
  assert.equal(collects, 2)
  assert.equal(scheduled.at(-1).delayMs, 30 * minute)
  scheduler.stop()
})

test('overlapping refresh requests share one collection', async () => {
  let resolveCollection
  let collects = 0
  const collection = new Promise(resolve => { resolveCollection = resolve })
  const scheduler = createFeedScheduler({
    feedPath: '/unused',
    collect: async () => {
      collects += 1
      return collection
    },
    readFreshness: async () => ({ due: true, reason: 'feed_expired' }),
    random: () => 0.5,
    setTimer: () => 1,
    clearTimer: () => {},
  })

  const startPromise = scheduler.start()
  await Promise.resolve()
  const concurrentPromise = scheduler.runNow()
  resolveCollection(healthyFeed())
  await Promise.all([startPromise, concurrentPromise])
  assert.equal(collects, 1)
  scheduler.stop()
})
