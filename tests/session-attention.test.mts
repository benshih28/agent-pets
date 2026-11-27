import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSession } from '../src/types/agent.ts'
import { compareAttention, mostUrgentSession, statusLineText, summarizeFamilies } from '../src/utils/session-attention.ts'

function session(key: string, overrides: Partial<AgentSession> = {}): AgentSession {
  const [source, sessionId] = key.split(':') as [AgentSession['source'], string]
  return { key, source, sessionId, state: 'thinking', lastSeenAt: 100, ...overrides }
}

test('attention order is priority, then most recent, then key, whatever the input order', () => {
  const sessions = [
    session('claude:b', { state: 'thinking', lastSeenAt: 900 }),
    session('claude:c', { state: 'waiting-permission', lastSeenAt: 100, project: 'old' }),
    session('claude:d', { state: 'waiting-permission', lastSeenAt: 500, project: 'new' }),
    session('claude:a', { state: 'waiting-permission', lastSeenAt: 500, project: 'tie' }),
  ]
  const expected = ['claude:a', 'claude:d', 'claude:c', 'claude:b']
  assert.deepEqual([...sessions].sort(compareAttention).map(s => s.key), expected)
  assert.deepEqual([...sessions].reverse().sort(compareAttention).map(s => s.key), expected)
  assert.equal(mostUrgentSession(sessions)?.key, 'claude:a')
  assert.equal(mostUrgentSession([...sessions].reverse())?.key, 'claude:a')
  assert.equal(mostUrgentSession([session('codex:x', { state: 'offline' })]), null)
})

test('two busy sessions keep a stable winner while their heartbeats alternate', () => {
  const a = session('claude:a', { state: 'thinking', firstSeenAt: 10, lastSeenAt: 10, routedPetId: 'pet-a' })
  const b = session('claude:b', { state: 'tool-running', firstSeenAt: 20, lastSeenAt: 20, routedPetId: 'pet-b' })
  b.state = 'thinking'
  const winners = new Set<string>()
  for (let tick = 0; tick < 20; tick += 1) {
    const busy = tick % 2 === 0 ? a : b
    busy.lastSeenAt = 100 + tick
    winners.add(summarizeFamilies([a, b])[0]!.top.key)
  }
  assert.deepEqual([...winners], ['claude:a'])

  const waitingOld = session('claude:c', { state: 'waiting-permission', firstSeenAt: 1, lastSeenAt: 50 })
  const waitingNew = session('claude:d', { state: 'waiting-permission', firstSeenAt: 2, lastSeenAt: 60 })
  assert.equal(mostUrgentSession([waitingOld, waitingNew])?.key, 'claude:d')
})

test('the pet follows the working session whose state changed last, not the higher fixed priority', () => {
  const claude = session('claude:a', { state: 'tool-running', stateChangedAt: 100, lastSeenAt: 900 })
  const codex = session('codex:b', { state: 'thinking', stateChangedAt: 200, lastSeenAt: 200 })
  assert.equal(mostUrgentSession([claude, codex])?.key, 'codex:b')
  assert.equal(mostUrgentSession([codex, claude])?.key, 'codex:b')

  claude.stateChangedAt = 300
  assert.equal(mostUrgentSession([claude, codex])?.key, 'claude:a')
  assert.deepEqual(summarizeFamilies([claude, codex]).map(family => family.top.key), ['codex:b', 'claude:a'])
})

test('stateChangedAt falls back to lastSeenAt and ties end on the attention order', () => {
  const older = session('claude:a', { state: 'thinking', lastSeenAt: 50 })
  const newer = session('codex:b', { state: 'tool-running', lastSeenAt: 60 })
  assert.equal(mostUrgentSession([older, newer])?.key, 'codex:b')
  const tied = session('codex:c', { state: 'thinking', stateChangedAt: 70, firstSeenAt: 1 })
  const tiedHigher = session('claude:d', { state: 'tool-running', stateChangedAt: 70, firstSeenAt: 9 })
  assert.equal(mostUrgentSession([tied, tiedHigher])?.key, 'claude:d')
})

test('states that need the user beat any more recently changed working session', () => {
  const working = session('codex:w', { state: 'tool-running', stateChangedAt: 9_000 })
  for (const state of ['waiting-permission', 'waiting-input', 'error'] as const) {
    const waiting = session('claude:n', { state, stateChangedAt: 1, lastSeenAt: 1 })
    assert.equal(mostUrgentSession([working, waiting])?.key, 'claude:n', state)
    assert.equal(mostUrgentSession([waiting, working])?.key, 'claude:n', state)
  }
})

test('idle never steals focus, and a fresh success briefly beats older working', () => {
  const working = session('claude:w', { state: 'tool-running', stateChangedAt: 100 })
  const idle = session('codex:i', { state: 'idle', stateChangedAt: 99_999, lastSeenAt: 99_999 })
  assert.equal(mostUrgentSession([working, idle])?.key, 'claude:w')
  assert.equal(mostUrgentSession([idle, working])?.key, 'claude:w')
  const done = session('codex:s', { state: 'success', stateChangedAt: 500 })
  assert.equal(mostUrgentSession([working, done])?.key, 'codex:s')
  assert.equal(mostUrgentSession([idle])?.key, 'codex:i')
})

test('every state declares a pet focus tier', async () => {
  const { AGENT_STATE_POLICY } = await import('../src/types/agent.ts')
  const tiers = Object.fromEntries(Object.entries(AGENT_STATE_POLICY).map(([state, policy]) => [state, policy.petFocus]))
  assert.deepEqual(tiers, {
    offline: 'background', idle: 'background', thinking: 'recent', 'tool-running': 'recent',
    'waiting-permission': 'attention', 'waiting-input': 'attention', success: 'recent', error: 'attention',
  })
})

test('family summary names the session that needs you and counts the rest in one pass', () => {
  const summary = summarizeFamilies([
    session('codex:1', { state: 'tool-running' }),
    session('claude:1', { state: 'thinking', lastSeenAt: 999 }),
    session('claude-desktop:2', { state: 'waiting-permission', lastSeenAt: 10, project: 'my-app' }),
    session('claude:3', { state: 'success' }),
    session('claude:4', { state: 'offline', lastSeenAt: 2_000 }),
  ])
  assert.deepEqual(summary.map(family => family.key), ['codex', 'claude'])
  const claude = summary[1]!
  assert.equal(claude.top.key, 'claude-desktop:2')
  assert.equal(claude.top.project, 'my-app')
  assert.equal(claude.count, 3)
  assert.deepEqual([...claude.sources].sort(), ['claude', 'claude-desktop'])
  assert.deepEqual(summarizeFamilies([]), [])
})

test('family summary stays linear for a large session set', () => {
  const sessions = Array.from({ length: 20_000 }, (_, index) => session(`codex:${index}`, { lastSeenAt: index }))
  const startedAt = performance.now()
  const summary = summarizeFamilies(sessions)
  assert.equal(summary[0]?.count, 20_000)
  assert.equal(summary[0]?.top.key, 'codex:0')
  assert.ok(performance.now() - startedAt < 500)
})

test('status line text keeps the project and variants for the tooltip, never an other-sessions count', () => {
  const busy = statusLineText({ label: 'Claude', variants: ['CLI', 'Desktop'], project: 'a-very-long-project-name-for-layout-testing' }, '思考中')
  assert.equal(busy, 'Claude (CLI+Desktop) · a-very-long-project-name-for-layout-testing · 思考中')
  assert.doesNotMatch(busy, /\(\+\d+\)/)

  assert.equal(statusLineText({ label: 'Codex', variants: ['CLI'], project: 'web' }, 'Working'), 'Codex (CLI) · web · Working')
  assert.equal(statusLineText({ label: 'Codex', variants: [] }, 'Working'), 'Codex · Working')
  assert.equal(statusLineText({ label: '', variants: [] }, 'Offline'), 'Offline')
})

test('the pet template no longer renders a (+N) session count', async () => {
  const fs = await import('node:fs')
  const source = ['DesktopPet.vue', 'desktop-pet/PetStatusLine.vue'].map(file => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')).join('\n')
  assert.doesNotMatch(source, /line\.count - 1/)
  assert.doesNotMatch(source, /line-more/)
  assert.doesNotMatch(source, /line-project|line-main/)
  assert.equal(source.match(/:aria-label="view\.aria"/g)?.length, 1)
  // aria-label on a generic div is only announced with a role.
  assert.equal(source.match(/class="status-line[^"]*"\s+role="group"/g)?.length, 1)
  assert.equal(source.match(/<span class="line-state">\{\{ stateLineLabel\(line\.state\) \}\}<\/span>/g)?.length, 1)
})

test('on-pet state words are short English for every state; the catalogs no longer carry them', async () => {
  const { stateLineLabel } = await import('../src/utils/agent-state-presentation.ts')
  const expected: Record<string, string> = {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Working',
    'waiting-permission': 'Permission', 'waiting-input': 'Needs input', success: 'Done', error: 'Failed',
  }
  for (const [state, word] of Object.entries(expected)) assert.equal(stateLineLabel(state), word)
  assert.equal(stateLineLabel('not-a-state'), 'Idle')
  assert.equal(statusLineText({ label: '', variants: [] }, stateLineLabel('offline')), 'Offline')
  const fs = await import('node:fs')
  const en = JSON.parse(fs.readFileSync(new URL('../src/locales/pet/en-US.json', import.meta.url), 'utf8')) as Record<string, string>
  const zh = JSON.parse(fs.readFileSync(new URL('../src/locales/pet/zh-TW.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const catalog of [en, zh]) assert.equal(Object.keys(catalog).filter(key => key.startsWith('pet.lineState')).length, 0)
  assert.equal(en['pet.statePermission'], 'waiting for permission')
  assert.ok(zh['pet.statePermission'])
})
