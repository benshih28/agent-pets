import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import type {
  ProjectMcpClientId,
  ProjectMcpInstallResult,
  ProjectMcpRemovalResult,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '../src/types/project-mcp.ts'
import { PROJECT_MCP_CLIENTS } from '../src/types/project-mcp.ts'

const MAX_CONFIG_BYTES = 128 * 1024
const SERVER_NAME = 'agent-pets'

export interface ProjectMcpInstallOptions {
  nodeExecutable: string
  bridgePath: string
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
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error(`Configuration file is not a regular file or is too large: ${filePath}`)
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

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSyncWithRetry(temporaryPath, filePath)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600) } catch {}
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

function codexResult(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, 'codex')
  const content = readBoundedText(filePath) ?? ''
  const existingSection = readTomlSection(content, `mcp_servers.${SERVER_NAME}`)
  if (existingSection === null) {
    return {
      client: 'codex',
      status: 'not_configured',
      configPath: filePath,
      message: 'Codex 專案 MCP 尚未設定。',
    }
  }
  const configured = isCodexConfigured(content, options.nodeExecutable, options.bridgePath)
  return {
    client: 'codex',
    status: configured ? 'already_configured' : 'conflict',
    configPath: filePath,
    message: configured
      ? 'Codex 專案 MCP 已設定。'
      : '專案已有不同的 [mcp_servers.agent-pets] 設定，因此未修改。',
  }
}

function installCodex(projectPath: string, options: ProjectMcpInstallOptions): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, 'codex')
  const content = readBoundedText(filePath) ?? ''
  const existingSection = readTomlSection(content, `mcp_servers.${SERVER_NAME}`)
  if (existingSection !== null) {
    return codexResult(projectPath, options)
  }

  const directory = path.dirname(filePath)
  ensureSafeDirectory(directory)
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  writeTextAtomic(filePath, `${content}${separator}${content.length > 0 ? '\n' : ''}${codexBlock(options.nodeExecutable, options.bridgePath)}`)
  return {
    client: 'codex',
    status: 'installed',
    configPath: filePath,
    message: 'Codex 專案 MCP 已安裝。',
  }
}

function readJsonRoot(filePath: string): JsonRecord {
  const content = readBoundedText(filePath)
  if (content === null || content.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Configuration is not valid JSON: ${filePath}`)
  }
  if (!isRecord(parsed)) throw new Error(`Configuration root must be an object: ${filePath}`)
  return parsed
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
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, client)
  const root = readJsonRoot(filePath)

  if (client === 'claude') {
    if (root.mcpServers === undefined) root.mcpServers = {}
    if (!isRecord(root.mcpServers)) {
      return { client, status: 'conflict', configPath: filePath, message: '專案的 mcpServers 值不是物件，因此未修改。' }
    }
    const servers = root.mcpServers
    if (servers[SERVER_NAME] !== undefined) {
      const configured = sameStdioServer(servers[SERVER_NAME], expected)
      return {
        client,
        status: configured ? 'already_configured' : 'conflict',
        configPath: filePath,
        message: configured
          ? 'Claude Code 專案 MCP 已設定。'
          : '專案已有不同的 agent-pets server，因此未修改。',
      }
    }
    servers[SERVER_NAME] = expected
  } else {
    if (root.mcp === undefined) root.mcp = {}
    if (!isRecord(root.mcp)) {
      return { client, status: 'conflict', configPath: filePath, message: '專案的 mcp 值不是物件，因此未修改。' }
    }
    const mcp = root.mcp
    if (mcp[SERVER_NAME] !== undefined) {
      const configured = sameStdioServer(mcp[SERVER_NAME], expected)
      return {
        client,
        status: configured ? 'already_configured' : 'conflict',
        configPath: filePath,
        message: configured
          ? 'OpenCode 專案 MCP 已設定。'
          : '專案已有不同的 agent-pets server，因此未修改。',
      }
    }
    if (mcp.servers !== undefined) {
      if (!isRecord(mcp.servers)) {
        return { client, status: 'conflict', configPath: filePath, message: '專案的 mcp.servers 值不是物件，因此未修改。' }
      }
      const legacyServers = mcp.servers
      if (legacyServers[SERVER_NAME] !== undefined) {
        if (!sameStdioServer(legacyServers[SERVER_NAME], legacyOpenCodeServer(expected))) {
          return { client, status: 'conflict', configPath: filePath, message: '專案已有不同的 agent-pets server，因此未修改。' }
        }
        delete legacyServers[SERVER_NAME]
        if (Object.keys(legacyServers).length === 0) delete mcp.servers
      }
    }
    mcp[SERVER_NAME] = expected
  }

  writeTextAtomic(filePath, `${JSON.stringify(root, null, 2)}\n`)
  return {
    client,
    status: 'installed',
    configPath: filePath,
    message: `${client === 'claude' ? 'Claude Code' : 'OpenCode'} 專案 MCP 已安裝。`,
  }
}

function jsonServerResult(
  projectPath: string,
  client: 'claude' | 'opencode',
  expected: JsonRecord,
): ProjectMcpInstallResult {
  const filePath = configPath(projectPath, client)
  const root = readJsonRoot(filePath)
  const parent = client === 'claude' ? root.mcpServers : root.mcp
  if (!isRecord(parent) || parent[SERVER_NAME] === undefined) {
    if (client === 'opencode' && isRecord(root.mcp) && isRecord(root.mcp.servers)) {
      const legacyServer = root.mcp.servers[SERVER_NAME]
      if (legacyServer !== undefined) {
        const configured = sameStdioServer(legacyServer, legacyOpenCodeServer(expected))
        return {
          client,
          status: 'conflict',
          configPath: filePath,
          message: configured
            ? 'OpenCode 專案 MCP 使用舊格式，請重新設定。'
            : '專案已有不同的 agent-pets server，因此未修改。',
        }
      }
    }
    return {
      client,
      status: 'not_configured',
      configPath: filePath,
      message: `${client === 'claude' ? 'Claude Code' : 'OpenCode'} 專案 MCP 尚未設定。`,
    }
  }
  const configured = sameStdioServer(parent[SERVER_NAME], expected)
  return {
    client,
    status: configured ? 'already_configured' : 'conflict',
    configPath: filePath,
    message: configured
      ? `${client === 'claude' ? 'Claude Code' : 'OpenCode'} 專案 MCP 已設定。`
      : '專案已有不同的 agent-pets server，因此未修改。',
  }
}

function installClaude(projectPath: string, options: ProjectMcpInstallOptions): ProjectMcpInstallResult {
  return installJsonServer(projectPath, 'claude', {
    type: 'stdio',
    command: options.nodeExecutable,
    args: [options.bridgePath],
  })
}

function installOpenCode(projectPath: string, options: ProjectMcpInstallOptions): ProjectMcpInstallResult {
  return installJsonServer(projectPath, 'opencode', {
    type: 'local',
    command: [options.nodeExecutable, options.bridgePath],
    enabled: true,
  })
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

function inspectClient(
  projectPath: string,
  client: ProjectMcpClientId,
  options: ProjectMcpInstallOptions,
): ProjectMcpInstallResult {
  if (client === 'codex') return codexResult(projectPath, options)
  const expected = expectedForClient(client, options)
  if (!expected) throw new Error(`Unsupported MCP client: ${client}`)
  return jsonServerResult(projectPath, client, expected)
}

export function inspectProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpSetupSummary {
  if (!isAbsoluteFile(options.nodeExecutable) || !isAbsoluteFile(options.bridgePath)) {
    throw new Error('MCP setup requires absolute Node.js and bridge paths')
  }

  const canonicalPath = canonicalProjectPath(projectPath)
  const results = PROJECT_MCP_CLIENTS.map((client): ProjectMcpInstallResult => {
    try {
      return inspectClient(canonicalPath, client, options)
    } catch (error) {
      return {
        client,
        status: 'error',
        configPath: configPath(canonicalPath, client),
        message: error instanceof Error ? error.message : String(error),
      }
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
  message: string,
): ProjectMcpRemovalResult {
  return { client, status, configPath: configPathValue, message }
}

function removeCodex(projectPath: string, options: ProjectMcpInstallOptions): ProjectMcpRemovalResult {
  const filePath = configPath(projectPath, 'codex')
  const content = readBoundedText(filePath)
  if (content === null) {
    return removalResult('codex', 'already_absent', filePath, 'Codex 專案 MCP 不存在。')
  }
  if (readTomlSection(content, `mcp_servers.${SERVER_NAME}`) === null) {
    return removalResult('codex', 'already_absent', filePath, 'Codex 專案 MCP 不存在。')
  }
  if (!isCodexConfigured(content, options.nodeExecutable, options.bridgePath)) {
    return removalResult('codex', 'conflict', filePath, 'Codex 設定已變更，因此未移除。')
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `[mcp_servers.${SERVER_NAME}]`)
  if (start < 0) {
    return removalResult('codex', 'already_absent', filePath, 'Codex 專案 MCP 不存在。')
  }
  let end = start + 1
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end])) end += 1
  let removeStart = start
  if (removeStart > 0 && lines[removeStart - 1].trim() === '# Agent Pets Presentation MCP') {
    removeStart -= 1
  }
  const next = lines.slice(0, removeStart).concat(lines.slice(end)).join(eol)
  writeTextAtomic(filePath, next)
  return removalResult('codex', 'removed', filePath, 'Agent Pets Codex MCP 設定已移除。')
}

function removeJsonServer(
  projectPath: string,
  client: 'claude' | 'opencode',
  options: ProjectMcpInstallOptions,
): ProjectMcpRemovalResult {
  const filePath = configPath(projectPath, client)
  const content = readBoundedText(filePath)
  if (content === null) {
    return removalResult(client, 'already_absent', filePath, '專案 MCP 不存在。')
  }
  const root = readJsonRoot(filePath)
  const parent = client === 'claude' ? root.mcpServers : root.mcp
  if (!isRecord(parent) || parent[SERVER_NAME] === undefined) {
    if (client === 'opencode' && isRecord(root.mcp) && isRecord(root.mcp.servers)) {
      const legacyServers = root.mcp.servers
      if (legacyServers[SERVER_NAME] !== undefined) {
        const expected = expectedForClient(client, options)
        if (!expected || !sameStdioServer(legacyServers[SERVER_NAME], legacyOpenCodeServer(expected))) {
          return removalResult(client, 'conflict', filePath, '專案 MCP 設定已變更，因此未移除。')
        }
        delete legacyServers[SERVER_NAME]
        if (Object.keys(legacyServers).length === 0) delete root.mcp.servers
        writeTextAtomic(filePath, `${JSON.stringify(root, null, 2)}\n`)
        return removalResult(client, 'removed', filePath, 'Agent Pets 專案 MCP 設定已移除。')
      }
    }
    return removalResult(client, 'already_absent', filePath, '專案 MCP 不存在。')
  }
  const expected = expectedForClient(client, options)
  if (!expected || !sameStdioServer(parent[SERVER_NAME], expected)) {
    return removalResult(client, 'conflict', filePath, '專案 MCP 設定已變更，因此未移除。')
  }
  delete parent[SERVER_NAME]
  writeTextAtomic(filePath, `${JSON.stringify(root, null, 2)}\n`)
  return removalResult(client, 'removed', filePath, 'Agent Pets 專案 MCP 設定已移除。')
}

export function removeProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpRemovalSummary {
  if (!isAbsoluteFile(options.nodeExecutable) || !isAbsoluteFile(options.bridgePath)) {
    throw new Error('MCP removal requires absolute Node.js and bridge paths')
  }

  const canonicalPath = canonicalProjectPath(projectPath)
  const results = PROJECT_MCP_CLIENTS.map((client): ProjectMcpRemovalResult => {
    try {
      if (client === 'codex') return removeCodex(canonicalPath, options)
      return removeJsonServer(canonicalPath, client, options)
    } catch (error) {
      return {
        client,
        status: 'error',
        configPath: configPath(canonicalPath, client),
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return {
    ok: results.every(result => result.status === 'removed' || result.status === 'already_absent'),
    projectPath: canonicalPath,
    results,
  }
}

export function installProjectMcp(
  projectPath: string,
  options: ProjectMcpInstallOptions,
): ProjectMcpSetupSummary {
  if (!isAbsoluteFile(options.nodeExecutable) || !isAbsoluteFile(options.bridgePath)) {
    throw new Error('MCP setup requires absolute Node.js and bridge paths')
  }

  const canonicalPath = canonicalProjectPath(projectPath)
  const results = PROJECT_MCP_CLIENTS.map((client): ProjectMcpInstallResult => {
    try {
      if (client === 'codex') return installCodex(canonicalPath, options)
      if (client === 'claude') return installClaude(canonicalPath, options)
      return installOpenCode(canonicalPath, options)
    } catch (error) {
      return {
        client,
        status: 'error',
        configPath: configPath(canonicalPath, client),
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  return {
    ok: results.every(result => result.status === 'installed' || result.status === 'already_configured'),
    projectPath: canonicalPath,
    results,
  }
}
