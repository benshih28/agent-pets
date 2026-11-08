import type { PermissionRisk } from '../src/types/permission'

// Fail-closed risk classification for tool names reported by an adapter.
//
// Only tools on an explicit read-only allowlist are `low`. Anything the table
// does not know — renamed tools, new tools, MCP-wrapped tools — is `high`, so
// a tool that merely *sounds* harmless (or hides a dangerous word inside a
// longer name) can never be approved with the global hotkey by accident.
// `unknown` is reserved for requests whose adapter supplied no classification.

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'glob', 'grep', 'list'])

// Tools that reach outside the machine. They stay high-risk (no hotkey) and
// are additionally flagged so the UI can say "connects to the network".
const NETWORK_TOOLS: ReadonlySet<string> = new Set([
  'webfetch',
  'websearch',
  'web_fetch',
  'web_search',
  'fetch',
  'external_directory',
])

/** Display/network-flag helper only (never used for risk): the tool name with any `mcp__server__` / `server:` / `ns.` prefix removed. */
export function toolBaseName(permission: string): string {
  const segments = permission
    .toLowerCase()
    .trim()
    .split(/__|[:./\\\s]+/)
    .filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1]! : ''
}

export function classifyPermissionRisk(permission: string): PermissionRisk {
  // Exact match on the whole (trimmed, lower-cased) name. No prefix stripping:
  // `mcp__x__read`, `foo:list`, `x/read` or `rm -rf x list` are never `low`.
  const name = typeof permission === 'string' ? permission.trim().toLowerCase() : ''
  if (READ_ONLY_TOOLS.has(name)) return 'low'
  return 'high'
}

export function isNetworkPermission(permission: string): boolean {
  return NETWORK_TOOLS.has(toolBaseName(permission))
}

// Claude Code reports its own tool names (PascalCase). A shell command can do
// anything, so it is `high`. File edits start as `high` too and are lowered to
// `medium` only by classifyClaudeFileEdit, once the target is known to be an
// ordinary file inside the project. MCP tools and any tool this table does not
// know are `unknown`, which (like `high`) is never hotkey-approvable.
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

// Writing any of these leads to code running later (git hooks, agent / editor
// settings, package binaries, shell start-up files), so such an edit is never
// treated as a routine in-project change.
const EXECUTION_DIRECTORIES: ReadonlySet<string> = new Set(['.git', '.claude', '.husky', '.vscode', '.idea', '.devcontainer'])
const EXECUTION_FILES: ReadonlySet<string> = new Set([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin',
  '.zlogout', '.kshrc', '.cshrc', '.tcshrc', '.envrc', '.inputrc', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs',
  'config.fish', '.gitconfig', '.gitmodules', '.mcp.json',
])

export interface FileEditClassification {
  risk: 'medium' | 'high'
  /** Path relative to the project when the file is inside it; never an absolute home path. */
  relativePath?: string
}

/**
 * `medium` only when `filePath` resolves inside `cwd` (lexically and, when `realpath` is
 * given, after resolving symlinks of the deepest existing ancestor) and is not an
 * execution-relevant location. Anything else, including a missing or relative cwd, is `high`.
 */
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
  // Lower-cased on every platform: macOS and Windows volumes are usually case-insensitive,
  // so `.Git/hooks` must not slip past the `.git` rule.
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
