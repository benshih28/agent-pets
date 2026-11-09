import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginId = process.argv[2]
const outputPath = process.argv[3]

if (!pluginId || !/^[a-z0-9-]{3,48}$/.test(pluginId) || !outputPath) {
  throw new Error('Usage: node scripts/pack-test-plugin.mjs <plugin-id> <output.agentpet-plugin>')
}

const sourceDirectory = path.join(root, 'tests', 'fixtures', 'plugins', pluginId)
const files = {}

function collect(directory, relativeDirectory = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    const absolutePath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Fixture contains a symlink: ${relativePath}`)
    if (entry.isDirectory()) collect(absolutePath, relativePath)
    else if (entry.isFile()) files[relativePath] = new Uint8Array(fs.readFileSync(absolutePath))
  }
}

collect(sourceDirectory)
if (!files['plugin.json']) throw new Error(`Fixture ${pluginId} must contain plugin.json`)
// 無 Worker 的 fixture（skins、panelThemes）沒有 entry；只要求 manifest 有列出的檔案。
const manifest = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'))
for (const required of [manifest.entry, manifest.icon]) {
  if (typeof required === 'string' && !files[required]) {
    throw new Error(`Fixture ${pluginId} is missing ${required}, which plugin.json references`)
  }
}

const target = path.resolve(outputPath)
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, zipSync(files, { level: 6 }))
process.stdout.write(`${target}\n`)
