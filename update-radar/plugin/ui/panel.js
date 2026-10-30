const api = window.agentPetsPlugin
const state = { radar: null, absoluteTime: false, day: null }
let codexResetCountdownTimer = null
let previewResizeObserver = null
const previewMeasurements = new Map()
const elements = {
  refresh: document.querySelector('#refresh'),
  refreshLoader: document.querySelector('#refresh-loader'),
  status: document.querySelector('#status'),
  resultStatus: document.querySelector('#result-status'),
  summaryGrid: document.querySelector('#summary-grid'),
  count: document.querySelector('#count'),
  attentionCount: document.querySelector('#attention-count'),
  healthyCount: document.querySelector('#healthy-count'),
  healthySummary: document.querySelector('#healthy-summary'),
  sources: document.querySelector('#sources'),
  spotlight: document.querySelector('#spotlight'),
  spotlightLoader: document.querySelector('#spotlight-loader'),
  heatmap: document.querySelector('#heatmap'),
  heatLoader: document.querySelector('#heat-loader'),
  heatMonths: document.querySelector('#heat-months'),
  tiboSummary: document.querySelector('#tibo-summary'),
  tiboSummaryText: document.querySelector('#tibo-summary-text'),
  updates: document.querySelector('#updates'),
  empty: document.querySelector('#empty'),
  search: document.querySelector('#search'),
  provider: document.querySelector('#provider'),
  category: document.querySelector('#category'),
  changeType: document.querySelector('#change-type'),
  filterToggle: document.querySelector('#filter-toggle'),
  filterToggleLabel: document.querySelector('#filter-toggle-label'),
  filterPanel: document.querySelector('#filter-panel'),
  filterCountStatus: document.querySelector('#filter-count-status'),
  clearFilters: document.querySelector('#clear-filters'),
  dayFilter: document.querySelector('#day-filter'),
  dayFilterText: document.querySelector('#day-filter-text'),
  dayFilterClear: document.querySelector('#day-filter-clear'),
  timeMode: document.querySelector('#time-mode'),
  timeModeLabel: document.querySelector('#time-mode-label'),
}

const labels = Object.freeze({
  provider: { openai: 'OpenAI', anthropic: 'Anthropic', x: 'Tibo / X', codex: 'Codex' },
  source: {
    'openai-api': 'OpenAI API',
    'openai-deprecations': 'OpenAI 棄用公告',
    'anthropic-platform': 'Claude Platform',
    'anthropic-model-deprecations': 'Claude 模型公告',
    'claude-code': 'Claude Code',
    'tibo-x': 'Tibo / X',
    'codex-resets': 'Codex 重設',
  },
  product: { api: 'API', model: '模型', 'claude-code': 'Claude Code', social: '公開貼文' },
  category: { 'new-model': '新模型', feature: '新功能', 'developer-tool': '開發工具', 'api-change': 'API 變更' },
  changeType: { added: '新增', improved: '改善', fixed: '修正', deprecated: '棄用', removed: '移除' },
  status: { idle: '等待同步', loading: '同步中', ok: '正常', stale: '使用快取', error: '讀取失敗' },
})

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName)
  if (className) element.className = className
  element.textContent = String(text ?? '')
  parent.append(element)
  return element
}

function populatePixelLoader(loader) {
  loader.setAttribute('aria-hidden', 'true')
  for (let index = 0; index < 9; index += 1) {
    const pixel = document.createElement('span')
    pixel.className = 'pixel-loader-cell'
    pixel.style.animationDelay = `${(index % 3) * 0.12}s`
    loader.append(pixel)
  }
  return loader
}

function createPixelLoader(className = 'pixel-loader') {
  const loader = document.createElement('span')
  loader.className = className
  populatePixelLoader(loader)
  return loader
}

function setBusy(element, busy) {
  if (busy) element.setAttribute('aria-busy', 'true')
  else element.removeAttribute('aria-busy')
}

function createPendingSyncTracker({ timeoutMs = 30_000, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) {
  const pending = new Map()

  function finish(key, outcome) {
    const entry = pending.get(key)
    if (!entry) return false
    clearTimer(entry.timer)
    pending.delete(key)
    onChange(key, outcome)
    return true
  }

  return {
    begin(key) {
      const previous = pending.get(key)
      if (previous) clearTimer(previous.timer)
      const timer = setTimer(() => finish(key, 'timeout'), timeoutMs)
      pending.set(key, { timer, sawLoading: false })
      onChange(key, 'pending')
    },
    observe(sources) {
      const rows = Array.isArray(sources) ? sources : []
      for (const [key, entry] of pending) {
        const loading = key === 'all'
          ? rows.some(source => source.status === 'loading')
          : rows.some(source => source.id === key && source.status === 'loading')
        if (loading) entry.sawLoading = true
        else if (entry.sawLoading) finish(key, 'complete')
      }
    },
    fail(key) { finish(key, 'failed') },
    isPending(key) { return pending.has(key) },
  }
}

async function dispatchSyncRequest(tracker, postMessage, key, message) {
  tracker.begin(key)
  try {
    const result = await postMessage(message)
    if (!result?.delivered) throw new Error('not_delivered')
    return true
  } catch {
    tracker.fail(key)
    return false
  }
}

const syncTracker = createPendingSyncTracker({
  timeoutMs: 30_000,
  onChange(key, outcome) {
    if (key === 'all') renderRefreshControl()
    else if (state.radar && outcome !== 'complete') renderSources()
    if (outcome === 'timeout') {
      const source = currentSources().find(item => item.id === key)
      elements.status.textContent = key === 'all'
        ? '等待來源同步逾時，請查看來源狀態後再試。'
        : `等待${source?.label ?? labels.source[key] ?? '來源'}同步逾時，請稍後重試。`
    }
  },
})

function renderRefreshControl() {
  const loading = currentSources().some(source => source.status === 'loading')
  const refreshing = loading || syncTracker.isPending('all')
  elements.refresh.disabled = refreshing
  elements.refreshLoader.hidden = !refreshing
  setBusy(elements.refresh, refreshing)
}

function makeSkeletonBlock(parent, className, width = '') {
  const block = document.createElement('span')
  block.className = `skeleton-block ${className}`
  if (width) block.style.width = width
  block.setAttribute('aria-hidden', 'true')
  parent.append(block)
  return block
}

function currentSources() {
  return Array.isArray(state.radar?.sources) ? state.radar.sources : []
}

function isInitialDataSyncing() {
  return shouldShowInitialSkeletons(state.radar)
}

function shouldShowInitialSkeletons(radar) {
  if (!radar || typeof radar !== 'object') return true
  const sources = Array.isArray(radar.sources) ? radar.sources : []
  const updates = Array.isArray(radar.updates) ? radar.updates : []
  const hasSavedContent = Boolean(radar.codexReset || updates.length || radar.baselineSourceIds?.length)
  if (hasSavedContent) return false
  if (sources.length > 0 && sources.every(source => source.status === 'loading')) return true
  const checkedAt = typeof radar.lastCheckedAt === 'string' && radar.lastCheckedAt.length > 0
  const settled = sources.some(source => ['ok', 'stale', 'error'].includes(source.status))
  return !checkedAt && !settled
}

function isUpdateSource(source) {
  return source.id !== 'codex-resets' && source.id !== 'tibo-x'
}

function isUpdateSourceLoading() {
  return currentSources().some(source => source.status === 'loading' && source.id !== 'codex-resets')
}

function isOfficialUpdateSourceLoading() {
  return currentSources().some(source => source.status === 'loading' && isUpdateSource(source))
}

function hasSourceBaseline(predicate) {
  const baselineIds = Array.isArray(state.radar?.baselineSourceIds) ? state.radar.baselineSourceIds : []
  return baselineIds.some(sourceId => predicate({ id: sourceId }))
}

function hasKnownUpdateSnapshot() {
  return Boolean(state.radar?.updates?.length) || hasSourceBaseline(source => source.id !== 'codex-resets')
}

function hasKnownOfficialSnapshot() {
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  return updates.some(update => !isTiboUpdate(update)) || hasSourceBaseline(isUpdateSource)
}

function renderSummaryLoading(show) {
  const values = [elements.count, elements.attentionCount, elements.healthyCount]
  setBusy(elements.summaryGrid, show || currentSources().some(source => source.status === 'loading'))
  for (const value of values) {
    const card = value.closest('.summary-card')
    const existingHint = card.querySelector('.summary-sync-copy')
    if (show) {
      value.classList.add('skeleton-value')
      value.setAttribute('aria-hidden', 'true')
      if (!existingHint) appendText(card, 'span', 'loading-copy summary-sync-copy', '正在同步…')
    } else {
      value.classList.remove('skeleton-value')
      value.removeAttribute('aria-hidden')
      existingHint?.remove()
    }
  }
}

function renderSpotlightSkeleton() {
  const card = document.createElement('article')
  card.className = 'spotlight-card codex-reset-card loading-skeleton'
  makeSkeletonBlock(card, 'skeleton-flag', '38%')
  makeSkeletonBlock(card, 'skeleton-countdown', '68%')
  for (const width of ['78%', '54%', '36%']) {
    const row = document.createElement('div')
    row.className = 'skeleton-fact-row'
    makeSkeletonBlock(row, 'skeleton-fact-label', '36%')
    makeSkeletonBlock(row, 'skeleton-fact-value', width)
    card.append(row)
  }
  makeSkeletonBlock(card, 'skeleton-action', '30%')
  appendText(card, 'p', 'loading-copy', '正在同步…')
  elements.spotlight.replaceChildren(card)
  setBusy(elements.spotlight, true)
}

function renderUpdateListSkeleton() {
  const cards = []
  for (let index = 0; index < 3; index += 1) {
    const card = document.createElement('article')
    card.className = 'loading-update-card loading-skeleton'
    const meta = document.createElement('div')
    meta.className = 'skeleton-meta-row'
    makeSkeletonBlock(meta, 'skeleton-chip', index === 1 ? '28%' : '36%')
    makeSkeletonBlock(meta, 'skeleton-chip', '24%')
    card.append(meta)
    makeSkeletonBlock(card, 'skeleton-title', index === 2 ? '72%' : '88%')
    makeSkeletonBlock(card, 'skeleton-copy-line', '100%')
    makeSkeletonBlock(card, 'skeleton-copy-line', index === 1 ? '74%' : '90%')
    appendText(card, 'p', 'loading-copy', '正在同步…')
    cards.push(card)
  }
  elements.updates.replaceChildren(...cards)
  elements.empty.hidden = true
  elements.resultStatus.textContent = '正在同步更新資料…'
  setBusy(elements.updates, true)
}

function formatDate(value) {
  if (!value) return '日期未提供'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
    : String(value)
}

function formatDateTime(value) {
  const date = new Date(value ?? '')
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
    : '尚未同步'
}

function updateDate(update) {
  if (typeof update?.publishedAtTime === 'string') {
    const timed = new Date(update.publishedAtTime)
    if (Number.isFinite(timed.getTime())) return timed
  }
  if (typeof update?.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(update.publishedAt)) {
    const dated = new Date(`${update.publishedAt}T00:00:00`)
    if (Number.isFinite(dated.getTime())) return dated
  }
  return null
}

function formatRelativeTime(date) {
  if (!date) return '日期未提供'
  const seconds = (date.getTime() - Date.now()) / 1000
  const distance = Math.abs(seconds)
  if (distance < 45) return seconds < 0 ? '剛剛' : '即將'
  const relative = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' })
  if (distance < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (distance < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (distance < 30 * 86400) return relative.format(Math.round(seconds / 86400), 'day')
  if (distance < 365 * 86400) return relative.format(Math.round(seconds / (30 * 86400)), 'month')
  return relative.format(Math.round(seconds / (365 * 86400)), 'year')
}

function formatUpdateTime(update) {
  const date = updateDate(update)
  if (!date) return '日期未提供'
  if (!state.absoluteTime) {
    if (!update.publishedAtTime) {
      const publishedDay = new Date(date)
      publishedDay.setHours(0, 0, 0, 0)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const days = Math.round((publishedDay.getTime() - today.getTime()) / 86400000)
      return new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' }).format(days, 'day')
    }
    return formatRelativeTime(date)
  }
  if (update.publishedAtTime) {
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return formatDate(update.publishedAt)
}

function updateTimestamp(update) {
  return updateDate(update)?.getTime() ?? 0
}

function providerClass(update) {
  return ['openai', 'anthropic', 'x'].includes(update?.provider) ? update.provider : 'other'
}

function isTiboUpdate(update) {
  return update?.provider === 'x' || update?.sourceId === 'tibo-x'
}

function sourceLabel(update) {
  return labels.source[update?.sourceId] ?? labels.provider[update?.provider] ?? '公開來源'
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    if (url.hostname === 'developers.openai.com') return url.pathname.startsWith('/api/docs/') ? url.toString() : null
    if (url.hostname === 'platform.claude.com') return url.pathname.startsWith('/docs/en/') ? url.toString() : null
    if (url.hostname === 'github.com') return url.pathname.startsWith('/anthropics/claude-code/releases') ? url.toString() : null
    if (url.origin === 'https://x.com') return /^\/thsottiaux\/status\/\d{1,19}$/.test(url.pathname) && !url.search ? url.toString() : null
    if (url.origin === 'https://codex-resets.com') return url.pathname === '/' && !url.search ? url.toString() : null
    return null
  } catch {
    return null
  }
}

function attentionSignal(update) {
  const text = `${update.title ?? ''} ${update.summary ?? ''}`.toLowerCase()
  if (update.replacement) return { label: `改用 ${update.replacement}`, tone: 'critical' }
  if (['deprecated', 'removed'].includes(update.changeType)) return { label: '需要規劃遷移', tone: 'critical' }
  if (update.effectiveAt) return { label: '留意生效日期', tone: 'critical' }
  if (/\b(breaking changes?|can break|migrat(?:e|ion|ing))\b/.test(text)) return { label: '檢查相容性', tone: 'warn' }
  if (/\b(pric(?:e|ing)|costs?|bill(?:ed|ing)?)\b/.test(text)) return { label: '檢查成本', tone: 'warn' }
  if (/\b(rate limits?|usage limits?|spend limits?|output limits?)\b/.test(text)) return { label: '檢查限制', tone: 'warn' }
  if (/\b(security|safety|permission|compliance|certificate|hipaa)\b/.test(text)) return { label: '檢查安全／合規', tone: 'warn' }
  return { label: '未標示必要動作', tone: 'neutral' }
}

function appendInsight(parent, label, value, className = '') {
  const item = document.createElement('div')
  item.className = `insight-item ${className}`.trim()
  appendText(item, 'span', 'insight-label', label)
  appendText(item, 'strong', 'insight-value', value)
  parent.append(item)
}

function appendQuickRead(parent, update) {
  const attention = attentionSignal(update)
  const section = document.createElement('section')
  section.className = 'quick-read'
  section.setAttribute('aria-label', '快速判讀')
  appendInsight(section, '變更', labels.changeType[update.changeType] ?? '更新')
  appendInsight(section, '影響範圍', `${labels.product[update.product] ?? '其他'} · ${labels.category[update.category] ?? '其他更新'}`)
  appendInsight(section, '注意事項', attention.label, `attention-${attention.tone}`)
  parent.append(section)
}

function appendVersion(parent, update) {
  if (!update.version && !update.previousVersion && !update.effectiveAt) return
  const row = document.createElement('div')
  row.className = 'version-row'
  if (update.version || update.previousVersion) {
    appendText(row, 'span', 'version-label', update.previousVersion && update.version ? '版本差異' : '版本')
    const versionText = update.previousVersion && update.version
      ? `${update.previousVersion} → ${update.version}`
      : update.version ?? update.previousVersion
    appendText(row, 'strong', 'version-value', versionText)
  }
  if (update.effectiveAt) appendText(row, 'span', 'effective-date', `生效：${formatDate(update.effectiveAt)}`)
  parent.append(row)
}

function bindExternalButton(button, sourceUrl, note) {
  button.addEventListener('click', async () => {
    button.disabled = true
    if (note) note.textContent = '正在開啟…'
    try {
      await api.links.openExternal(sourceUrl)
      if (note) note.textContent = '已交給系統瀏覽器'
    } catch (error) {
      const code = error && typeof error === 'object' ? (error.code ?? error.message ?? '') : ''
      if (note) note.textContent = code === 'rate_limited' ? '操作太頻繁，請稍後再試' : code === 'denied' ? '請直接點擊按鈕後再試' : '無法開啟來源'
      button.disabled = false
    }
  })
}

function bindExternalLink(link, sourceUrl, note) {
  let opening = false
  link.addEventListener('click', async (event) => {
    event.preventDefault()
    if (opening) return
    opening = true
    link.setAttribute('aria-busy', 'true')
    if (note) note.textContent = '正在開啟…'
    try {
      await api.links.openExternal(sourceUrl)
      if (note) note.textContent = '已交給系統瀏覽器'
    } catch (error) {
      const code = error && typeof error === 'object' ? (error.code ?? error.message ?? '') : ''
      if (note) note.textContent = code === 'rate_limited' ? '操作太頻繁，請稍後再試' : code === 'denied' ? '請直接點擊連結後再試' : '無法開啟來源'
    } finally {
      opening = false
      link.removeAttribute('aria-busy')
    }
  })
}

function appendSourceAction(parent, update) {
  const sourceUrl = safeSourceUrl(update.sourceUrl)
  if (!sourceUrl) {
    return appendText(parent, 'p', 'source-unavailable', '來源連結無法安全驗證。')
  }
  const row = document.createElement('div')
  row.className = 'source-action'
  const button = appendText(row, 'button', 'source-button', isTiboUpdate(update) ? '查看 X 原文' : '查看官方來源')
  button.type = 'button'
  const note = appendText(row, 'span', 'source-note', '使用系統瀏覽器開啟')
  bindExternalButton(button, sourceUrl, note)
  parent.append(row)
  return row
}

function appendDetails(parent, update) {
  const details = document.createElement('details')
  details.className = 'update-details'
  appendText(details, 'summary', '', '展開快速判讀')
  const content = document.createElement('div')
  content.className = 'details-content'
  appendQuickRead(content, update)
  appendVersion(content, update)
  appendSourceAction(content, update)
  details.append(content)
  parent.append(details)
  return details
}

// 官方摘要常以標題開頭；預覽只留標題之後的內容，同一句才不會在標題與預覽各出現一次。
function textAfterTitle(title, text) {
  const words = String(title ?? '').normalize('NFC').trim().split(/\s+/u).filter(Boolean)
  const source = String(text ?? '').normalize('NFC').trim()
  if (!words.length) return source
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+')
  const match = source.match(new RegExp(`^${escaped}`, 'iu'))
  return match ? source.slice(match[0].length).replace(/^[\s\p{P}…]+/u, '') : source
}

function collapsedWhitespace(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase()
}

// 條列式來源（Claude Code、Claude Platform）一條只有一段，標題就是內文開頭；標題過長被截成「…」時
// textAfterTitle 對不上最後半個字，會把整段再印一次，所以改用完整內文當唯一的一段。
function officialHeadline(update) {
  const title = String(update.title || '').trim()
  const summary = String(update.summary || '').trim()
  if (!title) return { headline: summary || '未命名更新', previewText: '' }
  if (title.endsWith('…') && collapsedWhitespace(summary).startsWith(collapsedWhitespace(title.slice(0, -1)))) {
    return { headline: summary, previewText: '' }
  }
  return { headline: title, previewText: textAfterTitle(title, summary) }
}

// 原地展開被截斷的預覽，不另外再印一份全文，避免展開後前半段重複。
function appendExpandToggle(parent, preview) {
  const button = appendText(parent, 'button', 'expand-toggle', '展開全文')
  button.type = 'button'
  button.hidden = true
  button.setAttribute('aria-expanded', 'false')
  button.addEventListener('click', () => {
    const expanded = preview.classList.toggle('is-expanded')
    button.textContent = expanded ? '收合' : '展開全文'
    button.setAttribute('aria-expanded', String(expanded))
  })
  return () => {
    const expanded = preview.classList.contains('is-expanded')
    button.hidden = !(expanded || preview.scrollHeight > preview.clientHeight + 1)
  }
}

function clearPreviewMeasurements() {
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
  previewMeasurements.clear()
}

function observePreview(preview, measure) {
  if (!preview) {
    measure()
    return
  }
  previewMeasurements.set(preview, measure)
  if (typeof ResizeObserver === 'function') {
    previewResizeObserver ??= new ResizeObserver(entries => {
      for (const entry of entries) previewMeasurements.get(entry.target)?.()
    })
    previewResizeObserver.observe(preview)
  }
  requestAnimationFrame(() => {
    if (preview.isConnected) measure()
  })
}

function renderTiboBubble(update, role = '') {
  const row = document.createElement('div')
  row.className = `message-row provider-x${role ? ` message-${role}` : ''}`
  const avatar = appendText(row, 'span', 'source-avatar', 'T')
  avatar.setAttribute('aria-hidden', 'true')
  const bubble = document.createElement('div')
  bubble.className = 'message-bubble'

  const meta = document.createElement('div')
  meta.className = 'message-meta'
  const dateTime = update.publishedAtTime ?? update.publishedAt ?? ''
  const time = appendText(meta, 'time', 'time-chip', formatUpdateTime(update))
  time.dateTime = dateTime
  appendText(meta, 'span', 'provider-label provider-x', 'Tibo / X')
  if (role === 'root') appendText(meta, 'span', 'post-kind post-kind-root', '原始貼文')
  if (role === 'self-reply') appendText(meta, 'span', 'post-kind post-kind-self-reply', '自我回文')
  bubble.append(meta)

  const preview = appendText(bubble, 'p', 'message-preview', update.summary || update.title || '原文內容未提供。')
  observePreview(preview, appendExpandToggle(bubble, preview))
  appendSourceAction(bubble, update)
  row.append(bubble)
  return row
}

function renderTiboUpdate(update) {
  const article = document.createElement('article')
  article.className = 'update-item provider-x'
  const role = update.postKind === 'self-reply' ? 'self-reply' : 'root'
  article.append(renderTiboBubble(update, role))
  return article
}

function officialRecordTone(update) {
  if (update.provider === 'openai') return 'record-openai'
  if (update.product === 'claude-code') return 'record-claude-code'
  if (update.provider === 'anthropic') return 'record-anthropic'
  return 'record-other'
}

function renderOfficialUpdate(update) {
  const article = document.createElement('article')
  article.className = `update-item official-record ${officialRecordTone(update)} provider-${providerClass(update)}`
  const meta = document.createElement('div')
  meta.className = 'official-meta'
  appendText(meta, 'span', 'official-meta-tag official-source-label', sourceLabel(update))
  const dateTime = update.publishedAtTime ?? update.publishedAt ?? ''
  const time = appendText(meta, 'time', 'official-meta-tag official-time-chip', formatUpdateTime(update))
  time.dateTime = dateTime
  appendText(meta, 'span', `official-meta-tag change-label change-${update.changeType}`, labels.changeType[update.changeType] ?? '更新')
  appendText(meta, 'span', 'official-meta-tag category-label', labels.category[update.category] ?? '其他更新')
  const signal = attentionSignal(update)
  if (signal.tone !== 'neutral') appendText(meta, 'span', `official-meta-tag attention-chip attention-${signal.tone}`, `需要留意 · ${signal.label}`)
  article.append(meta)
  const { headline, previewText } = officialHeadline(update)
  if (previewText) {
    appendText(article, 'h3', 'official-title', headline)
    const preview = appendText(article, 'p', 'official-preview', previewText)
    observePreview(preview, appendExpandToggle(article, preview))
  } else {
    const solo = appendText(article, 'h3', 'official-title official-title-solo', headline)
    observePreview(solo, appendExpandToggle(article, solo))
  }
  appendDetails(article, update)
  return article
}

function resetTypeLabel(value) {
  return ({ regular: '定期重設', manual: '手動重設', emergency: '緊急重設', scheduled: '排定重設', observed: '觀測到重設' })[value] ?? '重設'
}

function formatAbsoluteResetTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '時間未提供'
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatTimeSinceReset(value) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '距上次重設時間未提供'
  const elapsedHours = Math.max(0, Math.floor((Date.now() - timestamp) / 3600000))
  if (elapsedHours > 48) return `距上次重設 ${Math.floor(elapsedHours / 24)} 天 ${elapsedHours % 24} 小時`
  if (elapsedHours === 0) return '距上次重設不到 1 小時'
  return `距上次重設 ${elapsedHours} 小時`
}

function formatScheduledCountdown(value) {
  const remaining = Date.parse(value) - Date.now()
  if (!Number.isFinite(remaining) || remaining <= 0) return '預定時間已到，等待狀態更新'
  const secondsTotal = Math.floor(remaining / 1000)
  const days = Math.floor(secondsTotal / 86400)
  const hours = Math.floor((secondsTotal % 86400) / 3600)
  const minutes = Math.floor((secondsTotal % 3600) / 60)
  const seconds = secondsTotal % 60
  return `${days} 天 ${hours} 時 ${minutes} 分 ${seconds} 秒`
}

function appendCodexSourceAttribution(parent) {
  const sourceUrl = safeSourceUrl('https://codex-resets.com/')
  if (!sourceUrl) return
  const row = document.createElement('p')
  row.className = 'codex-source-attribution'
  const link = appendText(row, 'a', 'codex-source-link', '資料來源：codex-resets.com')
  link.href = '#codex-resets-source'
  const note = appendText(row, 'span', 'codex-source-note', '')
  bindExternalLink(link, sourceUrl, note)
  parent.append(row)
}

function appendAnnouncementAction(parent, latestReset) {
  const sourceUrl = safeSourceUrl(latestReset.sourceUrl)
  if (!sourceUrl) return
  const row = document.createElement('div')
  row.className = 'codex-reset-actions'
  const button = appendText(row, 'button', 'source-button', '查看公告')
  button.type = 'button'
  const note = appendText(row, 'span', 'source-note', '使用系統瀏覽器開啟')
  bindExternalButton(button, sourceUrl, note)
  parent.append(row)
}

function renderSpotlight() {
  if (codexResetCountdownTimer) {
    clearTimeout(codexResetCountdownTimer)
    codexResetCountdownTimer = null
  }
  const reset = state.radar?.codexReset
  const source = currentSources().find(item => item.id === 'codex-resets')
  const sourceLoading = source?.status === 'loading'
  elements.spotlightLoader.hidden = !sourceLoading || !reset
  const scheduledAt = reset?.scheduledReset?.at
  const hasFutureSchedule = typeof scheduledAt === 'string' && Number.isFinite(Date.parse(scheduledAt)) && Date.parse(scheduledAt) > Date.now()
  const card = document.createElement('article')
  card.className = 'spotlight-card codex-reset-card'

  if (!reset) {
    if (sourceLoading || isInitialDataSyncing()) {
      renderSpotlightSkeleton()
      return
    }
    const statusText = ['error', 'stale'].includes(source?.status)
      ? '目前無法讀取 Codex 重設資料，請稍後重試。'
      : '尚無 Codex 重設資料，正在等待來源同步。'
    appendText(card, 'p', 'codex-reset-status', statusText).setAttribute('role', 'status')
    appendCodexSourceAttribution(card)
    elements.spotlight.replaceChildren(card)
    setBusy(elements.spotlight, false)
    return
  }
  setBusy(elements.spotlight, sourceLoading)

  appendText(card, 'span', 'spotlight-flag attention-neutral', hasFutureSchedule ? '已排定重設' : '最新狀態')
  if (['stale', 'error'].includes(source?.status)) {
    appendText(card, 'p', 'codex-reset-status', '來源讀取失敗，以下顯示上次成功資料。').setAttribute('role', 'status')
  }

  if (hasFutureSchedule) {
    const countdown = appendText(card, 'p', 'codex-reset-countdown', formatScheduledCountdown(scheduledAt))
    countdown.setAttribute('aria-live', 'off')
    countdown.setAttribute('aria-label', `距預定重設時間 ${countdown.textContent}`)
    const scheduledTime = appendText(card, 'time', 'codex-reset-scheduled-time', `預定時間：${formatAbsoluteResetTime(scheduledAt)}`)
    scheduledTime.dateTime = scheduledAt
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const updateCountdown = () => {
      countdown.textContent = formatScheduledCountdown(scheduledAt)
      countdown.setAttribute('aria-label', `距預定重設時間 ${countdown.textContent}`)
      codexResetCountdownTimer = setTimeout(updateCountdown, reducedMotion ? 60_000 : 1_000)
    }
    codexResetCountdownTimer = setTimeout(updateCountdown, reducedMotion ? 60_000 : 1_000)
  } else {
    appendText(card, 'p', 'codex-reset-countdown', formatTimeSinceReset(reset.stats.lastResetAt))
  }

  const facts = document.createElement('dl')
  facts.className = 'codex-reset-facts'
  const factRows = [
    ['上次重設時間', formatAbsoluteResetTime(reset.stats.lastResetAt)],
    ['重設類型', resetTypeLabel(reset.latestReset.resetType)],
    ['累計次數', `${reset.stats.total} 次`],
  ]
  for (const [label, value] of factRows) {
    const row = document.createElement('div')
    row.className = 'codex-reset-fact'
    appendText(row, 'dt', '', label)
    appendText(row, 'dd', '', value)
    facts.append(row)
  }
  card.append(facts)
  appendAnnouncementAction(card, reset.latestReset)
  appendCodexSourceAttribution(card)
  elements.spotlight.replaceChildren(card)
}

function findThreadRootId(update, byId) {
  if (update?.sourceId !== 'tibo-x' || !/^x-\d{1,19}$/.test(update.id ?? '')) return null
  if (update.postKind === 'root') return update.id
  let current = update
  const visited = new Set([update.id])
  for (let depth = 0; depth < 20; depth += 1) {
    if (!/^x-\d{1,19}$/.test(current.replyToId ?? '') || visited.has(current.replyToId)) return null
    visited.add(current.replyToId)
    current = byId.get(current.replyToId)
    if (!current) return null
    if (current.postKind === 'root') return current.id
  }
  return null
}

function groupUpdates(updates) {
  const byId = new Map(updates.map(update => [update.id, update]))
  const roots = new Map(updates.map(update => [update.id, findThreadRootId(update, byId)]))
  const emitted = new Set()
  const groups = []
  for (const update of updates) {
    const rootId = roots.get(update.id)
    if (!rootId) { groups.push({ kind: 'single', updates: [update] }); continue }
    if (emitted.has(rootId)) continue
    emitted.add(rootId)
    const thread = updates.filter(candidate => roots.get(candidate.id) === rootId).sort((left, right) => {
      if (left.postKind === 'root') return -1
      if (right.postKind === 'root') return 1
      return String(left.publishedAtTime).localeCompare(String(right.publishedAtTime))
    })
    groups.push({ kind: thread.length > 1 ? 'thread' : 'single', updates: thread })
  }
  return groups
}

function renderThread(group) {
  const article = document.createElement('article')
  article.className = 'update-thread provider-x'
  article.setAttribute('aria-label', `Tibo 對話串，共 ${group.updates.length} 則`)
  const header = document.createElement('header')
  header.className = 'thread-header'
  appendText(header, 'h3', '', 'Tibo 對話')
  appendText(header, 'span', 'thread-count', `${group.updates.length} 則內容`)
  article.append(header)
  const timeline = document.createElement('ol')
  timeline.className = 'thread-timeline'
  for (const update of group.updates) {
    const role = update.postKind === 'self-reply' ? 'self-reply' : 'root'
    const item = document.createElement('li')
    item.className = `thread-item thread-${role}`
    item.append(renderTiboBubble(update, role))
    timeline.append(item)
  }
  article.append(timeline)
  return article
}

function matchesFilters(update) {
  if (state.day && (isTiboUpdate(update) || heatDateKey(update) !== state.day)) return false
  if (elements.provider.value && update.provider !== elements.provider.value) return false
  if (elements.category.value && update.category !== elements.category.value) return false
  if (elements.changeType.value && update.changeType !== elements.changeType.value) return false
  const query = elements.search.value.trim().toLocaleLowerCase('zh-Hant')
  if (!query) return true
  const subjects = Array.isArray(update.subjects) ? update.subjects : []
  return [update.title, update.summary, update.version, ...subjects]
    .filter(Boolean).join(' ').toLocaleLowerCase('zh-Hant').includes(query)
}

function renderUpdates() {
  clearPreviewMeasurements()
  const allUpdates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const updateLoading = isUpdateSourceLoading()
  if (allUpdates.length === 0 && !hasKnownUpdateSnapshot() && (state.radar === null || updateLoading || isInitialDataSyncing())) {
    renderUpdateListSkeleton()
    return
  }
  setBusy(elements.updates, updateLoading)
  const groups = groupUpdates(allUpdates).filter(group => group.updates.some(matchesFilters))
  const visibleCount = groups.reduce((total, group) => total + group.updates.length, 0)
  elements.updates.replaceChildren(...groups.map((group) => {
    if (group.kind === 'thread') return renderThread(group)
    const update = group.updates[0]
    return isTiboUpdate(update) ? renderTiboUpdate(update) : renderOfficialUpdate(update)
  }))
  elements.empty.hidden = groups.length > 0
  elements.resultStatus.textContent = groups.length > 0
    ? `顯示 ${groups.length} 個區塊、${visibleCount} 則內容。Tibo 對話會保留整串上下文。`
    : '目前的篩選條件沒有結果。'
  renderDayFilter(visibleCount)
}

function dayLabel(key) {
  const [year, month, day] = key.split('-').map(Number)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month - 1, day).getDay()]
  return `${month}/${day}（${weekday}）`
}

function renderDayFilter(visibleCount) {
  elements.dayFilter.hidden = !state.day
  // 日期列已說明筆數；保留一般結果說明只會重複，且日期篩選不含 Tibo。
  elements.resultStatus.hidden = Boolean(state.day)
  if (state.day) elements.dayFilterText.textContent = `只顯示 ${dayLabel(state.day)} 的官方更新 ${visibleCount} 則`
}

function scrollToUpdates() {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  document.querySelector('.updates-region')?.scrollIntoView?.({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}

function selectDay(key) {
  state.day = state.day === key ? null : key
  // 日期只篩官方更新；若停在 Tibo 篩選會永遠沒有結果，所以一併解除。
  if (state.day && elements.provider.value === 'x') elements.provider.value = ''
  renderFilterControls()
  renderHeatmap()
  renderUpdates()
  if (state.day) scrollToUpdates()
}

function appliedFilterCount() {
  return [elements.search.value.trim(), elements.provider.value, elements.category.value, elements.changeType.value, state.day]
    .filter(Boolean).length
}

function renderFilterControls() {
  const count = appliedFilterCount()
  elements.filterToggleLabel.textContent = count ? `篩選 · ${count}` : '篩選'
  elements.filterCountStatus.textContent = count ? `已套用 ${count} 項篩選條件` : '目前沒有篩選條件'
  elements.clearFilters.disabled = count === 0
}

function setFilterPanelOpen(open) {
  elements.filterPanel.hidden = !open
  elements.filterToggle.setAttribute('aria-expanded', String(open))
}

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function heatDateKey(update) {
  if (update.publishedAtTime) {
    const date = new Date(update.publishedAtTime)
    if (Number.isFinite(date.getTime())) return localDateKey(date)
  }
  return typeof update.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(update.publishedAt)
    ? update.publishedAt
    : null
}

function shortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function renderHeatmapSkeleton() {
  const cells = []
  const months = []
  for (let week = 0; week < 26; week += 1) {
    if (week % 5 === 0) {
      const month = document.createElement('span')
      month.className = 'heat-month-skeleton'
      month.setAttribute('aria-hidden', 'true')
      month.style.gridColumn = `${week + 1} / span ${Math.min(4, 26 - week)}`
      months.push(month)
    }
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const cell = document.createElement('li')
      cell.className = 'heat-cell heat-skeleton-cell'
      cell.setAttribute('aria-hidden', 'true')
      const delay = `${week * 0.045}s`
      cell.style.animationDelay = delay
      const dot = document.createElement('span')
      dot.className = 'heat-cell-dot heat-skeleton-dot'
      dot.setAttribute('aria-hidden', 'true')
      dot.style.animationDelay = delay
      cell.append(dot)
      cells.push(cell)
    }
  }
  elements.heatmap.replaceChildren(...cells)
  elements.heatMonths.replaceChildren(...months)
  elements.heatmap.setAttribute('aria-label', '官方 AI 更新熱度圖正在同步')
  setBusy(elements.heatmap, true)
  elements.heatLoader.hidden = true
}

function renderHeatmap() {
  const counts = new Map()
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const officialUpdates = updates.filter(update => !isTiboUpdate(update))
  const officialLoading = isOfficialUpdateSourceLoading()
  if (state.radar === null || (officialUpdates.length === 0 && !hasKnownOfficialSnapshot() && (officialLoading || isInitialDataSyncing()))) {
    renderHeatmapSkeleton()
    return
  }
  setBusy(elements.heatmap, officialLoading)
  elements.heatLoader.hidden = !officialLoading
  // 重新繪製會替換所有格子；保留鍵盤焦點，避免每次選取或同步後焦點跳回頁首。
  const focusedDay = elements.heatmap.contains(document.activeElement) ? document.activeElement.dataset.day : null
  for (const update of officialUpdates) {
    const key = heatDateKey(update)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const todayKey = localDateKey(today)
  const todayTibo = updates.filter(update => isTiboUpdate(update) && heatDateKey(update) === todayKey)
  const originalPosts = todayTibo.filter(update => update.postKind === 'root').length
  const selfReplies = todayTibo.filter(update => update.postKind === 'self-reply').length
  elements.tiboSummaryText.textContent = todayTibo.length
    ? `今天 Tibo 貼文 ${todayTibo.length} 則（原貼 ${originalPosts}、自我回文 ${selfReplies}）`
    : '今天 Tibo 尚無新貼文'
  const currentSunday = new Date(today)
  currentSunday.setDate(today.getDate() - today.getDay())
  const firstSunday = new Date(currentSunday)
  firstSunday.setDate(currentSunday.getDate() - 25 * 7)
  const days = []
  const monthLabels = []
  let previousMonth = -1

  for (let week = 0; week < 26; week += 1) {
    const weekStart = new Date(firstSunday)
    weekStart.setDate(firstSunday.getDate() + week * 7)
    if (weekStart.getMonth() !== previousMonth) {
      const month = appendText(elements.heatMonths, 'span', 'heat-month-label', new Intl.DateTimeFormat('zh-TW', { month: 'numeric' }).format(weekStart))
      month.style.gridColumn = week === 25 ? `${week + 1}` : `${week + 1} / span 2`
      monthLabels.push(month)
      previousMonth = weekStart.getMonth()
    }

    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + weekday)
      const cell = document.createElement('li')
      const future = date.getTime() > today.getTime()
      cell.className = future ? 'heat-cell heat-cell-future' : 'heat-cell'
      if (future) {
        cell.setAttribute('aria-hidden', 'true')
        days.push(cell)
        continue
      }
      const key = localDateKey(date)
      const count = counts.get(key) ?? 0
      const weekdayLabel = ['日', '一', '二', '三', '四', '五', '六'][weekday]
      const description = count
        ? `${shortDate(date)}（${weekdayLabel}）：官方更新 ${count} 則`
        : `${shortDate(date)}（${weekdayLabel}）：沒有官方更新`
      cell.dataset.level = String(Math.min(4, count))
      cell.title = description
      if (state.day === key) cell.classList.add('is-selected')
      const dot = document.createElement('span')
      dot.className = 'heat-cell-dot'
      dot.setAttribute('aria-hidden', 'true')
      if (count) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'heat-cell-button'
        button.dataset.day = key
        button.setAttribute('aria-pressed', String(state.day === key))
        button.setAttribute('aria-label', `${description}，顯示當天卡片`)
        button.append(dot)
        cell.append(button)
      } else {
        cell.setAttribute('aria-label', description)
        cell.append(dot)
        appendText(cell, 'span', 'visually-hidden', description)
      }
      days.push(cell)
    }
  }
  elements.heatmap.replaceChildren(...days)
  elements.heatMonths.replaceChildren(...monthLabels)
  if (focusedDay) elements.heatmap.querySelector(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true })
  elements.heatmap.setAttribute('aria-label', '近 26 週每日官方 AI 更新數，週日至週六排列')
}

function renderSources() {
  const sources = Array.isArray(state.radar?.sources) ? state.radar.sources : []
  elements.sources.replaceChildren(...sources.map((source) => {
    const row = document.createElement('article')
    const status = ['idle', 'loading', 'ok', 'stale', 'error'].includes(source.status) ? source.status : 'idle'
    const pendingRetry = syncTracker.isPending(source.id)
    const displayStatus = pendingRetry && status !== 'loading' ? 'loading' : status
    row.className = `source-row source-${displayStatus}`
    setBusy(row, status === 'loading' || pendingRetry)
    const copy = document.createElement('div')
    copy.className = 'source-copy'
    appendText(copy, 'strong', '', source.label ?? labels.source[source.id] ?? '公開來源')
    const detail = displayStatus === 'loading' ? '正在讀取公開來源…' : status === 'ok'
        ? `${source.itemCount} 筆 · ${formatDateTime(source.fetchedAt)}`
        : source.nextAttemptAt ? `${source.itemCount} 筆 · 將於 ${formatDateTime(source.nextAttemptAt)} 重試` : `${source.itemCount} 筆`
    appendText(copy, 'span', '', detail)
    row.append(copy)
    const actions = document.createElement('div')
    actions.className = 'source-actions'
    if (displayStatus === 'loading') actions.append(createPixelLoader('pixel-loader source-pixel-loader'))
    appendText(actions, 'span', `status-pill status-${displayStatus}`, labels.status[displayStatus] ?? '未知')
    if (['stale', 'error'].includes(status)) {
      const retry = appendText(actions, 'button', 'retry-button', pendingRetry ? '同步中' : '立即重試')
      retry.type = 'button'
      retry.disabled = pendingRetry
      if (pendingRetry) retry.append(createPixelLoader('pixel-loader retry-pixel-loader'))
      retry.addEventListener('click', async () => {
        elements.status.textContent = `正在重新同步${source.label ?? labels.source[source.id] ?? '來源'}…`
        const delivered = await dispatchSyncRequest(
          syncTracker,
          message => api.ui.postMessage(message),
          source.id,
          { type: 'radar:retry-source', sourceId: source.id },
        )
        if (!delivered) {
          elements.status.textContent = '背景插件目前無法使用，請確認插件已啟用。'
        }
      })
    }
    row.append(actions)
    return row
  }))
}

function renderTimeMode() {
  const label = state.absoluteTime ? '絕對時間' : '相對時間'
  const nextLabel = state.absoluteTime ? '相對時間' : '絕對時間'
  elements.timeModeLabel.textContent = state.absoluteTime ? '絕對' : '相對'
  elements.timeMode.setAttribute('aria-pressed', String(state.absoluteTime))
  elements.timeMode.setAttribute('aria-label', `目前顯示${label}，切換為${nextLabel}`)
}

function render(radar) {
  state.radar = radar
  const updates = Array.isArray(radar?.updates) ? radar.updates : []
  const sources = Array.isArray(radar?.sources) ? radar.sources : []
  const loading = sources.some(source => source.status === 'loading')
  syncTracker.observe(sources)
  const attention = updates.filter(update => !isTiboUpdate(update)
    && (['deprecated', 'removed'].includes(update.changeType) || attentionSignal(update).tone !== 'neutral')).length
  const healthy = sources.filter(source => source.status === 'ok').length
  elements.count.textContent = String(updates.length)
  elements.attentionCount.textContent = String(attention)
  elements.healthyCount.textContent = `${healthy}/${sources.length || 7}`
  elements.healthySummary.textContent = `${healthy}/${sources.length || 7} 正常`
  const updateLoading = sources.some(source => source.status === 'loading' && source.id !== 'codex-resets')
  renderSummaryLoading(updates.length === 0 && !hasKnownUpdateSnapshot() && (updateLoading || isInitialDataSyncing()))
  renderRefreshControl()
  elements.status.textContent = loading
    ? '正在檢查公開來源…'
    : syncTracker.isPending('all') ? '正在等待背景插件重新整理全部來源…'
    : `上次檢查：${formatDateTime(radar?.lastCheckedAt)}。失敗來源會自動退避重試，快取不會被清除。`
  renderSources()
  renderSpotlight()
  renderHeatmap()
  renderUpdates()
  renderTimeMode()
}

for (const element of [elements.search, elements.provider, elements.category, elements.changeType]) {
  element.addEventListener(element === elements.search ? 'input' : 'change', () => {
    renderFilterControls()
    renderUpdates()
  })
}

elements.filterToggle.addEventListener('click', () => {
  setFilterPanelOpen(elements.filterPanel.hidden)
})

elements.clearFilters.addEventListener('click', () => {
  elements.search.value = ''
  elements.provider.value = ''
  elements.category.value = ''
  elements.changeType.value = ''
  state.day = null
  renderFilterControls()
  renderHeatmap()
  renderUpdates()
})

elements.heatmap.addEventListener('click', (event) => {
  const button = event.target.closest?.('.heat-cell-button')
  if (button?.dataset.day) selectDay(button.dataset.day)
})

elements.dayFilterClear.addEventListener('click', () => {
  if (state.day) selectDay(state.day)
})

elements.tiboSummary.addEventListener('click', () => {
  elements.provider.value = 'x'
  state.day = null
  renderFilterControls()
  renderHeatmap()
  renderUpdates()
  scrollToUpdates()
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || elements.filterPanel.hidden) return
  event.preventDefault()
  event.stopPropagation()
  setFilterPanelOpen(false)
  elements.filterToggle.focus()
})

for (const loader of [elements.refreshLoader, elements.spotlightLoader, elements.heatLoader]) populatePixelLoader(loader)
renderSpotlightSkeleton()
renderSummaryLoading(true)
renderHeatmapSkeleton()
renderUpdateListSkeleton()
renderFilterControls()

window.addEventListener('resize', () => {
  if (!previewMeasurements.size) return
  requestAnimationFrame(() => {
    for (const measure of previewMeasurements.values()) measure()
  })
})

elements.timeMode.addEventListener('click', () => {
  state.absoluteTime = !state.absoluteTime
  renderTimeMode()
  renderSpotlight()
  renderUpdates()
})

elements.refresh.addEventListener('click', async () => {
  if (syncTracker.isPending('all')) return
  elements.status.textContent = '正在要求背景插件重新整理全部來源…'
  const delivered = await dispatchSyncRequest(syncTracker, message => api.ui.postMessage(message), 'all', { type: 'radar:refresh' })
  if (!delivered) {
    elements.status.textContent = '背景插件目前無法使用，請確認插件已啟用。'
  }
})

api.ui.onMessage((message) => {
  if (message?.type === 'radar:state') render(message.state)
})

try {
  const stored = await api.storage.get('radar-state')
  if (stored.found) render(stored.value)
} catch {
  elements.status.textContent = '無法讀取已保存資料，正在詢問背景插件。'
}

try {
  const result = await api.ui.postMessage({ type: 'radar:get-state' })
  if (!result.delivered) elements.status.textContent = '背景插件目前無法使用，請確認插件已啟用。'
} catch {
  elements.status.textContent = '背景插件目前無法使用，請確認插件已啟用。'
}
