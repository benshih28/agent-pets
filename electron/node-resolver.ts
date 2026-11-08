import * as fs from 'node:fs'
import * as path from 'node:path'

const pathWin32 = path.win32
import { execFile, execFileSync } from 'node:child_process'

// Finds an absolute Node.js executable for hook commands. GUI apps launched from Finder/Dock get a
// minimal PATH, so a bare "node" silently fails; we ask a login shell (non-interactive first, so
// rc-file prompts cannot hang us) and fall back to well-known install locations. The result is
// cached but re-validated on every read, so a removed nvm version is noticed.

export const MIN_NODE_MAJOR = 18
const CACHE_TTL_MS = 10 * 60 * 1000
const SHELL_TIMEOUT_MS = 2_000

export class NodeNotFoundError extends Error {
  constructor() {
    super('Node.js was not found. Install Node.js and try again.')
    this.name = 'NodeNotFoundError'
  }
}

export class NodeUnsupportedError extends Error {
  readonly version: string | null
  constructor(version: string | null) {
    super(`Node.js ${version ?? ''} is older than the required ${MIN_NODE_MAJOR}.`.replace('  ', ' '))
    this.name = 'NodeUnsupportedError'
    this.version = version
  }
}

export interface NodeInfo {
  path: string
  version: string | null
  /** version >= MIN_NODE_MAJOR (or unknown, which we do not block on). */
  supported: boolean
}

export interface NodeResolverDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exists(target: string): boolean
  runSync(file: string, args: string[], timeoutMs: number, cwd?: string): string
  run(file: string, args: string[], timeoutMs: number, cwd?: string): Promise<string>
  now(): number
  /** Process working directory; Windows candidates found there are rejected. Defaults to process.cwd(). */
  cwd?(): string
}

export function defaultNodeResolverDeps(): NodeResolverDeps {
  return {
    platform: process.platform,
    env: process.env,
    exists: target => fs.existsSync(target),
    runSync: (file, args, timeout, cwd) => execFileSync(file, args, { encoding: 'utf-8', timeout, stdio: ['ignore', 'pipe', 'ignore'], ...(cwd ? { cwd } : {}) }),
    run: (file, args, timeout, cwd) => new Promise((resolve, reject) => {
      execFile(file, args, { encoding: 'utf-8', timeout, ...(cwd ? { cwd } : {}) }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
    }),
    cwd: () => process.cwd(),
    now: () => Date.now(),
  }
}

export function parseNodeMajor(version: string | null): number | null {
  const match = version ? /^v?(\d+)\./.exec(version.trim()) : null
  return match ? Number(match[1]) : null
}

function windowsCandidates(env: NodeJS.ProcessEnv): string[] {
  const path = pathWin32
  return [
    env.ProgramFiles ? path.join(env.ProgramFiles, 'nodejs', 'node.exe') : '',
    env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : '',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe') : '',
  ].filter(Boolean)
}

const POSIX_CANDIDATES = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']

function lastLine(output: string): string | null {
  const line = output.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean).pop()
  return line ?? null
}

export function createNodeResolver(deps: NodeResolverDeps = defaultNodeResolverDeps()) {
  let cached: { info: NodeInfo, at: number } | null = null

  const fresh = (): NodeInfo | null => {
    if (!cached) return null
    if (deps.now() - cached.at > CACHE_TTL_MS || !deps.exists(cached.info.path)) {
      cached = null
      return null
    }
    return cached.info
  }

  const remember = (nodePath: string, version: string | null): NodeInfo => {
    const major = parseNodeMajor(version)
    const info: NodeInfo = { path: nodePath, version, supported: major === null || major >= MIN_NODE_MAJOR }
    cached = { info, at: deps.now() }
    return info
  }

  // where.exe searches the current directory before PATH, so it always runs from the system
  // directory, and candidates in the process cwd or a downloads folder are rejected below.
  const windowsSystemDir = (): string => pathWin32.join(deps.env.SystemRoot || deps.env.windir || 'C:\\Windows', 'System32')

  const shellInvocations = (): Array<[string, string[], string | undefined]> => {
    if (deps.platform === 'win32') return [[pathWin32.join(windowsSystemDir(), 'where.exe'), ['node.exe'], windowsSystemDir()]]
    const shell = deps.env.SHELL || '/bin/zsh'
    return [[shell, ['-lc', 'command -v node'], undefined], [shell, ['-ilc', 'command -v node'], undefined]]
  }

  const isUntrustedWindowsLocation = (candidate: string): boolean => {
    const normalize = (value: string) => pathWin32.normalize(value).replace(/[\\/]+$/, '').toLowerCase()
    const directory = normalize(pathWin32.dirname(candidate))
    let working = ''
    try { working = deps.cwd ? deps.cwd() : process.cwd() } catch { /* unknown cwd */ }
    if (working && directory === normalize(working)) return true
    return /(^|\\)(downloads|temp|tmp)(\\|$)/.test(directory)
  }

  const knownLocations = (): string[] => (
    deps.platform === 'win32' ? windowsCandidates(deps.env) : POSIX_CANDIDATES
  ).filter(candidate => deps.exists(candidate))

  const pickFromOutput = (output: string): string | null => {
    const candidates = deps.platform === 'win32'
      ? output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      : [lastLine(output)].filter((line): line is string => Boolean(line))
    const isAbs = deps.platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute
    return candidates.find(candidate => isAbs(candidate) && deps.exists(candidate)
      && !(deps.platform === 'win32' && isUntrustedWindowsLocation(candidate))) ?? null
  }

  return {
    /** Cached, validated value only: never spawns a process. */
    peek(): NodeInfo | null {
      return fresh()
    },

    /** Synchronous fallback for callers that cannot await; prefer resolve(). */
    resolveSync(): NodeInfo | null {
      const hit = fresh()
      if (hit) return hit
      for (const [file, args, cwd] of shellInvocations()) {
        try {
          const found = pickFromOutput(deps.runSync(file, args, SHELL_TIMEOUT_MS, cwd))
          if (found) return remember(found, null)
        } catch { /* try the next strategy */ }
      }
      const known = knownLocations()[0]
      return known ? remember(known, null) : null
    },

    async resolve(): Promise<NodeInfo | null> {
      const hit = fresh()
      if (hit?.version) return hit
      let found: string | null = hit?.path ?? null
      if (!found) {
        for (const [file, args, cwd] of shellInvocations()) {
          try {
            found = pickFromOutput(await deps.run(file, args, SHELL_TIMEOUT_MS, cwd))
            if (found) break
          } catch { /* try the next strategy */ }
        }
      }
      found ??= knownLocations()[0] ?? null
      if (!found) return null
      let version: string | null = null
      try { version = lastLine(await deps.run(found, ['--version'], SHELL_TIMEOUT_MS)) } catch { /* version unknown */ }
      return remember(found, version)
    },

    invalidate(): void {
      cached = null
    },
  }
}

export type NodeResolver = ReturnType<typeof createNodeResolver>
