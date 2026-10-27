import { groupUpdatesForDisplay } from './thread-groups.js'
import { deriveUpdateInsight } from './update-insights.js'

const labels = Object.freeze({
  category: {
    'new-model': '新模型',
    feature: '新功能',
    'developer-tool': '開發工具',
    'api-change': 'API 變更',
  },
  changeType: {
    added: '新增',
    improved: '改善',
    fixed: '修正',
    deprecated: '棄用',
    removed: '移除',
  },
  sourceStatus: {
    ok: '正常',
    stale: '沿用快取',
    error: '讀取失敗',
    disabled: '未設定',
  },
})

const providerLabels = Object.freeze({
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  x: 'Tibo / X',
})

const allowedLinkRules = Object.freeze([
  ['developers.openai.com', '/api/docs/'],
  ['platform.claude.com', '/docs/en/'],
  ['github.com', '/anthropics/claude-code/releases'],
])

const FEED_POLL_INTERVAL_MS = 60 * 1000
const TIBO_SOURCE_ID = 'tibo-x'
const TIBO_SEEN_STORAGE_KEY = 'agent-pets-radar:tibo-seen-v1'
const MAX_SEEN_TIBO_POSTS = 100
const state = { feed: null, loading: false }
const elements = {
  search: document.querySelector('#search'),
  provider: document.querySelector('#provider'),
  category: document.querySelector('#category'),
  changeType: document.querySelector('#change-type'),
  notifications: document.querySelector('#notifications'),
  reload: document.querySelector('#reload'),
  status: document.querySelector('#status'),
  updates: document.querySelector('#updates'),
  sourceHealth: document.querySelector('#source-health'),
  updateCount: document.querySelector('#update-count'),
}

function notificationPermission() {
  return 'Notification' in globalThis ? Notification.permission : 'unsupported'
}

function updateNotificationButton() {
  const permission = notificationPermission()
  if (permission === 'granted') {
    elements.notifications.textContent = 'Tibo 通知已開啟'
    elements.notifications.disabled = true
  } else if (permission === 'denied') {
    elements.notifications.textContent = '通知已封鎖'
    elements.notifications.disabled = true
  } else if (permission === 'unsupported') {
    elements.notifications.textContent = '瀏覽器不支援通知'
    elements.notifications.disabled = true
  } else {
    elements.notifications.textContent = '開啟 Tibo 通知'
    elements.notifications.disabled = false
  }
}

function readSeenTiboPostIds() {
  try {
    const raw = localStorage.getItem(TIBO_SEEN_STORAGE_KEY)
    if (raw === null) return null
    const ids = JSON.parse(raw)
    return Array.isArray(ids) ? ids.filter(id => /^x-\d{1,19}$/.test(id)).slice(0, MAX_SEEN_TIBO_POSTS) : []
  } catch {
    return []
  }
}

function writeSeenTiboPostIds(ids) {
  try {
    localStorage.setItem(TIBO_SEEN_STORAGE_KEY, JSON.stringify([...new Set(ids)].slice(0, MAX_SEEN_TIBO_POSTS)))
  } catch {
    // Notifications still work for the current page even when storage is unavailable.
  }
}

function showTiboNotification(update) {
  const notification = new Notification('Tibo 今天有新貼文', {
    body: String(update.summary ?? update.title ?? '').slice(0, 180),
    tag: update.id,
  })
  const sourceUrl = safeSourceUrl(update.sourceUrl)
  if (sourceUrl) {
    notification.addEventListener('click', () => {
      window.focus()
      window.open(sourceUrl, '_blank', 'noopener,noreferrer')
      notification.close()
    })
  }
}

function notifyTiboUpdates(updates) {
  if (updates.length > 3) {
    new Notification(`Tibo 今天有 ${updates.length} 則貼文`, {
      body: '開啟 AI Update Radar 查看今天的內容。',
      tag: 'tibo-new-posts',
    })
  } else {
    for (const update of updates) showTiboNotification(update)
  }
}

function processTiboNotifications(feed) {
  const source = feed.sources.find(item => item?.id === TIBO_SOURCE_ID)
  if (source?.status !== 'ok') return
  const updates = feed.updates.filter(update => update?.sourceId === TIBO_SOURCE_ID && /^x-\d{1,19}$/.test(update.id))
  const currentIds = updates.map(update => update.id)
  const seenIds = readSeenTiboPostIds()
  if (seenIds === null) {
    if (notificationPermission() === 'granted') {
      notifyTiboUpdates(updates)
      writeSeenTiboPostIds(currentIds)
    }
    return
  }

  const seen = new Set(seenIds)
  const unseen = updates.filter(update => !seen.has(update.id))
  if (notificationPermission() === 'granted') {
    notifyTiboUpdates(unseen)
    writeSeenTiboPostIds([...currentIds, ...seenIds])
  }
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (url.hostname === 'x.com') {
      return /^\/thsottiaux\/status\/\d{1,19}$/.test(url.pathname) ? url.toString() : null
    }
    return allowedLinkRules.some(([host, prefix]) => url.hostname === host && url.pathname.startsWith(prefix))
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function formatDate(value) {
  if (!value) return '日期未提供'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    : value
}

function formatPostDateTime(update) {
  const date = new Date(update.publishedAtTime ?? '')
  if (!Number.isFinite(date.getTime())) return formatDate(update.publishedAt)
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName)
  if (className) element.className = className
  element.textContent = text
  parent.append(element)
  return element
}

function appendSourceLink(parent, update) {
  const sourceUrl = safeSourceUrl(update.sourceUrl)
  if (!sourceUrl) return
  const link = document.createElement('a')
  link.href = sourceUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = update.provider === 'x' ? '查看 X 原文' : '查看官方來源'
  parent.append(link)
}

function appendUpdateFooter(parent, update) {
  const footer = document.createElement('div')
  footer.className = 'update-footer'
  const detail = [update.version, update.effectiveAt ? `生效：${formatDate(update.effectiveAt)}` : '']
    .filter(Boolean)
    .join(' · ')
  appendText(footer, 'span', 'version-label', detail || (update.provider === 'x' ? '@thsottiaux' : update.sourceId))
  appendSourceLink(footer, update)
  parent.append(footer)
}

function appendInsight(parent, label, value, className = '') {
  const item = document.createElement('div')
  item.className = `insight-item ${className}`.trim()
  appendText(item, 'span', 'insight-label', label)
  appendText(item, 'strong', 'insight-value', value)
  parent.append(item)
}

function appendQuickRead(parent, update) {
  const insight = deriveUpdateInsight(update)
  const quickRead = document.createElement('section')
  quickRead.className = 'quick-read'
  quickRead.setAttribute('aria-label', '快速判讀')
  appendInsight(quickRead, '變更', insight.change)
  appendInsight(quickRead, '影響範圍', insight.scope)
  appendInsight(quickRead, '注意事項', insight.attention.label, `attention-${insight.attention.tone}`)
  parent.append(quickRead)
}

function appendOfficialDetails(parent, update) {
  if (!update.summary || update.summary === update.title) return
  const details = document.createElement('details')
  details.className = 'update-details'
  appendText(details, 'summary', '', '展開完整更新內容')
  appendText(details, 'p', 'summary-copy', update.summary)
  parent.append(details)
}

function renderSingleUpdate(update) {
  const article = document.createElement('article')
  article.className = `update-card provider-${update.provider}`

  const meta = document.createElement('div')
  meta.className = 'update-meta'
  appendText(meta, 'span', 'provider-label', providerLabels[update.provider] ?? update.provider)
  if (update.provider === 'x' && update.postKind) {
    appendText(meta, 'span', `post-kind post-kind-${update.postKind}`, update.postKind === 'self-reply' ? '串內回覆' : '原始貼文')
  }
  appendText(meta, 'span', `change-label change-${update.changeType}`, labels.changeType[update.changeType] ?? update.changeType)
  appendText(meta, 'span', 'category-label', labels.category[update.category] ?? update.category)
  appendText(meta, 'time', 'date-label', formatDate(update.publishedAt))
  article.append(meta)

  appendQuickRead(article, update)
  appendText(article, 'h2', '', update.title)
  appendOfficialDetails(article, update)
  appendUpdateFooter(article, update)
  return article
}

function renderThread(group) {
  const article = document.createElement('article')
  article.className = 'update-thread provider-x'
  article.setAttribute('aria-label', `Tibo 對話串，共 ${group.updates.length} 則`)

  const header = document.createElement('header')
  header.className = 'thread-header'
  const heading = document.createElement('div')
  heading.className = 'thread-heading'
  appendText(heading, 'span', 'provider-label', 'Tibo / X')
  appendText(heading, 'strong', '', '同一串對話')
  header.append(heading)
  appendText(header, 'span', 'thread-count', `${group.updates.length} 則內容`)
  article.append(header)

  const timeline = document.createElement('ol')
  timeline.className = 'thread-timeline'
  for (const update of group.updates) {
    const isReply = update.postKind === 'self-reply'
    const item = document.createElement('li')
    item.className = `thread-item ${isReply ? 'thread-reply' : 'thread-root'}`

    const marker = document.createElement('span')
    marker.className = 'thread-marker'
    marker.setAttribute('aria-hidden', 'true')
    item.append(marker)

    const content = document.createElement('div')
    content.className = 'thread-content'
    const meta = document.createElement('div')
    meta.className = 'thread-meta'
    appendText(meta, 'span', `post-kind post-kind-${update.postKind}`, isReply ? '串內回覆' : '原始貼文')
    const time = appendText(meta, 'time', 'date-label', formatPostDateTime(update))
    time.dateTime = update.publishedAtTime ?? update.publishedAt
    content.append(meta)
    appendText(content, 'h2', '', update.title)
    if (update.summary && update.summary !== update.title) appendText(content, 'p', 'summary-copy', update.summary)
    appendUpdateFooter(content, update)
    item.append(content)
    timeline.append(item)
  }
  article.append(timeline)
  return article
}

function filteredUpdates() {
  const query = elements.search.value.trim().toLocaleLowerCase('zh-Hant')
  return (state.feed?.updates ?? []).filter((update) => {
    if (elements.provider.value && update.provider !== elements.provider.value) return false
    if (elements.category.value && update.category !== elements.category.value) return false
    if (elements.changeType.value && update.changeType !== elements.changeType.value) return false
    if (!query) return true
    const haystack = [update.title, update.summary, update.version, ...(update.subjects ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-Hant')
    return haystack.includes(query)
  })
}

function renderUpdates() {
  const updates = filteredUpdates()
  elements.updates.replaceChildren()
  elements.updateCount.textContent = String(updates.length)
  elements.status.textContent = updates.length > 0
    ? `顯示 ${updates.length} 筆；資料產生於 ${new Date(state.feed.generatedAt).toLocaleString('zh-TW')}`
    : '目前的篩選條件沒有結果。'

  for (const group of groupUpdatesForDisplay(updates)) {
    elements.updates.append(group.kind === 'thread' ? renderThread(group) : renderSingleUpdate(group.updates[0]))
  }
}

function renderSourceHealth() {
  elements.sourceHealth.replaceChildren()
  appendText(elements.sourceHealth, 'h2', '', '來源狀態')
  const list = document.createElement('div')
  list.className = 'source-grid'
  for (const source of state.feed?.sources ?? []) {
    const row = document.createElement('div')
    row.className = `source-row source-${source.status}`
    appendText(row, 'strong', '', source.id)
    appendText(row, 'span', '', `${labels.sourceStatus[source.status] ?? source.status} · ${source.itemCount} 筆`)
    list.append(row)
  }
  elements.sourceHealth.append(list)
}

async function loadFeed(options = {}) {
  if (state.loading) return
  const silent = options.silent === true
  state.loading = true
  elements.reload.disabled = true
  if (!silent || !state.feed) elements.status.textContent = '正在讀取官方更新…'
  try {
    const response = await fetch(`/feed.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('feed_unavailable')
    const feed = await response.json()
    if (feed?.schemaVersion !== 1 || !Array.isArray(feed.updates) || !Array.isArray(feed.sources)) {
      throw new Error('feed_invalid')
    }
    state.feed = feed
    processTiboNotifications(feed)
    renderUpdates()
    renderSourceHealth()
  } catch {
    if (state.feed) {
      elements.status.textContent = `暫時無法讀取最新資料；目前顯示 ${new Date(state.feed.generatedAt).toLocaleString('zh-TW')} 的結果。`
    } else {
      elements.updates.replaceChildren()
      elements.sourceHealth.replaceChildren()
      elements.updateCount.textContent = '0'
      elements.status.textContent = '尚未產生資料。請執行 pnpm start 或 pnpm collect。'
    }
  } finally {
    state.loading = false
    elements.reload.disabled = false
  }
}

for (const element of [elements.search, elements.provider, elements.category, elements.changeType]) {
  element.addEventListener(element === elements.search ? 'input' : 'change', renderUpdates)
}
elements.reload.addEventListener('click', loadFeed)
elements.notifications.addEventListener('click', async () => {
  if (notificationPermission() !== 'default') return updateNotificationButton()
  const permission = await Notification.requestPermission()
  updateNotificationButton()
  if (permission === 'granted' && state.feed) processTiboNotifications(state.feed)
})
updateNotificationButton()
loadFeed()
setInterval(() => loadFeed({ silent: true }), FEED_POLL_INTERVAL_MS)
