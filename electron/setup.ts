import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { setupEnvironment } from './setup-environment.ts'
import { createNodeResolver, NodeNotFoundError, NodeUnsupportedError, type NodeInfo } from './node-resolver.ts'
import type { PetEdge, PetWindowMode } from '../src/types/pet-window'
import { writeFileAtomic, writeFileAtomicSync } from './atomic-file-write.ts'
import {
  readConfigTextAsync,
  withConfigConflictRetry,
  writeConfigSafelyAsync,
  writeTextAtomic,
  writeTextAtomicAsync,
  type ConfigWriteResult,
} from './safe-config-write.ts'
import {
  currentAgentConfigDirs,
  writableAgentConfigDir,
  type AgentConfigDirKind,
  type ResolvedConfigDir,
} from './agent-config-dirs.ts'
import type { AdapterConfigDirStatus } from '../src/types/agent-adapter.ts'
import {
  CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS,
  clampClaudePermissionWaitSeconds,
} from '../src/types/permission.ts'
import {
  DEFAULT_LOCAL_PORTS,
  DEPLOY_DIR_NAME,
  DEPLOY_FILES,
  LOCAL_WIRE_HEADERS,
  LOCAL_WIRE_HOST,
  LOCAL_WIRE_PATHS,
} from '../src/types/local-wire.ts'
import {
  type AgentHooksFile,
  type HookMatcherEntry,
  agentHooksFor,
  codexHookCommand,
  ensureAgentPetsHookEntries,
  escapeCmdQuotedPath,
  disableCodexHooksFeatureText,
  enableCodexHooksFeatureText,
  fileHasAgentPetsHooksAsync,
  isLegacyElectronHook,
  mergeAgentPetsHooksFile,
  removeAgentPetsHooksFile,
  removeJsonKeyFile,
  rewriteAgentPetsHookCommands,
  setJsonKeyFile,
} from './hook-config.ts'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function homeDir(): string {
  return setupEnvironment().homeDir()
}

function appDataDir(): string {
  return setupEnvironment().userData()
}

const nodeResolver = createNodeResolver()

// May return a bare "node": only for non-install callers (e.g. project MCP).
export function resolveNodeBin(): string {
  return nodeResolver.peek()?.path ?? nodeResolver.resolveSync()?.path ?? 'node'
}

export async function prepareNodeForInstall(): Promise<NodeInfo> {
  const fixed = setupEnvironment().nodePath?.()
  if (fixed) return { path: fixed, version: null, supported: true }
  const info = await nodeResolver.resolve()
  if (!info) throw new NodeNotFoundError()
  if (!info.supported) throw new NodeUnsupportedError(info.version)
  return info
}

// prepareNodeForInstall() must have succeeded first.
function requireNodeBin(): string {
  const fixed = setupEnvironment().nodePath?.()
  if (fixed) return fixed
  const info = nodeResolver.peek() ?? nodeResolver.resolveSync()
  if (!info) throw new NodeNotFoundError()
  return info.path
}

// OpenCode scans "plugin" (singular), not "plugins", and only picks up .js files there, not .mjs.
function openCodeCliPluginPathIn(configDir: string): string {
  return path.join(configDir, 'plugin', 'desktop-pet.js')
}

function openCodeCliPluginPath(): string {
  return openCodeCliPluginPathIn(currentAgentConfigDirs().opencode.path)
}

function openCodeDesktopPluginPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugin', 'desktop-pet.js')
  }
  return path.join(setupEnvironment().appData(), 'opencode', 'plugin', 'desktop-pet.js')
}

// Codex Desktop shares CODEX_HOME with the CLI but exposes no separate integration API, so this file only
// guarantees CLI support; Desktop depends on whether that build runs the same hook pipeline.
function codexHooksPathIn(codexHome: string): string {
  return path.join(codexHome, 'hooks.json')
}

function codexConfigPathIn(codexHome: string): string {
  return path.join(codexHome, 'config.toml')
}

function codexHooksPath(): string {
  return codexHooksPathIn(currentAgentConfigDirs().codex.path)
}

function codexConfigPath(): string {
  return codexConfigPathIn(currentAgentConfigDirs().codex.path)
}

function claudeDesktopConfigPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return path.join(setupEnvironment().appData(), 'Claude', 'claude_desktop_config.json')
}

function claudeCodeSettingsPathIn(configDir: string): string {
  return path.join(configDir, 'settings.json')
}

function claudeCodeSettingsPath(): string {
  return claudeCodeSettingsPathIn(currentAgentConfigDirs().claude.path)
}

// The user may have set the variable after installing, so the default folder can hold an older install.
function configDirLocations(dir: ResolvedConfigDir): [resolved: string, ...stale: string[]] {
  return samePath(dir.path, dir.defaultPath) ? [dir.path] : [dir.path, dir.defaultPath]
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => (IS_WIN ? path.resolve(value).toLowerCase() : path.resolve(value))
  return normalize(left) === normalize(right)
}

function windowStatePath(): string {
  return path.join(appDataDir(), 'window-state.json')
}

interface SavedBounds {
  x: number
  y: number
  width: number
  height: number
}

interface SavedDisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

type PetWindowState = {
  x: number
  y: number
  width?: number
  height?: number
  mode?: PetWindowMode
  edge?: PetEdge
  displayId?: number
  displayBounds?: SavedDisplayBounds
  normalBounds?: SavedBounds
}

function finiteStateNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseSavedBounds(value: unknown): SavedBounds | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!finiteStateNumber(raw.x) || !finiteStateNumber(raw.y)
    || !finiteStateNumber(raw.width) || !finiteStateNumber(raw.height)) return undefined
  if (raw.width <= 0 || raw.height <= 0) return undefined
  return {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  }
}

function parseSavedDisplayBounds(value: unknown): SavedDisplayBounds | undefined {
  return parseSavedBounds(value)
}

function readWindowState(): PetWindowState | null {
  const raw = readFile(windowStatePath())
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (finiteStateNumber(parsed.x) && finiteStateNumber(parsed.y)) {
      const mode = parsed.mode === 'normal' || parsed.mode === 'mini' || parsed.mode === 'edge'
        ? parsed.mode
        : undefined
      const edge = parsed.edge === 'left' || parsed.edge === 'right' || parsed.edge === 'top' || parsed.edge === 'bottom'
        ? parsed.edge
        : undefined
      const displayBounds = parseSavedDisplayBounds(parsed.displayBounds)
      const normalBounds = parseSavedBounds(parsed.normalBounds)
      return {
        x: parsed.x,
        y: parsed.y,
        width: finiteStateNumber(parsed.width) && parsed.width > 0 ? parsed.width : undefined,
        height: finiteStateNumber(parsed.height) && parsed.height > 0 ? parsed.height : undefined,
        ...(mode ? { mode } : {}),
        ...(edge ? { edge } : {}),
        ...(finiteStateNumber(parsed.displayId) ? { displayId: parsed.displayId } : {}),
        ...(displayBounds ? { displayBounds } : {}),
        ...(normalBounds ? { normalBounds } : {}),
      }
    }
  } catch {}
  return null
}

// Merges rather than overwrites: position and size are saved by different writers and must stay coherent
// (the window is bottom-anchored, so a y saved at one size is a different visible spot at another).
function writeWindowState(state: Partial<PetWindowState>): void {
  const merged = { ...(readWindowState() ?? {}), ...state }
  if (typeof merged.x !== 'number' || typeof merged.y !== 'number') return
  writeFileEnsured(windowStatePath(), JSON.stringify(merged))
}

function hookScriptPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.hookScript)
}

function hookWrapperPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.hookWrapper)
}

function hookScriptDeployPath(): string {
  return path.join(homeDir(), DEPLOY_DIR_NAME)
}

function eventTokenPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.eventToken)
}

function permissionTokenPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.permissionToken)
}

function presentationTokenPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.presentationToken)
}

// Opt-in marker read by agent-hook.mjs; the main process still checks its own persisted preference before accepting any request.
function claudePermissionRespondPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.claudePermissionRespond)
}

function syncClaudePermissionRespondOptIn(waitSeconds: number | null): void {
  const filePath = claudePermissionRespondPath()
  if (waitSeconds === null) {
    fs.rmSync(filePath, { force: true })
    return
  }
  const content = `${JSON.stringify({ enabled: true, waitSeconds: clampClaudePermissionWaitSeconds(waitSeconds) })}\n`
  if (readFile(filePath) === content) return
  ensureDir(hookScriptDeployPath())
  writeTextAtomic(filePath, content, { mode: 0o600 })
  if (!IS_WIN) {
    try { fs.chmodSync(filePath, 0o600) } catch {}
  }
}

// A full cleanup followed by a reinstall in the same session must re-use the value the running servers already hold.
const tokenCache = new Map<string, string>()

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i

function assertRegularTokenFile(stat: fs.Stats, label: string): void {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Agent Pets ${label} token path is not a regular file`)
  }
}

// 隨機後綴：同一毫秒內兩次寫入也不會撞到 `wx` 的 EEXIST。
function tokenTemporaryPath(tokenPath: string): string {
  return path.join(path.dirname(tokenPath), `.${path.basename(tokenPath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
}

// 暫存檔 + rename：直接以 'w' 開啟會先截斷成空檔，hook 恰好讀到空 token 就會靜默略過事件；rename 也取代了 symlink 空窗。
const TOKEN_WRITE_OPTIONS = { mode: 0o600, enforceMode: true, fsync: true } as const

// 啟動時事件 server 立刻要用 token，所以同步版留著。
function ensureToken(tokenPath: string, label: string): string {
  const dir = hookScriptDeployPath()
  ensureDir(dir)
  if (!IS_WIN) {
    try { fs.chmodSync(dir, 0o700) } catch {}
  }

  let stat: fs.Stats | null = null
  try {
    stat = fs.lstatSync(tokenPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (stat) {
    assertRegularTokenFile(stat, label)
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (TOKEN_PATTERN.test(existing)) {
      if (!IS_WIN) {
        try { fs.chmodSync(tokenPath, 0o600) } catch {}
      }
      tokenCache.set(tokenPath, existing)
      return existing
    }
  }

  const token = tokenCache.get(tokenPath) ?? randomBytes(32).toString('hex')
  writeFileAtomicSync(tokenPath, `${token}\n`, { temporaryPath: tokenTemporaryPath(tokenPath), ...TOKEN_WRITE_OPTIONS })
  tokenCache.set(tokenPath, token)
  return token
}

async function ensureTokenAsync(tokenPath: string, label: string): Promise<string> {
  const dir = hookScriptDeployPath()
  await fsp.mkdir(dir, { recursive: true })
  if (!IS_WIN) {
    try { await fsp.chmod(dir, 0o700) } catch {}
  }

  let stat: fs.Stats | null = null
  try {
    stat = await fsp.lstat(tokenPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (stat) {
    assertRegularTokenFile(stat, label)
    const existing = (await fsp.readFile(tokenPath, 'utf8')).trim()
    if (TOKEN_PATTERN.test(existing)) {
      if (!IS_WIN) {
        try { await fsp.chmod(tokenPath, 0o600) } catch {}
      }
      tokenCache.set(tokenPath, existing)
      return existing
    }
  }

  const token = tokenCache.get(tokenPath) ?? randomBytes(32).toString('hex')
  await writeFileAtomic(tokenPath, `${token}\n`, { temporaryPath: tokenTemporaryPath(tokenPath), ...TOKEN_WRITE_OPTIONS })
  tokenCache.set(tokenPath, token)
  return token
}

function ensureEventToken(): string {
  return ensureToken(eventTokenPath(), 'event')
}

function ensurePermissionToken(): string {
  return ensureToken(permissionTokenPath(), 'permission')
}

function ensurePresentationToken(): string {
  return ensureToken(presentationTokenPath(), 'presentation')
}

function integrationsDir(): string {
  const env = setupEnvironment()
  if (env.isPackaged()) {
    return path.join(env.resourcesPath(), 'integrations')
  }
  const dev = env.integrationsDir()
  if (!dev) throw new Error('The integrations folder location is not configured')
  return dev
}

function ensurePresentationMcpScript(): void {
  const sourcePath = path.join(integrationsDir(), 'presentation-mcp.mjs')
  const source = readFile(sourcePath)
  if (source !== null) writeFileEnsured(presentationMcpScriptPath(), source)
}

async function ensurePresentationMcpScriptAsync(): Promise<void> {
  const source = await readFileAsync(path.join(integrationsDir(), 'presentation-mcp.mjs'))
  if (source !== null) await writeTextAtomicAsync(presentationMcpScriptPath(), source)
}

function presentationMcpScriptPath(): string {
  return path.join(hookScriptDeployPath(), DEPLOY_FILES.presentationMcpScript)
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function writeFileEnsured(filePath: string, content: string): void {
  writeTextAtomic(filePath, content)
}

// Files Agent Pets fully owns need no backup; rewritten only when the content differs so the outcome can report "unchanged".
async function writeManagedAsync(filePath: string, content: string): Promise<ConfigWriteResult> {
  if ((await readFileAsync(filePath)) === content) return { status: 'unchanged', path: filePath, backupPath: null }
  await writeTextAtomicAsync(filePath, content)
  return { status: 'written', path: filePath, backupPath: null }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

function readFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

async function readFileAsync(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

function appendToFile(filePath: string, line: string): void {
  const existing = readFile(filePath) || ''
  if (existing.includes(line)) return
  const sep = existing.endsWith('\n') || existing.length === 0 ? '' : '\n'
  fs.writeFileSync(filePath, existing + sep + line + '\n', 'utf-8')
}

function removeFromFile(filePath: string, line: string): void {
  const existing = readFile(filePath)
  if (!existing) return
  const lines = existing.split('\n').filter(l => l.trim() !== line.trim())
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

async function removeFile(filePath: string): Promise<void> {
  await fsp.rm(filePath, { force: true })
}

// Records that Agent Pets (not the user) added `hooks = true`, so uninstall only reverts what we changed.
function codexFeatureMarkerPath(): string {
  return path.join(hookScriptDeployPath(), 'codex-hooks-feature-added')
}

async function enableCodexHooksFeature(filePath: string): Promise<ConfigWriteResult> {
  const { result, added } = await withConfigConflictRetry(filePath, async () => {
    const raw = await readConfigTextAsync(filePath)
    const { content, added } = enableCodexHooksFeatureText(raw ?? '')
    return { result: await writeConfigSafelyAsync(filePath, content, raw), added }
  })
  if (added) {
    try { await writeTextAtomicAsync(codexFeatureMarkerPath(), '1\n') } catch { /* marker is best effort */ }
  }
  return result
}

async function hookScriptContentAsync(): Promise<string> {
  return fsp.readFile(path.join(integrationsDir(), 'agent-hook.mjs'), 'utf-8')
}

async function hookWrapperContentAsync(): Promise<string> {
  return (await fsp.readFile(path.join(integrationsDir(), 'agent-hook.cmd'), 'utf-8'))
    .replace('__NODE_EXECUTABLE__', () => escapeCmdQuotedPath(requireNodeBin()))
}

async function installHookScript(): Promise<ConfigWriteResult[]> {
  await ensureTokenAsync(eventTokenPath(), 'event')
  await fsp.mkdir(hookScriptDeployPath(), { recursive: true })
  const results = [await writeManagedAsync(hookScriptPath(), await hookScriptContentAsync())]
  if (IS_WIN) {
    results.push(await writeManagedAsync(hookWrapperPath(), await hookWrapperContentAsync()))
  }
  if (!IS_WIN) {
    try { await fsp.chmod(hookScriptPath(), 0o700) } catch {}
  }
  return results
}

// HTTP header 不分大小寫，但維持既有送出的 X-Agent-Pets-Token 寫法。
function headerCase(name: string): string {
  return name.replace(/(^|-)([a-z])/g, (_match, dash: string, letter: string) => dash + letter.toUpperCase())
}

// OpenCode exposes no "user prompt submitted" hook, so the pet won't show "thinking" until the first tool call: a known gap, not a bug.
// plugin 跑在 OpenCode 裡、一律連預設埠。
function openCodePluginContent(source: 'opencode-desktop' | 'opencode-cli'): string {
  return `import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

const SOURCE = '${source}';
const instanceId = 'opencode-' + process.pid + '-' + Date.now() + '-' + randomBytes(6).toString('hex');
const eventTokenPath = path.join(os.homedir(), '${DEPLOY_DIR_NAME}', '${DEPLOY_FILES.eventToken}');
const permissionTokenPath = path.join(os.homedir(), '${DEPLOY_DIR_NAME}', '${DEPLOY_FILES.permissionToken}');
let currentState = null;
let stateTimer = null;
const activePermissions = new Map();
const decisionResults = new Map();

function readToken(tokenPath) {
  try { return fs.readFileSync(tokenPath, 'utf8').trim(); } catch { return ''; }
}

function postJson(port, pathname, tokenHeader, token, value) {
  return new Promise((resolve) => {
    if (!token) { resolve({ status: 0, body: null }); return; }
    const payload = JSON.stringify(value);
    const req = http.request({
      hostname: '${LOCAL_WIRE_HOST}',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        [tokenHeader]: token,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        let body = null;
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          body = text ? JSON.parse(text) : null;
        } catch {}
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.setTimeout(1800, () => req.destroy());
    req.on('error', () => resolve({ status: 0, body: null }));
    req.write(payload);
    req.end();
  });
}

// Which app OpenCode runs in (see integrations/agent-hook.mjs): a few capped env values only.
function shortEnv(name, pattern) {
  const value = process.env[name];
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function hostHints() {
  const hints = {
    termProgram: shortEnv('TERM_PROGRAM', /^[A-Za-z0-9._-]{1,32}$/),
    bundleId: process.platform === 'darwin' ? shortEnv('__CFBundleIdentifier', /^[A-Za-z0-9.-]{3,128}$/) : undefined,
    windowsTerminal: process.env.WT_SESSION ? true : undefined,
    vscode: process.env.VSCODE_INJECTION || process.env.VSCODE_GIT_IPC_HANDLE ? true : undefined,
    cursor: process.env.CURSOR_TRACE_ID ? true : undefined,
  };
  const present = Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined));
  return Object.keys(present).length > 0 ? present : undefined;
}

const HOST_HINTS = hostHints();

function sendEvent(sessionId, state, toolName, originalEvent, projectPath) {
  void postJson(${DEFAULT_LOCAL_PORTS.event}, '${LOCAL_WIRE_PATHS.events}', '${headerCase(LOCAL_WIRE_HEADERS.eventToken)}', readToken(eventTokenPath), {
    source: SOURCE,
    sessionId: sessionId || 'unknown',
    state,
    timestamp: Date.now(),
    toolName,
    originalEvent,
    project: projectPath,
    host: HOST_HINTS,
  });
}

function setState(sessionId, state, toolName, originalEvent, projectPath) {
  if (state === currentState) return;
  currentState = state;
  if (stateTimer) clearTimeout(stateTimer);
  if (state === 'success' || state === 'error') {
    stateTimer = setTimeout(() => { currentState = null; }, 4000);
  }
  sendEvent(sessionId, state, toolName, originalEvent, projectPath);
}

function permissionPost(pathname, value) {
  return postJson(
    ${DEFAULT_LOCAL_PORTS.permission},
    pathname,
    '${headerCase(LOCAL_WIRE_HEADERS.permissionToken)}',
    readToken(permissionTokenPath),
    value,
  );
}

function normalizePermission(properties, projectPath) {
  if (!properties || typeof properties !== 'object') return null;
  const permissionId = properties.id || properties.requestID;
  const sessionId = properties.sessionID;
  const permission = properties.permission || properties.type;
  if (!permissionId || !sessionId || !permission) return null;
  const rawPatterns = properties.patterns || properties.pattern;
  const patterns = Array.isArray(rawPatterns)
    ? rawPatterns
    : (typeof rawPatterns === 'string' ? [rawPatterns] : []);
  return {
    source: SOURCE,
    instanceId,
    permissionId: String(permissionId),
    sessionId: String(sessionId),
    project: projectPath,
    permission: String(permission),
    title: typeof properties.title === 'string' ? properties.title : undefined,
    patterns: patterns.filter((item) => typeof item === 'string').slice(0, 5),
  };
}

function deliveryResultFromError(error) {
  const message = String(error && (error.message || error.data?.message || error));
  return /not found|already resolved|already replied/i.test(message)
    ? 'already_resolved'
    : 'rejected';
}

async function replyOpenCode(client, input, decision, directory) {
  const reply = decision === 'allow_once' ? 'once' : 'reject';
  try {
    let result;
    if (client && client.permission && typeof client.permission.reply === 'function') {
      result = await client.permission.reply({
        requestID: input.permissionId,
        reply,
        directory,
      });
    } else if (client && typeof client.postSessionIdPermissionsPermissionId === 'function') {
      result = await client.postSessionIdPermissionsPermissionId({
        path: { id: input.sessionId, permissionID: input.permissionId },
        body: { response: reply },
        query: { directory },
      });
    } else {
      return 'rejected';
    }
    if (result && result.error) return deliveryResultFromError(result.error);
    return 'delivered';
  } catch (error) {
    return deliveryResultFromError(error);
  }
}

async function pollPermission(client, input, directory) {
  const startedAt = Date.now();
  while (activePermissions.has(input.permissionId) && Date.now() - startedAt < 90000) {
    const response = await permissionPost('${LOCAL_WIRE_PATHS.permissionDecision}', input);
    if (response.status === 410 || response.status === 404) break;
    if (response.status !== 200 || !response.body || !response.body.decisionId) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      continue;
    }

    const decisionId = String(response.body.decisionId);
    let result = decisionResults.get(decisionId);
    if (!result) {
      result = await replyOpenCode(client, input, response.body.decision, directory);
      decisionResults.set(decisionId, result);
    }
    const acknowledged = await permissionPost('${LOCAL_WIRE_PATHS.permissionResult}', {
      ...input,
      decisionId,
      result,
    });
    if (acknowledged.status === 204 || acknowledged.status === 409) {
      decisionResults.delete(decisionId);
      activePermissions.delete(input.permissionId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  activePermissions.delete(input.permissionId);
}

async function registerPermission(client, properties, projectPath, directory) {
  const input = normalizePermission(properties, projectPath);
  if (!input || activePermissions.has(input.permissionId)) return;
  activePermissions.set(input.permissionId, input);
  const response = await permissionPost('${LOCAL_WIRE_PATHS.permissionRequest}', input);
  if (response.status !== 200 && response.status !== 201) {
    activePermissions.delete(input.permissionId);
    return;
  }
  setState(input.sessionId, 'waiting-permission', undefined, 'permission.request', projectPath);
  void pollPermission(client, input, directory);
}

async function resolvePermission(properties) {
  const permissionId = properties && (properties.permissionID || properties.requestID || properties.id);
  if (!permissionId) return;
  const input = {
    source: SOURCE,
    instanceId,
    permissionId: String(permissionId),
  };
  await permissionPost('${LOCAL_WIRE_PATHS.permissionResolved}', input);
  activePermissions.delete(input.permissionId);
}

const DesktopPetPlugin = async ({ client, project, directory }) => {
  const projectPath = project && (project.worktree || project.path) || directory;
  return {
  'tool.execute.before': async (input) => {
    setState(input && input.sessionID, 'tool-running', input && input.tool, 'tool.execute.before', projectPath);
  },
  'tool.execute.after': async (input) => {
    setState(input && input.sessionID, 'thinking', input && input.tool, 'tool.execute.after', projectPath);
  },
  // OpenCode lifecycle notifications arrive through the generic event hook.
  // They are not direct hook keys in the current plugin API.
  event: async ({ event }) => {
    const sessionId = event && event.properties && event.properties.sessionID;
    switch (event.type) {
      case 'session.status':
        switch (event.properties.status.type) {
          case 'busy':
          case 'retry':
            setState(sessionId, 'thinking', undefined, event.type, projectPath);
            break;
          case 'idle':
            setState(sessionId, 'idle', undefined, event.type, projectPath);
            break;
        }
        break;
      case 'session.idle':
        setState(sessionId, 'idle', undefined, event.type, projectPath);
        break;
      case 'session.error':
        setState(sessionId, 'error', undefined, event.type, projectPath);
        break;
      case 'permission.updated':
      case 'permission.asked':
        await registerPermission(client, event.properties, projectPath, directory);
        break;
      case 'permission.replied':
        await resolvePermission(event.properties);
        setState(sessionId, 'thinking', undefined, event.type, projectPath);
        break;
    }
  },
  // This hook can announce waiting state, but has no stable permission ID;
  // only permission.updated/permission.asked may create a Broker request.
  'permission.ask': async (input) => {
    setState(input && input.sessionID, 'waiting-permission', undefined, 'permission.ask', projectPath);
  },
  dispose: async () => {
    await Promise.all([...activePermissions.values()].map((input) => (
      permissionPost('${LOCAL_WIRE_PATHS.permissionResolved}', input)
    )));
    activePermissions.clear();
    decisionResults.clear();
  },
  };
};

export default DesktopPetPlugin;
export { DesktopPetPlugin };
`
}

async function installOpenCode(): Promise<ConfigWriteResult[]> {
  // Checked before anything is written, so an unusable XDG_CONFIG_HOME leaves no half install.
  const cliPlugin = openCodeCliPluginPathIn(writableAgentConfigDir(currentAgentConfigDirs().opencode))
  await ensureTokenAsync(eventTokenPath(), 'event')
  await ensureTokenAsync(permissionTokenPath(), 'permission')
  return [
    await writeManagedAsync(openCodeDesktopPluginPath(), openCodePluginContent('opencode-desktop')),
    await writeManagedAsync(cliPlugin, openCodePluginContent('opencode-cli')),
  ]
}

async function uninstallOpenCode(): Promise<void> {
  await removeFile(openCodeDesktopPluginPath())
  for (const dir of configDirLocations(currentAgentConfigDirs().opencode)) await removeFile(openCodeCliPluginPathIn(dir))
}

const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
] as const
type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number]

const CODEX_HOOKS_DESCRIPTION = 'Agent Pets lifecycle hooks for Codex CLI.'

// 型別不管鍵順序；codexHooksJson 要把 description 寫在 hooks 前面，新安裝的 hooks.json 依此寫出。
type CodexHooksFile = { description: string } & AgentHooksFile<CodexHookEvent>

function codexHooksJson(): CodexHooksFile {
  const hook = hookScriptPath()
  const nodeBin = IS_WIN ? '' : requireNodeBin()
  const command = codexHookCommand({ isWindows: IS_WIN, nodeBin, hookScript: hook, wrapper: hookWrapperPath() })
  const entry = (): HookMatcherEntry => ({
    hooks: [{ type: 'command', command, statusMessage: 'Updating Agent Pets status' }],
  })

  return {
    description: CODEX_HOOKS_DESCRIPTION,
    hooks: agentHooksFor(CODEX_HOOK_EVENTS, entry),
  }
}

async function installCodex(): Promise<ConfigWriteResult[]> {
  const codexHome = writableAgentConfigDir(currentAgentConfigDirs().codex)
  const results: ConfigWriteResult[] = await installHookScript()

  const { hooks, ...defaults } = codexHooksJson()
  results.push(await mergeAgentPetsHooksFile(codexHooksPathIn(codexHome), hooks, defaults))

  results.push(await enableCodexHooksFeature(codexConfigPathIn(codexHome)))
  return results
}

const CODEX_HOOKS_OWNED_TOP_LEVEL = { description: CODEX_HOOKS_DESCRIPTION }

// The hook script (and Windows wrapper) is shared by Codex, Claude Code and Claude Desktop.
// Remove it only when no remaining config still points at it.
async function claudeDesktopPointsAtHookScript(): Promise<boolean> {
  try {
    const desktop = await readConfigTextAsync(claudeDesktopConfigPath())
    return Boolean(desktop) && JSON.parse(desktop!)?.agent === hookScriptPath()
  } catch {
    return false
  }
}

async function isHookScriptReferenced(): Promise<boolean> {
  const dirs = currentAgentConfigDirs()
  const checks = [
    ...configDirLocations(dirs.codex).map(dir => fileHasAgentPetsHooksAsync(codexHooksPathIn(dir))),
    ...configDirLocations(dirs.claude).map(dir => fileHasAgentPetsHooksAsync(claudeCodeSettingsPathIn(dir))),
    claudeDesktopPointsAtHookScript(),
  ]
  return (await Promise.all(checks)).some(Boolean)
}

async function releaseSharedHookScript(): Promise<void> {
  if (await isHookScriptReferenced()) return
  await removeFile(hookScriptPath())
  await removeFile(hookWrapperPath())
}

async function uninstallCodex(): Promise<void> {
  const [codexHome, ...staleHomes] = configDirLocations(currentAgentConfigDirs().codex)
  await removeAgentPetsHooksFile(codexHooksPathIn(codexHome), CODEX_HOOKS_OWNED_TOP_LEVEL)
  // The old location keeps its config.toml: the marker cannot tell which folder we enabled
  // `hooks = true` in, and a leftover feature flag without our hooks changes nothing.
  for (const stale of staleHomes) await removeAgentPetsHooksFile(codexHooksPathIn(stale), CODEX_HOOKS_OWNED_TOP_LEVEL)
  const configFile = codexConfigPathIn(codexHome)
  if (await fileExistsAsync(codexFeatureMarkerPath())) {
    await withConfigConflictRetry(configFile, async () => {
      const existing = await readConfigTextAsync(configFile)
      if (existing === null) return
      const next = disableCodexHooksFeatureText(existing)
      if (next !== existing) {
        await writeConfigSafelyAsync(configFile, next, existing)
        if (next === '') await removeFile(configFile)
      }
    })
  }
  await removeFile(codexFeatureMarkerPath())
  await releaseSharedHookScript()
}

async function installClaude(): Promise<ConfigWriteResult[]> {
  const scripts = await installHookScript()
  return [...scripts, await setJsonKeyFile(claudeDesktopConfigPath(), 'agent', hookScriptPath())]
}

async function uninstallClaude(): Promise<void> {
  const configFile = claudeDesktopConfigPath()
  if (await fileExistsAsync(configFile)) {
    await removeJsonKeyFile(configFile, 'agent', hookScriptPath())
  }
  await releaseSharedHookScript()
}

const CLAUDE_CODE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'SessionEnd',
] as const
type ClaudeCodeHookEvent = (typeof CLAUDE_CODE_HOOK_EVENTS)[number]

// 第一版就安裝的事件；其餘都是之後才加的，舊安裝要靠啟動升級補上。
const CLAUDE_CODE_ORIGINAL_EVENTS: ReadonlySet<ClaudeCodeHookEvent> = new Set<ClaudeCodeHookEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
])
const CLAUDE_CODE_TOOL_EVENTS: ReadonlySet<ClaudeCodeHookEvent> = new Set<ClaudeCodeHookEvent>(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'])
// Only PermissionRequest may wait (for a pet answer); every other event keeps Claude Code's default timeout.
const CLAUDE_CODE_HOOK_TIMEOUTS: Readonly<Partial<Record<ClaudeCodeHookEvent, number>>> = { PermissionRequest: CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS }

function claudeCodeHooksJson(): AgentHooksFile<ClaudeCodeHookEvent> {
  const hook = hookScriptPath()
  const nodeBin = requireNodeBin()
  // matcher 放在 hooks 之後，維持既有 settings.json 的鍵順序。
  const entry = (event: ClaudeCodeHookEvent): HookMatcherEntry => {
    const timeout = CLAUDE_CODE_HOOK_TIMEOUTS[event]
    return {
      hooks: [{ type: 'command', command: nodeBin, args: [hook, 'claude'], ...(timeout ? { timeout } : {}) }],
      ...(CLAUDE_CODE_TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
    }
  }

  return { hooks: agentHooksFor(CLAUDE_CODE_HOOK_EVENTS, entry) }
}

async function installClaudeCode(): Promise<ConfigWriteResult[]> {
  const configDir = writableAgentConfigDir(currentAgentConfigDirs().claude)
  const scripts = await installHookScript()
  return [...scripts, await mergeAgentPetsHooksFile(claudeCodeSettingsPathIn(configDir), claudeCodeHooksJson().hooks)]
}

// 從安裝清單推導而非另外手寫：新增事件時不可能漏掉升級（StopFailure 曾因此從未補給舊安裝）。
const CLAUDE_CODE_UPGRADE_EVENTS: readonly ClaudeCodeHookEvent[] = CLAUDE_CODE_HOOK_EVENTS.filter(event => !CLAUDE_CODE_ORIGINAL_EVENTS.has(event))

// Handlers for the original events are never re-added: the user may have removed them on purpose.
async function upgradeClaudeCodeHooksUnlocked(): Promise<ConfigWriteResult | null> {
  return ensureAgentPetsHookEntries(claudeCodeSettingsPath(), CLAUDE_CODE_UPGRADE_EVENTS.map(event => ({
    event,
    ...(CLAUDE_CODE_TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
    ...(CLAUDE_CODE_HOOK_TIMEOUTS[event] ? { timeout: CLAUDE_CODE_HOOK_TIMEOUTS[event] } : {}),
  })))
}

function claudeHooksUpgradeMarkerPath(): string {
  return path.join(hookScriptDeployPath(), 'claude-hooks-upgraded')
}

// At most once per app version, so an entry the user removed on purpose is not added back on every launch.
async function upgradeClaudeCodeHooksOnceUnlocked(appVersion: string): Promise<ConfigWriteResult | null> {
  const marker = claudeHooksUpgradeMarkerPath()
  if (((await readFileAsync(marker)) ?? '').trim() === appVersion) return null
  const result = await upgradeClaudeCodeHooksUnlocked()
  await writeTextAtomicAsync(marker, `${appVersion}\n`)
  return result
}

async function uninstallClaudeCode(): Promise<void> {
  const candidates = configDirLocations(currentAgentConfigDirs().claude).map(claudeCodeSettingsPathIn)
  const present = await Promise.all(candidates.map(fileExistsAsync))
  const settingsFiles = candidates.filter((_file, index) => present[index])
  if (settingsFiles.length === 0) return
  for (const settingsFile of settingsFiles) await removeAgentPetsHooksFile(settingsFile)
  await releaseSharedHookScript()
}

// Older Windows builds used Electron's process.execPath as the hook runtime, so their hooks recursively launch the app on every event.
async function rewriteInstalledAgentPetsHooks(filePath: string, target: 'codex' | 'claude'): Promise<boolean> {
  const hookPath = hookScriptPath()
  const codexCommand = codexHookCommand({ isWindows: true, nodeBin: '', hookScript: hookPath, wrapper: hookWrapperPath() })
  const nodeBin = target === 'claude' ? ((nodeResolver.peek() ?? await nodeResolver.resolve())?.path ?? '') : ''
  if (target === 'claude' && !nodeBin) return false // cannot repair without a real Node path
  return rewriteAgentPetsHookCommands(filePath, (hook) => {
    // Never rewrite user config just because the Node path changed: only repair hooks that run through the Electron executable.
    if (!isLegacyElectronHook(hook)) return false
    let changed = false
    if (target === 'codex') {
      if (hook.command !== codexCommand) {
        hook.command = codexCommand
        changed = true
      }
      if ('args' in hook) {
        delete hook.args
        changed = true
      }
    } else {
      const nextArgs = [hookPath, 'claude']
      if (hook.command !== nodeBin || JSON.stringify(hook.args) !== JSON.stringify(nextArgs)) {
        hook.command = nodeBin
        hook.args = nextArgs
        changed = true
      }
    }
    return changed
  })
}

async function repairWindowsInstalledHooksUnlocked(): Promise<void> {
  if (!IS_WIN) return

  const codexChanged = await rewriteInstalledAgentPetsHooks(codexHooksPath(), 'codex')
  const claudeChanged = await rewriteInstalledAgentPetsHooks(claudeCodeSettingsPath(), 'claude')

  if (codexChanged || claudeChanged) await installHookScript()
}

// Token 要在啟動當下同步拿到（事件／權限 server 立刻要用），其餘檔案改寫丟到背景，不阻塞啟動。
function refreshInstalledIntegrationScripts(appVersion?: string, options: { deferAgentConfig?: boolean } = {}): string {
  const token = ensureEventToken()
  ensurePermissionToken()
  ensurePresentationToken()
  void refreshInstalledIntegrationFiles(appVersion, options)
  return token
}

function refreshInstalledIntegrationFiles(appVersion?: string, options: { deferAgentConfig?: boolean } = {}): Promise<void> {
  return serializeInstaller(async () => {
    // A read-only home directory must not prevent the pet from starting; the bridge can be repaired from Setup later.
    try {
      await ensurePresentationMcpScriptAsync()
    } catch (error) {
      console.error('Presentation MCP script refresh skipped', error)
    }
    try {
      if (await fileExistsAsync(hookScriptPath())) await installHookScript()
      if (await fileExistsAsync(openCodeDesktopPluginPath())) {
        await writeTextAtomicAsync(openCodeDesktopPluginPath(), openCodePluginContent('opencode-desktop'))
      }
    } catch (error) {
      console.error('Installed integration refresh skipped', error)
    }
    if (!options.deferAgentConfig) await refreshAgentConfigIntegrationsUnlocked(appVersion)
  })
}

// Runs after agentConfigEnvReady() (the folders can come from a login-shell lookup); leftovers in the
// default location are reported by agentConfigDirStatus() and never rewritten unasked.
async function refreshAgentConfigIntegrationsUnlocked(appVersion?: string): Promise<void> {
  try {
    if (await fileExistsAsync(openCodeCliPluginPath())) {
      await writeTextAtomicAsync(openCodeCliPluginPath(), openCodePluginContent('opencode-cli'))
    }
    await repairWindowsInstalledHooksUnlocked()
  } catch (error) {
    console.error('Installed integration refresh skipped', error)
  }
  try {
    if (appVersion) await upgradeClaudeCodeHooksOnceUnlocked(appVersion)
  } catch (error) {
    console.error('Claude Code hook upgrade skipped', error)
  }
}

// 面板每次開啟都會跑這些健康檢查，全部用非同步 I/O，不在主程序同步讀檔。
async function hookScriptIsCurrent(): Promise<boolean> {
  try {
    const [deployed, bundled] = await Promise.all([readFileAsync(hookScriptPath()), hookScriptContentAsync()])
    return deployed !== null && deployed === bundled
  } catch {
    return true // bundle unreadable: do not raise a false alarm
  }
}

async function openCodePluginIsCurrent(kind: 'cli' | 'desktop'): Promise<boolean> {
  const target = kind === 'cli' ? openCodeCliPluginPath() : openCodeDesktopPluginPath()
  const deployed = await readFileAsync(target)
  return deployed !== null
    && deployed === openCodePluginContent(kind === 'cli' ? 'opencode-cli' : 'opencode-desktop')
}

async function agentPresence(): Promise<{ codex: boolean, claude: boolean, opencode: boolean }> {
  const dirs = currentAgentConfigDirs()
  const [codex, claude, opencodeCli, opencodeDesktop] = await Promise.all([
    fileExistsAsync(dirs.codex.path),
    fileExistsAsync(dirs.claude.path),
    fileExistsAsync(path.dirname(openCodeCliPluginPathIn(dirs.opencode.path))),
    fileExistsAsync(path.dirname(openCodeDesktopPluginPath())),
  ])
  return { codex, claude, opencode: opencodeCli || opencodeDesktop }
}

const AGENT_PETS_INSTALL_FILE = {
  claude: { in: claudeCodeSettingsPathIn, installed: fileHasAgentPetsHooksAsync },
  codex: { in: codexHooksPathIn, installed: fileHasAgentPetsHooksAsync },
  opencode: { in: openCodeCliPluginPathIn, installed: fileExistsAsync },
} as const satisfies Record<AgentConfigDirKind, { in(dir: string): string, installed(file: string): Promise<boolean> }>

async function agentConfigDirStatus(kind: AgentConfigDirKind): Promise<AdapterConfigDirStatus> {
  const dir = currentAgentConfigDirs()[kind]
  const [, staleDir] = configDirLocations(dir)
  const { in: fileIn, installed } = AGENT_PETS_INSTALL_FILE[kind]
  const staleFile = staleDir === undefined ? undefined : fileIn(staleDir)
  return {
    variable: dir.variable,
    path: dir.path,
    source: dir.source,
    ...(dir.ignored ? { ignored: dir.ignored } : {}),
    ...(staleFile !== undefined && await installed(staleFile) ? { staleLocation: staleFile } : {}),
  }
}

export type IntegrationTarget = 'opencode' | 'codex' | 'claude' | 'claudeCode'

async function installIntegrationUnlocked(target?: IntegrationTarget): Promise<ConfigWriteResult[]> {
  switch (target) {
    case 'opencode': return installOpenCode()
    case 'codex': return installCodex()
    case 'claude': return installClaude()
    case 'claudeCode': return installClaudeCode()
    default:
      // Claude Desktop's `agent` key is not a documented setting: not written by default (still removed on uninstall).
      return [...await installOpenCode(), ...await installCodex(), ...await installClaudeCode()]
  }
}

async function cleanupDeployDirectory(): Promise<void> {
  await Promise.all([
    eventTokenPath(),
    permissionTokenPath(),
    presentationTokenPath(),
    presentationMcpScriptPath(),
    hookScriptPath(),
    hookWrapperPath(),
    codexFeatureMarkerPath(),
    claudePermissionRespondPath(),
    claudeHooksUpgradeMarkerPath(),
  ].map(removeFile))
  try { await fsp.rmdir(hookScriptDeployPath()) } catch { /* not empty: user files stay */ }
}

// Every step runs even if an earlier one is refused; failures are reported together afterwards.
async function uninstallIntegrationUnlocked(target?: IntegrationTarget | 'all'): Promise<void> {
  switch (target) {
    case 'opencode': return uninstallOpenCode()
    case 'codex': return uninstallCodex()
    case 'claude': return uninstallClaude()
    case 'claudeCode': return uninstallClaudeCode()
    default: {
      const failures: string[] = []
      const steps: Array<[IntegrationTarget, () => Promise<void>]> = [
        ['opencode', uninstallOpenCode],
        ['codex', uninstallCodex],
        ['claude', uninstallClaude],
        ['claudeCode', uninstallClaudeCode],
      ]
      for (const [name, run] of steps) {
        try { await run() } catch (error) {
          failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (target === 'all' && failures.length === 0) await cleanupDeployDirectory()
      if (failures.length > 0) throw new Error(failures.join('\n'))
    }
  }
}

// 安裝／移除／修復都會改同幾個設定檔，兩個請求交錯（讀 → 讀 → 寫 → 寫）會互相蓋掉，所以一次只跑一個。
let installerQueue: Promise<unknown> = Promise.resolve()

function serializeInstaller<T>(task: () => Promise<T>): Promise<T> {
  // 不能寫成 then(task, task)：那會把前一個任務的結果／錯誤當成參數傳進這個任務。
  const run = installerQueue.then(() => task(), () => task())
  installerQueue = run.catch(() => {})
  return run
}

function installIntegration(target?: IntegrationTarget): Promise<ConfigWriteResult[]> {
  return serializeInstaller(() => installIntegrationUnlocked(target))
}

function uninstallIntegration(target?: IntegrationTarget | 'all'): Promise<void> {
  return serializeInstaller(() => uninstallIntegrationUnlocked(target))
}

function upgradeClaudeCodeHooks(): Promise<ConfigWriteResult | null> {
  return serializeInstaller(upgradeClaudeCodeHooksUnlocked)
}

function upgradeClaudeCodeHooksOnce(appVersion: string): Promise<ConfigWriteResult | null> {
  return serializeInstaller(() => upgradeClaudeCodeHooksOnceUnlocked(appVersion))
}

function repairWindowsInstalledHooks(): Promise<void> {
  return serializeInstaller(repairWindowsInstalledHooksUnlocked)
}

function refreshAgentConfigIntegrations(appVersion?: string): Promise<void> {
  return serializeInstaller(() => refreshAgentConfigIntegrationsUnlocked(appVersion))
}

export {
  CLAUDE_CODE_HOOK_EVENTS,
  CLAUDE_CODE_UPGRADE_EVENTS,
  CODEX_HOOK_EVENTS,
  serializeInstaller,
  refreshInstalledIntegrationFiles as refreshInstalledIntegrationScriptsAsync,
  hookScriptIsCurrent,
  openCodePluginIsCurrent,
  agentPresence,
  agentConfigDirStatus,
  IS_WIN,
  IS_MAC,
  homeDir,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  codexHooksPath,
  codexConfigPath,
  claudeDesktopConfigPath,
  claudeCodeSettingsPath,
  hookScriptPath,
  hookScriptDeployPath,
  eventTokenPath,
  ensureEventToken,
  permissionTokenPath,
  ensurePermissionToken,
  presentationTokenPath,
  ensurePresentationToken,
  ensurePresentationMcpScript,
  presentationMcpScriptPath,
  claudePermissionRespondPath,
  syncClaudePermissionRespondOptIn,
  upgradeClaudeCodeHooks,
  upgradeClaudeCodeHooksOnce,
  claudeHooksUpgradeMarkerPath,
  ensureDir,
  writeFileEnsured,
  fileExists,
  fileExistsAsync,
  readFile,
  readFileAsync,
  appendToFile,
  removeFromFile,
  installIntegration,
  uninstallIntegration,
  repairWindowsInstalledHooks,
  refreshInstalledIntegrationScripts,
  refreshAgentConfigIntegrations,
  readWindowState,
  writeWindowState,
  openCodePluginContent,
}
