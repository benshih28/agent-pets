#!/usr/bin/env node

import { createHash, randomBytes } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

const PET_URL = 'http://127.0.0.1:17373/v1/events'
const PERMISSION_URL = 'http://127.0.0.1:17374/v1/permission'
const DEPLOY_DIR = path.join(os.homedir(), '.desktop-pet')
const EVENT_TOKEN_PATH = path.join(DEPLOY_DIR, 'event-token')
const PERMISSION_TOKEN_PATH = path.join(DEPLOY_DIR, 'permission-token')
// Written by the app only while "Answer Claude Code permissions from the pet" is on.
const RESPOND_OPT_IN_PATH = path.join(DEPLOY_DIR, 'claude-permission-respond')
const POLL_INTERVAL_MS = 450
const MIN_WAIT_SECONDS = 15
const MAX_WAIT_SECONDS = 120
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
// Fixed text: the reason Claude sees must never echo request content back.
const DENY_MESSAGE = 'Denied in Agent Pets. (已在 Agent Pets 拒絕)'

const validSources = ['codex', 'codex-desktop', 'claude', 'claude-desktop']
let source = validSources.includes(process.argv[2]) ? process.argv[2] : 'codex'

// Claude Code CLI and Claude Desktop share the same ~/.claude/settings.json
// hooks config, so the installer can't hardcode which one is firing — the
// invoked arg is always 'claude'. Claude Code sets CLAUDE_CODE_ENTRYPOINT in
// the hook's environment to say how it was launched (cli, claude-desktop,
// claude-vscode, sdk-*, etc.), so resolve the real source from that instead.
if (source === 'claude' && process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') {
  source = 'claude-desktop'
}


// Which app the agent runs in, so the pet can switch back to it. Only these few environment
// values are read and sent, each capped and shape-checked again by the app; never an env dump,
// pid, tty or path. Flags are sent as `true` only, never the variable's value.
function shortEnv(name, pattern) {
  const value = process.env[name]
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function hostHints() {
  const hints = {
    termProgram: shortEnv('TERM_PROGRAM', /^[A-Za-z0-9._-]{1,32}$/),
    bundleId: process.platform === 'darwin' ? shortEnv('__CFBundleIdentifier', /^[A-Za-z0-9.-]{3,128}$/) : undefined,
    entrypoint: shortEnv('CLAUDE_CODE_ENTRYPOINT', /^[a-z0-9_-]{1,32}$/),
    windowsTerminal: process.env.WT_SESSION ? true : undefined,
    vscode: process.env.VSCODE_INJECTION || process.env.VSCODE_GIT_IPC_HANDLE ? true : undefined,
    cursor: process.env.CURSOR_TRACE_ID ? true : undefined,
  }
  const present = Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined))
  return Object.keys(present).length > 0 ? present : undefined
}

function mapCodexEvent(eventName) {
  switch (eventName) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'thinking'
    case 'PreToolUse':
      return 'tool-running'
    case 'PermissionRequest':
      return 'waiting-permission'
    case 'PostToolUse':
      return 'thinking'
    case 'Stop':
      return 'success'
    case 'SessionEnd':
      return 'offline'
    default:
      return null
  }
}

function mapClaudeEvent(eventName, payload) {
  switch (eventName) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'thinking'
    case 'PreToolUse':
      return 'tool-running'
    case 'PermissionRequest':
      return 'waiting-permission'
    case 'Notification': {
      // Claude Code's Notification hook sends a human-readable `message`
      // string, not a structured type — match on its content.
      const message = String(payload?.message || '').toLowerCase()
      if (message.includes('permission')) return 'waiting-permission'
      if (message.includes('waiting') || message.includes('idle')) return 'waiting-input'
      return null
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return 'thinking'
    case 'Stop':
      return 'success'
    case 'StopFailure':
      return 'error'
    case 'SessionEnd':
      return 'offline'
    default:
      return null
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
  })
}

// --- Claude Code permission respond mode ------------------------------------
// Every failure path below returns silently: printing nothing makes Claude Code
// fall back to its own permission prompt, so the worst case equals no hook.

function readSmallFile(filePath, maxBytes) {
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.size > maxBytes) return null
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

/** Wait limit in seconds when respond mode is on, otherwise null. */
function readRespondOptIn() {
  const raw = readSmallFile(RESPOND_OPT_IN_PATH, 256)
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    if (value?.enabled !== true || typeof value.waitSeconds !== 'number' || !Number.isFinite(value.waitSeconds)) return null
    return Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, Math.round(value.waitSeconds)))
  } catch {
    return null
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function toIdentifier(prefix, value) {
  const text = `${prefix}${String(value ?? '')}`
  if (IDENTIFIER_PATTERN.test(text)) return text
  return `${prefix}${createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 48)}`
}

/** Claude sends no tool_use_id with PermissionRequest; the ID is recomputed from content on PostToolUse. */
function claudePermissionIds(payload) {
  const sessionId = String(payload?.session_id ?? '')
  const permissionId = createHash('sha256')
    .update([sessionId, String(payload?.prompt_id ?? ''), String(payload?.tool_name ?? ''), canonicalJson(payload?.tool_input ?? null)].join('\0'))
    .digest('hex')
    .slice(0, 32)
  return {
    instanceId: toIdentifier('claude-', sessionId),
    sessionId: toIdentifier('', sessionId || 'unknown'),
    permissionId,
  }
}

const DETAIL_KEYS = ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'query']

// What the bubble shows. Known argument fields first; otherwise the arguments as compact JSON
// (MCP tools, Task, ...). `description` is the model's own summary, not what will run, so it is
// never shown. The app redacts and shortens this further before display.
function permissionDetail(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return undefined
  for (const key of DETAIL_KEYS) {
    if (typeof toolInput[key] === 'string' && toolInput[key].trim()) return toolInput[key].slice(0, 1000)
  }
  const { description: _description, ...rest } = toolInput
  if (Object.keys(rest).length === 0) return undefined
  return canonicalJson(rest).slice(0, 1000)
}

function editedFilePath(toolInput) {
  const value = toolInput?.file_path ?? toolInput?.notebook_path
  return typeof value === 'string' && value.length <= 4096 ? value : undefined
}

// The main agent or the subagent that asked; requests are superseded per scope.
function agentScope(payload) {
  return typeof payload?.agent_id === 'string' && payload.agent_id ? toIdentifier('', payload.agent_id) : 'main'
}

async function permissionPost(token, route, body, timeoutMs) {
  try {
    const response = await fetch(`${PERMISSION_URL}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-pets-permission-token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let data = null
    if (response.status === 200 || response.status === 201) {
      try { data = await response.json() } catch { data = null }
    }
    return { status: response.status, data }
  } catch {
    return { status: 0, data: null }
  }
}

function readPermissionToken() {
  const token = (readSmallFile(PERMISSION_TOKEN_PATH, 256) ?? '').trim()
  return /^[a-f0-9]{64}$/i.test(token) ? token : null
}

function writeStdout(text) {
  return new Promise(resolve => process.stdout.write(text, () => resolve()))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Creates the pet request; returns what polling needs, or null to stay silent. */
async function createPermissionRequest(payload, waitSeconds) {
  const token = readPermissionToken()
  if (!token) return null
  const ids = claudePermissionIds(payload)
  const toolName = typeof payload?.tool_name === 'string' && payload.tool_name ? payload.tool_name : 'unknown'
  // Unique to this invocation: only this process can read and acknowledge the decision, so an
  // identical request running in parallel (409 here) can never consume the same click.
  const nonce = randomBytes(16).toString('hex')
  const lookup = { source, instanceId: ids.instanceId, permissionId: ids.permissionId, nonce }
  const created = await permissionPost(token, 'request', {
    ...lookup,
    sessionId: ids.sessionId,
    scope: agentScope(payload),
    project: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
    permission: toolName.slice(0, 80),
    detail: permissionDetail(payload?.tool_input),
    filePath: editedFilePath(payload?.tool_input),
    ttlSeconds: waitSeconds,
  }, 1000)
  if (created.status !== 200 && created.status !== 201) return null
  return { token, lookup }
}

async function pollPermissionDecision({ token, lookup }, waitSeconds) {
  // The broker expires the request after waitSeconds; the grace covers the
  // final poll so a click just before expiry is still picked up.
  const deadline = Date.now() + waitSeconds * 1000 + 2000
  while (Date.now() < deadline) {
    const polled = await permissionPost(token, 'decision', lookup, 1000)
    if (polled.status === 204) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    if (polled.status !== 200) return
    const decision = polled.data?.decision
    const decisionId = polled.data?.decisionId
    if ((decision !== 'allow_once' && decision !== 'deny') || typeof decisionId !== 'string') return
    const output = decision === 'allow_once'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: DENY_MESSAGE }
    await writeStdout(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: output } }))
    await permissionPost(token, 'result', { ...lookup, decisionId, result: 'delivered' }, 1000)
    return
  }
}

// Answered in the terminal (or the turn ended): take the bubble down.
async function resolveClaudePermissions(eventName, payload) {
  const token = readPermissionToken()
  if (!token) return
  const ids = claudePermissionIds(payload)
  if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
    await permissionPost(token, 'resolved', { source, instanceId: ids.instanceId, permissionId: ids.permissionId }, 1000)
    return
  }
  // A new tool call (PreToolUse fires before its own PermissionRequest) or the main turn ending
  // means earlier prompts of that agent were answered in the terminal.
  if (eventName === 'PreToolUse' || eventName === 'Stop') {
    // A background task may still be waiting for an answer after the main turn stops.
    if (eventName === 'Stop' && Array.isArray(payload?.background_tasks) && payload.background_tasks.length > 0) return
    await permissionPost(token, 'resolved-session', { source, instanceId: ids.instanceId, scope: agentScope(payload) }, 1000)
    return
  }
  await permissionPost(token, 'resolved-session', { source, instanceId: ids.instanceId }, 1000)
}

const RESOLVING_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'UserPromptSubmit', 'SessionEnd'])

async function main() {
  let eventToken
  try {
    eventToken = fs.readFileSync(EVENT_TOKEN_PATH, 'utf8').trim()
  } catch {
    process.exit(0)
  }
  if (!/^[a-f0-9]{64}$/i.test(eventToken)) process.exit(0)

  const raw = await readStdin()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const eventName = payload?.event || payload?.hook_event_name || ''
  let state = null

  if (source.startsWith('codex')) {
    state = mapCodexEvent(eventName)
  } else if (source.startsWith('claude')) {
    state = mapClaudeEvent(eventName, payload)
  }

  if (!state) {
    process.exit(0)
  }

  const sessionId = payload?.session_id || payload?.sessionId || 'unknown'
  const project = payload?.cwd || payload?.project || undefined
  const toolName = payload?.tool_name || payload?.toolName || undefined

  const event = {
    source,
    sessionId,
    project,
    state,
    originalEvent: eventName,
    timestamp: Date.now(),
    toolName,
    host: hostHints(),
  }

  const isClaude = source.startsWith('claude')
  const waitSeconds = isClaude && (eventName === 'PermissionRequest' || RESOLVING_EVENTS.has(eventName))
    ? readRespondOptIn()
    : null
  // The pet request is created before the status event, so the app already knows this prompt
  // can be answered from the pet when the event arrives (no "go back to the terminal" notice).
  const pending = waitSeconds !== null && eventName === 'PermissionRequest'
    ? await createPermissionRequest(payload, waitSeconds)
    : null
  const permissionWork = waitSeconds === null
    ? null
    : eventName === 'PermissionRequest'
      ? (pending ? pollPermissionDecision(pending, waitSeconds) : null)
      : resolveClaudePermissions(eventName, payload)

  try {
    await fetch(PET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-pets-token': eventToken,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(300),
    })
  } catch {
    // Desktop pet not running, ignore
  }
  if (permissionWork) await permissionWork
}

main()
