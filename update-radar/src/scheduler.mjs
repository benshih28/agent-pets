import { readFile } from 'node:fs/promises'
import { FEED_SCHEMA_VERSION, MAX_FEED_BYTES } from './config.mjs'

export const REFRESH_INTERVAL_MS = 60 * 60 * 1000
export const REFRESH_JITTER_MS = 5 * 60 * 1000
export const RETRY_DELAYS_MS = Object.freeze([
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
])
export const X_REFRESH_INTERVAL_MS = 10 * 60 * 1000
export const X_REFRESH_JITTER_MS = 60 * 1000
export const X_RETRY_DELAYS_MS = Object.freeze([2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000])

const MINIMUM_TIMER_MS = 1000

export function inspectFeedFreshness(feed, options = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? REFRESH_INTERVAL_MS
  if (feed?.schemaVersion !== FEED_SCHEMA_VERSION) return { due: true, reason: 'feed_invalid' }
  if (!Array.isArray(feed.sources) || feed.sources.length === 0) return { due: true, reason: 'sources_missing' }
  const requestedSourceIds = options.sourceIds ? new Set(options.sourceIds) : null
  const sources = requestedSourceIds
    ? feed.sources.filter(source => requestedSourceIds.has(source?.id))
    : feed.sources
  if (requestedSourceIds && sources.length !== requestedSourceIds.size) return { due: true, reason: 'sources_missing' }
  if (sources.some(source => !['ok', 'disabled'].includes(source?.status))) {
    return { due: true, reason: 'source_degraded' }
  }

  const sourceTimes = sources.map(source => Date.parse(source?.fetchedAt ?? feed.generatedAt))
  if (sourceTimes.some(timestamp => !Number.isFinite(timestamp))) {
    return { due: true, reason: 'generated_at_invalid' }
  }
  const ageMs = Math.max(0, nowMs - Math.min(...sourceTimes))
  if (ageMs >= maxAgeMs) return { due: true, reason: 'feed_expired', ageMs }
  return { due: false, reason: 'feed_fresh', ageMs, remainingMs: maxAgeMs - ageMs }
}

export async function readFeedFreshness(feedPath, options = {}) {
  try {
    const raw = await readFile(feedPath)
    if (raw.byteLength > MAX_FEED_BYTES) return { due: true, reason: 'feed_too_large' }
    return inspectFeedFreshness(JSON.parse(raw.toString('utf8')), options)
  } catch {
    return { due: true, reason: 'feed_unavailable' }
  }
}

function refreshJitter(options = {}) {
  const jitterMs = options.jitterMs ?? REFRESH_JITTER_MS
  const random = Math.min(1, Math.max(0, options.random?.() ?? Math.random()))
  return Math.round(((random * 2) - 1) * jitterMs)
}

export function regularRefreshDelay(options = {}) {
  const intervalMs = options.intervalMs ?? REFRESH_INTERVAL_MS
  return Math.max(MINIMUM_TIMER_MS, intervalMs + refreshJitter(options))
}

export function createFeedScheduler(options) {
  const collect = options.collect
  const feedPath = options.feedPath
  const intervalMs = options.intervalMs ?? REFRESH_INTERVAL_MS
  const jitterMs = options.jitterMs ?? REFRESH_JITTER_MS
  const retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS
  const healthSourceIds = options.healthSourceIds ? new Set(options.healthSourceIds) : null
  const readFreshness = options.readFreshness
    ?? (() => readFeedFreshness(feedPath, {
      nowMs: options.now?.() ?? Date.now(),
      maxAgeMs: intervalMs,
      sourceIds: healthSourceIds,
    }))
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const onEvent = options.onEvent ?? (() => {})
  const random = options.random ?? Math.random

  let timer = null
  let running = null
  let stopped = false
  let retryIndex = 0

  function schedule(delayMs, reason) {
    if (stopped) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void runCollection()
    }, delayMs)
    timer?.unref?.()
    onEvent({ type: 'scheduled', delayMs, reason })
  }

  function nextRetryDelay() {
    const index = Math.min(retryIndex, retryDelaysMs.length - 1)
    retryIndex += 1
    return retryDelaysMs[index]
  }

  async function runCollection() {
    if (stopped) return null
    if (running) return running

    running = (async () => {
      let delayMs
      let reason
      try {
        const feed = await collect()
        const relevantSources = Array.isArray(feed?.sources)
          ? healthSourceIds
            ? feed.sources.filter(source => healthSourceIds.has(source?.id))
            : feed.sources
          : []
        const degraded = relevantSources.length === 0
          || (healthSourceIds && relevantSources.length !== healthSourceIds.size)
          || relevantSources.some(source => !['ok', 'disabled'].includes(source?.status))
        if (degraded) {
          delayMs = nextRetryDelay()
          reason = 'source_degraded'
          onEvent({ type: 'degraded', feed })
        } else {
          retryIndex = 0
          delayMs = regularRefreshDelay({ intervalMs, jitterMs, random })
          reason = 'regular_refresh'
          onEvent({ type: 'collected', feed })
        }
        return feed
      } catch (error) {
        delayMs = nextRetryDelay()
        reason = 'collection_failed'
        onEvent({ type: 'error', error })
        return null
      } finally {
        running = null
        schedule(delayMs, reason)
      }
    })()

    return running
  }

  async function start() {
    stopped = false
    const freshness = await readFreshness()
    if (freshness.due) {
      onEvent({ type: 'due', reason: freshness.reason })
      return runCollection()
    }

    const delayMs = Math.max(
      MINIMUM_TIMER_MS,
      freshness.remainingMs + refreshJitter({
        jitterMs,
        random,
      }),
    )
    schedule(delayMs, 'feed_fresh')
    return null
  }

  function stop() {
    stopped = true
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  function runNow() {
    if (timer !== null) clearTimer(timer)
    timer = null
    return runCollection()
  }

  return { runNow, start, stop }
}
