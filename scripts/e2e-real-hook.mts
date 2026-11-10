#!/usr/bin/env node
// 真實 hook e2e：搭配 scripts/e2e-isolated-electron.mjs 使用，不碰使用者的 ~/.claude、正式版的埠或鑰匙圈。
// 在隔離 HOME 執行真正的安裝程式（產生隔離的 Claude Code settings 與 agent-hook.mjs），照 Claude Code 的方式
// 從那份 settings 讀出 hook 指令、以 stdin 送 payload，再經 CDP 讀寵物畫面。可選的寵物包會先經主程序 loadPets 清理。
// 用法（先 pnpm exec vite build，並用預設隔離埠啟動 node scripts/e2e-isolated-electron.mjs）：
//   node --experimental-strip-types scripts/e2e-real-hook.mts --home <啟動日誌的 home> [--debug-port 9348]
//        [--hook-port-base 27373] [--pet-pack] [--rounds 1]
// --rounds N 把整組 8 個事件重複 N 輪（每輪換新 session），用來大量確認每個事件都畫到寵物上。
// 冷啟動模式（先結束隔離 app，HOME 要是跑過一次這支腳本的）：
//   node --experimental-strip-types scripts/e2e-real-hook.mts --home <home> --cold-start 150 [--interval 40]
// 以 --reuse-root 重新啟動隔離 app，從啟動那一刻起每 --interval ms 對一個新 session 送一個 Stop，
// 最後檢查每個 session 是否都出現在寵物的 store，並列出 hook 耗時。
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const home = arg('--home')
const cdpPort = arg('--debug-port', '9348')
const portBase = Number(arg('--hook-port-base', '27373'))
const withPetPack = process.argv.includes('--pet-pack')
const rounds = Number(arg('--rounds', '1'))
const coldStart = Number(arg('--cold-start', '0'))
const coldInterval = Number(arg('--interval', '40'))
assert.ok(Number.isInteger(coldStart) && coldStart >= 0 && coldStart <= 1000, '--cold-start must be an integer between 0 and 1000')
assert.ok(Number.isInteger(coldInterval) && coldInterval >= 5 && coldInterval <= 1000, '--interval must be an integer between 5 and 1000')
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 500, '--rounds must be an integer between 1 and 500')
assert.ok(Number.isInteger(portBase) && portBase >= 1024 && portBase <= 65533 && portBase !== 17373, 'use the isolated ports, never 17373')
const realHome = os.homedir()
assert.ok(home && fs.existsSync(path.join(home, '.desktop-pet', 'event-token')) && !home.startsWith(realHome + path.sep) && home !== realHome, 'isolated HOME required')

const { configureSetupEnvironment } = await import(path.join(repoRoot, 'electron/setup-environment.ts'))
const { hookStartupMarkerName } = await import(path.join(repoRoot, 'electron/main/hook-startup-marker.ts'))
const setup = await import(path.join(repoRoot, 'electron/setup.ts'))
configureSetupEnvironment({
  homeDir: () => home,
  appData: () => path.join(home, 'AppData'),
  userData: () => path.join(home, 'userData'),
  isPackaged: () => false,
  integrationsDir: () => path.join(repoRoot, 'integrations'),
  nodePath: () => process.execPath,
})
const settingsPath: string = setup.claudeCodeSettingsPath()
const hookPath: string = setup.hookScriptPath()
for (const target of [settingsPath, hookPath]) {
  assert.ok(target.startsWith(home + path.sep), `refusing to write outside the isolated HOME: ${target}`)
}
setup.installIntegration('claudeCode')

// 已安裝的腳本寫死 17373/17374；隔離 app 聽在 portBase，只改這兩個網址。
const deployed = fs.readFileSync(hookPath, 'utf8')
const patched = deployed
  .replace('http://127.0.0.1:17373/v1/events', `http://127.0.0.1:${portBase}/v1/events`)
  .replace('http://127.0.0.1:17374/v1/permission', `http://127.0.0.1:${portBase + 1}/v1/permission`)
assert.equal(deployed.split('\n').filter((line, i) => line !== patched.split('\n')[i]).length, 2)
fs.writeFileSync(hookPath, patched)

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const eventsInSettings = Object.keys(settings.hooks)
console.log(JSON.stringify({ settingsPath: settingsPath.replace(home, '<HOME>'), events: eventsInSettings }))

async function cdp(expression: string): Promise<unknown> {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const target = targets.find(t => t.type === 'page' && t.url.endsWith('index.html'))!
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve))
  return new Promise(resolve => {
    ws.addEventListener('message', event => {
      const data = JSON.parse(String(event.data))
      if (data.id !== 1) return
      ws.close()
      resolve(data.result?.result?.value)
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
}

function runHook(eventName: string, payload: Record<string, unknown>): number | null {
  const entry = settings.hooks[eventName]?.[0]?.hooks?.[0]
  assert.ok(entry?.type === 'command', `no command hook for ${eventName}`)
  const result = spawnSync(entry.command, entry.args ?? [], {
    input: JSON.stringify({ hook_event_name: eventName, ...payload }),
    // Claude Code 會帶自己的環境；這裡只給最小環境，不帶任何帳號或 CLAUDE_* 變數。
    env: { PATH: process.env.PATH ?? '', HOME: home },
    timeout: 10_000,
  })
  return result.status
}

const PEEK = (sessionId: string) => `(async () => {
  await new Promise(r => setTimeout(r, 900))
  const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')
  const c = document.querySelector('canvas[data-animation-action]')
  const s = Object.values(store.sessions).find(x => x.sessionId === ${JSON.stringify(sessionId)})
  return { session: s?.state ?? null, current: store.currentState, pet: store.activePetId, draw: c.dataset.animationAction + '@' + c.dataset.animationRow }
})()`

function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

const percentile = (sorted: number[], p: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

async function runColdStart(): Promise<void> {
  assert.ok(!(await portOpen(portBase)), `port ${portBase} is in use; stop the isolated app first`)
  // app 啟動時會把部署的 hook 換回寫死 17373 的版本；冷啟動要用一份不會被覆寫的副本，
  // 否則重啟途中的事件會送到正式版的埠。指令和參數照 settings，只把腳本路徑換成這份副本。
  const coldHook = path.join(home!, '.desktop-pet-e2e', 'agent-hook.mjs')
  fs.mkdirSync(path.dirname(coldHook), { recursive: true })
  fs.writeFileSync(coldHook, patched)
  const entry = settings.hooks.Stop?.[0]?.hooks?.[0]
  assert.ok(entry?.type === 'command', 'no command hook for Stop')
  const swap = (value: string) => value.split(hookPath).join(coldHook)
  const command = swap(entry.command)
  const args = (entry.args ?? []).map((value: string) => swap(value))
  assert.ok([command, ...args].some(value => value.includes(coldHook)), 'hook path not found in the Stop command')

  const launcher = spawn(process.execPath, [path.join(repoRoot, 'scripts/e2e-isolated-electron.mjs'),
    '--reuse-root', path.dirname(home!), '--hook-port-base', String(portBase), '--debug-port', cdpPort!, '--inspect-port', String(Number(cdpPort) + 1)], {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const startedAt = performance.now()
  // 各階段時間點（相對於啟動器開始）：Electron 程序建立、隔離 bootstrap 跑完（接著載入 main.js）、
  // 啟動標記出現、事件埠開始監聽。啟動器自己產生測試用插件的時間也算在裡面，正式版沒有這段。
  const marks: Record<string, number | null> = { electronSpawned: null, mainLoading: null, markerWritten: null, listening: null }
  const markerPath = path.join(home!, '.desktop-pet', hookStartupMarkerName(portBase))
  fs.rmSync(markerPath, { force: true })
  const markerPoll = setInterval(() => {
    if (marks.markerWritten === null && fs.existsSync(markerPath)) marks.markerWritten = performance.now() - startedAt
  }, 5)
  let log = ''
  const seen = (key: string, text: string) => { if (marks[key] === null && log.includes(text)) marks[key] = performance.now() - startedAt }
  for (const stream of [launcher.stdout, launcher.stderr]) {
    stream.on('data', chunk => {
      log += chunk
      seen('electronSpawned', '"pid":')
      seen('mainLoading', 'AGENT_PETS_E2E_READY')
      seen('listening', `listening on http://127.0.0.1:${portBase}/v1/events`)
    })
  }
  const launcherExited = new Promise(resolve => launcher.once('exit', resolve))
  try {
    await measureColdStart(startedAt, marks, markerPoll, command, args)
  } finally {
    clearInterval(markerPoll)
    launcher.kill('SIGTERM')
    await launcherExited
  }
}

async function measureColdStart(startedAt: number, marks: Record<string, number | null>, markerPoll: ReturnType<typeof setInterval>, command: string, args: string[]): Promise<void> {
  const listeningAtMs = () => marks.listening

  const sessionTag = `cold-${Date.now().toString(36)}`
  const results: Array<{ sentAt: number; ms: number; code: number | null }> = []
  const runs: Promise<void>[] = []
  for (let i = 0; i < coldStart; i += 1) {
    const due = startedAt + i * coldInterval
    await new Promise(resolve => setTimeout(resolve, Math.max(0, due - performance.now())))
    runs.push(new Promise(resolve => {
      const sentAt = performance.now() - startedAt
      const child = spawn(command, args, { env: { PATH: process.env.PATH ?? '', HOME: home }, stdio: ['pipe', 'ignore', 'ignore'] })
      child.once('exit', code => { results[i] = { sentAt, ms: performance.now() - startedAt - sentAt, code }; resolve() })
      child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: `${sessionTag}-${i}`, cwd: '/tmp/hook-e2e' }))
    }))
  }
  await Promise.all(runs)
  for (let waited = 0; listeningAtMs() === null && waited < 30_000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  clearInterval(markerPoll)
  const listeningAt = listeningAtMs()
  assert.ok(listeningAt !== null, 'the isolated app never listened on the event port')
  await new Promise(resolve => setTimeout(resolve, 1500))
  // main 是主程序的 session 鏡像（app 收到幾個），store 是寵物畫面（renderer 收到幾個），分開算才知道掉在哪一層。
  const { main, store: states } = await cdp(`(async () => {
    const tag = ${JSON.stringify(sessionTag)}
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')
    const seen = {}
    for (const s of Object.values(store.sessions)) if (String(s.sessionId).startsWith(tag)) seen[s.sessionId] = s.state
    const main = (await window.electronAPI.getSessionSnapshot()).filter(s => String(s.sessionId).startsWith(tag)).map(s => s.sessionId)
    return { main, store: seen }
  })()`) as { main: string[]; store: Record<string, string> }

  // 每個 session 只送一個 Stop，所以 session 出現就代表送達；success 顯示 4 秒後會自己轉成 idle（SUCCESS_DISPLAY_MS）。
  const delivered = (state: string | undefined) => state === 'success' || state === 'idle'
  const lost = results.map((result, i) => ({ i, ...result })).filter(({ i }) => !delivered(states[`${sessionTag}-${i}`]))
  const before = results.filter(result => result.sentAt < listeningAt).map(result => result.ms).sort((a, b) => a - b)
  const after = results.filter(result => result.sentAt >= listeningAt).map(result => result.ms).sort((a, b) => a - b)
  const describe = (list: number[]) => `n=${list.length} p50=${Math.round(percentile(list, 0.5))} p95=${Math.round(percentile(list, 0.95))} max=${Math.round(list.at(-1) ?? 0)} ms`
  console.log(JSON.stringify({
    phasesMs: Object.fromEntries(Object.entries(marks).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    total: coldStart,
    receivedByApp: main.length,
    delivered: coldStart - lost.length,
    lostSentAtMs: lost.map(({ sentAt }) => Math.round(sentAt)),
    nonZeroExit: results.filter(result => result.code !== 0).length,
  }))
  console.log(`hook duration, sent before the port opened: ${describe(before)}`)
  console.log(`hook duration, sent after the port opened:  ${describe(after)}`)
  console.log(lost.length === 0 ? `all ${coldStart} cold-start events arrived` : `${lost.length} of ${coldStart} cold-start events were lost`)
  process.exitCode = lost.length === 0 ? 0 : 1
}

if (coldStart > 0) {
  await runColdStart()
  process.exit()
}

// 寵物包：刻意混入不合法的值，驗證主程序清理與畫面端回退。
if (withPetPack) {
  const dir = path.join(home, '.desktop-pet', 'custom', 'atlas-pack')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'public/pets/aang-airbender/spritesheet.webp'), path.join(dir, 'spritesheet.webp'))
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({
    id: 'atlas-pack', displayName: 'Atlas Pack', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2, kind: 'person',
    behaviorManifest: {
      idle: { row: 9, frames: 4, frameDurations: [200, 10, 99_999, 150] },
      waving: { row: 3, frameDurations: [140, 'x'] },
      review: { row: 10, frames: 6 },
      running: { row: 40 },
      failed: { row: 2, frames: 99 },
      waiting: { row: -1 },
      walk: { row: 1 },
      bogus: { row: 3 },
    },
  }))
  const loaded = await cdp(`(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')
    await store.loadPets()
    store.setPet('atlas-pack')
    const raw = await window.electronAPI.loadPets()
    await new Promise(r => setTimeout(r, 1500))
    return JSON.stringify(raw.find(p => p.id === 'atlas-pack')?.behaviorManifest ?? null)
  })()`)
  console.log('manifest from main:', loaded)
}

// [hook 事件, payload, 預期 session 狀態, 內建寵物畫的列, 寵物包畫的列]
type Step = [string, Record<string, unknown>, string, string, string]
const stepsFor = (base: Record<string, unknown>): Step[] => [
  ['SessionStart', base, 'idle', 'idle@0', 'idle@9'],
  ['UserPromptSubmit', { ...base, prompt: 'x' }, 'thinking', 'review@8', 'review@10'],
  ['PreToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }, 'tool-running', 'running@7', 'running@7'],
  ['PostToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }, 'thinking', 'review@8', 'review@10'],
  ['Notification', { ...base, message: 'Claude is waiting for your input' }, 'waiting-input', 'waiting@6', 'waiting@6'],
  ['StopFailure', base, 'error', 'failed@5', 'failed@5'],
  ['Stop', base, 'success', 'jumping@4', 'jumping@4'],
  ['SessionEnd', base, 'offline', 'idle@0', 'idle@9'],
]
const runTag = Date.now().toString(36)
let failures = 0
let total = 0
for (let round = 0; round < rounds; round += 1) {
  const sessionId = `hook-e2e-${runTag}-${round}`
  for (const [eventName, payload, expectedState, builtinDraw, packDraw] of stepsFor({ session_id: sessionId, cwd: '/tmp/hook-e2e' })) {
    const status = runHook(eventName, payload)
    const seen = await cdp(PEEK(sessionId)) as { session: string | null; draw: string }
    const expectedDraw = withPetPack ? packDraw : builtinDraw
    const ok = status === 0 && seen.session === expectedState && seen.draw === expectedDraw
    total += 1
    if (!ok) failures += 1
    if (!ok || rounds === 1) {
      console.log(ok ? 'ok  ' : 'FAIL', `r${round}`, eventName.padEnd(17), `exit=${status}`, JSON.stringify(seen), ok ? '' : `expected ${expectedState} ${expectedDraw}`)
    }
  }
}
console.log(failures === 0 ? `all ${total} hook events rendered as expected` : `${failures} of ${total} hook events did not match`)
process.exitCode = failures === 0 ? 0 : 1
