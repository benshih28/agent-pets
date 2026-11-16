#!/usr/bin/env node
// Test-only launcher: starts the built app in a throw-away HOME and userData, with a
// fake safeStorage installed BEFORE any app code runs, so automated runs never touch
// the user's real data or macOS Keychain. Usage:
//   pnpm exec vite build
//   node scripts/e2e-isolated-electron.mjs [--inspect-port 9349] [--debug-port 9348] [--app-root <dir>]
//                                          [--hook-port-base 27373 | --real-hook-ports]（說明見下）
//                                          [--reuse-root <上次啟動日誌的 root>]
//                                          [--app-update-fixture newer|current|failed]（App 新版檢查的假 GitHub release 回應；預設 current）
// --reuse-root 沿用上一次的暫時 HOME 與 userData 重新啟動（token 與已安裝的 hook 都還在），用來量測 app 冷啟動。
// --agent-config-dirs 帶上指向隔離 HOME 內 moved/ 的 CLAUDE_CONFIG_DIR／CODEX_HOME／XDG_CONFIG_HOME，
// 驗證 app 讀寫搬走的 agent 設定目錄；搭配 scripts/e2e-real-hook.mts --agent-config-dirs。
// --offscreen 讓 app 看到的每個顯示器都位在螢幕外（同尺寸、x 往左移 20000），所有視窗改用 showInactive()
// 且不 focus，驗證過程不會把視窗帶到使用者面前；每個 BrowserWindow 的建立參數記在
// globalThis.__agentPetsE2E.createdWindows（例如寵物視窗的冷啟動尺寸）。也會轉傳 PET_SCALE。
// --app-root runs another copy of the app (e.g. an extracted packaged app.asar) instead of this repo.
// Prints one JSON line with the temp root, ports and pid, then keeps running.
// 測試 app 預設使用自己的本機埠（event／permission／presentation = base、base+1、base+2，base 為 27373），
// 不會搶走已安裝 Agent Pets 的 17373–17375，也收不到使用者真實的 hook 事件。這裡一律以
// node_modules 的 Electron 執行（app.isPackaged 為 false），所以 app 會讀 AGENT_PETS_*_PORT
// （electron/main/ports.ts）。例外：--app-root 指向在這組環境變數出現之前建置的版本時仍會綁定預設埠，
// 請看啟動日誌的「listening on」確認。--real-hook-ports 刻意使用預設埠，給需要真實 hook 的測試；這類測試請盡量縮短。
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { zipSync } from 'fflate'

const repoRoot = resolve(import.meta.dirname, '..')
const argString = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null
}
const argValue = (name, fallback) => {
  const value = argString(name)
  return value ? Number(value) : fallback
}
const inspectPort = argValue('--inspect-port', 9349)
const debugPort = argValue('--debug-port', 9348)
const appRoot = resolve(argString('--app-root') ?? repoRoot)
const realHookPorts = process.argv.includes('--real-hook-ports')
const hookPortBase = argValue('--hook-port-base', 27373)
if (!realHookPorts && !(Number.isInteger(hookPortBase) && hookPortBase >= 1024 && hookPortBase <= 65533)) {
  console.error('--hook-port-base must be an integer between 1024 and 65533')
  process.exit(1)
}
const hookPortEnv = realHookPorts ? {} : {
  AGENT_PETS_EVENT_PORT: String(hookPortBase),
  AGENT_PETS_PERMISSION_PORT: String(hookPortBase + 1),
  AGENT_PETS_PRESENTATION_PORT: String(hookPortBase + 2),
}
const mainBundle = join(appRoot, 'dist-electron', 'main.js')
if (!existsSync(mainBundle)) {
  console.error(`${mainBundle} not found; run \`pnpm exec vite build\` first (or check --app-root)`)
  process.exit(1)
}

function readPluginFixture(pluginId) {
  const fixtureRoot = join(repoRoot, 'tests', 'fixtures', 'plugins', pluginId)
  const files = new Map()
  const walk = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) walk(absolutePath, relativePath)
      else if (entry.isFile()) files.set(relativePath, new Uint8Array(readFileSync(absolutePath)))
    }
  }
  walk(fixtureRoot)
  return files
}

function signaturePayload(files) {
  return Buffer.from([...files.entries()]
    .filter(([path]) => path !== 'signature.json')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, bytes]) => `${path}\t${createHash('sha256').update(bytes).digest('hex')}\n`)
    .join(''), 'utf8')
}

function signFixture(pluginId, version, keyPair, tamperAfterSigning = false) {
  const files = readPluginFixture(pluginId)
  const manifest = JSON.parse(Buffer.from(files.get('plugin.json')).toString('utf8'))
  manifest.version = version
  files.set('plugin.json', Buffer.from(JSON.stringify(manifest), 'utf8'))
  const publicKey = new Uint8Array(keyPair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
  const signature = cryptoSign(null, signaturePayload(files), keyPair.privateKey)
  files.set('signature.json', Buffer.from(JSON.stringify({
    alg: 'ed25519',
    publicKey: Buffer.from(publicKey).toString('base64'),
    signature: signature.toString('base64'),
  }), 'utf8'))
  if (tamperAfterSigning) files.set('dist/main.js', Buffer.from('api.log.info("tampered after signing")', 'utf8'))
  return {
    archive: zipSync(Object.fromEntries(files), { level: 6 }),
    fingerprint: createHash('sha256').update(publicKey).digest('hex').slice(0, 16),
  }
}

function createCatalogFixture(root) {
  const firstKey = generateKeyPairSync('ed25519')
  const rotatedKey = generateKeyPairSync('ed25519')
  const first = signFixture('ok-signed', '1.0.0', firstKey)
  const update = signFixture('ok-signed', '1.0.1', firstKey)
  const rotated = signFixture('ok-signed-rotated', '1.0.2', rotatedKey)
  const tampered = signFixture('evil-signed-tampered', '1.0.0', firstKey, true)
  const packageBase = 'https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/packages'
  const packages = [
    { version: '1.0.0', result: first },
    { version: '1.0.1', result: update },
    { version: '1.0.2', result: rotated },
  ].map(({ version, result }) => ({
    version,
    url: `${packageBase}/ok-signed-${version}.agentpet-plugin`,
    result,
  }))
  const catalogVersion = ({ version, url, result }) => ({
    version,
    apiVersion: '1',
    url,
    sha256: createHash('sha256').update(result.archive).digest('hex'),
    size: result.archive.byteLength,
    publishedAt: `2026-10-26T00:00:00.000Z`,
  })
  const plugin = (fingerprint, versions) => ({
    id: 'ok-signed',
    name: { 'zh-TW': '簽章驗證插件', 'en-US': 'Signed Fixture' },
    description: { 'zh-TW': '只供隔離驗收使用', 'en-US': 'Isolated acceptance fixture only' },
    author: 'Agent Pets Test Fixture',
    publicKeyFingerprint: fingerprint,
    versions: versions.map(catalogVersion),
  })
  const registry = versions => JSON.stringify({
    schemaVersion: 1,
    plugins: [plugin(versions.at(-1).result.fingerprint, versions)],
  })
  const catalogFixture = {
    registry: registry([packages[0]]),
    registryProfiles: {
      initial: registry([packages[0]]),
      sameKeyUpdate: registry(packages.slice(0, 2)),
      rotatedKey: registry([packages[2]]),
    },
    downloads: Object.fromEntries(packages.map(({ url, result }) => [url, Buffer.from(result.archive).toString('base64')])),
  }
  const tamperedArchivePath = join(root, 'evil-signed-tampered.agentpet-plugin')
  writeFileSync(tamperedArchivePath, tampered.archive, { mode: 0o600 })
  return { catalogFixture, tamperedArchivePath }
}

const reuseRoot = argString('--reuse-root')
// 只接受這支腳本自己在暫存目錄建立過的 root，避免把使用者的資料夾當成測試 HOME。
const isReusableRoot = dir => existsSync(join(dir, 'home', '.desktop-pet', 'event-token')) && existsSync(join(dir, 'ud'))
  && basename(dir).startsWith('agent-pets-e2e-') && realpathSync(dirname(dir)) === realpathSync(tmpdir())
if (reuseRoot && !isReusableRoot(resolve(reuseRoot))) {
  console.error('--reuse-root must be a root printed by an earlier run of this script')
  process.exit(1)
}
const root = reuseRoot ? resolve(reuseRoot) : mkdtempSync(join(tmpdir(), 'agent-pets-e2e-'))
if (!reuseRoot) {
  mkdirSync(join(root, 'home'))
  mkdirSync(join(root, 'ud'))
}
// 只允許指向這個隔離 root 的值；bootstrap 的隔離檢查只放行完全相同的值。
const agentConfigEnv = process.argv.includes('--agent-config-dirs')
  ? {
      CLAUDE_CONFIG_DIR: join(root, 'home', 'moved', 'claude'),
      CODEX_HOME: join(root, 'home', 'moved', 'codex'),
      XDG_CONFIG_HOME: join(root, 'home', 'moved', 'xdg'),
    }
  : {}
for (const dir of [agentConfigEnv.CLAUDE_CONFIG_DIR, agentConfigEnv.CODEX_HOME]) if (dir) mkdirSync(dir, { recursive: true })
const { catalogFixture, tamperedArchivePath } = createCatalogFixture(root)
const offscreen = process.argv.includes('--offscreen')
// App 新版檢查在 e2e 只讀這份假回應，不會連網；newer 的版本號刻意遠高於任何真實版本。
const appUpdateFixtureMode = argString('--app-update-fixture') ?? 'current'
if (!['newer', 'current', 'failed'].includes(appUpdateFixtureMode)) {
  console.error('--app-update-fixture must be newer, current or failed')
  process.exit(1)
}
const appVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
const appUpdateFixture = appUpdateFixtureMode === 'failed'
  ? { status: 500, body: '{}' }
  : {
      status: 200,
      body: JSON.stringify({
        tag_name: appUpdateFixtureMode === 'newer' ? 'v999.0.0' : `v${appVersion}`,
        html_url: `https://github.com/Ponpon55837/agent-pets/releases/tag/${appUpdateFixtureMode === 'newer' ? 'v999.0.0' : `v${appVersion}`}`,
        draft: false,
        prerelease: false,
      }),
    }
const bootstrap = join(root, 'bootstrap.cjs')
writeFileSync(bootstrap, `
const path = require('node:path')
const electron = require('electron')
const { app, safeStorage, shell } = electron
const createdWindows = []
if (${offscreen}) {
  const RealBrowserWindow = electron.BrowserWindow
  class OffscreenBrowserWindow extends RealBrowserWindow {
    constructor(options = {}) {
      super({ ...options, show: false })
      createdWindows.push({ width: options.width, height: options.height, x: options.x, y: options.y })
      if (options.show !== false) this.showInactive()
    }
    show() { this.showInactive() }
    focus() {}
    // 原生的 getAllWindows() 只認得未衍生的 BrowserWindow。
    static getAllWindows() { return electron.BaseWindow.getAllWindows().filter(win => win instanceof RealBrowserWindow) }
  }
  // electron 模組的 BrowserWindow 不可重新定義，所以讓 app 的 require('electron') 拿到一個只換掉
  // BrowserWindow、其餘沿用原模組的物件。
  // screen 是 Proxy，直接改它的方法不會生效，所以同樣給 app 一個包裝：顯示器同尺寸，但 x 往左移 20000。
  let offscreenScreen = null
  const makeOffscreenScreen = () => {
    const real = electron.screen
    const shift = rect => ({ ...rect, x: rect.x - 20000 })
    const display = () => { const d = real.getPrimaryDisplay(); return { ...d, bounds: shift(d.bounds), workArea: shift(d.workArea) } }
    const overrides = {
      getPrimaryDisplay: display,
      getAllDisplays: () => [display()],
      getDisplayMatching: () => display(),
      getDisplayNearestPoint: () => display(),
    }
    return new Proxy(real, {
      get(target, key) {
        if (Object.hasOwn(overrides, key)) return overrides[key]
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  const shim = Object.create(electron, {
    BrowserWindow: { value: OffscreenBrowserWindow, enumerable: true },
    screen: { get: () => (offscreenScreen ??= makeOffscreenScreen()), enumerable: true },
  })
  const Module = require('node:module')
  const realLoad = Module._load
  Module._load = function (request, ...rest) {
    return request === 'electron' ? shim : realLoad.call(this, request, ...rest)
  }
  // 換不掉就中止，絕不在使用者螢幕上開視窗。
  const abortOffscreen = () => { console.error('AGENT_PETS_E2E_ABORT offscreen patch failed'); process.exit(1) }
  if (require('electron').BrowserWindow !== OffscreenBrowserWindow) abortOffscreen()
  app.whenReady().then(() => {
    if (require('electron').screen.getPrimaryDisplay().workArea.x > -10000) abortOffscreen()
  })
}
const root = ${JSON.stringify(root)}
const allowedAgentEnv = ${JSON.stringify(agentConfigEnv)}
const userData = path.join(root, 'ud')
app.setPath('userData', userData)
// Windows 在隔離 USERPROFILE 下取不到 appData（設定精靈的整合狀態會失敗），一樣指到隔離 root 內。
app.setPath('appData', path.join(root, 'home', 'AppData', 'Roaming'))
if (typeof app.setAppPath === 'function') app.setAppPath(${JSON.stringify(appRoot)})
const calls = { isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }
const shellOpenExternalCalls = []
shell.openExternal = async (url) => { shellOpenExternalCalls.push(String(url)) }
// 原生檔案對話框無法透過 CDP 操作；測試把絕對路徑排進這裡
// （globalThis.__agentPetsE2E.dialogQueue.push(path)），下一個開啟的對話框
// 會回傳第一個。佇列為空時則改用真正的對話框。
const { dialog } = require('electron')
const dialogQueue = []
const realShowOpenDialog = dialog.showOpenDialog.bind(dialog)
dialog.showOpenDialog = async (...args) => (dialogQueue.length > 0
  ? { canceled: false, filePaths: [String(dialogQueue.shift())] }
  : realShowOpenDialog(...args))
// 儲存對話框（主題匯出）同理：saveDialogQueue 的第一個路徑當作使用者選的檔案。
const saveDialogQueue = []
const realShowSaveDialog = dialog.showSaveDialog.bind(dialog)
dialog.showSaveDialog = async (...args) => (saveDialogQueue.length > 0
  ? { canceled: false, filePath: String(saveDialogQueue.shift()) }
  : realShowSaveDialog(...args))
safeStorage.isEncryptionAvailable = () => { calls.isEncryptionAvailable += 1; return true }
safeStorage.encryptString = (value) => { calls.encryptString += 1; return Buffer.from('agent-pets-e2e:' + value, 'utf8') }
safeStorage.decryptString = (value) => {
  calls.decryptString += 1
  const text = Buffer.from(value).toString('utf8')
  if (!text.startsWith('agent-pets-e2e:')) throw new Error('not an e2e ciphertext')
  return text.slice('agent-pets-e2e:'.length)
}
// The app reads Claude/Codex credentials through /usr/bin/security (the real login
// Keychain, which HOME isolation does not cover) and runs the claude/codex CLIs.
// Redirect those to /usr/bin/false so test runs can never read the user's Keychain
// or act with their accounts. Windows has no /usr/bin/false (spawn would raise an
// unhandled ENOENT 'error' event), so it uses cmd.exe with an immediate "exit 1" instead.
const childProcess = require('node:child_process')
const blockedExecs = []
const isWindows = process.platform === 'win32'
const denyFile = isWindows ? path.join(process.env.SYSTEMROOT || process.env.WINDIR || 'C:/Windows', 'System32', 'cmd.exe') : '/usr/bin/false'
const denyArgs = isWindows ? ['/d', '/c', 'exit 1'] : []
const denyShellCommand = isWindows ? 'exit 1' : '/usr/bin/false'
const isBlockedCommand = (file) => typeof file === 'string'
  && (/(^|\\/)security$/.test(file) || /(^|[\\/\\\\])(claude|codex)(\\.exe|\\.cmd)?$/i.test(file))
const isBlockedShell = (command) => typeof command === 'string' && /(^|[\\s/])(security|claude|codex)(\\s|$)/.test(command)
for (const method of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[method]
  childProcess[method] = function (file, ...rest) {
    if (!isBlockedCommand(file)) return original.call(this, file, ...rest)
    blockedExecs.push(path.basename(String(file)))
    const args = Array.isArray(rest[0]) ? [denyArgs, ...rest.slice(1)] : [denyArgs, ...rest]
    return original.call(this, denyFile, ...args)
  }
}
for (const method of ['exec', 'execSync']) {
  const original = childProcess[method]
  childProcess[method] = function (command, ...rest) {
    if (!isBlockedShell(command)) return original.call(this, command, ...rest)
    blockedExecs.push(String(command).trim().split(/\\s+/)[0])
    return original.call(this, denyShellCommand, ...rest)
  }
}
const fake = safeStorage.encryptString.toString().includes('agent-pets-e2e')
  && safeStorage.decryptString.toString().includes('agent-pets-e2e')
  && safeStorage.isEncryptionAvailable.toString().includes('calls')
  && childProcess.execFile.toString().includes('blockedExecs')
const isolated = app.getPath('userData') === userData && require('node:os').homedir() === path.join(root, 'home')
  && !Object.keys(process.env).some(key => /^(CLAUDE|ANTHROPIC|OPENAI|CODEX|OPENCODE)/i.test(key) && process.env[key] !== allowedAgentEnv[key])
if (!fake || !isolated) {
  console.error('AGENT_PETS_E2E_ABORT fake=' + fake + ' isolated=' + isolated)
  process.exit(1)
}
globalThis.__agentPetsE2E = {
  root,
  userData,
  calls,
  blockedExecs,
  createdWindows,
  catalogFixture: ${JSON.stringify(catalogFixture)},
  appUpdateFixture: ${JSON.stringify(appUpdateFixture)},
  tamperedArchivePath: ${JSON.stringify(tamperedArchivePath)},
  pluginIssueReportBaseUrl: 'https://github.com/example/agent-pets-plugins/issues/new',
  shellOpenExternalCalls,
  dialogQueue,
  saveDialogQueue,
  panelViewBlockedRequests: 0,
}
console.log('AGENT_PETS_E2E_READY ' + JSON.stringify({ root, userData: app.getPath('userData'), home: require('node:os').homedir(), fakeSafeStorage: fake }))
require(${JSON.stringify(mainBundle)})
`)

// inspector／devtools 埠被佔用時 Electron 只印一行錯誤仍照常啟動，測試腳本就會連到別人的程序
// （例如另一個工作樹的隔離 App）去操作它；所以先確認兩個埠都空著，否則中止。
const portIsFree = port => new Promise(resolvePort => {
  const probe = createServer()
  probe.once('error', () => resolvePort(false))
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolvePort(true)))
})
for (const [label, port] of [['--inspect-port', inspectPort], ['--debug-port', debugPort]]) {
  if (!await portIsFree(port)) {
    console.error(`AGENT_PETS_E2E_ABORT ${label} ${port} is already in use; pick a free port`)
    // 這次才建立的暫存根目錄不留下；--reuse-root 是呼叫端的資料，不動。
    if (!reuseRoot) rmSync(root, { recursive: true, force: true })
    process.exit(1)
  }
}

const electronBinary = createRequire(import.meta.url)('electron')
const child = spawn(electronBinary, [
  `--inspect=${inspectPort}`,
  `--remote-debugging-port=${debugPort}`,
  bootstrap,
], {
  cwd: repoRoot,
  // Only pass what Electron needs; never the user's tokens, account ids or agent settings.
  env: {
    ...Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
      // Linux 顯示連線：HOME 換成暫存目錄後，Electron 找不到 ~/.Xauthority，必須沿用呼叫端的設定。
      // xvfb-run -a 會用 -auth 檔並匯出 XAUTHORITY（只是 X cookie 檔的路徑，不含憑證內容）；
      // Wayland 桌面則靠 WAYLAND_DISPLAY 與 XDG_RUNTIME_DIR 找到 compositor 的 socket。
      'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR',
      // 連接埠覆寫（僅限 dev build），讓已安裝的 Agent Pets 能保有 17373–17375。
      'AGENT_PETS_EVENT_PORT', 'AGENT_PETS_PERMISSION_PORT', 'AGENT_PETS_PRESENTATION_PORT',
      // 寵物冷啟動倍率（dev 用的 createPetWindow() 預設值）。
      'PET_SCALE']
      .filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]])),
    HOME: join(root, 'home'),
    // Windows 的 os.homedir() 讀 USERPROFILE 而非 HOME；少了它隔離檢查會失敗並中止。
    USERPROFILE: join(root, 'home'),
    ...hookPortEnv,
    ...agentConfigEnv,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let readySeen = false
let readyTail = ''
for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.on('data', chunk => {
    const text = chunk.toString()
    const searchable = readyTail + text
    if (searchable.includes('AGENT_PETS_E2E_READY')) readySeen = true
    readyTail = searchable.slice(-'AGENT_PETS_E2E_READY'.length)
    target.write(chunk)
  })
}
console.log(JSON.stringify({ root, appRoot, inspectPort, debugPort, hookPorts: realHookPorts ? 'default' : [hookPortBase, hookPortBase + 1, hookPortBase + 2], pid: child.pid }))
child.on('exit', (code, signal) => {
  if (!readySeen) {
    console.error(`AGENT_PETS_E2E_ABORT electron exited before READY (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
    process.exit(code === 0 ? 1 : code ?? 1)
  }
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
