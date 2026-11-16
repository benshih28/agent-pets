import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type { AgentStatusEvent } from '../src/types/agent'
import { createOrderedBatchCoalescer } from './ipc/broadcast-coalescer.ts'
import { IPC_CHANNELS } from './ipc/channels.ts'
import { createEventRateLimiter } from './event-rate-limit.ts'
import { eventPipelineStats } from './event-stats.ts'
import { hasJsonContentType, readBoundedJson, sendJson, tokenMatches } from './loopback-http.ts'
import { listenOnLocalPort, type LocalServerListenHandle, type LocalServerListenOptions } from './local-server-listen.ts'
import { AGENT_PETS_SERVER_HEADER } from './main/server-health.ts'
import { DEFAULT_LOCAL_PORTS, LOCAL_WIRE_HEADERS, LOCAL_WIRE_HOST, LOCAL_WIRE_PATHS } from '../src/types/local-wire.ts'
import { normalizeAgentStatusEvent, type EventNormalizationResult } from './event-normalizer'
export type { AgentStatusEvent } from '../src/types/agent'

const MAX_BODY_BYTES = 64 * 1024
const MAX_QUEUED_EVENTS = 1_000
const TERMINAL_STATES = new Set(['success', 'error', 'waiting-permission', 'waiting-input'])
const SEND_FAILURE_LOG_INTERVAL_MS = 10_000

export type EventIngressNormalizer = (
  value: unknown,
  receivedAt?: number,
) => EventNormalizationResult
  | { ok: true; event: AgentStatusEvent }
  | { ok: false; error: string }
  | Promise<EventNormalizationResult | { ok: true; event: AgentStatusEvent } | { ok: false; error: string }>

export function createEventServer(
  getWindows: () => BrowserWindow[],
  eventToken: string,
  onEvent?: (event: AgentStatusEvent) => void,
  normalizeEvent: EventIngressNormalizer = normalizeAgentStatusEvent,
  listenHooks: Pick<LocalServerListenOptions, 'onStatus' | 'onPersistentFailure'> & {
    onHandle?: (handle: LocalServerListenHandle) => void
    port?: number
    /**
     * 給主程序自己產生的事件用（例如從對話紀錄檔補上的回合結束）：拿到一個把事件送進
     * 跟 hook 事件相同流程的函式。事件必須已經是正規化過的；不經過 HTTP、token 與流量限制。
     */
    onDispatcher?: (dispatch: (event: AgentStatusEvent) => void) => void
  } = {},
) {
  const limiter = createEventRateLimiter()
  let lastSendFailureLogAt = 0
  const enqueueAgentEvent = createOrderedBatchCoalescer<{ window: BrowserWindow; event: AgentStatusEvent }>(batch => {
    const eventsByWindow = new Map<BrowserWindow, AgentStatusEvent[]>()
    for (const { window, event } of batch) {
      const events = eventsByWindow.get(window) ?? []
      events.push(event)
      eventsByWindow.set(window, events)
    }
    for (const [window, events] of eventsByWindow) {
      if (window.isDestroyed()) continue
      try { window.webContents.send(IPC_CHANNELS.agentStatusEvent, events) } catch (error) {
        eventPipelineStats.sendFailures += events.length
        const current = Date.now()
        if (current - lastSendFailureLogAt >= SEND_FAILURE_LOG_INTERVAL_MS) {
          lastSendFailureLogAt = current
          console.error('Delivering agent events to a window failed', error)
        }
      }
    }
  }, undefined, {
    maxPending: MAX_QUEUED_EVENTS,
    // Under backpressure keep completions/errors/permission prompts and shed heartbeats first.
    isPriority: ({ event }) => TERMINAL_STATES.has(event.state),
    onDrop: () => { eventPipelineStats.droppedByBackpressure += 1 },
  })

  const expectedToken = Buffer.from(eventToken)

  function sendToWindows(event: AgentStatusEvent): void {
    try {
      for (const win of getWindows()) enqueueAgentEvent({ window: win, event })
    } catch (error) {
      console.error('Event dispatch failed', error)
    }
  }

  // Side effects (notifications, XP, history). setImmediate keeps arrival order, and a failure
  // here is our bug, not the caller's, so it is logged rather than surfaced.
  function runSideEffects(event: AgentStatusEvent): void {
    setImmediate(() => {
      try {
        onEvent?.(event)
      } catch (error) {
        console.error('Event handler failed', error)
      }
    })
  }

  listenHooks.onDispatcher?.((event) => {
    sendToWindows(event)
    runSideEffects(event)
  })

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    // Lets a second Agent Pets instance recognise this port owner without a token.
    response.setHeader(AGENT_PETS_SERVER_HEADER, 'event')
    if (request.method !== 'POST' || request.url !== LOCAL_WIRE_PATHS.events) {
      response.writeHead(404)
      response.end()
      return
    }

    // CLI hooks do not send Origin. Reject browser-originated requests so an
    // arbitrary website cannot spoof agent state through the loopback server.
    if (request.headers.origin) {
      sendJson(response, 403, { error: 'browser origins are not allowed' })
      return
    }

    if (!tokenMatches(request.headers[LOCAL_WIRE_HEADERS.eventToken], expectedToken)) {
      sendJson(response, 401, { error: 'unauthorized' })
      request.resume()
      return
    }

    if (!hasJsonContentType(request)) {
      sendJson(response, 415, { error: 'application/json required' })
      return
    }

    if (!limiter.allowRequest()) {
      eventPipelineStats.rateLimited += 1
      sendJson(response, 429, { error: 'too many events' }, { 'retry-after': '10' })
      request.resume()
      return
    }

    // 錯誤字串是既有契約（與 presentation 的 `request_too_large` 不同），不在這裡統一。
    const body = await readBoundedJson(request, MAX_BODY_BYTES)
    if (!body.ok) {
      switch (body.reason) {
        case 'too_large':
          sendJson(response, 413, { error: 'request too large' })
          return
        case 'empty':
        case 'invalid_json':
          sendJson(response, 400, { error: 'invalid JSON' })
          return
        case 'aborted':
          return
      }
    }

    let event: AgentStatusEvent
    try {
      const normalized = await normalizeEvent(body.value, Date.now())
      if (!normalized.ok) {
        sendJson(response, 400, { error: normalized.error })
        return
      }
      event = normalized.event
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' })
      return
    }

    // Budgets are per source session, with a separate one for terminal
    // events, so one runaway hook cannot starve other agents' completions.
    if (!limiter.allowEvent(`${event.source}:${event.sessionId}`, TERMINAL_STATES.has(event.state))) {
      eventPipelineStats.rateLimited += 1
      sendJson(response, 429, { error: 'too many events' }, { 'retry-after': '10' })
      return
    }

    sendToWindows(event)

    // Acknowledge first: the hook must never wait on synchronous SQLite work.
    response.writeHead(204)
    response.end()

    // Runs right after the response is flushed.
    runSideEffects(event)
  })

  // 本機 hook 的請求都很小；縮短逾時，避免慢速連線長時間佔用 socket。
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000

  const port = listenHooks.port ?? DEFAULT_LOCAL_PORTS.event
  const handle = listenOnLocalPort(server, port, {
    label: 'Event',
    onStatus: listenHooks.onStatus,
    onPersistentFailure: listenHooks.onPersistentFailure,
    onListening: () => {
      if (!app.isPackaged) console.log(`Event server listening on http://${LOCAL_WIRE_HOST}:${port}${LOCAL_WIRE_PATHS.events}`)
    },
  })

  listenHooks.onHandle?.(handle)

  return server
}
