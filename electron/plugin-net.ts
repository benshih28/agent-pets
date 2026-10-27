import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { PluginErrorCode } from '../src/types/plugin.ts'
import { isValidPluginNetworkHost } from './plugin-manifest.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

export const PLUGIN_NET_MAX_REDIRECTS = 3
export const PLUGIN_NET_MAX_REQUEST_BYTES = 256 * 1024
export const PLUGIN_NET_ALLOWED_HEADERS = new Set([
  'accept', 'authorization', 'content-type', 'if-modified-since', 'if-none-match', 'x-api-key',
])
const RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified', 'retry-after'] as const
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])

export interface PluginNetRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PluginNetResponse {
  status: number
  headers: Partial<Record<typeof RESPONSE_HEADERS[number], string>>
  body: string
  isBase64Encoded?: true
}

export interface PluginNetDependencies {
  lookupAll: (host: string) => Promise<Array<{ address: string; family: number }>>
  request: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
}

export interface PluginNetLimits {
  maxResponseBytes: number
  timeoutMs: number
  requestsPerMinute: number
}

export type PluginNetResult = { ok: true; value: PluginNetResponse } | { ok: false; error: PluginErrorCode }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function inIpv4Range(address: string, network: string, prefix: number): boolean {
  const toInteger = (value: string): number => value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (toInteger(address) & mask) === (toInteger(network) & mask)
}

function ipv6ToBigInt(value: string): bigint | null {
  let address = value.toLowerCase().split('%')[0] ?? ''
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const ipv4 = address.slice(lastColon + 1)
    if (isIP(ipv4) !== 4) return null
    const octets = ipv4.split('.').map(Number)
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    address = `${address.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0]!.split(':') : []
  const right = halves[1] ? halves[1]!.split(':') : []
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0
  const words = [...left, ...Array.from({ length: zeros }, () => '0'), ...right]
  if (words.length !== 8 || words.some(word => !/^[a-f0-9]{1,4}$/.test(word))) return null
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n)
}

function ipv6PrefixMatches(address: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix)
  return (address >> shift) === (network >> shift)
}

export function isPluginNetIpBlocked(value: unknown): boolean {
  if (typeof value !== 'string') return true
  const family = isIP(value)
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
      ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
      ['240.0.0.0', 4], ['255.255.255.255', 32],
    ].some(([network, prefix]) => inIpv4Range(value, network as string, prefix as number))
  }
  if (family !== 6) return true
  const address = ipv6ToBigInt(value)
  if (address === null) return true
  if ((address >> 32n) === 0xffffn) {
    const mappedIpv4 = Number(address & 0xffffffffn)
    const octets = [24, 16, 8, 0].map(shift => (mappedIpv4 >>> shift) & 0xff)
    return isPluginNetIpBlocked(octets.join('.'))
  }
  const nat64Prefix = 0x64ff9bn << 96n
  if (ipv6PrefixMatches(address, nat64Prefix, 96)) {
    const embeddedIpv4 = Number(address & 0xffffffffn)
    const octets = [24, 16, 8, 0].map(shift => (embeddedIpv4 >>> shift) & 0xff)
    return isPluginNetIpBlocked(octets.join('.'))
  }
  if (ipv6PrefixMatches(address, 0x2002n << 112n, 16)) {
    const embeddedIpv4 = Number((address >> 80n) & 0xffffffffn)
    const octets = [24, 16, 8, 0].map(shift => (embeddedIpv4 >>> shift) & 0xff)
    return isPluginNetIpBlocked(octets.join('.'))
  }
  const loopback = address === 1n
  const unspecified = address === 0n
  return loopback || unspecified
    || ipv6PrefixMatches(address, 0xfc00n << 112n, 7)
    || ipv6PrefixMatches(address, 0xfe80n << 112n, 10)
    || ipv6PrefixMatches(address, 0xff00n << 112n, 8)
    || ipv6PrefixMatches(address, 0x20010db8n << 96n, 32)
    || ipv6PrefixMatches(address, 0x100n << 112n, 64)
}

export function isPluginNetHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '')
  return allowedHosts.some(candidate => {
    const allowed = candidate.toLowerCase().replace(/\.$/, '')
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2)
      return normalizedHost !== suffix && normalizedHost.endsWith(`.${suffix}`)
    }
    return normalizedHost === allowed
  })
}

export function validatePluginNetUrl(value: unknown, allowedHosts: readonly string[]): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !host || isIP(host) !== 0 || !isPluginNetHostAllowed(host, allowedHosts)) return null
    return url
  } catch {
    return null
  }
}

export async function isPublicPluginNetworkHost(
  host: string,
  lookupAll: PluginNetDependencies['lookupAll'] = async value => lookup(value, { all: true, verbatim: true }),
): Promise<boolean> {
  if (!isValidHostnameForRequest(host)) return false
  try {
    const addresses = await lookupAll(host)
    return addresses.length > 0 && addresses.every(item => !isPluginNetIpBlocked(item.address))
  } catch {
    return false
  }
}

function isValidHostnameForRequest(host: string): boolean {
  if (typeof host !== 'string' || isIP(host) !== 0 || !isValidPluginNetworkHost(host, false)) return false
  try {
    const url = new URL(`https://${host}`)
    return url.hostname === host.toLowerCase() && url.username === '' && url.password === ''
      && !host.includes('*') && host === host.trim() && host.length <= 253
      && host.split('.').length >= 2 && !/[\s/@?#:]/.test(host)
  } catch {
    return false
  }
}

function normalizeRequestOptions(value: unknown): { method: string; headers: Headers; body?: string } | null {
  if (value === undefined) return { method: 'GET', headers: new Headers() }
  if (!isRecord(value) || Object.keys(value).some(key => !['method', 'headers', 'body'].includes(key))) return null
  const method = value.method === undefined ? 'GET' : value.method
  if (typeof method !== 'string' || !METHODS.has(method.toUpperCase())) return null
  const headers = new Headers()
  if (value.headers !== undefined) {
    if (!isRecord(value.headers) || Object.keys(value.headers).length > 20) return null
    for (const [rawName, rawValue] of Object.entries(value.headers)) {
      const name = rawName.toLowerCase()
      if (!PLUGIN_NET_ALLOWED_HEADERS.has(name) || typeof rawValue !== 'string'
        || rawValue.length > 8_192 || /[\r\n\u0000]/.test(rawValue)) return null
      try { headers.set(name, rawValue) } catch { return null }
    }
  }
  if (value.body !== undefined && (typeof value.body !== 'string'
    || Buffer.byteLength(value.body, 'utf8') > PLUGIN_NET_MAX_REQUEST_BYTES)) return null
  if (value.body !== undefined && method.toUpperCase() === 'GET') return null
  return {
    method: method.toUpperCase(),
    headers,
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
  }
}

function parseResponseHeaders(headers: Headers): PluginNetResponse['headers'] {
  const result: PluginNetResponse['headers'] = {}
  for (const key of RESPONSE_HEADERS) {
    const value = headers.get(key)
    if (value !== null) result[key] = value.slice(0, 2_048)
  }
  return result
}

export function stripPluginSetCookieHeaders(
  headers: Record<string, string[] | undefined> | undefined,
): Record<string, string[]> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => name.toLowerCase() !== 'set-cookie' && name.toLowerCase() !== 'set-cookie2')
    .flatMap(([name, values]) => values === undefined ? [] : [[name, [...values]]]))
}

export function filterPluginRequestHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const result = Object.fromEntries(Object.entries(headers ?? {})
    .filter(([name]) => !['accept-language', 'cookie', 'cookie2', 'user-agent'].includes(name.toLowerCase()))
    .flatMap(([name, value]) => value === undefined ? [] : [[name, value]]))
  result['User-Agent'] = 'AgentPetsPlugin/1'
  return result
}

function isTextResponse(contentType: string | undefined): boolean {
  if (!contentType) return false
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return type.startsWith('text/') || /^application\/(json|xml|javascript|x-www-form-urlencoded|graphql)(?:$|\+)/.test(type)
}

async function readResponse(response: Response, maxBytes: number): Promise<PluginNetResponse | PluginErrorCode> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return 'too_large'
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const result = await reader.read()
        if (result.done) break
        length += result.value.byteLength
        if (length > maxBytes) {
          await reader.cancel()
          return 'too_large'
        }
        chunks.push(result.value)
      }
    }
  } catch {
    return 'invalid_request'
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length)
  const contentType = response.headers.get('content-type') ?? undefined
  return {
    status: response.status,
    headers: parseResponseHeaders(response.headers),
    body: isTextResponse(contentType) ? new TextDecoder().decode(bytes) : bytes.toString('base64'),
    ...(!isTextResponse(contentType) ? { isBase64Encoded: true as const } : {}),
  }
}

export class PluginNetworkClient {
  private readonly dependencies: PluginNetDependencies
  private readonly requestTimes = new Map<string, SlidingWindowLimiter>()

  constructor(dependencies: Partial<PluginNetDependencies> = {}) {
    this.dependencies = {
      lookupAll: dependencies.lookupAll ?? (async host => lookup(host, { all: true, verbatim: true })),
      request: dependencies.request ?? (async () => { throw new Error('Plugin network transport unavailable') }),
      now: dependencies.now ?? Date.now,
    }
  }

  async fetch(
    pluginId: string,
    urlValue: unknown,
    optionsValue: unknown,
    allowedHosts: readonly string[],
    limits: PluginNetLimits,
  ): Promise<PluginNetResult> {
    const firstUrl = validatePluginNetUrl(urlValue, allowedHosts)
    if (!firstUrl) return { ok: false, error: 'host_not_allowed' }
    const request = normalizeRequestOptions(optionsValue)
    if (!request) return { ok: false, error: 'invalid_request' }
    if (!Number.isSafeInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1
      || !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1
      || !Number.isSafeInteger(limits.requestsPerMinute) || limits.requestsPerMinute < 1) {
      return { ok: false, error: 'disabled' }
    }
    const now = this.safeNow()
    if (now === null) return { ok: false, error: 'disabled' }
    let limiter = this.requestTimes.get(pluginId)
    if (!limiter) {
      limiter = new SlidingWindowLimiter(60_000, limits.requestsPerMinute)
      this.requestTimes.set(pluginId, limiter)
    }
    if (!limiter.consume(now, limits.requestsPerMinute).allowed) return { ok: false, error: 'rate_limited' }

    let currentUrl = firstUrl
    let headers = new Headers(request.headers)
    const controller = new AbortController()
    let rejectTimeout!: (reason: Error) => void
    const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject })
    const onAbort = () => rejectTimeout(new Error('timeout'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), limits.timeoutMs)
    try {
      for (let redirects = 0; redirects <= PLUGIN_NET_MAX_REDIRECTS; redirects += 1) {
        const validated = validatePluginNetUrl(currentUrl.href, allowedHosts)
        if (!validated) return { ok: false, error: 'host_not_allowed' }
        let addresses: Array<{ address: string; family: number }>
        try { addresses = await Promise.race([this.dependencies.lookupAll(validated.hostname), timeoutPromise]) } catch {
          return { ok: false, error: controller.signal.aborted ? 'timeout' : 'host_not_allowed' }
        }
        if (addresses.length === 0 || addresses.some(item => isPluginNetIpBlocked(item.address))) {
          return { ok: false, error: 'host_not_allowed' }
        }
        let response: Response
        try {
          response = await Promise.race([this.dependencies.request(validated.href, {
            method: request.method,
            headers,
            ...(request.body === undefined ? {} : { body: request.body }),
            redirect: 'manual',
            signal: controller.signal,
          }), timeoutPromise])
        } catch (error) {
          return { ok: false, error: controller.signal.aborted ? 'timeout' : 'invalid_request' }
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          if (!location) return { ok: false, error: 'invalid_request' }
          if (redirects >= PLUGIN_NET_MAX_REDIRECTS) return { ok: false, error: 'too_many_redirects' }
          let nextUrl: URL
          try { nextUrl = new URL(location, validated) } catch { return { ok: false, error: 'host_not_allowed' } }
          if (validated.origin !== nextUrl.origin) {
            headers.delete('authorization')
            headers.delete('x-api-key')
          }
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && request.method === 'POST')) {
            request.method = 'GET'
            delete request.body
          }
          currentUrl = nextUrl
          continue
        }
        const body = await Promise.race([readResponse(response, limits.maxResponseBytes), timeoutPromise])
        return typeof body === 'string' ? { ok: false, error: body } : { ok: true, value: body }
      }
      return { ok: false, error: 'too_many_redirects' }
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  private safeNow(): number | null {
    try {
      const value = this.dependencies.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}
