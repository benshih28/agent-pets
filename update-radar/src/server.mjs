import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { MAX_FEED_BYTES } from './config.mjs'

const STATIC_ROUTES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/thread-groups.js': ['thread-groups.js', 'text/javascript; charset=utf-8'],
  '/update-insights.js': ['update-insights.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
})

const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
})

function sendText(response, statusCode, body, method = 'GET') {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  if (method === 'HEAD') response.end()
  else response.end(body)
}

async function sendFile(response, method, path, contentType, maxBytes = Number.POSITIVE_INFINITY) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return sendText(response, 404, 'Not found', method)
    if (info.size > maxBytes) return sendText(response, 413, 'Payload too large', method)
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': contentType,
      'content-length': info.size,
    })
    if (method === 'HEAD') return response.end()
    createReadStream(path).on('error', () => response.destroy()).pipe(response)
  } catch {
    sendText(response, 404, 'Not found', method)
  }
}

export function resolveRadarRoute(method = 'GET', requestUrl = '/') {
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, kind: 'method' }
  let pathname
  try {
    pathname = new URL(requestUrl, 'http://127.0.0.1').pathname
  } catch {
    return { status: 400, kind: 'bad-request' }
  }
  if (pathname === '/healthz') return { status: 200, kind: 'health' }
  if (pathname === '/feed.json') return { status: 200, kind: 'feed' }
  const staticRoute = STATIC_ROUTES[pathname]
  return staticRoute
    ? { status: 200, kind: 'static', staticRoute }
    : { status: 404, kind: 'not-found' }
}

export function createRadarServer(options) {
  return createServer(async (request, response) => {
    const method = request.method ?? 'GET'
    const route = resolveRadarRoute(method, request.url ?? '/')
    if (route.kind === 'method') {
      response.setHeader('allow', 'GET, HEAD')
      return sendText(response, 405, 'Method not allowed', method)
    }
    if (route.kind === 'bad-request') return sendText(response, 400, 'Bad request', method)
    if (route.kind === 'not-found') return sendText(response, 404, 'Not found', method)
    if (route.kind === 'health') return sendText(response, 200, 'ok', method)
    if (route.kind === 'feed') {
      return sendFile(response, method, options.feedPath, 'application/json; charset=utf-8', MAX_FEED_BYTES)
    }
    return sendFile(response, method, join(options.publicDirectory, route.staticRoute[0]), route.staticRoute[1])
  })
}

export async function listenOnLoopback(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server.address()
}
