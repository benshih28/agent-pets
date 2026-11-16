import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { AGENT_PETS_SERVER_HEADER, probePortOccupant } from '../electron/main/server-health.ts'

// 埠被佔用時用來分辨「另一個 Agent Pets」與「別的程式」；探測只送 GET，不帶任何 token。

function listen(headers: Record<string, string>, seen?: Array<Record<string, unknown>>): Promise<Server> {
  const server = createServer((request, response) => {
    seen?.push({ method: request.method, headers: request.headers })
    response.writeHead(405, headers)
    response.end()
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const portOf = (server: Server) => (server.address() as AddressInfo).port
const close = (server: Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })

test('a port answered with the Agent Pets server header is reported as agent-pets, without sending a token', async () => {
  const seen: Array<Record<string, unknown>> = []
  const server = await listen({ [AGENT_PETS_SERVER_HEADER]: '1' }, seen)
  try {
    assert.equal(await probePortOccupant(portOf(server)), 'agent-pets')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].method, 'GET')
    const headers = Object.keys(seen[0].headers as object)
    assert.ok(!headers.some(name => /token|authorization/i.test(name)), `probe sent ${headers.join(', ')}`)
  } finally {
    await close(server)
  }
})

test('any other HTTP server on the port is reported as other', async () => {
  const server = await listen({})
  try {
    assert.equal(await probePortOccupant(portOf(server)), 'other')
  } finally {
    await close(server)
  }
})

test('a closed port and a silent listener are both reported as unknown', async () => {
  const server = await listen({})
  const port = portOf(server)
  await close(server)
  assert.equal(await probePortOccupant(port), 'unknown')

  const silent = createServer(() => { /* 接了連線但永遠不回應 */ })
  await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', () => resolve()))
  try {
    assert.equal(await probePortOccupant(portOf(silent), 100), 'unknown')
  } finally {
    await close(silent)
  }
})
