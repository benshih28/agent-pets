#!/usr/bin/env node
// Test-only launcher: starts the built app in a throw-away HOME and userData, with a
// fake safeStorage installed BEFORE any app code runs, so automated runs never touch
// the user's real data or macOS Keychain. Usage:
//   pnpm exec vite build
//   node scripts/e2e-isolated-electron.mjs [--inspect-port 9349] [--debug-port 9348] [--app-root <dir>]
// --app-root runs another copy of the app (e.g. an extracted packaged app.asar) instead of this repo.
// Prints one JSON line with the temp root, ports and pid, then keeps running.
// The test app binds the same local hook ports (17373–17375) as an installed Agent Pets;
// whichever starts second keeps retrying and takes the ports once the other exits.
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
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

const root = mkdtempSync(join(tmpdir(), 'agent-pets-e2e-'))
mkdirSync(join(root, 'home'))
mkdirSync(join(root, 'ud'))
const { catalogFixture, tamperedArchivePath } = createCatalogFixture(root)
const bootstrap = join(root, 'bootstrap.cjs')
writeFileSync(bootstrap, `
const path = require('node:path')
const { app, safeStorage, shell } = require('electron')
const root = ${JSON.stringify(root)}
const userData = path.join(root, 'ud')
app.setPath('userData', userData)
if (typeof app.setAppPath === 'function') app.setAppPath(${JSON.stringify(appRoot)})
const calls = { isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }
const shellOpenExternalCalls = []
shell.openExternal = async (url) => { shellOpenExternalCalls.push(String(url)) }
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
// or act with their accounts.
const childProcess = require('node:child_process')
const blockedExecs = []
const isBlockedCommand = (file) => typeof file === 'string'
  && (/(^|\\/)security$/.test(file) || /(^|[\\/\\\\])(claude|codex)(\\.exe|\\.cmd)?$/i.test(file))
const isBlockedShell = (command) => typeof command === 'string' && /(^|[\\s/])(security|claude|codex)(\\s|$)/.test(command)
for (const method of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[method]
  childProcess[method] = function (file, ...rest) {
    if (!isBlockedCommand(file)) return original.call(this, file, ...rest)
    blockedExecs.push(path.basename(String(file)))
    const args = Array.isArray(rest[0]) ? [[], ...rest.slice(1)] : rest
    return original.call(this, '/usr/bin/false', ...args)
  }
}
for (const method of ['exec', 'execSync']) {
  const original = childProcess[method]
  childProcess[method] = function (command, ...rest) {
    if (!isBlockedShell(command)) return original.call(this, command, ...rest)
    blockedExecs.push(String(command).trim().split(/\\s+/)[0])
    return original.call(this, '/usr/bin/false', ...rest)
  }
}
const fake = safeStorage.encryptString.toString().includes('agent-pets-e2e')
  && safeStorage.decryptString.toString().includes('agent-pets-e2e')
  && safeStorage.isEncryptionAvailable.toString().includes('calls')
  && childProcess.execFile.toString().includes('blockedExecs')
const isolated = app.getPath('userData') === userData && require('node:os').homedir() === path.join(root, 'home')
  && !Object.keys(process.env).some(key => /^(CLAUDE|ANTHROPIC|OPENAI|CODEX|OPENCODE)/i.test(key))
if (!fake || !isolated) {
  console.error('AGENT_PETS_E2E_ABORT fake=' + fake + ' isolated=' + isolated)
  process.exit(1)
}
globalThis.__agentPetsE2E = {
  root,
  userData,
  calls,
  blockedExecs,
  catalogFixture: ${JSON.stringify(catalogFixture)},
  tamperedArchivePath: ${JSON.stringify(tamperedArchivePath)},
  pluginIssueReportBaseUrl: 'https://github.com/example/agent-pets-plugins/issues/new',
  shellOpenExternalCalls,
  panelViewBlockedRequests: 0,
}
console.log('AGENT_PETS_E2E_READY ' + JSON.stringify({ root, userData: app.getPath('userData'), home: require('node:os').homedir(), fakeSafeStorage: fake }))
require(${JSON.stringify(mainBundle)})
`)

const electronBinary = createRequire(import.meta.url)('electron')
const child = spawn(electronBinary, [
  `--inspect=${inspectPort}`,
  `--remote-debugging-port=${debugPort}`,
  bootstrap,
], {
  cwd: repoRoot,
  // Only pass what Electron needs; never the user's tokens, account ids or agent settings.
  env: {
    ...Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'DISPLAY', 'XDG_RUNTIME_DIR', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']
      .filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]])),
    HOME: join(root, 'home'),
    // Windows 的 os.homedir() 讀 USERPROFILE 而非 HOME；少了它隔離檢查會失敗並中止。
    USERPROFILE: join(root, 'home'),
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
console.log(JSON.stringify({ root, appRoot, inspectPort, debugPort, pid: child.pid }))
child.on('exit', (code, signal) => {
  if (!readySeen) {
    console.error(`AGENT_PETS_E2E_ABORT electron exited before READY (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
    process.exit(code === 0 ? 1 : code ?? 1)
  }
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
