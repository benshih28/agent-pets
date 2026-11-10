#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

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
// 送到 app 的時限分兩段（量測依據見 docs/dev/hook-delivery.md）。請求一旦交給作業系統，app 晚點才讀也收得到
// （即使這個程序已結束），所以長的時限只涵蓋把請求送出去，機器很忙時這段可能要將近 1 秒。
const SEND_DEADLINE_MS = 1500
// 狀態事件不需要回應內容，送出後只短暫等 204 就離開。
const STATUS_ANSWER_GRACE_MS = 250
// 權限回覆要讀回應（請求是否建立、使用者的決定），送出後最多再等這麼久。
const PERMISSION_ANSWER_DEADLINE_MS = 1000
const MAX_ANSWER_BYTES = 16 * 1024
// app 正在啟動（electron/main/hook-startup-marker.ts 寫的標記夠新）時，連線被拒就每隔一段時間重試，總共最多等這麼久。
const STARTUP_RETRY_INTERVAL_MS = 100
const STARTUP_WAIT_MS = 5000
// 比這更舊的標記視為當機留下的，不重試。
const STARTUP_MARKER_MAX_AGE_MS = 20_000
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

/**
 * POST JSON 到本機 app。用 node:http 而不是 fetch：fetch 第一次呼叫的初始化在忙碌的機器上就可能吃掉好幾百毫秒。
 * 時限分兩段：SEND_DEADLINE_MS 內要把請求交給作業系統，之後最多再等 answerMs。
 * 不會 reject。回傳 { status, data, refused }：status 0 代表沒有收到回應標頭；data 只在 readAnswer 且回 200/201 時
 * 解析（超過 MAX_ANSWER_BYTES、格式錯誤或沒讀完就是 null）；refused 代表連線被拒，請求完全沒有送出。
 */
function postLocal(url, headers, payload, { answerMs, readAnswer }) {
  const body = JSON.stringify(payload)
  return new Promise((resolve) => {
    let timer = null
    let settled = false
    let status = 0
    let refused = false
    const chunks = []
    let size = 0
    const request = http.request(url, {
      method: 'POST',
      agent: false,
      headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      status = response.statusCode ?? 0
      const keep = readAnswer && (status === 200 || status === 201)
      // 回應中途斷線時立刻結束，不必等完時限。
      response.on('error', () => done(false))
      response.once('end', () => done(keep))
      if (!keep) {
        response.resume()
        return
      }
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_ANSWER_BYTES) {
          done(false)
          return
        }
        chunks.push(chunk)
      })
    })
    function done(parse) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.destroy()
      let data = null
      if (parse) {
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { data = null }
      }
      resolve({ status, data, refused })
    }
    // 用 on 而不是 once：銷毀還沒回應的請求可能再發出一次 error。
    request.on('error', (error) => {
      if (!settled && error?.code === 'ECONNREFUSED') refused = true
      done(false)
    })
    request.once('finish', () => {
      if (settled) return
      clearTimeout(timer)
      timer = setTimeout(() => done(false), answerMs)
    })
    timer = setTimeout(() => done(false), SEND_DEADLINE_MS)
    request.end(body)
  })
}

async function permissionPost(token, route, body) {
  const { status, data } = await postLocal(`${PERMISSION_URL}/${route}`, { 'x-agent-pets-permission-token': token }, body, {
    answerMs: PERMISSION_ANSWER_DEADLINE_MS,
    readAnswer: true,
  })
  return { status, data }
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
  })
  if (created.status !== 200 && created.status !== 201) return null
  return { token, lookup }
}

async function pollPermissionDecision({ token, lookup }, waitSeconds) {
  // The broker expires the request after waitSeconds; the grace covers the
  // final poll so a click just before expiry is still picked up.
  const deadline = Date.now() + waitSeconds * 1000 + 2000
  while (Date.now() < deadline) {
    const polled = await permissionPost(token, 'decision', lookup)
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
    await permissionPost(token, 'result', { ...lookup, decisionId, result: 'delivered' })
    return
  }
}

// Answered in the terminal (or the turn ended): take the bubble down.
async function resolveClaudePermissions(eventName, payload) {
  const token = readPermissionToken()
  if (!token) return
  const ids = claudePermissionIds(payload)
  if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
    await permissionPost(token, 'resolved', { source, instanceId: ids.instanceId, permissionId: ids.permissionId })
    return
  }
  // A new tool call (PreToolUse fires before its own PermissionRequest) or the main turn ending
  // means earlier prompts of that agent were answered in the terminal.
  if (eventName === 'PreToolUse' || eventName === 'Stop') {
    // A background task may still be waiting for an answer after the main turn stops.
    if (eventName === 'Stop' && Array.isArray(payload?.background_tasks) && payload.background_tasks.length > 0) return
    await permissionPost(token, 'resolved-session', { source, instanceId: ids.instanceId, scope: agentScope(payload) })
    return
  }
  await permissionPost(token, 'resolved-session', { source, instanceId: ids.instanceId })
}

/** app 剛啟動、還沒開始收事件。只在連線被拒時才呼叫，所以 app 開著時完全不會多讀檔。 */
function appIsStarting() {
  try {
    const marker = path.join(DEPLOY_DIR, `event-port-${new URL(PET_URL).port}.starting`)
    const stat = fs.lstatSync(marker)
    const age = Date.now() - stat.mtimeMs
    return stat.isFile() && age > -1000 && age < STARTUP_MARKER_MAX_AGE_MS
  } catch {
    return false
  }
}

/**
 * 寵物沒開時連線立刻被拒，hook 馬上結束（只多一次 lstat）。app 正在啟動時才重試，
 * 而且同一個 hook 依序重試，同一個 session 的事件順序不會亂。
 */
async function postStatus(eventToken, event) {
  const startedAt = Date.now()
  for (;;) {
    const { refused } = await postLocal(PET_URL, { 'x-agent-pets-token': eventToken }, event, {
      answerMs: STATUS_ANSWER_GRACE_MS,
      readAnswer: false,
    })
    if (!refused || Date.now() - startedAt + STARTUP_RETRY_INTERVAL_MS > STARTUP_WAIT_MS || !appIsStarting()) return
    await sleep(STARTUP_RETRY_INTERVAL_MS)
  }
}

const RESOLVING_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'UserPromptSubmit', 'SessionEnd'])

async function main() {
  const eventToken = (readSmallFile(EVENT_TOKEN_PATH, 256) ?? '').trim()
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

  await postStatus(eventToken, event)
  if (permissionWork) await permissionWork
}

main()
