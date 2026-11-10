import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Runs the real integrations/agent-hook.mjs against fake local servers. The hook hard-codes the
// app's ports, so each test runs a copy whose ports point at ephemeral test servers; HOME is a
// throw-away directory, so the user's real tokens and settings are never read.

const HOOK_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations', 'agent-hook.mjs')
const EVENT_TOKEN = 'e'.repeat(64)
const PERMISSION_TOKEN = 'b'.repeat(64)
const SESSION = '3f1c2a9e-1111-4222-8333-944455556666'
const PROMPT = 'c7278cfd-2a0f-456e-bb13-7335119fc535'
const TOOL_INPUT = { command: 'git status', description: 'Show the working tree status' }

interface Recorded { route: string; body: Record<string, unknown>; token?: string; at: number }
type Handler = (route: string, body: Record<string, unknown>) => { status: number; body?: unknown }

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}

const portOf = (server: Server) => (server.address() as AddressInfo).port

async function closedPort(): Promise<number> {
  const server = await listen(() => {})
  const port = portOf(server)
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

interface Harness {
  home: string
  hookPath: string
  permissionCalls: Recorded[]
  eventCalls: Recorded[]
  close: () => Promise<void>
}

async function harness(options: {
  handler?: Handler
  optIn?: Record<string, unknown> | null
  permissionToken?: string | null
  permissionServer?: boolean
} = {}): Promise<Harness> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-claude-hook-'))
  const deploy = path.join(home, '.desktop-pet')
  fs.mkdirSync(deploy, { recursive: true })
  fs.writeFileSync(path.join(deploy, 'event-token'), `${EVENT_TOKEN}\n`)
  if (options.permissionToken !== null) fs.writeFileSync(path.join(deploy, 'permission-token'), `${options.permissionToken ?? PERMISSION_TOKEN}\n`)
  if (options.optIn !== null) {
    fs.writeFileSync(path.join(deploy, 'claude-permission-respond'), JSON.stringify(options.optIn ?? { enabled: true, waitSeconds: 30 }))
  }

  const permissionCalls: Recorded[] = []
  const eventCalls: Recorded[] = []
  const eventServer = await listen(async (request, response) => {
    const at = process.hrtime.bigint()
    eventCalls.push({ route: request.url ?? '', body: await readBody(request), at: Number(at) })
    response.statusCode = 204
    response.end()
  })
  const permissionServer = options.permissionServer === false
    ? null
    : await listen(async (request, response) => {
      const at = Number(process.hrtime.bigint())
      const route = (request.url ?? '').replace('/v1/permission/', '')
      const body = await readBody(request)
      permissionCalls.push({ route, body, token: String(request.headers['x-agent-pets-permission-token'] ?? ''), at })
      const result = options.handler?.(route, body) ?? { status: 204 }
      response.statusCode = result.status
      if (result.body !== undefined) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(result.body))
      } else {
        response.end()
      }
    })
  const permissionPort = permissionServer ? portOf(permissionServer) : await closedPort()

  // Same script, test ports, a 1 s minimum wait so the timeout case stays fast, and a looser event budget.
  const hookPath = path.join(home, 'agent-hook.mjs')
  const source = fs.readFileSync(HOOK_SOURCE, 'utf8')
  const patched = source
    .replace('127.0.0.1:17373', `127.0.0.1:${portOf(eventServer)}`)
    .replace('127.0.0.1:17374', `127.0.0.1:${permissionPort}`)
    .replace('const MIN_WAIT_SECONDS = 15', 'const MIN_WAIT_SECONDS = 1')
    // 負載高的 runner 可能錯過較短的時限；這些測試檢查的是內容，不是延遲（時限另見 agent-hook-delivery.test.mts）。
    .replace('const SEND_DEADLINE_MS = 1500', 'const SEND_DEADLINE_MS = 5000')
    .replace('const PERMISSION_ANSWER_DEADLINE_MS = 1000', 'const PERMISSION_ANSWER_DEADLINE_MS = 5000')
  if (!patched.includes('const SEND_DEADLINE_MS = 5000') || !patched.includes('PERMISSION_ANSWER_DEADLINE_MS = 5000')) {
    // Close the servers first so a stale patch fails the test instead of hanging the run.
    await new Promise<void>(resolve => eventServer.close(() => resolve()))
    if (permissionServer) await new Promise<void>(resolve => permissionServer.close(() => resolve()))
    throw new Error('agent-hook.mjs call budgets changed; update the test patch')
  }
  fs.writeFileSync(hookPath, patched)

  return {
    home,
    hookPath,
    permissionCalls,
    eventCalls,
    close: async () => {
      await new Promise<void>(resolve => eventServer.close(() => resolve()))
      if (permissionServer) await new Promise<void>(resolve => permissionServer.close(() => resolve()))
      fs.rmSync(home, { recursive: true, force: true })
    },
  }
}

// Host-detection variables are cleared so the runner's own terminal never leaks into a payload.
const HOST_ENV_KEYS = ['TERM_PROGRAM', '__CFBundleIdentifier', 'CLAUDE_CODE_ENTRYPOINT', 'WT_SESSION', 'VSCODE_INJECTION', 'VSCODE_GIT_IPC_HANDLE', 'CURSOR_TRACE_ID']

function runHook(h: Harness, payload: Record<string, unknown>, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; code: number | null; ms: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h.home, USERPROFILE: h.home }
  for (const key of HOST_ENV_KEYS) delete env[key]
  Object.assign(env, extraEnv)
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [h.hookPath, 'claude'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ stdout, code, ms: Date.now() - startedAt }))
    child.stdin.end(JSON.stringify(payload))
  })
}

function permissionRequest(extra: Record<string, unknown> = {}) {
  return {
    session_id: SESSION,
    prompt_id: PROMPT,
    hook_event_name: 'PermissionRequest',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: TOOL_INPUT,
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }] }],
    cwd: '/tmp/project-x',
    transcript_path: '/tmp/secret-transcript.jsonl',
    ...extra,
  }
}

function decisionFlow(decision: 'allow_once' | 'deny', pendingPolls = 1): Handler {
  let polls = 0
  return (route) => {
    if (route === 'request') return { status: 201, body: { requestId: 'r1' } }
    if (route === 'decision') {
      polls += 1
      return polls <= pendingPolls ? { status: 204 } : { status: 200, body: { decisionId: 'decision-1', decision } }
    }
    return { status: 204 }
  }
}

test('allow from the pet prints the PermissionRequest allow decision and reports delivery', async () => {
  const h = await harness({ handler: decisionFlow('allow_once') })
  try {
    const result = await runHook(h, permissionRequest())
    assert.equal(result.code, 0)
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    const request = h.permissionCalls.find(call => call.route === 'request')!
    assert.equal(request.token, PERMISSION_TOKEN)
    assert.equal(request.body.source, 'claude')
    assert.equal(request.body.instanceId, `claude-${SESSION}`)
    assert.equal(request.body.sessionId, SESSION)
    assert.equal(request.body.permission, 'Bash')
    assert.equal(request.body.detail, 'git status')
    assert.equal(request.body.ttlSeconds, 30)
    assert.equal(request.body.scope, 'main')
    assert.equal(request.body.filePath, undefined)
    assert.match(String(request.body.permissionId), /^[a-f0-9]{32}$/)
    // Every call of this invocation carries the same per-invocation nonce.
    const nonce = request.body.nonce
    assert.match(String(nonce), /^[a-f0-9]{32}$/)
    for (const call of h.permissionCalls) assert.equal(call.body.nonce, nonce, call.route)
    // Only the approved command leaves the hook: no model-written description, suggestions or transcript path.
    const sent = JSON.stringify(request.body)
    for (const leaked of ['Show the working tree status', 'secret-transcript', 'addRules', PROMPT]) {
      assert.ok(!sent.includes(leaked), leaked)
    }
    assert.ok(h.permissionCalls.filter(call => call.route === 'decision').length >= 2)
    const delivered = h.permissionCalls.find(call => call.route === 'result')!
    assert.deepEqual(delivered.body, {
      source: 'claude', instanceId: `claude-${SESSION}`, permissionId: request.body.permissionId,
      nonce, decisionId: 'decision-1', result: 'delivered',
    })
    // The observe event still reaches the event server, after the pet request exists.
    assert.equal(h.eventCalls[0]?.body.state, 'waiting-permission')
    assert.ok(h.eventCalls[0]!.at > request.at, 'request is created before the status event')
  } finally {
    await h.close()
  }
})

test('deny prints a fixed message that carries no request content', async () => {
  const h = await harness({ handler: decisionFlow('deny', 0) })
  try {
    const result = await runHook(h, permissionRequest())
    assert.equal(result.code, 0)
    const output = JSON.parse(result.stdout)
    assert.equal(output.hookSpecificOutput.decision.behavior, 'deny')
    assert.equal(output.hookSpecificOutput.decision.message, 'Denied in Agent Pets. (已在 Agent Pets 拒絕)')
    assert.ok(!result.stdout.includes('git status'))
    assert.equal(Object.keys(output.hookSpecificOutput.decision).sort().join(','), 'behavior,message')
  } finally {
    await h.close()
  }
})

test('410 (answered elsewhere or expired) stops polling silently', async () => {
  const h = await harness({
    handler: route => (route === 'request' ? { status: 201, body: { requestId: 'r1' } } : { status: 410, body: { error: 'resolved' } }),
  })
  try {
    const result = await runHook(h, permissionRequest())
    assert.equal(result.code, 0)
    assert.equal(result.stdout, '')
    assert.equal(h.permissionCalls.filter(call => call.route === 'decision').length, 1)
    assert.equal(h.permissionCalls.some(call => call.route === 'result'), false)
  } finally {
    await h.close()
  }
})

test('the wait limit ends the hook without output', async () => {
  const h = await harness({
    optIn: { enabled: true, waitSeconds: 1 },
    handler: route => (route === 'request' ? { status: 201, body: { requestId: 'r1' } } : { status: 204 }),
  })
  try {
    const result = await runHook(h, permissionRequest())
    assert.equal(result.code, 0)
    assert.equal(result.stdout, '')
    // waitSeconds + 2 s grace (plus process start-up), never the 600 s Claude Code default.
    assert.ok(result.ms < 15_000, `took ${result.ms} ms`)
    assert.ok(h.permissionCalls.filter(call => call.route === 'decision').length >= 3)
  } finally {
    await h.close()
  }
})

test('connection refused, server refusal or a missing token fail fast and silently', async () => {
  for (const setup of [
    { permissionServer: false },
    { handler: () => ({ status: 503, body: { error: 'source_disabled' } }) },
    { handler: () => ({ status: 401, body: { error: 'unauthorized' } }) },
    { handler: () => ({ status: 429, body: { error: 'rate_limited' } }) },
    // An identical request from another invocation already owns the bubble.
    { handler: () => ({ status: 409, body: { error: 'in_use' } }) },
    { permissionToken: null },
    { permissionToken: 'not-a-token' },
  ] as const) {
    const h = await harness(setup)
    try {
      const result = await runHook(h, permissionRequest())
      assert.equal(result.code, 0)
      assert.equal(result.stdout, '', JSON.stringify(setup))
      // Refusals return at once. The bound is far below the 30 s wait (so the hook clearly did not
      // wait) yet loose enough for Node start-up on a heavily loaded machine.
      assert.ok(result.ms < 15_000, `${JSON.stringify(setup)} took ${result.ms} ms`)
      assert.equal(h.permissionCalls.some(call => call.route === 'decision'), false)
    } finally {
      await h.close()
    }
  }
})

test('without the opt-in file the hook stays observe-only', async () => {
  for (const optIn of [null, { enabled: false, waitSeconds: 30 }, { enabled: true }] as const) {
    const h = await harness({ optIn, handler: decisionFlow('allow_once', 0) })
    try {
      const result = await runHook(h, permissionRequest())
      assert.equal(result.stdout, '')
      assert.deepEqual(h.permissionCalls, [])
      assert.equal(h.eventCalls[0]?.body.state, 'waiting-permission')
      const post = await runHook(h, { ...permissionRequest(), hook_event_name: 'PostToolUse' })
      assert.equal(post.stdout, '')
      assert.deepEqual(h.permissionCalls, [])
    } finally {
      await h.close()
    }
  }
})

test('PostToolUse and PostToolUseFailure recompute the same permission id; turn ends resolve the session', async () => {
  const h = await harness({ handler: route => (route === 'request' ? { status: 201, body: { requestId: 'r1' } } : { status: route === 'decision' ? 410 : 204 }) })
  try {
    await runHook(h, permissionRequest())
    const permissionId = h.permissionCalls.find(call => call.route === 'request')!.body.permissionId
    // PostToolUse carries the same prompt/tool fields plus extras that must not change the id.
    const post = { ...permissionRequest(), hook_event_name: 'PostToolUse', tool_use_id: 'toolu_1', tool_response: { stdout: 'ok' }, tool_input: { description: TOOL_INPUT.description, command: TOOL_INPUT.command } }
    for (const eventName of ['PostToolUse', 'PostToolUseFailure']) {
      h.permissionCalls.length = 0
      const result = await runHook(h, { ...post, hook_event_name: eventName })
      assert.equal(result.stdout, '')
      assert.deepEqual(h.permissionCalls.map(call => call.route), ['resolved'])
      assert.deepEqual(h.permissionCalls[0]!.body, { source: 'claude', instanceId: `claude-${SESSION}`, permissionId })
    }

    // A different prompt or command is a different request.
    h.permissionCalls.length = 0
    await runHook(h, { ...post, prompt_id: 'other-prompt' })
    assert.notEqual(h.permissionCalls[0]!.body.permissionId, permissionId)

    for (const eventName of ['UserPromptSubmit', 'SessionEnd']) {
      h.permissionCalls.length = 0
      await runHook(h, { session_id: SESSION, prompt_id: PROMPT, hook_event_name: eventName, cwd: '/tmp/project-x' })
      assert.deepEqual(h.permissionCalls.map(call => call.route), ['resolved-session'], eventName)
      assert.deepEqual(h.permissionCalls[0]!.body, { source: 'claude', instanceId: `claude-${SESSION}` })
    }
    // A new tool call or the main turn ending settles only that agent's earlier prompts.
    for (const [eventName, extra, scope] of [
      ['PreToolUse', {}, 'main'], ['Stop', {}, 'main'], ['PreToolUse', { agent_id: 'agent-7' }, 'agent-7'],
    ] as const) {
      h.permissionCalls.length = 0
      await runHook(h, { ...post, hook_event_name: eventName, ...extra })
      assert.deepEqual(h.permissionCalls.map(call => call.route), ['resolved-session'], eventName)
      assert.deepEqual(h.permissionCalls[0]!.body, { source: 'claude', instanceId: `claude-${SESSION}`, scope })
    }

    // A background task may still be waiting for the pet when the main turn stops.
    h.permissionCalls.length = 0
    await runHook(h, { session_id: SESSION, hook_event_name: 'Stop', background_tasks: [{ id: 'bg-1' }] })
    assert.deepEqual(h.permissionCalls, [])
  } finally {
    await h.close()
  }
})

test('an unusual session id still becomes a valid bounded identifier', async () => {
  const h = await harness({ handler: route => (route === 'request' ? { status: 201, body: { requestId: 'r1' } } : { status: 410 }) })
  try {
    await runHook(h, permissionRequest({ session_id: `bad id/${'x'.repeat(300)}` }))
    const request = h.permissionCalls.find(call => call.route === 'request')!
    for (const key of ['instanceId', 'sessionId', 'permissionId']) {
      assert.match(String(request.body[key]), /^[A-Za-z0-9._:-]{1,128}$/, key)
    }
  } finally {
    await h.close()
  }
})

test('the bubble detail falls back to the arguments without the model description', async () => {
  const h = await harness({ handler: route => (route === 'request' ? { status: 201, body: { requestId: 'r1' } } : { status: 410 }) })
  try {
    const cases: Array<[string, Record<string, unknown>, string | undefined, string | undefined]> = [
      ['WebSearch', { query: 'node 24 release notes', allowed_domains: ['nodejs.org'] }, 'node 24 release notes', undefined],
      ['NotebookEdit', { notebook_path: '/tmp/project-x/nb.ipynb', new_source: 'print(1)' }, '/tmp/project-x/nb.ipynb', '/tmp/project-x/nb.ipynb'],
      ['Write', { file_path: '/tmp/project-x/a.ts', content: 'secret body' }, '/tmp/project-x/a.ts', '/tmp/project-x/a.ts'],
      ['mcp__github__create_issue', { title: 'Bug', repo: 'o/r', description: 'model text' }, '{"repo":"o/r","title":"Bug"}', undefined],
      ['Task', { description: 'only a description' }, undefined, undefined],
    ]
    for (const [index, [tool, input, detail, filePath]] of cases.entries()) {
      h.permissionCalls.length = 0
      await runHook(h, permissionRequest({ tool_name: tool, tool_input: input, prompt_id: `p-${index}` }))
      const request = h.permissionCalls.find(call => call.route === 'request')!
      assert.equal(request.body.detail, detail, tool)
      assert.equal(request.body.filePath, filePath, tool)
      assert.ok(!JSON.stringify(request.body).includes('model text'))
      assert.ok(!JSON.stringify(request.body).includes('secret body'))
    }
    h.permissionCalls.length = 0
    await runHook(h, permissionRequest({ tool_input: { command: 'x'.repeat(5000) } }))
    assert.equal(String(h.permissionCalls[0]!.body.detail).length, 1000)
  } finally {
    await h.close()
  }
})

test('the status event names the host app from a few env values only', async () => {
  const h = await harness({ optIn: null })
  try {
    await runHook(h, { ...permissionRequest(), hook_event_name: 'UserPromptSubmit' }, {
      TERM_PROGRAM: 'iTerm.app',
      __CFBundleIdentifier: 'com.googlecode.iterm2',
      VSCODE_GIT_IPC_HANDLE: '/private/secret/ipc.sock',
      WT_SESSION: 'aaaa-bbbb',
      SECRET_TOKEN: 'do-not-send',
    })
    const body = h.eventCalls[0]!.body
    const expected: Record<string, unknown> = { termProgram: 'iTerm.app', windowsTerminal: true, vscode: true }
    if (process.platform === 'darwin') expected.bundleId = 'com.googlecode.iterm2'
    assert.deepEqual(body.host, expected)
    const raw = JSON.stringify(body)
    for (const secret of ['do-not-send', '/private/secret', 'aaaa-bbbb']) assert.ok(!raw.includes(secret), secret)

    h.eventCalls.length = 0
    await runHook(h, { ...permissionRequest(), hook_event_name: 'UserPromptSubmit' }, { TERM_PROGRAM: 'bad value; rm -rf /' })
    assert.equal(h.eventCalls[0]!.body.host, undefined)
  } finally {
    await h.close()
  }
})
