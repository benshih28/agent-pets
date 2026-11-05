const api = window.agentPetsPlugin

// --- 外觀（淺色／深色）-------------------------------------------------------
// 'system' 代表尚未選擇：未選擇前跟隨系統，控制項顯示系統目前的模式。
function normalizePanelTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function effectivePanelTheme(theme, systemDark) {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

function applyPanelTheme(theme, root = document.documentElement) {
  const selected = normalizePanelTheme(theme)
  if (selected === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', selected)
  root.style.colorScheme = selected === 'system' ? 'light dark' : selected
}

let panelTheme = 'system'
let panelThemeChosen = false
const systemDarkQuery = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
const state = {
  radar: null,
  dataVersion: 0,
  activeTab: 'overview',
  tabRenderedVersion: { overview: -1, updates: -1, reset: -1 },
  tabScrollY: { overview: null, updates: null, reset: null },
  absoluteTime: false,
  day: null,
  attentionOnly: false,
  expanded: new Set(),
  disclosures: new Map(),
  detail: null,
}
let codexResetCountdownTimer = null
let codexResetCountdownTick = null
let globalStatusTimer = null

const elements = {
  tabList: document.querySelector('#radar-tabs'),
  tabs: {
    overview: document.querySelector('#tab-overview'),
    updates: document.querySelector('#tab-updates'),
    reset: document.querySelector('#tab-reset'),
  },
  panels: {
    overview: document.querySelector('#panel-overview'),
    updates: document.querySelector('#panel-updates'),
    reset: document.querySelector('#panel-reset'),
  },
  updatesCount: document.querySelector('#updates-count'),
  resetTabDot: document.querySelector('#reset-tab-dot'),
  toolbar: document.querySelector('.toolbar'),
  detailView: document.querySelector('#change-detail'),
  detailBack: document.querySelector('#change-detail-back'),
  refresh: document.querySelector('#refresh'),
  themeToggle: document.querySelector('#theme-toggle'),
  refreshLoader: document.querySelector('#refresh-loader'),
  status: document.querySelector('#status'),
  resultStatus: document.querySelector('#result-status'),
  overviewAlerts: document.querySelector('#overview-alerts'),
  summaryGrid: document.querySelector('#summary-grid'),
  count: document.querySelector('#count'),
  attentionCount: document.querySelector('#attention-count'),
  healthyCount: document.querySelector('#healthy-count'),
  overviewCountButton: document.querySelector('#overview-count-button'),
  overviewAttentionButton: document.querySelector('#overview-attention-button'),
  overviewSourcesButton: document.querySelector('#overview-sources-button'),
  codexOverviewStatus: document.querySelector('#codex-overview-status'),
  overviewHighlightsList: document.querySelector('#overview-highlights-list'),
  overviewAllUpdates: document.querySelector('#overview-all-updates'),
  sourceStatus: document.querySelector('#source-status'),
  sources: null,
  resetSpotlight: document.querySelector('#spotlight-reset'),
  resetSources: null,
  heatDisclosureHost: document.querySelector('#heat-disclosure-host'),
  heatContent: document.querySelector('#heat-content'),
  heatmap: document.querySelector('#heatmap'),
  heatLoader: document.querySelector('.heat-loader'),
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
  attentionOnly: document.querySelector('#attention-only'),
  activeFilterChips: document.querySelector('#active-filter-chips'),
  filterCountStatus: document.querySelector('#filter-count-status'),
  clearFilters: document.querySelector('#clear-filters'),
  dayFilter: document.querySelector('#day-filter'),
  dayFilterText: document.querySelector('#day-filter-text'),
  dayFilterClear: document.querySelector('#day-filter-clear'),
  timeMode: document.querySelector('#time-mode'),
  timeModeLabel: document.querySelector('#time-mode-label'),
}

const updateStickyMeasurements = () => {
  document.documentElement.style.setProperty('--radar-sticky-offset', `${elements.tabList.getBoundingClientRect().height}px`)
  const toolbarHeight = state.activeTab === 'updates' && !state.detail
    ? elements.toolbar.getBoundingClientRect().height
    : 0
  document.documentElement.style.setProperty('--radar-toolbar-sticky-height', `${toolbarHeight}px`)
}
const stickyLayoutObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(updateStickyMeasurements)
  : null
stickyLayoutObserver?.observe(elements.tabList)
stickyLayoutObserver?.observe(elements.toolbar)

function renderPanelThemeControls() {
  const shown = effectivePanelTheme(panelTheme, systemDarkQuery?.matches ?? false)
  const label = shown === 'dark' ? '切換為淺色' : '切換為深色'
  elements.themeToggle.dataset.mode = shown
  elements.themeToggle.setAttribute('aria-label', label)
  elements.themeToggle.title = label
}

async function selectPanelTheme(value) {
  panelThemeChosen = true
  panelTheme = normalizePanelTheme(value)
  applyPanelTheme(panelTheme)
  renderPanelThemeControls()
  try {
    await api.storage.set('panel-theme', panelTheme)
  } catch {
    setGlobalStatus('外觀設定未儲存，只在這次有效。')
  }
}

renderPanelThemeControls()
systemDarkQuery?.addEventListener?.('change', () => {
  if (panelTheme === 'system') renderPanelThemeControls()
})
// 不等待讀取：storage 回應慢時，面板初始化與訊息監聽不能被卡住；讀到前使用者已自行選擇則以選擇為準。
api.storage.get('panel-theme').then((stored) => {
  if (panelThemeChosen) return
  panelTheme = normalizePanelTheme(stored?.found ? stored.value : 'system')
  applyPanelTheme(panelTheme)
  renderPanelThemeControls()
}).catch(() => {})

elements.themeToggle.addEventListener('click', () => {
  void selectPanelTheme(elements.themeToggle.dataset.mode === 'dark' ? 'light' : 'dark')
})

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

function createDisclosure({
  id,
  title,
  meta,
  open = false,
  tone = 'neutral',
  buttonText,
  expandedText,
  buttonClass = 'disclosure-button',
  rootClass = 'disclosure-root',
  regionClass = '',
  ariaLabel,
  onToggle,
} = {}) {
  const root = document.createElement('div')
  root.className = rootClass
  const button = document.createElement('button')
  button.id = `${id}-button`
  button.type = 'button'
  button.className = buttonClass
  button.setAttribute('aria-expanded', String(Boolean(open)))
  button.setAttribute('aria-controls', `${id}-region`)
  const visibleTitle = appendText(button, 'span', 'disclosure-title', buttonText ?? title)
  appendText(button, 'span', `disclosure-meta disclosure-meta-${tone}`, meta)
  const chevron = createIcon('chevron', 'disclosure-chevron')
  chevron.setAttribute('aria-hidden', 'true')
  button.append(chevron)
  const region = document.createElement('div')
  if (regionClass) region.className = regionClass
  region.id = `${id}-region`
  region.setAttribute('role', 'region')
  region.setAttribute('aria-labelledby', button.id)
  region.hidden = !open
  if (ariaLabel) button.setAttribute('aria-label', `${open ? expandedText ?? buttonText ?? title : buttonText ?? title}：${ariaLabel}`)
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', String(expanded))
    region.hidden = !expanded
    if (buttonText !== undefined) visibleTitle.textContent = expanded ? expandedText ?? buttonText : buttonText
    if (ariaLabel) button.setAttribute('aria-label', `${expanded ? expandedText ?? buttonText ?? title : buttonText ?? title}：${ariaLabel}`)
    if (typeof onToggle === 'function') onToggle(expanded)
    else state.disclosures.set(id, expanded)
  })
  root.append(button, region)
  return { root, button, region }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const ICON_PATHS = Object.freeze({
  attention: ['M8 1.5 14.5 14h-13L8 1.5Z', 'M8 5v4', 'M8 11.5v.1'],
  chevron: ['m5.5 6.5 2.5 2.5 2.5-2.5'],
  arrow: ['M2.5 8h10', 'm8.5 4 4 4-4 4'],
  external: ['M9 3h4v4M13 3 7.5 8.5', 'M11.5 8.5v3.8H4V4.8h3.8'],
  link: ['M6.4 9.6 9.6 6.4M5.2 11.8l-1 1a2.7 2.7 0 0 1-3.8-3.8l3-3a2.7 2.7 0 0 1 3.8 0', 'M10.8 4.2l1-1a2.7 2.7 0 0 1 3.8 3.8l-3 3a2.7 2.7 0 0 1-3.8 0'],
  // X 標誌是一條粗斜帶加一條細反斜線；兩條等寬線條會被看成「關閉」按鈕。
  x: ['M2.5 2.5h3l8 11h-3z', 'M13.2 2.5 9.3 6.9M6.7 9.1 2.8 13.5'],
})

function createIcon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  if (className) svg.setAttribute('class', className)
  for (const pathData of ICON_PATHS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', pathData)
    svg.append(path)
  }
  return svg
}

function appendHighlightedNumbers(parent, value) {
  const text = String(value ?? '')
  let offset = 0
  for (const match of text.matchAll(/\d+\s*(?:天|小時|時|分|秒)?/gu)) {
    const start = match.index ?? 0
    if (start > offset) parent.append(document.createTextNode(text.slice(offset, start)))
    const group = document.createElement('span')
    group.className = 'codex-reset-value-group'
    const number = document.createElement('span')
    number.className = 'codex-reset-number'
    const valueMatch = match[0].match(/^(\d+)([\s\S]*)$/u)
    number.textContent = valueMatch?.[1] ?? match[0]
    group.append(number)
    if (valueMatch?.[2]) group.append(document.createTextNode(valueMatch[2]))
    parent.append(group)
    offset = start + match[0].length
  }
  if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)))
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

function setBusy(element, busy) {
  if (busy) element.setAttribute('aria-busy', 'true')
  else element.removeAttribute('aria-busy')
}

function setGlobalStatus(message, duration = 4500) {
  if (globalStatusTimer !== null) clearTimeout(globalStatusTimer)
  globalStatusTimer = null
  elements.status.textContent = message || ''
  if (message && duration > 0) {
    globalStatusTimer = setTimeout(() => {
      elements.status.textContent = ''
      globalStatusTimer = null
    }, duration)
  }
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
    else if (state.radar && !state.detail && outcome !== 'complete') {
      if (state.activeTab === 'overview' && elements.sources) renderSources()
      else if (state.activeTab === 'reset' && elements.resetSources) {
        renderSources(elements.resetSources, currentSources().filter(source => source.id === 'codex-resets'))
      }
    }
    if (outcome === 'timeout') {
      const source = currentSources().find(item => item.id === key)
      setGlobalStatus(key === 'all'
        ? '同步逾時，請查看來源狀態。'
        : `${source?.label ?? labels.source[key] ?? '來源'} 同步逾時，請稍後再試。`)
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
      if (!existingHint) appendText(value.parentElement ?? card, 'span', 'loading-copy summary-sync-copy', '正在同步…')
    } else {
      value.classList.remove('skeleton-value')
      value.removeAttribute('aria-hidden')
      existingHint?.remove()
    }
  }
}

function renderSpotlightSkeleton(target) {
  target ??= elements.resetSpotlight
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
  target.replaceChildren(card)
  setBusy(target, true)
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
  elements.resultStatus.textContent = '正在同步…'
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

function updateChangeLabel(update) {
  return labels.changeType[update?.changeType] ?? labels.category[update?.category] ?? '更新'
}

function appendQuickRead(parent, update) {
  const attention = attentionSignal(update)
  const section = document.createElement('section')
  section.className = 'quick-read'
  section.setAttribute('aria-label', '重點')
  appendInsight(section, '變更', updateChangeLabel(update))
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
      if (note) note.textContent = '已在瀏覽器開啟'
    } catch (error) {
      const code = error && typeof error === 'object' ? (error.code ?? error.message ?? '') : ''
      if (note) note.textContent = code === 'rate_limited' ? '操作太頻繁，請稍後再試' : code === 'denied' ? '請再點一次' : '無法開啟連結'
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
      if (note) note.textContent = '已在瀏覽器開啟'
    } catch (error) {
      const code = error && typeof error === 'object' ? (error.code ?? error.message ?? '') : ''
      if (note) note.textContent = code === 'rate_limited' ? '操作太頻繁，請稍後再試' : code === 'denied' ? '請再點一次' : '無法開啟連結'
    } finally {
      opening = false
      link.removeAttribute('aria-busy')
    }
  })
}

function appendSourceAction(parent, update, { inline = false } = {}) {
  const sourceUrl = safeSourceUrl(update.sourceUrl)
  if (!sourceUrl) {
    return appendText(parent, inline ? 'span' : 'p', 'source-unavailable', '無法驗證這個連結。')
  }
  const row = inline ? parent : document.createElement('div')
  if (!inline) row.className = 'source-action'
  const button = appendText(row, 'button', `source-button${inline ? ' source-button-inline' : ''}`, isTiboUpdate(update) ? '查看 X 原文' : '查看官方來源')
  button.prepend(createIcon(isTiboUpdate(update) ? 'x' : 'external'))
  button.type = 'button'
  button.title = '使用系統瀏覽器開啟'
  const note = appendText(row, 'span', 'source-note', '')
  bindExternalButton(button, sourceUrl, note)
  if (!inline) parent.append(row)
  return row
}

// 官方摘要常以標題開頭；預覽只留標題之後的內容，同一句才不會在標題與預覽各出現一次。
function textAfterTitle(title, text) {
  const source = String(text ?? '').normalize('NFC').trim()
  const heading = String(title ?? '').normalize('NFC').trim()
  const candidates = [heading, heading.replace(/(?:…|\.{3})$/u, '')].filter(Boolean)
  for (const candidate of [...new Set(candidates)]) {
    const words = candidate.split(/\s+/u).filter(Boolean)
    const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+')
    const match = source.match(new RegExp(`^${escaped}`, 'iu'))
    if (match) return source.slice(match[0].length).replace(/^[\s\p{P}…]+/u, '')
  }
  return source
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

function officialBodyText(title, summary) {
  return textAfterTitle(title, summary).trim()
}

function syncTabLifecycles() {
  const countdownVisible = !state.detail && ['overview', 'reset'].includes(state.activeTab)
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const interval = reducedMotion || state.activeTab === 'overview' ? 60_000 : 1_000
  if (!countdownVisible || !codexResetCountdownTick) {
    if (codexResetCountdownTimer !== null) clearTimeout(codexResetCountdownTimer)
    codexResetCountdownTimer = null
  } else if (codexResetCountdownTimer === null) {
    codexResetCountdownTimer = setTimeout(() => codexResetCountdownTick?.(), interval)
  }
}

function findResetPost(updates, latestReset) {
  if (!latestReset || typeof latestReset !== 'object') return null
  const rows = Array.isArray(updates) ? updates : []
  const expectedId = latestReset.id === undefined || latestReset.id === null ? '' : `x-${latestReset.id}`
  if (expectedId) {
    const idMatch = rows.find(update => update?.id === expectedId)
    if (idMatch) return idMatch
  }
  if (typeof latestReset.sourceUrl !== 'string' || !latestReset.sourceUrl) return null
  return rows.find(update => update?.sourceUrl === latestReset.sourceUrl) ?? null
}

function renderTiboBubble(update, role = '', { isResetPost = false, showResetAction = true, showUnavailableLink = true } = {}) {
  const row = document.createElement('div')
  row.className = `message-row provider-x${role ? ` message-${role}` : ''}`
  const avatar = appendText(row, 'span', 'source-avatar', 'T')
  avatar.setAttribute('aria-hidden', 'true')
  const bubble = document.createElement('div')
  bubble.className = `message-bubble${isResetPost ? ' is-reset-post' : ''}${state.absoluteTime ? ' is-absolute-time' : ''}`

  const meta = document.createElement('div')
  meta.className = 'message-meta'
  const dateTime = update.publishedAtTime ?? update.publishedAt ?? ''
  const resetType = isResetPost ? state.radar?.codexReset?.latestReset?.resetType : ''
  const typeLabel = isResetPost
    ? `Codex 重設${resetType ? ` · ${resetTypeLabel(resetType)}` : ''}`
    : role === 'self-reply' ? '續文' : '貼文'
  appendText(meta, 'span', 'message-source-label', 'Tibo / X')
  appendText(meta, 'span', 'message-type-chip', typeLabel)
  const time = appendText(meta, 'time', 'message-time', formatUpdateTime(update))
  time.dateTime = dateTime
  bubble.append(meta)

  const preview = document.createElement('p')
  preview.className = 'message-preview message-full'
  appendText(preview, 'span', 'message-text', update.summary || update.title || '原文內容未提供。')
  bubble.append(preview)
  if (safeSourceUrl(update.sourceUrl) || showUnavailableLink) {
    const sourceActions = appendText(bubble, 'div', 'message-source-actions', '')
    appendSourceAction(sourceActions, update, { inline: true })
  }
  if (isResetPost && showResetAction) {
    const actions = appendText(bubble, 'div', 'message-reset-actions', '')
    const button = appendText(actions, 'button', 'message-reset-action', '查看 Codex 重設')
    button.type = 'button'
    button.addEventListener('click', () => activateTab('reset', {
      afterRestore: () => document.querySelector('#reset-spotlight-heading')?.focus({ preventScroll: true }),
    }))
  }
  row.append(bubble)
  return row
}

function renderTiboUpdate(update, isResetPost = false) {
  const article = document.createElement('article')
  article.className = 'update-item provider-x'
  const role = update.postKind === 'self-reply' ? 'self-reply' : 'root'
  article.append(renderTiboBubble(update, role, { isResetPost }))
  return article
}

function renderOfficialUpdate(update, unitKey, now = Date.now()) {
  const article = document.createElement('article')
  article.className = 'update-item official-record'
  article.classList.toggle('is-expanded', state.expanded.has(unitKey))
  const meta = document.createElement('div')
  meta.className = 'update-card-meta'
  appendText(meta, 'span', 'update-source', sourceLabel(update))
  appendText(meta, 'span', 'update-type-chip', updateChangeLabel(update))
  const unit = [update]
  if (unitNeedsAttention(unit, now)) {
    const signal = attentionSignal(update)
    const attention = appendText(meta, 'span', `update-attention attention-${signal.tone}`, '')
    appendText(attention, 'span', 'attention-dot', '').setAttribute('aria-hidden', 'true')
    appendText(attention, 'span', '', `需留意 · ${signal.label}`)
  }
  const dateTime = update.publishedAtTime ?? update.publishedAt ?? ''
  const time = appendText(meta, 'time', 'update-time', formatUpdateTime(update))
  time.dateTime = dateTime
  article.append(meta)

  const { headline, previewText } = officialHeadline(update)
  const heading = document.createElement('div')
  heading.className = 'official-headline-row'
  appendText(heading, 'h3', 'official-title update-card-title', headline)
  if (previewText) appendText(heading, 'p', 'official-preview', previewText)

  const disclosure = createDisclosure({
    id: `update-${encodeURIComponent(unitKey)}`,
    title: '更新內容',
    meta: '',
    open: state.expanded.has(unitKey),
    buttonText: '展開',
    expandedText: '收合',
    buttonClass: 'disclosure-button card-disclosure-button',
    rootClass: 'card-disclosure',
    regionClass: 'disclosure-region update-disclosure-region',
    ariaLabel: `${sourceLabel(update)}：${headline}`,
    onToggle(expanded) {
      article.classList.toggle('is-expanded', expanded)
      if (expanded) state.expanded.add(unitKey)
      else state.expanded.delete(unitKey)
    },
  })
  appendQuickRead(disclosure.region, update)
  const bodyText = officialBodyText(headline, update.summary)
  if (bodyText) appendText(disclosure.region, 'p', 'official-full-text', bodyText)
  appendVersion(disclosure.region, update)
  appendSourceAction(disclosure.region, update)
  heading.append(disclosure.root)
  article.append(heading)
  return article
}

// --- 合併卡片：Claude Code 版本、Claude Platform 日期 ----------------------------
// Claude Code 一個版本常有上百條變更、Claude Platform 同一天常公布好幾項；面板依版本／日期合併成一張卡，
// 儲存仍保留逐條資料，篩選與搜尋照常作用在每一條。
const CHANGE_SECTION_ORDER = Object.freeze(['added', 'improved', 'fixed', 'deprecated', 'removed'])

function groupKey(update) {
  if (update?.sourceId === 'claude-code' && update.version) return `release:${update.version}`
  if (update?.sourceId === 'anthropic-platform' && update.publishedAt) return `day:${update.publishedAt}`
  return null
}

function byPosition(left, right) {
  return (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
}

// 卡片單位：同一個版本或同一天的 Platform 更新算一張，其餘每則各算一張；摘要數字與熱度圖都以卡片計。
function updateUnits(updates) {
  const units = new Map()
  for (const update of updates) {
    const key = groupKey(update) ?? `update:${update.id}`
    const unit = units.get(key)
    if (unit) unit.push(update)
    else units.set(key, [update])
  }
  return [...units.values()]
}

function overviewHighlights(units, now = Date.now(), limit = 3) {
  const nowValue = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const dateValue = Number.isFinite(nowValue) ? new Date(nowValue) : new Date(0)
  const today = Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate())
  const cutoff = today + 30 * 86_400_000
  const nearestRetirement = unit => Math.min(...unit.flatMap(update => Array.isArray(update.retirements) ? update.retirements : [])
    .map(row => typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? Date.parse(`${row.date}T00:00:00Z`) : Number.NaN)
    .filter(timestamp => Number.isFinite(timestamp) && timestamp >= today && timestamp <= cutoff))
  const latestTimestamp = unit => Math.max(...unit.map(updateTimestamp))
  const unitPosition = unit => Math.min(...unit.map(update => Number.isFinite(update.position) ? update.position : Number.MAX_SAFE_INTEGER))
  return units
    .filter(unit => Array.isArray(unit) && unit.length > 0 && !unit.some(isTiboUpdate))
    .slice()
    .sort((left, right) => {
      const attentionOrder = Number(unitNeedsAttention(right, now)) - Number(unitNeedsAttention(left, now))
      if (attentionOrder) return attentionOrder
      const retirementOrder = nearestRetirement(left) - nearestRetirement(right)
      if (retirementOrder) return retirementOrder
      const timeOrder = latestTimestamp(right) - latestTimestamp(left)
      if (timeOrder) return timeOrder
      return unitPosition(left) - unitPosition(right)
    })
    .slice(0, Math.max(0, Math.floor(limit)))
}

function isCriticalChange(update) {
  return ['deprecated', 'removed'].includes(update.changeType)
}

// 合併卡只看移除／棄用；逐條套用關鍵字判斷時，幾乎每個版本都會有一條提到 permission 或 security。
const ATTENTION_WINDOW_DAYS = 14 // Keep attention useful within the one-to-two-week window requested by users.

function unitNeedsAttention(unit, now = Date.now()) {
  if (!Array.isArray(unit) || unit.length === 0 || unit.some(isTiboUpdate)) return false
  const first = unit[0]
  const hasExistingAttention = unit.length > 1 || groupKey(first)?.startsWith('release:')
    ? unit.some(isCriticalChange)
    : isCriticalChange(first) || attentionSignal(first).tone !== 'neutral'
  if (!hasExistingAttention) return false

  const nowTime = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTime)) return false
  const dayMilliseconds = 86_400_000
  const windowMilliseconds = ATTENTION_WINDOW_DAYS * dayMilliseconds
  const parseAttentionTimestamp = value => {
    if (typeof value !== 'string') return Number.NaN
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/.exec(value)
    if (dateParts) {
      const year = Number(dateParts[1])
      const month = Number(dateParts[2])
      const day = Number(dateParts[3])
      const parsed = new Date(0)
      parsed.setUTCHours(0, 0, 0, 0)
      parsed.setUTCFullYear(year, month - 1, day)
      if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return Number.NaN
    }
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : Number.NaN
  }
  const latestPublishedAt = Math.max(...unit.map(update => {
    const publishedAtTime = parseAttentionTimestamp(update.publishedAtTime)
    const timestamp = Number.isFinite(publishedAtTime) ? publishedAtTime : parseAttentionTimestamp(update.publishedAt)
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
  }))
  if (latestPublishedAt >= nowTime - windowMilliseconds && latestPublishedAt <= nowTime) return true

  const today = new Date(nowTime)
  const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const isUpcomingDate = value => {
    if (typeof value !== 'string') return false
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (dateOnly) {
      const year = Number(dateOnly[1])
      const month = Number(dateOnly[2])
      const day = Number(dateOnly[3])
      const parsed = parseAttentionTimestamp(value)
      if (!Number.isFinite(parsed)) return false
      const daysAhead = (Date.UTC(year, month - 1, day) - todayKey) / dayMilliseconds
      return Number.isInteger(daysAhead) && daysAhead >= 0 && daysAhead <= ATTENTION_WINDOW_DAYS
    }
    const timestamp = parseAttentionTimestamp(value)
    return Number.isFinite(timestamp) && timestamp >= nowTime && timestamp <= nowTime + windowMilliseconds
  }

  return unit.some(update => isUpcomingDate(update.effectiveAt)
    || (Array.isArray(update.retirements) && update.retirements.some(row => isUpcomingDate(row?.date))))
}

// 卡片內完整展開的上限；更多變更改由詳情頁顯示。
const CHANGE_INLINE_EXPAND_MAX = 20

function appendGroupedChange(list, update, withDetail) {
  const { headline, previewText } = officialHeadline(update)
  const item = document.createElement('li')
  item.className = 'change-item'
  appendText(item, 'span', `change-item-type change-${update.changeType}`, labels.changeType[update.changeType] ?? '更新')
  const body = document.createElement('div')
  body.className = 'change-item-body'
  appendText(body, 'p', 'change-item-text', headline)
  if (withDetail && previewText) appendText(body, 'p', 'change-item-detail', previewText)
  item.append(body)
  list.append(item)
}

function appendChangeSections(parent, changes, type = 'all') {
  for (const sectionType of CHANGE_SECTION_ORDER) {
    if (type !== 'all' && type !== sectionType) continue
    const items = changes.filter(update => update.changeType === sectionType)
    if (items.length === 0) continue
    const section = document.createElement('section')
    section.className = 'change-section'
    appendText(section, 'h4', `change-section-title change-${sectionType}`, `${labels.changeType[sectionType]} ${items.length}`)
    const list = document.createElement('ul')
    list.className = 'change-list'
    for (const update of items) appendGroupedChange(list, update, true)
    section.append(list)
    parent.append(section)
  }
}

// 類型切換只出現在展開後；按鈕以 aria-pressed 表示目前選擇，選擇後只重繪清單本身。
function appendChangeBrowser(parent, changes, initialType = 'all', onTypeChange = () => {}) {
  const chips = document.createElement('div')
  chips.className = 'type-chips'
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', '依變更類型篩選')
  const sections = document.createElement('div')
  sections.className = 'change-sections'
  const options = [['all', `全部 ${changes.length}`], ...CHANGE_SECTION_ORDER
    .map(type => [type, changes.filter(update => update.changeType === type).length])
    .filter(([, count]) => count > 0)
    .map(([type, count]) => [type, `${labels.changeType[type]} ${count}`])]
  let selected = options.some(([type]) => type === initialType) ? initialType : 'all'
  const buttons = options.map(([type, text]) => {
    const button = appendText(chips, 'button', `type-chip${type === 'all' ? '' : ` change-${type}`}`, text)
    button.type = 'button'
    button.dataset.type = type
    button.addEventListener('click', () => {
      selected = type
      paint()
      onTypeChange(type)
    })
    return button
  })
  function paint() {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.type === selected))
    sections.replaceChildren()
    appendChangeSections(sections, changes, selected)
  }
  parent.append(chips)
  parent.append(sections)
  paint()
}

function changeGroupTitle(first) {
  return groupKey(first)?.startsWith('release:') ? first.version : formatDate(first.publishedAt)
}

function renderChangeGroup(changes, matches, unitKey, now = Date.now()) {
  const first = changes[0]
  const key = groupKey(first)
  const isRelease = key?.startsWith('release:')
  const article = document.createElement('article')
  article.className = 'update-item official-record change-group'
  const meta = document.createElement('div')
  meta.className = 'update-card-meta'
  appendText(meta, 'span', 'update-source', sourceLabel(first))
  appendText(meta, 'span', 'update-type-chip', isRelease ? '版本更新' : '每日更新')
  if (unitNeedsAttention(changes, now)) {
    const attention = appendText(meta, 'span', 'update-attention attention-critical', '')
    appendText(attention, 'span', 'attention-dot', '').setAttribute('aria-hidden', 'true')
    appendText(attention, 'span', '', '需留意 · 含移除或棄用')
  }
  const latest = changes.reduce((current, update) => updateTimestamp(update) > updateTimestamp(current) ? update : current, first)
  const time = appendText(meta, 'time', 'update-time', formatUpdateTime(latest))
  time.dateTime = latest.publishedAtTime ?? latest.publishedAt ?? ''
  article.append(meta)

  const heading = document.createElement('div')
  heading.className = 'change-group-heading'
  appendText(heading, 'h3', 'official-title change-group-title', changeGroupTitle(first))
  if (isRelease && first.previousVersion) appendText(heading, 'span', 'change-group-subtitle', `上一版 ${first.previousVersion}`)
  if (!isRelease) appendText(heading, 'span', 'change-group-subtitle', `共 ${changes.length} 項`)
  article.append(heading)

  const counts = document.createElement('ul')
  counts.className = 'change-counts'
  counts.setAttribute('aria-label', '各類變更數量')
  for (const type of CHANGE_SECTION_ORDER) {
    const count = changes.filter(update => update.changeType === type).length
    if (count) appendText(counts, 'li', `change-count change-${type}`, `${labels.changeType[type]} ${count}`)
  }
  article.append(counts)
  if (matches.length < changes.length) {
    appendText(article, 'p', 'change-filter-note', `符合 ${matches.length} 項，共 ${changes.length} 項`)
  }

  if (matches.length > CHANGE_INLINE_EXPAND_MAX) {
    const actions = document.createElement('div')
    actions.className = 'change-group-actions'
    const open = appendText(actions, 'button', 'change-detail-open', `查看全部 ${matches.length} 項變更`)
    open.type = 'button'
    open.dataset.detailKey = key
    open.addEventListener('click', () => openChangeDetail(key))
    article.append(actions)
    return article
  }

  const disclosure = createDisclosure({
    id: `update-${encodeURIComponent(unitKey)}`,
    title: isRelease ? first.version : formatDate(first.publishedAt),
    meta: '',
    open: state.expanded.has(unitKey),
    buttonText: '展開',
    expandedText: '收合',
    buttonClass: 'disclosure-button card-disclosure-button',
    rootClass: 'card-disclosure',
    regionClass: 'disclosure-region update-disclosure-region',
    ariaLabel: `${sourceLabel(first)} ${changeGroupTitle(first)} 的完整變更`,
    onToggle(expanded) {
      if (expanded) state.expanded.add(unitKey)
      else state.expanded.delete(unitKey)
    },
  })

  appendChangeBrowser(disclosure.region, matches)
  appendSourceAction(disclosure.region, first)
  article.append(disclosure.root)
  return article
}

// --- 變更詳情頁 ---------------------------------------------------------------
// 上百條變更在同一個面板內切換成詳情頁，不開新視窗也不改變面板大小；返回時還原捲動位置與焦點。
function findChangeGroup(key) {
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  return groupUpdates(updates).find(group => group.kind === 'changes' && groupKey(group.updates[0]) === key) ?? null
}

function openChangeDetail(key) {
  state.detail = { key, type: 'all', scrollY: window.scrollY }
  renderChangeDetail()
  syncTabLifecycles()
  updateStickyMeasurements()
  window.scrollTo(0, 0)
  elements.detailBack.focus({ preventScroll: true })
}

function closeChangeDetail() {
  const detail = state.detail
  state.detail = null
  elements.detailView.hidden = true
  elements.detailView.replaceChildren()
  elements.tabList.hidden = false
  for (const [id, panel] of Object.entries(elements.panels)) panel.hidden = id !== state.activeTab
  tabController.renderIfStale()
  syncTabLifecycles()
  updateStickyMeasurements()
  if (!detail) return
  window.scrollTo(0, detail.scrollY)
  const returnTarget = elements.updates.querySelector(`[data-detail-key="${CSS.escape(detail.key)}"]`)
  returnTarget?.scrollIntoView?.({ block: 'nearest' })
  returnTarget?.focus({ preventScroll: true })
}

function renderChangeDetail() {
  if (!state.detail) return
  const now = Date.now()
  const group = findChangeGroup(state.detail.key)
  if (!group) {
    closeChangeDetail()
    return
  }
  const changes = group.updates
  const matches = changes.filter(update => matchesFilters(update, changes, now))
  const shown = matches.length ? matches : changes
  const first = changes[0]
  const isRelease = state.detail.key.startsWith('release:')
  elements.detailView.replaceChildren()

  const bar = document.createElement('div')
  bar.className = 'detail-bar'
  bar.append(elements.detailBack)
  elements.detailView.append(bar)

  const article = document.createElement('article')
  article.className = 'official-record change-detail-body'
  const meta = document.createElement('div')
  meta.className = 'official-meta'
  appendText(meta, 'span', 'official-source-label', sourceLabel(first))
  const time = appendText(meta, 'time', 'official-time-chip', formatDate(first.publishedAt))
  time.dateTime = first.publishedAt ?? ''
  article.append(meta)
  const title = appendText(article, 'h2', 'change-detail-title', isRelease ? `${sourceLabel(first)} ${first.version}` : `${sourceLabel(first)} · ${formatDate(first.publishedAt)}`)
  title.id = 'change-detail-title'
  if (isRelease && first.previousVersion) appendText(article, 'p', 'change-group-subtitle', `上一版 ${first.previousVersion}`)
  if (shown.length < changes.length) appendText(article, 'p', 'change-filter-note', `符合 ${shown.length} 項，共 ${changes.length} 項`)
  appendChangeBrowser(article, shown, state.detail.type, (type) => { if (state.detail) state.detail.type = type })
  appendSourceAction(article, first)
  elements.detailView.append(article)
  elements.detailView.setAttribute('aria-labelledby', title.id)
  elements.tabList.hidden = true
  for (const panel of Object.values(elements.panels)) panel.hidden = true
  elements.detailView.hidden = false
}

// --- 停用警示卡 ---------------------------------------------------------------
const RETIREMENT_PREVIEW_COUNT = 2
const DAY_MS = 24 * 60 * 60 * 1000

function daysUntil(isoDay) {
  const [year, month, day] = isoDay.split('-').map(Number)
  const now = new Date()
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
}

// 以最近一個尚未到的停用日為準；全部已過則顯示最後一個停用日。顏色之外也用文字說明緊急程度。
function retirementStatus(retirements) {
  const dates = [...new Set(retirements.map(row => row.date).filter(Boolean))].sort()
  if (dates.length === 0) return { text: '停用日期未定', tone: 'neutral' }
  const upcoming = dates.find(date => daysUntil(date) >= 0)
  if (!upcoming) return { text: `已於 ${formatDate(dates[dates.length - 1])} 停用`, tone: 'past' }
  const days = daysUntil(upcoming)
  const prefix = dates.length > 1 ? '最早 ' : ''
  const when = days === 0 ? '今天停用' : `${days} 天後停用`
  return { text: `${prefix}${when} · ${formatDate(upcoming)}`, tone: days <= 30 ? 'critical' : days <= 90 ? 'warn' : 'neutral' }
}

function appendRetirementRow(list, row, showDate) {
  const item = document.createElement('li')
  item.className = 'retirement-row'
  appendText(item, 'span', 'retirement-model', row.model)
  appendText(item, 'span', 'retirement-arrow', '→').setAttribute('aria-label', '改用')
  appendText(item, 'span', row.replacement ? 'retirement-replacement' : 'retirement-replacement is-missing', row.replacement ?? '未提供替代')
  if (showDate) appendText(item, 'span', 'retirement-date', row.date ? formatDate(row.date) : '日期未定')
  list.append(item)
}

function renderRetirement(update, unitKey, now = Date.now()) {
  const rows = update.retirements
  const article = document.createElement('article')
  article.className = 'update-item official-record retirement-record'
  const meta = document.createElement('div')
  meta.className = 'update-card-meta'
  appendText(meta, 'span', 'update-source', sourceLabel(update))
  appendText(meta, 'span', 'update-type-chip', updateChangeLabel(update))
  const time = appendText(meta, 'time', 'update-time', formatUpdateTime(update))
  time.dateTime = update.publishedAtTime ?? update.publishedAt ?? ''
  article.append(meta)

  const flags = document.createElement('div')
  flags.className = 'update-card-flags'
  const status = retirementStatus(rows)
  const retirement = appendText(flags, 'span', `retirement-status retirement-${status.tone}`, '')
  appendText(retirement, 'span', 'retirement-status-dot', '').setAttribute('aria-hidden', 'true')
  appendText(retirement, 'span', '', status.text)
  if (unitNeedsAttention([update], now)) {
    const signal = attentionSignal(update)
    const attention = appendText(flags, 'span', `update-attention attention-${signal.tone}`, '')
    appendText(attention, 'span', 'attention-dot', '').setAttribute('aria-hidden', 'true')
    appendText(attention, 'span', '', `需留意 · ${signal.label}`)
  }
  article.append(flags)
  appendText(article, 'h3', 'official-title update-card-title', update.title || '未命名公告')

  const showDate = new Set(rows.map(row => row.date)).size > 1
  const list = document.createElement('ul')
  list.className = 'retirement-list'
  list.setAttribute('aria-label', '停用型號與建議替代')
  for (const row of rows.slice(0, RETIREMENT_PREVIEW_COUNT)) appendRetirementRow(list, row, showDate)
  article.append(list)

  const extra = rows.length - RETIREMENT_PREVIEW_COUNT
  const hasSource = Boolean(update.sourceUrl)
  if (extra > 0 || update.summary || hasSource) {
    const disclosure = createDisclosure({
      id: `update-${encodeURIComponent(unitKey)}`,
      title: update.title || '停用型號與說明',
      meta: '',
      open: state.expanded.has(unitKey),
      buttonText: '展開',
      expandedText: '收合',
      buttonClass: 'disclosure-button card-disclosure-button',
      rootClass: 'card-disclosure',
      regionClass: 'disclosure-region update-disclosure-region',
      ariaLabel: `${sourceLabel(update)}：停用型號與說明`,
      onToggle(expanded) {
        if (expanded) state.expanded.add(unitKey)
        else state.expanded.delete(unitKey)
      },
    })
    if (extra > 0) {
      const rest = document.createElement('ul')
      rest.className = 'retirement-list retirement-extra-list'
      for (const row of rows.slice(RETIREMENT_PREVIEW_COUNT)) appendRetirementRow(rest, row, showDate)
      disclosure.region.append(rest)
    }
    if (update.summary) appendText(disclosure.region, 'p', 'retirement-note', update.summary)
    if (hasSource) appendSourceAction(disclosure.region, update)
    article.append(disclosure.root)
  }
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
  if (!Number.isFinite(timestamp)) return '上次重設時間不明'
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

function tickCodexCountdown() {
  const scheduledAt = state.radar?.codexReset?.scheduledReset?.at
  if (typeof scheduledAt !== 'string') {
    codexResetCountdownTick = null
    codexResetCountdownTimer = null
    return
  }
  const countdownText = formatScheduledCountdown(scheduledAt)
  if (state.activeTab === 'overview') {
    const shortCountdown = countdownText.match(/^\d+ 天 \d+ 時/u)?.[0]
    elements.codexOverviewStatus.textContent = countdownText === '預定時間已到，等待狀態更新'
      ? countdownText
      : `${shortCountdown ?? countdownText} 後重設`
    elements.codexOverviewStatus.setAttribute('aria-label', `前往 Codex 重設頁；${elements.codexOverviewStatus.textContent}`)
  } else if (state.activeTab === 'reset') {
    const countdown = elements.resetSpotlight.querySelector('.codex-reset-countdown')
    if (countdown) {
      countdown.replaceChildren()
      appendHighlightedNumbers(countdown, countdownText)
      countdown.setAttribute('aria-label', `距預定重設時間 ${countdown.textContent}`)
    }
  }
  codexResetCountdownTimer = null
  if (countdownText === '預定時間已到，等待狀態更新') codexResetCountdownTick = null
  syncTabLifecycles()
}

function renderSpotlight(target) {
  target ??= elements.resetSpotlight
  elements.resetSources = null
  if (codexResetCountdownTimer !== null) {
    clearTimeout(codexResetCountdownTimer)
  }
  codexResetCountdownTimer = null
  codexResetCountdownTick = null
  const reset = state.radar?.codexReset
  const latestReset = reset?.latestReset ?? null
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const resetPost = findResetPost(updates, latestReset)
  const sources = currentSources()
  const source = sources.find(item => item.id === 'codex-resets')
  const allSourcesFailed = sources.length > 0 && sources.every(item => ['stale', 'error'].includes(item.status))
  const sourceLoading = source?.status === 'loading'
  const spotlightLoader = target.closest('.spotlight-section').querySelector('.spotlight-loader')
  spotlightLoader.hidden = !sourceLoading || !reset
  const scheduledAt = reset?.scheduledReset?.at
  const hasScheduledReset = typeof scheduledAt === 'string' && Number.isFinite(Date.parse(scheduledAt))
  const hasFutureSchedule = hasScheduledReset && Date.parse(scheduledAt) > Date.now()
  const card = document.createElement('article')
  card.className = 'spotlight-card codex-reset-card'

  if (!reset) {
    if (sourceLoading || isInitialDataSyncing()) {
      renderSpotlightSkeleton(target)
      return
    }
    appendText(card, 'p', 'codex-reset-status', '無法讀取 Codex 重設資料，請稍後再試。').setAttribute('role', 'status')
    appendCodexSourceDisclosure(card, source, latestReset, resetPost)
    target.replaceChildren(card)
    setBusy(target, false)
    return
  }
  setBusy(target, sourceLoading)
  const staleWarning = allSourcesFailed ? document.createElement('p') : null
  if (staleWarning) {
    staleWarning.className = 'codex-reset-status'
    staleWarning.textContent = '讀取失敗，顯示上次的資料。'
    staleWarning.setAttribute('role', 'status')
  }

  const cardHead = document.createElement('div')
  cardHead.className = 'codex-reset-card-head'
  const flag = document.createElement('span')
  flag.className = `spotlight-flag ${hasScheduledReset ? 'attention-warn' : 'attention-neutral'}`
  const dot = document.createElement('span')
  dot.className = 'spotlight-flag-dot'
  dot.setAttribute('aria-hidden', 'true')
  flag.append(dot, document.createTextNode(hasScheduledReset ? '已排定重設' : '最新狀態'))
  cardHead.append(flag)
  card.append(cardHead)

  if (hasScheduledReset) {
    const countdownText = formatScheduledCountdown(scheduledAt)
    const countdown = appendText(card, 'p', 'codex-reset-countdown', '')
    appendHighlightedNumbers(countdown, countdownText)
    countdown.setAttribute('aria-live', 'off')
    countdown.setAttribute('aria-label', `距預定重設時間 ${countdown.textContent}`)
    if (hasFutureSchedule) codexResetCountdownTick = tickCodexCountdown
  } else {
    const countdown = appendText(card, 'p', 'codex-reset-countdown', '')
    appendHighlightedNumbers(countdown, formatTimeSinceReset(reset.stats.lastResetAt))
  }

  const facts = document.createElement('dl')
  facts.className = 'codex-reset-facts'
  const factRows = [
    ['上次重設時間', formatAbsoluteResetTime(reset.stats.lastResetAt)],
    ['重設類型', latestReset?.resetType ? resetTypeLabel(latestReset.resetType) : '重設'],
    ['累計次數', `${reset.stats.total} 次`],
  ]
  if (hasScheduledReset) factRows.push(['預定時間', formatAbsoluteResetTime(scheduledAt), scheduledAt])
  for (const [label, value, dateTime] of factRows) {
    const row = document.createElement('div')
    row.className = 'codex-reset-fact'
    appendText(row, 'dt', '', label)
    const factValue = appendText(row, 'dd', '', '')
    if (label === '重設類型') appendText(factValue, 'span', 'reset-type-chip', value)
    else if (dateTime) {
      const scheduledTime = appendText(factValue, 'time', '', value)
      scheduledTime.dateTime = dateTime
    } else factValue.textContent = value
    facts.append(row)
  }
  card.append(facts)
  renderCodexResetPost(card, latestReset, resetPost)
  appendCodexSourceDisclosure(card, source, latestReset, resetPost)
  target.replaceChildren(...(staleWarning ? [staleWarning, card] : [card]))
}

function renderCodexResetPost(parent, latestReset, update) {
  const section = document.createElement('section')
  section.className = 'codex-reset-post'
  section.setAttribute('aria-label', 'Tibo 重設貼文')
  appendText(section, 'h3', 'codex-reset-post-heading', 'Tibo 重設貼文')

  const fallbackText = typeof latestReset?.text === 'string' ? Array.from(latestReset.text).slice(0, 280).join('') : ''
  const resetUrl = safeSourceUrl(latestReset?.sourceUrl)
  const updateUrl = safeSourceUrl(update?.sourceUrl)
  if (!update && !fallbackText.trim() && !resetUrl) {
    appendText(section, 'p', 'codex-reset-post-empty', '這次重設沒有對應的 Tibo 貼文')
    parent.append(section)
    return section
  }

  const post = update
    ? {
        ...update,
        summary: update.summary || update.title || fallbackText,
        sourceUrl: updateUrl ?? resetUrl ?? update.sourceUrl,
      }
    : {
        provider: 'x',
        sourceId: 'tibo-x',
        postKind: 'root',
        title: '',
        summary: fallbackText,
        publishedAtTime: latestReset?.announcedAt ?? '',
        sourceUrl: resetUrl ?? '',
      }
  section.append(renderTiboBubble(post, post.postKind === 'self-reply' ? 'self-reply' : 'root', {
    isResetPost: true,
    showResetAction: false,
    showUnavailableLink: false,
  }))
  parent.append(section)
  return section
}

function appendCodexSourceAttribution(parent, latestReset, resetPost) {
  appendText(parent, 'p', 'codex-source-attribution', '由 codex-resets.com 偵測 Tibo 的重設貼文')
  const sourceUrl = safeSourceUrl(latestReset?.sourceUrl) ?? safeSourceUrl(resetPost?.sourceUrl)
  if (!sourceUrl) return
  const row = appendText(parent, 'div', 'codex-source-post-row', '')
  const link = appendText(row, 'a', 'codex-source-link', '查看 X 原文')
  link.href = '#codex-reset-original-post'
  const note = appendText(row, 'span', 'codex-source-note', '')
  bindExternalLink(link, sourceUrl, note)
}

function appendCodexSourceDisclosure(parent, source, latestReset = null, resetPost = null) {
  const failed = ['stale', 'error'].includes(source?.status)
  let readAt = ''
  const timestamp = Date.parse(source?.fetchedAt ?? '')
  if (Number.isFinite(timestamp)) {
    const parts = new Map(new Intl.DateTimeFormat('zh-TW', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(timestamp).map(part => [part.type, part.value]))
    readAt = `${parts.get('month')}/${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`
  }
  const meta = failed ? '讀取失敗' : source?.status === 'ok' ? `正常${readAt ? ` · ${readAt}` : ''}`
    : source?.status === 'loading' ? '正在讀取' : '尚未讀取'
  const id = 'codex-reset-source'
  let metaNode = null
  const disclosure = createDisclosure({
    id,
    title: '資料來源',
    meta,
    tone: failed ? 'danger' : 'neutral',
    open: state.disclosures.get(id) === true,
    rootClass: 'disclosure-root codex-reset-disclosure-root',
    buttonClass: 'disclosure-button codex-reset-disclosure-button',
    regionClass: 'disclosure-region codex-reset-disclosure-region',
    onToggle(expanded) {
      state.disclosures.set(id, expanded)
      if (metaNode) metaNode.hidden = expanded
    },
  })
  metaNode = disclosure.root.querySelector('.disclosure-meta')
  if (failed && metaNode) {
    const dot = document.createElement('span')
    dot.className = 'disclosure-meta-dot'
    dot.setAttribute('aria-hidden', 'true')
    metaNode.prepend(dot)
  }
  if (disclosure.button.getAttribute('aria-expanded') === 'true' && metaNode) metaNode.hidden = true
  appendCodexSourceAttribution(disclosure.region, latestReset, resetPost)
  const sourceGrid = appendText(disclosure.region, 'div', 'source-grid codex-reset-source-grid', '')
  elements.resetSources = sourceGrid
  renderSources(sourceGrid, source ? [source] : [])
  parent.append(disclosure.root)
  return disclosure
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
  const emittedGroups = new Set()
  const groups = []
  for (const update of updates) {
    const key = groupKey(update)
    if (key) {
      if (emittedGroups.has(key)) continue
      emittedGroups.add(key)
      const members = updates.filter(candidate => groupKey(candidate) === key).sort(byPosition)
      // 只有一項的 Platform 日期直接用一般卡片；版本卡即使只有一條也保留版本資訊。
      groups.push({ kind: members.length > 1 || key.startsWith('release:') ? 'changes' : 'single', updates: members })
      continue
    }
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

function renderThread(group, unitKey, resetPostId = null) {
  const article = document.createElement('article')
  article.className = 'update-thread provider-x'
  article.setAttribute('aria-label', `Tibo 對話串，共 ${group.updates.length} 則`)
  const root = group.updates.find(update => update.postKind === 'root') ?? group.updates[0]
  article.append(renderTiboBubble(root, 'root', { isResetPost: root.id === resetPostId }))
  const replies = group.updates.filter(update => update.id !== root.id)
  if (replies.length === 0) return article

  const disclosure = createDisclosure({
    id: `update-${encodeURIComponent(unitKey)}`,
    title: `${replies.length} 則續文`,
    meta: '',
    open: state.expanded.has(unitKey),
    buttonText: `${replies.length} 則續文`,
    expandedText: `${replies.length} 則續文`,
    buttonClass: 'disclosure-button card-disclosure-button thread-disclosure-button',
    rootClass: 'card-disclosure thread-disclosure',
    regionClass: 'disclosure-region thread-disclosure-region',
    ariaLabel: `Tibo 對話串續文，共 ${replies.length} 則`,
    onToggle(expanded) {
      if (expanded) state.expanded.add(unitKey)
      else state.expanded.delete(unitKey)
    },
  })
  const timeline = document.createElement('ol')
  timeline.className = 'thread-timeline'
  for (const update of replies) {
    const item = document.createElement('li')
    item.className = 'thread-item thread-self-reply'
    item.append(renderTiboBubble(update, 'self-reply', { isResetPost: update.id === resetPostId }))
    timeline.append(item)
  }
  disclosure.region.append(timeline)
  article.append(disclosure.root)
  return article
}

function matchesFilters(update, unit = [update], now = Date.now()) {
  if (state.day && (isTiboUpdate(update) || heatDateKey(update) !== state.day)) return false
  if (elements.provider.value && update.provider !== elements.provider.value) return false
  if (elements.category.value && update.category !== elements.category.value) return false
  if (elements.changeType.value && update.changeType !== elements.changeType.value) return false
  if (state.attentionOnly && !unitNeedsAttention(unit, now)) return false
  const query = elements.search.value.trim().toLocaleLowerCase('zh-Hant')
  if (!query) return true
  const subjects = Array.isArray(update.subjects) ? update.subjects : []
  const retirements = Array.isArray(update.retirements) ? update.retirements.flatMap(row => [row.model, row.replacement]) : []
  return [update.title, update.summary, update.version, ...subjects, ...retirements]
    .filter(Boolean).join(' ').toLocaleLowerCase('zh-Hant').includes(query)
}

function renderUpdates() {
  const now = Date.now()
  const allUpdates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const resetPost = findResetPost(allUpdates, state.radar?.codexReset?.latestReset)
  const updateLoading = isUpdateSourceLoading()
  if (allUpdates.length === 0 && !hasKnownUpdateSnapshot() && (state.radar === null || updateLoading || isInitialDataSyncing())) {
    renderUpdateListSkeleton()
    return
  }
  setBusy(elements.updates, updateLoading)
  const matchesGroupFilters = group => group.updates.some(update => matchesFilters(update, group.updates, now))
  const matchingUpdates = group => group.updates.filter(update => matchesFilters(update, group.updates, now))
  const groups = groupUpdates(allUpdates).filter(matchesGroupFilters)
  const visibleCount = groups.reduce((total, group) => total + matchingUpdates(group).length, 0)
  elements.updates.replaceChildren(...groups.map((group) => {
    const first = group.updates[0]
    const unitKey = groupKey(first) ?? `update:${first.id}`
    let card
    if (group.kind === 'thread') card = renderThread(group, unitKey, resetPost?.id ?? null)
    else if (group.kind === 'changes') card = renderChangeGroup(group.updates, matchingUpdates(group), unitKey, now)
    else {
      const update = first
      if (isTiboUpdate(update)) card = renderTiboUpdate(update, update.id === resetPost?.id)
      else card = Array.isArray(update.retirements) && update.retirements.length ? renderRetirement(update, unitKey, now) : renderOfficialUpdate(update, unitKey, now)
    }
    card.dataset.unitKey = unitKey
    card.tabIndex = -1
    return card
  }))
  elements.empty.hidden = groups.length > 0
  elements.resultStatus.textContent = groups.length > 0
    ? `${groups.length} 組 · ${visibleCount} 則`
    : '沒有符合篩選的更新。'
  const heatMeta = elements.heatDisclosureHost.querySelector('.disclosure-meta')
  if (heatMeta) {
    const [, month, day] = state.day?.split('-').map(Number) ?? []
    const selectedDay = state.day ? `已選 ${month}/${day}` : ''
    heatMeta.textContent = [selectedDay, elements.resultStatus.textContent].filter(Boolean).join(' · ')
  }
  renderDayFilter(groups.length)
}

function dayLabel(key) {
  const [year, month, day] = key.split('-').map(Number)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month - 1, day).getDay()]
  return `${month}/${day}（${weekday}）`
}

function renderDayFilter(cardCount) {
  elements.dayFilter.hidden = !state.day
  // 日期列已說明筆數；保留一般結果說明只會重複，且日期篩選不含 Tibo。
  elements.resultStatus.hidden = Boolean(state.day)
  if (state.day) elements.dayFilterText.textContent = `只顯示 ${dayLabel(state.day)} 的官方更新 ${cardCount} 則`
}

function selectDay(key) {
  state.day = state.day === key ? null : key
  // 日期只篩官方更新；若停在 Tibo 篩選會永遠沒有結果，所以一併解除。
  if (state.day && elements.provider.value === 'x') elements.provider.value = ''
  renderFilterControls()
  const heatMeta = elements.heatDisclosureHost.querySelector('.disclosure-meta')
  if (heatMeta) {
    const [, month, day] = state.day?.split('-').map(Number) ?? []
    heatMeta.textContent = state.day ? `已選 ${month}/${day}` : ''
  }
  renderHeatmap()
  renderUpdates()
}

function appliedFilterCount() {
  return [elements.search.value.trim(), elements.provider.value, elements.category.value, elements.changeType.value, state.day, state.attentionOnly]
    .filter(Boolean).length
}

function renderFilterControls() {
  const count = appliedFilterCount()
  elements.filterToggleLabel.textContent = count ? `篩選 · ${count}` : '篩選'
  elements.filterCountStatus.textContent = count ? `已套用 ${count} 個篩選` : '未套用篩選'
  elements.clearFilters.disabled = count === 0
  elements.attentionOnly.checked = state.attentionOnly
  elements.activeFilterChips.replaceChildren()
  elements.activeFilterChips.hidden = !state.attentionOnly
  if (state.attentionOnly) {
    const chip = appendText(elements.activeFilterChips, 'button', 'attention-filter-chip', '只看需留意')
    chip.type = 'button'
    chip.setAttribute('aria-label', '移除只看需留意篩選')
    appendText(chip, 'span', 'attention-filter-chip-close', '×').setAttribute('aria-hidden', 'true')
    chip.addEventListener('click', () => {
      state.attentionOnly = false
      renderFilterControls()
      renderUpdates()
    })
  }
}

function clearUpdateFilters() {
  elements.search.value = ''
  elements.provider.value = ''
  elements.category.value = ''
  elements.changeType.value = ''
  state.day = null
  state.attentionOnly = false
}

function goToOverviewHighlight(unit) {
  const now = Date.now()
  const visible = unit.some(update => matchesFilters(update, unit, now))
  if (!visible) {
    clearUpdateFilters()
    setGlobalStatus('已清除篩選以顯示這則更新')
  }
  const first = unit.slice().sort(byPosition)[0]
  const unitKey = groupKey(first) ?? `update:${first.id}`
  activateTab('updates', {
    force: true,
    afterRestore() {
      const card = [...elements.updates.querySelectorAll('[data-unit-key]')].find(item => item.dataset.unitKey === unitKey)
      if (!card) return
      card.scrollIntoView?.({ block: 'start' })
      card.focus({ preventScroll: true })
    },
  })
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
  elements.heatmap.setAttribute('aria-label', '熱度圖同步中')
  setBusy(elements.heatmap, true)
  elements.heatLoader.hidden = true
}

function renderHeatmap() {
  const heatMeta = elements.heatDisclosureHost.querySelector('.disclosure-meta')
  if (heatMeta) {
    const [, month, day] = state.day?.split('-').map(Number) ?? []
    heatMeta.textContent = state.day ? `已選 ${month}/${day}` : ''
  }
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
  for (const unit of updateUnits(officialUpdates)) {
    const key = heatDateKey(unit[0])
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const today = new Date()
  today.setHours(12, 0, 0, 0)
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
        button.setAttribute('aria-label', `${description}，點擊只看這天`)
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

function renderSources(target = elements.sources, sourceList = currentSources()) {
  if (!target) return
  const sources = Array.isArray(sourceList) ? sourceList : []
  const codexFlat = target === elements.resetSources
  target.replaceChildren(...sources.map((source) => {
    const row = document.createElement('article')
    row.dataset.sourceId = source.id
    row.tabIndex = -1
    const status = ['idle', 'loading', 'ok', 'stale', 'error'].includes(source.status) ? source.status : 'idle'
    const pendingRetry = syncTracker.isPending(source.id)
    const displayStatus = pendingRetry && status !== 'loading' ? 'loading' : status
    row.className = `source-row source-${displayStatus}${codexFlat ? ' codex-source-row' : ''}`
    setBusy(row, status === 'loading' || pendingRetry)
    const copy = document.createElement('div')
    copy.className = 'source-copy'
    appendText(copy, 'strong', '', source.label ?? labels.source[source.id] ?? '公開來源')
    const lastRead = formatDateTime(source.fetchedAt)
    if (codexFlat) {
      const sourceUrl = safeSourceUrl('https://codex-resets.com/')
      if (sourceUrl) {
        const link = appendText(copy, 'a', 'codex-source-link', 'codex-resets.com')
        link.prepend(createIcon('link'))
        link.href = '#codex-resets-source'
        const note = appendText(copy, 'span', 'codex-source-note', '')
        bindExternalLink(link, sourceUrl, note)
      }
    }
    const detail = codexFlat
      ? lastRead ? `上次讀取 ${lastRead}` : '尚未讀取'
      : displayStatus === 'loading'
        ? (source.id === 'codex-resets' && source.fetchedAt ? `正在讀取 · 上次讀取 ${lastRead}` : '正在讀取公開來源…')
        : status === 'ok'
        ? `${source.itemCount} 筆 · ${lastRead}`
        : ['stale', 'error'].includes(status)
          ? `${source.itemCount} 筆 · 上次讀取 ${lastRead}${source.nextAttemptAt ? ` · 將於 ${formatDateTime(source.nextAttemptAt)} 重試` : ''}`
          : source.nextAttemptAt ? `${source.itemCount} 筆 · 將於 ${formatDateTime(source.nextAttemptAt)} 重試` : `${source.itemCount} 筆`
    appendText(copy, 'span', '', detail)
    row.append(copy)
    const actions = document.createElement('div')
    actions.className = 'source-actions'
    if (!pendingRetry || !['stale', 'error'].includes(status)) {
      const statusText = appendText(actions, 'span', `source-status-text status-${displayStatus}`, '')
      appendText(statusText, 'span', 'source-status-dot', '').setAttribute('aria-hidden', 'true')
      appendText(statusText, 'span', '', labels.status[displayStatus] ?? '未知')
    }
    if (['stale', 'error'].includes(status)) {
      const retry = appendText(actions, 'button', 'retry-button', pendingRetry ? '同步中' : '立即重試')
      retry.type = 'button'
      retry.disabled = pendingRetry
      retry.addEventListener('click', async () => {
        setGlobalStatus(`正在重新同步 ${source.label ?? labels.source[source.id] ?? '來源'}…`, 0)
        const delivered = await dispatchSyncRequest(
          syncTracker,
          message => api.ui.postMessage(message),
          source.id,
          { type: 'radar:retry-source', sourceId: source.id },
        )
        if (!delivered) {
          setGlobalStatus('插件沒有回應，請確認已啟用。')
        }
      })
    }
    row.append(actions)
    return row
  }))
}

function renderTimeMode() {
  const nextLabel = state.absoluteTime ? '相對時間' : '絕對時間'
  elements.timeModeLabel.textContent = state.absoluteTime ? '絕對時間' : '相對時間'
  elements.timeMode.setAttribute('aria-pressed', String(state.absoluteTime))
  elements.timeMode.setAttribute('aria-label', `切換為${nextLabel}`)
}

function renderOverviewAlerts(sources, attentionUnits) {
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const failedSources = sources.filter(source => ['error', 'stale'].includes(source.status))
  const hasCache = Boolean(state.radar?.codexReset || updates.length || state.radar?.baselineSourceIds?.length || sources.some(source => source.itemCount > 0))
  const allFailed = sources.length > 0 && failedSources.length === sources.length
  const alerts = []

  if (failedSources.length > 0) {
    const message = `${failedSources.length} 個來源讀取失敗${allFailed && hasCache ? '，顯示上次的資料' : ''}`
    const item = document.createElement('li')
    const button = appendText(item, 'button', 'overview-alert-action overview-alert-danger', '')
    button.type = 'button'
    button.append(createIcon('attention', 'overview-alert-icon'))
    appendText(button, 'span', 'overview-alert-copy', message)
    button.append(createIcon('arrow', 'overview-alert-arrow'))
    button.addEventListener('click', () => {
      const disclosureButton = elements.sourceStatus.querySelector('.disclosure-button')
      if (disclosureButton?.getAttribute('aria-expanded') !== 'true') disclosureButton?.click()
      window.requestAnimationFrame(() => {
        const sourceRow = [...(elements.sources?.children ?? [])].find(row => row.dataset.sourceId === failedSources[0].id)
        if (!sourceRow) return
        sourceRow.scrollIntoView?.({ block: 'nearest' })
        ;(sourceRow.querySelector('.retry-button') ?? sourceRow).focus({ preventScroll: true })
      })
    })
    alerts.push(item)
  }

  if (attentionUnits.length > 0) {
    const includesLifecycleChange = attentionUnits.some(unit => unit.some(isCriticalChange))
    const includesEffectiveDate = attentionUnits.some(unit => unit.some(update => Boolean(update.effectiveAt)))
    const hasCritical = attentionUnits.some(unit => unit.some(update => attentionSignal(update).tone === 'critical'))
    const reason = includesLifecycleChange ? '含移除或棄用' : includesEffectiveDate ? '含生效日期' : ''
    const message = `${attentionUnits.length} 則需留意更新${reason ? `（${reason}）` : ''}`
    const item = document.createElement('li')
    const button = appendText(item, 'button', `overview-alert-action ${hasCritical ? 'overview-alert-danger' : 'overview-alert-warning'}`, '')
    button.type = 'button'
    button.append(createIcon('attention', 'overview-alert-icon'))
    appendText(button, 'span', 'overview-alert-copy', message)
    button.append(createIcon('arrow', 'overview-alert-arrow'))
    button.addEventListener('click', () => {
      state.attentionOnly = true
      activateTab('updates', { force: true })
    })
    alerts.push(item)
  }

  elements.overviewAlerts.replaceChildren(...alerts)
  elements.overviewAlerts.hidden = alerts.length === 0
}

function renderOverviewCodexStatus() {
  if (codexResetCountdownTimer !== null) clearTimeout(codexResetCountdownTimer)
  codexResetCountdownTimer = null
  codexResetCountdownTick = null
  const reset = state.radar?.codexReset
  const source = currentSources().find(item => item.id === 'codex-resets')
  const scheduledAt = reset?.scheduledReset?.at
  const validSchedule = typeof scheduledAt === 'string' && Number.isFinite(Date.parse(scheduledAt))
  const futureSchedule = validSchedule && Date.parse(scheduledAt) > Date.now()
  let text

  if (!reset) {
    if (['error', 'stale'].includes(source?.status)) text = '無法讀取資料，請稍後再試。'
    else if (!state.radar || source?.status === 'loading' || isInitialDataSyncing()) {
      elements.codexOverviewStatus.replaceChildren()
      const skeleton = makeSkeletonBlock(elements.codexOverviewStatus, 'codex-overview-skeleton', '52%')
      skeleton.classList.add('loading-skeleton')
      elements.codexOverviewStatus.classList.add('is-loading')
      setBusy(elements.codexOverviewStatus, true)
      return
    } else text = '尚無資料，同步中…'
  } else if (futureSchedule) {
    const countdown = formatScheduledCountdown(scheduledAt)
    const shortCountdown = countdown.match(/^\d+ 天 \d+ 時/u)?.[0]
    text = `${shortCountdown ?? countdown} 後重設`
    codexResetCountdownTick = tickCodexCountdown
  } else if (validSchedule) {
    const countdown = formatScheduledCountdown(scheduledAt)
    text = countdown === '預定時間已到，等待狀態更新'
      ? countdown
      : countdown
  } else {
    const elapsedText = formatTimeSinceReset(reset.stats?.lastResetAt)
    const elapsed = elapsedText.replace(/^距上次重設\s*/u, '')
    const distance = elapsedText === '上次重設時間不明' ? elapsedText : `距上次 ${elapsed}`
    text = `${distance} · 共 ${reset.stats?.total ?? 0} 次`
  }

  elements.codexOverviewStatus.classList.remove('is-loading')
  elements.codexOverviewStatus.textContent = text
  elements.codexOverviewStatus.setAttribute('aria-label', `前往 Codex 重設頁；${text}`)
  setBusy(elements.codexOverviewStatus, !reset && (source?.status === 'loading' || isInitialDataSyncing()))
}

function renderOverviewHighlights(units, now, limit) {
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const sources = currentSources()
  const allFailed = sources.length > 0 && sources.every(source => ['error', 'stale'].includes(source.status))
  const hasCache = Boolean(state.radar?.codexReset || updates.length || state.radar?.baselineSourceIds?.length || sources.some(source => source.itemCount > 0))
  if (updates.length === 0 && !hasKnownOfficialSnapshot() && isInitialDataSyncing()) {
    const rows = Array.from({ length: 3 }, () => {
      const item = document.createElement('li')
      item.className = 'overview-highlight-skeleton loading-skeleton'
      makeSkeletonBlock(item, 'overview-highlight-skeleton-source', '22%')
      makeSkeletonBlock(item, 'overview-highlight-skeleton-title', '46%')
      makeSkeletonBlock(item, 'overview-highlight-skeleton-time', '15%')
      return item
    })
    elements.overviewHighlightsList.replaceChildren(...rows)
    elements.overviewHighlightsList.setAttribute('aria-busy', 'true')
    elements.overviewAllUpdates.hidden = true
    return
  }

  const highlights = overviewHighlights(units, now, limit)
  const items = highlights.map((unit) => {
    const first = unit.slice().sort(byPosition)[0]
    const version = unit.find(update => typeof update.version === 'string' && update.version.length > 0)?.version
    const title = version
      ? (version.toLowerCase().startsWith('v') ? version : `v${version}`)
      : first.title || first.summary || '未命名更新'
    const timeUpdate = unit.reduce((latest, update) => updateTimestamp(update) > updateTimestamp(latest) ? update : latest, unit[0])
    const attention = unitNeedsAttention(unit, now)
    const item = document.createElement('li')
    const button = appendText(item, 'button', 'overview-highlight-row', '')
    button.type = 'button'
    appendText(button, 'span', 'overview-highlight-source', sourceLabel(first))
    const right = document.createElement('span')
    right.className = 'overview-highlight-right'
    const time = appendText(right, 'time', 'overview-highlight-time', formatUpdateTime(timeUpdate))
    time.dateTime = timeUpdate.publishedAtTime ?? timeUpdate.publishedAt ?? ''
    if (attention) {
      const marker = document.createElement('span')
      marker.className = 'overview-highlight-attention'
      appendText(marker, 'span', 'overview-highlight-dot', '').setAttribute('aria-hidden', 'true')
      appendText(marker, 'span', '', '需留意')
      right.append(marker)
    }
    button.append(right)
    appendText(button, 'span', `overview-highlight-title${version ? ' overview-highlight-version' : ''}`, title)
    button.addEventListener('click', () => goToOverviewHighlight(unit))
    return item
  })

  if (items.length === 0) {
    const item = document.createElement('li')
    if (allFailed && !hasCache) {
      appendText(item, 'p', 'overview-highlights-empty', '目前無法讀取更新，請稍後重新整理。')
      const retry = appendText(item, 'button', 'overview-retry', '重新整理')
      retry.type = 'button'
      retry.addEventListener('click', () => elements.refresh.click())
    } else {
      appendText(item, 'p', 'overview-highlights-empty', '目前沒有官方更新')
    }
    items.push(item)
  }
  elements.overviewHighlightsList.replaceChildren(...items)
  elements.overviewHighlightsList.setAttribute('aria-busy', 'false')
  elements.overviewAllUpdates.hidden = false
}

function renderOverview() {
  const now = Date.now()
  const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
  const sources = currentSources()
  const units = updateUnits(updates)
  const attentionUnits = units.filter(unit => unitNeedsAttention(unit, now))
  const attention = attentionUnits.length
  const healthy = sources.filter(source => source.status === 'ok').length
  const updateLoading = sources.some(source => source.status === 'loading' && source.id !== 'codex-resets')
  elements.count.textContent = String(units.length)
  elements.attentionCount.textContent = String(attention)
  elements.healthyCount.textContent = `${healthy}/${sources.length || 7}`
  renderSummaryLoading(updates.length === 0 && !hasKnownUpdateSnapshot() && (updateLoading || isInitialDataSyncing()))
  renderOverviewAlerts(sources, attentionUnits)

  const latestSourceCheck = sources.reduce((latest, source) => {
    const timestamp = Date.parse(source.fetchedAt ?? '')
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest
  }, 0)
  const checkedAt = Date.parse(state.radar?.lastCheckedAt ?? '') || latestSourceCheck
  const checkedText = Number.isFinite(checkedAt)
    ? new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(checkedAt)
    : '尚未檢查'
  const failedCount = sources.filter(source => ['error', 'stale'].includes(source.status)).length
  const sourceMeta = failedCount
    ? `${failedCount} 個失敗 · 上次檢查 ${checkedText}`
    : `${healthy}/${sources.length || 7} 正常 · 上次檢查 ${checkedText}`
  const disclosure = createDisclosure({
    id: 'source-status-disclosure',
    title: '來源狀態',
    meta: sourceMeta,
    open: state.disclosures.get('source-status-disclosure') === true,
    tone: failedCount ? 'danger' : 'neutral',
  })
  if (failedCount) {
    const meta = disclosure.root.querySelector('.disclosure-meta')
    if (meta) {
      const dot = document.createElement('span')
      dot.className = 'disclosure-meta-dot'
      dot.setAttribute('aria-hidden', 'true')
      meta.prepend(dot)
    }
  }
  const sourceMessage = appendText(disclosure.region, 'p', 'source-status-message', '失敗的來源會自動重試，已有資料會保留。')
  sourceMessage.setAttribute('aria-live', 'off')
  elements.sources = appendText(disclosure.region, 'div', 'source-grid', '')
  elements.sourceStatus.replaceChildren(disclosure.root)
  renderSources()

  renderOverviewCodexStatus()
  renderOverviewHighlights(units, now, window.innerWidth >= 900 ? 5 : 3)

  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const todayKey = localDateKey(today)
  const todayTibo = updates.filter(update => isTiboUpdate(update) && heatDateKey(update) === todayKey)
  const resetPost = findResetPost(updates, state.radar?.codexReset?.latestReset)
  const resetPostIsToday = Boolean(resetPost && todayTibo.some(update => update.id === resetPost.id))
  const originalPosts = todayTibo.filter(update => update.postKind === 'root').length
  const selfReplies = todayTibo.filter(update => update.postKind === 'self-reply').length
  const summary = todayTibo.length
    ? `今天 Tibo 貼文 ${todayTibo.length} 則（貼文 ${originalPosts}、續文 ${selfReplies}）`
    : '今天 Tibo 尚無新貼文'
  elements.tiboSummaryText.textContent = `${summary}${resetPostIsToday ? ' · Codex 重設' : ''}`
  elements.tiboSummary.classList.toggle('is-reset-post', resetPostIsToday)
}

function renderUpdatesTab() {
  renderFilterControls()
  renderTimeMode()
  const heatDisclosureId = 'updates-heat-disclosure'
  const [, month, day] = state.day?.split('-').map(Number) ?? []
  const heatDisclosure = createDisclosure({
    id: heatDisclosureId,
    title: '每日更新熱度 · 近 26 週',
    meta: state.day ? `已選 ${month}/${day}` : '',
    open: state.disclosures.get(heatDisclosureId) === true,
    rootClass: 'disclosure-root heat-disclosure-root',
    buttonClass: 'disclosure-button heat-disclosure-button',
    regionClass: 'disclosure-region heat-disclosure-region',
  })
  heatDisclosure.region.append(elements.heatContent)
  elements.heatDisclosureHost.replaceChildren(heatDisclosure.root)
  renderHeatmap()
  renderUpdates()
}

function renderResetTab() {
  renderSpotlight()
}

function nextTabIndex(key, current, count) {
  if (!Number.isInteger(current) || !Number.isInteger(count) || count < 1) return null
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

function createTabController({ state, renderers, now = () => 0, schedule = () => {}, restoreScroll = () => {}, beforeActivate = () => {}, onState = () => {}, onVisible = () => {} } = {}) {
  function renderActive(force = false) {
    if (state.detail) return false
    const renderer = renderers[state.activeTab]
    if (typeof renderer !== 'function') return false
    if (!force && state.tabRenderedVersion[state.activeTab] === state.dataVersion) return false
    renderer()
    state.tabRenderedVersion[state.activeTab] = state.dataVersion
    return true
  }

  function receiveState(radar) {
    state.radar = radar
    state.dataVersion += 1
    onState(radar)
    const rendered = renderActive()
    onVisible(state.activeTab, rendered)
    return rendered
  }

  function activateTab(id, { force = false, afterRestore } = {}) {
    if (typeof renderers[id] !== 'function' || state.detail || id === state.activeTab) return false
    state.tabScrollY[state.activeTab] = now()
    const previous = state.activeTab
    state.activeTab = id
    beforeActivate(id, previous)
    const rendered = renderActive(force)
    onVisible(id, rendered)
    schedule(() => {
      restoreScroll(state.tabScrollY[id] ?? 0)
      afterRestore?.()
    })
    return true
  }

  function renderIfStale() {
    const rendered = renderActive()
    onVisible(state.activeTab, rendered)
    return rendered
  }

  function renderCurrent() {
    const rendered = renderActive(true)
    onVisible(state.activeTab, rendered)
    return rendered
  }

  return { receiveState, activateTab, renderIfStale, renderCurrent }
}

const TAB_RENDERERS = {
  overview: renderOverview,
  updates: renderUpdatesTab,
  reset: renderResetTab,
}

const tabController = createTabController({
  state,
  renderers: TAB_RENDERERS,
  now: () => window.scrollY,
  schedule: callback => window.requestAnimationFrame(callback),
  restoreScroll(scrollY) {
    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    window.scrollTo(0, Math.min(scrollY, maxScrollY))
  },
  beforeActivate(id) {
    for (const [tabId, tab] of Object.entries(elements.tabs)) {
      const selected = tabId === id
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    }
    for (const [panelId, panel] of Object.entries(elements.panels)) panel.hidden = panelId !== id
    elements.tabList.hidden = false
  },
  onState(radar) {
    const updates = Array.isArray(radar?.updates) ? radar.updates : []
    const sources = Array.isArray(radar?.sources) ? radar.sources : []
    const units = updateUnits(updates)
    const loading = sources.some(source => source.status === 'loading')
    const resetAt = radar?.codexReset?.scheduledReset?.at
    const hasFutureSchedule = typeof resetAt === 'string' && Number.isFinite(Date.parse(resetAt)) && Date.parse(resetAt) > Date.now()
    syncTracker.observe(sources)
    const pendingSync = syncTracker.isPending('all') || sources.some(source => syncTracker.isPending(source.id))
    elements.updatesCount.textContent = String(units.length)
    elements.tabs.updates.setAttribute('aria-label', `更新動態，${units.length} 張卡片`)
    elements.resetTabDot.hidden = !hasFutureSchedule
    elements.tabs.reset.setAttribute('aria-label', hasFutureSchedule ? 'Codex 重設，已排定重設' : 'Codex 重設')
    renderRefreshControl()
    setGlobalStatus(loading
      ? '正在檢查公開來源…'
      : pendingSync ? (syncTracker.isPending('all') ? '正在重新整理所有來源…' : '正在重新整理來源…')
      : '', 0)
    // 詳情頁是更新動態的子畫面；同步時就地更新，版本消失時返回清單。
    renderChangeDetail()
  },
  onVisible() {
    syncTabLifecycles()
    updateStickyMeasurements()
  },
})

function receiveState(radar) {
  const updates = Array.isArray(radar?.updates) ? radar.updates : []
  const currentUnitKeys = new Set(groupUpdates(updates).map(group => {
    const first = group.updates[0]
    return groupKey(first) ?? `update:${first.id}`
  }))
  for (const unitKey of state.expanded) {
    if (!currentUnitKeys.has(unitKey)) state.expanded.delete(unitKey)
  }
  return tabController.receiveState(radar)
}

function activateTab(id, options) {
  return tabController.activateTab(id, options)
}

const TAB_IDS = Object.keys(TAB_RENDERERS)
for (const id of TAB_IDS) {
  elements.tabs[id].addEventListener('click', () => activateTab(id))
}

elements.tabList.addEventListener('keydown', (event) => {
  const current = TAB_IDS.indexOf(state.activeTab)
  const next = nextTabIndex(event.key, current, TAB_IDS.length)
  if (next === null) return
  event.preventDefault()
  const id = TAB_IDS[next]
  elements.tabs[id].focus()
  activateTab(id)
})

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
  clearUpdateFilters()
  renderFilterControls()
  renderHeatmap()
  renderUpdates()
})

elements.attentionOnly.addEventListener('change', () => {
  state.attentionOnly = elements.attentionOnly.checked
  renderFilterControls()
  renderUpdates()
})

elements.overviewCountButton.addEventListener('click', () => {
  clearUpdateFilters()
  activateTab('updates', { force: true })
})

elements.overviewAttentionButton.addEventListener('click', () => {
  state.attentionOnly = true
  activateTab('updates', { force: true })
})

elements.overviewSourcesButton.addEventListener('click', () => {
  const disclosureButton = elements.sourceStatus.querySelector('.disclosure-button')
  if (disclosureButton?.getAttribute('aria-expanded') !== 'true') disclosureButton?.click()
  elements.sourceStatus.scrollIntoView?.({ block: 'nearest' })
})

elements.codexOverviewStatus.addEventListener('click', () => activateTab('reset'))
elements.overviewAllUpdates.addEventListener('click', () => activateTab('updates', { force: true }))

elements.heatmap.addEventListener('click', (event) => {
  const button = event.target.closest?.('.heat-cell-button')
  if (button?.dataset.day) selectDay(button.dataset.day)
})

elements.dayFilterClear.addEventListener('click', () => {
  if (state.day) selectDay(state.day)
})

elements.tiboSummary.addEventListener('click', () => {
  state.attentionOnly = false
  elements.provider.value = 'x'
  state.day = null
  activateTab('updates', {
    force: true,
    afterRestore() {
      elements.updates.scrollIntoView?.({ block: 'start' })
    },
  })
})

elements.detailBack.addEventListener('click', closeChangeDetail)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.detail) {
    event.preventDefault()
    event.stopPropagation()
    closeChangeDetail()
    return
  }
  if (event.key !== 'Escape' || elements.filterPanel.hidden) return
  event.preventDefault()
  event.stopPropagation()
  setFilterPanelOpen(false)
  elements.filterToggle.focus()
})

for (const loader of [elements.refreshLoader, ...document.querySelectorAll('.spotlight-loader'), elements.heatLoader]) populatePixelLoader(loader)
tabController.renderCurrent()

window.addEventListener('resize', () => {
  updateStickyMeasurements()
  if (state.activeTab === 'overview' && !state.detail) {
    const updates = Array.isArray(state.radar?.updates) ? state.radar.updates : []
    renderOverviewHighlights(updateUnits(updates), Date.now(), window.innerWidth >= 900 ? 5 : 3)
  }
})

document.fonts?.ready?.then(updateStickyMeasurements)
document.fonts?.addEventListener?.('loadingdone', updateStickyMeasurements)

elements.timeMode.addEventListener('click', () => {
  state.absoluteTime = !state.absoluteTime
  tabController.renderCurrent()
})

elements.refresh.addEventListener('click', async () => {
  if (syncTracker.isPending('all')) return
  setGlobalStatus('正在重新整理所有來源…', 0)
  const delivered = await dispatchSyncRequest(syncTracker, message => api.ui.postMessage(message), 'all', { type: 'radar:refresh' })
  if (!delivered) {
    setGlobalStatus('插件沒有回應，請確認已啟用。')
  }
})

api.ui.onMessage((message) => {
  if (message?.type === 'radar:state') receiveState(message.state)
})

try {
  const stored = await api.storage.get('radar-state')
  if (stored.found) receiveState(stored.value)
} catch {
  setGlobalStatus('讀不到已保存的資料，正在重新取得…')
}

try {
  const result = await api.ui.postMessage({ type: 'radar:get-state' })
  if (!result.delivered) setGlobalStatus('插件沒有回應，請確認已啟用。')
} catch {
  setGlobalStatus('插件沒有回應，請確認已啟用。')
}
