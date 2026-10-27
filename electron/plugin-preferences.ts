import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PluginInstancePreferences, PluginPreferences, PluginResourceLimits } from '../src/types/plugin.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { isValidPluginNetworkHost } from './plugin-manifest.ts'
import { isPluginCatalogUrl } from './plugin-catalog.ts'
import { DEFAULT_PLUGIN_CATALOG_URL } from '../src/types/plugin-catalog.ts'
import { writeJsonAtomic } from './desktop-preferences.ts'

export const PLUGIN_PREFERENCES_FILENAME = 'plugin-preferences.json'
export const PLUGIN_PREFERENCES_MAX_BYTES = 1024 * 1024

export class PluginPreferencesFileError extends Error {
  readonly code = 'unsafe_file'

  constructor() {
    super('Plugin preferences file is unsafe')
    this.name = 'PluginPreferencesFileError'
  }
}

export const PLUGIN_RESOURCE_BOUNDS = Object.freeze({
  maxEnabledPlugins: Object.freeze({ default: 10, min: 1, max: 50 }),
  memoryMbPerPlugin: Object.freeze({ default: 64, min: 16, max: 512 }),
  netMaxResponseBytes: Object.freeze({ default: 2 * 1024 * 1024, min: 64 * 1024, max: 20 * 1024 * 1024 }),
  netTimeoutSeconds: Object.freeze({ default: 15, min: 5, max: 60 }),
  netRequestsPerMinute: Object.freeze({ default: 30, min: 1, max: 300 }),
  storageBytesPerPlugin: Object.freeze({ default: 1024 * 1024, min: 64 * 1024, max: 50 * 1024 * 1024 }),
  globalFeedPer10Min: Object.freeze({ default: 60, min: 10, max: 300 }),
  scheduleMinIntervalSeconds: Object.freeze({ default: 60, min: 30, max: 3_600 }),
} as const satisfies Record<keyof PluginResourceLimits, { default: number; min: number; max: number }>)

export const DEFAULT_PLUGIN_RESOURCES = Object.freeze({
  maxEnabledPlugins: PLUGIN_RESOURCE_BOUNDS.maxEnabledPlugins.default,
  memoryMbPerPlugin: PLUGIN_RESOURCE_BOUNDS.memoryMbPerPlugin.default,
  netMaxResponseBytes: PLUGIN_RESOURCE_BOUNDS.netMaxResponseBytes.default,
  netTimeoutSeconds: PLUGIN_RESOURCE_BOUNDS.netTimeoutSeconds.default,
  netRequestsPerMinute: PLUGIN_RESOURCE_BOUNDS.netRequestsPerMinute.default,
  storageBytesPerPlugin: PLUGIN_RESOURCE_BOUNDS.storageBytesPerPlugin.default,
  globalFeedPer10Min: PLUGIN_RESOURCE_BOUNDS.globalFeedPer10Min.default,
  scheduleMinIntervalSeconds: PLUGIN_RESOURCE_BOUNDS.scheduleMinIntervalSeconds.default,
}) as PluginResourceLimits

export const DEFAULT_PLUGIN_PREFERENCES = Object.freeze({
  pluginsEnabled: false,
  developerMode: false,
  onlineCatalogEnabled: false,
  dailyUpdateCheck: false,
  catalogUrl: DEFAULT_PLUGIN_CATALOG_URL,
  resources: DEFAULT_PLUGIN_RESOURCES,
  plugins: Object.freeze({}),
}) as PluginPreferences

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const RESOURCE_KEYS = Object.keys(PLUGIN_RESOURCE_BOUNDS) as (keyof PluginResourceLimits)[]
const PLUGIN_PREFERENCE_KEYS = new Set(['enabled', 'muted', 'rateLimitPer10Min', 'targetPetId', 'grantedHosts'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPluginId(value: unknown): value is string {
  return typeof value === 'string' && PLUGIN_ID.test(value)
}

function clonePluginPreferences(value: PluginPreferences): PluginPreferences {
  const plugins: Record<string, PluginInstancePreferences> = {}
  for (const [pluginId, preference] of Object.entries(value.plugins)) {
    plugins[pluginId] = { ...preference, grantedHosts: [...preference.grantedHosts] }
  }
  return {
    pluginsEnabled: value.pluginsEnabled,
    developerMode: value.developerMode,
    onlineCatalogEnabled: value.onlineCatalogEnabled,
    dailyUpdateCheck: value.dailyUpdateCheck,
    catalogUrl: value.catalogUrl,
    resources: { ...value.resources },
    plugins,
  }
}

function defaultPluginPreference(): PluginInstancePreferences {
  return {
    enabled: false,
    muted: false,
    rateLimitPer10Min: 5,
    targetPetId: null,
    grantedHosts: [],
  }
}

function parseResourceValues(value: unknown, base: PluginResourceLimits): PluginResourceLimits | null {
  if (!isRecord(value)) return null
  if (Object.keys(value).some(key => !RESOURCE_KEYS.includes(key as keyof PluginResourceLimits))) return null
  const result = { ...base }
  for (const key of RESOURCE_KEYS) {
    const raw = value[key]
    if (raw === undefined) continue
    const bounds = PLUGIN_RESOURCE_BOUNDS[key]
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < bounds.min || raw > bounds.max) return null
    result[key] = raw
  }
  return result
}

function parseStoredResourceValues(value: unknown): PluginResourceLimits {
  if (!isRecord(value)) return { ...DEFAULT_PLUGIN_RESOURCES }
  const result = { ...DEFAULT_PLUGIN_RESOURCES }
  for (const key of RESOURCE_KEYS) {
    const raw = value[key]
    if (raw === undefined) continue
    const bounds = PLUGIN_RESOURCE_BOUNDS[key]
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= bounds.min && raw <= bounds.max) {
      result[key] = raw
    }
  }
  return result
}

function parseStoredPluginPreference(value: unknown): PluginInstancePreferences | null {
  if (!isRecord(value)) return null
  const defaults = defaultPluginPreference()
  const enabled = value.enabled === undefined ? defaults.enabled : value.enabled
  const muted = value.muted === undefined ? defaults.muted : value.muted
  const rateLimitPer10Min = value.rateLimitPer10Min === undefined ? defaults.rateLimitPer10Min : value.rateLimitPer10Min
  const targetPetId = value.targetPetId === undefined ? defaults.targetPetId : value.targetPetId
  const grantedHosts = value.grantedHosts === undefined ? defaults.grantedHosts : value.grantedHosts
  if (typeof enabled !== 'boolean' || typeof muted !== 'boolean'
    || typeof rateLimitPer10Min !== 'number' || !Number.isSafeInteger(rateLimitPer10Min)
    || rateLimitPer10Min < 1 || rateLimitPer10Min > 30) return null
  if (targetPetId !== null && !isValidPetId(targetPetId, 64)) return null
  if (!Array.isArray(grantedHosts) || grantedHosts.length > 50) return null
  const normalizedHosts: string[] = []
  const seenHosts = new Set<string>()
  for (const host of grantedHosts) {
    if (!isValidPluginNetworkHost(host, false)) return null
    const normalized = host.toLowerCase()
    if (seenHosts.has(normalized)) return null
    seenHosts.add(normalized)
    normalizedHosts.push(normalized)
  }
  return { enabled, muted, rateLimitPer10Min, targetPetId, grantedHosts: normalizedHosts }
}

function parseStoredPreferences(value: unknown): PluginPreferences | null {
  if (!isRecord(value)) return null
  const pluginsEnabled = typeof value.pluginsEnabled === 'boolean' ? value.pluginsEnabled : false
  const developerMode = typeof value.developerMode === 'boolean' ? value.developerMode : false
  const onlineCatalogEnabled = value.onlineCatalogEnabled === true
  const dailyUpdateCheck = onlineCatalogEnabled && value.dailyUpdateCheck === true
  const catalogUrl = value.catalogUrl === undefined
    ? DEFAULT_PLUGIN_CATALOG_URL
    : typeof value.catalogUrl === 'string' && value.catalogUrl.length <= 2_048
      && (value.catalogUrl === '' || isPluginCatalogUrl(value.catalogUrl)) ? value.catalogUrl : DEFAULT_PLUGIN_CATALOG_URL
  const resources = parseStoredResourceValues(value.resources)

  const plugins: Record<string, PluginInstancePreferences> = {}
  if (isRecord(value.plugins)) {
    for (const [pluginId, rawPreference] of Object.entries(value.plugins)) {
      if (!isPluginId(pluginId)) continue
      const preference = parseStoredPluginPreference(rawPreference)
      if (preference) plugins[pluginId] = preference
    }
  }

  return { pluginsEnabled, developerMode, onlineCatalogEnabled, dailyUpdateCheck, catalogUrl, resources, plugins }
}

interface StoredPreferencesRead {
  value: unknown | undefined
  backupRequired: boolean
  unsafe: boolean
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function isIsoCalendarDay(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function readStoredPreferences(filePath: string): StoredPreferencesRead {
  let linkStat: fs.Stats
  try {
    linkStat = fs.lstatSync(filePath)
  } catch (error) {
    return isErrorCode(error, 'ENOENT')
      ? { value: undefined, backupRequired: false, unsafe: false }
      : { value: undefined, backupRequired: false, unsafe: true }
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    return { value: undefined, backupRequired: false, unsafe: true }
  }
  if (linkStat.size > PLUGIN_PREFERENCES_MAX_BYTES) {
    return { value: undefined, backupRequired: true, unsafe: false }
  }

  let descriptor: number | null = null
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const fileStat = fs.fstatSync(descriptor)
    if (!fileStat.isFile()) return { value: undefined, backupRequired: false, unsafe: true }
    if (fileStat.size > PLUGIN_PREFERENCES_MAX_BYTES) {
      return { value: undefined, backupRequired: true, unsafe: false }
    }
    const contents = fs.readFileSync(descriptor, 'utf8')
    try {
      return { value: JSON.parse(contents) as unknown, backupRequired: false, unsafe: false }
    } catch {
      return { value: undefined, backupRequired: true, unsafe: false }
    }
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return { value: undefined, backupRequired: false, unsafe: false }
    if (isErrorCode(error, 'ELOOP')) return { value: undefined, backupRequired: false, unsafe: true }
    return { value: undefined, backupRequired: false, unsafe: true }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function parseGlobalPatch(value: unknown): {
  pluginsEnabled?: boolean
  developerMode?: boolean
  onlineCatalogEnabled?: boolean
  dailyUpdateCheck?: boolean
  catalogUrl?: string
  resources?: Partial<PluginResourceLimits>
} {
  if (!isRecord(value)) throw new TypeError('Plugin preferences patch must be an object')
  const allowed = new Set(['pluginsEnabled', 'developerMode', 'onlineCatalogEnabled', 'dailyUpdateCheck', 'catalogUrl', 'resources'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unsupported plugin preference: ${key}`)
  }
  const patch: {
    pluginsEnabled?: boolean
    developerMode?: boolean
    onlineCatalogEnabled?: boolean
    dailyUpdateCheck?: boolean
    catalogUrl?: string
    resources?: Partial<PluginResourceLimits>
  } = {}
  for (const key of ['pluginsEnabled', 'developerMode', 'onlineCatalogEnabled', 'dailyUpdateCheck'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') throw new TypeError(`Plugin preference ${key} must be boolean`)
      patch[key] = value[key]
    }
  }
  if (value.catalogUrl !== undefined) {
    if (typeof value.catalogUrl !== 'string' || value.catalogUrl.length > 2_048
      || (value.catalogUrl !== '' && !isPluginCatalogUrl(value.catalogUrl))) {
      throw new TypeError('Plugin catalog URL is invalid')
    }
    patch.catalogUrl = value.catalogUrl
  }
  if (value.resources !== undefined) {
    const resources = parseResourceValues(value.resources, DEFAULT_PLUGIN_RESOURCES)
    if (!resources) throw new TypeError('Plugin resource limits are invalid or exceed their hard bounds')
    const supplied = value.resources as Record<string, number>
    patch.resources = Object.fromEntries(Object.keys(supplied).map(key => [key, resources[key as keyof PluginResourceLimits]]))
  }
  return patch
}

function parsePluginPatch(value: unknown): Partial<PluginInstancePreferences> {
  if (!isRecord(value)) throw new TypeError('Per-plugin preferences patch must be an object')
  for (const key of Object.keys(value)) {
    if (!PLUGIN_PREFERENCE_KEYS.has(key)) throw new TypeError(`Unsupported per-plugin preference: ${key}`)
  }
  const patch: Partial<PluginInstancePreferences> = {}
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new TypeError('Plugin enabled preference must be boolean')
    patch.enabled = value.enabled
  }
  if (value.muted !== undefined) {
    if (typeof value.muted !== 'boolean') throw new TypeError('Plugin muted preference must be boolean')
    patch.muted = value.muted
  }
  if (value.rateLimitPer10Min !== undefined) {
    if (typeof value.rateLimitPer10Min !== 'number' || !Number.isSafeInteger(value.rateLimitPer10Min)
      || value.rateLimitPer10Min < 1 || value.rateLimitPer10Min > 30) {
      throw new TypeError('Plugin notification rate must be an integer from 1 to 30')
    }
    patch.rateLimitPer10Min = value.rateLimitPer10Min
  }
  if (value.targetPetId !== undefined) {
    const targetPetId = value.targetPetId
    if (targetPetId !== null && !isValidPetId(targetPetId, 64)) {
      throw new TypeError('Plugin target pet id is invalid')
    }
    patch.targetPetId = targetPetId as string | null
  }
  if (value.grantedHosts !== undefined) {
    if (!Array.isArray(value.grantedHosts) || value.grantedHosts.length > 50) {
      throw new TypeError('Plugin granted hosts must contain at most 50 hosts')
    }
    const normalizedHosts: string[] = []
    const seenHosts = new Set<string>()
    for (const host of value.grantedHosts) {
      if (!isValidPluginNetworkHost(host, false)) throw new TypeError('Plugin granted host is invalid')
      const normalized = host.toLowerCase()
      if (seenHosts.has(normalized)) throw new TypeError('Plugin granted hosts must be unique')
      seenHosts.add(normalized)
      normalizedHosts.push(normalized)
    }
    patch.grantedHosts = normalizedHosts
  }
  return patch
}

export class PluginPreferencesStore {
  private readonly filePath: string
  private stored: PluginPreferences | null = null
  private corruptBackupRequired = false
  private unsafeFile = false
  private lastCatalogAutoCheckDay: string | null = null

  constructor(userDataDirectory: string) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Plugin preferences require an absolute userData directory')
    this.filePath = path.join(userDataDirectory, PLUGIN_PREFERENCES_FILENAME)
  }

  get(): PluginPreferences {
    return clonePluginPreferences(this.load())
  }

  getLastCatalogAutoCheckDay(): string | null {
    this.load()
    return this.lastCatalogAutoCheckDay
  }

  setLastCatalogAutoCheckDay(day: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isIsoCalendarDay(day)) {
      throw new TypeError('Catalog auto-check day is invalid')
    }
    const current = this.load()
    const previous = this.lastCatalogAutoCheckDay
    this.lastCatalogAutoCheckDay = day
    try {
      this.persist(current)
    } catch (error) {
      this.lastCatalogAutoCheckDay = previous
      throw error
    }
  }

  getPlugin(pluginId: string): PluginInstancePreferences {
    if (!isPluginId(pluginId)) throw new TypeError('Plugin id is invalid')
    const preference = this.load().plugins[pluginId] ?? defaultPluginPreference()
    return { ...preference, grantedHosts: [...preference.grantedHosts] }
  }

  updateGlobal(value: unknown): PluginPreferences {
    const patch = parseGlobalPatch(value)
    const current = this.load()
    const next: PluginPreferences = {
      ...current,
      ...patch,
      dailyUpdateCheck: patch.dailyUpdateCheck
        ?? (patch.onlineCatalogEnabled === false ? false : current.dailyUpdateCheck),
      resources: patch.resources ? { ...current.resources, ...patch.resources } : { ...current.resources },
      plugins: current.plugins,
    }
    if (next.dailyUpdateCheck && !next.onlineCatalogEnabled) {
      throw new TypeError('Daily plugin update checks require the online catalog')
    }
    this.persist(next)
    return clonePluginPreferences(next)
  }

  updatePlugin(pluginId: string, value: unknown): PluginPreferences {
    if (!isPluginId(pluginId)) throw new TypeError('Plugin id is invalid')
    const patch = parsePluginPatch(value)
    const current = this.load()
    const existing = current.plugins[pluginId] ?? defaultPluginPreference()
    const next: PluginPreferences = {
      ...current,
      resources: { ...current.resources },
      plugins: {
        ...current.plugins,
        [pluginId]: {
          ...existing,
          ...patch,
          grantedHosts: patch.grantedHosts ? [...patch.grantedHosts] : [...existing.grantedHosts],
        },
      },
    }
    this.persist(next)
    return clonePluginPreferences(next)
  }

  removePlugin(pluginId: string): PluginPreferences {
    if (!isPluginId(pluginId)) throw new TypeError('Plugin id is invalid')
    const current = this.load()
    const plugins = { ...current.plugins }
    delete plugins[pluginId]
    const next: PluginPreferences = { ...current, resources: { ...current.resources }, plugins }
    this.persist(next)
    return clonePluginPreferences(next)
  }

  private load(): PluginPreferences {
    if (this.stored === null) {
      const read = readStoredPreferences(this.filePath)
      this.corruptBackupRequired = read.backupRequired
      this.unsafeFile = read.unsafe
      const storedDay = isRecord(read.value) ? read.value.lastCatalogAutoCheckDay : undefined
      this.lastCatalogAutoCheckDay = typeof storedDay === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(storedDay)
        && isIsoCalendarDay(storedDay)
        ? storedDay : null
      const parsed = parseStoredPreferences(read.value)
      this.corruptBackupRequired ||= read.value !== undefined && parsed === null
      this.stored = parsed ?? clonePluginPreferences(DEFAULT_PLUGIN_PREFERENCES)
    }
    return this.stored
  }

  private backupCorruptFile(): void {
    if (!this.corruptBackupRequired) return
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(this.filePath)
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        this.corruptBackupRequired = false
        return
      }
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('Plugin preferences file is unsafe')

    let timestamp = Date.now()
    let backupPath = `${this.filePath}.corrupt-${timestamp}`
    while (fs.existsSync(backupPath)) {
      timestamp += 1
      backupPath = `${this.filePath}.corrupt-${timestamp}`
    }
    fs.renameSync(this.filePath, backupPath)
    this.corruptBackupRequired = false
  }

  private persist(value: PluginPreferences): void {
    if (this.unsafeFile) throw new PluginPreferencesFileError()
    try {
      const stat = fs.lstatSync(this.filePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new PluginPreferencesFileError()
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    this.backupCorruptFile()
    writeJsonAtomic(this.filePath, {
      ...value,
      ...(this.lastCatalogAutoCheckDay ? { lastCatalogAutoCheckDay: this.lastCatalogAutoCheckDay } : {}),
    })
    this.stored = clonePluginPreferences(value)
  }
}
