import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { removeTempTree } from './support/temp-dir.mts'

// 用真正的 integrations/agent-hook.mjs 檢查 Claude Code 事件對應到的寵物狀態（送到假的本機伺服器）。
// 寫法同 agent-hook-delivery.test.mts：只改事件網址的副本，HOME 是暫時目錄。

const HOOK_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations', 'agent-hook.mjs')
const EVENT_TOKEN = 'e'.repeat(64)

type HookPayload = Record<string, unknown>

async function sentState(
  source: string,
  payloadOrFactory: HookPayload | ((home: string) => HookPayload),
  extraEnv: Record<string, string> = {},
): Promise<string | null> {
  const states: string[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      states.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).state)
      response.writeHead(204)
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-mapping-'))
  try {
    const payload = typeof payloadOrFactory === 'function' ? payloadOrFactory(home) : payloadOrFactory
    fs.mkdirSync(path.join(home, '.desktop-pet'))
    fs.writeFileSync(path.join(home, '.desktop-pet', 'event-token'), `${EVENT_TOKEN}\n`)
    const patched = fs.readFileSync(HOOK_SOURCE, 'utf8').replace('127.0.0.1:17373', `127.0.0.1:${(server.address() as AddressInfo).port}`)
    const hookPath = path.join(home, 'agent-hook.mjs')
    fs.writeFileSync(hookPath, patched)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [hookPath, source], {
        env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, ...extraEnv },
        stdio: ['pipe', 'ignore', 'inherit'],
      })
      child.on('error', reject)
      child.on('exit', () => resolve())
      child.stdin.end(JSON.stringify({ session_id: 'mapping-session', cwd: '/tmp/mapping', ...payload }))
    })
    return states[0] ?? null
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempTree(home)
  }
}

const cases: Array<[string, Record<string, unknown>, string | null]> = [
  ['PreCompact manual', { hook_event_name: 'PreCompact', trigger: 'manual' }, 'thinking'],
  ['PreCompact auto', { hook_event_name: 'PreCompact', trigger: 'auto' }, 'thinking'],
  ['PostCompact manual returns to the prompt', { hook_event_name: 'PostCompact', trigger: 'manual' }, 'idle'],
  ['PostCompact auto continues the turn', { hook_event_name: 'PostCompact', trigger: 'auto' }, 'thinking'],
  ['PostCompact without trigger continues the turn', { hook_event_name: 'PostCompact' }, 'thinking'],
  ['permission_prompt', { hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'waiting-permission'],
  ['idle_prompt', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, 'waiting-input'],
  ['elicitation_dialog', { hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, 'waiting-input'],
  ['elicitation_url_dialog', { hook_event_name: 'Notification', notification_type: 'elicitation_url_dialog' }, 'waiting-input'],
  ['agent_needs_input', { hook_event_name: 'Notification', notification_type: 'agent_needs_input' }, 'waiting-input'],
  ['elicitation_complete', { hook_event_name: 'Notification', notification_type: 'elicitation_complete' }, 'thinking'],
  ['elicitation_response', { hook_event_name: 'Notification', notification_type: 'elicitation_response' }, 'thinking'],
  ['auth_success is ignored', { hook_event_name: 'Notification', notification_type: 'auth_success' }, null],
  ['plugin_notification is ignored even if the message says waiting', { hook_event_name: 'Notification', notification_type: 'plugin_notification', message: 'waiting' }, null],
  ['quota_auto_resume_fired is ignored', { hook_event_name: 'Notification', notification_type: 'quota_auto_resume_fired' }, null],
  ['unknown type falls back to the message (permission)', { hook_event_name: 'Notification', notification_type: 'brand_new_type', message: 'Claude needs your permission to use Bash' }, 'waiting-permission'],
  ['prototype key is not a known type', { hook_event_name: 'Notification', notification_type: 'constructor', message: 'Claude is waiting for your input' }, 'waiting-input'],
  ['no type falls back to the message (waiting)', { hook_event_name: 'Notification', message: 'Claude is waiting for your input' }, 'waiting-input'],
  ['no type and an unrelated message is ignored', { hook_event_name: 'Notification', message: 'hello' }, null],
]

for (const [name, payload, expected] of cases) {
  test(`claude ${name}`, async () => {
    assert.equal(await sentState('claude', payload), expected)
  })
}

test('codex mapping does not know the Claude-only compaction events', async () => {
  assert.equal(await sentState('codex', { hook_event_name: 'PreCompact' }), null)
})

// Codex Desktop 的記憶整理執行緒在 <CODEX_HOME>/memories_v2 底下跑，結束時不送 Stop，不能當成使用者的對話。
test('codex ignores its own memory thread under the Codex home', async () => {
  for (const dir of ['memories_v2', 'memories', path.join('memories_v2', 'nested')]) {
    assert.equal(
      await sentState('codex', home => ({ hook_event_name: 'UserPromptSubmit', cwd: path.join(home, '.codex', dir) })),
      null,
      dir,
    )
  }
})

test('codex memory thread is recognised under CODEX_HOME and with a Windows long-path prefix', async () => {
  const custom = path.join(os.tmpdir(), 'agent-pets-custom-codex-home')
  assert.equal(
    await sentState('codex', { hook_event_name: 'PostToolUse', cwd: path.join(custom, 'memories_v2') }, { CODEX_HOME: custom }),
    null,
  )
  if (process.platform === 'win32') {
    assert.equal(
      await sentState('codex', home => ({ hook_event_name: 'UserPromptSubmit', cwd: `\\\\?\\${path.join(home, '.codex', 'memories_v2')}` })),
      null,
    )
  }
})

test('codex still reports ordinary projects, including look-alike folder names', async () => {
  assert.equal(await sentState('codex', { hook_event_name: 'UserPromptSubmit' }), 'thinking')
  assert.equal(
    await sentState('codex', home => ({ hook_event_name: 'UserPromptSubmit', cwd: path.join(home, 'projects', 'memories_v2') })),
    'thinking',
  )
  assert.equal(
    await sentState('codex', home => ({ hook_event_name: 'UserPromptSubmit', cwd: path.join(home, '.codex', 'memories-notes') })),
    'thinking',
  )
  assert.equal(await sentState('codex', home => ({ hook_event_name: 'UserPromptSubmit', cwd: path.join(home, '.codex') })), 'thinking')
  // Claude 的事件不受 Codex 的目錄規則影響。
  assert.equal(
    await sentState('claude', home => ({ hook_event_name: 'UserPromptSubmit', cwd: path.join(home, '.codex', 'memories_v2') })),
    'thinking',
  )
})
