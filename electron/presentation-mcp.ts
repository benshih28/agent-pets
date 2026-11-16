import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { PresentationController } from './presentation-controller.ts'
import { hasJsonContentType, readBoundedJson, sendJson, tokenMatches } from './loopback-http.ts'
import { LOCAL_WIRE_HEADERS, LOCAL_WIRE_PATHS } from '../src/types/local-wire.ts'

export const PRESENTATION_TOKEN_HEADER = LOCAL_WIRE_HEADERS.presentationToken
export const PRESENTATION_CLIENT_HEADER = LOCAL_WIRE_HEADERS.presentationClient
const STATUS_PATH = LOCAL_WIRE_PATHS.presentationStatus
const INTENTS_PATH = LOCAL_WIRE_PATHS.presentationIntents
const DISCONNECT_PATH = LOCAL_WIRE_PATHS.presentationDisconnect
const ALLOWED_PATHS: ReadonlySet<string> = new Set([STATUS_PATH, INTENTS_PATH, DISCONNECT_PATH])
const MAX_BODY_BYTES = 16 * 1024
const MAX_REQUESTS_PER_WINDOW = 60
const RATE_WINDOW_MS = 10_000

interface PresentationMcpServerOptions {
  token: string
  controller: PresentationController
}

function readClientId(request: IncomingMessage): string | null {
  const value = request.headers[PRESENTATION_CLIENT_HEADER]
  return typeof value === 'string' ? value : null
}

function isAllowedPath(request: IncomingMessage): boolean {
  return request.url !== undefined && ALLOWED_PATHS.has(request.url)
}

export function createPresentationMcpServer(options: PresentationMcpServerOptions): Server {
  const expectedToken = Buffer.from(options.token)
  let rateWindowStartedAt = Date.now()
  let requestsInWindow = 0

  const server = createServer(async (request, response) => {
    if (!isAllowedPath(request)) {
      sendJson(response, 404, { error: 'not_found' })
      return
    }
    if (request.headers.origin) {
      sendJson(response, 403, { error: 'browser origins are not allowed' })
      return
    }
    if (!tokenMatches(request.headers[PRESENTATION_TOKEN_HEADER], expectedToken)) {
      sendJson(response, 401, { error: 'unauthorized' })
      request.resume()
      return
    }

    const now = Date.now()
    if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
      rateWindowStartedAt = now
      requestsInWindow = 0
    }
    requestsInWindow += 1
    if (requestsInWindow > MAX_REQUESTS_PER_WINDOW) {
      sendJson(response, 429, { error: 'too_many_requests' }, { 'retry-after': '10' })
      request.resume()
      return
    }

    if (request.url === STATUS_PATH) {
      if (request.method === 'GET') {
        sendJson(response, 200, {
          ...options.controller.getStatus(),
          queueDepth: options.controller.getQueueDepth(),
        })
        return
      }
      sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' })
      request.resume()
      return
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'POST' })
      return
    }
    if (!hasJsonContentType(request)) {
      sendJson(response, 415, { error: 'application/json required' })
      request.resume()
      return
    }

    // 錯誤字串是既有契約：presentation-mcp.mjs 把 body 的 error 當成工具錯誤訊息，所以保留
    // `request_too_large`／`invalid_json`，不與 event server 的字串統一。空 body 視為 `{}`。
    const read = await readBoundedJson(request, MAX_BODY_BYTES)
    let body: unknown = {}
    if (read.ok) {
      body = read.value
    } else {
      switch (read.reason) {
        case 'too_large':
          sendJson(response, 413, { error: 'request_too_large' })
          return
        case 'invalid_json':
          sendJson(response, 400, { error: 'invalid_json' })
          return
        case 'aborted':
          return
        case 'empty':
          break
      }
    }

    const clientId = readClientId(request)
    if (request.url === DISCONNECT_PATH) {
      sendJson(response, 200, {
        removed: clientId ? options.controller.disconnectClient(clientId) : 0,
      })
      return
    }
    if (request.url !== INTENTS_PATH || !clientId) {
      sendJson(response, 400, { error: 'client_id_required' })
      return
    }
    sendJson(response, 200, options.controller.submit(clientId, body))
  })

  return server
}
