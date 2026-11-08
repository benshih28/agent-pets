import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { timingSafeEqual } from 'node:crypto'
import type { AgentStatusEvent } from '../src/types/agent'
import { createOrderedBatchCoalescer } from './ipc/broadcast-coalescer.ts'
import { createEventRateLimiter } from './event-rate-limit.ts'
import { eventPipelineStats } from './event-stats.ts'
import { listenOnLocalPort, type LocalServerListenHandle, type LocalServerListenOptions } from './local-server-listen.ts'
import { AGENT_PETS_SERVER_HEADER } from './main/server-health.ts'
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
  listenHooks: Pick<LocalServerListenOptions, 'onStatus' | 'onPersistentFailure'> & { onHandle?: (handle: LocalServerListenHandle) => void; port?: number } = {},
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
      try { window.webContents.send('agent-status-event', events) } catch (error) {
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

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Lets a second Agent Pets instance recognise this port owner without a token.
    response.setHeader(AGENT_PETS_SERVER_HEADER, 'event')
    if (request.method !== 'POST' || request.url !== '/v1/events') {
      response.writeHead(404)
      response.end()
      return
    }

    // CLI hooks do not send Origin. Reject browser-originated requests so an
    // arbitrary website cannot spoof agent state through the loopback server.
    if (request.headers.origin) {
      response.writeHead(403)
      response.end(JSON.stringify({ error: 'browser origins are not allowed' }))
      return
    }

    const suppliedToken = request.headers['x-agent-pets-token']
    const supplied = typeof suppliedToken === 'string' ? Buffer.from(suppliedToken) : Buffer.alloc(0)
    const expected = Buffer.from(eventToken)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401)
      response.end(JSON.stringify({ error: 'unauthorized' }))
      request.resume()
      return
    }

    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      response.writeHead(415)
      response.end(JSON.stringify({ error: 'application/json required' }))
      return
    }

    if (!limiter.allowRequest()) {
      eventPipelineStats.rateLimited += 1
      response.writeHead(429, { 'retry-after': '10' })
      response.end(JSON.stringify({ error: 'too many events' }))
      request.resume()
      return
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    let bodyRejected = false

    request.on('data', (chunk: Buffer) => {
      if (bodyRejected) return
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        bodyRejected = true
        response.writeHead(413)
        response.end(JSON.stringify({ error: 'request too large' }))
        return
      }
      chunks.push(chunk)
    })

    request.on('end', async () => {
      if (bodyRejected) return

      let event: AgentStatusEvent
      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(chunks).toString('utf8')
        )
        const normalized = await normalizeEvent(parsed, Date.now())
        if (!normalized.ok) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: normalized.error }))
          return
        }
        event = normalized.event
      } catch {
        response.writeHead(400)
        response.end(JSON.stringify({ error: 'invalid JSON' }))
        return
      }

      // Budgets are per source session, with a separate one for terminal
      // events, so one runaway hook cannot starve other agents' completions.
      if (!limiter.allowEvent(`${event.source}:${event.sessionId}`, TERMINAL_STATES.has(event.state))) {
        eventPipelineStats.rateLimited += 1
        response.writeHead(429, { 'retry-after': '10' })
        response.end(JSON.stringify({ error: 'too many events' }))
        return
      }

      try {
        for (const win of getWindows()) enqueueAgentEvent({ window: win, event })
      } catch (error) {
        console.error('Event dispatch failed', error)
      }

      // Acknowledge first: the hook must never wait on synchronous SQLite work.
      response.writeHead(204)
      response.end()

      // Side effects (notifications, XP, history) run right after the response
      // is flushed. setImmediate keeps arrival order, and a failure here is our
      // bug, not the caller's, so it is logged rather than surfaced.
      setImmediate(() => {
        try {
          onEvent?.(event)
        } catch (error) {
          console.error('Event handler failed', error)
        }
      })
    })
  })

  // 本機 hook 的請求都很小；縮短逾時，避免慢速連線長時間佔用 socket。
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000

  const port = listenHooks.port ?? 17373
  const handle = listenOnLocalPort(server, port, {
    label: 'Event',
    onStatus: listenHooks.onStatus,
    onPersistentFailure: listenHooks.onPersistentFailure,
    onListening: () => {
      if (!app.isPackaged) console.log(`Event server listening on http://127.0.0.1:${port}/v1/events`)
    },
  })

  listenHooks.onHandle?.(handle)

  return server
}
