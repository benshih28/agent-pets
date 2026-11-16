import { comparePluginSemver } from './plugin-catalog.ts'
import { isRecord } from './value-guards.ts'

// App 新版檢查的純函式：版本比對與 GitHub release 回應解析。不連網、不碰 Electron。
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
  /** draft／prerelease：合法回應但不是要提示的版本。 */
  | { kind: 'ignored' }
  | { kind: 'invalid' }

/** 去掉單一個 v／V 前綴；非字串回 null。 */
export function normalizeAppVersion(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TAG_LENGTH) return null
  return /^[vV]/.test(value) ? value.slice(1) : value
}

/** latest 是否比 current 新；任一邊不是合法 semver 時回 false（不提示）。 */
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

/** 只接受本專案 releases 底下的 https 網址；其餘一律拒絕。 */
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

// 本專案的 tag 一律是 `v<version>`（見 release.yml）；由驗證後的版本推回 tag，不採用原始 tag_name。
function fallbackReleaseUrl(version: string): string {
  return `${APP_UPDATE_RELEASES_PREFIX}tag/${encodeURIComponent(`v${version}`)}`
}

/** 解析 GitHub `releases/latest` 回應，只取 tag_name、html_url、draft、prerelease。 */
export function parseLatestRelease(body: unknown): AppReleaseParseResult {
  if (typeof body !== 'string' || body.length === 0 || body.length > APP_UPDATE_MAX_RESPONSE_BYTES) return { kind: 'invalid' }
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return { kind: 'invalid' } }
  if (!isRecord(parsed)) return { kind: 'invalid' }
  if (parsed.draft === true || parsed.prerelease === true) return { kind: 'ignored' }
  const version = normalizeAppVersion(parsed.tag_name)
  if (version === null || !isValidAppVersion(version)) return { kind: 'invalid' }
  // 版本若帶 prerelease 後綴也視為非穩定版，不提示。
  if (version.includes('-')) return { kind: 'ignored' }
  return {
    kind: 'release',
    release: { version, url: isAppReleaseUrl(parsed.html_url) ? parsed.html_url : fallbackReleaseUrl(version) },
  }
}
