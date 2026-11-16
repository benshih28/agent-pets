import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  TRANSCRIPT_TAIL_BYTES,
  familyHasTranscript,
  locateTranscript,
  probeTranscript,
  turnEndFromTail,
} from '../electron/transcript-turn-end.ts'
import { removeTempTree } from './support/temp-dir.mts'

// 紀錄的形狀取自真實的 Claude Code／Codex 紀錄檔（只留判斷用得到的欄位）。

const jsonl = (...records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n'
const at = (iso: string) => Date.parse(iso)

const claudeAssistant = (timestamp: string, extra: object = {}) => ({
  type: 'assistant', isSidechain: false, timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] }, ...extra,
})
const claudeUser = (timestamp: string, content: unknown, extra: object = {}) => ({
  type: 'user', isSidechain: false, timestamp, message: { role: 'user', content }, ...extra,
})
const claudeInterrupt = (timestamp: string, text = '[Request interrupted by user]') =>
  claudeUser(timestamp, [{ type: 'text', text }])

const codexEvent = (timestamp: string, type: string, extra: object = {}) => ({ timestamp, type: 'event_msg', payload: { type, ...extra } })

test('claude: an interrupt message at the end means the turn was interrupted', () => {
  for (const text of [
    '[Request interrupted by user]',
    '[Request interrupted by user for tool use]',
    '[Request interrupted by user]\n',
  ]) {
    const tail = jsonl(claudeAssistant('2026-11-10T08:07:00.000Z'), claudeInterrupt('2026-11-10T08:07:08.199Z', text))
    assert.deepEqual(turnEndFromTail('claude', tail, false), { endedAt: at('2026-11-10T08:07:08.199Z'), reason: 'interrupted' }, text)
  }
  // 舊版把內容寫成字串。
  const legacy = jsonl(claudeUser('2026-11-10T08:07:08.199Z', '[Request interrupted by user for tool use]'))
  assert.equal(turnEndFromTail('claude', legacy, false)?.reason, 'interrupted')
})

test('claude: bookkeeping records after the interrupt do not hide it', () => {
  const tail = jsonl(
    claudeUser('2026-11-10T08:07:08.044Z', [{ type: 'tool_result', content: 'The tool use was rejected' }]),
    claudeInterrupt('2026-11-10T08:07:08.199Z', '[Request interrupted by user for tool use]'),
    { type: 'last-prompt' },
    { type: 'bridge-session' },
    { type: 'cost-state' },
    { type: 'attachment', timestamp: '2026-11-10T08:07:09.000Z' },
  )
  assert.equal(turnEndFromTail('claude', tail, false)?.endedAt, at('2026-11-10T08:07:08.199Z'))
})

test('claude: a turn that is still going is never reported as ended', () => {
  const running: Array<[string, unknown[]]> = [
    ['assistant is last', [claudeInterrupt('2026-11-10T08:00:00.000Z'), claudeUser('2026-11-10T08:01:00.000Z', 'next prompt'), claudeAssistant('2026-11-10T08:01:05.000Z')]],
    ['tool result is last', [claudeAssistant('2026-11-10T08:01:05.000Z'), claudeUser('2026-11-10T08:01:09.000Z', [{ type: 'tool_result', content: 'ok' }])]],
    ['a new prompt after an interrupt', [claudeInterrupt('2026-11-10T08:00:00.000Z'), claudeUser('2026-11-10T08:00:01.000Z', [{ type: 'text', text: 'try again' }])]],
    ['the user merely quotes the marker', [claudeUser('2026-11-10T08:00:00.000Z', 'why did it say [Request interrupted by user]?')]],
    ['the marker is one of several blocks', [claudeUser('2026-11-10T08:00:00.000Z', [{ type: 'text', text: '[Request interrupted by user]' }, { type: 'text', text: 'more' }])]],
    ['empty file', []],
  ]
  for (const [name, records] of running) {
    assert.equal(turnEndFromTail('claude', records.length ? jsonl(...records) : '', false), null, name)
  }
})

test('claude: subagent records are ignored on both sides', () => {
  // 子代理被中斷不代表主回合結束。
  const subagentInterrupted = jsonl(claudeAssistant('2026-11-10T08:00:00.000Z'), { ...claudeInterrupt('2026-11-10T08:00:05.000Z'), isSidechain: true })
  assert.equal(turnEndFromTail('claude', subagentInterrupted, false), null)
  // 主回合已中斷，之後的子代理紀錄不會把它變回進行中。
  const mainInterrupted = jsonl(claudeInterrupt('2026-11-10T08:00:05.000Z'), claudeAssistant('2026-11-10T08:00:06.000Z', { isSidechain: true }))
  assert.equal(turnEndFromTail('claude', mainInterrupted, false)?.reason, 'interrupted')
})

test('codex: turn_aborted and task_complete end the turn, task_started reopens it', () => {
  const aborted = jsonl(codexEvent('2026-11-04T03:23:49.000Z', 'task_started'), codexEvent('2026-11-04T03:23:52.669Z', 'turn_aborted', { reason: 'interrupted' }))
  assert.deepEqual(turnEndFromTail('codex', aborted, false), { endedAt: at('2026-11-04T03:23:52.669Z'), reason: 'interrupted' })

  const completed = jsonl(
    codexEvent('2026-11-11T01:25:29.091Z', 'task_started'),
    codexEvent('2026-11-11T01:28:19.061Z', 'token_count'),
    codexEvent('2026-11-11T01:28:21.709Z', 'task_complete'),
    { timestamp: '2026-11-11T01:28:22.000Z', type: 'response_item', payload: { type: 'message' } },
  )
  assert.deepEqual(turnEndFromTail('codex', completed, false), { endedAt: at('2026-11-11T01:28:21.709Z'), reason: 'completed' })

  const restarted = jsonl(codexEvent('2026-11-11T01:28:21.709Z', 'task_complete'), codexEvent('2026-11-11T01:30:00.000Z', 'task_started'), codexEvent('2026-11-11T01:30:05.000Z', 'item_completed'))
  assert.equal(turnEndFromTail('codex', restarted, false), null)
  assert.equal(turnEndFromTail('codex', jsonl(codexEvent('2026-11-11T01:30:05.000Z', 'item_completed')), false), null)
})

test('unreadable input is treated as still running', () => {
  const marker = JSON.stringify(claudeInterrupt('2026-11-10T08:00:05.000Z'))
  assert.equal(turnEndFromTail('claude', 'not json\n{"broken":\n[1,2]\nnull\n', false), null)
  assert.equal(turnEndFromTail('claude', jsonl({ ...claudeInterrupt('x'), timestamp: 'not a date' }), false), null)
  assert.equal(turnEndFromTail('codex', jsonl({ timestamp: 5, type: 'event_msg', payload: { type: 'turn_aborted' } }), false), null)
  assert.equal(turnEndFromTail('codex', jsonl({ timestamp: '2026-11-04T03:23:52.669Z', type: 'event_msg', payload: null }), false), null)
  assert.equal(turnEndFromTail('codex', jsonl({ timestamp: '2026-11-04T03:23:52.669Z', type: 'event_msg', payload: ['turn_aborted'] }), false), null)
  // 從檔案中間開始讀時第一行可能是半行；就算剛好是合法 JSON 也不採信。
  assert.equal(turnEndFromTail('claude', marker, true), null)
  assert.equal(turnEndFromTail('claude', `${marker}\n`, true), null)
  assert.equal(turnEndFromTail('claude', `garbage\n${marker}\n`, true)?.reason, 'interrupted')
  // 一種格式的紀錄不會被另一種格式採信；沒有紀錄檔的家族一律沒有結論。
  assert.equal(turnEndFromTail('codex', `${marker}\n`, false), null)
  assert.equal(turnEndFromTail('opencode', `${marker}\n`, false), null)
  assert.equal(familyHasTranscript('claude'), true)
  assert.equal(familyHasTranscript('codex'), true)
  assert.equal(familyHasTranscript('opencode'), false)
})

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-transcript-'))
}

test('locate finds the Claude and Codex files from the config folder and the session id only', async () => {
  const home = tempDir()
  try {
    const claudeId = '291b53e3-8c8c-4a53-982e-469bc66bcb1d'
    const claudeFile = path.join(home, 'projects', 'C--work-demo', `${claudeId}.jsonl`)
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true })
    fs.mkdirSync(path.join(home, 'projects', 'C--other'), { recursive: true })
    fs.writeFileSync(claudeFile, '')
    assert.equal(await locateTranscript('claude', home, claudeId), claudeFile)
    assert.equal(await locateTranscript('claude', home, '00000000-0000-0000-0000-000000000000'), null)

    const codexId = '01a1c835-aa5f-7711-b91c-41bdd5d8588b'
    const older = path.join(home, 'sessions', '2026', '11', '10')
    const newer = path.join(home, 'sessions', '2026', '11', '11')
    fs.mkdirSync(older, { recursive: true })
    fs.mkdirSync(newer, { recursive: true })
    fs.mkdirSync(path.join(home, 'sessions', 'not-a-date'), { recursive: true })
    fs.writeFileSync(path.join(older, `rollout-2026-11-10T08-00-00-${codexId}.jsonl`), '')
    fs.writeFileSync(path.join(newer, 'rollout-2026-11-11T09-00-00-11111111-2222-3333-4444-555555555555.jsonl'), '')
    assert.equal(await locateTranscript('codex', home, codexId), path.join(older, `rollout-2026-11-10T08-00-00-${codexId}.jsonl`))
    assert.equal(await locateTranscript('codex', home, '99999999-0000-0000-0000-000000000000'), null)
    assert.equal(await locateTranscript('opencode', home, codexId), null)
    assert.equal(await locateTranscript('claude', path.join(home, 'missing'), claudeId), null)
  } finally {
    removeTempTree(home)
  }
})

test('a session id that could change the path is refused before the file system is touched', async () => {
  let touched = 0
  const spy = { list: async () => { touched += 1; return [] }, isFile: async () => { touched += 1; return true } }
  for (const id of ['', 'short', '../../secret', '..\\..\\secret', 'a/b/c/d/e/f/g', 'C:\\Windows\\win.ini', 'abcdefgh.jsonl', 'abcdefgh\0', `${'a'.repeat(129)}`, '-leading-dash-id', 'white space id']) {
    assert.equal(await locateTranscript('claude', '/config', id, spy), null, JSON.stringify(id))
    assert.equal(await locateTranscript('codex', '/config', id, spy), null, JSON.stringify(id))
  }
  assert.equal(touched, 0)
})

test('probe reads only the tail, reports unchanged files, and fails closed', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'session.jsonl')
    fs.writeFileSync(file, jsonl(claudeAssistant('2026-11-10T08:00:00.000Z')))
    const first = await probeTranscript('claude', file)
    assert.equal(first?.turnEnd, null)

    assert.equal((await probeTranscript('claude', file, first!.fingerprint))?.turnEnd, 'unchanged')

    fs.appendFileSync(file, jsonl(claudeInterrupt('2026-11-10T08:00:05.000Z')))
    const second = await probeTranscript('claude', file, first!.fingerprint)
    assert.deepEqual(second?.turnEnd, { endedAt: at('2026-11-10T08:00:05.000Z'), reason: 'interrupted' })
    assert.ok(second!.fingerprint.size > first!.fingerprint.size)

    // 檔案比讀取上限大：結尾的結束紀錄仍然看得到，前面被截斷的半行不會造成誤判。
    const big = path.join(dir, 'big.jsonl')
    const filler = jsonl(claudeUser('2026-11-10T07:00:00.000Z', 'x'.repeat(1024)))
    fs.writeFileSync(big, filler.repeat(Math.ceil((TRANSCRIPT_TAIL_BYTES * 2) / filler.length)) + jsonl(codexEvent('2026-11-04T03:23:52.669Z', 'turn_aborted')))
    assert.deepEqual((await probeTranscript('codex', big))?.turnEnd, { endedAt: at('2026-11-04T03:23:52.669Z'), reason: 'interrupted' })
    assert.equal((await probeTranscript('claude', big))?.turnEnd, null)

    assert.equal(await probeTranscript('claude', path.join(dir, 'missing.jsonl')), null)
    assert.equal(await probeTranscript('claude', dir), null)
  } finally {
    removeTempTree(dir)
  }
})
