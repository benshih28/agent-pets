import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'
import { PluginUiMessageGuard } from '../electron/plugin-ui-messages.ts'
import {
  SOURCE_DEFINITIONS,
  extractRetirements,
  parseDatedMarkdown,
  parseGithubReleases,
  parseTiboPublicProfile,
  parseTiboSelfReplies,
  withVersionComparisons,
} from '../update-radar/plugin/dist/core.js'
import plugin, {
  compareVersions,
  createUpdateRadarRuntime,
  fitStateToMessageBudget,
  notificationEntries,
  parseCodexResetsStatus,
  parseOpenAiChangelog,
} from '../update-radar/plugin/dist/main.js'

const pluginRoot = path.resolve('update-radar/plugin')
const FIXED_NOW = Date.parse('2026-10-28T08:00:00Z')

function panelFunctionSource(name: string) {
  const source = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  let start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `missing panel function ${name}`)
  if (source.slice(start - 6, start) === 'async ') start -= 6
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1, `unterminated panel function ${name}`)
  return source.slice(start, end + 2)
}

function codexResetPayload(options: {
  id?: string, resetType?: string, announcedAt?: string, lastResetAt?: string, text?: string,
  scheduledReset?: unknown, total?: number, sourceUrl?: string, sourceType?: string,
} = {}) {
  const id = options.id ?? '2115330127886463244'
  const announcedAt = options.announcedAt ?? '2026-10-28T06:29:38.000Z'
  const numericId = id.match(/\d+$/)?.[0] ?? '2115330127886463244'
  const sourceUrl = options.sourceUrl ?? (id.startsWith('observed-') ? undefined : `https://x.com/thsottiaux/status/${numericId}`)
  return {
    data: {
      latest_reset: {
        id,
        reset_type: options.resetType ?? 'regular',
        announced_at: announcedAt,
        text: options.text ?? 'And it\'s done.',
        source: { type: options.sourceType ?? (id.startsWith('observed-') ? 'observed' : 'x_post'), author: 'thsottiaux', ...(sourceUrl ? { url: sourceUrl } : {}) },
      },
      scheduled_reset: options.scheduledReset ?? null,
      active_watch: null,
      stats: { total: options.total ?? 69, last_reset_at: options.lastResetAt ?? announcedAt, days_since_last: 0, avg_interval_days: 6 },
    },
    meta: { api_version: 'v1', generated_at: '2026-10-28T08:00:00.000Z' },
  }
}

const baselineMarkdown = `
## October, 2026

### Oct 20

Feature · API: v1/responses

You can now choose 12-hour prompt caching in the API.
`

const updatedMarkdown = `
## October, 2026

### Oct 27

Fix · Model: gpt-example

Fixed image input handling for \`gpt-example\`.

### Oct 20

Feature · API: v1/responses

You can now choose 12-hour prompt caching in the API.
`

const bulkUpdatedMarkdown = `
## October, 2026

### Oct 28
Added the first new API feature.

### Oct 27
Improved the second API feature.

### Oct 26
Fixed the third API feature.

### Oct 25
Deprecated the fourth API feature.

### Oct 20
Feature · API: v1/responses

You can now choose 12-hour prompt caching in the API.
`

const anthropicMarkdown = `
## October 27, 2026

- Improved prompt caching for the Messages API.
- Added a new Claude model snapshot.
`

const githubReleases = JSON.stringify([
  {
    tag_name: 'v2.1.0',
    published_at: '2026-10-27T04:00:00Z',
    html_url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.0',
    body: '- Added session restore.\n- Fixed terminal rendering.',
  },
  {
    tag_name: 'v2.0.0',
    published_at: '2026-10-20T04:00:00Z',
    html_url: 'https://github.com/anthropics/claude-code/releases/tag/v2.0.0',
    body: '- Added plugin support.',
  },
])

function profilePost(id: string, timestamp: string, text: string) {
  return `<div data-href="/thsottiaux/status/${id}"><span>@thsottiaux</span><script>"timestamp":${Date.parse(timestamp)}</script><div class="text-body whitespace-pre-wrap wrap-break-word">${text}</div></div>`
}

function profileHtml(posts: string[]) {
  return `<html><main aria-label="@thsottiaux">${posts.join('')}</main></html>`
}

function conversationTweet({ id, timestamp, text, replyToId }: { id: string, timestamp: string, text: string, replyToId: string }) {
  return {
    rest_id: id,
    result: {
      rest_id: id,
      core: { user_results: { result: { core: { screen_name: 'thsottiaux' } } } },
      details: { created_at_ms: Date.parse(timestamp), full_text: text },
      reply_to_results: { rest_id: replyToId },
      reply_to_user_results: { result: { core: { screen_name: 'thsottiaux' } } },
    },
  }
}

function conversationHtml(rootId: string, tweets: unknown[]) {
  const payload = {
    data: { threaded_conversation_with_injections_v2: { instructions: [{
      entries: tweets.map(tweetResults => ({ content: { content: { tweet_results: tweetResults } } })),
    }] } },
  }
  return `<html>${rootId}<script>value:${JSON.stringify(JSON.stringify(payload))}</script></html>`
}

function createApiFixture() {
  const storage = new Map<string, unknown>()
  const notifications: Array<Record<string, unknown>> = []
  const panelMessages: Array<Record<string, unknown>> = []
  const logs: Array<unknown[]> = []
  const failures = new Set<string>()
  const uiGuard = new PluginUiMessageGuard()
  const uiMessageRejections: Array<{ type: unknown, error: string }> = []
  let openAiBody = baselineMarkdown
  let githubBody = githubReleases
  let codexStatus: unknown = codexResetPayload()
  let nowMs = FIXED_NOW
  let panelHandler: ((message: any) => Promise<void>) | null = null
  let scheduled: { seconds: number, callback: () => void } | null = null
  let fetchGate: Promise<void> | null = null

  const api = {
    storage: {
      async get(key: string) {
        return storage.has(key) ? { found: true, value: storage.get(key) } : { found: false, value: undefined }
      },
      async set(key: string, value: unknown) {
        storage.set(key, structuredClone(value))
        return { stored: true as const }
      },
    },
    net: {
      async fetch(url: string) {
        const gate = fetchGate
        if (gate) await gate
        if (failures.has(url)) return { status: 503, headers: {}, body: 'unavailable' }
        if (url.endsWith('/changelog.md')) return { status: 200, headers: {}, body: openAiBody }
        if (url.endsWith('/deprecations.md')) return { status: 200, headers: {}, body: baselineMarkdown }
        if (url.includes('release-notes/overview.md')) return { status: 200, headers: {}, body: anthropicMarkdown }
        if (url.includes('model-deprecations.md')) return { status: 200, headers: {}, body: anthropicMarkdown }
        if (url.startsWith('https://api.github.com/')) return { status: 200, headers: {}, body: githubBody }
        if (url === 'https://codex-resets.com/api/v1/status') return { status: 200, headers: {}, body: JSON.stringify(codexStatus) }
        if (url === 'https://x.com/thsottiaux') {
          return { status: 200, headers: {}, body: profileHtml([profilePost('2113000000000000000', '2026-10-27T08:00:00Z', 'Yesterday.')]) }
        }
        throw new Error(`unexpected_url:${url}`)
      },
    },
    feed: {
      async notify(item: Record<string, unknown>) {
        notifications.push(item)
        return { itemId: `item-${notifications.length}`, delivery: 'center' as const }
      },
    },
    ui: {
      async postMessage(message: Record<string, unknown>) {
        const error = uiGuard.consume('update-radar', 'worker-to-panel', message)
        if (error) {
          uiMessageRejections.push({ type: message.type, error })
          throw new Error(error)
        }
        panelMessages.push(structuredClone(message))
        return { delivered: true }
      },
      onMessage(handler: (message: unknown) => Promise<void>) {
        panelHandler = handler
        return () => {}
      },
    },
    schedule: {
      every(seconds: number, callback: () => void) {
        scheduled = { seconds, callback }
        return () => {}
      },
    },
    log: {
      async warn(...values: unknown[]) {
        logs.push(values)
        return { logged: true as const }
      },
    },
  }

  return {
    api,
    failures,
    logs,
    notifications,
    panelMessages,
    uiMessageRejections,
    storage,
    now: () => nowMs,
    setNow: (value: string) => { nowMs = Date.parse(value) },
    getPanelHandler: () => panelHandler,
    getScheduled: () => scheduled,
    setOpenAiBody: (value: string) => { openAiBody = value },
    setGithubBody: (value: string) => { githubBody = value },
    setCodexStatus: (value: unknown) => { codexStatus = structuredClone(value) },
    pauseFetches() {
      let release!: () => void
      fetchGate = new Promise<void>(resolve => { release = resolve })
      return () => {
        fetchGate = null
        release()
      }
    },
  }
}

test('Update Radar complete manifest passes validation with least-privilege hosts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  const parsed = parsePluginManifest(manifest)
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error)
  assert.deepEqual(parsed.ok ? parsed.manifest.permissions.network?.hosts : [], [
    'api.github.com', 'codex-resets.com', 'developers.openai.com', 'platform.claude.com', 'x.com',
  ])
  assert.deepEqual(parsed.ok ? parsed.manifest.permissions.links?.hosts : [], [
    'codex-resets.com', 'developers.openai.com', 'github.com', 'platform.claude.com', 'x.com',
  ])
  assert.equal(parsed.ok ? 'quota' in parsed.manifest.permissions : true, false)
  assert.equal(parsed.ok ? parsed.manifest.permissions.schedule?.minIntervalSec : null, 300)

  for (const relative of ['plugin.json', 'dist/main.js', 'dist/core.js', 'ui/index.html', 'ui/panel.js', 'ui/panel.css']) {
    assert.equal(fs.existsSync(path.join(pluginRoot, relative)), true, relative)
  }
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const workerSource = fs.readFileSync(path.join(pluginRoot, 'dist/main.js'), 'utf8')
  assert.match(panelSource, /api\.links\.openExternal\(sourceUrl\)/)
  assert.doesNotMatch(panelSource, /window\.open|location\s*=|innerHTML/)
  assert.doesNotMatch(workerSource, /timeZone\s*:\s*['"]Asia\/Taipei['"]/)
  assert.match(workerSource, /https:\/\/codex-resets\.com\/api\/v1\/status/)
  assert.match(panelSource, /資料來源：codex-resets\.com/)
  assert.match(panelSource, /codex-resets\.com\//)
  assert.match(fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8'), /codex-source-link:focus-visible/)
})

test('Update Radar heatmap separates official activity from today’s Tibo posts', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(markup, /近 26 週官方 AI 更新/)
  assert.match(markup, /每天的官方更新則數，Claude Code 每個版本、Claude Platform 每天各算一則，不含 Tibo 貼文/)
  assert.match(markup, /官方需留意/)
  assert.match(markup, /id="tibo-summary"[^>]*type="button"/)
  assert.match(panelSource, /function isTiboUpdate\(update\)/)
  assert.match(panelSource, /const officialUpdates = updates\.filter\(update => !isTiboUpdate\(update\)\)/)
  assert.match(panelSource, /isTiboUpdate\(update\) && heatDateKey\(update\) === todayKey/)
  assert.match(panelSource, /postKind === 'root'/)
  assert.match(panelSource, /postKind === 'self-reply'/)
  assert.match(panelSource, /elements\.provider\.value = 'x'/)
  assert.match(panelSource, /scrollIntoView/)
  assert.match(styles, /\.tibo-summary:focus-visible/)
})

test('Update Radar official previews drop a leading copy of the title', () => {
  const textAfterTitle = runInNewContext(`(${panelFunctionSource('textAfterTitle')})`) as (title: unknown, text: unknown) => string
  assert.equal(textAfterTitle('Claude Code v2.1.312', 'Claude Code v2.1.312 — Fixed the resume picker.'), 'Fixed the resume picker.')
  assert.equal(textAfterTitle('New  Responses API', 'new responses\napi: streaming tool calls'), 'streaming tool calls')
  assert.equal(textAfterTitle('GPT-5.1 (preview)', 'GPT-5.1 (preview).'), '')
  assert.equal(textAfterTitle('Model deprecations', 'Older snapshots retire on 2026-12-01.'), 'Older snapshots retire on 2026-12-01.')
  assert.equal(textAfterTitle('Release', undefined), '')
})

test('Update Radar shows a clipped single-paragraph update once instead of title plus repeat', () => {
  const officialHeadline = runInNewContext(`(() => { ${panelFunctionSource('textAfterTitle')}
${panelFunctionSource('collapsedWhitespace')}
return ${panelFunctionSource('officialHeadline')} })()`) as (update: unknown) => { headline: string; previewText: string }
  const full = 'Added idle compaction to VS Code and Claude Desktop\'s Code tab: a 200K+ token conversation left idle is summarized, and the summary is used on your next message if the prompt cache has expired'
  assert.deepEqual({ ...officialHeadline({ title: `${full.slice(0, 179).trimEnd()}…`, summary: full }) }, { headline: full, previewText: '' })
  assert.deepEqual({ ...officialHeadline({ title: 'Fixed claude -p exiting with code 0', summary: 'Fixed claude -p exiting with code 0' }) }, { headline: 'Fixed claude -p exiting with code 0', previewText: '' })
  assert.deepEqual({ ...officialHeadline({ title: 'New  Responses API', summary: 'New Responses API. Streaming tool calls.' }) }, { headline: 'New  Responses API', previewText: 'Streaming tool calls.' })
  assert.deepEqual({ ...officialHeadline({ title: 'Model update…', summary: 'Different text entirely.' }) }, { headline: 'Model update…', previewText: 'Different text entirely.' })
  assert.deepEqual({ ...officialHeadline({ title: '', summary: '' }) }, { headline: '未命名更新', previewText: '' })
})

test('Update Radar heatmap days filter the list to that day of official updates', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const dayLabel = runInNewContext(`(${panelFunctionSource('dayLabel')})`) as (key: string) => string
  assert.equal(dayLabel('2026-10-28'), '10/28（三）')
  assert.equal(dayLabel('2026-11-01'), '11/1（日）')
  // 日期篩選只留下官方更新，且只對有更新的格子提供按鈕。
  assert.match(panelFunctionSource('matchesFilters'), /state\.day && \(isTiboUpdate\(update\) \|\| heatDateKey\(update\) !== state\.day\)/)
  assert.match(panelFunctionSource('renderHeatmap'), /if \(count\) \{[^}]*heat-cell-button[^}]*aria-pressed/s)
  assert.match(panelFunctionSource('selectDay'), /state\.day = state\.day === key \? null : key/)
  assert.match(panelFunctionSource('appliedFilterCount'), /state\.day/)
  assert.match(panelSource, /elements\.tiboSummary\.addEventListener\('click', \(\) => \{[^}]*state\.day = null/s)
  assert.match(markup, /id="day-filter" class="day-filter" hidden/)
  assert.match(markup, /id="day-filter-clear"[^>]*type="button"/)
})

test('Update Radar renders Tibo as a bubble and official updates as source-accent records', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const tiboRender = panelSource.slice(panelSource.indexOf('function renderTiboBubble'), panelSource.indexOf('function renderTiboUpdate'))
  const officialRender = panelSource.slice(panelSource.indexOf('function renderOfficialUpdate'), panelSource.indexOf('function resetTypeLabel'))
  assert.match(tiboRender, /time-chip/)
  assert.match(tiboRender, /Tibo \/ X/)
  assert.match(tiboRender, /原始貼文/)
  assert.match(tiboRender, /自我回文/)
  assert.doesNotMatch(tiboRender, /change-label|category-label|attention-chip|appendQuickRead/)
  assert.match(panelFunctionSource('appendDetails'), /appendQuickRead\(content, update\)/)
  assert.match(officialRender, /official-record/)
  assert.match(officialRender, /official-meta-tag/)
  assert.doesNotMatch(officialRender, /source-avatar|message-bubble|renderTiboBubble/)
  assert.match(panelSource, /preview\.scrollHeight > preview\.clientHeight \+ 1/)
  assert.match(panelSource, /new ResizeObserver/)
  assert.match(panelSource, /window\.addEventListener\('resize'/)
  assert.match(panelSource, /展開快速判讀/)
  // 展開是撐開原本的預覽，不再另外印一份全文。
  assert.doesNotMatch(panelSource, /full-copy|展開完整原文|展開原文/)
  assert.match(tiboRender, /appendExpandToggle\(bubble, preview\)/)
  assert.match(officialRender, /officialHeadline\(update\)/)
  assert.match(officialRender, /appendExpandToggle\(article, solo\)/)
  assert.match(styles, /\.message-preview\.is-expanded,\s*\.official-preview\.is-expanded,\s*\.official-title-solo\.is-expanded \{[^}]*-webkit-line-clamp: unset/)
  assert.match(styles, /\.official-title \{[^}]*font-size: var\(--radar-font-lead\)/)
  assert.match(panelSource, /const attention = units\.filter\(unitNeedsAttention\)\.length/)
  assert.match(styles, /\.official-record\.record-openai/)
  assert.match(styles, /\.official-record\.record-anthropic/)
  assert.match(styles, /\.official-record\.record-claude-code/)
  assert.match(styles, /\.official-record \{[^}]*border-left: 4px solid/s)
  assert.match(styles, /@media \(forced-colors: active\)/)
  assert.match(markup, /需要留意數僅計官方更新/)
})

test('Update Radar initial skeletons cover no state and an empty all-loading state, then clear busy on data', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const shouldShowInitialSkeletons = runInNewContext(`(${panelFunctionSource('shouldShowInitialSkeletons')})`) as (radar: unknown) => boolean
  assert.equal(shouldShowInitialSkeletons(null), true)
  assert.equal(shouldShowInitialSkeletons({
    sources: Array.from({ length: 7 }, (_, index) => ({ id: `source-${index}`, status: 'loading' })),
    updates: [],
    codexReset: null,
    baselineSourceIds: [],
    lastCheckedAt: '2026-10-28T08:00:00.000Z',
  }), true)
  assert.equal(shouldShowInitialSkeletons({
    sources: Array.from({ length: 7 }, (_, index) => ({ id: `source-${index}`, status: 'ok' })),
    updates: [{ id: 'openai-1' }],
    codexReset: { latestReset: {} },
    baselineSourceIds: ['openai-api'],
    lastCheckedAt: '2026-10-28T08:01:00.000Z',
  }), false)

  assert.match(panelSource, /renderSpotlightSkeleton\(\)\s*renderSummaryLoading\(true\)\s*renderHeatmapSkeleton\(\)\s*renderUpdateListSkeleton\(\)/)
  assert.match(panelFunctionSource('renderSpotlight'), /renderSpotlightSkeleton\(\)\s*return/)
  assert.match(panelFunctionSource('renderHeatmap'), /renderHeatmapSkeleton\(\)\s*return/)
  assert.match(panelFunctionSource('renderUpdates'), /renderUpdateListSkeleton\(\)\s*return/)
  assert.match(panelFunctionSource('renderSummaryLoading'), /setBusy\(elements\.summaryGrid, show \|\|/)
  assert.match(panelFunctionSource('renderSpotlight'), /setBusy\(elements\.spotlight, false\)/)
  assert.match(panelFunctionSource('renderHeatmap'), /setBusy\(elements\.heatmap, officialLoading\)/)
  assert.match(panelFunctionSource('renderUpdates'), /setBusy\(elements\.updates, updateLoading\)/)

  const setBusy = runInNewContext(`(${panelFunctionSource('setBusy')})`) as (element: { setAttribute: (name: string, value: string) => void, removeAttribute: (name: string) => void }, busy: boolean) => void
  const attributes = new Map<string, string>()
  const element = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  }
  setBusy(element, true)
  assert.equal(attributes.get('aria-busy'), 'true')
  setBusy(element, false)
  assert.equal(attributes.has('aria-busy'), false)
})

test('panel refresh and retry trackers wait for loading then completion', () => {
  const createTracker = runInNewContext(`(${panelFunctionSource('createPendingSyncTracker')})`) as (options: Record<string, unknown>) => any
  const tracker = createTracker({ timeoutMs: 30_000, setTimer: () => 1, clearTimer: () => {} })
  tracker.begin('all')
  tracker.observe([{ id: 'openai-api', status: 'ok' }])
  assert.equal(tracker.isPending('all'), true, 'delivery before loading must remain pending')
  tracker.observe([{ id: 'openai-api', status: 'loading' }])
  assert.equal(tracker.isPending('all'), true)
  tracker.observe([{ id: 'openai-api', status: 'ok' }, { id: 'claude-code', status: 'ok' }])
  assert.equal(tracker.isPending('all'), false, 'settle only after loading has been observed')

  tracker.begin('openai-api')
  tracker.observe([{ id: 'openai-api', status: 'loading' }])
  tracker.observe([{ id: 'openai-api', status: 'error' }])
  assert.equal(tracker.isPending('openai-api'), false, 'source retry settles after its loading state ends')

  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.match(panelSource, /dispatchSyncRequest\(syncTracker, message => api\.ui\.postMessage\(message\), 'all'/)
  assert.match(panelSource, /dispatchSyncRequest\([\s\S]*?source\.id,[\s\S]*?radar:retry-source/)
  assert.doesNotMatch(panelSource.slice(panelSource.indexOf("elements.refresh.addEventListener('click'")), /finally\s*\{/)
})

test('panel click request stays pending after delivery and failed delivery releases it immediately', async () => {
  const dispatchSyncRequest = runInNewContext(`(${panelFunctionSource('dispatchSyncRequest')})`) as (...args: any[]) => Promise<boolean>
  let pending = false
  const calls: string[] = []
  const tracker = {
    begin(key: string) { calls.push(`begin:${key}`); pending = true },
    fail(key: string) { calls.push(`fail:${key}`); pending = false },
  }
  let finishDelivery!: (result: { delivered: boolean }) => void
  const deliveredRequest = dispatchSyncRequest(tracker, () => new Promise(resolve => { finishDelivery = resolve }), 'all', { type: 'radar:refresh' })
  assert.equal(pending, true)
  assert.deepEqual(calls, ['begin:all'])
  finishDelivery({ delivered: true })
  assert.equal(await deliveredRequest, true)
  assert.equal(pending, true, 'successful postMessage delivery must await loading and completion states')

  assert.equal(await dispatchSyncRequest(tracker, async () => ({ delivered: false }), 'openai-api', { type: 'radar:retry-source' }), false)
  assert.equal(pending, false, 'failed delivery clears its pending indicator immediately')
  assert.deepEqual(calls.slice(-2), ['begin:openai-api', 'fail:openai-api'])
})

test('panel refresh tracker has a 30 second timeout and delivery failure clears pending immediately', () => {
  const createTracker = runInNewContext(`(${panelFunctionSource('createPendingSyncTracker')})`) as (options: Record<string, unknown>) => any
  const timers: Array<{ callback: () => void, cleared: boolean }> = []
  const tracker = createTracker({
    timeoutMs: 30_000,
    setTimer: (callback: () => void) => {
      const timer = { callback, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer: { cleared: boolean }) => { timer.cleared = true },
  })
  tracker.begin('all')
  assert.equal(tracker.isPending('all'), true)
  timers[0].callback()
  assert.equal(tracker.isPending('all'), false, 'timeout must release pending state')

  tracker.begin('all')
  assert.equal(tracker.isPending('all'), true)
  tracker.fail('all')
  assert.equal(tracker.isPending('all'), false, 'failed delivery must release pending immediately')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.match(panelSource, /timeoutMs:\s*30_000/)
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /\[hidden\]\s*\{[^}]*animation:\s*none/s)
  assert.match(styles, /\[hidden\]\s+\*\s*\{[^}]*animation:\s*none/s)
})

test('worker emits JSON guard-valid source loading state before a refresh fetch completes', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  const releaseFetches = fixture.pauseFetches()
  const startPromise = runtime.start()
  let loadingMessage: Record<string, any> | undefined
  for (let attempt = 0; attempt < 80 && !loadingMessage; attempt += 1) {
    loadingMessage = fixture.panelMessages.find(message => message.type === 'radar:state'
      && Array.isArray((message.state as any)?.sources)
      && (message.state as any).sources.some((source: any) => source.status === 'loading'))
    if (!loadingMessage) await new Promise<void>(resolve => setImmediate(resolve))
  }
  releaseFetches()
  await startPromise

  assert.ok(loadingMessage, 'refresh must post a state containing loading sources')
  assert.deepEqual(fixture.uiMessageRejections, [], 'worker-to-panel UI guard must accept the loading state')
  for (const source of (loadingMessage!.state as any).sources.filter((item: any) => item.status === 'loading')) {
    assert.equal(Object.hasOwn(source, 'error'), false, 'loading entries must omit the non-JSON undefined error field')
  }
  const guard = new PluginUiMessageGuard()
  assert.equal(guard.consume('update-radar', 'worker-to-panel', loadingMessage), null)
  const withUndefinedError = {
    ...loadingMessage,
    state: {
      ...(loadingMessage!.state as any),
      sources: (loadingMessage!.state as any).sources.map((source: any) => source.status === 'loading' ? { ...source, error: undefined } : source),
    },
  }
  assert.equal(new PluginUiMessageGuard().consume('update-radar', 'worker-to-panel', withUndefinedError), 'invalid_request')
  assert.equal(runtime.getState().sources.every(source => source.status !== 'loading'), true)
})

test('Update Radar developer folder passes production archive validation', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'update-radar-plugin-'))
  try {
    const registry = new PluginRegistry(userData)
    const planned = await registry.planInstallDirectory(pluginRoot)
    assert.equal(planned.ok, true, planned.ok ? '' : planned.error)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('official parsers classify updates and compare Claude Code versions', () => {
  const updates = parseOpenAiChangelog(updatedMarkdown)
  assert.equal(updates.length, 2)
  assert.equal(updates[0].changeType, 'fixed')
  assert.match(updates[0].id, /^openai-[a-f0-9]{16}$/)

  const definition = SOURCE_DEFINITIONS.find(source => source.id === 'claude-code')!
  const compared = withVersionComparisons(parseGithubReleases(definition, githubReleases))
  assert.equal(compared[0].version, 'v2.1.0')
  assert.equal(compared[0].previousVersion, 'v2.0.0')
})

function release(tag: string, publishedAt: string, bullets: string[]) {
  return {
    tag_name: tag,
    published_at: publishedAt,
    html_url: `https://github.com/anthropics/claude-code/releases/tag/${tag}`,
    body: bullets.map(bullet => `- ${bullet}`).join('\n'),
  }
}

test('Claude Code parser keeps whole releases in order and drops a summary that repeats the title', () => {
  const definition = { ...SOURCE_DEFINITIONS.find(source => source.id === 'claude-code')!, maxItems: 4 }
  const updates = parseGithubReleases(definition, JSON.stringify([
    release('v2.2.0', '2026-10-28T04:00:00Z', ['Fixed one.', 'Added two.', 'Improved three.']),
    release('v2.1.9', '2026-10-27T04:00:00Z', ['Fixed four.', 'Fixed five.']),
  ]))
  // 第二版放不下時整版捨棄，版本卡的分類數量才不會少算。
  assert.deepEqual(updates.map(update => [update.version, update.position]), [['v2.2.0', 0], ['v2.2.0', 1], ['v2.2.0', 2]])
  assert.equal(updates[0].summary, '')
  assert.equal(updates[0].title, 'Fixed one.')

  const oversized = parseGithubReleases(definition, JSON.stringify([
    release('v3.0.0', '2026-10-28T04:00:00Z', ['Added a.', 'Added b.', 'Added c.', 'Added d.', 'Added e.']),
  ]))
  assert.equal(oversized.length, 4, 'the newest release is truncated rather than dropped')
  assert.equal(SOURCE_DEFINITIONS.find(source => source.id === 'claude-code')!.maxItems, 150)
})

test('changelog bullets are classified by their leading verb before body keywords', () => {
  const definition = SOURCE_DEFINITIONS.find(source => source.id === 'claude-code')!
  const updates = parseGithubReleases(definition, JSON.stringify([release('v2.2.0', '2026-10-28T04:00:00Z', [
    'Fixed logout reporting success when the sign-in was not removed',
    '[VSCode] Fixed a startup warning for a deprecated key',
    'Changed the Bash tool to clear inherited aliases',
    'Removed the legacy --foo flag',
    'Added a new setting',
  ])]))
  assert.deepEqual(updates.map(update => update.changeType), ['fixed', 'fixed', 'improved', 'removed', 'added'])
})

test('Claude Code notifications are grouped per new version and absorb backfilled known versions', () => {
  assert.ok(compareVersions('v2.1.314', 'v2.1.99') > 0)
  assert.equal(compareVersions('v2.1.0', '2.1.0'), 0)
  const change = (version: string, id: string) => ({ id, sourceId: 'claude-code', version, changeType: 'fixed' })
  const known = [change('v2.1.312', 'a')]
  const entries = notificationEntries([
    change('v2.1.314', 'b'), change('v2.1.314', 'c'),
    change('v2.1.312', 'd'),
    change('v2.1.311', 'e'),
    { id: 'openai-x', sourceId: 'openai-api', changeType: 'added' },
  ], known)
  assert.deepEqual(entries.map((entry: any) => entry.kind === 'release' ? `${entry.version}:${entry.updates.length}` : entry.update.id), ['v2.1.314:2', 'openai-x'])

  const withoutHistory = notificationEntries([change('v2.1.314', 'b'), change('v2.1.311', 'e')], [])
  assert.deepEqual(withoutHistory.map((entry: any) => entry.version), ['v2.1.314'])
})

test('a new Claude Code version sends one notification with per-type counts', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  assert.equal(fixture.notifications.length, 0)
  fixture.setGithubBody(JSON.stringify([
    release('v2.2.0', '2026-10-28T04:00:00Z', ['Added a.', 'Fixed b.', 'Fixed c.', 'Removed d.', 'Fixed e.']),
    ...JSON.parse(githubReleases),
  ]))
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'claude-code' })
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0]?.title, 'Claude Code v2.2.0 已發布')
  assert.equal(fixture.notifications[0]?.body, '2026-10-28 · 新增 1 · 修正 3 · 移除 1')
  assert.equal(fixture.notifications[0]?.priority, 'high')
  assert.equal(fixture.notifications[0]?.dedupeKey, 'update-radar-claude-code-v2.2.0')
  assert.ok(runtime.getState().updates.filter(update => update.version === 'v2.2.0').every(update => Number.isInteger(update.position)))
})

test('state that would exceed the panel message limit drops the oldest updates first', () => {
  const update = (index: number) => ({ id: `u${index}`, sourceId: 'openai-api', summary: 'x'.repeat(2000) })
  const state = {
    sources: [{ id: 'openai-api', itemCount: 200 }, { id: 'codex-resets', itemCount: 1 }],
    updates: Array.from({ length: 200 }, (_, index) => update(index)),
  }
  const fitted = fitStateToMessageBudget(state)
  assert.ok(fitted.updates.length < 200 && fitted.updates.length > 50)
  assert.equal(fitted.updates[0].id, 'u0')
  assert.ok(new TextEncoder().encode(JSON.stringify({ type: 'radar:state', state: fitted })).byteLength <= 230 * 1024)
  assert.equal(fitted.sources[0].itemCount, fitted.updates.length)
  assert.equal(fitted.sources[1].itemCount, 1)
  const small = { ...state, updates: state.updates.slice(0, 3) }
  assert.equal(fitStateToMessageBudget(small), small)
})

test('panel groups a Claude Code version and a multi-item Platform day into one card each', () => {
  const source = ['isTiboUpdate', 'attentionSignal', 'findThreadRootId', 'groupKey', 'byPosition', 'groupUpdates', 'updateUnits', 'isCriticalChange', 'unitNeedsAttention']
    .map(panelFunctionSource).join('\n')
  const panel = runInNewContext(`(() => { ${source}
return { groupUpdates, updateUnits, unitNeedsAttention } })()`) as any
  const change = (id: string, sourceId: string, extra: Record<string, unknown>) => ({ id, sourceId, provider: 'anthropic', changeType: 'fixed', title: id, summary: '', ...extra })
  const updates = [
    change('b', 'claude-code', { version: 'v2', position: 1 }),
    change('p2', 'anthropic-platform', { publishedAt: '2026-10-29', position: 1 }),
    change('o', 'openai-api', { changeType: 'added' }),
    change('a', 'claude-code', { version: 'v2', position: 0, changeType: 'removed' }),
    change('p1', 'anthropic-platform', { publishedAt: '2026-10-29', position: 0 }),
    change('p3', 'anthropic-platform', { publishedAt: '2026-10-28', position: 0 }),
    change('c', 'claude-code', { version: 'v1', position: 0 }),
  ]
  const groups = panel.groupUpdates(updates)
  assert.equal(JSON.stringify(groups.map((group: any) => [group.kind, group.updates.map((update: any) => update.id).join('')])),
    JSON.stringify([['changes', 'ab'], ['changes', 'p1p2'], ['single', 'o'], ['single', 'p3'], ['changes', 'c']]))
  const units = panel.updateUnits(updates)
  assert.equal(units.length, 5)
  assert.equal(JSON.stringify(units.map((unit: unknown) => panel.unitNeedsAttention(unit))), '[true,false,false,false,false]')
})

test('grouped card previews mix change types and expanded views replace the preview', () => {
  const source = ['byPosition', 'previewChanges'].map(panelFunctionSource).join('\n')
  const previewChanges = runInNewContext(`(() => { const CHANGE_PREVIEW_ORDER = ['removed', 'deprecated', 'added', 'improved', 'fixed']; const CHANGE_PREVIEW_COUNT = 3
${source}
return previewChanges })()`) as (changes: unknown[]) => Array<{ id: string }>
  const change = (id: string, changeType: string, position: number) => ({ id, changeType, position })
  const ids = (changes: unknown[]) => previewChanges(changes).map(update => update.id).join('')
  assert.equal(ids([change('a1', 'added', 0), change('a2', 'added', 1), change('i', 'improved', 2), change('f', 'fixed', 3)]), 'a1if')
  assert.equal(ids([change('f1', 'fixed', 0), change('f2', 'fixed', 1), change('f3', 'fixed', 2), change('f4', 'fixed', 3)]), 'f1f2f3')
  assert.equal(ids([change('a', 'added', 0), change('f', 'fixed', 1), change('r', 'removed', 2)]), 'raf')

  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  assert.match(panelSource, /const CHANGE_INLINE_ALL_MAX = 5/)
  assert.match(panelSource, /const CHANGE_INLINE_EXPAND_MAX = 20/)
  assert.match(panelSource, /preview\.hidden = details\.open/)
  assert.match(panelSource, /button\.setAttribute\('aria-pressed', String\(button\.dataset\.type === selected\)\)/)
  assert.match(panelSource, /event\.key === 'Escape' && state\.detail/)
  assert.match(panelSource, /window\.scrollTo\(0, detail\.scrollY\)/)
  assert.match(markup, /id="change-detail" class="radar-shell change-detail" hidden/)
  assert.match(markup, /id="change-detail-back"[^>]*type="button"/)
})

const deprecationMarkdown = `
### 2026-10-01: GPT-5.3-Codex and TTS

The following models are deprecated and will be removed from the API.

| Shutdown date | Model / system                              | Recommended replacement |
| ------------- | ------------------------------------------- | ----------------------- |
| Apr 1, 2027   | \`gpt-5.3-codex\`                             | \`gpt-6-sol\`             |
| Jan 6, 2027   | GPT-4o mini (\`gpt-4o-mini\`) \\| \`tts-1\`    |                         |
`

test('deprecation tables become structured retirements and leave prose as the summary', () => {
  const rows = extractRetirements(deprecationMarkdown)
  assert.deepEqual(rows, [
    { model: 'gpt-5.3-codex', date: '2027-04-01', replacement: 'gpt-6-sol' },
    { model: 'GPT-4o mini (gpt-4o-mini) / tts-1', date: '2027-01-06', replacement: null },
  ])
  const definition = SOURCE_DEFINITIONS.find(source => source.id === 'openai-deprecations')!
  const [update] = parseDatedMarkdown(definition, deprecationMarkdown)
  assert.equal(update.summary, 'The following models are deprecated and will be removed from the API.')
  assert.equal(update.effectiveAt, '2027-01-06')
  assert.equal(update.replacement, 'gpt-6-sol')
  assert.equal(update.changeType, 'deprecated')
  assert.deepEqual(extractRetirements('| Name | Value |\n| --- | --- |\n| a | b |'), [])
})

test('retirement status counts down to the nearest upcoming shutdown and reports past ones', () => {
  const source = ['formatDate', 'daysUntil', 'retirementStatus'].map(panelFunctionSource).join('\n')
  const retirementStatus = runInNewContext(`(() => { const DAY_MS = 86400000\n${source}\nreturn retirementStatus })()`, { Intl, Date }) as (rows: unknown[]) => { text: string, tone: string }
  const iso = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
  assert.match(retirementStatus([{ date: iso(10) }]).text, /^10 天後停用 · /)
  assert.equal(retirementStatus([{ date: iso(10) }]).tone, 'critical')
  assert.equal(retirementStatus([{ date: iso(60) }]).tone, 'warn')
  assert.match(retirementStatus([{ date: iso(200) }, { date: iso(-5) }]).text, /^最早 200 天後停用/)
  assert.match(retirementStatus([{ date: iso(-5) }]).text, /^已於 .* 停用$/)
  assert.equal(retirementStatus([{ date: null }]).text, '停用日期未定')
})

test('several new Claude Platform items on one date send one notification', () => {
  const item = (id: string, publishedAt: string) => ({ id, sourceId: 'anthropic-platform', publishedAt, changeType: 'added', title: id })
  const entries = notificationEntries([item('a', '2026-10-29'), item('b', '2026-10-29'), item('c', '2026-10-28')], [])
  assert.equal(JSON.stringify(entries.map((entry: any) => entry.kind === 'day' ? `day:${entry.updates.length}` : `update:${entry.update.id}`)), '["day:2","update:c"]')
})

test('Tibo parser keeps today roots and chained self replies in one safe data model', () => {
  const rootId = '2113162277688070445'
  const replyId = '2113162413008884099'
  const roots = parseTiboPublicProfile(profileHtml([
    profilePost(rootId, '2026-10-28T07:00:00Z', 'Root public post.'),
  ]), { now: new Date(FIXED_NOW), timeZone: 'UTC' })
  const replies = parseTiboSelfReplies(conversationHtml(rootId, [
    conversationTweet({ id: replyId, timestamp: '2026-10-28T07:01:00Z', text: 'First self reply.', replyToId: rootId }),
    conversationTweet({ id: '2113162537093267968', timestamp: '2026-10-28T07:02:00Z', text: 'Second-level reply.', replyToId: replyId }),
  ]), { rootId, now: new Date(FIXED_NOW), timeZone: 'UTC' })
  assert.equal(roots[0].postKind, 'root')
  assert.deepEqual(replies.map(update => update.replyToId).sort(), [`x-${replyId}`, `x-${rootId}`].sort())
})

test('Codex Resets parser validates the status, observed ids, source URL and schedule', () => {
  const observed = parseCodexResetsStatus(codexResetPayload({
    id: 'observed-2115330127886463244',
    sourceUrl: 'https://example.com/announcement',
    scheduledReset: { scheduled_at: '2026-10-28T09:30:00.000Z' },
    text: 'x'.repeat(320),
  }), FIXED_NOW)
  assert.deepEqual(observed, {
    latestReset: {
      id: 'observed-2115330127886463244', resetType: 'regular', announcedAt: '2026-10-28T06:29:38.000Z', text: 'x'.repeat(280),
    },
    scheduledReset: { at: '2026-10-28T09:30:00.000Z' },
    stats: { total: 69, lastResetAt: '2026-10-28T06:29:38.000Z' },
  })

  const official = parseCodexResetsStatus(codexResetPayload({ scheduledReset: { at: '2026-10-28T07:59:00.000Z' } }), FIXED_NOW)
  assert.equal(official?.latestReset.sourceUrl, 'https://x.com/thsottiaux/status/2115330127886463244')
  assert.equal(official?.scheduledReset, null)
  assert.equal(parseCodexResetsStatus(codexResetPayload({ scheduledReset: { at: 'tomorrow' } }), FIXED_NOW)?.scheduledReset, null)
  assert.equal(parseCodexResetsStatus('{invalid', FIXED_NOW), null)
  for (const invalid of [
    codexResetPayload({ announcedAt: 'tomorrow' }),
    codexResetPayload({ lastResetAt: '2026-02-31T00:00:00.000Z' }),
    codexResetPayload({ id: 'observed-not-a-number' }),
    codexResetPayload({ resetType: 'regular_2' }),
    codexResetPayload({ sourceType: 'third_party' }),
  ]) assert.equal(parseCodexResetsStatus(invalid, FIXED_NOW), null)
})

test('runtime establishes a quiet baseline and notifies only later new updates', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()

  assert.equal(fixture.notifications.length, 0)
  assert.equal(fixture.getScheduled()?.seconds, 300)
  assert.equal(runtime.getState().sources.length, 7)
  assert.equal(runtime.getState().sources.every(source => source.status === 'ok'), true)
  assert.equal(runtime.getState().baselineSourceIds.length, 7)
  assert.equal(runtime.getState().codexReset?.latestReset.id, '2115330127886463244')

  fixture.setOpenAiBody(updatedMarkdown)
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  assert.equal(fixture.notifications.length, 1)
  assert.match(String(fixture.notifications[0]?.dedupeKey), /^update-radar-openai-/)
  assert.equal(runtime.getState().updates.some(update => update.title.includes('image input')), true)

  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  assert.equal(fixture.notifications.length, 1)
  assert.equal((fixture.storage.get('radar-state') as { schemaVersion: number }).schemaVersion, 4)
  assert.ok(fixture.panelMessages.some(message => message.type === 'radar:state'))
})

test('a first Codex Resets status is a quiet baseline', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  assert.equal(fixture.notifications.length, 0)
  assert.equal(runtime.getState().codexReset?.latestReset.id, '2115330127886463244')
  assert.equal(runtime.getState().lastNotifiedCodexReset, null)
})

test('a new Codex reset notifies separately from a merged update burst and persists its notification', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  assert.equal(fixture.notifications.length, 0)

  fixture.setOpenAiBody(bulkUpdatedMarkdown)
  fixture.setCodexStatus(codexResetPayload({
    id: '2115330127886463245', announcedAt: '2026-10-28T08:01:00.000Z', lastResetAt: '2026-10-28T08:01:00.000Z',
  }))
  await fixture.getPanelHandler()?.({ type: 'radar:refresh' })

  assert.equal(fixture.notifications.length, 2)
  const resetNotification = fixture.notifications.find(item => item.title === 'Codex 用量已重設')
  assert.ok(resetNotification)
  assert.match(String(resetNotification?.body), /定期重設.*2026/)
  assert.equal(resetNotification?.link, 'https://x.com/thsottiaux/status/2115330127886463245')
  assert.equal(resetNotification?.dedupeKey, 'codex-reset-2115330127886463245')
  assert.ok(fixture.notifications.some(item => item.title === 'AI 更新雷達有 4 則新內容'))
  assert.deepEqual(runtime.getState().lastNotifiedCodexReset, { id: '2115330127886463245', announcedAt: '2026-10-28T08:01:00.000Z' })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.equal(fixture.notifications.length, 2)
})

test('observed to official Codex reset within twelve hours is not notified twice', async () => {
  const fixture = createApiFixture()
  fixture.setCodexStatus(codexResetPayload({ id: 'observed-2115330127886463244', announcedAt: '2026-10-28T06:00:00.000Z' }))
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setCodexStatus(codexResetPayload({ id: '2115330127886463244', announcedAt: '2026-10-28T17:59:00.000Z' }))
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.equal(fixture.notifications.length, 0)
  assert.equal(runtime.getState().codexReset?.latestReset.id, '2115330127886463244')
})

test('observed to official Codex reset after twelve hours sends a notification', async () => {
  const fixture = createApiFixture()
  fixture.setCodexStatus(codexResetPayload({ id: 'observed-2115330127886463244', announcedAt: '2026-10-28T05:00:00.000Z' }))
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setCodexStatus(codexResetPayload({ id: '2115330127886463244', announcedAt: '2026-10-28T17:01:00.000Z' }))
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0]?.title, 'Codex 用量已重設')
})

test('a new official Codex reset id is notified', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setCodexStatus(codexResetPayload({ id: '2115330127886463245', announcedAt: '2026-10-28T08:10:00.000Z' }))
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0]?.title, 'Codex 用量已重設')
})

test('schema version five quota snapshot fields are safely ignored during migration', async () => {
  const fixture = createApiFixture()
  fixture.storage.set('radar-state', {
    schemaVersion: 5, sources: [], updates: [], knownIds: [], baselineSourceIds: [],
    quotaSnapshot: { updatedAt: 'not-a-time', providers: [{ id: 'codex', account: 'drop' }] },
    notifiedQuotaResetKeys: ['old-quota-key'], lastCheckedAt: null, lastSuccessAt: null,
  })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  assert.equal(runtime.getState().schemaVersion, 4)
  assert.equal(runtime.getState().sources.length, 7)
  assert.equal('quotaSnapshot' in runtime.getState(), false)
  assert.equal('notifiedQuotaResetKeys' in runtime.getState(), false)
  assert.equal(runtime.getState().codexReset?.latestReset.id, '2115330127886463244')
  assert.equal(fixture.notifications.length, 0)
})

test('Codex Resets failure preserves the last valid cache and retries on backoff', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  const cached = structuredClone(runtime.getState().codexReset)
  fixture.failures.add('https://codex-resets.com/api/v1/status')
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.deepEqual(runtime.getState().codexReset, cached)
  const source = runtime.getState().sources.find(item => item.id === 'codex-resets')!
  assert.equal(source.status, 'stale')
  assert.equal(source.nextAttemptAt, '2026-10-28T08:05:00.000Z')
  assert.ok(fixture.logs.some(values => String(values[0]).includes('codex-resets')))
})

test('a failed source retains cache and schedules bounded automatic retry', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  const url = 'https://platform.claude.com/docs/en/release-notes/overview.md'
  const previousCount = runtime.getState().updates.filter(update => update.sourceId === 'anthropic-platform').length
  fixture.failures.add(url)
  fixture.setNow('2026-10-28T08:10:00Z')
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'anthropic-platform' })

  const source = runtime.getState().sources.find(item => item.id === 'anthropic-platform')!
  assert.equal(source.status, 'stale')
  assert.equal(source.itemCount, previousCount)
  assert.equal(source.failures, 1)
  assert.equal(source.nextAttemptAt, '2026-10-28T08:15:00.000Z')
  assert.ok(fixture.logs.some(values => String(values[0]).includes('anthropic-platform')))
})

test('a burst of updates is combined into one bounded pet notification', async () => {
  const fixture = createApiFixture()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setOpenAiBody(bulkUpdatedMarkdown)
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })

  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0]?.title, 'AI 更新雷達有 4 則新內容')
  assert.match(String(fixture.notifications[0]?.dedupeKey), /^update-radar-batch-/)
})

test('default activation starts the five-minute due-source heartbeat', async () => {
  const fixture = createApiFixture()
  await plugin.activate(fixture.api)
  assert.equal(fixture.getScheduled()?.seconds, 300)
  assert.equal(fixture.notifications.length, 0)
})
