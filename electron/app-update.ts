import { comparePluginSemver } from './plugin-catalog.ts'
import { isRecord } from './value-guards.ts'

// 網址一律由這裡的常數決定；renderer 與任何設定都不能改。

export const APP_UPDATE_REPO = 'Ponpon55837/agent-pets'
export const APP_UPDATE_API_URL = `https://api.github.com/repos/${APP_UPDATE_REPO}/releases/latest`
export const APP_UPDATE_ALLOWED_HOSTS = ['api.github.com'] as const
export const APP_UPDATE_RELEASES_PREFIX = `https://github.com/${APP_UPDATE_REPO}/releases/`
export const APP_UPDATE_MAX_RESPONSE_BYTES = 256 * 1024
export const APP_UPDATE_TIMEOUT_MS = 10_000
export const APP_UPDATE_REQUESTS_PER_MINUTE = 3
const MAX_TAG_LENGTH = 64

export interface AppLatestRelease {
  version: string
  url: string
}

export type AppReleaseParseResult =
  | { kind: 'release'; release: AppLatestRelease }
  | { kind: 'ignored' }
  | { kind: 'invalid' }

export function normalizeAppVersion(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TAG_LENGTH) return null
  return /^[vV]/.test(value) ? value.slice(1) : value
}

export function isNewerAppVersion(current: unknown, latest: unknown): boolean {
  const left = normalizeAppVersion(current)
  const right = normalizeAppVersion(latest)
  if (left === null || right === null) return false
  const comparison = comparePluginSemver(left, right)
  return comparison !== null && comparison < 0
}

export function isValidAppVersion(value: unknown): value is string {
  const normalized = normalizeAppVersion(value)
  return normalized !== null && comparePluginSemver(normalized, normalized) !== null
}

export function isAppReleaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && !url.username && !url.password && (!url.port || url.port === '443')
      && url.href.startsWith(APP_UPDATE_RELEASES_PREFIX)
      && value.startsWith(APP_UPDATE_RELEASES_PREFIX)
  } catch {
    return false
  }
}

// 由驗證後的版本推回 tag，不採用原始 tag_name。
function fallbackReleaseUrl(version: string): string {
  return `${APP_UPDATE_RELEASES_PREFIX}tag/${encodeURIComponent(`v${version}`)}`
}

export function parseLatestRelease(body: unknown): AppReleaseParseResult {
  if (typeof body !== 'string' || body.length === 0 || body.length > APP_UPDATE_MAX_RESPONSE_BYTES) return { kind: 'invalid' }
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return { kind: 'invalid' } }
  if (!isRecord(parsed)) return { kind: 'invalid' }
  if (parsed.draft === true || parsed.prerelease === true) return { kind: 'ignored' }
  const version = normalizeAppVersion(parsed.tag_name)
  if (version === null || !isValidAppVersion(version)) return { kind: 'invalid' }
  if (version.includes('-')) return { kind: 'ignored' }
  return {
    kind: 'release',
    release: { version, url: isAppReleaseUrl(parsed.html_url) ? parsed.html_url : fallbackReleaseUrl(version) },
  }
}
