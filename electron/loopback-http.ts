// 這裡只做機制；路由、大小上限、rate limit、授權與錯誤字串都是各 server 的政策（錯誤字串是既有 client 讀得到的契約）。

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

export const JSON_RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const satisfies OutgoingHttpHeaders)

// 長度不同時提早返回會洩漏長度，這是既有作法（token 長度固定、公開於格式）。
export function tokenMatches(supplied: IncomingHttpHeaders[string], expected: Buffer): boolean {
  if (typeof supplied !== 'string') return false
  const actual = Buffer.from(supplied)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function hasJsonContentType(request: IncomingMessage): boolean {
  return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

export function sendJson(response: ServerResponse, status: number, value: unknown, headers?: OutgoingHttpHeaders): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    ...JSON_RESPONSE_HEADERS,
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

export type BoundedJsonFailure =
  | 'too_large'
  /** 是否接受空 body 由各 server 決定。 */
  | 'empty'
  | 'invalid_json'
  | 'aborted'

export type BoundedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: BoundedJsonFailure }

export function readBoundedJson(request: IncomingMessage, maxBytes: number): Promise<BoundedJsonResult> {
  return new Promise(resolve => {
    const declared = request.headers['content-length']
    // Node 的 HTTP parser 已拒絕非數字的 content-length；`!(x <= max)` 也把 NaN 當成超過。
    if (declared !== undefined && !(Number(declared) <= maxBytes)) {
      request.resume()
      resolve({ ok: false, reason: 'too_large' })
      return
    }

    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (result: BoundedJsonResult) => {
      if (settled) return
      settled = true
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onAbort)
      request.off('close', onAbort)
      resolve(result)
    }
    const onData = (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        chunks.length = 0
        finish({ ok: false, reason: 'too_large' })
        // 拿掉 data listener 後串流會暫停；resume 讓剩餘資料被讀掉丟棄，回應才送得出去。
        request.resume()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (total === 0) {
        finish({ ok: false, reason: 'empty' })
        return
      }
      const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total)
      let value: unknown
      try {
        value = JSON.parse(body.toString('utf8'))
      } catch {
        finish({ ok: false, reason: 'invalid_json' })
        return
      }
      finish({ ok: true, value })
    }
    const onAbort = () => finish({ ok: false, reason: 'aborted' })

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onAbort)
    request.on('close', onAbort)
  })
}
