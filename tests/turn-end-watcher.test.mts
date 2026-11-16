import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentFamilyKey, AgentState, AgentStatusEvent } from '../src/types/agent.ts'
import { HistoryStore } from '../electron/history.ts'
import { SessionSnapshotStore, type SessionSnapshotEntry } from '../electron/main/session-snapshot.ts'
import { SESSION_REMOVE_MS } from '../src/utils/session-lifecycle.ts'
import type { TranscriptFingerprint, TranscriptProbe, TranscriptTurnEnd } from '../electron/transcript-turn-end.ts'
import {
  TURN_END_CLOCK_SKEW_MS,
  TURN_END_EVENT,
  TURN_END_QUIET_MS,
  createTurnEndWatcher,
} from '../electron/main/turn-end-watcher.ts'
import { removeTempTree } from './support/temp-dir.mts'

const MINUTE = 60_000
const START = 1_000_000

interface Harness {
  now: number
  sessions: SessionSnapshotEntry[]
  /** 每個檔案目前的內容版本與判讀結果。 */
  files: Map<string, { version: number, turnEnd: TranscriptTurnEnd | null }>
  located: string[]
  reads: string[]
  dispatched: AgentStatusEvent[]
  onProbe?: () => void
  watcher: ReturnType<typeof createTurnEndWatcher>
}

function harness(): Harness {
  const h: Harness = {
    now: START, sessions: [], files: new Map(), located: [], reads: [], dispatched: [],
    watcher: null as unknown as Harness['watcher'],
  }
  h.watcher = createTurnEndWatcher({
    now: () => h.now,
    sessions: () => h.sessions.map(entry => ({ ...entry })),
    session: (source, sessionId) => {
      const found = h.sessions.find(entry => entry.source === source && entry.sessionId === sessionId)
      return found ? { ...found } : undefined
    },
    configDir: family => `/config/${family}`,
    hasTranscript: family => family !== 'opencode',
    locate: async (family: AgentFamilyKey, configDir: string, sessionId: string) => {
      h.located.push(`${family}:${sessionId}`)
      const filePath = `${configDir}/${sessionId}.jsonl`
      return h.files.has(filePath) ? filePath : null
    },
    probe: async (_family: AgentFamilyKey, filePath: string, previous?: TranscriptFingerprint): Promise<TranscriptProbe | null> => {
      const file = h.files.get(filePath)
      if (!file) return null
      const fingerprint = { size: file.version, mtimeMs: file.version }
      if (previous && previous.size === fingerprint.size) return { fingerprint, turnEnd: 'unchanged' }
      h.reads.push(filePath)
      h.onProbe?.()
      return { fingerprint, turnEnd: file.turnEnd }
    },
    dispatch: event => { h.dispatched.push(event) },
  })
  return h
}

function session(source: SessionSnapshotEntry['source'], sessionId: string, state: AgentState, lastSeenAt: number, extra: Partial<SessionSnapshotEntry> = {}): SessionSnapshotEntry {
  return { source, sessionId, state, lastSeenAt, ...extra }
}

const interruptedAt = (endedAt: number): TranscriptTurnEnd => ({ endedAt, reason: 'interrupted' })

test('an interrupted turn becomes one idle event that carries the session routing', async () => {
  const h = harness()
  h.sessions = [session('claude-desktop', 'sess-0001', 'tool-running', START, {
    adapterId: 'claude-code',
    project: 'demo', projectId: 'p1', routedPetId: 'pet-1', host: { kind: 'desktop', app: 'claude-desktop', switchable: true },
  })]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 3_000) })
  h.now = START + TURN_END_QUIET_MS
  assert.equal(await h.watcher.check(), 1)
  assert.deepEqual(h.dispatched, [{
    adapterId: 'claude-code',
    source: 'claude-desktop', sessionId: 'sess-0001', state: 'idle', timestamp: h.now, originalEvent: TURN_END_EVENT,
    project: 'demo', projectId: 'p1', routedPetId: 'pet-1', host: { kind: 'desktop', app: 'claude-desktop', switchable: true },
  }])
})

test('every in-progress state and every agent with a transcript is covered the same way', async () => {
  const states: AgentState[] = ['thinking', 'tool-running', 'waiting-permission', 'waiting-input']
  for (const source of ['claude', 'claude-desktop', 'codex', 'codex-desktop'] as const) {
    for (const state of states) {
      const h = harness()
      const family = source.startsWith('claude') ? 'claude' : 'codex'
      h.sessions = [session(source, 'sess-0001', state, START)]
      h.files.set(`/config/${family}/sess-0001.jsonl`, { version: 1, turnEnd: interruptedAt(START + 1) })
      h.now = START + TURN_END_QUIET_MS
      assert.equal(await h.watcher.check(), 1, `${source} ${state}`)
    }
  }
})

test('sessions that are not in progress, too fresh, long gone, or without a transcript are left alone', async () => {
  const cases: Array<[string, SessionSnapshotEntry, number]> = [
    ['idle', session('claude', 'sess-0001', 'idle', START), TURN_END_QUIET_MS],
    ['success', session('claude', 'sess-0001', 'success', START), TURN_END_QUIET_MS],
    ['error', session('claude', 'sess-0001', 'error', START), TURN_END_QUIET_MS],
    ['an event just arrived', session('claude', 'sess-0001', 'thinking', START), TURN_END_QUIET_MS - 1],
    ['silent past the offline limit', session('claude', 'sess-0001', 'thinking', START), 15 * MINUTE + 1],
    ['opencode has no transcript', session('opencode-cli', 'sess-0001', 'thinking', START), TURN_END_QUIET_MS],
  ]
  for (const [name, entry, elapsed] of cases) {
    const h = harness()
    h.sessions = [entry]
    for (const family of ['claude', 'codex', 'opencode']) h.files.set(`/config/${family}/sess-0001.jsonl`, { version: 1, turnEnd: interruptedAt(START + 1) })
    h.now = START + elapsed
    assert.equal(await h.watcher.check(), 0, name)
    assert.deepEqual(h.reads, [], name)
    assert.deepEqual(h.located, [], name)
  }
})

test('an end record from an earlier turn never ends the current one', async () => {
  const h = harness()
  h.sessions = [session('codex', 'sess-0001', 'thinking', START)]
  h.files.set('/config/codex/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START - TURN_END_CLOCK_SKEW_MS - 1) })
  h.now = START + TURN_END_QUIET_MS
  assert.equal(await h.watcher.check(), 0)

  // hook 送達可能比 agent 寫檔晚一點：容許範圍內的仍然算這一回合。
  h.files.set('/config/codex/sess-0001.jsonl', { version: 2, turnEnd: { endedAt: START - TURN_END_CLOCK_SKEW_MS, reason: 'completed' } })
  assert.equal(await h.watcher.check(), 1)
})

test('a long quiet turn costs one read, and the end is picked up when the file changes', async () => {
  const h = harness()
  h.sessions = [session('claude', 'sess-0001', 'tool-running', START)]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: null })
  for (let tick = 0; tick < 60; tick += 1) {
    h.now = START + TURN_END_QUIET_MS + tick * 5_000
    assert.equal(await h.watcher.check(), 0)
  }
  // 十分鐘的 build 期間只讀一次、只找一次檔案。
  assert.equal(h.reads.length, 1)
  assert.equal(h.located.length, 1)

  h.files.set('/config/claude/sess-0001.jsonl', { version: 2, turnEnd: interruptedAt(h.now) })
  h.now += 5_000
  assert.equal(await h.watcher.check(), 1)
  assert.equal(h.reads.length, 2)
})

test('a hook event that arrives while the file is being read wins', async () => {
  const h = harness()
  h.sessions = [session('claude', 'sess-0001', 'thinking', START)]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.now = START + TURN_END_QUIET_MS
  h.onProbe = () => { h.sessions = [session('claude', 'sess-0001', 'thinking', h.now)] }
  assert.equal(await h.watcher.check(), 0)
  assert.deepEqual(h.dispatched, [])
})

test('a state change while the file is being read wins even when lastSeenAt is unchanged', async () => {
  const h = harness()
  h.sessions = [session('claude', 'sess-0001', 'thinking', START)]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.now = START + TURN_END_QUIET_MS
  h.onProbe = () => { h.sessions = [session('claude', 'sess-0001', 'tool-running', START)] }
  assert.equal(await h.watcher.check(), 0)
  assert.deepEqual(h.dispatched, [])
})

test('a session that disappears while the file is being read gets no idle event', async () => {
  const h = harness()
  h.sessions = [session('claude', 'sess-0001', 'thinking', START), session('claude', 'sess-0002', 'thinking', START)]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.files.set('/config/claude/sess-0002.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.now = START + TURN_END_QUIET_MS
  h.onProbe = () => { h.sessions = h.sessions.filter(entry => entry.sessionId !== 'sess-0001') }
  assert.equal(await h.watcher.check(), 1)
  assert.deepEqual(h.dispatched.map(event => event.sessionId), ['sess-0002'])
})

test('a missing transcript is looked for again later, and a failing read is contained', async () => {
  const h = harness()
  h.sessions = [session('codex', 'sess-0001', 'thinking', START)]
  h.now = START + TURN_END_QUIET_MS
  assert.equal(await h.watcher.check(), 0)
  h.now += 5_000
  assert.equal(await h.watcher.check(), 0)
  assert.equal(h.located.length, 1)

  h.files.set('/config/codex/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.now += 30_000
  assert.equal(await h.watcher.check(), 1)
  assert.equal(h.located.length, 2)

  const broken = createTurnEndWatcher({
    now: () => START + TURN_END_QUIET_MS,
    sessions: () => [session('claude', 'sess-0001', 'thinking', START), session('claude', 'sess-0002', 'thinking', START)],
    session: (source, sessionId) => session(source, sessionId, 'thinking', START),
    configDir: () => '/config',
    hasTranscript: () => true,
    locate: async (_family, _dir, sessionId) => {
      if (sessionId === 'sess-0001') throw new Error('disk error')
      return '/config/ok.jsonl'
    },
    probe: async () => ({ fingerprint: { size: 1, mtimeMs: 1 }, turnEnd: interruptedAt(START + 1) }),
    dispatch: event => { h.dispatched.push(event) },
  })
  h.dispatched.length = 0
  assert.equal(await broken.check(), 1)
  assert.equal(h.dispatched[0]?.sessionId, 'sess-0002')
})

test('overlapping checks do not run twice, and stop() ends the timer', async () => {
  const h = harness()
  h.sessions = [session('claude', 'sess-0001', 'thinking', START)]
  h.files.set('/config/claude/sess-0001.jsonl', { version: 1, turnEnd: interruptedAt(START + 1) })
  h.now = START + TURN_END_QUIET_MS
  const [first, second] = await Promise.all([h.watcher.check(), h.watcher.check()])
  assert.equal(first + second, 1)
  assert.equal(h.dispatched.length, 1)
  h.watcher.start()
  h.watcher.start()
  h.watcher.stop()
  h.watcher.stop()
})

test('the settled event lands in the same history session as the hook events', async (t) => {
  // 實測抓到的問題：補送的事件少了 adapterId，歷史把它記成備用 adapter 底下的另一筆 session。
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-turn-end-history-'))
  const history = new HistoryStore(path.join(directory, 'history.sqlite'), { now: () => START + 60_000 })
  t.after(() => { history.close(); removeTempTree(directory) })
  const snapshot = new SessionSnapshotStore(() => START + TURN_END_QUIET_MS)
  const dispatched: AgentStatusEvent[] = []
  const watcher = createTurnEndWatcher({
    now: () => START + TURN_END_QUIET_MS,
    sessions: () => snapshot.list(),
    session: (source, sessionId) => snapshot.get(source, sessionId),
    configDir: () => '/config',
    hasTranscript: () => true,
    locate: async () => '/config/session.jsonl',
    probe: async () => ({ fingerprint: { size: 1, mtimeMs: 1 }, turnEnd: interruptedAt(START + 1) }),
    dispatch: event => { dispatched.push(event) },
  })

  for (const [source, adapterId] of [['claude-desktop', 'claude-code'], ['codex', 'codex']] as const) {
    const hookEvent: AgentStatusEvent = {
      adapterId, source, sessionId: `sess-${adapterId}`, state: 'thinking', timestamp: START,
      project: 'demo', projectId: 'a'.repeat(24), originalEvent: 'UserPromptSubmit',
    }
    snapshot.record(hookEvent)
    history.recordEvent(hookEvent)
  }
  assert.equal(await watcher.check(), 2)
  for (const event of dispatched) history.recordEvent(event)

  const sessions = history.listSessions().items
  assert.equal(sessions.length, 2)
  assert.deepEqual(sessions.map(item => item.adapterId).sort(), ['claude-code', 'codex'])
  // 修正前這裡會是 4 筆：每個 session 多一筆 generic-http 的紀錄。
})

test('SessionSnapshotStore.get returns one isolated copy and uses the same expiry line as list()', () => {
  let now = START
  const snapshot = new SessionSnapshotStore(() => now)
  snapshot.record({
    source: 'claude-desktop', sessionId: 'sess-0001', state: 'thinking', timestamp: START, originalEvent: 'UserPromptSubmit',
    host: { kind: 'desktop', app: 'claude-desktop', switchable: true },
  })
  const first = snapshot.get('claude-desktop', 'sess-0001')
  assert.ok(first?.host)
  first.state = 'idle'
  ;(first.host as { app: string }).app = 'mutated'
  assert.deepEqual(snapshot.get('claude-desktop', 'sess-0001'), snapshot.list()[0])
  assert.equal(snapshot.get('claude-desktop', 'sess-0001')?.state, 'thinking')
  assert.equal(snapshot.get('claude-desktop', 'sess-0001')?.host?.app, 'claude-desktop')
  assert.equal(snapshot.get('claude', 'sess-0001'), undefined)

  // 剛好在過期線上兩邊都還看得到，超過一毫秒兩邊都看不到。
  now = START + SESSION_REMOVE_MS
  assert.ok(snapshot.get('claude-desktop', 'sess-0001'))
  assert.equal(snapshot.list().length, 1)
  now += 1
  assert.equal(snapshot.get('claude-desktop', 'sess-0001'), undefined)
  assert.equal(snapshot.list().length, 0)
})
