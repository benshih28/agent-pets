import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'

import { LocalUsageReader } from '../../electron/local-usage.ts'
import { HistoryStore } from '../../electron/history.ts'
import { PluginBadgeController } from '../../electron/plugin-badges.ts'
import { PluginCommandController } from '../../electron/plugin-commands.ts'
import { PluginEventSourceController } from '../../electron/plugin-event-source.ts'
import { PluginFeedController } from '../../electron/plugin-feed.ts'
import { PluginNetworkClient } from '../../electron/plugin-net.ts'
import { selectBubble } from '../../src/utils/feed-arbiter.ts'
import { createOrderedBatchCoalescer } from '../../electron/ipc/broadcast-coalescer.ts'
import { AgentSessionIndex } from '../../src/utils/agent-session-index.ts'

const ROOT = new URL('../../', import.meta.url)
const REPEATS = 30
const WORKLOAD = 10_000
const PLUGIN_ID = 'benchmark-plugin'
const NAME = { 'zh-TW': '基準插件', 'en-US': 'Benchmark plugin' }
const HISTORY_NOW = Date.UTC(2026, 9, 26, 12)

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

async function measure(name, operation, repeats = REPEATS) {
  for (let index = 0; index < 3; index += 1) await operation()
  const values = []
  for (let index = 0; index < repeats; index += 1) {
    const start = performance.now()
    await operation()
    values.push(performance.now() - start)
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
  return { name, repeats, medianMs: Number(median.toFixed(3)), p95Ms: Number(percentile(values, 0.95).toFixed(3)) }
}

function emptyHistoryStub() {
  return {
    getLocalUsageCutoff: () => 0,
    getRetentionDays: () => 90,
    batch: callback => callback(),
    recordTokenUsage: () => false,
  }
}

function makeLocalUsageCorpus(directory) {
  const home = join(directory, 'home')
  const sessions = join(home, '.claude', 'projects')
  mkdirSync(sessions, { recursive: true })
  const random = seededRandom(18_001)
  const lines = []
  let totalBytes = 0
  while (totalBytes < 4 * 1024 * 1024) {
    const payload = Math.floor(random() * 0x1_0000_0000).toString(16).padStart(8, '0')
    const line = `${JSON.stringify({ type: 'user', message: payload.repeat(110), seq: lines.length })}\n`
    lines.push(line)
    totalBytes += Buffer.byteLength(line)
  }
  const base = Buffer.from(lines.join(''), 'utf8').subarray(0, 4 * 1024 * 1024)
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(sessions, `${String(index).padStart(2, '0')}.jsonl`), base)
  }
  const appendLine = Buffer.from(`${JSON.stringify({ type: 'user', message: 'q'.repeat(900) })}\n`, 'utf8')
  const appendChunk = Buffer.concat(Array.from({ length: Math.ceil((1024 * 1024) / appendLine.length) }, () => appendLine))
    .subarray(0, 1024 * 1024)
  return { home, firstFile: join(sessions, '00.jsonl'), base: Buffer.from(base), appendChunk }
}

function newLocalUsageReader(home) {
  return new LocalUsageReader({ homeDir: home, history: emptyHistoryStub(), now: () => HISTORY_NOW })
}

function makeAgentEvents() {
  const random = seededRandom(18_002)
  const states = ['thinking', 'tool-running', 'success', 'idle', 'error']
  return Array.from({ length: WORKLOAD }, (_, index) => {
    const sessionIndex = Math.floor(random() * 1_000)
    return {
      source: sessionIndex % 2 === 0 ? 'codex' : 'claude',
      sessionId: `session-${sessionIndex.toString().padStart(4, '0')}`,
      state: states[Math.floor(random() * states.length)],
      timestamp: HISTORY_NOW + index,
    }
  })
}

function runLegacyAgentState(events) {
  const sessions = Object.create(null)
  for (const event of events) {
    const key = `${event.source}:${event.sessionId}`
    const current = sessions[key]
    if (current) {
      current.state = event.state
      current.lastSeenAt = event.timestamp
      continue
    }
    const allSessions = Object.values(sessions)
    if (allSessions.length >= 1_000) {
      let candidate = allSessions[0]
      for (const session of allSessions) {
        const offlineDelta = Number(session.state !== 'offline') - Number(candidate.state !== 'offline')
        if (offlineDelta < 0 || (offlineDelta === 0 && session.lastSeenAt < candidate.lastSeenAt)) candidate = session
      }
      if (candidate) delete sessions[candidate.key]
    }
    sessions[key] = { key, state: event.state, lastSeenAt: event.timestamp }
  }
  return Object.values(sessions).filter(session => session.state !== 'offline').length
}

function runIndexedAgentState(events) {
  const sessions = new Map()
  const index = new AgentSessionIndex(sessions)
  for (const event of events) {
    const key = `${event.source}:${event.sessionId}`
    const current = index.get(key)
    if (current) {
      current.state = event.state
      current.lastSeenAt = event.timestamp
      index.updatePriority(key, event.state, event.timestamp)
      continue
    }
    index.upsert({
      key,
      source: event.source,
      sessionId: event.sessionId,
      state: event.state,
      lastSeenAt: event.timestamp,
    }, 1_000)
  }
  return [...index.values()].filter(session => session.state !== 'offline').length
}

function makeFeedController(nowRef, idRef) {
  return new PluginFeedController({
    emit: () => {},
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled: false }),
    getPluginState: () => ({ enabled: true, muted: false, name: NAME }),
    isLinkHostAllowed: () => true,
    now: () => nowRef.value,
    createId: () => `feed-${String(idRef.value++).padStart(8, '0')}`,
  })
}

function benchmarkFeedQueue() {
  const now = { value: HISTORY_NOW }
  const id = { value: 0 }
  const controller = makeFeedController(now, id)
  for (let index = 0; index < WORKLOAD; index += 1) {
    now.value += 600_001
    const result = controller.submit(PLUGIN_ID, {
      title: 'Queue item',
      body: `Notification ${index}`,
      priority: index % 5 === 0 ? 'low' : 'normal',
    })
    if (result.accepted) controller.complete(result.itemId)
  }
  return controller.getQueueDepth()
}

function benchmarkBadges() {
  let now = HISTORY_NOW
  const controller = new PluginBadgeController({
    getContext: () => ({ enabled: true, pluginsEnabled: true, contributesBadge: true, pluginName: NAME, targetPetId: null }),
    now: () => now,
  })
  for (let index = 0; index < WORKLOAD; index += 1) {
    now += 1_000
    controller.set(PLUGIN_ID, { text: String(index), tone: 'info' })
  }
  return controller.list().length
}

function benchmarkCommands() {
  let now = HISTORY_NOW
  let dispatched = 0
  const controller = new PluginCommandController({
    getContext: () => ({ enabled: true, pluginsEnabled: true, commandIds: ['open'] }),
    dispatch: () => { dispatched += 1; return true },
    now: () => now,
  })
  for (let index = 0; index < WORKLOAD; index += 1) {
    now += 1_000
    controller.invoke(PLUGIN_ID, 'open')
  }
  return dispatched
}

function benchmarkBroadcastDirect() {
  let sends = 0
  for (let index = 0; index < WORKLOAD; index += 1) sends += 1
  return sends
}

function benchmarkBroadcastCoalesced() {
  const scheduled = []
  let sends = 0
  let delivered = 0
  const enqueue = createOrderedBatchCoalescer(events => {
    sends += 1
    delivered += events.length
  }, callback => scheduled.push(callback))
  for (let index = 0; index < WORKLOAD; index += 1) enqueue(index)
  while (scheduled.length > 0) scheduled.shift()()
  if (delivered !== WORKLOAD) throw new Error('Broadcast batch dropped events')
  return sends
}

function benchmarkBroadcastCounts() {
  const directSends = benchmarkBroadcastDirect()
  const scheduled = []
  let coalescedSends = 0
  let deliveredEvents = 0
  const enqueue = createOrderedBatchCoalescer(events => {
    coalescedSends += 1
    deliveredEvents += events.length
  }, callback => scheduled.push(callback))
  for (let index = 0; index < WORKLOAD; index += 1) enqueue(index)
  while (scheduled.length > 0) scheduled.shift()()
  return { directSends, coalescedSends, deliveredEvents }
}

function benchmarkEventSource() {
  let now = HISTORY_NOW
  const controller = new PluginEventSourceController({
    getContext: () => ({ enabled: true, pluginsEnabled: true, pluginName: NAME, family: 'benchmark', displayName: NAME }),
    onChanged: () => {},
    now: () => now,
    wallNow: () => now,
    schedule: () => 0,
    cancel: () => {},
  })
  for (let index = 0; index < WORKLOAD; index += 1) {
    controller.emit(PLUGIN_ID, { sessionId: `session-${index}`, state: 'thinking' })
  }
  const result = controller.list().length
  controller.destroy()
  return result
}

function benchmarkFeedLimiter() {
  const controller = makeFeedController({ value: HISTORY_NOW }, { value: 0 })
  let allowed = 0
  for (let index = 0; index < WORKLOAD; index += 1) {
    if (controller.consumeRateLimit(PLUGIN_ID).allowed) allowed += 1
  }
  return allowed
}

async function benchmarkNetLimiter() {
  const client = new PluginNetworkClient({
    lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    now: () => HISTORY_NOW,
  })
  let limited = 0
  for (let index = 0; index < WORKLOAD; index += 1) {
    const result = await client.fetch(PLUGIN_ID, 'https://example.com/', undefined, ['example.com'], {
      maxResponseBytes: 1_024,
      timeoutMs: 1_000,
      requestsPerMinute: 30,
    })
    if (!result.ok && result.error === 'rate_limited') limited += 1
  }
  return limited
}

function historyDates() {
  return Array.from({ length: 7 }, (_, index) => `2026-10-${String(20 + index).padStart(2, '0')}`)
}

function seedHistoryStore(directory) {
  const store = new HistoryStore(join(directory, 'history.sqlite'), {
    now: () => HISTORY_NOW,
    localDate: timestamp => new Date(timestamp).toISOString().slice(0, 10),
  })
  const database = store.database
  const insertEvent = database.prepare(`
    INSERT INTO events(event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
      session_id, project_id, pet_id, local_date, occurred_at, received_at, state, active_delta_ms,
      completion_kind, token_input, token_output, token_quality, payload_json)
    VALUES (?, NULL, 2, 'agent.status', 'adapter_verified', 'codex', 'codex', ?, ?, 'aang-airbender',
      ?, ?, ?, 'success', 1000, 'success', 10, 5, 'exact', '{}')
  `)
  const insertStat = database.prepare(`
    INSERT INTO daily_stats(local_date, sessions_completed, sessions_failed, active_ms, token_input,
      token_output, token_quality, pet_id, project_id, adapter_id)
    VALUES (?, 1, 0, 1000, 10, 5, 'exact', 'aang-airbender', ?, 'codex')
  `)
  database.exec('BEGIN')
  const dates = historyDates()
  let firstProject = ''
  try {
    for (let index = 0; index < 100_000; index += 1) {
      const projectId = index.toString(16).padStart(32, '0')
      if (index === 0) firstProject = projectId
      const localDate = dates[index % dates.length]
      const occurredAt = HISTORY_NOW - (index % (7 * 24)) * 60 * 60 * 1_000
      insertEvent.run(`event-${String(index).padStart(6, '0')}`, `session-${index}`, projectId, localDate, occurredAt, occurredAt)
      insertStat.run(localDate, projectId)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    store.close()
    throw error
  }
  return { store, firstProject }
}

function getHistoryPlan(store, projectId) {
  const dates = historyDates()
  const placeholders = dates.map(() => '?').join(', ')
  const plan = sql => store.database.prepare(`EXPLAIN QUERY PLAN ${sql}`)
  const allProjects = plan(`
    SELECT local_date, sessions_completed, sessions_failed, active_ms, token_input, token_output, token_quality
    FROM daily_stats WHERE (pet_id = ? OR pet_id = ?) AND local_date IN (${placeholders})
  `).all('aang-airbender', 'local-usage', ...dates).map(row => String(row.detail ?? ''))
  const selectedProject = plan(`
    SELECT local_date, sessions_completed, sessions_failed, active_ms, token_input, token_output, token_quality
    FROM daily_stats WHERE (pet_id = ? OR pet_id = ?) AND project_id = ? AND local_date IN (${placeholders})
  `).all('aang-airbender', 'local-usage', projectId, ...dates).map(row => String(row.detail ?? ''))
  return { sevenDay: allProjects, selectedProject }
}

async function readCounters(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const target = targets.find(item => item.type === 'node')
  if (!target) return null
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const response = await new Promise(resolve => {
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id === 1) resolve(message)
    }
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'JSON.stringify({calls:globalThis.__agentPetsE2E.calls,blockedExecs:globalThis.__agentPetsE2E.blockedExecs.length})', returnByValue: true },
    }))
  })
  socket.close()
  const value = response.result?.result?.value
  return typeof value === 'string' ? JSON.parse(value) : null
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (resolve) { pending.delete(message.id); resolve(message) }
  }
  return {
    socket,
    send(method, params = {}) {
      return new Promise(resolve => {
        const id = ++sequence
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

async function cdpValue(client, expression, awaitPromise = false) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result?.result?.value
}

async function measurePanelSettingsFirstOpen(debugPort) {
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json())
  const pageTarget = targets.find(target => target.type === 'page' && target.url.endsWith('#panel'))
  if (!pageTarget) throw new Error('Settings benchmark panel target is unavailable')
  const page = await connectCdp(pageTarget.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Network.enable')
  await page.send('Network.setCacheDisabled', { cacheDisabled: true })
  const samples = []
  try {
    for (let index = 0; index < REPEATS; index += 1) {
      await page.send('Page.reload', { ignoreCache: true })
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        try {
          const ready = await cdpValue(page, `document.readyState === 'complete' && Boolean(document.querySelector('button[aria-label="設定"]'))`)
          if (ready) break
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      const elapsed = await cdpValue(page, `(() => {
        const start = performance.now()
        const button = document.querySelector('button[aria-label="設定"]')
        if (!button) throw new Error('Settings trigger did not load')
        button.click()
        return new Promise((resolve, reject) => {
          const deadline = performance.now() + 8_000
          const check = () => {
            if (document.querySelector('.settings-layout .scale-options')) {
              observer.disconnect()
              resolve(performance.now() - start)
            } else if (performance.now() > deadline) {
              observer.disconnect()
              reject(new Error('Settings first render timed out'))
            } else requestAnimationFrame(check)
          }
          const observer = new MutationObserver(check)
          observer.observe(document.body, { childList: true, subtree: true })
          check()
        })
      })()`, true)
      samples.push(Number(elapsed.toFixed(3)))
    }
  } finally {
    await page.send('Network.setCacheDisabled', { cacheDisabled: false })
    page.socket.close()
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return {
    name: 'settingsFirstOpen',
    repeats: samples.length,
    medianMs: Number(median.toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    samplesMs: samples,
  }
}

function waitForChildClose(child, timeoutMs = 8_000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('close', onClose)
      resolve(null)
    }, timeoutMs)
    const onClose = code => {
      clearTimeout(timer)
      resolve(code)
    }
    child.once('close', onClose)
  })
}

async function coldStartSample(index) {
  const inspectPort = 29_100 + index
  const debugPort = 29_200 + index
  const script = new URL('../e2e-isolated-electron.mjs', import.meta.url)
  const child = spawn(process.execPath, [script.pathname, '--inspect-port', String(inspectPort), '--debug-port', String(debugPort)], {
    cwd: ROOT.pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let readyResolve
  let readyReject
  let readySettled = false
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const onData = chunk => {
    output += chunk.toString()
    if (output.includes('AGENT_PETS_E2E_READY')) {
      readySettled = true
      readyResolve()
    }
    if (/AGENT_PETS_E2E_ABORT|not found; run/.test(output)) readyReject(new Error('Isolated Electron did not become ready'))
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.once('exit', (code, signal) => {
    if (!readySettled) {
      readySettled = true
      readyReject(new Error(`Isolated Electron launcher exited before READY (code=${code ?? 'null'}, signal=${signal ?? 'none'})`))
    }
  })
  const start = performance.now()
  let startCounters = null
  let endCounters = null
  let readyTimeout = null
  try {
    await Promise.race([ready, new Promise((_, reject) => { readyTimeout = setTimeout(() => reject(new Error('Isolated Electron READY timeout')), 30_000) })])
    startCounters = await readCounters(inspectPort)
    const deadline = Date.now() + 30_000
    let pageLoaded = false
    while (Date.now() < deadline) {
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json())
        const page = targets.find(target => target.type === 'page' && target.url === 'agent-pets://app/index.html')
        if (page) {
          const socket = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
          const response = await new Promise(resolve => {
            socket.onmessage = event => {
              const message = JSON.parse(event.data)
              if (message.id === 1) resolve(message)
            }
            socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.readyState', returnByValue: true } }))
          })
          socket.close()
          if (response.result?.result?.value === 'complete') { pageLoaded = true; break }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!pageLoaded) throw new Error('First isolated Electron window did not finish loading')
    const coldStartMs = Number((performance.now() - start).toFixed(3))
    const settingsFirstOpen = await measurePanelSettingsFirstOpen(debugPort)
    endCounters = await readCounters(inspectPort)
    return { ms: coldStartMs, settingsFirstOpen, callsStart: startCounters?.calls, callsEnd: endCounters?.calls, blockedStart: startCounters?.blockedExecs, blockedEnd: endCounters?.blockedExecs }
  } finally {
    if (readyTimeout) clearTimeout(readyTimeout)
    child.kill('SIGINT')
    if (await waitForChildClose(child) === null) {
      child.kill('SIGTERM')
      await waitForChildClose(child, 2_000)
    }
  }
}

async function main() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'agent-pets-phase18-bench-'))
  const results = {}
  try {
    const corpus = makeLocalUsageCorpus(temporaryRoot)
    results.localUsageFirstScan = await measure('localUsageFirstScan', async () => {
      await newLocalUsageReader(corpus.home).scan()
    })
    const incrementalSamples = []
    for (let index = 0; index < REPEATS; index += 1) {
      writeFileSync(corpus.firstFile, corpus.base)
      const reader = newLocalUsageReader(corpus.home)
      await reader.scan()
      appendFileSync(corpus.firstFile, corpus.appendChunk)
      const start = performance.now()
      await reader.scan()
      incrementalSamples.push(performance.now() - start)
    }
    const sortedIncremental = [...incrementalSamples].sort((left, right) => left - right)
    const middleIncremental = Math.floor(sortedIncremental.length / 2)
    const incrementalMedian = sortedIncremental.length % 2 === 0
      ? (sortedIncremental[middleIncremental - 1] + sortedIncremental[middleIncremental]) / 2
      : sortedIncremental[middleIncremental]
    results.localUsageAppend1MB = {
      name: 'localUsageAppend1MB', repeats: REPEATS,
      medianMs: Number(incrementalMedian.toFixed(3)),
      p95Ms: Number(percentile(incrementalSamples, 0.95).toFixed(3)),
    }

    const events = makeAgentEvents()
    results.agentState10kLegacy = await measure('agentState10kLegacy', () => runLegacyAgentState(events))
    results.agentState10kIndexed = await measure('agentState10kIndexed', () => runIndexedAgentState(events))
    if (runLegacyAgentState(events) !== runIndexedAgentState(events)) {
      throw new Error('Indexed Agent state processing diverged from the legacy result')
    }
    const candidates = Array.from({ length: WORKLOAD }, (_, index) => ({
      presentationSay: index % 17 === 0,
      agentToast: index % 19 === 0,
      activity: index % 3 === 0,
      pluginFeed: { priority: index % 2 === 0 ? 'normal' : 'low', controls: { pluginsEnabled: true, enabled: true, muted: false, dnd: false, visible: true } },
    }))
    results.bubbleArbiter10k = await measure('bubbleArbiter10k', () => {
      let selected = 0
      for (const candidate of candidates) if (selectBubble(candidate)) selected += 1
      return selected
    })
    results.pluginFeedQueue10k = await measure('pluginFeedQueue10k', benchmarkFeedQueue)

    results.netLimiter10k = await measure('netLimiter10k', benchmarkNetLimiter)
    results.feedLimiter10k = await measure('feedLimiter10k', benchmarkFeedLimiter)
    results.badgeLimiter10k = await measure('badgeLimiter10k', benchmarkBadges)
    results.eventSourceLimiter10k = await measure('eventSourceLimiter10k', benchmarkEventSource)
    results.commandLimiter10k = await measure('commandLimiter10k', benchmarkCommands)
    results.broadcastDirect10k = await measure('broadcastDirect10k', benchmarkBroadcastDirect)
    results.broadcastCoalesced10k = await measure('broadcastCoalesced10k', benchmarkBroadcastCoalesced)
    results.broadcastMessageCounts = benchmarkBroadcastCounts()

    const userFilePath = join(temporaryRoot, 'bounded-user-file.jsonl')
    writeFileSync(userFilePath, Buffer.alloc(1024 * 1024, 0x61))
    results.userFileReadSync1MB = await measure('userFileReadSync1MB', () => readFileSync(userFilePath).byteLength)
    results.userFileReadAsync1MB = await measure('userFileReadAsync1MB', async () => (await readFile(userFilePath)).byteLength)

    const { store, firstProject } = seedHistoryStore(temporaryRoot)
    results.historySevenDay100k = await measure('historySevenDay100k', () => store.getSummary())
    results.historyProject100k = await measure('historyProject100k', () => store.getSummary('aang-airbender', firstProject))
    results.historyExplain = getHistoryPlan(store, firstProject)
    store.close()

    results.coldStart = []
    try {
      for (let index = 0; index < 5; index += 1) results.coldStart.push(await coldStartSample(index))
    } catch (error) {
      results.coldStartError = error instanceof Error ? error.message : 'Isolated Electron cold start failed'
    }

    const coldStartSamples = results.coldStart.map(sample => sample.ms)
    const sortedColdStarts = [...coldStartSamples].sort((left, right) => left - right)
    const coldStartMiddle = Math.floor(sortedColdStarts.length / 2)
    results.coldStartSummary = coldStartSamples.length === 0 ? null : {
      repeats: coldStartSamples.length,
      medianMs: Number((sortedColdStarts.length % 2 === 0
        ? (sortedColdStarts[coldStartMiddle - 1] + sortedColdStarts[coldStartMiddle]) / 2
        : sortedColdStarts[coldStartMiddle]).toFixed(3)),
      p95Ms: Number(percentile(coldStartSamples, 0.95).toFixed(3)),
    }
    const settingsFirstOpenSamples = results.coldStart.flatMap(sample => sample.settingsFirstOpen?.samplesMs ?? [])
    const sortedSettingsFirstOpen = [...settingsFirstOpenSamples].sort((left, right) => left - right)
    const settingsFirstOpenMiddle = Math.floor(sortedSettingsFirstOpen.length / 2)
    results.settingsFirstOpenSummary = settingsFirstOpenSamples.length === 0 ? null : {
      repeats: settingsFirstOpenSamples.length,
      medianMs: Number((sortedSettingsFirstOpen.length % 2 === 0
        ? (sortedSettingsFirstOpen[settingsFirstOpenMiddle - 1] + sortedSettingsFirstOpen[settingsFirstOpenMiddle]) / 2
        : sortedSettingsFirstOpen[settingsFirstOpenMiddle]).toFixed(3)),
      p95Ms: Number(percentile(settingsFirstOpenSamples, 0.95).toFixed(3)),
    }

    const measureDirectory = directory => {
      let bytes = 0
      let files = 0
      const visit = current => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const path = join(current, entry.name)
          if (entry.isDirectory()) visit(path)
          else if (entry.isFile()) { bytes += statSync(path).size; files += 1 }
        }
      }
      visit(new URL(directory, ROOT).pathname)
      return { files, bytes }
    }
    results.bundleSizes = { renderer: measureDirectory('dist/'), main: measureDirectory('dist-electron/') }
    results.workload = { seedBase: 18_000, repetitions: REPEATS, localUsageFiles: 50, localUsageBytes: 200 * 1024 * 1024, agentSessions: 1_000, agentEvents: WORKLOAD, historyEvents: 100_000, callsPerLimiter: WORKLOAD }
    console.log(JSON.stringify(results, null, 2))
    if (results.coldStartError) process.exitCode = 1
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
