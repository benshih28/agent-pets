// --- Loopback HTTP server 的共用底層步驟 ---------------------------------------------
// event、permission、presentation 三個本機 server 共用的 token 比對、JSON content-type 檢查、
// 限制大小的 body 讀取與 JSON 回應。這裡只做機制；路由、大小上限、rate limit、method
// allowlist、授權與錯誤字串都是各 server 的政策（錯誤字串是既有 client 讀得到的契約，
// 各自保留）。不 import electron，Node 測試可以直接載入。

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/** JSON 回應一律帶的 header：不快取、不讓瀏覽器猜型別。 */
export const JSON_RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const satisfies OutgoingHttpHeaders)

/**
 * 以固定時間比對 header 帶來的 token。缺少、重複（陣列）或長度不同直接回 false；
 * 長度不同時提早返回會洩漏長度，這是三個 server 一直以來的作法（token 長度固定、公開於格式）。
 * `expected` 由呼叫端在建立 server 時先轉成 Buffer，熱路徑上不再重複配置。
 */
export function tokenMatches(supplied: IncomingHttpHeaders[string], expected: Buffer): boolean {
  if (typeof supplied !== 'string') return false
  const actual = Buffer.from(supplied)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** `content-type` 的 media type（忽略參數與大小寫）是否為 `application/json`。 */
export function hasJsonContentType(request: IncomingMessage): boolean {
  return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

/** 寫出 JSON 回應（帶 `JSON_RESPONSE_HEADERS` 與正確的 content-length）；`headers` 可補 `retry-after`、`allow` 等。 */
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
  /** 宣告的 content-length 或實際收到的位元組超過上限；剩餘的 body 會被讀掉丟棄。 */
  | 'too_large'
  /** 沒有任何位元組。是否接受空 body 由各 server 決定。 */
  | 'empty'
  | 'invalid_json'
  /** 連線在 body 讀完之前中斷；通常已無法回應。 */
  | 'aborted'

export type BoundedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: BoundedJsonFailure }

/**
 * 讀取最多 `maxBytes` 位元組的 body 並解析成 JSON。宣告的 content-length 超過上限時不讀 body
 * 直接回 `too_large`；串流中超過上限時立刻回 `too_large` 並停止累積。兩種情況都讓請求繼續流動
 * 並丟棄剩餘資料，讓呼叫端寫得出錯誤回應。只用非同步串流事件，不做任何同步 I/O。
 */
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
      // 單一 chunk（常見情況）直接使用；多個 chunk 已知總長，一次配置。
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
