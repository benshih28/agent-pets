import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { hookStartupMarkerName } from '../electron/main/hook-startup-marker.ts'

// 測試真正的 integrations/agent-hook.mjs 送出狀態事件的行為。執行的是只改了事件網址的副本，
// HOME 是暫時目錄，不會讀到使用者的 token 或設定。
// 背景：hook 程序起步慢的時候（機器忙、同時很多 hook、app 剛啟動），舊版常在請求送出前就放棄
// （見 docs/dev/hook-delivery.md）。

const HOOK_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'integrations', 'agent-hook.mjs')
const EVENT_TOKEN = 'e'.repeat(64)

interface Received { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

async function eventServer(answerAfterMs = 0): Promise<{ server: Server; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      received.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      setTimeout(() => { response.writeHead(204); response.end() }, answerAfterMs)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, received }
}

function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise(resolve => server.close(() => resolve()))
}

function hookHome(server: Server): { home: string; hookPath: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-delivery-'))
  fs.mkdirSync(path.join(home, '.desktop-pet'))
  fs.writeFileSync(path.join(home, '.desktop-pet', 'event-token'), `${EVENT_TOKEN}\n`)
  const port = (server.address() as AddressInfo).port
  const source = fs.readFileSync(HOOK_SOURCE, 'utf8')
  const patched = source.replace('127.0.0.1:17373', `127.0.0.1:${port}`)
  assert.notEqual(patched, source, 'agent-hook.mjs event URL changed; update the test patch')
  const hookPath = path.join(home, 'agent-hook.mjs')
  fs.writeFileSync(hookPath, patched)
  return { home, hookPath }
}

// hook 讀完 payload 後把它的 event loop 卡住一次，模擬機器忙時 CPU 被搶走；只改時序，不替換 hook 的任何程式。
function stallPreload(home: string, ms: number): string {
  const file = path.join(home, 'stall.mjs')
  fs.writeFileSync(file, `process.stdin.once('end', () => setImmediate(() => { const until = Date.now() + ${ms}; while (Date.now() < until) {} }))\n`)
  return file
}

function runHook(hookPath: string, home: string, payload: Record<string, unknown>, preload?: string): Promise<{ code: number | null; ms: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), hookPath, 'claude'], {
      env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (stderr.trim()) reject(new Error(`hook wrote to stderr: ${stderr}`))
      else resolve({ code, ms: Date.now() - startedAt })
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

const STOP = { hook_event_name: 'Stop', session_id: 'delivery-session', cwd: '/tmp/delivery-project' }

test('a status event still arrives when the hook process is stalled before it can send', async () => {
  const { server, received } = await eventServer()
  const { home, hookPath } = hookHome(server)
  try {
    const result = await runHook(hookPath, home, STOP, stallPreload(home, 400))
    assert.equal(result.code, 0)
    assert.equal(received.length, 1, 'the stalled hook gave up before its event reached the app')
    assert.equal(received[0].body.state, 'success')
  } finally {
    await close(server)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a busy app still gets the event, and the hook does not wait for its answer', async () => {
  const { server, received } = await eventServer(3_000)
  const { home, hookPath } = hookHome(server)
  try {
    const result = await runHook(hookPath, home, STOP)
    assert.equal(result.code, 0)
    assert.equal(received.length, 1)
    // 送出後只等一小段時間：agent 不會被 app 的 3 秒拖住。
    assert.ok(result.ms < 2_000, `hook took ${result.ms} ms`)
  } finally {
    await close(server)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an answer that is cut off or never finishes does not crash or hold the hook', async () => {
  for (const mode of ['cut', 'stall'] as const) {
    let reached = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        reached += 1
        response.writeHead(200, { 'content-length': '100' })
        response.write('partial')
        if (mode === 'cut') setTimeout(() => response.socket?.destroy(), 20)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { home, hookPath } = hookHome(server)
    try {
      // stderr 有任何輸出 runHook 就會 reject，所以崩潰會在這裡失敗。
      const result = await runHook(hookPath, home, STOP)
      assert.equal(result.code, 0, mode)
      assert.equal(reached, 1, mode)
      assert.ok(result.ms < 2_000, `${mode}: hook took ${result.ms} ms`)
    } finally {
      await close(server)
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
})

test('the status request keeps its method, path, headers and body (external contract)', async () => {
  const { server, received } = await eventServer()
  const { home, hookPath } = hookHome(server)
  try {
    const before = Date.now()
    await runHook(hookPath, home, { ...STOP, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    assert.equal(received.length, 1)
    const [request] = received
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/events')
    assert.equal(request.headers['content-type'], 'application/json')
    assert.equal(request.headers['x-agent-pets-token'], EVENT_TOKEN)
    // app 會拒絕帶 Origin 的請求（擋瀏覽器偽造），hook 不能送這個標頭。
    assert.equal(request.headers.origin, undefined)
    const { timestamp, ...rest } = request.body
    assert.ok(typeof timestamp === 'number' && timestamp >= before && timestamp <= Date.now())
    assert.deepEqual(rest, {
      source: 'claude',
      sessionId: 'delivery-session',
      project: '/tmp/delivery-project',
      state: 'tool-running',
      originalEvent: 'PreToolUse',
      toolName: 'Bash',
    })
  } finally {
    await close(server)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// --- app 冷啟動：埠還沒開始監聽時送出的事件 -------------------------------------
// app 一啟動就寫 ~/.desktop-pet/event-port-<埠>.starting（electron/main/hook-startup-marker.ts，檔名用同一個函式產生）。
// hook 連線被拒時，只有這個標記夠新才短暫重試；寵物沒開（沒有標記或標記過期）就立刻結束。

function freePort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

function hookHomeForPort(port: number): { home: string; hookPath: string; marker: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-startup-'))
  fs.mkdirSync(path.join(home, '.desktop-pet'))
  fs.writeFileSync(path.join(home, '.desktop-pet', 'event-token'), `${EVENT_TOKEN}\n`)
  const source = fs.readFileSync(HOOK_SOURCE, 'utf8')
  const patched = source.replace('127.0.0.1:17373', `127.0.0.1:${port}`)
  assert.notEqual(patched, source, 'agent-hook.mjs event URL changed; update the test patch')
  const hookPath = path.join(home, 'agent-hook.mjs')
  fs.writeFileSync(hookPath, patched)
  return { home, hookPath, marker: path.join(home, '.desktop-pet', hookStartupMarkerName(port)) }
}

async function listenOn(port: number, received: Received[]): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      received.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      response.writeHead(204)
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  return server
}

test('an event sent while the app is still starting arrives once its port opens', async () => {
  const port = await freePort()
  const { home, hookPath, marker } = hookHomeForPort(port)
  fs.writeFileSync(marker, '1\n')
  const received: Received[] = []
  let server: Server | null = null
  try {
    const run = runHook(hookPath, home, STOP)
    // 埠在 hook 啟動之後才開，hook 第一次連線一定被拒。
    await new Promise(resolve => setTimeout(resolve, 700))
    server = await listenOn(port, received)
    const result = await run
    assert.equal(result.code, 0)
    assert.equal(received.length, 1, 'the event sent before the port opened was lost')
    assert.equal(received[0].body.state, 'success')
  } finally {
    if (server) await close(server)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('with the pet closed the hook does not wait, even if a crash left an old marker', async () => {
  for (const marker of ['none', 'stale'] as const) {
    const port = await freePort()
    const { home, hookPath, marker: markerPath } = hookHomeForPort(port)
    if (marker === 'stale') {
      fs.writeFileSync(markerPath, '1\n')
      const old = new Date(Date.now() - 5 * 60_000)
      fs.utimesSync(markerPath, old, old)
    }
    try {
      const result = await runHook(hookPath, home, STOP)
      assert.equal(result.code, 0, marker)
      // 只多一次 lstat；這裡的上限只是擋住「誤把重試打開」，耗時量測見 docs/dev/hook-delivery.md。
      assert.ok(result.ms < 1_000, `${marker}: hook took ${result.ms} ms`)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
})

test('a starting app that never opens its port holds the hook for a bounded time only', async () => {
  const port = await freePort()
  const { home, hookPath, marker } = hookHomeForPort(port)
  fs.writeFileSync(marker, '1\n')
  try {
    const result = await runHook(hookPath, home, STOP)
    assert.equal(result.code, 0)
    assert.ok(result.ms < 6_500, `hook took ${result.ms} ms`)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// --- 權限回覆：機器很忙時也要把請求送到寵物 ----------------------------------------

test('a permission request still reaches the pet when the hook is stalled right after sending starts', async () => {
  const { server: events } = await eventServer()
  const permissionCalls: string[] = []
  const permission = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const route = (request.url ?? '').replace('/v1/permission/', '')
      permissionCalls.push(route)
      response.setHeader('content-type', 'application/json')
      if (route === 'request') { response.writeHead(201); response.end('{}'); return }
      if (route === 'decision') { response.writeHead(200); response.end(JSON.stringify({ decision: 'deny', decisionId: 'decision-1' })); return }
      response.writeHead(204)
      response.end()
    })
  })
  await new Promise<void>(resolve => permission.listen(0, '127.0.0.1', resolve))
  const { home, hookPath } = hookHome(events)
  fs.writeFileSync(hookPath, fs.readFileSync(hookPath, 'utf8').replace('127.0.0.1:17374', `127.0.0.1:${(permission.address() as AddressInfo).port}`))
  fs.writeFileSync(path.join(home, '.desktop-pet', 'permission-token'), `${'a'.repeat(64)}\n`)
  fs.writeFileSync(path.join(home, '.desktop-pet', 'claude-permission-respond'), JSON.stringify({ enabled: true, waitSeconds: 15 }))
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', stallPreload(home, 1_100), hookPath, 'claude'], {
        env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', chunk => { out += chunk })
      child.stderr.on('data', chunk => { err += chunk })
      child.on('error', reject)
      child.on('close', () => err.trim() ? reject(new Error(`hook wrote to stderr: ${err}`)) : resolve(out))
      child.stdin.end(JSON.stringify({ ...STOP, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }))
    })
    // 回覆格式不變：拒絕時帶固定的 DENY_MESSAGE。
    assert.deepEqual(JSON.parse(stdout), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied in Agent Pets. (已在 Agent Pets 拒絕)' } },
    })
    assert.deepEqual(permissionCalls, ['request', 'decision', 'result'])
  } finally {
    await close(events)
    await close(permission)
    fs.rmSync(home, { recursive: true, force: true })
  }
})
