import {
  SOURCE_DEFINITIONS,
  localDateKey,
  parseSource,
  parseTiboPublicProfile,
  parseTiboSelfReplies,
  sortUpdates,
  truncate,
  withVersionComparisons,
} from './core.js'

const STATE_KEY = 'radar-state'
const STATE_SCHEMA_VERSION = 4
const HEARTBEAT_SECONDS = 300
const MAX_UPDATES = 330
const MAX_KNOWN_IDS = 800
// 面板訊息上限是 256 KB（PLUGIN_UI_MESSAGE_MAX_BYTES）；超過時 postMessage 會被拒絕、面板整片空白，所以預留餘裕。
const STATE_MESSAGE_BUDGET_BYTES = 230 * 1024
const MAX_CONVERSATION_LOOKUPS = 5
const RETRY_DELAYS_SECONDS = Object.freeze([300, 900, 1800, 3600])
const SOURCE_BY_ID = new Map(SOURCE_DEFINITIONS.map(source => [source.id, source]))
const CODEX_RESET_STATUS_URL = 'https://codex-resets.com/api/v1/status'
const OBSERVED_RESET_DEDUPE_MS = 12 * 60 * 60 * 1000

function isoNow(now) {
  return new Date(now()).toISOString()
}

function errorCode(error) {
  const value = error && typeof error === 'object'
    ? (typeof error.code === 'string' ? error.code : typeof error.message === 'string' ? error.message : '')
    : ''
  return /^[a-z0-9_]{3,64}$/.test(value) ? value : 'source_unavailable'
}

function isIsoDateTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isCodexResetIsoDateTime(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) return false
  return Number.isFinite(Date.parse(value))
}

function validCodexResetId(value) {
  return typeof value === 'string' && /^(?:\d{1,20}|observed-\d{1,20})$/.test(value)
}

function safeAnnouncementUrl(value) {
  if (typeof value !== 'string' || value.length > 256) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'x.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /^\/thsottiaux\/status\/\d{1,19}$/.test(url.pathname)
      ? url.href
      : null
  } catch {
    return null
  }
}

function normalizeStoredCodexReset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !value.latestReset || typeof value.latestReset !== 'object' || Array.isArray(value.latestReset)
    || !validCodexResetId(value.latestReset.id)
    || typeof value.latestReset.resetType !== 'string' || !/^[A-Za-z-]{1,32}$/.test(value.latestReset.resetType)
    || !isCodexResetIsoDateTime(value.latestReset.announcedAt)
    || typeof value.latestReset.text !== 'string' || value.latestReset.text.length > 280
    || !Number.isSafeInteger(value.stats?.total) || value.stats.total < 0 || value.stats.total > 10_000_000
    || !isCodexResetIsoDateTime(value.stats?.lastResetAt)) return null
  const scheduledAt = value.scheduledReset?.at
  const sourceUrl = safeAnnouncementUrl(value.latestReset.sourceUrl)
  return {
    latestReset: {
      id: value.latestReset.id,
      resetType: value.latestReset.resetType.toLowerCase(),
      announcedAt: value.latestReset.announcedAt,
      text: value.latestReset.text,
      ...(sourceUrl ? { sourceUrl } : {}),
    },
    scheduledReset: value.scheduledReset && isCodexResetIsoDateTime(scheduledAt) ? { at: scheduledAt } : null,
    stats: { total: value.stats.total, lastResetAt: value.stats.lastResetAt },
  }
}

function scheduledResetFrom(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of ['at', 'scheduled_at', 'reset_at', 'announced_at']) {
    const at = value[key]
    if (isCodexResetIsoDateTime(at) && Date.parse(at) > now) return { at }
  }
  return null
}

export function parseCodexResetsStatus(input, now = Date.now()) {
  let value = input
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value.data : null
  const latest = data && typeof data === 'object' && !Array.isArray(data) ? data.latest_reset : null
  const stats = data && typeof data === 'object' && !Array.isArray(data) ? data.stats : null
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)
    || !validCodexResetId(latest.id)
    || typeof latest.reset_type !== 'string' || !/^[A-Za-z-]{1,32}$/.test(latest.reset_type)
    || !isCodexResetIsoDateTime(latest.announced_at)
    || typeof latest.text !== 'string' || latest.text.length > 10_000
    || !stats || typeof stats !== 'object' || Array.isArray(stats)
    || !Number.isSafeInteger(stats.total) || stats.total < 0 || stats.total > 10_000_000
    || !isCodexResetIsoDateTime(stats.last_reset_at)
    || (stats.days_since_last !== undefined && (!Number.isFinite(stats.days_since_last) || stats.days_since_last < 0 || stats.days_since_last > 100_000))
    || (stats.avg_interval_days !== undefined && (!Number.isFinite(stats.avg_interval_days) || stats.avg_interval_days < 0 || stats.avg_interval_days > 100_000))) return null
  const source = latest.source && typeof latest.source === 'object' && !Array.isArray(latest.source) ? latest.source : null
  if (source && ((source.type !== undefined && !['x_post', 'observed'].includes(source.type))
    || (source.author !== undefined && (typeof source.author !== 'string' || source.author.length > 80)))) return null
  const sourceUrl = safeAnnouncementUrl(source?.url)
  return normalizeStoredCodexReset({
    latestReset: {
      id: latest.id,
      resetType: latest.reset_type.toLowerCase(),
      announcedAt: latest.announced_at,
      text: latest.text.slice(0, 280),
      ...(sourceUrl ? { sourceUrl } : {}),
    },
    scheduledReset: scheduledResetFrom(data.scheduled_reset, now),
    stats: { total: stats.total, lastResetAt: stats.last_reset_at },
  })
}

function sameObservedReset(left, right) {
  if (!left || !right || (!left.id.startsWith('observed-') && !right.id.startsWith('observed-'))) return false
  return Math.abs(Date.parse(left.announcedAt) - Date.parse(right.announcedAt)) <= OBSERVED_RESET_DEDUPE_MS
}

function shouldNotifyCodexReset(previous, next, lastNotified) {
  if (!previous || !next || previous.latestReset.id === next.latestReset.id) return false
  if (sameObservedReset(previous.latestReset, next.latestReset)) return false
  if (lastNotified && (lastNotified.id === next.latestReset.id || sameObservedReset(lastNotified, next.latestReset))) return false
  return true
}

function resetTypeLabel(value) {
  return ({ regular: '定期重設', manual: '手動重設', emergency: '緊急重設', scheduled: '排定重設', observed: '觀測到重設' })[value] ?? '重設'
}

function isSafeSourceUrl(definition, value) {
  if (typeof value !== 'string' || value.length > 500) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false
    if (definition.id === 'tibo-x') return url.hostname === 'x.com' && /^\/thsottiaux\/status\/\d{1,19}$/.test(url.pathname) && !url.search
    if (definition.id === 'claude-code') return url.hostname === 'github.com' && url.pathname.startsWith('/anthropics/claude-code/releases')
    const expected = new URL(definition.publicUrl)
    return url.hostname === expected.hostname && url.pathname.startsWith(expected.pathname)
  } catch {
    return false
  }
}

function isStoredRetirement(value) {
  return Boolean(value) && typeof value === 'object'
    && typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 120
    && (value.date === null || /^\d{4}-\d{2}-\d{2}$/.test(value.date))
    && (value.replacement === null || (typeof value.replacement === 'string' && value.replacement.length <= 120))
}

function isStoredUpdate(value) {
  if (!value || typeof value !== 'object') return false
  const definition = SOURCE_BY_ID.get(value.sourceId)
  return Boolean(definition)
    && typeof value.id === 'string' && value.id.length <= 80
    && value.provider === definition.provider && value.product === definition.product
    && ['new-model', 'feature', 'developer-tool', 'api-change'].includes(value.category)
    && ['added', 'improved', 'fixed', 'deprecated', 'removed'].includes(value.changeType)
    && typeof value.title === 'string' && value.title.length <= 180
    && typeof value.summary === 'string' && value.summary.length <= 700
    && (value.publishedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(value.publishedAt))
    && (value.publishedAtTime === undefined || isIsoDateTime(value.publishedAtTime))
    && (value.version == null || (typeof value.version === 'string' && value.version.length <= 80))
    && (value.previousVersion === undefined || (typeof value.previousVersion === 'string' && value.previousVersion.length <= 80))
    && (value.postKind === undefined || ['root', 'self-reply'].includes(value.postKind))
    && (value.replyToId === undefined || /^x-\d{1,19}$/.test(value.replyToId))
    && (value.position === undefined || (Number.isSafeInteger(value.position) && value.position >= 0 && value.position < 1000))
    && (value.retirements === undefined || (Array.isArray(value.retirements) && value.retirements.length <= 12 && value.retirements.every(isStoredRetirement)))
    && isSafeSourceUrl(definition, value.sourceUrl)
}

function emptySource(definition) {
  return {
    id: definition.id,
    label: definition.label,
    provider: definition.provider,
    status: 'idle',
    itemCount: 0,
    publicUrl: definition.publicUrl,
    intervalSec: definition.intervalSec,
    failures: 0,
    nextAttemptAt: null,
  }
}

function normalizeSource(value, definition, itemCount) {
  const status = ['idle', 'loading', 'ok', 'stale', 'error'].includes(value?.status) ? value.status : 'idle'
  return {
    ...emptySource(definition),
    status: status === 'loading' ? 'stale' : status,
    itemCount,
    failures: Number.isSafeInteger(value?.failures) ? Math.max(0, Math.min(20, value.failures)) : 0,
    nextAttemptAt: isIsoDateTime(value?.nextAttemptAt) ? value.nextAttemptAt : null,
    ...(isIsoDateTime(value?.fetchedAt) ? { fetchedAt: value.fetchedAt } : {}),
    ...(typeof value?.error === 'string' && /^[a-z0-9_]{3,64}$/.test(value.error) ? { error: value.error } : {}),
  }
}

function emptyState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    sources: SOURCE_DEFINITIONS.map(emptySource),
    updates: [],
    codexReset: null,
    lastNotifiedCodexReset: null,
    knownIds: [],
    baselineSourceIds: [],
    lastCheckedAt: null,
    lastSuccessAt: null,
  }
}

function normalizeStoredState(value, now) {
  if (!value || typeof value !== 'object' || ![1, 2, 3, 4, 5].includes(value.schemaVersion)) return null
  const rawUpdates = Array.isArray(value.updates) ? value.updates.filter(isStoredUpdate) : []
  const today = localDateKey(new Date(now()), Intl.DateTimeFormat().resolvedOptions().timeZone)
  const updates = withVersionComparisons(rawUpdates.filter(update => update.sourceId !== 'tibo-x' || update.publishedAt === today)).slice(0, MAX_UPDATES)
  const rawSources = value.schemaVersion === 1 ? [value.source] : value.sources
  const sources = SOURCE_DEFINITIONS.map((definition) => {
    const stored = Array.isArray(rawSources) ? rawSources.find(source => source?.id === definition.id) : null
    return normalizeSource(stored, definition, updates.filter(update => update.sourceId === definition.id).length)
  })
  const knownIds = Array.isArray(value.knownIds)
    ? value.knownIds.filter(id => typeof id === 'string' && id.length <= 80).slice(0, MAX_KNOWN_IDS)
    : []
  const baselineSourceIds = value.schemaVersion === 1
    ? (knownIds.length ? ['openai-api'] : [])
    : (Array.isArray(value.baselineSourceIds)
        ? value.baselineSourceIds.filter(id => SOURCE_BY_ID.has(id)).slice(0, SOURCE_DEFINITIONS.length)
        : [])
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    sources,
    updates,
    codexReset: normalizeStoredCodexReset(value.codexReset),
    lastNotifiedCodexReset: value.lastNotifiedCodexReset
      && validCodexResetId(value.lastNotifiedCodexReset.id)
      && isCodexResetIsoDateTime(value.lastNotifiedCodexReset.announcedAt)
      ? { id: value.lastNotifiedCodexReset.id, announcedAt: value.lastNotifiedCodexReset.announcedAt }
      : null,
    knownIds,
    baselineSourceIds,
    lastCheckedAt: isIsoDateTime(value.lastCheckedAt) ? value.lastCheckedAt : null,
    lastSuccessAt: isIsoDateTime(value.lastSuccessAt) ? value.lastSuccessAt : null,
  }
}

function sourceUpdates(state, sourceId) {
  return state.updates.filter(update => update.sourceId === sourceId)
}

async function fetchSource(api, definition, now) {
  const sourceUrl = definition.kind === 'codex-reset-status' ? CODEX_RESET_STATUS_URL : definition.url
  const response = await api.net.fetch(sourceUrl, {
    headers: { accept: definition.kind === 'x-public-profile' ? 'text/html,application/xhtml+xml;q=0.9' : definition.kind === 'codex-reset-status' ? 'application/json' : 'text/markdown,application/json;q=0.9,text/plain;q=0.8' },
  })
  if (response.status < 200 || response.status >= 300 || typeof response.body !== 'string') {
    throw Object.assign(new Error('source_http_error'), { code: 'source_http_error' })
  }
  if (definition.kind === 'codex-reset-status') {
    const status = parseCodexResetsStatus(response.body, now())
    if (!status) throw Object.assign(new Error('source_format_changed'), { code: 'source_format_changed' })
    return status
  }
  if (definition.kind !== 'x-public-profile') {
    const updates = parseSource(definition, response.body)
    if (updates.length === 0) throw Object.assign(new Error('source_format_changed'), { code: 'source_format_changed' })
    return updates
  }

  const currentTime = new Date(now())
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const roots = parseTiboPublicProfile(response.body, { now: currentTime, timeZone })
  const replies = []
  for (const root of roots.slice(0, MAX_CONVERSATION_LOOKUPS)) {
    try {
      const rootId = root.id.slice(2)
      const detail = await api.net.fetch(`https://x.com/${definition.username}/status/${rootId}`, {
        headers: { accept: 'text/html,application/xhtml+xml;q=0.9' },
      })
      if (detail.status >= 200 && detail.status < 300 && typeof detail.body === 'string') {
        replies.push(...parseTiboSelfReplies(detail.body, { rootId, now: currentTime, timeZone }))
      }
    } catch {
      // A changed conversation page must not hide a valid profile post.
    }
  }
  return sortUpdates([...new Map([...roots, ...replies].map(update => [update.id, update])).values()]).slice(0, definition.maxItems)
}

function stateBytes(state) {
  return new TextEncoder().encode(JSON.stringify({ type: 'radar:state', state })).byteLength
}

// 從最舊的項目開始捨棄，直到狀態放得進面板訊息；Tibo 只保留當天貼文，通常已在最前面。
export function fitStateToMessageBudget(state) {
  let updates = state.updates
  while (updates.length > 0 && stateBytes({ ...state, updates }) > STATE_MESSAGE_BUDGET_BYTES) {
    updates = updates.slice(0, Math.max(0, updates.length - Math.max(1, Math.ceil(updates.length / 20))))
  }
  if (updates === state.updates) return state
  return {
    ...state,
    updates,
    sources: state.sources.map(source => (source.id === 'codex-resets'
      ? source
      : { ...source, itemCount: updates.filter(update => update.sourceId === source.id).length })),
  }
}

function versionParts(version) {
  return String(version ?? '').match(/\d+/g)?.map(Number) ?? []
}

export function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

// Claude Code 一個版本常有上百條變更，以版本為單位通知。只有比已知最新版本還新的版本才算新發布；
// 已知版本補抓到的條目（例如放寬保留上限後）安靜併入，避免升級後第一次同步就推送一大批。
export function notificationEntries(fresh, previousUpdates) {
  const knownVersions = previousUpdates
    .filter(update => update.sourceId === 'claude-code' && update.version)
    .map(update => update.version)
  const newestKnown = knownVersions.reduce((newest, version) => (newest && compareVersions(newest, version) >= 0 ? newest : version), null)
  const releases = new Map()
  const days = new Map()
  const entries = []
  for (const update of fresh) {
    // Claude Platform 同一天常一次公布好幾項，和面板一樣以日期合併成一則。
    if (update.sourceId === 'anthropic-platform' && update.publishedAt) {
      if (!days.has(update.publishedAt)) {
        const day = { kind: 'day', date: update.publishedAt, updates: [] }
        days.set(update.publishedAt, day)
        entries.push(day)
      }
      days.get(update.publishedAt).updates.push(update)
      continue
    }
    if (update.sourceId !== 'claude-code' || !update.version) { entries.push({ kind: 'update', update }); continue }
    if (knownVersions.includes(update.version) || (newestKnown && compareVersions(update.version, newestKnown) <= 0)) continue
    if (!releases.has(update.version)) {
      const release = { kind: 'release', version: update.version, updates: [] }
      releases.set(update.version, release)
      entries.push(release)
    }
    releases.get(update.version).updates.push(update)
  }
  const flattened = entries.map(entry => (entry.kind === 'day' && entry.updates.length === 1 ? { kind: 'update', update: entry.updates[0] } : entry))
  if (newestKnown) return flattened
  // 沒有任何已知版本時（例如儲存遺失），只通知最新的一版。
  const newest = [...releases.keys()].reduce((best, version) => (best && compareVersions(best, version) >= 0 ? best : version), null)
  return flattened.filter(entry => entry.kind !== 'release' || entry.version === newest)
}

const CHANGE_LABELS = Object.freeze({ added: '新增', improved: '改善', fixed: '修正', deprecated: '棄用', removed: '移除' })

function releaseCountsText(updates) {
  return Object.entries(CHANGE_LABELS)
    .map(([type, label]) => [label, updates.filter(update => update.changeType === type).length])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ')
}

function notificationBody(update) {
  return truncate(`${update.publishedAt ?? '日期未提供'} · ${CHANGE_LABELS[update.changeType] ?? '更新'} · ${update.title}`, 240)
}

export function createUpdateRadarRuntime(api, options = {}) {
  const now = options.now ?? (() => Date.now())
  let state = emptyState()
  let refreshPromise = null

  async function postState() {
    try { await api.ui.postMessage({ type: 'radar:state', state }) } catch {}
  }

  async function persist() {
    try { await api.storage.set(STATE_KEY, state) } catch (error) {
      await api.log.warn('Update Radar storage write failed', errorCode(error))
    }
  }

  async function notify(item) {
    try {
      await api.feed.notify(item)
    } catch (error) {
      await api.log.warn('Update Radar notification failed', errorCode(error))
    }
  }

  async function notifyNewUpdates(entries) {
    const isCritical = update => ['deprecated', 'removed'].includes(update.changeType)
    if (entries.length > 3) {
      const updates = entries.flatMap(entry => entry.updates ?? [entry.update])
      const key = entries.map(entry => (entry.kind === 'release' ? `claude-code-${entry.version}` : (entry.updates ?? [entry.update])[0].id)).join('-')
      await notify({
        title: `AI 更新雷達有 ${entries.length} 則新內容`,
        body: '開啟更新雷達查看來源、變更類型與版本差異。',
        link: updates[0].sourceUrl,
        priority: updates.some(isCritical) ? 'high' : 'normal',
        dedupeKey: `update-radar-batch-${key.slice(0, 95)}`,
      })
      return
    }
    for (const entry of [...entries].reverse()) {
      if (entry.kind === 'release') {
        const first = entry.updates[0]
        await notify({
          title: `Claude Code ${entry.version} 已發布`,
          body: truncate(`${first.publishedAt ?? '日期未提供'} · ${releaseCountsText(entry.updates)}`, 240),
          link: first.sourceUrl,
          priority: entry.updates.some(isCritical) ? 'high' : 'normal',
          dedupeKey: truncate(`update-radar-claude-code-${entry.version}`, 128),
        })
        continue
      }
      if (entry.kind === 'day') {
        const first = entry.updates[0]
        await notify({
          title: `Claude Platform 有 ${entry.updates.length} 項更新`,
          body: truncate(`${entry.date} · ${releaseCountsText(entry.updates)} · ${first.title}`, 240),
          link: first.sourceUrl,
          priority: entry.updates.some(isCritical) ? 'high' : 'normal',
          dedupeKey: `update-radar-${first.id}-day`,
        })
        continue
      }
      const { update } = entry
      const definition = SOURCE_BY_ID.get(update.sourceId)
      const title = update.sourceId === 'tibo-x'
        ? (update.postKind === 'self-reply' ? 'Tibo 有新的自我回文' : 'Tibo 有新的原始貼文')
        : `${definition?.label ?? 'AI'} 有新更新`
      await notify({
        title,
        body: update.sourceId === 'tibo-x' ? truncate(update.summary || update.title, 240) : notificationBody(update),
        link: update.sourceUrl,
        priority: isCritical(update) ? 'high' : 'normal',
        dedupeKey: `update-radar-${update.id}`,
      })
    }
  }

  async function readStoredState() {
    try {
      const stored = await api.storage.get(STATE_KEY)
      const normalized = stored.found ? normalizeStoredState(stored.value, now) : null
      if (normalized) state = normalized
    } catch (error) {
      await api.log.warn('Update Radar storage read failed', errorCode(error))
    }
  }

  function dueDefinitions(force, sourceIds) {
    const selected = sourceIds ? new Set(sourceIds) : null
    const current = now()
    return SOURCE_DEFINITIONS.filter((definition) => {
      if (selected && !selected.has(definition.id)) return false
      if (force) return true
      const source = state.sources.find(item => item.id === definition.id)
      return !source?.nextAttemptAt || Date.parse(source.nextAttemptAt) <= current
    })
  }

  async function notifyCodexReset(reset) {
    const formattedAt = new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(reset.announcedAt))
    try {
      await api.feed.notify({
        title: 'Codex 用量已重設',
        body: `${resetTypeLabel(reset.resetType)} · ${formattedAt}`,
        ...(reset.sourceUrl ? { link: reset.sourceUrl } : {}),
        priority: 'normal',
        dedupeKey: `codex-reset-${reset.id}`,
      })
    } catch (error) {
      await api.log.warn('Update Radar Codex reset notification failed', errorCode(error))
    }
  }

  async function performRefresh({ force = false, sourceIds = null } = {}) {
    const definitions = dueDefinitions(force, sourceIds)
    if (definitions.length === 0) {
      return state
    }
    const selectedIds = new Set(definitions.map(definition => definition.id))
    state = {
      ...state,
      sources: state.sources.map((source) => {
        if (!selectedIds.has(source.id)) return source
        const loadingSource = { ...source, status: 'loading' }
        delete loadingSource.error
        return loadingSource
      }),
      lastCheckedAt: isoNow(now),
    }
    await postState()

    const baseline = new Set(state.baselineSourceIds)
    const known = new Set(state.knownIds)
    const fresh = []
    let updates = state.updates.filter(update => !selectedIds.has(update.sourceId))
    const nextSources = [...state.sources]
    let codexReset = state.codexReset
    let lastNotifiedCodexReset = state.lastNotifiedCodexReset
    let resetToNotify = null
    let anySuccess = false

    for (const definition of definitions) {
      const sourceIndex = nextSources.findIndex(source => source.id === definition.id)
      const previous = nextSources[sourceIndex] ?? emptySource(definition)
      const checkedAt = isoNow(now)
      try {
        const collected = await fetchSource(api, definition, now)
        if (definition.id === 'codex-resets') {
          if (shouldNotifyCodexReset(codexReset, collected, lastNotifiedCodexReset)) {
            resetToNotify = collected.latestReset
            lastNotifiedCodexReset = { id: collected.latestReset.id, announcedAt: collected.latestReset.announcedAt }
          }
          codexReset = collected
          baseline.add(definition.id)
          nextSources[sourceIndex] = {
            ...emptySource(definition), status: 'ok', itemCount: 1, fetchedAt: checkedAt,
            nextAttemptAt: new Date(Date.parse(checkedAt) + definition.intervalSec * 1000).toISOString(),
          }
          anySuccess = true
          continue
        }
        updates.push(...collected)
        if (baseline.has(definition.id)) fresh.push(...collected.filter(update => !known.has(update.id)))
        for (const update of collected) known.add(update.id)
        baseline.add(definition.id)
        nextSources[sourceIndex] = {
          ...emptySource(definition), status: 'ok', itemCount: collected.length, fetchedAt: checkedAt,
          nextAttemptAt: new Date(Date.parse(checkedAt) + definition.intervalSec * 1000).toISOString(),
        }
        anySuccess = true
      } catch (error) {
        const retained = sourceUpdates(state, definition.id)
        updates.push(...retained)
        const failures = Math.min(20, previous.failures + 1)
        const retrySeconds = RETRY_DELAYS_SECONDS[Math.min(failures - 1, RETRY_DELAYS_SECONDS.length - 1)]
        nextSources[sourceIndex] = {
          ...emptySource(definition), status: retained.length || (definition.id === 'codex-resets' && codexReset) ? 'stale' : 'error',
          itemCount: definition.id === 'codex-resets' ? (codexReset ? 1 : 0) : retained.length,
          failures, error: errorCode(error),
          ...(previous.fetchedAt ? { fetchedAt: previous.fetchedAt } : {}),
          nextAttemptAt: new Date(Date.parse(checkedAt) + retrySeconds * 1000).toISOString(),
        }
        await api.log.warn(`Update Radar source failed: ${definition.id}`, errorCode(error))
      }
    }

    const completedAt = isoNow(now)
    const merged = [...new Map(sortUpdates(updates).map(update => [update.id, update])).values()]
    const compared = withVersionComparisons(merged).slice(0, MAX_UPDATES)
    const previousUpdates = state.updates
    state = fitStateToMessageBudget({
      schemaVersion: STATE_SCHEMA_VERSION,
      sources: nextSources.map(source => ({
        ...source,
        itemCount: source.id === 'codex-resets' ? (codexReset ? 1 : 0) : compared.filter(update => update.sourceId === source.id).length,
      })),
      updates: compared,
      codexReset,
      lastNotifiedCodexReset,
      knownIds: [...new Set([...compared.map(update => update.id), ...known])].slice(0, MAX_KNOWN_IDS),
      baselineSourceIds: [...baseline],
      lastCheckedAt: completedAt,
      lastSuccessAt: anySuccess ? completedAt : state.lastSuccessAt,
    })
    await persist()
    await postState()
    await notifyNewUpdates(notificationEntries(fresh, previousUpdates))
    if (resetToNotify) await notifyCodexReset(resetToNotify)
    return state
  }

  function refresh(options) {
    if (refreshPromise) return refreshPromise
    refreshPromise = performRefresh(options).finally(() => { refreshPromise = null })
    return refreshPromise
  }

  async function start() {
    await readStoredState()
    await postState()
    api.ui.onMessage(async (message) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'radar:get-state') await postState()
      if (message.type === 'radar:refresh') await refresh({ force: true })
      if (message.type === 'radar:retry-source' && SOURCE_BY_ID.has(message.sourceId)) {
        await refresh({ force: true, sourceIds: [message.sourceId] })
      }
    })
    await refresh()
    api.schedule.every(HEARTBEAT_SECONDS, () => { void refresh() })
  }

  return { refresh, start, getState: () => state }
}

export function parseOpenAiChangelog(markdown) {
  return parseSource(SOURCE_BY_ID.get('openai-api'), markdown)
}

export default {
  async activate(api) {
    const runtime = createUpdateRadarRuntime(api)
    await runtime.start()
  },
}
