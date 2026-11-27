#!/usr/bin/env node
// 本機執行請一律加 --offscreen，視窗才不會出現在螢幕上。
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = resolve(import.meta.dirname, '..')
const { DEPLOY_DIR_NAME, DEPLOY_FILES, LOCAL_WIRE_HEADERS, LOCAL_WIRE_HOST, LOCAL_WIRE_PATHS } =
  await import(pathToFileURL(join(repoRoot, 'src/types/local-wire.ts')).href)

function freePort() {
  return new Promise((done, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, LOCAL_WIRE_HOST, () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`)
  return value
}
// 預設值刻意避開隔離啟動器的 27373／9348／9349，本機同時跑其他 e2e 也不衝突。
const hookPortBase = argValue('--hook-port-base', 28_573)
// 沒指定的埠向作業系統要空閒埠，避免連到其他工作樹正在跑的 app。
const inspectPort = process.argv.includes('--inspect-port') ? argValue('--inspect-port') : await freePort()
const debugPort = process.argv.includes('--debug-port') ? argValue('--debug-port') : await freePort()
const timeoutMs = argValue('--timeout', 60) * 1000
const offscreen = process.argv.includes('--offscreen')
// 部分 macOS 環境（例如沒有 GUI session 的沙盒）連空白的 Electron app 呼叫 app.quit() 都可能卡住，與本 app 無關。
const tolerateQuitHang = process.argv.includes('--tolerate-quit-hang')

const EXPECTED_STATE = 'thinking'
const SESSION_ID = `ci-smoke-${Date.now().toString(36)}`
const QUIT_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 5_000
// --timeout 之外還要容納 session 狀態（15 秒）與退出（20 秒）的等待。
const WATCHDOG_SLACK_MS = 60_000

let log = ''
let launcher = null
let appPid = null
let root = null

function fail(message) {
  throw new Error(message)
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

const TIMED_OUT = Symbol('timed out')
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise(resolvePromise => { timer = setTimeout(() => resolvePromise(TIMED_OUT), Math.max(ms, 0)) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function waitFor(description, check, ms = timeoutMs) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await withTimeout(Promise.resolve().then(check), deadline - Date.now())
    if (value === TIMED_OUT) fail(`timed out waiting for ${description}`)
    if (value) return value
    if (launcher?.exitCode !== null && launcher?.exitCode !== undefined) fail(`app exited early (code ${launcher.exitCode}) while waiting for ${description}`)
    if (Date.now() > deadline) fail(`timed out waiting for ${description}`)
    await sleep(100)
  }
}

async function evaluate(port, targetFilter, expression) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal })).json()
  const target = targets.find(targetFilter)
  if (!target) throw new Error('inspector target not ready')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let timer
  try {
    return await new Promise((done, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`inspector request timed out after ${REQUEST_TIMEOUT_MS} ms`), { timedOut: true })), REQUEST_TIMEOUT_MS)
      let opened = false
      ws.addEventListener('open', () => {
        opened = true
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      }, { once: true })
      ws.addEventListener('error', () => reject(new Error('inspector socket error')), { once: true })
      ws.addEventListener('message', event => {
        const data = JSON.parse(String(event.data))
        if (data.id !== 1) return
        if (data.error || data.result?.exceptionDetails) reject(new Error(JSON.stringify(data.error ?? data.result.exceptionDetails.text)))
        else done(data.result?.result?.value)
      })
      // app.quit() 會讓 socket 在回應前就關閉，視為成功送達；連線尚未建立就關閉則是失敗。
      ws.addEventListener('close', () => (opened ? done(undefined) : reject(new Error('inspector socket closed before opening'))), { once: true })
    })
  } finally {
    clearTimeout(timer)
    ws.close()
  }
}

const rendererState = sessionId => evaluate(debugPort, t => t.type === 'page' && t.url.endsWith('index.html'), `(() => {
  const store = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('agent')
  if (!store) return { ready: false }
  const session = Object.values(store.sessions).find(s => s.sessionId === ${JSON.stringify(sessionId)})
  return { ready: true, state: session?.state ?? null }
})()`).then(value => value ?? { ready: false }, () => ({ ready: false }))

// Windows 要連同子程序一起結束。
function killApp() {
  if (appPid === null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(appPid), '/t', '/f'], { stdio: 'ignore' })
  else { try { process.kill(appPid, 'SIGKILL') } catch {} }
  try { launcher?.kill() } catch {}
}

// 只刪這個啟動器自己在系統暫存目錄建立的 root；目錄被 Electron 短暫佔用時重試。
function removeRoot() {
  if (!root || !basename(root).startsWith('agent-pets-e2e-') || !existsSync(root)) return
  if (realpathSync(dirname(root)) !== realpathSync(tmpdir())) return
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

const portFree = port => new Promise(done => {
  const server = createServer()
  server.once('error', () => done(false))
  server.listen(port, LOCAL_WIRE_HOST, () => server.close(() => done(true)))
})

// 埠被佔用時會連到別的 app，把事件或退出指令送錯對象。
async function assertPortsFree(ports) {
  for (const port of ports) {
    if (!(await portFree(port))) fail(`port ${port} is already in use; choose another with --hook-port-base/--inspect-port/--debug-port`)
  }
}

async function main() {
  await assertPortsFree([hookPortBase, hookPortBase + 1, hookPortBase + 2, inspectPort, debugPort])
  launcher = spawn(process.execPath, [
    join(repoRoot, 'scripts/e2e-isolated-electron.mjs'),
    '--hook-port-base', String(hookPortBase),
    '--inspect-port', String(inspectPort),
    '--debug-port', String(debugPort),
    ...(offscreen ? ['--offscreen'] : []),
  ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise(resolvePromise => launcher.once('exit', (code, signal) => resolvePromise({ code, signal })))
  for (const stream of [launcher.stdout, launcher.stderr]) stream.on('data', chunk => { log += chunk })

  const info = await waitFor('launcher info', () => {
    const line = log.split('\n').find(text => text.startsWith('{"root"'))
    return line ? JSON.parse(line) : null
  })
  root = info.root
  appPid = info.pid
  await waitFor('AGENT_PETS_E2E_READY', () => log.includes('AGENT_PETS_E2E_READY'))
  if (log.includes('AGENT_PETS_E2E_ABORT')) fail('isolation check aborted the app')
  await waitFor('event server listening', () => log.includes(`listening on http://${LOCAL_WIRE_HOST}:${hookPortBase}${LOCAL_WIRE_PATHS.events}`))

  const tokenPath = join(root, 'home', DEPLOY_DIR_NAME, DEPLOY_FILES.eventToken)
  const token = (await waitFor('event token file', () => existsSync(tokenPath) && readFileSync(tokenPath, 'utf8').trim())).trim()
  await waitFor('renderer agent store', async () => (await rendererState(SESSION_ID)).ready)

  const response = await fetch(`http://${LOCAL_WIRE_HOST}:${hookPortBase}${LOCAL_WIRE_PATHS.events}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [LOCAL_WIRE_HEADERS.eventToken]: token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      source: 'claude',
      sessionId: SESSION_ID,
      project: 'ci-smoke',
      state: EXPECTED_STATE,
      originalEvent: 'UserPromptSubmit',
      timestamp: Date.now(),
    }),
  })
  if (response.status !== 204) fail(`event POST returned HTTP ${response.status}, expected 204`)

  const seen = await waitFor(`session state "${EXPECTED_STATE}"`, async () => {
    const { state } = await rendererState(SESSION_ID)
    return state === EXPECTED_STATE ? state : null
  }, 15_000)
  console.log(`SMOKE OK: event accepted (204), renderer store shows session ${SESSION_ID} as ${seen}`)

  // inspector 掛在主程序的 bootstrap.cjs（CJS），所以 process.mainModule 可用。
  // 送出後主程序可能不回應也不關 socket；逾時不算失敗，交給下面的退出時限判斷。
  await evaluate(inspectPort, () => true, `process.mainModule.require('electron').app.quit()`).catch(error => {
    if (!error.timedOut) throw error
    console.warn(`SMOKE WARN: ${error.message}; waiting for the app to exit anyway`)
  })
  const outcome = await Promise.race([exited, sleep(QUIT_TIMEOUT_MS).then(() => null)])
  if (!outcome) {
    const teardownRan = await portFree(hookPortBase)
    if (!(tolerateQuitHang && teardownRan)) fail(`app did not exit within ${QUIT_TIMEOUT_MS / 1000}s after app.quit()`)
    console.warn('SMOKE WARN: shutdown ran (event port closed) but the process did not exit; killing it (--tolerate-quit-hang)')
    return
  }
  if (outcome.code !== 0) fail(`app exited with code ${outcome.code ?? outcome.signal}`)
  appPid = null
  console.log('SMOKE OK: app quit cleanly (exit 0)')
}

const printLogTail = () => {
  console.error('--- app log tail ---')
  console.error(log.split('\n').slice(-60).join('\n'))
}

// 任何一步卡住時要自己結束，免得拖到 job 逾時才被取消（連日誌都看不到）。
const watchdog = setTimeout(() => {
  process.exitCode = 1
  console.error(`SMOKE FAIL: watchdog fired after ${(timeoutMs + WATCHDOG_SLACK_MS) / 1000}s; the smoke test is hung`)
  printLogTail()
  killApp()
  try { removeRoot() } catch (error) { console.error(`SMOKE WARN: could not remove temp root: ${error.message}`) }
  process.exit(1)
}, timeoutMs + WATCHDOG_SLACK_MS)

try {
  await main()
} catch (error) {
  process.exitCode = 1
  console.error(`SMOKE FAIL: ${error.message}`)
  printLogTail()
} finally {
  clearTimeout(watchdog)
  killApp()
  removeRoot()
}
