import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Server } from 'node:net'
import test from 'node:test'
import { LOCAL_SERVER_RETRY_DELAYS_MS, listenOnLocalPort } from '../electron/local-server-listen.ts'

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
