import { randomUUID } from 'node:crypto'
import { PluginFeedQueue } from './plugin-feed-queue.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'
import type { PluginErrorCode, PluginFeedItem, PluginLocalizedText } from '../src/types/plugin.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { isValidPluginNetworkHost } from './plugin-manifest.ts'
import { normalizePresentationMessage } from './presentation-controller.ts'

export const PLUGIN_FEED_RATE_WINDOW_MS = 10 * 60 * 1_000
export const PLUGIN_FEED_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000
export const PLUGIN_FEED_DEFAULT_PLUGIN_RATE = 5
export const PLUGIN_FEED_DEFAULT_GLOBAL_RATE = 60
export const PLUGIN_FEED_MAX_QUEUE_DEPTH = 8
export const PLUGIN_FEED_MAX_PER_PLUGIN = 100
export const PLUGIN_FEED_MAX_CENTER_ITEMS = 500
export const PLUGIN_FEED_MAX_DEDUPE_KEYS = 500
export const PLUGIN_FEED_DEFAULT_TTL_MS = 6_000

export interface PluginFeedGlobalState {
  pluginsEnabled: boolean
  dndEnabled: boolean
  rateLimitPer10Min?: number
}

export interface PluginFeedPluginState {
  enabled: boolean
  muted: boolean
  targetPetId?: string | null
  rateLimitPer10Min?: number
  name: PluginLocalizedText
}

export interface PluginFeedControllerOptions {
  emit: (item: PluginFeedItem) => void
  onNotificationsChanged?: (unreadCount: number) => void
  isPetVisible: () => boolean
  getGlobalState: () => PluginFeedGlobalState
  getPluginState: (pluginId: string) => PluginFeedPluginState | null
  isLinkHostAllowed: (pluginId: string, host: string) => boolean
  resolveIconUrl?: (pluginId: string, relativePath: string) => string | null
  now?: () => number
  createId?: () => string
}

export interface PluginFeedNotification {
  item: PluginFeedItem
  read: boolean
}

export type PluginFeedSubmitResult =
  | { accepted: true; itemId: string; queued: number; delivery: 'bubble' | 'center' }
  | {
    accepted: false
    error: PluginErrorCode
    itemId?: string
    queued?: number
    retryAfterMs?: number
  }

export type PluginFeedRateResult =
  | { allowed: true }
  | { allowed: false; error: 'disabled' | 'rate_limited'; retryAfterMs?: number }

interface NormalizedFeedInput {
  title: string
  body: string
  link?: string
  icon?: string
  priority: 'low' | 'normal'
  ttlMs: number
  dedupeKey?: string
}

interface CenterRecord {
  item: PluginFeedItem
  read: boolean
}

type FeedInputResult =
  | { ok: true; value: NormalizedFeedInput }
  | { ok: false; error: Extract<PluginErrorCode, 'invalid_request' | 'host_not_allowed'> }

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const FEED_ID = /^[A-Za-z0-9_-]{8,80}$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const ICON_FORBIDDEN = /[\u0000-\u001f\u007f<>:"|?*%]/
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePluginId(value: unknown): value is string {
  return typeof value === 'string' && PLUGIN_ID.test(value)
}

function normalizeLocalizedName(value: unknown): PluginLocalizedText | null {
  if (!isRecord(value)) return null
  const zhTW = normalizePresentationMessage(value['zh-TW'])
  const enUS = normalizePresentationMessage(value['en-US'])
  if (!zhTW || !enUS || zhTW.length > 48 || enUS.length > 48) return null
  return { 'zh-TW': zhTW, 'en-US': enUS }
}

function normalizeIconPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null
  const normalized = value.normalize('NFC')
  if (normalized.startsWith('/') || normalized.includes('\\') || ICON_FORBIDDEN.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..'
    || /[. ]$/.test(segment)
    || WINDOWS_DEVICE_NAME.test((segment.split('.')[0] ?? '').replace(/[. ]+$/, '')))) return null
  const extension = normalized.slice(normalized.lastIndexOf('.')).toLowerCase()
  if (extension !== '.png' && extension !== '.webp') return null
  return normalized
}

function normalizeIconUrl(value: unknown, pluginId: string): string | null {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin'
      || url.username || url.password || url.port || url.search || url.hash
      || !url.pathname.startsWith(`/${pluginId}/`)) return null
    const decodedPath = decodeURIComponent(url.pathname)
    if (!decodedPath.startsWith(`/${pluginId}/`)) return null
    const relativePath = decodedPath.slice(pluginId.length + 2)
    if (!normalizeIconPath(relativePath)) return null
    return url.href
  } catch {
    return null
  }
}

function normalizeDedupeKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || CONTROL_CHARACTERS.test(value)) return null
  const normalized = value.normalize('NFKC').trim()
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null
}

function normalizeLink(
  value: unknown,
  pluginId: string,
  isLinkHostAllowed: PluginFeedControllerOptions['isLinkHostAllowed'],
): { ok: true; value: string } | { ok: false; error: 'invalid_request' | 'host_not_allowed' } {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048
    || /[\u0000-\u0020\u007f]/.test(value)) return { ok: false, error: 'invalid_request' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: 'invalid_request' }
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !isValidPluginNetworkHost(host, false)) return { ok: false, error: 'host_not_allowed' }
  try {
    if (!isLinkHostAllowed(pluginId, host)) return { ok: false, error: 'host_not_allowed' }
  } catch {
    return { ok: false, error: 'host_not_allowed' }
  }
  const normalized = url.href
  return normalized.length <= 2_048
    ? { ok: true, value: normalized }
    : { ok: false, error: 'invalid_request' }
}

function normalizeFeedInput(
  pluginId: string,
  input: unknown,
  isLinkHostAllowed: PluginFeedControllerOptions['isLinkHostAllowed'],
  resolveIconUrl?: PluginFeedControllerOptions['resolveIconUrl'],
): FeedInputResult {
  if (!isRecord(input)) return { ok: false, error: 'invalid_request' }
  const allowedKeys = new Set(['title', 'body', 'link', 'icon', 'priority', 'ttlMs', 'dedupeKey'])
  if (Object.keys(input).some(key => !allowedKeys.has(key))) return { ok: false, error: 'invalid_request' }

  const title = normalizePresentationMessage(input.title)
  const body = normalizePresentationMessage(input.body)
  if (!title || title.length > 60 || !body || body.length > 240) return { ok: false, error: 'invalid_request' }

  const priority = input.priority === undefined ? 'normal' : input.priority
  if (priority !== 'normal' && priority !== 'low') return { ok: false, error: 'invalid_request' }
  const ttlMs = input.ttlMs === undefined ? PLUGIN_FEED_DEFAULT_TTL_MS : input.ttlMs
  if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15_000) {
    return { ok: false, error: 'invalid_request' }
  }

  let link: string | undefined
  if (input.link !== undefined) {
    const normalized = normalizeLink(input.link, pluginId, isLinkHostAllowed)
    if (!normalized.ok) return normalized
    link = normalized.value
  }

  let icon: string | undefined
  if (input.icon !== undefined) {
    icon = normalizeIconPath(input.icon) ?? undefined
    if (!icon) return { ok: false, error: 'invalid_request' }
    if (resolveIconUrl) {
      let resolved: unknown
      try { resolved = resolveIconUrl(pluginId, icon) } catch { return { ok: false, error: 'invalid_request' } }
      if (resolved === null) return { ok: false, error: 'invalid_request' }
      icon = normalizeIconUrl(resolved, pluginId) ?? undefined
      if (!icon) return { ok: false, error: 'invalid_request' }
    } else {
      return { ok: false, error: 'invalid_request' }
    }
  }

  let dedupeKey: string | undefined
  if (input.dedupeKey !== undefined) {
    dedupeKey = normalizeDedupeKey(input.dedupeKey) ?? undefined
    if (!dedupeKey) return { ok: false, error: 'invalid_request' }
  }

  return {
    ok: true,
    value: {
      title,
      body,
      ...(link ? { link } : {}),
      ...(icon ? { icon } : {}),
      priority,
      ttlMs,
      ...(dedupeKey ? { dedupeKey } : {}),
    },
  }
}

function safeRateLimit(value: unknown, fallback: number, min: number, max: number): number | null {
  const limit = value === undefined ? fallback : value
  return typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= min && limit <= max
    ? limit
    : null
}

function cloneFeedItem(item: PluginFeedItem): PluginFeedItem {
  return { ...item, pluginName: { ...item.pluginName } }
}

export class PluginFeedController {
  private readonly emitItem: (item: PluginFeedItem) => void
  private readonly onNotificationsChanged?: (unreadCount: number) => void
  private readonly isPetVisible: () => boolean
  private readonly getGlobalState: () => PluginFeedGlobalState
  private readonly getPluginState: (pluginId: string) => PluginFeedPluginState | null
  private readonly isLinkHostAllowed: PluginFeedControllerOptions['isLinkHostAllowed']
  private readonly resolveIconUrl?: PluginFeedControllerOptions['resolveIconUrl']
  private readonly now: () => number
  private readonly createId: () => string
  private readonly recentGlobal = new SlidingWindowLimiter(PLUGIN_FEED_RATE_WINDOW_MS, PLUGIN_FEED_DEFAULT_GLOBAL_RATE)
  private readonly recentByPlugin = new Map<string, SlidingWindowLimiter>()
  private readonly recentDedupe = new Map<string, number>()
  private readonly queue = new PluginFeedQueue()
  private readonly queueTtlMs = new Map<string, number>()
  private readonly center: CenterRecord[] = []
  private activeId: string | null = null
  private hiddenLatest: { item: PluginFeedItem; ttlMs: number } | null = null
  private lastVisibility: boolean | null = null

  constructor(options: PluginFeedControllerOptions) {
    this.emitItem = options.emit
    this.onNotificationsChanged = options.onNotificationsChanged
    this.isPetVisible = options.isPetVisible
    this.getGlobalState = options.getGlobalState
    this.getPluginState = options.getPluginState
    this.isLinkHostAllowed = options.isLinkHostAllowed
    this.resolveIconUrl = options.resolveIconUrl
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  submit(pluginId: string, input: unknown): PluginFeedSubmitResult {
    const now = this.readNow()
    if (now === null || !normalizePluginId(pluginId)) return { accepted: false, error: 'invalid_request' }
    this.observeVisibility(now)

    const global = this.readGlobalState()
    const plugin = this.readPluginState(pluginId)
    if (!global || !plugin || !global.pluginsEnabled || !plugin.enabled) {
      return { accepted: false, error: 'disabled' }
    }

    const normalized = normalizeFeedInput(pluginId, input, this.isLinkHostAllowed, this.resolveIconUrl)
    if (!normalized.ok) return { accepted: false, error: normalized.error }
    const dedupeIdentity = normalized.value.dedupeKey
      ? `${pluginId}\u0000${normalized.value.dedupeKey}`
      : null
    if (dedupeIdentity && this.isDuplicate(dedupeIdentity, now)) {
      return { accepted: false, error: 'duplicate' }
    }

    const item = this.createFeedItem(pluginId, plugin.name, plugin.targetPetId ?? null, normalized.value, now)
    if (!item) return { accepted: false, error: 'invalid_request' }

    if (plugin.muted || global.dndEnabled) {
      if (dedupeIdentity) this.rememberDedupe(dedupeIdentity, now)
      this.addToCenter(item, false)
      return { accepted: true, itemId: item.id, queued: this.queue.length, delivery: 'center' }
    }

    const rate = this.readRateLimits(global, plugin)
    if (!rate) return { accepted: false, error: 'disabled' }
    const retryAfterMs = this.rateLimitRetryAfter(pluginId, rate.plugin, rate.global, now)
    if (retryAfterMs !== null) {
      if (dedupeIdentity) this.rememberDedupe(dedupeIdentity, now)
      this.addToCenter(item, false)
      return { accepted: false, error: 'rate_limited', itemId: item.id, queued: this.queue.length, retryAfterMs }
    }

    this.recordRate(pluginId, now)
    if (dedupeIdentity) this.rememberDedupe(dedupeIdentity, now)
    this.addToCenter(item, false)

    if (!this.readVisibility()) {
      this.hiddenLatest = { item, ttlMs: normalized.value.ttlMs }
      return { accepted: true, itemId: item.id, queued: this.queue.length, delivery: 'center' }
    }
    if (this.queue.length >= PLUGIN_FEED_MAX_QUEUE_DEPTH) {
      return { accepted: false, error: 'queue_full', itemId: item.id, queued: this.queue.length }
    }

    this.queue.push(item)
    this.queueTtlMs.set(item.id, normalized.value.ttlMs)
    this.emitNext(now)
    return { accepted: true, itemId: item.id, queued: this.queue.length, delivery: 'bubble' }
  }

  /** Adds a host-owned notice to the center without starting a plugin bubble or rate budget. */
  addSystemNotification(pluginId: unknown, pluginName: unknown, title: unknown, body: unknown): boolean {
    const now = this.readNow()
    if (now === null || !normalizePluginId(pluginId)) return false
    const name = normalizeLocalizedName(pluginName)
    const safeTitle = normalizePresentationMessage(title)
    const safeBody = normalizePresentationMessage(body)
    if (!name || !safeTitle || safeTitle.length > 60 || !safeBody || safeBody.length > 240) return false
    const expiresAt = now + PLUGIN_FEED_DEFAULT_TTL_MS
    if (!Number.isSafeInteger(expiresAt)) return false
    let id: unknown
    try { id = this.createId() } catch { return false }
    if (typeof id !== 'string' || !FEED_ID.test(id) || this.center.some(record => record.item.id === id)) return false
    this.addToCenter({
      id,
      pluginId,
      pluginName: name,
      title: safeTitle,
      body: safeBody,
      priority: 'normal',
      createdAt: now,
      expiresAt,
    }, false)
    return true
  }

  /** Shares the same sliding per-plugin/global budget with non-feed RPCs such as reactions. */
  consumeRateLimit(pluginId: string): PluginFeedRateResult {
    const now = this.readNow()
    if (now === null || !normalizePluginId(pluginId)) return { allowed: false, error: 'disabled' }
    const global = this.readGlobalState()
    const plugin = this.readPluginState(pluginId)
    if (!global || !plugin || !global.pluginsEnabled || global.dndEnabled || !plugin.enabled) {
      return { allowed: false, error: 'disabled' }
    }
    const limits = this.readRateLimits(global, plugin)
    if (!limits) return { allowed: false, error: 'disabled' }
    const retryAfterMs = this.rateLimitRetryAfter(pluginId, limits.plugin, limits.global, now)
    if (retryAfterMs !== null) return { allowed: false, error: 'rate_limited', retryAfterMs }
    this.recordRate(pluginId, now)
    return { allowed: true }
  }

  /** Call after the host's pet visibility changes to flush only the newest hidden item. */
  onVisibilityChanged(): void {
    const now = this.readNow()
    if (now !== null) this.observeVisibility(now)
  }

  complete(itemId: unknown): boolean {
    const now = this.readNow()
    if (now === null || typeof itemId !== 'string') return false
    this.observeVisibility(now)
    const previousActiveId = this.activeId
    this.discardExpiredQueue(now)
    if (previousActiveId && !this.activeId) this.emitNext(now)
    if (!this.activeId || itemId !== this.activeId) return false
    const current = this.queue.peek()
    if (!current || current.id !== itemId) return false
    this.queue.shift()
    this.queueTtlMs.delete(itemId)
    this.activeId = null
    this.emitNext(now)
    return true
  }

  getQueueDepth(): number {
    const now = this.readNow()
    if (now !== null) {
      const previousActiveId = this.activeId
      this.discardExpiredQueue(now)
      if (previousActiveId && !this.activeId) this.emitNext(now)
    }
    return this.queue.length
  }

  listNotifications(pluginId?: string): PluginFeedNotification[] {
    if (pluginId !== undefined && !normalizePluginId(pluginId)) return []
    return this.center
      .filter(record => pluginId === undefined || record.item.pluginId === pluginId)
      .slice()
      .reverse()
      .map(record => ({ item: cloneFeedItem(record.item), read: record.read }))
  }

  markRead(itemId: unknown): boolean {
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 80) return false
    const record = this.center.find(candidate => candidate.item.id === itemId)
    if (!record || record.read) return false
    record.read = true
    this.notifyNotificationsChanged()
    return true
  }

  clear(pluginId?: string): number {
    if (pluginId !== undefined && !normalizePluginId(pluginId)) return 0
    const initialCount = this.center.length
    for (let index = this.center.length - 1; index >= 0; index -= 1) {
      const record = this.center[index]
      if (record && (pluginId === undefined || record.item.pluginId === pluginId)) this.center.splice(index, 1)
    }
    const removed = initialCount - this.center.length
    if (removed > 0) this.notifyNotificationsChanged()
    return removed
  }

  unreadCount(pluginId?: string): number {
    if (pluginId !== undefined && !normalizePluginId(pluginId)) return 0
    return this.center.filter(record => !record.read
      && (pluginId === undefined || record.item.pluginId === pluginId)).length
  }

  private readNow(): number | null {
    try {
      const now = this.now()
      return Number.isSafeInteger(now) && now >= 0 ? now : null
    } catch {
      return null
    }
  }

  private readVisibility(): boolean {
    try { return this.isPetVisible() === true } catch { return false }
  }

  private readGlobalState(): PluginFeedGlobalState | null {
    try {
      const state = this.getGlobalState()
      if (!isRecord(state) || typeof state.pluginsEnabled !== 'boolean' || typeof state.dndEnabled !== 'boolean') return null
      const rate = safeRateLimit(state.rateLimitPer10Min, PLUGIN_FEED_DEFAULT_GLOBAL_RATE, 10, 300)
      if (rate === null) return null
      return { pluginsEnabled: state.pluginsEnabled, dndEnabled: state.dndEnabled, rateLimitPer10Min: rate }
    } catch {
      return null
    }
  }

  private readPluginState(pluginId: string): PluginFeedPluginState | null {
    try {
      const state = this.getPluginState(pluginId)
      if (!isRecord(state) || typeof state.enabled !== 'boolean' || typeof state.muted !== 'boolean') return null
      const name = normalizeLocalizedName(state.name)
      const rate = safeRateLimit(state.rateLimitPer10Min, PLUGIN_FEED_DEFAULT_PLUGIN_RATE, 1, 30)
      if (!name || rate === null) return null
      const targetPetId = state.targetPetId === undefined ? null : state.targetPetId
      if (targetPetId !== null && !isValidPetId(targetPetId, 64)) return null
      return { enabled: state.enabled, muted: state.muted, targetPetId, rateLimitPer10Min: rate, name }
    } catch {
      return null
    }
  }

  private readRateLimits(
    global: PluginFeedGlobalState,
    plugin: PluginFeedPluginState,
  ): { global: number; plugin: number } | null {
    const globalRate = safeRateLimit(global.rateLimitPer10Min, PLUGIN_FEED_DEFAULT_GLOBAL_RATE, 10, 300)
    const pluginRate = safeRateLimit(plugin.rateLimitPer10Min, PLUGIN_FEED_DEFAULT_PLUGIN_RATE, 1, 30)
    return globalRate === null || pluginRate === null ? null : { global: globalRate, plugin: pluginRate }
  }

  private createFeedItem(
    pluginId: string,
    pluginName: PluginLocalizedText,
    targetPetId: string | null,
    input: NormalizedFeedInput,
    now: number,
  ): PluginFeedItem | null {
    const expiresAt = now + input.ttlMs
    if (!Number.isSafeInteger(expiresAt)) return null
    let id: unknown
    try { id = this.createId() } catch { return null }
    if (typeof id !== 'string' || !FEED_ID.test(id) || this.center.some(record => record.item.id === id)) return null
    return {
      id,
      pluginId,
      ...(targetPetId ? { targetPetId } : {}),
      pluginName,
      ...(input.icon ? { iconUrl: input.icon } : {}),
      title: input.title,
      body: input.body,
      ...(input.link ? { link: input.link } : {}),
      priority: input.priority,
      createdAt: now,
      expiresAt,
    }
  }

  private isDuplicate(identity: string, now: number): boolean {
    this.pruneDedupe(now)
    return this.recentDedupe.has(identity)
  }

  private rememberDedupe(identity: string, now: number): void {
    this.pruneDedupe(now)
    this.recentDedupe.delete(identity)
    this.recentDedupe.set(identity, now)
    while (this.recentDedupe.size > PLUGIN_FEED_MAX_DEDUPE_KEYS) {
      const oldest = this.recentDedupe.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.recentDedupe.delete(oldest)
    }
  }

  private pruneDedupe(now: number): void {
    for (const [identity, timestamp] of this.recentDedupe) {
      if (now - timestamp >= PLUGIN_FEED_DEDUPE_WINDOW_MS) this.recentDedupe.delete(identity)
    }
  }

  private pruneRates(now: number): void {
    this.recentGlobal.prune(now)
    for (const [pluginId, limiter] of this.recentByPlugin) {
      limiter.prune(now)
      if (limiter.size > 0) this.recentByPlugin.set(pluginId, limiter)
      else this.recentByPlugin.delete(pluginId)
    }
  }

  private rateLimitRetryAfter(pluginId: string, pluginLimit: number, globalLimit: number, now: number): number | null {
    this.pruneRates(now)
    const pluginRate = this.recentByPlugin.get(pluginId)?.check(now, pluginLimit)
    if (pluginRate && !pluginRate.allowed) return Math.min(PLUGIN_FEED_RATE_WINDOW_MS, pluginRate.retryAfterMs)
    const globalRate = this.recentGlobal.check(now, globalLimit)
    return globalRate.allowed ? null : Math.min(PLUGIN_FEED_RATE_WINDOW_MS, globalRate.retryAfterMs)
  }

  private recordRate(pluginId: string, now: number): void {
    this.recentGlobal.record(now, pluginId)
    let pluginRecent = this.recentByPlugin.get(pluginId)
    if (!pluginRecent) {
      pluginRecent = new SlidingWindowLimiter(PLUGIN_FEED_RATE_WINDOW_MS, PLUGIN_FEED_DEFAULT_PLUGIN_RATE)
      this.recentByPlugin.set(pluginId, pluginRecent)
    }
    pluginRecent.record(now)
  }

  private addToCenter(item: PluginFeedItem, read: boolean): void {
    this.center.push({ item: cloneFeedItem(item), read })
    const pluginIndexes = this.center
      .map((record, index) => record.item.pluginId === item.pluginId ? index : -1)
      .filter(index => index >= 0)
    while (pluginIndexes.length > PLUGIN_FEED_MAX_PER_PLUGIN) {
      const oldestIndex = pluginIndexes.shift()
      if (oldestIndex !== undefined) this.center.splice(oldestIndex, 1)
      for (let index = 0; index < pluginIndexes.length; index += 1) {
        const nextIndex = pluginIndexes[index]
        if (nextIndex !== undefined && oldestIndex !== undefined && nextIndex > oldestIndex) pluginIndexes[index] = nextIndex - 1
      }
    }
    while (this.center.length > PLUGIN_FEED_MAX_CENTER_ITEMS) this.center.shift()
    this.notifyNotificationsChanged()
  }

  private notifyNotificationsChanged(): void {
    try { this.onNotificationsChanged?.(this.unreadCount()) } catch {}
  }

  private markCenterRead(itemId: string): void {
    const record = this.center.find(candidate => candidate.item.id === itemId)
    if (record) record.read = true
  }

  private discardExpiredQueue(now: number): void {
    for (const item of this.queue.values()) {
      if (item && item.expiresAt <= now) {
        if (item.id === this.activeId) this.activeId = null
        this.queueTtlMs.delete(item.id)
        this.queue.remove(item.id)
      }
    }
  }

  private canDisplay(pluginId: string): boolean {
    const global = this.readGlobalState()
    const plugin = this.readPluginState(pluginId)
    return Boolean(global?.pluginsEnabled && !global.dndEnabled && plugin?.enabled && !plugin.muted && this.readVisibility())
  }

  private observeVisibility(now: number): void {
    const visible = this.readVisibility()
    if (this.lastVisibility === null) {
      this.lastVisibility = visible
      return
    }
    if (this.lastVisibility === visible) return

    if (this.lastVisibility && !visible) {
      const latestPending = this.queue.last() ?? null
      const ttlMs = latestPending ? this.queueTtlMs.get(latestPending.id) : undefined
      this.hiddenLatest = latestPending && ttlMs !== undefined
        ? { item: cloneFeedItem(latestPending), ttlMs }
        : null
      if (latestPending) {
        const record = this.center.find(candidate => candidate.item.id === latestPending.id)
        if (record && record.read) {
          record.read = false
          this.notifyNotificationsChanged()
        }
      }
      this.queue.clear()
      this.queueTtlMs.clear()
      this.activeId = null
    } else if (!this.lastVisibility && visible) {
      const latest = this.hiddenLatest
      this.hiddenLatest = null
      const expiresAt = latest ? now + latest.ttlMs : Number.NaN
      if (latest && Number.isSafeInteger(expiresAt) && this.canDisplay(latest.item.pluginId)) {
        const refreshed = { ...latest.item, expiresAt }
        this.queue.push(refreshed)
        this.queueTtlMs.set(refreshed.id, latest.ttlMs)
        this.emitNext(now)
      }
    }
    this.lastVisibility = visible
  }

  private emitNext(now: number): void {
    if (this.activeId || !this.readVisibility()) return
    this.discardExpiredQueue(now)
    while (this.queue.length > 0) {
      const item = this.queue.peek()
      if (!item) return
      if (!this.canDisplay(item.pluginId)) {
        this.queue.shift()
        this.queueTtlMs.delete(item.id)
        continue
      }
      this.activeId = item.id
      try {
        this.emitItem(cloneFeedItem(item))
        this.markCenterRead(item.id)
        this.notifyNotificationsChanged()
        return
      } catch {
        this.activeId = null
        this.queue.shift()
        this.queueTtlMs.delete(item.id)
      }
    }
  }
}
