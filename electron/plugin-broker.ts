import * as fs from 'node:fs'
import * as path from 'node:path'
import { isPluginErrorCode, type PluginErrorCode, type PluginManifest } from '../src/types/plugin.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { PRESENTATION_REACTIONS, type PresentationReaction } from '../src/types/presentation.ts'
import { writeJsonAtomic } from './desktop-preferences.ts'
import type { PluginFeedController } from './plugin-feed.ts'
import type { PluginNetLimits, PluginNetworkClient } from './plugin-net.ts'

export const PLUGIN_RPC_MAX_BYTES = 256 * 1024
export const PLUGIN_RPC_ID_MAX_LENGTH = 64
export const PLUGIN_STORAGE_KEY_MAX_LENGTH = 128
export const PLUGIN_LOG_MESSAGE_MAX_LENGTH = 1_000
export const PLUGIN_LOG_MAX_ENTRIES = 200
export const PLUGIN_STORAGE_FLUSH_DELAY_MS = 1_000

export interface PluginBrokerContext {
  manifest: PluginManifest
  enabled: boolean
  pluginsEnabled: boolean
  dndEnabled: boolean
  storageBytesPerPlugin: number
  grantedHosts?: string[]
  netLimits?: PluginNetLimits
}

export interface PluginReactionRequest {
  reaction: PresentationReaction
  petId?: string
  ttlMs: number
}

export interface PluginBrokerLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface PluginBrokerDiagnostic {
  at: number
  code: PluginErrorCode
  method?: string
}

export interface PluginBrokerOptions {
  userDataDirectory: string
  getContext: (pluginId: string) => PluginBrokerContext | null
  feed: PluginFeedController
  onReaction: (pluginId: string, request: PluginReactionRequest) => { ok: boolean; error?: PluginErrorCode }
  now?: () => number
  network?: PluginNetworkClient
  onRequestHost?: (pluginId: string, host: unknown, reason: unknown) => Promise<unknown> | unknown
  onSecretGet?: (pluginId: string, key: string) => string | { ok: false; error: PluginErrorCode }
  onSettingsGet?: (pluginId: string) => Record<string, unknown> | { ok: false; error: PluginErrorCode }
  onAgentStatusGet?: (pluginId: string) => unknown | { ok: false; error: PluginErrorCode }
  onAgentEmit?: (pluginId: string, event: unknown) => unknown | { ok: false; error: PluginErrorCode }
  onBadgeSet?: (pluginId: string, badge: unknown) => unknown | { ok: false; error: PluginErrorCode }
}

type RpcResponse = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: PluginErrorCode }

interface PluginStorageState {
  values: Record<string, unknown>
  loaded: boolean
  available: boolean
  maxBytes: number
}

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const STORAGE_KEY_FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const KNOWN_METHODS = new Set([
  'feed.notify', 'pet.react', 'pet.status', 'agent.emit', 'badge.set', 'storage.get', 'storage.set', 'storage.remove',
  'log.info', 'log.warn', 'log.error', 'net.fetch', 'net.requestHost', 'secrets.get', 'settings.get',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 32 || seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false
  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  const valid = values.length <= 50_000 && values.every(child => isJsonValue(child, depth + 1, seen))
  seen.delete(value)
  return valid
}

function safeStorageKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PLUGIN_STORAGE_KEY_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value) && !STORAGE_KEY_FORBIDDEN.has(value)
}

function safeLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 64 * 1024 && value <= 50 * 1024 * 1024
}

function isFsError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function normalizeLogText(value: unknown): string | null {
  let text: string
  if (typeof value === 'string') text = value
  else if (value === null || typeof value === 'boolean' || typeof value === 'number') text = String(value)
  else {
    try { text = JSON.stringify(value) } catch { return null }
  }
  if (typeof text !== 'string') return null
  const normalized = text.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.length <= PLUGIN_LOG_MESSAGE_MAX_LENGTH ? normalized : normalized.slice(0, PLUGIN_LOG_MESSAGE_MAX_LENGTH)
}

function normalizeReactionArgs(args: unknown[]): PluginReactionRequest | null {
  if (args.length < 1 || args.length > 2 || !PRESENTATION_REACTIONS.includes(args[0] as PresentationReaction)) return null
  const options = args[1] === undefined ? {} : args[1]
  if (!isRecord(options) || Object.keys(options).some(key => key !== 'petId' && key !== 'ttlMs')) return null
  const ttlMs = options.ttlMs === undefined ? 6_000 : options.ttlMs
  if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15_000) return null
  let petId: string | undefined
  if (options.petId !== undefined) {
    if (!isValidPetId(options.petId, 64)) return null
    petId = options.petId
  }
  return {
    reaction: args[0] as PresentationReaction,
    ...(petId ? { petId } : {}),
    ttlMs,
  }
}

export class PluginBroker {
  private readonly pluginsDirectory: string
  private readonly getContext: PluginBrokerOptions['getContext']
  private readonly feed: PluginFeedController
  private readonly onReaction: PluginBrokerOptions['onReaction']
  private readonly network: PluginBrokerOptions['network']
  private readonly onRequestHost: PluginBrokerOptions['onRequestHost']
  private readonly onSecretGet: PluginBrokerOptions['onSecretGet']
  private readonly onSettingsGet: PluginBrokerOptions['onSettingsGet']
  private readonly onAgentStatusGet: PluginBrokerOptions['onAgentStatusGet']
  private readonly onAgentEmit: PluginBrokerOptions['onAgentEmit']
  private readonly onBadgeSet: PluginBrokerOptions['onBadgeSet']
  private readonly now: () => number
  private readonly storage = new Map<string, PluginStorageState>()
  private readonly storageTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly logs = new Map<string, PluginBrokerLogEntry[]>()
  private readonly diagnostics = new Map<string, PluginBrokerDiagnostic[]>()

  constructor(options: PluginBrokerOptions) {
    if (!path.isAbsolute(options.userDataDirectory)) throw new TypeError('Plugin broker requires an absolute userData directory')
    this.pluginsDirectory = path.join(fs.realpathSync(options.userDataDirectory), 'plugins')
    this.getContext = options.getContext
    this.feed = options.feed
    this.onReaction = options.onReaction
    this.network = options.network
    this.onRequestHost = options.onRequestHost
    this.onSecretGet = options.onSecretGet
    this.onSettingsGet = options.onSettingsGet
    this.onAgentStatusGet = options.onAgentStatusGet
    this.onAgentEmit = options.onAgentEmit
    this.onBadgeSet = options.onBadgeSet
    this.now = options.now ?? Date.now
  }

  handle(pluginId: string, rawRequest: unknown): RpcResponse | { ok: false; error: PluginErrorCode } | Promise<RpcResponse | { ok: false; error: PluginErrorCode }> {
    const id = isRecord(rawRequest) && typeof rawRequest.id === 'string' && rawRequest.id.length <= PLUGIN_RPC_ID_MAX_LENGTH
      ? rawRequest.id
      : null
    if (!PLUGIN_ID.test(pluginId) || !isRecord(rawRequest)) {
      this.recordDiagnostic(pluginId, 'invalid_request')
      return { ok: false, error: 'invalid_request' }
    }
    let serialized: string
    try { serialized = JSON.stringify(rawRequest) } catch {
      this.recordDiagnostic(pluginId, 'invalid_request')
      return id ? { id, ok: false, error: 'invalid_request' } : { ok: false, error: 'invalid_request' }
    }
    if (Buffer.byteLength(serialized, 'utf8') > PLUGIN_RPC_MAX_BYTES) {
      this.recordDiagnostic(pluginId, 'too_large', typeof rawRequest.method === 'string' ? rawRequest.method : undefined)
      return id ? { id, ok: false, error: 'too_large' } : { ok: false, error: 'too_large' }
    }
    if (!isJsonValue(rawRequest) || !id || id.length === 0
      || Object.keys(rawRequest).some(key => !['id', 'method', 'args'].includes(key))
      || typeof rawRequest.method !== 'string' || !KNOWN_METHODS.has(rawRequest.method)
      || !Array.isArray(rawRequest.args) || rawRequest.args.length > 32) {
      this.recordDiagnostic(pluginId, 'invalid_request', typeof rawRequest.method === 'string' ? rawRequest.method : undefined)
      return id ? { id, ok: false, error: 'invalid_request' } : { ok: false, error: 'invalid_request' }
    }
    let context: PluginBrokerContext | null = null
    try { context = this.getContext(pluginId) } catch {}
    const method = rawRequest.method
    if (!context || !context.pluginsEnabled || !context.enabled || context.manifest.id !== pluginId) {
      return this.reject(pluginId, id, 'disabled', method)
    }
    try {
      const value = this.dispatch(pluginId, context, method, rawRequest.args)
      const finish = (resolved: unknown): RpcResponse => {
        if (resolved && typeof resolved === 'object' && 'ok' in resolved && resolved.ok === false && 'error' in resolved) {
          const error = isPluginErrorCode(resolved.error) ? resolved.error : 'invalid_request'
          this.recordDiagnostic(pluginId, error, method)
          return { id, ok: false, error }
        }
        return { id, ok: true, value: resolved }
      }
      if (value && typeof value === 'object' && 'then' in value && typeof value.then === 'function') {
        return Promise.resolve(value).then(finish).catch(() => {
          this.recordDiagnostic(pluginId, 'invalid_request', method)
          return { id, ok: false, error: 'invalid_request' }
        })
      }
      return finish(value)
    } catch {
      this.recordDiagnostic(pluginId, 'invalid_request', method)
      return { id, ok: false, error: 'invalid_request' }
    }
  }

  listLogs(pluginId: string): PluginBrokerLogEntry[] {
    if (!PLUGIN_ID.test(pluginId)) return []
    return (this.logs.get(pluginId) ?? []).map(entry => ({ ...entry }))
  }

  listDiagnostics(pluginId: string): PluginBrokerDiagnostic[] {
    if (!PLUGIN_ID.test(pluginId)) return []
    return (this.diagnostics.get(pluginId) ?? []).map(entry => ({ ...entry }))
  }

  recordSystemDiagnostic(pluginId: string, code: PluginErrorCode, method?: string): void {
    this.recordDiagnostic(pluginId, code, method)
  }

  recordHostUnavailable(pluginId: string): void {
    this.recordDiagnostic(pluginId, 'host_unavailable', 'host.start')
  }

  flushStorage(pluginId: string): boolean {
    if (!PLUGIN_ID.test(pluginId)) return false
    const state = this.storage.get(pluginId)
    if (!state?.loaded || !state.available) return false
    let maxBytes = state.maxBytes
    try {
      const context = this.getContext(pluginId)
      if (context && context.manifest.id === pluginId && safeLimit(context.storageBytesPerPlugin)) {
        maxBytes = context.storageBytesPerPlugin
      }
    } catch {}
    if (!safeLimit(maxBytes)) return false
    const storageRoot = path.join(this.pluginsDirectory, pluginId, 'data')
    const filePath = path.join(storageRoot, 'storage.json')
    try {
      this.ensureStorageDirectory(pluginId)
      if (fs.existsSync(filePath)) {
        const stat = fs.lstatSync(filePath)
        if (!stat.isFile() || stat.isSymbolicLink()) return false
      }
      if (Buffer.byteLength(JSON.stringify(state.values), 'utf8') > maxBytes) return false
      writeJsonAtomic(filePath, state.values)
      return true
    } catch {
      this.recordDiagnostic(pluginId, 'invalid_request', 'storage.flush')
      return false
    }
  }

  removePlugin(pluginId: string, keepData: boolean): void {
    const timer = this.storageTimers.get(pluginId)
    if (timer) clearTimeout(timer)
    this.storageTimers.delete(pluginId)
    if (keepData) this.flushStorage(pluginId)
    this.storage.delete(pluginId)
    this.logs.delete(pluginId)
    this.diagnostics.delete(pluginId)
  }

  destroy(): void {
    for (const timer of this.storageTimers.values()) clearTimeout(timer)
    for (const pluginId of this.storageTimers.keys()) this.flushStorage(pluginId)
    this.storageTimers.clear()
  }

  private dispatch(pluginId: string, context: PluginBrokerContext, method: string, args: unknown[]): unknown {
    if (method === 'feed.notify') {
      if (!context.manifest.contributes.feed || args.length !== 1) return { ok: false, error: 'not_permitted' }
      const result = this.feed.submit(pluginId, args[0])
      return result.accepted
        ? { itemId: result.itemId, delivery: result.delivery }
        : { ok: false, error: result.error }
    }
    if (method === 'pet.react') {
      if (!context.manifest.contributes.reaction) return { ok: false, error: 'not_permitted' }
      if (context.dndEnabled) return { ok: false, error: 'disabled' }
      const request = normalizeReactionArgs(args)
      if (!request) return { ok: false, error: 'invalid_request' }
      const rate = this.feed.consumeRateLimit(pluginId)
      if (!rate.allowed) return { ok: false, error: rate.error }
      const result = this.onReaction(pluginId, request)
      return result.ok ? { accepted: true } : { ok: false, error: result.error ?? 'invalid_request' }
    }
    if (method === 'pet.status') {
      if (!context.manifest.permissions.agentStatus) return { ok: false, error: 'not_permitted' }
      if (args.length !== 0) return { ok: false, error: 'invalid_request' }
      return this.onAgentStatusGet?.(pluginId) ?? { ok: false, error: 'agent_status_unavailable' }
    }
    if (method === 'agent.emit') {
      if (!context.manifest.contributes.eventSource) return { ok: false, error: 'not_permitted' }
      if (args.length !== 1) return { ok: false, error: 'invalid_request' }
      return this.onAgentEmit?.(pluginId, args[0]) ?? { ok: false, error: 'disabled' }
    }
    if (method === 'badge.set') {
      if (!context.manifest.contributes.badge) return { ok: false, error: 'not_permitted' }
      if (args.length !== 1) return { ok: false, error: 'invalid_request' }
      return this.onBadgeSet?.(pluginId, args[0]) ?? { ok: false, error: 'disabled' }
    }
    if (method === 'net.fetch') {
      if (!context.manifest.permissions.network) return { ok: false, error: 'not_permitted' }
      if (args.length < 1 || args.length > 2 || !this.network || !context.netLimits) {
        return { ok: false, error: !this.network || !context.netLimits ? 'disabled' : 'invalid_request' }
      }
      return this.network.fetch(pluginId, args[0], args[1], context.grantedHosts ?? context.manifest.permissions.network.hosts, context.netLimits)
        .then(result => result.ok ? result.value : { ok: false, error: result.error })
    }
    if (method === 'net.requestHost') {
      if (!context.manifest.permissions.network?.userGranted) return { ok: false, error: 'not_permitted' }
      if (args.length !== 2) return { ok: false, error: 'invalid_request' }
      if (!this.onRequestHost) return { ok: false, error: 'disabled' }
      return this.onRequestHost(pluginId, args[0], args[1])
    }
    if (method === 'secrets.get') {
      const declared = context.manifest.permissions.secrets ?? []
      if (args.length !== 1 || typeof args[0] !== 'string') return { ok: false, error: 'invalid_request' }
      if (!declared.includes(args[0])) return { ok: false, error: 'not_permitted' }
      return this.onSecretGet?.(pluginId, args[0]) ?? { ok: false, error: 'secret_unavailable' }
    }
    if (method === 'settings.get') {
      if (args.length !== 0) return { ok: false, error: 'invalid_request' }
      if (!context.manifest.contributes.settings) return { ok: false, error: 'not_permitted' }
      return this.onSettingsGet?.(pluginId) ?? { ok: false, error: 'disabled' }
    }
    if (method.startsWith('storage.')) {
      if (!context.manifest.permissions.storage || args.length !== (method === 'storage.set' ? 2 : 1)) {
        return { ok: false, error: context.manifest.permissions.storage ? 'invalid_request' : 'not_permitted' }
      }
      if (!safeLimit(context.storageBytesPerPlugin)) return { ok: false, error: 'disabled' }
      const key = args[0]
      if (!safeStorageKey(key)) return { ok: false, error: 'invalid_request' }
      const state = this.loadStorage(pluginId, context.storageBytesPerPlugin)
      if (!state.available) return { ok: false, error: 'disabled' }
      if (method === 'storage.get') return { found: Object.hasOwn(state.values, key), value: state.values[key] ?? null }
      const next = { ...state.values }
      if (method === 'storage.remove') {
        const removed = Object.hasOwn(next, key)
        delete next[key]
        state.values = next
        if (removed) this.scheduleStorageFlush(pluginId)
        return { removed }
      }
      const value = args[1]
      if (!isJsonValue(value)) return { ok: false, error: 'invalid_request' }
      next[key] = JSON.parse(JSON.stringify(value)) as unknown
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > context.storageBytesPerPlugin) return { ok: false, error: 'too_large' }
      state.values = next
      this.scheduleStorageFlush(pluginId)
      return { stored: true }
    }
    if (method.startsWith('log.')) {
      if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > 32) return { ok: false, error: 'invalid_request' }
      const level = method.slice('log.'.length) as PluginBrokerLogEntry['level']
      const values = args[0].map(normalizeLogText)
      if (values.some(value => value === null)) return { ok: false, error: 'invalid_request' }
      const entry: PluginBrokerLogEntry = { at: this.safeNow(), level, message: (values as string[]).join(' ').slice(0, PLUGIN_LOG_MESSAGE_MAX_LENGTH) }
      const records = this.logs.get(pluginId) ?? []
      records.push(entry)
      while (records.length > PLUGIN_LOG_MAX_ENTRIES) records.shift()
      this.logs.set(pluginId, records)
      return { logged: true }
    }
    return { ok: false, error: 'invalid_request' }
  }

  private loadStorage(pluginId: string, maxBytes: number): PluginStorageState {
    const existing = this.storage.get(pluginId)
    if (existing?.loaded) return existing
    const filePath = path.join(this.pluginsDirectory, pluginId, 'data', 'storage.json')
    let values: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    let available = true
    try {
      this.assertStorageDirectories(pluginId, false)
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new TypeError('unsafe plugin storage')
      const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
      const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
      try {
        const openedStat = fs.fstatSync(descriptor)
        if (!openedStat.isFile() || openedStat.size > maxBytes) throw new TypeError('unsafe plugin storage')
        const parsed = JSON.parse(fs.readFileSync(descriptor, 'utf8')) as unknown
        if (!isRecord(parsed) || !isJsonValue(parsed)) throw new TypeError('invalid plugin storage')
        values = Object.assign(Object.create(null) as Record<string, unknown>, parsed)
      } finally {
        fs.closeSync(descriptor)
      }
    } catch (error) {
      if (!isFsError(error, 'ENOENT')) available = false
    }
    const state: PluginStorageState = { values, loaded: true, available, maxBytes }
    this.storage.set(pluginId, state)
    if (!available) this.recordDiagnostic(pluginId, 'disabled', 'storage.read')
    return state
  }

  private ensureStorageDirectory(pluginId: string): void {
    this.assertStorageDirectories(pluginId, true)
  }

  private assertStorageDirectories(pluginId: string, createDataDirectory: boolean): void {
    const pluginDirectory = path.join(this.pluginsDirectory, pluginId)
    const dataDirectory = path.join(pluginDirectory, 'data')
    for (const directory of [this.pluginsDirectory, pluginDirectory]) {
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()
        || path.resolve(fs.realpathSync(directory)) !== path.resolve(directory)) {
        throw new TypeError('unsafe plugin directory')
      }
    }
    if (createDataDirectory) {
      try { fs.mkdirSync(dataDirectory, { mode: 0o700 }) } catch (error) {
        if (!isFsError(error, 'EEXIST')) throw error
      }
    }
    try {
      const dataStat = fs.lstatSync(dataDirectory)
      if (!dataStat.isDirectory() || dataStat.isSymbolicLink()
        || path.resolve(fs.realpathSync(dataDirectory)) !== path.resolve(dataDirectory)) {
        throw new TypeError('unsafe plugin storage directory')
      }
    } catch (error) {
      if (!createDataDirectory && isFsError(error, 'ENOENT')) return
      throw error
    }
  }

  private scheduleStorageFlush(pluginId: string): void {
    if (this.storageTimers.has(pluginId)) return
    const timer = setTimeout(() => {
      this.storageTimers.delete(pluginId)
      this.flushStorage(pluginId)
    }, PLUGIN_STORAGE_FLUSH_DELAY_MS)
    this.storageTimers.set(pluginId, timer)
  }

  private safeContext(pluginId: string): PluginBrokerContext | null {
    try {
      const context = this.getContext(pluginId)
      return context && context.pluginsEnabled && context.enabled ? context : null
    } catch {
      return null
    }
  }

  private reject(pluginId: string, id: string, error: PluginErrorCode, method?: string): RpcResponse {
    this.recordDiagnostic(pluginId, error, method)
    return { id, ok: false, error }
  }

  private recordDiagnostic(pluginId: string, code: PluginErrorCode, method?: string): void {
    if (!PLUGIN_ID.test(pluginId)) return
    const records = this.diagnostics.get(pluginId) ?? []
    records.push({ at: this.safeNow(), code, ...(method ? { method: method.slice(0, 64) } : {}) })
    while (records.length > PLUGIN_LOG_MAX_ENTRIES) records.shift()
    this.diagnostics.set(pluginId, records)
  }

  private safeNow(): number {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : Date.now()
    } catch {
      return Date.now()
    }
  }
}
