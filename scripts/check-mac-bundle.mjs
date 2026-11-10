#!/usr/bin/env node
// 檢查打包好的 macOS .app：整個 bundle 的簽章是否完整、fuses 是否等於 package.json 的
// build.electronFuses、每個 Mach-O（主程式、Framework、Helper、*.node、*.dylib）是否含目標架構。
// 用法：node scripts/check-mac-bundle.mjs --app "<路徑>/Agent Pets.app" --arch arm64|x64
// 任何一項不符就以非 0 結束，release.yml 靠這個讓發版失敗。
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// @electron/fuses 1.8.0 的 V1 線路：sentinel 後面接 1 byte 版本、1 byte 長度，再來每個 fuse 1 byte
export const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
export const FUSE_V1_INDEX = Object.freeze({
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
})
const FUSE_ENABLE = 0x31
const FUSE_DISABLE = 0x30

export const LIPO_ARCH = Object.freeze({ arm64: 'arm64', x64: 'x86_64' })

/** 讀出 binary 裡每一份 fuse 線路（universal binary 會有兩份） */
export function readFuseWires(buffer) {
  const sentinel = Buffer.from(FUSE_SENTINEL, 'latin1')
  const wires = []
  for (let at = buffer.indexOf(sentinel); at !== -1; at = buffer.indexOf(sentinel, at + sentinel.length)) {
    const position = at + sentinel.length
    const version = buffer[position]
    const length = buffer[position + 1]
    wires.push({ version, states: [...buffer.subarray(position + 2, position + 2 + length)] })
  }
  return wires
}

/** 回傳與設定不符的 fuse 說明；空陣列代表全部一致 */
export function compareFuses(wires, config) {
  if (wires.length === 0) return ['fuse sentinel not found']
  const problems = []
  for (const [key, wanted] of Object.entries(config)) {
    const index = FUSE_V1_INDEX[key]
    if (index === undefined) {
      problems.push(`unknown fuse "${key}" in build.electronFuses`)
      continue
    }
    const expected = wanted ? FUSE_ENABLE : FUSE_DISABLE
    wires.forEach((wire, slice) => {
      if (wire.version !== 1) problems.push(`slice ${slice}: unexpected fuse wire version ${wire.version}`)
      else if (wire.states[index] !== expected) {
        problems.push(`slice ${slice}: ${key} is ${String.fromCharCode(wire.states[index] ?? 0x3f)}, expected ${wanted ? 1 : 0}`)
      }
    })
  }
  return problems
}

/** `lipo -archs` 的輸出是以空白分隔的架構名稱 */
export function parseLipoArchs(output) {
  return output.trim().split(/\s+/).filter(Boolean)
}

/** 判斷 bundle 內哪些路徑要檢查架構：MacOS/ 下的執行檔、Framework 主 binary、*.node、*.dylib */
export function isMachOCandidate(relativePath) {
  const parts = relativePath.split('/')
  const name = parts[parts.length - 1]
  if (name.endsWith('.node') || name.endsWith('.dylib')) return true
  if (parts[parts.length - 2] === 'MacOS' || parts[parts.length - 2] === 'Helpers') return true
  // Foo.framework/Versions/A/Foo
  const framework = parts.findLast(part => part.endsWith('.framework'))
  return framework !== undefined && name === framework.slice(0, -'.framework'.length) && parts.includes('Versions')
}

function listMachOCandidates(appPath) {
  const found = []
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Framework 內的 Versions/Current 等是 symlink，只走實體路徑以免重複
      if (entry.isSymbolicLink()) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(directory, entry.name), relative)
      else if (entry.isFile() && isMachOCandidate(relative)) found.push(relative)
    }
  }
  walk(appPath, '')
  return found
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (key !== '--app' && key !== '--arch') throw new Error(`unknown argument ${key}`)
    args[key.slice(2)] = argv[i + 1]
  }
  if (!args.app || !LIPO_ARCH[args.arch]) {
    throw new Error('usage: check-mac-bundle.mjs --app <Agent Pets.app> --arch arm64|x64')
  }
  return args
}

function main() {
  const { app, arch } = parseArgs(process.argv.slice(2))
  const problems = []

  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '-vv', app], { stdio: 'pipe' })
    console.log('codesign --verify --deep --strict: ok')
  } catch (error) {
    problems.push(`codesign --verify failed: ${String(error.stderr || error.message).trim()}`)
  }

  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const frameworkBinary = join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework')
  const fuseProblems = compareFuses(readFuseWires(readFileSync(frameworkBinary)), packageJson.build.electronFuses)
  if (fuseProblems.length === 0) console.log('fuses match build.electronFuses')
  problems.push(...fuseProblems)

  const wanted = LIPO_ARCH[arch]
  const candidates = listMachOCandidates(app)
  for (const relative of candidates) {
    let archs
    try {
      archs = parseLipoArchs(execFileSync('lipo', ['-archs', join(app, relative)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    } catch (error) {
      problems.push(`${relative}: lipo failed (${String(error.stderr || error.message).trim()})`)
      continue
    }
    if (!archs.includes(wanted)) problems.push(`${relative}: ${archs.join(' ') || 'no architecture'}, expected ${wanted}`)
  }
  console.log(`checked ${candidates.length} Mach-O files for ${wanted}`)

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
