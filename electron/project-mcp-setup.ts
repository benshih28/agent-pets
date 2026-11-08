import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { renameSyncWithRetry } from './fs-rename.ts'
import {
  addLocalExcludes,
  findGitLocation,
  readTrackedPaths,
  toPosixRelative,
} from './git-tracking.ts'
import type {
  ProjectMcpClientId,
  ProjectMcpInstallResult,
  ProjectMcpPlan,
  ProjectMcpPlanClient,
  ProjectMcpResultCode,
  ProjectMcpRemovalResult,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '../src/types/project-mcp.ts'
import { PROJECT_MCP_CLIENTS } from '../src/types/project-mcp.ts'

const MAX_CONFIG_BYTES = 1024 * 1024
const SERVER_NAME = 'agent-pets'

export interface ProjectMcpInstallOptions {
  nodeExecutable: string
  bridgePath: string
}

export interface ProjectMcpSelection {
  /** Rewrite Agent Pets entries whose paths are outdated (App moved, Node upgraded). */
  updateStale?: boolean
  /** Clients to configure; defaults to every supported client. */
  clients?: ProjectMcpClientId[]
  /** Add the written files to .git/info/exclude so the local paths they contain are never committed. */
  localOnly?: boolean
}

class ProjectMcpConfigError extends Error {
  readonly code: ProjectMcpResultCode
  readonly manualSnippet?: string

  constructor(code: ProjectMcpResultCode, message: string, manualSnippet?: string) {
    super(message)
    this.code = code
    this.manualSnippet = manualSnippet
  }
}

interface JsonRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAbsoluteFile(value: string): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_024
    && path.isAbsolute(value)
    && !/[\u0000\r\n]/.test(value)
}

function canonicalProjectPath(projectPath: string): string {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new Error('Project path must be absolute')
  }

  const stat = fs.lstatSync(projectPath)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Project path must be a regular directory')
  }

  const canonical = fs.realpathSync(projectPath)
  if (path.parse(canonical).root === canonical) {
    throw new Error('Project path cannot be a filesystem root')
  }
  return canonical
}

function ensureSafeDirectory(directoryPath: string): void {
  if (fs.existsSync(directoryPath)) {
    const stat = fs.lstatSync(directoryPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Refusing to use an unsafe directory: ${directoryPath}`)
    }
    return
  }
  fs.mkdirSync(directoryPath, { recursive: true })
}

function readBoundedText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ProjectMcpConfigError('unsafe_file', `Configuration file is not a regular file: ${filePath}`)
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new ProjectMcpConfigError(
      'too_large',
      `Configuration file is ${stat.size} bytes, above the ${MAX_CONFIG_BYTES} byte limit: ${filePath}`,
    )
  }
  return fs.readFileSync(filePath, 'utf8')
}

function writeTextAtomic(filePath: string, content: string): void {
  ensureSafeDirectory(path.dirname(filePath))
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace an unsafe configuration file: ${filePath}`)
    }
  }

  // Project config files are often shared with teammates: keep an existing file's mode.
  let mode = 0o644
  try { mode = fs.statSync(filePath).mode & 0o777 } catch { /* new file */ }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode })
    renameSyncWithRetry(temporaryPath, filePath)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, mode) } catch {}
    }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    throw error
  }
}

function configPath(projectPath: string, client: ProjectMcpClientId): string {
  switch (client) {
    case 'codex': return path.join(projectPath, '.codex', 'config.toml')
    case 'claude': return path.join(projectPath, '.mcp.json')
    case 'opencode': return path.join(projectPath, 'opencode.json')
  }
}

export function projectMcpConfigPath(projectPath: string, client: ProjectMcpClientId): string {
  return configPath(projectPath, client)
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function codexBlock(nodeExecutable: string, bridgePath: string): string {
  return [
    '# Agent Pets Presentation MCP',
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(nodeExecutable)}`,
    `args = [${tomlString(bridgePath)}]`,
    '',
  ].join('\n')
}

function readTomlSection(content: string, sectionName: string): string | null {
  const lines = content.split(/\r?\n/)
  const header = `[${sectionName}]`
  const start = lines.findIndex(line => line.trim() === header)
  if (start < 0) return null
  const section: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) break
    section.push(lines[index])
  }
  return section.join('\n')
}

function tomlValue(section: string, key: string): unknown {
  const line = section.split(/\r?\n/).find(candidate => (
    new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`).test(candidate)
  ))
  if (!line) return undefined
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`))
  if (!match) return undefined
  try { return JSON.parse(match[1]) } catch { return undefined }
}

function isCodexConfigured(content: string, nodeExecutable: string, bridgePath: string): boolean {
  const section = readTomlSection(content, `mcp_servers.${SERVER_NAME}`)
  if (section === null) return false
  return tomlValue(section, 'command') === nodeExecutable
    && JSON.stringify(tomlValue(section, 'args')) === JSON.stringify([bridgePath])
}

function stripJsonc(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === '\\') { out += text[i + 1] ?? ''; i += 1 } else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; continue }
    out += ch
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function readJsonRoot(filePath: string, snippet?: string): JsonRecord {
  const content = readBoundedText(filePath)
  if (content === null || content.trim() === '') return {}
  const text = content.replace(/^\uFEFF/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    let isJsonc = false
    try { JSON.parse(stripJsonc(text)); isJsonc = true } catch { /* genuinely invalid */ }
    throw new ProjectMcpConfigError(
      isJsonc ? 'jsonc' : 'invalid_json',
      isJsonc
        ? `Configuration contains comments or trailing commas (JSONC) and was not changed: ${filePath}`
        : `Configuration is not valid JSON: ${filePath}`,
      snippet,
    )
  }
  if (!isRecord(parsed)) {
    throw new ProjectMcpConfigError('root_not_object', `Configuration root must be an object: ${filePath}`, snippet)
  }
  return parsed
}

// Re-serialise with the file's own indentation and line endings so an edit only adds our entry
// instead of reformatting the whole file.
function serializeLike(root: JsonRecord, original: string | null): string {
  let indent: string | number = 2
  let eol = '\n'
  if (original) {
    eol = original.includes('\r\n') ? '\r\n' : '\n'
    const match = /^[ \t]+(?=")/m.exec(original)
    if (match) indent = match[0].startsWith('\t') ? '\t' : match[0].length
  }
  const body = JSON.stringify(root, null, indent)
  return `${eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body}${eol}`
}

function installedResult(
  client: ProjectMcpClientId,
  status: ProjectMcpInstallResult['status'],
  filePath: string,
  code: ProjectMcpResultCode,
  message: string,
  manualSnippet?: string,
): ProjectMcpInstallResult {
  return { client, status, configPath: filePath, code, message, ...(manualSnippet ? { manualSnippet } : {}) }
}

function expectedForClient(
  client: ProjectMcpClientId,
  options: ProjectMcpInstallOptions,
): JsonRecord | null {
  if (client === 'claude') {
    return {
      type: 'stdio',
      command: options.nodeExecutable,
      args: [options.bridgePath],
    }
  }
  if (client === 'opencode') {
    return {
      type: 'local',
      command: [options.nodeExecutable, options.bridgePath],
      enabled: true,
    }
  }
  return null
}

/** The text a user would paste by hand when Agent Pets will not (or cannot) edit the file. */
export function manualSnippetFor(client: ProjectMcpClientId, options: ProjectMcpInstallOptions): string {
  if (client === 'codex') return codexBlock(options.nodeExecutable, options.bridgePath)
  const expected = expectedForClient(client, options)!
  const wrapped = client === 'claude'
    ? { mcpServers: { [SERVER_NAME]: expected } }
    : { mcp: { [SERVER_NAME]: expected } }
  return `${JSON.stringify(wrapped, null, 2)}\n`
}

const CLIENT_NAME: Record<ProjectMcpClientId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
}

function codexResult(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, 'codex')
  const content = readBoundedText(filePath) ?? ''
  const existingSection = readTomlSection(content, `mcp_servers.${SERVER_NAME}`)
  if (existingSection === null) {
    return installedResult('codex', 'not_configured', filePath, 'not_configured', 'Codex project MCP is not configured.')
  }
  const configured = isCodexConfigured(content, options.nodeExecutable, options.bridgePath)
  return configured
    ? installedResult('codex', 'already_configured', filePath, 'already_configured', 'Codex project MCP is configured.')
    : mismatchResult('codex', filePath, codexLooksLikeOurs(existingSection), manualSnippetFor('codex', options))
}

function withoutCodexSection(content: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `[mcp_servers.${SERVER_NAME}]`)
  if (start < 0) return content
  let end = start + 1
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end]!)) end += 1
  let removeStart = start
  if (removeStart > 0 && lines[removeStart - 1]!.trim() === '# Agent Pets Presentation MCP') removeStart -= 1
  return lines.slice(0, removeStart).concat(lines.slice(end)).join(eol)
}

function installCodex(
  projectPath: string,
  options: ProjectMcpInstallOptions,
  updateStale = false,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, 'codex')
  let content = readBoundedText(filePath) ?? ''
  const existingSection = readTomlSection(content, `mcp_servers.${SERVER_NAME}`)
  let updated = false
  if (existingSection !== null) {
    const current = codexResult(projectPath, options)
    if (!(updateStale && current.status === 'stale')) return current
    content = withoutCodexSection(content).replace(/(\r?\n)+$/, '\n')
    updated = true
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const block = codexBlock(options.nodeExecutable, options.bridgePath).replace(/\n/g, eol)
  const separator = content.length > 0 && !content.endsWith('\n') ? eol : ''
  writeTextAtomic(filePath, `${content}${separator}${content.length > 0 ? eol : ''}${block}`)
  return installedResult('codex', 'installed', filePath, updated ? 'updated' : 'installed', updated ? 'Codex project MCP paths updated.' : 'Codex project MCP installed.')
}

// A stale entry of ours runs Node.js by absolute path; any other command is the user's own.
function nodeCommand(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)) return false
  return /^node(\.exe)?$/i.test(path.win32.basename(value))
}

function bridgeName(value: unknown): boolean {
  return typeof value === 'string' && /(^|[\\/])presentation-mcp\.mjs$/.test(value)
}

// An entry that has the shape Agent Pets writes but with other paths: our own entry gone stale
// (App moved, Node upgraded) rather than something the user wrote.
function looksLikeOurs(client: ProjectMcpClientId, entry: unknown): boolean {
  if (!isRecord(entry)) return false
  // Extra keys (env, headers, ...) mean the user customized the entry: never treat it as ours.
  const onlyKeys = (allowed: string[]) => Object.keys(entry).every(key => allowed.includes(key))
  if (client === 'claude') {
    return onlyKeys(['type', 'command', 'args']) && entry.type === 'stdio'
      && nodeCommand(entry.command) && Array.isArray(entry.args) && entry.args.length === 1 && bridgeName(entry.args[0])
  }
  if (client === 'opencode') {
    return onlyKeys(['type', 'command', 'enabled']) && entry.type === 'local'
      && Array.isArray(entry.command) && entry.command.length === 2 && nodeCommand(entry.command[0]) && bridgeName(entry.command[1])
  }
  return false
}

function codexLooksLikeOurs(section: string): boolean {
  const keys = section.split(/\r?\n/)
    .map(line => /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key))
  if (keys.some(key => key !== 'command' && key !== 'args')) return false
  const args = tomlValue(section, 'args')
  return nodeCommand(tomlValue(section, 'command')) && Array.isArray(args) && args.length === 1 && bridgeName(args[0])
}

function mismatchResult(
  client: ProjectMcpClientId,
  filePath: string,
  stale: boolean,
  snippet: string,
): ProjectMcpInstallResult {
  return stale
    ? installedResult(client, 'stale', filePath, 'stale_paths', 'The Agent Pets entry points at outdated paths; update it to the current ones.', snippet)
    : installedResult(client, 'conflict', filePath, 'server_mismatch', 'A different agent-pets server exists and was left unchanged.', snippet)
}

function sameStdioServer(existing: unknown, expected: JsonRecord): boolean {
  if (!isRecord(existing)) return false
  const existingKeys = Object.keys(existing).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (existingKeys.length !== expectedKeys.length || existingKeys.some((key, index) => key !== expectedKeys[index])) {
    return false
  }
  const commandsMatch = Array.isArray(existing.command) || Array.isArray(expected.command)
    ? JSON.stringify(existing.command) === JSON.stringify(expected.command)
    : existing.command === expected.command
  if (!commandsMatch) return false
  if (JSON.stringify(existing.args) !== JSON.stringify(expected.args)) return false
  return existing.type === expected.type
}

function legacyOpenCodeServer(expected: JsonRecord): JsonRecord {
  const legacy = { ...expected }
  delete legacy.enabled
  return legacy
}

function installJsonServer(
  projectPath: string,
  client: 'claude' | 'opencode',
  expected: JsonRecord,
  options: ProjectMcpInstallOptions,
  updateStale = false,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, client)
  const snippet = manualSnippetFor(client, options)
  const original = readBoundedText(filePath)
  let updated = false
  const root = readJsonRoot(filePath, snippet)
  const name = CLIENT_NAME[client]

  if (client === 'claude') {
    if (root.mcpServers === undefined) root.mcpServers = {}
    if (!isRecord(root.mcpServers)) {
      return installedResult(client, 'conflict', filePath, 'servers_not_object', 'The mcpServers value is not an object; the file was left unchanged.', snippet)
    }
    const servers = root.mcpServers
    if (servers[SERVER_NAME] !== undefined) {
      if (sameStdioServer(servers[SERVER_NAME], expected)) {
        return installedResult(client, 'already_configured', filePath, 'already_configured', `${name} project MCP is configured.`)
      }
      const stale = looksLikeOurs(client, servers[SERVER_NAME])
      if (!(stale && updateStale)) return mismatchResult(client, filePath, stale, snippet)
      updated = true
    }
    servers[SERVER_NAME] = expected
  } else {
    if (root.mcp === undefined) root.mcp = {}
    if (!isRecord(root.mcp)) {
      return installedResult(client, 'conflict', filePath, 'servers_not_object', 'The mcp value is not an object; the file was left unchanged.', snippet)
    }
    const mcp = root.mcp
    if (mcp[SERVER_NAME] !== undefined) {
      if (sameStdioServer(mcp[SERVER_NAME], expected)) {
        return installedResult(client, 'already_configured', filePath, 'already_configured', `${name} project MCP is configured.`)
      }
      const stale = looksLikeOurs(client, mcp[SERVER_NAME])
      if (!(stale && updateStale)) return mismatchResult(client, filePath, stale, snippet)
      updated = true
    }
    if (mcp.servers !== undefined) {
      if (!isRecord(mcp.servers)) {
        return installedResult(client, 'conflict', filePath, 'servers_not_object', 'The mcp.servers value is not an object; the file was left unchanged.', snippet)
      }
      const legacyServers = mcp.servers
      if (legacyServers[SERVER_NAME] !== undefined) {
        if (!sameStdioServer(legacyServers[SERVER_NAME], legacyOpenCodeServer(expected))) {
          return installedResult(client, 'conflict', filePath, 'server_mismatch', 'A different agent-pets server exists and was left unchanged.', snippet)
        }
        delete legacyServers[SERVER_NAME]
        if (Object.keys(legacyServers).length === 0) delete mcp.servers
      }
    }
    mcp[SERVER_NAME] = expected
  }

  writeTextAtomic(filePath, serializeLike(root, original))
  return installedResult(client, 'installed', filePath, updated ? 'updated' : 'installed', updated ? `${name} project MCP paths updated.` : `${name} project MCP installed.`)
}

function jsonServerResult(
  projectPath: string,
  client: 'claude' | 'opencode',
  expected: JsonRecord,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, client)
  const snippet = manualSnippetFor(client, options)
  const root = readJsonRoot(filePath, snippet)
  const name = CLIENT_NAME[client]
  const parent = client === 'claude' ? root.mcpServers : root.mcp
  if (!isRecord(parent) || parent[SERVER_NAME] === undefined) {
    if (client === 'opencode' && isRecord(root.mcp) && isRecord(root.mcp.servers)) {
      const legacyServer = root.mcp.servers[SERVER_NAME]
      if (legacyServer !== undefined) {
        return sameStdioServer(legacyServer, legacyOpenCodeServer(expected))
          ? installedResult(client, 'conflict', filePath, 'legacy_format', 'OpenCode project MCP uses the legacy format; set it up again to migrate.', snippet)
          : installedResult(client, 'conflict', filePath, 'server_mismatch', 'A different agent-pets server exists and was left unchanged.', snippet)
      }
    }
    return installedResult(client, 'not_configured', filePath, 'not_configured', `${name} project MCP is not configured.`)
  }
  return sameStdioServer(parent[SERVER_NAME], expected)
    ? installedResult(client, 'already_configured', filePath, 'already_configured', `${name} project MCP is configured.`)
    : mismatchResult(client, filePath, looksLikeOurs(client, parent[SERVER_NAME]), snippet)
}

function installClaude(projectPath: string, options: ProjectMcpInstallOptions, updateStale = false): ProjectMcpInstallResult {
  return installJsonServer(projectPath, 'claude', expectedForClient('claude', options)!, options, updateStale)
}

function installOpenCode(projectPath: string, options: ProjectMcpInstallOptions, updateStale = false): ProjectMcpInstallResult {
  return installJsonServer(projectPath, 'opencode', expectedForClient('opencode', options)!, options, updateStale)
}

function inspectClient(
  projectPath: string,
  client: ProjectMcpClientId,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  if (client === 'codex') return codexResult(projectPath, options)
  const expected = expectedForClient(client, options)
  if (!expected) throw new Error(`Unsupported MCP client: ${client}`)
  return jsonServerResult(projectPath, client, expected, options)
}

function errorResult(
  client: ProjectMcpClientId,
  filePath: string,
  error: unknown,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  if (error instanceof ProjectMcpConfigError) {
    return { client, status: 'error', configPath: filePath, code: error.code, message: error.message, ...(error.manualSnippet ? { manualSnippet: error.manualSnippet } : {}) }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    client,
    status: 'error',
    configPath: filePath,
    code: 'write_failed',
    message,
    manualSnippet: manualSnippetFor(client, options),
  }
}

function assertOptions(options: ProjectMcpInstallOptions, action: 'setup' | 'removal'): void {
  if (!isAbsoluteFile(options.nodeExecutable) || !isAbsoluteFile(options.bridgePath)) {
    throw new Error(action === 'setup'
      ? 'MCP setup requires absolute Node.js and bridge paths'
      : 'MCP removal requires absolute Node.js and bridge paths')
  }
}

export function inspectProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpSetupSummary {
  assertOptions(options, 'setup')

  const canonicalPath = canonicalProjectPath(projectPath)
  const results = PROJECT_MCP_CLIENTS.map((client): ProjectMcpInstallResult => {
    try {
      return inspectClient(canonicalPath, client, options)
    } catch (error) {
      return errorResult(client, configPath(canonicalPath, client), error, options)
    }
  })

  return {
    ok: results.every(result => result.status === 'already_configured'),
    projectPath: canonicalPath,
    results,
  }
}

function removalResult(
  client: ProjectMcpClientId,
  status: ProjectMcpRemovalResult['status'],
  configPathValue: string,
  code: ProjectMcpResultCode,
  message: string,
): ProjectMcpRemovalResult {
  return { client, status, configPath: configPathValue, code, message }
}

function removeCodex(projectPath: string, options: ProjectMcpInstallOptions): ProjectMcpRemovalResult {
  const filePath = configPath(projectPath, 'codex')
  const content = readBoundedText(filePath)
  if (content === null || readTomlSection(content, `mcp_servers.${SERVER_NAME}`) === null) {
    return removalResult('codex', 'already_absent', filePath, 'already_absent', 'Codex project MCP is not present.')
  }
  const codexSection = readTomlSection(content, `mcp_servers.${SERVER_NAME}`) ?? ''
  if (!isCodexConfigured(content, options.nodeExecutable, options.bridgePath) && !codexLooksLikeOurs(codexSection)) {
    return removalResult('codex', 'conflict', filePath, 'entry_changed', 'The Codex entry was changed, so it was not removed.')
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `[mcp_servers.${SERVER_NAME}]`)
  if (start < 0) {
    return removalResult('codex', 'already_absent', filePath, 'already_absent', 'Codex project MCP is not present.')
  }
  let end = start + 1
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end])) end += 1
  let removeStart = start
  if (removeStart > 0 && lines[removeStart - 1].trim() === '# Agent Pets Presentation MCP') {
    removeStart -= 1
  }
  const next = lines.slice(0, removeStart).concat(lines.slice(end)).join(eol)
  writeTextAtomic(filePath, next)
  return removalResult('codex', 'removed', filePath, 'removed', 'Agent Pets Codex MCP entry removed.')
}

function removeJsonServer(
  projectPath: string,
  client: 'claude' | 'opencode',
  options: ProjectMcpInstallOptions,
): ProjectMcpRemovalResult {
  const filePath = configPath(projectPath, client)
  const original = readBoundedText(filePath)
  if (original === null) {
    return removalResult(client, 'already_absent', filePath, 'already_absent', 'Project MCP is not present.')
  }
  const root = readJsonRoot(filePath, manualSnippetFor(client, options))
  const parent = client === 'claude' ? root.mcpServers : root.mcp
  if (!isRecord(parent) || parent[SERVER_NAME] === undefined) {
    if (client === 'opencode' && isRecord(root.mcp) && isRecord(root.mcp.servers)) {
      const legacyServers = root.mcp.servers
      if (legacyServers[SERVER_NAME] !== undefined) {
        const expected = expectedForClient(client, options)
        if (!expected || !sameStdioServer(legacyServers[SERVER_NAME], legacyOpenCodeServer(expected))) {
          return removalResult(client, 'conflict', filePath, 'entry_changed', 'The entry was changed, so it was not removed.')
        }
        delete legacyServers[SERVER_NAME]
        if (Object.keys(legacyServers).length === 0) delete root.mcp.servers
        writeTextAtomic(filePath, serializeLike(root, original))
        return removalResult(client, 'removed', filePath, 'removed', 'Agent Pets project MCP entry removed.')
      }
    }
    return removalResult(client, 'already_absent', filePath, 'already_absent', 'Project MCP is not present.')
  }
  const expected = expectedForClient(client, options)
  if (!expected || (!sameStdioServer(parent[SERVER_NAME], expected) && !looksLikeOurs(client, parent[SERVER_NAME]))) {
    return removalResult(client, 'conflict', filePath, 'entry_changed', 'The entry was changed, so it was not removed.')
  }
  delete parent[SERVER_NAME]
  writeTextAtomic(filePath, serializeLike(root, original))
  return removalResult(client, 'removed', filePath, 'removed', 'Agent Pets project MCP entry removed.')
}

export function removeProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpRemovalSummary {
  assertOptions(options, 'removal')

  const canonicalPath = canonicalProjectPath(projectPath)
  const results = PROJECT_MCP_CLIENTS.map((client): ProjectMcpRemovalResult => {
    try {
      if (client === 'codex') return removeCodex(canonicalPath, options)
      return removeJsonServer(canonicalPath, client, options)
    } catch (error) {
      const failed = errorResult(client, configPath(canonicalPath, client), error, options)
      return { client, status: 'error', configPath: failed.configPath, code: failed.code, message: failed.message }
    }
  })

  return {
    ok: results.every(result => result.status === 'removed' || result.status === 'already_absent'),
    projectPath: canonicalPath,
    results,
  }
}

function selectedClients(selection?: ProjectMcpSelection): ProjectMcpClientId[] {
  const requested = selection?.clients
  if (!requested) return [...PROJECT_MCP_CLIENTS]
  return PROJECT_MCP_CLIENTS.filter(client => requested.includes(client))
}

export function installProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
  selection?: ProjectMcpSelection,
): ProjectMcpSetupSummary {
  assertOptions(options, 'setup')

  const canonicalPath = canonicalProjectPath(projectPath)
  const clients = selectedClients(selection)
  if (clients.length === 0) throw new Error('Select at least one MCP client')

  const results = clients.map((client): ProjectMcpInstallResult => {
    try {
      const updateStale = selection?.updateStale === true
      if (client === 'codex') return installCodex(canonicalPath, options, updateStale)
      if (client === 'claude') return installClaude(canonicalPath, options, updateStale)
      return installOpenCode(canonicalPath, options, updateStale)
    } catch (error) {
      return errorResult(client, configPath(canonicalPath, client), error, options)
    }
  })

  const summary: ProjectMcpSetupSummary = {
    ok: results.every(result => result.status === 'installed' || result.status === 'already_configured'),
    projectPath: canonicalPath,
    results,
  }

  if (selection?.localOnly) {
    const location = findGitLocation(canonicalPath)
    if (location?.outside) {
      summary.warnings = ['git_outside_project']
    } else if (location) {
      const tracked = readTrackedPaths(location)
      const relativePaths = results
        .filter(result => result.status === 'installed' || result.status === 'already_configured')
        .map(result => toPosixRelative(canonicalPath, result.configPath))
      const trackedFiles = relativePaths.filter(relative => tracked?.has(relative))
      const excludable = relativePaths.filter(relative => !tracked?.has(relative))
      try {
        summary.excluded = addLocalExcludes(location, excludable)
      } catch (error) {
        summary.warnings = ['exclude_write_failed']
      }
      if (trackedFiles.length > 0) summary.trackedFiles = trackedFiles
    }
  }
  return summary
}

// Folders and files that signal which agent clients the user actually uses.
function detectClients(projectPath: string, homeDirectory: string): Record<ProjectMcpClientId, boolean> {
  const exists = (target: string) => fs.existsSync(target)
  return {
    codex: exists(path.join(projectPath, '.codex')) || exists(path.join(homeDirectory, '.codex')),
    claude: exists(path.join(projectPath, '.mcp.json')) || exists(path.join(projectPath, '.claude'))
      || exists(path.join(homeDirectory, '.claude')),
    opencode: exists(path.join(projectPath, 'opencode.json')) || exists(path.join(homeDirectory, '.config', 'opencode')),
  }
}

/** Read-only preview of what installProjectMcp would do; nothing is written. */
export function planProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
  homeDirectory: string = os.homedir(),
): ProjectMcpPlan {
  assertOptions(options, 'setup')
  const canonicalPath = canonicalProjectPath(projectPath)
  const location = findGitLocation(canonicalPath)
  const tracked = location ? readTrackedPaths(location) : null
  const detected = detectClients(canonicalPath, homeDirectory)

  const clients = PROJECT_MCP_CLIENTS.map((client): ProjectMcpPlanClient => {
    const filePath = configPath(canonicalPath, client)
    const relativePath = toPosixRelative(canonicalPath, filePath)
    const base = {
      client,
      configPath: filePath,
      relativePath,
      exists: fs.existsSync(filePath),
      gitTracked: location && tracked ? tracked.has(relativePath) : null,
      suggested: detected[client],
      preview: manualSnippetFor(client, options),
    }
    try {
      const current = inspectClient(canonicalPath, client, options)
      return { ...base, status: current.status as ProjectMcpPlanClient['status'], code: current.code }
    } catch (error) {
      const failed = errorResult(client, filePath, error, options)
      return { ...base, status: 'error', code: failed.code, message: failed.message }
    }
  })

  return { ok: true, projectPath: canonicalPath, isGitRepo: location !== null, clients }
}
