import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Server } from 'node:net'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { LOCAL_SERVER_PERSISTENT_FAILURE_ATTEMPTS, LOCAL_SERVER_RETRY_DELAYS_MS, listenOnLocalPort } from '../electron/local-server-listen.ts'
import { createServerHealthTracker } from '../electron/main/server-health.ts'

function occupyPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()))

test('local server keeps retrying a busy port and binds once it is released', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const blocker = await occupyPort()
  const port = (blocker.address() as AddressInfo).port
  const messages: string[] = []
  let listened = 0
  const server = createServer()
  listenOnLocalPort(server, port, {
    label: 'Test',
    onListening: () => { listened += 1 },
    logError: message => messages.push(message),
  })
  await new Promise(resolve => server.once('error', resolve))
  assert.equal(server.listening, false)
  assert.deepEqual(messages, [`Test port ${port} is already in use; retrying until it is free.`])

  // 第一次重試時埠仍被佔用：不重複記錄，退避時間往下一階走。
  t.mock.timers.tick(LOCAL_SERVER_RETRY_DELAYS_MS[0])
  await new Promise(resolve => server.once('error', resolve))
  assert.equal(messages.length, 1)

  await close(blocker)
  const listening = new Promise(resolve => server.once('listening', resolve))
  t.mock.timers.tick(LOCAL_SERVER_RETRY_DELAYS_MS[1])
  await listening
  assert.equal(server.listening, true)
  assert.equal(listened, 1)
  assert.equal(messages.at(-1), `Test port ${port} is free again; listening.`)
  await close(server)
})

test('closing a server that never bound stops further retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const blocker = await occupyPort()
  const port = (blocker.address() as AddressInfo).port
  const server = createServer()
  let listened = 0
  listenOnLocalPort(server, port, { label: 'Test', onListening: () => { listened += 1 }, logError: () => {} })
  await new Promise(resolve => server.once('error', resolve))
  server.close()
  await close(blocker)
  t.mock.timers.tick(LOCAL_SERVER_RETRY_DELAYS_MS.at(-1)! * 2)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(server.listening, false)
  assert.equal(listened, 0)
})

test('non-address errors are reported instead of crashing the process', () => {
  const server = createServer()
  const messages: string[] = []
  listenOnLocalPort(server, 0, { label: 'Test', logError: message => messages.push(message) })
  server.emit('error', Object.assign(new Error('boom'), { code: 'EACCES' }))
  assert.deepEqual(messages, ['Test server error:'])
  server.close()
})

function fakeServerStub() {
  const server = Object.assign(new EventEmitter(), {
    listening: false,
    listenCalls: 0,
    listen() { this.listenCalls += 1; return this },
  })
  return server
}
const errno = (code: string) => Object.assign(new Error(code), { code })

test('EADDRINUSE retries, reports status, and notifies once after the budget', () => {
  const server = fakeServerStub()
  const statuses: string[] = []
  let persistent = 0
  const handle = listenOnLocalPort(server as never, 1, {
    label: 't', logError: () => {},
    onStatus: s => statuses.push(`${s.state}:${s.attempt}`),
    onPersistentFailure: () => { persistent += 1 },
  })
  for (let i = 0; i < LOCAL_SERVER_PERSISTENT_FAILURE_ATTEMPTS + 2; i += 1) server.emit('error', errno('EADDRINUSE'))
  assert.equal(persistent, 1)
  assert.equal(handle.status().state, 'retrying')
  handle.retryNow()
  assert.equal(server.listenCalls, 2)
  server.emit('listening')
  assert.equal(handle.status().state, 'listening')
  assert.equal(statuses.at(-1), 'listening:0')
})

test('EACCES does not retry but is still reported', () => {
  const server = fakeServerStub()
  let persistent: string | undefined
  const handle = listenOnLocalPort(server as never, 1, {
    label: 't', logError: () => {}, onPersistentFailure: s => { persistent = s.code },
  })
  server.emit('error', errno('EACCES'))
  assert.equal(persistent, 'EACCES')
  assert.equal(handle.status().state, 'failed')
  assert.equal(server.listenCalls, 1)
})

test('health tracker aggregates status, probes the occupant and supports retry', async () => {
  const server = fakeServerStub()
  const notices: string[] = []
  const tracker = createServerHealthTracker({
    onPersistentFailure: h => notices.push(h.id),
    probe: async () => 'agent-pets',
  })
  const hooks = tracker.register('event', 17373)
  const handle = listenOnLocalPort(server as never, 17373, { label: 't', logError: () => {}, ...hooks })
  hooks.attach(handle)
  for (let i = 0; i < 3; i += 1) server.emit('error', errno('EADDRINUSE'))
  await new Promise(resolve => setImmediate(resolve))
  const [entry] = tracker.snapshot().servers
  assert.equal(entry.state, 'retrying')
  assert.equal(entry.occupant, 'agent-pets')
  assert.deepEqual(notices, ['event'])
  tracker.retry('event')
  assert.equal(server.listenCalls, 2)
})
