import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupEnvironment } from './setup-environment.ts'
import type { AgentConfigDirIgnoredReason, AgentConfigDirVariable } from '../src/types/agent-adapter.ts'

export type { AgentConfigDirIgnoredReason, AgentConfigDirVariable }

// Agent 自己的設定目錄（使用者層）可以用環境變數搬走。hook 安裝、偵測、quota 與本機用量都要讀寫
// agent 實際使用的那個目錄，所以解析規則集中在這裡。只屬於主行程的檔案系統操作，所以不放進
// renderer 也會載入的 AGENT_FAMILY_REGISTRY（docs/dev/agent-sources.md「hook 這一側要另外改」）。
// 第 0 步實測依據見 docs/phase-reports/refactor-01-agent-config-dirs.md。

export type AgentConfigDirKind = 'claude' | 'codex' | 'opencode'

interface AgentConfigDirSpec {
  variable: AgentConfigDirVariable
  /** 未設定變數時，相對於 home 的預設位置。 */
  defaultSegments: readonly string[]
  /** 變數指向的是上一層（XDG_CONFIG_HOME），agent 目錄還要再接這幾段。 */
  envSuffix: readonly string[]
  /** agent 本身要求目錄已存在（CODEX_HOME 不存在時 Codex 直接報錯）。 */
  mustExist: boolean
}

export const AGENT_CONFIG_DIR_SPECS = Object.freeze({
  claude: Object.freeze({ variable: 'CLAUDE_CONFIG_DIR', defaultSegments: ['.claude'], envSuffix: [], mustExist: false }),
  codex: Object.freeze({ variable: 'CODEX_HOME', defaultSegments: ['.codex'], envSuffix: [], mustExist: true }),
  // OpenCode 在 Windows 也用 XDG 規則（~/.config/opencode），不是 %APPDATA%。
  opencode: Object.freeze({ variable: 'XDG_CONFIG_HOME', defaultSegments: ['.config', 'opencode'], envSuffix: ['opencode'], mustExist: false }),
} as const satisfies Record<AgentConfigDirKind, AgentConfigDirSpec>)

export const AGENT_CONFIG_DIR_VARIABLES: readonly AgentConfigDirVariable[] = Object.freeze(
  Object.values(AGENT_CONFIG_DIR_SPECS).map(spec => spec.variable),
)

export type AgentConfigEnv = Readonly<Partial<Record<AgentConfigDirVariable, string>>>

export interface AgentConfigDirDeps {
  env: AgentConfigEnv
  homeDir: string
  platform: NodeJS.Platform
  /** 只有 mustExist 的目錄會呼叫。 */
  isDirectory(target: string): boolean
}

export interface ResolvedConfigDir {
  path: string
  /** 未設定變數時的位置；與 path 不同時，舊安裝可能留在這裡。 */
  defaultPath: string
  source: 'env' | 'default'
  variable: AgentConfigDirVariable
  ignored?: AgentConfigDirIgnoredReason
}

export type ResolvedAgentConfigDirs = Readonly<Record<AgentConfigDirKind, ResolvedConfigDir>>

const MAX_PATH_LENGTH = 1024
// Windows 的 path.isAbsolute('\\foo') 也是 true，但那是「目前磁碟機根目錄」，agent 與我們可能落在不同磁碟。
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

function classifyValue(value: string, platform: NodeJS.Platform): AgentConfigDirIgnoredReason | null {
  if (value.includes('\0') || value.length > MAX_PATH_LENGTH || value.trim() !== value) return 'invalid'
  // 不展開 ~ 或相對路徑：agent 自己也不會，猜錯就會寫到 agent 看不到的地方。
  const absolute = platform === 'win32' ? WINDOWS_ABSOLUTE.test(value) : path.posix.isAbsolute(value)
  return absolute ? null : 'not_absolute'
}

export function resolveAgentConfigDir(kind: AgentConfigDirKind, deps: AgentConfigDirDeps): ResolvedConfigDir {
  const spec = AGENT_CONFIG_DIR_SPECS[kind]
  const api = pathApi(deps.platform)
  const defaultPath = api.join(deps.homeDir, ...spec.defaultSegments)
  const fallback = (ignored?: AgentConfigDirIgnoredReason): ResolvedConfigDir => ({
    path: defaultPath, defaultPath, source: 'default', variable: spec.variable, ...(ignored ? { ignored } : {}),
  })
  const raw = deps.env[spec.variable]
  // 空字串視同未設定（常見的「取消設定」寫法），不提示。
  if (raw === undefined || raw.trim() === '') return fallback()
  const problem = classifyValue(raw, deps.platform)
  if (problem) return fallback(problem)
  const resolved = api.join(api.resolve(raw), ...spec.envSuffix)
  if (spec.mustExist && !deps.isDirectory(resolved)) return fallback('missing')
  return { path: resolved, defaultPath, source: 'env', variable: spec.variable }
}

export function resolveAgentConfigDirs(deps: AgentConfigDirDeps): ResolvedAgentConfigDirs {
  return Object.freeze({
    claude: resolveAgentConfigDir('claude', deps),
    codex: resolveAgentConfigDir('codex', deps),
    opencode: resolveAgentConfigDir('opencode', deps),
  })
}

export function pickAgentConfigEnv(env: NodeJS.ProcessEnv): AgentConfigEnv {
  return Object.fromEntries(AGENT_CONFIG_DIR_VARIABLES.flatMap(name => {
    const value = env[name]
    return value === undefined || value === '' ? [] : [[name, value]]
  }))
}

// --- login shell 查詢（macOS／Linux GUI 啟動） ----------------------------------------------------
// 從 Dock／桌面啟動的 app 只繼承 launchd／session 環境，看不到使用者在 shell 設定檔 export 的變數。
// 與 node-resolver.ts 同樣的做法：固定指令、非互動 login shell、2 秒逾時、失敗就當作未設定。
// 不用 -ilc 後備：互動設定檔可能印訊息或啟動其他程式，為了三個變數不值得冒這個險。

export const LOGIN_SHELL_TIMEOUT_MS = 2_000
const LOGIN_SHELL_MAX_OUTPUT = 64 * 1024
const SENTINEL = '__AGENT_PETS_CONFIG_ENV__'
// 以 NUL 分隔，值裡的換行與空白都不會讓欄位錯位；哨兵讓設定檔多印的內容不會被當成值。
const LOGIN_SHELL_SCRIPT = `printf '%s\\0' ${SENTINEL} ${AGENT_CONFIG_DIR_VARIABLES.map(name => `"$${name}"`).join(' ')}`

export function parseLoginShellEnv(output: string): AgentConfigEnv {
  const fields = output.split('\0')
  const start = fields.lastIndexOf(SENTINEL)
  if (start === -1 || fields.length < start + 1 + AGENT_CONFIG_DIR_VARIABLES.length) return {}
  return Object.fromEntries(AGENT_CONFIG_DIR_VARIABLES.flatMap((name, index) => {
    const value = fields[start + 1 + index]
    return value ? [[name, value]] : []
  }))
}

export interface AgentConfigEnvironmentDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  run(file: string, args: string[], timeoutMs: number): Promise<string>
}

function defaultAgentConfigEnvironmentDeps(): AgentConfigEnvironmentDeps {
  return {
    platform: process.platform,
    env: process.env,
    run: (file, args, timeout) => new Promise((resolve, reject) => {
      const child = execFile(file, args, { encoding: 'utf-8', timeout, maxBuffer: LOGIN_SHELL_MAX_OUTPUT, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout)))
      child.stdin?.end()
    }),
  }
}

function loginShell(deps: AgentConfigEnvironmentDeps): string {
  const configured = deps.env.SHELL
  if (configured && path.posix.isAbsolute(configured)) return configured
  return deps.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

export interface AgentConfigEnvironment {
  /** process.env 優先，缺的才用 login shell 查到的值；查詢完成前只有 process.env。 */
  snapshot(): AgentConfigEnv
  /** 開始（只會開始一次）並等待 login shell 查詢；會改寫設定檔的流程先 await 它。 */
  ready(): Promise<void>
}

export function createAgentConfigEnvironment(deps: AgentConfigEnvironmentDeps = defaultAgentConfigEnvironmentDeps()): AgentConfigEnvironment {
  const direct = Object.freeze(pickAgentConfigEnv(deps.env))
  let merged: AgentConfigEnv = direct
  let pending: Promise<void> | null = null
  // Windows GUI 會繼承使用者／系統環境變數；三個都已設定時也沒有要補的。
  const needsShell = deps.platform !== 'win32'
    && AGENT_CONFIG_DIR_VARIABLES.some(name => !Object.hasOwn(direct, name))

  return {
    snapshot: () => merged,
    ready(): Promise<void> {
      pending ??= needsShell
        ? deps.run(loginShell(deps), ['-lc', LOGIN_SHELL_SCRIPT], LOGIN_SHELL_TIMEOUT_MS)
          .then((output) => { merged = Object.freeze({ ...parseLoginShellEnv(output), ...direct }) })
          .catch(() => { /* 查不到就維持 process.env 的結果 */ })
        : Promise.resolve()
      return pending
    },
  }
}

// --- 主行程目前的解析結果 ------------------------------------------------------------------------
// 檢查畫面一次會呼叫好幾個路徑函式，每次都 stat CODEX_HOME 沒有意義；短暫快取，home 或變數改了就重算。

const RESOLVE_CACHE_MS = 2_000
let cache: { key: string, at: number, dirs: ResolvedAgentConfigDirs } | null = null

function isDirectory(target: string): boolean {
  try { return fs.statSync(target).isDirectory() } catch { return false }
}

export function currentAgentConfigEnv(): AgentConfigEnv {
  return setupEnvironment().agentConfigEnv?.() ?? pickAgentConfigEnv(process.env)
}

export function currentAgentConfigDirs(
  { homeDir = setupEnvironment().homeDir(), now = Date.now() }: { homeDir?: string, now?: number } = {},
): ResolvedAgentConfigDirs {
  const env = currentAgentConfigEnv()
  const key = JSON.stringify([homeDir, ...AGENT_CONFIG_DIR_VARIABLES.map(name => env[name] ?? null)])
  if (cache?.key === key && now - cache.at < RESOLVE_CACHE_MS) return cache.dirs
  const dirs = resolveAgentConfigDirs({ env, homeDir, platform: process.platform, isDirectory })
  cache = { key, at: now, dirs }
  return dirs
}

/** 等待 login shell 查詢；沒有接上的執行環境（CLI、測試）立即完成。 */
export async function agentConfigEnvReady(): Promise<void> {
  await setupEnvironment().agentConfigEnvReady?.()
  cache = null
}

export class AgentConfigDirError extends Error {
  readonly variable: AgentConfigDirVariable
  readonly reason: AgentConfigDirIgnoredReason
  constructor(variable: AgentConfigDirVariable, reason: AgentConfigDirIgnoredReason) {
    super(`${variable} does not point to a usable folder, so nothing was written.`)
    this.name = 'AgentConfigDirError'
    this.variable = variable
    this.reason = reason
  }
}

/**
 * 安裝前的檢查：變數有設定卻不能用時，agent 不會讀預設位置以外的地方，我們也不能寫到預設位置
 * 假裝成功。CLAUDE_CONFIG_DIR 不存在時同樣拒絕，不替使用者建立目錄。
 */
export function writableAgentConfigDir(dir: ResolvedConfigDir): string {
  if (dir.ignored) throw new AgentConfigDirError(dir.variable, dir.ignored)
  if (dir.source === 'env' && dir.variable === 'CLAUDE_CONFIG_DIR' && !isDirectory(dir.path)) {
    throw new AgentConfigDirError(dir.variable, 'missing')
  }
  return dir.path
}
