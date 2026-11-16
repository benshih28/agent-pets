import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import {
  createPresentationMcpServer,
  PRESENTATION_CLIENT_HEADER,
  PRESENTATION_TOKEN_HEADER,
} from '../electron/presentation-mcp.ts'
import { PresentationController } from '../electron/presentation-controller.ts'
import type { PresentationIntentResult, PresentationStatusSnapshot } from '../src/types/presentation.ts'

type PresentationStatusResponse = PresentationStatusSnapshot & { queueDepth: number }

function startServer(t: test.TestContext) {
  const controller = new PresentationController({
    emit: () => {},
    getStatus: () => ({ activePets: [], dnd: false, enabled: true }),
    getBlockReason: () => null,
    createId: () => 'intent-test-1234',
  })
  const server = createPresentationMcpServer({ token: 'a'.repeat(64), controller })
  t.after(() => server.close())
  return new Promise<{ port: number; controller: PresentationController }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('server did not bind'))
      resolve({ port: address.port, controller })
    })
  })
}

function call<T = unknown>(port: number, options: {
  method: string
  path: string
  token?: string
  client?: string
  origin?: string
  body?: unknown
}): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const serialized = options.body === undefined ? '' : JSON.stringify(options.body)
    const req = request({
      hostname: '127.0.0.1',
      port,
      method: options.method,
      path: options.path,
      headers: {
        ...(options.token ? { [PRESENTATION_TOKEN_HEADER]: options.token } : {}),
        ...(options.client ? { [PRESENTATION_CLIENT_HEADER]: options.client } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(serialized ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(serialized),
        } : {}),
      },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} })
      })
    })
    req.on('error', reject)
    if (serialized) req.write(serialized)
    req.end()
  })
}

test('presentation MCP is token-authenticated and browser-origin resistant', async t => {
  const { port } = await startServer(t)
  const token = 'a'.repeat(64)
  assert.equal((await call(port, { method: 'GET', path: '/v1/presentation/status' })).status, 401)
  assert.equal((await call(port, { method: 'GET', path: '/v1/presentation/status', token, origin: 'https://evil.test' })).status, 403)
  const status = await call<PresentationStatusResponse>(port, { method: 'GET', path: '/v1/presentation/status', token })
  assert.equal(status.status, 200)
  assert.equal(status.body.queueDepth, 0)
})

test('presentation MCP exposes only bounded intent routes and disconnect cleanup', async t => {
  const { port, controller } = await startServer(t)
  const token = 'a'.repeat(64)
  const client = 'client-mcp-1234'
  const badMethod = await call(port, {
    method: 'POST',
    path: '/v1/presentation/status',
    token,
    body: {},
  })
  assert.equal(badMethod.status, 405)
  const intent = await call<PresentationIntentResult>(port, {
    method: 'POST',
    path: '/v1/presentation/intents',
    token,
    client,
    body: { kind: 'say', message: '<b>Hello</b>', ttlMs: 1_000 },
  })
  assert.equal(intent.status, 200)
  assert.equal(intent.body.accepted, true)
  assert.equal(controller.getQueueDepth(), 1)
  const disconnected = await call(port, {
    method: 'POST',
    path: '/v1/presentation/disconnect',
    token,
    client,
    body: {},
  })
  assert.deepEqual(disconnected.body, { removed: 1 })
  assert.equal(controller.getQueueDepth(), 0)
  const commandRoute = await call(port, {
    method: 'POST',
    path: '/v1/presentation/execute',
    token,
    client,
    body: { command: 'whoami' },
  })
  assert.equal(commandRoute.status, 404)
})

// presentation-mcp.mjs 把錯誤 body 的 `error` 字串當成工具錯誤訊息，所以這些字串是 client 可見的契約。
test('presentation MCP body and auth failures keep their status codes and error strings', async t => {
  const { port } = await startServer(t)
  const token = 'a'.repeat(64)
  const base = `http://127.0.0.1:${port}`
  const headers = {
    [PRESENTATION_TOKEN_HEADER]: token,
    [PRESENTATION_CLIENT_HEADER]: 'client-errors',
    'content-type': 'application/json',
  }
  const expectError = async (response: Response, status: number, error: string) => {
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  }
  const intents = `${base}/v1/presentation/intents`
  await expectError(await fetch(intents, { method: 'POST', headers, body: JSON.stringify({ pad: 'x'.repeat(17 * 1024) }) }), 413, 'request_too_large')
  await expectError(await fetch(intents, { method: 'POST', headers, body: '{not json' }), 400, 'invalid_json')
  await expectError(await fetch(intents, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' }), 415, 'application/json required')
  await expectError(await fetch(intents, { method: 'POST', headers: { ...headers, [PRESENTATION_TOKEN_HEADER]: 'a' }, body: '{}' }), 401, 'unauthorized')
  await expectError(await fetch(intents, { method: 'POST', headers: { ...headers, [PRESENTATION_TOKEN_HEADER]: 'b'.repeat(64) }, body: '{}' }), 401, 'unauthorized')
  const wrongMethod = await fetch(intents, { method: 'PUT', headers, body: '{}' })
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
  await expectError(wrongMethod, 405, 'method_not_allowed')

  // 空 body 視為 `{}`：沒有 client header 的 intent 是 client_id_required，disconnect 照常回 removed。
  const { [PRESENTATION_CLIENT_HEADER]: _client, ...withoutClient } = headers
  await expectError(await fetch(intents, { method: 'POST', headers: withoutClient }), 400, 'client_id_required')
  const disconnect = await fetch(`${base}/v1/presentation/disconnect`, { method: 'POST', headers })
  assert.equal(disconnect.status, 200)
  assert.deepEqual(await disconnect.json(), { removed: 0 })
})
