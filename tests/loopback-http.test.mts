import assert from 'node:assert/strict'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import test from 'node:test'
import {
  JSON_RESPONSE_HEADERS,
  hasJsonContentType,
  readBoundedJson,
  sendJson,
  tokenMatches,
  type BoundedJsonResult,
} from '../electron/loopback-http.ts'

const LIMIT = 1024

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** 每個請求的 body 交給 readBoundedJson，結果以 200 JSON 回傳，並另外記下給測試檢查。 */
function startReader(t: test.TestContext, limit = LIMIT) {
  const results: BoundedJsonResult[] = []
  const server: Server = createServer(async (incoming, response) => {
    const result = await readBoundedJson(incoming, limit)
    results.push(result)
    if (result.ok || result.reason !== 'aborted') sendJson(response, 200, result)
  })
  t.after(() => server.close())
  return new Promise<{ port: number; results: BoundedJsonResult[] }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('server did not bind'))
      resolve({ port: address.port, results })
    })
  })
}

/** `chunks` 逐段寫出（每段等寫入完成再送下一段），不帶 content-length 時走 chunked 編碼。 */
function post(port: number, chunks: readonly string[], declaredLength?: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      agent: false,
      headers: declaredLength === undefined ? {} : { 'content-length': declaredLength },
    }, response => {
      const parts: Buffer[] = []
      response.on('data', (chunk: Buffer) => parts.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(parts).toString('utf8'),
      }))
    })
    req.on('error', reject)
    let index = 0
    const next = () => {
      if (index >= chunks.length) {
        req.end()
        return
      }
      // 段與段之間稍等：回應送出後 Node 會關閉仍在上傳的連線，連續狂寫的 client 可能先收到 ECONNRESET。
      req.write(chunks[index++], () => setTimeout(next, 5))
    }
    next()
  })
}

/**
 * 給超過上限的請求用：server 回應並結束後，Node 會關閉仍在上傳的連線，負載下 client 可能在讀到
 * 回應前就收到 ECONNRESET／EPIPE。所以收到回應標頭就停止寫入，連線錯誤只記下不 reject；
 * 判定以 server 端 readBoundedJson 的結果為準，收到的回應只做附帶檢查。
 */
function postOversize(port: number, chunks: readonly string[], declaredLength?: number): Promise<{ reply?: Reply; error?: string }> {
  return new Promise(resolve => {
    let settled = false
    let responded = false
    const settle = (value: { reply?: Reply; error?: string }) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      agent: false,
      headers: declaredLength === undefined ? {} : { 'content-length': declaredLength },
    }, response => {
      responded = true
      const parts: Buffer[] = []
      response.on('data', (chunk: Buffer) => parts.push(chunk))
      response.on('end', () => settle({ reply: { status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts).toString('utf8') } }))
      response.on('error', error => settle({ error: (error as NodeJS.ErrnoException).code ?? error.message }))
    })
    req.on('error', error => settle({ error: (error as NodeJS.ErrnoException).code ?? error.message }))
    let index = 0
    const next = () => {
      if (responded || settled) return
      if (index >= chunks.length) {
        req.end()
        return
      }
      req.write(chunks[index++], () => setTimeout(next, 5))
    }
    next()
  })
}

/** server 端結果可能比 client 的連線錯誤晚一點到，短暫等待到第 `count` 筆。 */
async function waitForResults(results: readonly BoundedJsonResult[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && results.length < count; attempt += 1) await new Promise(r => setTimeout(r, 10))
}

const TOO_LARGE: BoundedJsonResult = { ok: false, reason: 'too_large' }

/** 收到回應時，它必須就是 server 端的 too_large 結果；連線錯誤只允許重設類。 */
function assertOversizeOutcome(outcome: { reply?: Reply; error?: string }): void {
  if (outcome.reply) {
    assert.equal(outcome.reply.status, 200)
    assert.deepEqual(JSON.parse(outcome.reply.body), TOO_LARGE)
  } else {
    assert.ok(outcome.error === 'ECONNRESET' || outcome.error === 'EPIPE', `unexpected client error ${outcome.error}`)
  }
}

const parsed = (reply: Reply) => JSON.parse(reply.body) as BoundedJsonResult

test('a JSON body split across many chunks is reassembled and parsed', async t => {
  const { port } = await startReader(t)
  const value = { text: '多位元組的中文 ✓', items: [1, 2, 3] }
  const serialized = JSON.stringify(value)
  // 切在任意位元組位置（包含 UTF-8 字元中間），組合後仍要正確解碼。
  const bytes = Buffer.from(serialized)
  let pieceCount = 0
  const reply = await new Promise<Reply>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', agent: false }, response => {
      const parts: Buffer[] = []
      response.on('data', (chunk: Buffer) => parts.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts).toString('utf8') }))
    })
    req.on('error', reject)
    let offset = 0
    const next = () => {
      if (offset >= bytes.length) {
        req.end()
        return
      }
      const piece = bytes.subarray(offset, offset + 5)
      offset += 5
      pieceCount += 1
      req.write(piece, () => setImmediate(next))
    }
    next()
  })
  assert.ok(pieceCount > 3)
  assert.deepEqual(parsed(reply), { ok: true, value })
})

test('a single-chunk body with an accurate content-length is parsed', async t => {
  const { port } = await startReader(t)
  const body = '{"a":1}'
  assert.deepEqual(parsed(await post(port, [body], Buffer.byteLength(body))), { ok: true, value: { a: 1 } })
})

test('a body of exactly the limit is accepted and one byte more is too large', async t => {
  const { port, results } = await startReader(t)
  const atLimit = `"${'x'.repeat(LIMIT - 2)}"`
  assert.equal(Buffer.byteLength(atLimit), LIMIT)
  assert.deepEqual(parsed(await post(port, [atLimit.slice(0, 300), atLimit.slice(300)])), { ok: true, value: 'x'.repeat(LIMIT - 2) })
  const overLimit = `"${'x'.repeat(LIMIT - 1)}"`
  assertOversizeOutcome(await postOversize(port, [overLimit.slice(0, 300), overLimit.slice(300)]))
  await waitForResults(results, 2)
  assert.deepEqual(results[1], TOO_LARGE)
})

test('a streamed body over the limit is rejected as soon as it crosses, and the rest is drained', async t => {
  const { port, results } = await startReader(t)
  const chunk = 'x'.repeat(400)
  // 第三段就超過；後面還有很多段。server 端只結算一次 too_large，之後的資料被丟棄而不是累積。
  assertOversizeOutcome(await postOversize(port, Array.from({ length: 20 }, () => chunk)))
  await waitForResults(results, 1)
  assert.deepEqual(results, [TOO_LARGE])
})

test('a declared content-length over the limit is rejected without buffering the body', async t => {
  const { port, results } = await startReader(t)
  const body = 'x'.repeat(LIMIT + 1)
  assertOversizeOutcome(await postOversize(port, [body], Buffer.byteLength(body)))
  await waitForResults(results, 1)
  assert.deepEqual(results, [TOO_LARGE])
})

test('an empty body is reported as empty, with or without content-length: 0', async t => {
  const { port } = await startReader(t)
  assert.deepEqual(parsed(await post(port, [])), { ok: false, reason: 'empty' })
  assert.deepEqual(parsed(await post(port, [], 0)), { ok: false, reason: 'empty' })
})

test('malformed or whitespace-only JSON is invalid_json', async t => {
  const { port } = await startReader(t)
  assert.deepEqual(parsed(await post(port, ['{not', ' json'])), { ok: false, reason: 'invalid_json' })
  assert.deepEqual(parsed(await post(port, ['   '])), { ok: false, reason: 'invalid_json' })
})

test('a client that disconnects mid-body settles the read as aborted', async t => {
  const { port, results } = await startReader(t)
  await new Promise<void>(resolve => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', agent: false, headers: { 'content-length': 500 } })
    req.on('error', () => resolve())
    req.write('{"partial":', () => setTimeout(() => req.destroy(), 20))
  })
  for (let attempt = 0; attempt < 50 && results.length === 0; attempt += 1) await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(results, [{ ok: false, reason: 'aborted' }])
})

test('tokenMatches accepts only the exact token string', () => {
  const expected = Buffer.from('a'.repeat(64))
  assert.equal(tokenMatches('a'.repeat(64), expected), true)
  assert.equal(tokenMatches('b'.repeat(64), expected), false, 'same length, wrong value')
  assert.equal(tokenMatches(`${'a'.repeat(63)}b`, expected), false, 'last byte differs')
  assert.equal(tokenMatches('a'.repeat(63), expected), false, 'shorter')
  assert.equal(tokenMatches('a'.repeat(65), expected), false, 'longer')
  assert.equal(tokenMatches('', expected), false, 'empty')
  assert.equal(tokenMatches(undefined, expected), false, 'missing')
  assert.equal(tokenMatches(['a'.repeat(64)], expected), false, 'repeated header arrives as an array')
  // 多位元組字元：字元數相同但位元組數不同，不可因長度比較而誤判或拋錯。
  assert.equal(tokenMatches('é'.repeat(32), expected), false)
})

test('hasJsonContentType ignores parameters and case, and nothing else', () => {
  const withType = (value: string | undefined) => ({ headers: value === undefined ? {} : { 'content-type': value } }) as IncomingMessage
  assert.equal(hasJsonContentType(withType('application/json')), true)
  assert.equal(hasJsonContentType(withType('Application/JSON; charset=utf-8')), true)
  assert.equal(hasJsonContentType(withType('  application/json  ;x=y')), true)
  assert.equal(hasJsonContentType(withType('text/plain')), false)
  assert.equal(hasJsonContentType(withType('application/json-patch+json')), false)
  assert.equal(hasJsonContentType(withType(undefined)), false)
})

test('sendJson writes the security headers, an exact content-length and extra headers', async t => {
  const server = createServer((_incoming, response) => {
    sendJson(response, 429, { error: '太多' }, { 'retry-after': '10' })
  })
  t.after(() => server.close())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const reply = await post(address.port, [])
  assert.equal(reply.status, 429)
  assert.deepEqual(JSON.parse(reply.body), { error: '太多' })
  for (const [name, value] of Object.entries(JSON_RESPONSE_HEADERS)) assert.equal(reply.headers[name], value)
  assert.equal(reply.headers['content-length'], String(Buffer.byteLength(reply.body)))
  assert.equal(reply.headers['retry-after'], '10')
})
