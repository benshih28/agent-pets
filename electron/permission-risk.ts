import type { PermissionRisk } from '../src/types/permission'

// Fail-closed: only an explicit read-only allowlist is `low`; any tool the table does not know
// (renamed, new, MCP-wrapped) is `high`, so it can never be approved with the global hotkey by accident.

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'glob', 'grep', 'list'])

const NETWORK_TOOLS: ReadonlySet<string> = new Set([
  'webfetch',
  'websearch',
  'web_fetch',
  'web_search',
  'fetch',
  'external_directory',
])

// Display/network-flag only; never used for risk.
export function toolBaseName(permission: string): string {
  const segments = permission
    .toLowerCase()
    .trim()
    .split(/__|[:./\\\s]+/)
    .filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1]! : ''
}

export function classifyPermissionRisk(permission: string): PermissionRisk {
  // No prefix stripping: `mcp__x__read`, `foo:list`, `x/read` are never `low`.
  const name = typeof permission === 'string' ? permission.trim().toLowerCase() : ''
  if (READ_ONLY_TOOLS.has(name)) return 'low'
  return 'high'
}

export function isNetworkPermission(permission: string): boolean {
  return NETWORK_TOOLS.has(toolBaseName(permission))
}

// File edits start as `high` and are lowered to `medium` only by classifyClaudeFileEdit.
// Unlisted tools are `unknown`, which (like `high`) is never hotkey-approvable.
const CLAUDE_TOOL_RISK: Readonly<Record<string, PermissionRisk>> = Object.freeze({
  Bash: 'high',
  Write: 'high',
  Edit: 'high',
  MultiEdit: 'high',
  NotebookEdit: 'high',
  WebFetch: 'high',
  WebSearch: 'high',
})

export const CLAUDE_FILE_EDIT_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const CLAUDE_NETWORK_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch'])

export function classifyClaudeToolRisk(toolName: string): PermissionRisk {
  if (typeof toolName !== 'string') return 'unknown'
  return Object.hasOwn(CLAUDE_TOOL_RISK, toolName) ? CLAUDE_TOOL_RISK[toolName]! : 'unknown'
}

export function isClaudeNetworkTool(toolName: string): boolean {
  return CLAUDE_NETWORK_TOOLS.has(toolName)
}

// Writing any of these leads to code running later, so such an edit is never a routine in-project change.
const EXECUTION_DIRECTORIES: ReadonlySet<string> = new Set(['.git', '.claude', '.husky', '.vscode', '.idea', '.devcontainer'])
const EXECUTION_FILES: ReadonlySet<string> = new Set([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin',
  '.zlogout', '.kshrc', '.cshrc', '.tcshrc', '.envrc', '.inputrc', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs',
  'config.fish', '.gitconfig', '.gitmodules', '.mcp.json',
])

export interface FileEditClassification {
  risk: 'medium' | 'high'
  /** Never an absolute home path. */
  relativePath?: string
}

// `medium` only when inside `cwd` both lexically and after resolving symlinks; anything else is `high`.
export function classifyClaudeFileEdit(
  filePath: unknown,
  cwd: unknown,
  pathApi: typeof import('node:path'),
  realpath?: (value: string) => string | null,
): FileEditClassification {
  if (typeof filePath !== 'string' || typeof cwd !== 'string' || !filePath || !cwd) return { risk: 'high' }
  if (!pathApi.isAbsolute(cwd) || /[\0\r\n]/.test(filePath + cwd)) return { risk: 'high' }
  const root = pathApi.resolve(cwd)
  const target = pathApi.resolve(root, filePath)
  const relative = insideRelative(pathApi, root, target)
  if (relative === null) return { risk: 'high' }
  const checked = [relative]
  if (realpath) {
    const realRoot = realpath(root)
    const realTarget = realpathOfExistingAncestor(pathApi, target, realpath)
    const realRelative = realRoot && realTarget ? insideRelative(pathApi, realRoot, realTarget) : null
    if (realRelative === null) return { risk: 'high' }
    checked.push(realRelative)
  }
  return {
    risk: checked.some(isExecutionRelevant) ? 'high' : 'medium',
    relativePath: relative,
  }
}

function isExecutionRelevant(relative: string): boolean {
  // Lower-cased everywhere: macOS and Windows volumes are usually case-insensitive.
  const segments = relative.split(/[\\/]+/).filter(Boolean).map(segment => segment.toLowerCase())
  if (segments.some(segment => EXECUTION_DIRECTORIES.has(segment))) return true
  if (EXECUTION_FILES.has(segments[segments.length - 1] ?? '')) return true
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'node_modules' && segments[index + 1] === '.bin') return true
  }
  return false
}

function insideRelative(pathApi: typeof import('node:path'), root: string, target: string): string | null {
  const relative = pathApi.relative(root, target)
  if (!relative || relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) return null
  return relative
}

function realpathOfExistingAncestor(
  pathApi: typeof import('node:path'),
  target: string,
  realpath: (value: string) => string | null,
): string | null {
  const missing: string[] = []
  let current = target
  for (let depth = 0; depth < 64; depth += 1) {
    const resolved = realpath(current)
    if (resolved) return missing.length > 0 ? pathApi.join(resolved, ...missing.reverse()) : resolved
    const parent = pathApi.dirname(current)
    if (parent === current) return null
    missing.push(pathApi.basename(current))
    current = parent
  }
  return null
}
