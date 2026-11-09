import * as fs from 'node:fs'
import {
  ConfigRefusedError,
  type ConfigWriteResult,
  type JsonObject,
  isJsonObject,
  readJsonObjectConfig,
  serializeJson,
  writeConfigSafely,
} from './safe-config-write.ts'

// Electron-free hook-config editing shared by the installers in setup.ts.
// Every function here only ever touches Agent Pets' own entries.

type HookEntry = Record<string, unknown>

// Our hooks always run the deployed script `<home>/.desktop-pet/agent-hook.mjs` (or its Windows
// `.cmd` wrapper). A hook is ours only when one whole command token / argument is exactly such a
// path; substring matches (e.g. a user's `~/desktop-pet-project/agent-hook.sh`) never count.
const AGENT_PETS_HOOK_PATH = /(?:^|[\\/])\.desktop-pet[\\/]agent-hook\.(?:mjs|cmd)$/i

function shellTokens(command: string): string[] {
  // Minimal POSIX/cmd-tolerant splitter: quotes group, adjacent pieces join (`'a'\\''b'`), and a
  // backslash is literal except for `\\'` outside quotes (the POSIX single-quote escape we emit).
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (char === '\\' && command[index + 1] === "'") {
      current += "'"
      started = true
      index += 1
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) tokens.push(current)
  return tokens
}

export function isAgentPetsHook(hook: unknown): boolean {
  if (!isJsonObject(hook) || hook.type !== 'command') return false
  const command = typeof hook.command === 'string' ? hook.command : ''
  const args = Array.isArray(hook.args) ? hook.args.filter((arg): arg is string => typeof arg === 'string') : []
  return [...shellTokens(command), ...args].some(token => AGENT_PETS_HOOK_PATH.test(token))
}

/**
 * True only for the known-bad state written by older Windows builds: a hook whose runtime is
 * some executable other than Node.js (Electron's own exe, which recursively launches the app).
 * A hook that merely points at a different Node.js install is NOT legacy and is left alone.
 */
export function isLegacyElectronHook(hook: unknown): boolean {
  if (!isJsonObject(hook)) return false
  const command = typeof hook.command === 'string' ? hook.command.trim() : ''
  if (!command) return false
  const executables = command.match(/[^\\/"\s][^\\/"]*\.exe\b/gi) ?? []
  return executables.some(name => !/^node\.exe$/i.test(name.trim()))
}

export function removeAgentPetsHooks(groups: unknown): unknown[] {
  if (!Array.isArray(groups)) return []
  const result: unknown[] = []
  for (const group of groups) {
    if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
      result.push(group)
      continue
    }
    const remaining = group.hooks.filter(hook => !isAgentPetsHook(hook))
    // Drop a group only when removing our handlers emptied it; keep user groups untouched.
    if (remaining.length === 0 && group.hooks.length > 0) continue
    result.push(remaining.length === group.hooks.length ? group : { ...group, hooks: remaining })
  }
  return result
}

function requireHooksObject(filePath: string, root: JsonObject): Record<string, unknown> {
  if (root.hooks === undefined) return {}
  if (!isJsonObject(root.hooks)) {
    throw new ConfigRefusedError('not_object', filePath, `${filePath} has a "hooks" value that is not an object; Agent Pets did not modify it.`)
  }
  return root.hooks
}

function requireEventArray(filePath: string, event: string, value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ConfigRefusedError('not_object', filePath, `${filePath} has hooks.${event} that is not a list; Agent Pets did not modify it.`)
  }
  return value
}

/**
 * Adds (or refreshes) Agent Pets' hook handlers in a hooks-style JSON file while keeping every
 * other key and every user-defined hook. Missing files are created from `defaults`.
 * Throws ConfigRefusedError when the file exists but is not a parseable JSON object.
 */
export function mergeAgentPetsHooksFile(
  filePath: string,
  desired: Record<string, unknown[]>,
  defaults: JsonObject = {},
): ConfigWriteResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  const base: JsonObject = exists ? root : { ...defaults }
  const hooks = requireHooksObject(filePath, base)
  for (const [event, handlers] of Object.entries(desired)) {
    const kept = removeAgentPetsHooks(requireEventArray(filePath, event, hooks[event]))
    hooks[event] = [...kept, handlers[0]]
  }
  base.hooks = hooks
  return writeConfigSafely(filePath, serializeJson(base))
}

export interface HookRemovalResult {
  status: 'removed' | 'absent' | 'deleted_file'
  path: string
  backupPath: string | null
}

/**
 * Removes only Agent Pets hook handlers. The file is deleted only when nothing but content that
 * Agent Pets itself wrote (`ownedTopLevel` key/value pairs) remains.
 */
export function removeAgentPetsHooksFile(
  filePath: string,
  ownedTopLevel: Record<string, unknown> = {},
): HookRemovalResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  if (!exists) return { status: 'absent', path: filePath, backupPath: null }
  if (!isJsonObject(root.hooks)) return { status: 'absent', path: filePath, backupPath: null }
  const hooks = root.hooks
  let changed = false
  for (const event of Object.keys(hooks)) {
    const current = hooks[event]
    if (!Array.isArray(current)) continue
    const next = removeAgentPetsHooks(current)
    if (next.length !== current.length || JSON.stringify(next) !== JSON.stringify(current)) changed = true
    if (next.length === 0) delete hooks[event]
    else hooks[event] = next
  }
  if (!changed) return { status: 'absent', path: filePath, backupPath: null }
  if (Object.keys(hooks).length === 0) delete root.hooks

  for (const [key, value] of Object.entries(ownedTopLevel)) {
    if (root[key] === value) delete root[key]
  }

  if (Object.keys(root).length === 0) {
    // Everything left was written by Agent Pets: keep a backup, then remove the empty shell.
    const write = writeConfigSafely(filePath, serializeJson(root))
    // A symlinked dotfile was rewritten at its real target; deleting only the link would leave
    // the target as `{}` and break the link, so a symlink is kept as an empty config instead.
    let isLink = false
    try { isLink = fs.lstatSync(filePath).isSymbolicLink() } catch { /* already gone */ }
    if (isLink) return { status: 'removed', path: filePath, backupPath: write.backupPath }
    fs.rmSync(filePath, { force: true })
    return { status: 'deleted_file', path: filePath, backupPath: write.backupPath }
  }
  const write = writeConfigSafely(filePath, serializeJson(root))
  return { status: 'removed', path: filePath, backupPath: write.backupPath }
}

/** True if the file contains at least one Agent Pets hook. Unreadable or invalid files report false. */
export function fileHasAgentPetsHooks(filePath: string): boolean {
  try {
    const { root } = readJsonObjectConfig(filePath)
    if (!isJsonObject(root.hooks)) return false
    return Object.values(root.hooks).some(groups => (
      Array.isArray(groups) && groups.some(group => (
        isJsonObject(group) && Array.isArray(group.hooks) && group.hooks.some(isAgentPetsHook)
      ))
    ))
  } catch {
    return false
  }
}

/**
 * Rewrites the command of already-installed Agent Pets hooks (Windows repair). Returns whether
 * anything changed. Unparseable files are left alone.
 */
export function rewriteAgentPetsHookCommands(
  filePath: string,
  rewrite: (hook: HookEntry) => boolean,
): boolean {
  let parsed: ReturnType<typeof readJsonObjectConfig>
  try {
    parsed = readJsonObjectConfig(filePath)
  } catch {
    return false
  }
  if (!parsed.exists || !isJsonObject(parsed.root.hooks)) return false
  let changed = false
  for (const groups of Object.values(parsed.root.hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        if (isAgentPetsHook(hook) && rewrite(hook as HookEntry)) changed = true
      }
    }
  }
  if (changed) writeConfigSafely(filePath, serializeJson(parsed.root))
  return changed
}

export interface RequiredHookEntry {
  event: string
  matcher?: string
  /** Seconds; set (or corrected) on Agent Pets' own handler for this event. */
  timeout?: number
}

/**
 * Upgrade path for an existing install: adds missing Agent Pets handlers and corrects their
 * `timeout`, reusing the command/args the user already has (a changed Node path is never a reason
 * to rewrite). Other handlers are left exactly as they are. Returns null when the file has no
 * Agent Pets hook (not installed) or cannot be parsed; nothing is written when nothing differs.
 */
export function ensureAgentPetsHookEntries(filePath: string, required: readonly RequiredHookEntry[]): ConfigWriteResult | null {
  let parsed: ReturnType<typeof readJsonObjectConfig>
  try {
    parsed = readJsonObjectConfig(filePath)
  } catch {
    return null
  }
  if (!parsed.exists || !isJsonObject(parsed.root.hooks)) return null
  const hooks = parsed.root.hooks
  let template: HookEntry | null = null
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue
      const own = group.hooks.find(isAgentPetsHook)
      if (own) { template = own as HookEntry; break }
    }
    if (template) break
  }
  if (!template) return null

  let changed = false
  for (const entry of required) {
    const current = hooks[entry.event]
    if (current !== undefined && !Array.isArray(current)) continue
    const groups = (current ?? []) as unknown[]
    const owned = groups
      .filter((group): group is JsonObject => isJsonObject(group) && Array.isArray(group.hooks))
      .flatMap(group => (group.hooks as unknown[]).filter(isAgentPetsHook) as HookEntry[])
    if (owned.length === 0) {
      const handler: HookEntry = { type: 'command', command: template.command }
      if (Array.isArray(template.args)) handler.args = [...template.args]
      if (entry.timeout !== undefined) handler.timeout = entry.timeout
      hooks[entry.event] = [...groups, { ...(entry.matcher ? { matcher: entry.matcher } : {}), hooks: [handler] }]
      changed = true
      continue
    }
    if (entry.timeout === undefined) continue
    for (const hook of owned) {
      if (hook.timeout !== entry.timeout) {
        hook.timeout = entry.timeout
        changed = true
      }
    }
  }
  if (!changed) return { status: 'unchanged', path: filePath, backupPath: null }
  return writeConfigSafely(filePath, serializeJson(parsed.root))
}

// ---- Claude Desktop config: single top-level key ----

export function setJsonKeyFile(filePath: string, key: string, value: unknown): ConfigWriteResult {
  const { root } = readJsonObjectConfig(filePath)
  if (JSON.stringify(root[key]) === JSON.stringify(value) && key in root) {
    return { status: 'unchanged', path: filePath, backupPath: null }
  }
  root[key] = value
  return writeConfigSafely(filePath, serializeJson(root))
}

/** Removes `key` only if its current value equals `expected` (i.e. we wrote it). */
export function removeJsonKeyFile(filePath: string, key: string, expected: unknown): HookRemovalResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  if (!exists || !(key in root) || JSON.stringify(root[key]) !== JSON.stringify(expected)) {
    return { status: 'absent', path: filePath, backupPath: null }
  }
  delete root[key]
  const write = writeConfigSafely(filePath, serializeJson(root))
  return { status: 'removed', path: filePath, backupPath: write.backupPath }
}

// ---- Codex config.toml [features].hooks ----
// TOML has no parser dependency here, so the single key is patched line by line.

export function enableCodexHooksFeatureText(existing: string): { content: string, added: boolean } {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing
    .split(/\r?\n/)
    .filter(line => !/^\s*codex_hooks\s*=/.test(line))
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  const featuresIndex = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  let added = false

  if (featuresIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push('[features]')
    lines.push('hooks = true')
    added = true
  } else {
    let insertIndex = featuresIndex + 1
    let hooksIndex = -1
    for (let i = featuresIndex + 1; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i])) break
      insertIndex = i + 1
      if (/^\s*hooks\s*=/.test(lines[i])) hooksIndex = i
    }
    if (hooksIndex === -1) {
      lines.splice(insertIndex, 0, 'hooks = true')
      added = true
    } else {
      lines[hooksIndex] = 'hooks = true'
    }
  }

  return { content: lines.join(eol).replace(/(\r?\n)*$/, eol), added }
}

/** Removes the `hooks = true` line (and an emptied `[features]` table) that enableCodexHooksFeatureText added. */
export function disableCodexHooksFeatureText(existing: string): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing.split(/\r?\n/)
  const featuresIndex = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  if (featuresIndex === -1) return existing
  let end = featuresIndex + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1
  const body = lines.slice(featuresIndex + 1, end)
  const kept = body.filter(line => !/^\s*hooks\s*=\s*true\s*(#.*)?$/.test(line))
  if (kept.length === body.length) return existing
  const meaningful = kept.some(line => line.trim() !== '')
  const next = meaningful
    ? [...lines.slice(0, featuresIndex + 1), ...kept, ...lines.slice(end)]
    : [...lines.slice(0, featuresIndex), ...lines.slice(end)]
  const joined = next.join(eol).replace(/(\r?\n){3,}/g, `${eol}${eol}`)
  return joined.trim() === '' ? '' : joined.replace(/(\r?\n)*$/, eol)
}

/** First token of a shell-form command, honouring double quotes. */
export function leadingExecutable(command: string): string {
  // `cmd /d /c "<wrapper>"` 只是啟動器；健康檢查要看的是被啟動的 wrapper。
  const trimmed = command.trim().replace(WINDOWS_CMD_LAUNCHER, '')
  if (trimmed.startsWith("'")) {
    // POSIX single quotes; a literal quote is written as '\''.
    let value = ''
    let index = 1
    while (index < trimmed.length) {
      if (trimmed.startsWith("'\\''", index)) { value += "'"; index += 4; continue }
      if (trimmed[index] === "'") return value
      value += trimmed[index]
      index += 1
    }
    return value
  }
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    return end > 0 ? trimmed.slice(1, end) : trimmed.slice(1)
  }
  // A Windows path may contain spaces without quotes; stop at the hook script marker if present.
  const marker = trimmed.search(/\s+["']?[^\s"']*agent-hook/)
  return (marker > 0 ? trimmed.slice(0, marker) : trimmed.split(/\s+/)[0] ?? '').trim()
}

/** The executable Agent Pets' hooks in this file would launch (exec-form `command` or shell-form leader). */
export function configuredHookExecutable(filePath: string): string | null {
  try {
    const { root } = readJsonObjectConfig(filePath)
    if (!isJsonObject(root.hooks)) return null
    for (const groups of Object.values(root.hooks)) {
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue
        for (const hook of group.hooks) {
          if (!isAgentPetsHook(hook)) continue
          const command = (hook as HookEntry).command
          if (typeof command !== 'string') continue
          return Array.isArray((hook as HookEntry).args) ? command : leadingExecutable(command)
        }
      }
    }
  } catch { /* unreadable config: no executable to report */ }
  return null
}

/** True only when `[features]` explicitly sets `hooks = true` (a missing key leaves hooks off). */
export function isCodexHooksFeatureEnabled(config: string | null): boolean {
  if (!config) return false
  const lines = config.split(/\r?\n/)
  const start = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  if (start < 0) return false
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i]!)) break
    const match = /^\s*hooks\s*=\s*(true|false)\s*(#.*)?$/.exec(lines[i]!)
    if (match) return match[1] === 'true'
  }
  return false
}

// ---- Hook command construction (quoting) ----

// 不需任何引號、在 cmd.exe 與 PowerShell 都會被解析成同一個路徑的字元集。
const WINDOWS_BARE_PATH = /^[A-Za-z0-9_.:\\-]+$/
const WINDOWS_CMD_LAUNCHER = /^cmd(?:\.exe)?\s+\/d\s+\/c\s+/i

/**
 * Shell-form command Codex runs. On POSIX every path is single-quoted (`'` becomes `'\''`), so `$`,
 * backticks, `"` and `\` in a user name stay literal. Paths that cannot be quoted safely
 * (newline/NUL everywhere; `"`, `%`, `$` and backtick on Windows) are refused with a ConfigRefusedError.
 *
 * Windows 的 Codex 用 PowerShell 執行 hook：`"C:\...\agent-hook.cmd" codex` 在 PowerShell 是
 * 「字串 + 多餘 token」的語法錯誤，hook 會被靜默略過。因此一般路徑一律不加引號（兩種 shell 都可用，
 * 也與舊版安裝相同，不會讓 Codex 的 hook 信任失效）；含空白或非 ASCII 的路徑才經由
 * `cmd /d /c "..."` 啟動，這個形式在 PowerShell 與 cmd.exe 底下都只把引號內視為單一路徑。
 */
export function codexHookCommand(options: { isWindows: boolean, nodeBin: string, hookScript: string, wrapper: string }): string {
  const refuse = (value: string, pattern: RegExp) => {
    if (pattern.test(value)) {
      throw new ConfigRefusedError('unsafe', value, 'A path contains characters that cannot be quoted safely in a hook command; Agent Pets did not modify the hook configuration.')
    }
  }
  if (options.isWindows) {
    // `$` 與反引號在 PowerShell 雙引號字串內會被展開，`%` 會被 cmd.exe 展開。
    refuse(options.wrapper, /["%$`\r\n\0]/)
    if (WINDOWS_BARE_PATH.test(options.wrapper)) return `${options.wrapper} codex`
    return `cmd /d /c "${options.wrapper}" codex`
  }
  const quote = (value: string) => {
    refuse(value, /[\r\n\0]/)
    return `'${value.replace(/'/g, `'\\''`)}'`
  }
  return `${quote(options.nodeBin)} ${quote(options.hookScript)} codex`
}

/** Escapes a path for use inside a double-quoted string in a .cmd file. */
export function escapeCmdQuotedPath(value: string): string {
  if (/["\r\n\0]/.test(value)) throw new Error('Path contains characters that cannot be used in a Windows batch file')
  return value.replace(/%/g, '%%')
}
