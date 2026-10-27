import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { validatePluginNetUrl } from './plugin-net.ts'
import type { PluginCatalogDocument, PluginCatalogPlugin, PluginCatalogVersion } from '../src/types/plugin-catalog.ts'
import type { PluginLocalizedText } from '../src/types/plugin.ts'
import type { PluginCatalogError } from '../src/types/ipc.ts'
export type { PluginCatalogError } from '../src/types/ipc.ts'

export const PLUGIN_CATALOG_MAX_BYTES = 1024 * 1024
export const PLUGIN_CATALOG_MAX_PLUGINS = 500
export const PLUGIN_CATALOG_MAX_VERSIONS = 20
export const PLUGIN_CATALOG_MAX_PACKAGE_BYTES = 25 * 1024 * 1024
export const PLUGIN_CATALOG_ALLOWED_HOSTS = [
  'raw.githubusercontent.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
] as const

const CATALOG_ROOT_KEYS = new Set(['schemaVersion', 'plugins'])
const CATALOG_PLUGIN_KEYS = new Set(['id', 'name', 'description', 'author', 'homepage', 'publicKeyFingerprint', 'versions'])
const CATALOG_VERSION_KEYS = new Set(['version', 'apiVersion', 'url', 'sha256', 'size', 'publishedAt'])
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

export type PluginCatalogResult<T> = { ok: true; value: T } | { ok: false; error: PluginCatalogError }

export interface PluginCatalogDependencies {
  fetchRegistry: (url: string, maxBytes: number) => Promise<unknown>
  downloadArchive: (url: string, maxBytes: number) => Promise<Uint8Array>
}

interface SemverParts {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: string[] | null
}

function transportErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key))
}

function parseSemver(value: unknown): SemverParts | null {
  if (typeof value !== 'string' || value.length > 100) return null
  const match = SEMVER.exec(value)
  if (!match) return null
  const prerelease = match[4] === undefined ? null : match[4].split('.')
  if (prerelease?.some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) return null
  try {
    return {
      major: BigInt(match[1]!),
      minor: BigInt(match[2]!),
      patch: BigInt(match[3]!),
      prerelease,
    }
  } catch {
    return null
  }
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left)
    const b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function semverPrecedenceKey(parts: SemverParts): string {
  return `${parts.major}.${parts.minor}.${parts.patch}-${parts.prerelease?.join('.') ?? ''}`
}

function cleanText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function parseLocalizedText(value: unknown, maxLength: number): PluginLocalizedText | null {
  if (!isRecord(value) || Object.keys(value).length !== 2
    || !cleanText(value['zh-TW'], maxLength) || !cleanText(value['en-US'], maxLength)) return null
  return { 'zh-TW': value['zh-TW'], 'en-US': value['en-US'] }
}

function isSafeHomepage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      && (!url.port || url.port === '443') && Boolean(url.hostname) && isIP(url.hostname) === 0
  } catch {
    return false
  }
}

export function isPluginCatalogUrl(value: unknown): value is string {
  return validatePluginNetUrl(value, PLUGIN_CATALOG_ALLOWED_HOSTS) !== null
}

function parseCatalogVersion(value: unknown): PluginCatalogVersion | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CATALOG_VERSION_KEYS)
    || !parseSemver(value.version)
    || typeof value.apiVersion !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(value.apiVersion)
    || !isPluginCatalogUrl(value.url)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size)
    || value.size < 1 || value.size > PLUGIN_CATALOG_MAX_PACKAGE_BYTES
    || typeof value.publishedAt !== 'string' || !ISO_8601.test(value.publishedAt)
    || !Number.isFinite(Date.parse(value.publishedAt))) return null
  return {
    version: value.version as string,
    apiVersion: value.apiVersion,
    url: value.url as string,
    sha256: value.sha256,
    size: value.size,
    publishedAt: value.publishedAt,
  }
}

function parseCatalogPlugin(value: unknown): PluginCatalogPlugin | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CATALOG_PLUGIN_KEYS)
    || typeof value.id !== 'string' || !/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(value.id)) return null
  const name = parseLocalizedText(value.name, 48)
  const description = parseLocalizedText(value.description, 200)
  if (!name || !description || !cleanText(value.author, 64)
    || (value.homepage !== undefined && !isSafeHomepage(value.homepage))
    || (value.publicKeyFingerprint !== undefined
      && (typeof value.publicKeyFingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(value.publicKeyFingerprint)))
    || !Array.isArray(value.versions) || value.versions.length < 1 || value.versions.length > PLUGIN_CATALOG_MAX_VERSIONS) return null

  const parsedVersions = value.versions.map(parseCatalogVersion).filter((entry): entry is PluginCatalogVersion => entry !== null)
  const versionsByPrecedence = new Map<string, PluginCatalogVersion[]>()
  for (const version of parsedVersions) {
    const parts = parseSemver(version.version)
    if (!parts) continue
    const key = semverPrecedenceKey(parts)
    const list = versionsByPrecedence.get(key) ?? []
    list.push(version)
    versionsByPrecedence.set(key, list)
  }
  const versions = [...versionsByPrecedence.values()]
    .filter(entries => entries.length === 1)
    .map(entries => entries[0]!)
  if (versions.length === 0) return null
  return {
    id: value.id,
    name,
    description,
    author: value.author,
    ...(typeof value.homepage === 'string' ? { homepage: value.homepage } : {}),
    ...(typeof value.publicKeyFingerprint === 'string' ? { publicKeyFingerprint: value.publicKeyFingerprint } : {}),
    versions,
  }
}

function encodedDocumentSize(value: unknown): number | null {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? null : Buffer.byteLength(encoded, 'utf8')
  } catch {
    return null
  }
}

export function parsePluginCatalog(value: unknown): PluginCatalogResult<PluginCatalogDocument> {
  const size = encodedDocumentSize(value)
  if (size === null || size < 1 || size > PLUGIN_CATALOG_MAX_BYTES) return { ok: false, error: 'catalog_invalid' }
  let raw = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) as unknown } catch { return { ok: false, error: 'catalog_invalid' } }
  }
  if (!isRecord(raw) || !hasOnlyKeys(raw, CATALOG_ROOT_KEYS)
    || raw.schemaVersion !== 1 || !Array.isArray(raw.plugins) || raw.plugins.length > PLUGIN_CATALOG_MAX_PLUGINS) {
    return { ok: false, error: 'catalog_invalid' }
  }
  const plugins: PluginCatalogPlugin[] = []
  const duplicateIds = new Set<string>()
  const seenIds = new Set<string>()
  for (const entry of raw.plugins) {
    const parsed = parseCatalogPlugin(entry)
    if (!parsed || duplicateIds.has(parsed.id)) continue
    if (seenIds.has(parsed.id)) {
      duplicateIds.add(parsed.id)
      const existingIndex = plugins.findIndex(plugin => plugin.id === parsed.id)
      if (existingIndex >= 0) plugins.splice(existingIndex, 1)
      continue
    }
    seenIds.add(parsed.id)
    plugins.push(parsed)
  }
  return { ok: true, value: { schemaVersion: 1, plugins } }
}

export function comparePluginSemver(left: unknown, right: unknown): number | null {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return null
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  if (a.prerelease === null || b.prerelease === null) {
    if (a.prerelease === b.prerelease) return 0
    return a.prerelease === null ? 1 : -1
  }
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const difference = comparePrereleaseIdentifier(a.prerelease[index]!, b.prerelease[index]!)
    if (difference !== 0) return difference
  }
  return Math.sign(a.prerelease.length - b.prerelease.length)
}

export function selectLatestCompatiblePluginVersion(
  plugin: PluginCatalogPlugin,
  apiVersion: string,
): PluginCatalogVersion | null {
  let latest: PluginCatalogVersion | null = null
  for (const version of plugin.versions) {
    if (version.apiVersion !== apiVersion) continue
    if (!latest) {
      latest = version
      continue
    }
    if ((comparePluginSemver(version.version, latest.version) ?? -1) > 0) latest = version
  }
  return latest
}

export function isCatalogVersionNewer(installedVersion: unknown, catalogVersion: unknown): boolean {
  return (comparePluginSemver(catalogVersion, installedVersion) ?? 0) > 0
}

export function catalogFingerprintMatches(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return true
  return typeof expected === 'string' && /^[a-f0-9]{16}$/.test(expected)
    && typeof actual === 'string' && /^[a-f0-9]{16}$/.test(actual) && expected === actual
}

export function createPluginCatalogGateway(dependencies: PluginCatalogDependencies) {
  return {
    async load(registryUrl: unknown): Promise<PluginCatalogResult<PluginCatalogDocument>> {
      if (typeof registryUrl !== 'string' || registryUrl.length === 0) return { ok: false, error: 'catalog_url_invalid' }
      const url = validatePluginNetUrl(registryUrl, PLUGIN_CATALOG_ALLOWED_HOSTS)
      if (!url) return { ok: false, error: 'host_not_allowed' }
      try {
        const result = parsePluginCatalog(await dependencies.fetchRegistry(url.href, PLUGIN_CATALOG_MAX_BYTES))
        return result
      } catch (error) {
        const code = transportErrorCode(error)
        if (code === 'host_not_allowed') return { ok: false, error: 'host_not_allowed' }
        if (code === 'too_large') return { ok: false, error: 'catalog_invalid' }
        if (code === 'catalog_not_found') return { ok: false, error: 'catalog_not_found' }
        return { ok: false, error: 'catalog_unavailable' }
      }
    },
    async download(version: PluginCatalogVersion): Promise<PluginCatalogResult<Uint8Array>> {
      const parsedVersion = parseCatalogVersion(version)
      if (!parsedVersion) return { ok: false, error: 'catalog_invalid' }
      const url = validatePluginNetUrl(parsedVersion.url, PLUGIN_CATALOG_ALLOWED_HOSTS)
      if (!url) return { ok: false, error: 'host_not_allowed' }
      let bytes: Uint8Array
      try {
        bytes = await dependencies.downloadArchive(url.href, PLUGIN_CATALOG_MAX_PACKAGE_BYTES)
      } catch (error) {
        const code = transportErrorCode(error)
        if (code === 'host_not_allowed') return { ok: false, error: 'host_not_allowed' }
        if (code === 'too_large') return { ok: false, error: 'download_mismatch' }
        return { ok: false, error: 'catalog_unavailable' }
      }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== parsedVersion.size
        || createHash('sha256').update(bytes).digest('hex') !== parsedVersion.sha256) {
        return { ok: false, error: 'download_mismatch' }
      }
      return { ok: true, value: bytes }
    },
  }
}
