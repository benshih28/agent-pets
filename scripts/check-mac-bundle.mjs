#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
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

export function parseLipoArchs(output) {
  return output.trim().split(/\s+/).filter(Boolean)
}

// codesign 把 -dvv 的輸出寫到 stderr。
export function parseCodesignDetails(output) {
  const lines = output.split(/\r?\n/)
  const valueOf = prefix => lines.find(line => line.startsWith(prefix))?.slice(prefix.length)
  const flagsMatch = /^CodeDirectory .*\bflags=0x([0-9a-f]+)\(([^)]*)\)/m.exec(output)
  return {
    authorities: lines.filter(line => line.startsWith('Authority=')).map(line => line.slice('Authority='.length)),
    teamIdentifier: valueOf('TeamIdentifier=') ?? null,
    signature: valueOf('Signature=') ?? null,
    flags: flagsMatch ? Number.parseInt(flagsMatch[1], 16) : null,
    flagNames: flagsMatch ? flagsMatch[2].split(',').filter(Boolean) : [],
  }
}

// Hardened runtime 在 CodeDirectory flags 裡是 0x10000（名稱 runtime）。
export const CS_RUNTIME_FLAG = 0x10000

export function compareDeveloperIdSignature(details) {
  const problems = []
  // 簽章鏈第一項是葉憑證（簽這個 app 的身分）
  if (!details.authorities[0]?.startsWith('Developer ID Application:')) {
    problems.push(`signing authority is "${details.authorities[0] ?? 'none'}", expected Developer ID Application`)
  }
  if (details.signature === 'adhoc') problems.push('bundle is ad-hoc signed, expected a Developer ID signature')
  if (!details.teamIdentifier || details.teamIdentifier === 'not set') problems.push('TeamIdentifier is not set')
  if (details.flags === null || (details.flags & CS_RUNTIME_FLAG) === 0) {
    problems.push('hardened runtime flag (runtime) is missing from codesign flags')
  }
  return problems
}

// 公證過的 app 是 `source=Notarized Developer ID`；只有簽章沒公證則是 `source=Developer ID`（有網路時 Gatekeeper 會拒絕）。
export function compareSpctlOutput(output, notarized) {
  if (!/:\s*accepted\b/.test(output)) return [`spctl did not accept the app: ${output.trim()}`]
  const source = /^source=(.*)$/m.exec(output)?.[1]?.trim() ?? ''
  if (notarized && source !== 'Notarized Developer ID') {
    return [`spctl source is "${source || 'unknown'}", expected Notarized Developer ID`]
  }
  if (!notarized && !source.includes('Developer ID')) return [`spctl source is "${source || 'unknown'}", expected Developer ID`]
  return []
}

export function isMachOCandidate(relativePath) {
  const parts = relativePath.split('/')
  const name = parts[parts.length - 1]
  if (name.endsWith('.node') || name.endsWith('.dylib')) return true
  if (parts[parts.length - 2] === 'MacOS' || parts[parts.length - 2] === 'Helpers') return true
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

const USAGE = 'usage: check-mac-bundle.mjs --app <Agent Pets.app> --arch arm64|x64 [--expect-signed developer-id] [--expect-notarized]'

export function parseArgs(argv) {
  const args = { notarized: false }
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--app': args.app = argv[++i]; break
      case '--arch': args.arch = argv[++i]; break
      case '--expect-signed': args.signed = argv[++i]; break
      case '--expect-notarized': args.notarized = true; break
      default: throw new Error(`unknown argument ${argv[i]}`)
    }
  }
  if (!args.app || !LIPO_ARCH[args.arch]) throw new Error(USAGE)
  if (args.signed !== undefined && args.signed !== 'developer-id') throw new Error(`${USAGE}\n--expect-signed only supports developer-id`)
  if (args.notarized && args.signed !== 'developer-id') throw new Error('--expect-notarized requires --expect-signed developer-id')
  return args
}

// codesign、spctl 把資訊寫到 stderr，所以輸出合併 stdout 與 stderr。
function run(file, args) {
  try {
    const result = spawnSync(file, args, { encoding: 'utf8' })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return result.status === 0 ? { output } : { error: true, output: output || String(result.error ?? `exit ${result.status}`) }
  } catch (error) {
    return { error: true, output: String(error.message) }
  }
}

function checkDeveloperId(app, notarized, problems) {
  const details = run('codesign', ['-dvv', app])
  if (details.error) problems.push(`codesign -dvv failed: ${details.output.trim()}`)
  else problems.push(...compareDeveloperIdSignature(parseCodesignDetails(details.output)))

  const assessment = run('spctl', ['-a', '-t', 'exec', '-vv', app])
  problems.push(...(assessment.error && !/accepted/.test(assessment.output)
    ? [`spctl rejected the app: ${assessment.output.trim()}`]
    : compareSpctlOutput(assessment.output, notarized)))

  if (notarized) {
    const stapled = run('xcrun', ['stapler', 'validate', app])
    if (stapled.error) problems.push(`stapler validate failed: ${stapled.output.trim()}`)
  }
  if (problems.length === 0) console.log(`Developer ID signature${notarized ? ', notarization and staple' : ''}: ok`)
}

function main() {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const { app, arch, signed, notarized } = parsed
  const problems = []

  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '-vv', app], { stdio: 'pipe' })
    console.log('codesign --verify --deep --strict: ok')
  } catch (error) {
    problems.push(`codesign --verify failed: ${String(error.stderr || error.message).trim()}`)
  }

  if (signed === 'developer-id') checkDeveloperId(app, notarized, problems)

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
