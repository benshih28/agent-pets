import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'
import { setupEnvironment } from './setup-environment.ts'
import { createNodeResolver, NodeNotFoundError, NodeUnsupportedError, type NodeInfo } from './node-resolver.ts'
import type { PetEdge, PetWindowMode } from '../src/types/pet-window'
import { readConfigText, writeConfigSafely, writeTextAtomic, type ConfigWriteResult } from './safe-config-write.ts'
import {
  CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS,
  clampClaudePermissionWaitSeconds,
} from '../src/types/permission.ts'
import {
  codexHookCommand,
  ensureAgentPetsHookEntries,
  escapeCmdQuotedPath,
  disableCodexHooksFeatureText,
  enableCodexHooksFeatureText,
  fileHasAgentPetsHooks,
  isAgentPetsHook,
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

// Node resolution lives in node-resolver.ts (async, validated cache, no bare-"node" fallback).
const nodeResolver = createNodeResolver()

/** Legacy synchronous lookup for non-install callers (e.g. project MCP); may return a bare "node". */
export function resolveNodeBin(): string {
  return nodeResolver.peek()?.path ?? nodeResolver.resolveSync()?.path ?? 'node'
}

/** Resolve (async) and validate Node.js before an install that writes a hook command. */
export async function prepareNodeForInstall(): Promise<NodeInfo> {
  const fixed = setupEnvironment().nodePath?.()
  if (fixed) return { path: fixed, version: null, supported: true }
  const info = await nodeResolver.resolve()
  if (!info) throw new NodeNotFoundError()
  if (!info.supported) throw new NodeUnsupportedError(info.version)
  return info
}

/** Synchronous accessor for installers; prepareNodeForInstall() must have succeeded first. */
function requireNodeBin(): string {
  const fixed = setupEnvironment().nodePath?.()
  if (fixed) return fixed
  const info = nodeResolver.peek() ?? nodeResolver.resolveSync()
  if (!info) throw new NodeNotFoundError()
  return info.path
}

// --- OpenCode CLI plugin ---
// OpenCode scans "plugin" (singular) — not "plugins" — and only picks up
// .js files there, not .mjs. Both confirmed live: a console.error marker
// injected into the pre-existing superpowers.js fired; the same marker in
// our desktop-pet.mjs never did, until renamed to .js.
function openCodeCliPluginPath(): string {
  return path.join(homeDir(), '.config', 'opencode', 'plugin', 'desktop-pet.js')
}

// --- OpenCode Desktop plugin ---
function openCodeDesktopPluginPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugin', 'desktop-pet.js')
  }
  return path.join(setupEnvironment().appData(), 'opencode', 'plugin', 'desktop-pet.js')
}

// --- Codex hooks.json ---
// Codex CLI and Codex Desktop currently share ~/.codex, but Desktop does not
// expose a separate integration API. Installing this file therefore only
// guarantees CLI support; Desktop support depends on whether that build runs
// the same hook pipeline.
function codexHooksPath(): string {
  return path.join(homeDir(), '.codex', 'hooks.json')
}

function codexConfigPath(): string {
  return path.join(homeDir(), '.codex', 'config.toml')
}

// --- Claude Desktop config ---
function claudeDesktopConfigPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return path.join(setupEnvironment().appData(), 'Claude', 'claude_desktop_config.json')
}

// --- Claude Code settings.json (shared by CLI & Desktop) ---
function claudeCodeSettingsPath(): string {
  return path.join(homeDir(), '.claude', 'settings.json')
}

// --- Pet window position (persisted across restarts) ---
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

// Merges rather than overwrites: position is saved when a drag ends and size
// when the renderer resizes the pet, so each writer must leave the other's
// field alone. Position and size are only coherent together — the pet window
// is bottom-anchored, so a y saved at one size means a different visible spot
// at another.
function writeWindowState(state: Partial<PetWindowState>): void {
  const merged = { ...(readWindowState() ?? {}), ...state }
  if (typeof merged.x !== 'number' || typeof merged.y !== 'number') return
  writeFileEnsured(windowStatePath(), JSON.stringify(merged))
}

// --- Hook script path ---
function hookScriptPath(): string {
  return path.join(homeDir(), '.desktop-pet', 'agent-hook.mjs')
}

function hookWrapperPath(): string {
  return path.join(homeDir(), '.desktop-pet', 'agent-hook.cmd')
}

function hookScriptDeployPath(): string {
  return path.join(homeDir(), '.desktop-pet')
}

function eventTokenPath(): string {
  return path.join(hookScriptDeployPath(), 'event-token')
}

function permissionTokenPath(): string {
  return path.join(hookScriptDeployPath(), 'permission-token')
}

function presentationTokenPath(): string {
  return path.join(hookScriptDeployPath(), 'presentation-token')
}

// Opt-in marker read by agent-hook.mjs. Present only while the user has turned on
// answering Claude Code permissions from the pet; the main process still checks
// its own persisted preference before accepting any request.
function claudePermissionRespondPath(): string {
  return path.join(hookScriptDeployPath(), 'claude-permission-respond')
}

/** Writes (enabled) or removes (null) the hook's opt-in file. */
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

// Tokens created or read by this process are remembered so that a full cleanup followed by a
// reinstall in the same session re-uses the value the running event/permission servers already hold.
const tokenCache = new Map<string, string>()

function ensureToken(tokenPath: string, label: string): string {
  const dir = hookScriptDeployPath()
  ensureDir(dir)
  if (!IS_WIN) {
    try { fs.chmodSync(dir, 0o700) } catch {}
  }

  try {
    const stat = fs.lstatSync(tokenPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Agent Pets ${label} token path is not a regular file`)
    }
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (/^[a-f0-9]{64}$/i.test(existing)) {
      if (!IS_WIN) {
        try { fs.chmodSync(tokenPath, 0o600) } catch {}
      }
      tokenCache.set(tokenPath, existing)
      return existing
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code && code !== 'ENOENT') throw error
  }

  const token = tokenCache.get(tokenPath) ?? randomBytes(32).toString('hex')
  const descriptor = fs.openSync(tokenPath, 'w', 0o600)
  try {
    fs.writeFileSync(descriptor, `${token}\n`, 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  if (!IS_WIN) {
    try { fs.chmodSync(tokenPath, 0o600) } catch {}
  }
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

// --- Bundled integrations/ source (agent-hook.mjs, agent-hook.cmd) ---
// electron-builder copies integrations/ to Resources/integrations via
// extraResources; in dev __dirname is <project>/dist-electron so '..' lands
// back on the project root, matching getPetsJsonPath's dev/prod split.
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

function presentationMcpScriptPath(): string {
  return path.join(hookScriptDeployPath(), 'presentation-mcp.mjs')
}

// --- Write helpers ---
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function writeFileEnsured(filePath: string, content: string): void {
  writeTextAtomic(filePath, content)
}

// Files Agent Pets fully owns (hook script, plugins): rewritten only when the content differs, so
// the install outcome can report "unchanged" honestly. No backup is needed for our own files.
function writeManaged(filePath: string, content: string): ConfigWriteResult {
  const existing = readFile(filePath)
  if (existing === content) return { status: 'unchanged', path: filePath, backupPath: null }
  writeTextAtomic(filePath, content)
  return { status: 'written', path: filePath, backupPath: null }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

function readFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
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

function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

// Marker recording that Agent Pets (not the user) added `hooks = true`, so uninstall only
// reverts what we changed.
function codexFeatureMarkerPath(): string {
  return path.join(hookScriptDeployPath(), 'codex-hooks-feature-added')
}

function enableCodexHooksFeature(filePath: string): ConfigWriteResult {
  const existing = readConfigText(filePath) ?? ''
  const { content, added } = enableCodexHooksFeatureText(existing)
  const result = writeConfigSafely(filePath, content)
  if (added) {
    try { writeFileEnsured(codexFeatureMarkerPath(), '1\n') } catch { /* marker is best effort */ }
  }
  return result
}

// --- Hook script content (bundled via extraResources) ---
function hookScriptContent(): string {
  return fs.readFileSync(path.join(integrationsDir(), 'agent-hook.mjs'), 'utf-8')
}

function hookWrapperContent(): string {
  return fs
    .readFileSync(path.join(integrationsDir(), 'agent-hook.cmd'), 'utf-8')
    .replace('__NODE_EXECUTABLE__', () => escapeCmdQuotedPath(requireNodeBin()))
}

function installHookScript(): ConfigWriteResult[] {
  ensureEventToken()
  const dir = hookScriptDeployPath()
  ensureDir(dir)
  const results = [writeManaged(hookScriptPath(), hookScriptContent())]
  if (IS_WIN) {
    results.push(writeManaged(hookWrapperPath(), hookWrapperContent()))
  }
  if (!IS_WIN) {
    try { fs.chmodSync(hookScriptPath(), 0o700) } catch {}
  }
  return results
}

// --- OpenCode plugin content ---
// OpenCode's real plugin shape: an (async) function that receives a context
// object and returns a hooks object. Tool lifecycle hooks are direct keys;
// session lifecycle notifications arrive through the generic `event` hook.
// There's no direct "user prompt submitted" hook exposed, so the pet won't
// show "thinking" until the first tool call — a known gap, not a bug.
function openCodePluginContent(source: 'opencode-desktop' | 'opencode-cli'): string {
  return `import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

const SOURCE = '${source}';
const instanceId = 'opencode-' + process.pid + '-' + Date.now() + '-' + randomBytes(6).toString('hex');
const eventTokenPath = path.join(os.homedir(), '.desktop-pet', 'event-token');
const permissionTokenPath = path.join(os.homedir(), '.desktop-pet', 'permission-token');
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
      hostname: '127.0.0.1',
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
  void postJson(17373, '/v1/events', 'X-Agent-Pets-Token', readToken(eventTokenPath), {
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
    17374,
    pathname,
    'X-Agent-Pets-Permission-Token',
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
    const response = await permissionPost('/v1/permission/decision', input);
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
    const acknowledged = await permissionPost('/v1/permission/result', {
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
  const response = await permissionPost('/v1/permission/request', input);
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
  await permissionPost('/v1/permission/resolved', input);
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
    if (event.type === 'session.status') {
      if (event.properties.status.type === 'busy') setState(sessionId, 'thinking', undefined, event.type, projectPath);
      if (event.properties.status.type === 'retry') setState(sessionId, 'thinking', undefined, event.type, projectPath);
      if (event.properties.status.type === 'idle') setState(sessionId, 'idle', undefined, event.type, projectPath);
    } else if (event.type === 'session.idle') {
      setState(sessionId, 'idle', undefined, event.type, projectPath);
    } else if (event.type === 'session.error') {
      setState(sessionId, 'error', undefined, event.type, projectPath);
    } else if (event.type === 'permission.updated' || event.type === 'permission.asked') {
      await registerPermission(client, event.properties, projectPath, directory);
    } else if (event.type === 'permission.replied') {
      await resolvePermission(event.properties);
      setState(sessionId, 'thinking', undefined, event.type, projectPath);
    }
  },
  // This hook can announce waiting state, but has no stable permission ID;
  // only permission.updated/permission.asked may create a Broker request.
  'permission.ask': async (input) => {
    setState(input && input.sessionID, 'waiting-permission', undefined, 'permission.ask', projectPath);
  },
  dispose: async () => {
    await Promise.all([...activePermissions.values()].map((input) => (
      permissionPost('/v1/permission/resolved', input)
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

function installOpenCode(): ConfigWriteResult[] {
  ensureEventToken()
  ensurePermissionToken()
  return [
    writeManaged(openCodeDesktopPluginPath(), openCodePluginContent('opencode-desktop')),
    writeManaged(openCodeCliPluginPath(), openCodePluginContent('opencode-cli')),
  ]
}

function uninstallOpenCode(): void {
  removeFile(openCodeDesktopPluginPath())
  removeFile(openCodeCliPluginPath())
}

// --- Codex hooks ---
const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
]

function codexHooksJson(): any {
  const hook = hookScriptPath()
  const nodeBin = IS_WIN ? '' : requireNodeBin()
  const command = codexHookCommand({ isWindows: IS_WIN, nodeBin, hookScript: hook, wrapper: hookWrapperPath() })
  const handler = () => ({
    hooks: [
      {
        type: 'command',
        command,
        statusMessage: 'Updating Agent Pets status',
      },
    ],
  })

  return {
    description: 'Agent Pets lifecycle hooks for Codex CLI.',
    hooks: Object.fromEntries(CODEX_HOOK_EVENTS.map((event) => [event, [handler()]])),
  }
}

function installCodex(): ConfigWriteResult[] {
  const results: ConfigWriteResult[] = installHookScript()

  // Throws ConfigRefusedError (and writes nothing) if hooks.json exists but is not valid JSON.
  const newHooks = codexHooksJson()
  const { hooks, ...defaults } = newHooks
  results.push(mergeAgentPetsHooksFile(codexHooksPath(), hooks, defaults))

  results.push(enableCodexHooksFeature(codexConfigPath()))
  return results
}

const CODEX_HOOKS_OWNED_TOP_LEVEL = { description: 'Agent Pets lifecycle hooks for Codex CLI.' }

// The hook script (and Windows wrapper) is shared by Codex, Claude Code and Claude Desktop.
// Remove it only when no remaining config still points at it.
function isHookScriptReferenced(): boolean {
  if (fileHasAgentPetsHooks(codexHooksPath())) return true
  if (fileHasAgentPetsHooks(claudeCodeSettingsPath())) return true
  try {
    const desktop = readConfigText(claudeDesktopConfigPath())
    if (desktop && JSON.parse(desktop)?.agent === hookScriptPath()) return true
  } catch {}
  return false
}

function releaseSharedHookScript(): void {
  if (isHookScriptReferenced()) return
  removeFile(hookScriptPath())
  removeFile(hookWrapperPath())
}

function uninstallCodex(): void {
  // Throws ConfigRefusedError for an unparseable file, leaving it untouched.
  removeAgentPetsHooksFile(codexHooksPath(), CODEX_HOOKS_OWNED_TOP_LEVEL)
  const configFile = codexConfigPath()
  if (fileExists(configFile) && fileExists(codexFeatureMarkerPath())) {
    const existing = readConfigText(configFile) ?? ''
    const next = disableCodexHooksFeatureText(existing)
    if (next !== existing) {
      writeConfigSafely(configFile, next)
      if (next === '') removeFile(configFile)
    }
  }
  removeFile(codexFeatureMarkerPath())
  releaseSharedHookScript()
}

// --- Claude Desktop ---
function installClaude(): ConfigWriteResult[] {
  const scripts = installHookScript()
  return [...scripts, setJsonKeyFile(claudeDesktopConfigPath(), 'agent', hookScriptPath())]
}

function uninstallClaude(): void {
  const configFile = claudeDesktopConfigPath()
  if (fileExists(configFile)) {
    removeJsonKeyFile(configFile, 'agent', hookScriptPath())
  }
  releaseSharedHookScript()
}

// --- Claude Code (CLI & Desktop share settings.json) ---
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
  'SessionEnd',
]
const CLAUDE_CODE_TOOL_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'])
// Only the PermissionRequest handler may wait (for a pet answer); every other
// event keeps Claude Code's default timeout.
const CLAUDE_CODE_HOOK_TIMEOUTS: Readonly<Record<string, number>> = { PermissionRequest: CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS }

function claudeCodeHooksJson(): any {
  const hook = hookScriptPath()
  const nodeBin = requireNodeBin()
  const handler = (event: string) => {
    const timeout = CLAUDE_CODE_HOOK_TIMEOUTS[event]
    const entry: any = {
      hooks: [{ type: 'command', command: nodeBin, args: [hook, 'claude'], ...(timeout ? { timeout } : {}) }],
    }
    if (CLAUDE_CODE_TOOL_EVENTS.has(event)) entry.matcher = '*'
    return entry
  }

  return {
    hooks: Object.fromEntries(CLAUDE_CODE_HOOK_EVENTS.map((event) => [event, [handler(event)]])),
  }
}

function installClaudeCode(): ConfigWriteResult[] {
  const scripts = installHookScript()
  // Throws ConfigRefusedError (and writes nothing) if settings.json is not valid JSON.
  return [...scripts, mergeAgentPetsHooksFile(claudeCodeSettingsPath(), claudeCodeHooksJson().hooks)]
}

// Events added after the first Claude Code release; older installs are upgraded on startup.
const CLAUDE_CODE_UPGRADE_EVENTS = ['PermissionRequest', 'PostToolUseFailure']

/**
 * Brings an install made by an older version up to date (adds the PermissionRequest /
 * PostToolUseFailure handlers and the PermissionRequest timeout). Touches only Agent Pets'
 * own handlers and keeps a backup; a missing, unparseable or not-installed settings.json is
 * left alone, and handlers for the original events are never re-added.
 */
function upgradeClaudeCodeHooks(): ConfigWriteResult | null {
  return ensureAgentPetsHookEntries(claudeCodeSettingsPath(), CLAUDE_CODE_UPGRADE_EVENTS.map(event => ({
    event,
    ...(CLAUDE_CODE_TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
    ...(CLAUDE_CODE_HOOK_TIMEOUTS[event] ? { timeout: CLAUDE_CODE_HOOK_TIMEOUTS[event] } : {}),
  })))
}

function claudeHooksUpgradeMarkerPath(): string {
  return path.join(hookScriptDeployPath(), 'claude-hooks-upgraded')
}

/**
 * Runs the upgrade at most once per app version, so an Agent Pets entry the user removed on
 * purpose is not added back on every launch. Settings without any Agent Pets hook are never
 * changed (ensureAgentPetsHookEntries returns null for them).
 */
function upgradeClaudeCodeHooksOnce(appVersion: string): ConfigWriteResult | null {
  const marker = claudeHooksUpgradeMarkerPath()
  if ((readFile(marker) ?? '').trim() === appVersion) return null
  const result = upgradeClaudeCodeHooks()
  writeFileEnsured(marker, `${appVersion}\n`)
  return result
}

function uninstallClaudeCode(): void {
  const settingsFile = claudeCodeSettingsPath()
  if (!fileExists(settingsFile)) return
  // Throws ConfigRefusedError for an unparseable settings.json, leaving it untouched.
  removeAgentPetsHooksFile(settingsFile)
  releaseSharedHookScript()
}

// Repair hooks written by older Windows builds. Those builds used Electron's
// process.execPath as the hook runtime, so their hooks point back to
// Agent Pets.exe and recursively launch the desktop app on every event.
function rewriteInstalledAgentPetsHooks(filePath: string, target: 'codex' | 'claude'): boolean {
  const hookPath = hookScriptPath()
  const codexCommand = codexHookCommand({ isWindows: true, nodeBin: '', hookScript: hookPath, wrapper: hookWrapperPath() })
  const nodeBin = target === 'claude' ? (nodeResolver.resolveSync()?.path ?? '') : ''
  if (target === 'claude' && !nodeBin) return false // cannot repair without a real Node path
  return rewriteAgentPetsHookCommands(filePath, (hook) => {
    // Never rewrite user config just because the Node path changed: only repair the known-bad
    // state where the hook runs through the Electron executable.
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

function repairWindowsInstalledHooks(): void {
  if (!IS_WIN) return

  const codexChanged = rewriteInstalledAgentPetsHooks(codexHooksPath(), 'codex')
  const claudeChanged = rewriteInstalledAgentPetsHooks(claudeCodeSettingsPath(), 'claude')

  if (codexChanged || claudeChanged) installHookScript()
}

function refreshInstalledIntegrationScripts(appVersion?: string): string {
  const token = ensureEventToken()
  ensurePermissionToken()
  ensurePresentationToken()
  // A read-only home directory should not prevent the desktop pet from
  // starting. The presentation bridge can be repaired from Setup later; the
  // event receiver, permissions, and core UI remain available meanwhile.
  try {
    ensurePresentationMcpScript()
  } catch (error) {
    console.error('Presentation MCP script refresh skipped', error)
  }
  try {
    if (fileExists(hookScriptPath())) installHookScript()
    if (fileExists(openCodeDesktopPluginPath())) {
      writeFileEnsured(openCodeDesktopPluginPath(), openCodePluginContent('opencode-desktop'))
    }
    if (fileExists(openCodeCliPluginPath())) {
      writeFileEnsured(openCodeCliPluginPath(), openCodePluginContent('opencode-cli'))
    }
    repairWindowsInstalledHooks()
  } catch (error) {
    console.error('Installed integration refresh skipped', error)
  }
  try {
    if (appVersion) upgradeClaudeCodeHooksOnce(appVersion)
  } catch (error) {
    console.error('Claude Code hook upgrade skipped', error)
  }
  return token
}

// --- Health helpers used by the adapter diagnostics ---
/** The bundled hook script matches what is deployed (a stale copy keeps old behaviour). */
function hookScriptIsCurrent(): boolean {
  try {
    const deployed = readFile(hookScriptPath())
    return deployed !== null && deployed === hookScriptContent()
  } catch {
    return true // bundle unreadable: do not raise a false alarm
  }
}

function openCodePluginIsCurrent(kind: 'cli' | 'desktop'): boolean {
  const target = kind === 'cli' ? openCodeCliPluginPath() : openCodeDesktopPluginPath()
  const deployed = readFile(target)
  return deployed !== null
    && deployed === openCodePluginContent(kind === 'cli' ? 'opencode-cli' : 'opencode-desktop')
}

/** Whether each agent's own config directory exists (the tool has been used on this machine). */
function agentPresence(): { codex: boolean, claude: boolean, opencode: boolean } {
  return {
    codex: fs.existsSync(path.join(homeDir(), '.codex')),
    claude: fs.existsSync(path.join(homeDir(), '.claude')),
    opencode: fs.existsSync(path.dirname(openCodeCliPluginPath())) || fs.existsSync(path.dirname(openCodeDesktopPluginPath())),
  }
}

export type IntegrationTarget = 'opencode' | 'codex' | 'claude' | 'claudeCode'

function installIntegration(target?: IntegrationTarget): ConfigWriteResult[] {
  switch (target) {
    case 'opencode': return installOpenCode()
    case 'codex': return installCodex()
    case 'claude': return installClaude()
    case 'claudeCode': return installClaudeCode()
    default:
      // Claude Desktop's `agent` key is not a documented setting, so it is no longer written by default
      // (it is still removed on uninstall for older installs). Claude Code covers CLI and Desktop.
      return [...installOpenCode(), ...installCodex(), ...installClaudeCode()]
  }
}

function cleanupDeployDirectory(): void {
  for (const filePath of [
    eventTokenPath(),
    permissionTokenPath(),
    presentationTokenPath(),
    presentationMcpScriptPath(),
    hookScriptPath(),
    hookWrapperPath(),
    codexFeatureMarkerPath(),
    claudePermissionRespondPath(),
    claudeHooksUpgradeMarkerPath(),
  ]) {
    removeFile(filePath)
  }
  try { fs.rmdirSync(hookScriptDeployPath()) } catch { /* not empty: user files stay */ }
}

/**
 * Removes Agent Pets' own entries. With no target every integration is removed; with 'all' the
 * tokens and bridge scripts under the deploy directory are removed too. Every step runs even if an
 * earlier one is refused; failures are reported together afterwards.
 */
function uninstallIntegration(target?: IntegrationTarget | 'all'): void {
  switch (target) {
    case 'opencode': uninstallOpenCode(); return
    case 'codex': uninstallCodex(); return
    case 'claude': uninstallClaude(); return
    case 'claudeCode': uninstallClaudeCode(); return
    default: {
      const failures: string[] = []
      const steps: Array<[IntegrationTarget, () => void]> = [
        ['opencode', uninstallOpenCode],
        ['codex', uninstallCodex],
        ['claude', uninstallClaude],
        ['claudeCode', uninstallClaudeCode],
      ]
      for (const [name, run] of steps) {
        try { run() } catch (error) {
          failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (target === 'all' && failures.length === 0) cleanupDeployDirectory()
      if (failures.length > 0) throw new Error(failures.join('\n'))
    }
  }
}

export {
  hookScriptIsCurrent,
  openCodePluginIsCurrent,
  agentPresence,
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
  readFile,
  appendToFile,
  removeFromFile,
  installIntegration,
  uninstallIntegration,
  repairWindowsInstalledHooks,
  refreshInstalledIntegrationScripts,
  readWindowState,
  writeWindowState,
  openCodePluginContent,
}
