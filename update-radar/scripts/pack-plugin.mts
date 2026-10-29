// 打包並簽署 update-radar/plugin，再用 App 自己的簽章與安裝檢查驗證成品。
// 用法（在 repo 根目錄）：
//   node --experimental-strip-types update-radar/scripts/pack-plugin.mts [--key <私鑰.pem>] [--out <目錄>]
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { zipSync, type Zippable } from 'fflate'
import { PLUGIN_SIGNATURE_FILENAME, pluginPublicKeyFingerprint, verifyPluginSignature } from '../../electron/plugin-signature.ts'
import { PluginRegistry } from '../../electron/plugin-registry.ts'

const radarRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = path.join(radarRoot, 'plugin')

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback
}

const keyPath = option('--key', path.join(os.homedir(), '.config/agent-pets/plugin-signing/update-radar-ed25519-private.pem'))
const outDirectory = option('--out', path.join(radarRoot, 'release'))

const files = new Map<string, Uint8Array>()
function collect(directory: string, relativeDirectory = ''): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Plugin contains a symlink: ${relativePath}`)
    if (entry.isDirectory()) collect(absolutePath, relativePath)
    else if (entry.isFile()) files.set(relativePath, new Uint8Array(fs.readFileSync(absolutePath)))
  }
}
collect(sourceDirectory)
if (files.has(PLUGIN_SIGNATURE_FILENAME)) throw new Error('Remove plugin/signature.json; it is generated while packing')

const manifest = JSON.parse(Buffer.from(files.get('plugin.json') ?? []).toString('utf8')) as { id?: string; version?: string; apiVersion?: string }
if (manifest.id !== 'update-radar' || !manifest.version) throw new Error('plugin.json must declare id update-radar and a version')

const byPath = ([left]: [string, unknown], [right]: [string, unknown]) => left < right ? -1 : left > right ? 1 : 0
const privateKey = createPrivateKey(fs.readFileSync(keyPath))
const rawPublicKey = new Uint8Array(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32))
const payload = Buffer.from([...files.entries()].sort(byPath)
  .map(([filePath, bytes]) => `${filePath}\t${createHash('sha256').update(bytes).digest('hex')}\n`).join(''), 'utf8')
files.set(PLUGIN_SIGNATURE_FILENAME, new Uint8Array(Buffer.from(JSON.stringify({
  alg: 'ed25519',
  publicKey: Buffer.from(rawPublicKey).toString('base64'),
  signature: sign(null, payload, privateKey).toString('base64'),
}), 'utf8')))

// 固定 zip 內的時間（fflate 以本地時間寫入，所以用本地時間建構），相同內容在任何時區都產生相同位元組，
// 已發布版本的 SHA-256 才能被重現與核對。0.2.0 就是以此設定產生。
const mtime = new Date(2026, 9, 29, 8, 0, 0)
const entries: Zippable = Object.fromEntries([...files.entries()].sort(byPath).map(([filePath, bytes]) => [filePath, [bytes, { mtime }]]))
const archive = zipSync(entries, { level: 9 })

const signature = verifyPluginSignature(files)
if (signature.status !== 'valid') throw new Error(`Signature check failed: ${JSON.stringify(signature)}`)
const registryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-radar-pack-'))
try {
  const plan = new PluginRegistry(registryDirectory).planInstall(archive)
  if (!plan.ok) throw new Error(`Install plan rejected the package: ${plan.error}`)
} finally {
  fs.rmSync(registryDirectory, { recursive: true, force: true })
}

fs.mkdirSync(outDirectory, { recursive: true })
const outputPath = path.join(outDirectory, `update-radar-${manifest.version}.agentpet-plugin`)
fs.writeFileSync(outputPath, archive)

const sha256 = createHash('sha256').update(archive).digest('hex')
process.stdout.write(`${outputPath}
fingerprint ${pluginPublicKeyFingerprint(rawPublicKey)}
${JSON.stringify({
  version: manifest.version,
  apiVersion: manifest.apiVersion,
  url: `https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/packages/update-radar-${manifest.version}.agentpet-plugin`,
  sha256,
  size: archive.byteLength,
  publishedAt: new Date().toISOString(),
}, null, 2)}
`)
