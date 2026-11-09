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
  parseXProfile,
  parseXSelfReplies,
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
  const sourceUrl = options.sourceUrl ?? (id.startsWith('observed-') ? undefined : `https://x.com/ajambrosino/status/${numericId}`)
  return {
    data: {
      latest_reset: {
        id,
        reset_type: options.resetType ?? 'regular',
        announced_at: announcedAt,
        text: options.text ?? 'And it\'s done.',
        source: { type: options.sourceType ?? (id.startsWith('observed-') ? 'observed' : 'x_post'), author: 'ajambrosino', ...(sourceUrl ? { url: sourceUrl } : {}) },
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
  return `<div data-href="/ajambrosino/status/${id}"><span>@ajambrosino</span><script>"timestamp":${Date.parse(timestamp)}</script><div class="text-body whitespace-pre-wrap wrap-break-word">${text}</div></div>`
}

function profileHtml(posts: string[]) {
  return `<html><main aria-label="@ajambrosino">${posts.join('')}</main></html>`
}

function conversationTweet({ id, timestamp, text, replyToId }: { id: string, timestamp: string, text: string, replyToId: string }) {
  return {
    rest_id: id,
    result: {
      rest_id: id,
      core: { user_results: { result: { core: { screen_name: 'ajambrosino' } } } },
      details: { created_at_ms: Date.parse(timestamp), full_text: text },
      reply_to_results: { rest_id: replyToId },
      reply_to_user_results: { result: { core: { screen_name: 'ajambrosino' } } },
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
  const fetchCalls: Array<{ url: string, headers: Record<string, string> }> = []
  const responses = new Map<string, { status: number, headers: Record<string, string>, body: string }>()
  const responseHeaders = new Map<string, Record<string, string>>()
  const uiGuard = new PluginUiMessageGuard()
  const uiMessageRejections: Array<{ type: unknown, error: string }> = []
  let openAiBody = baselineMarkdown
  let githubBody = githubReleases
  let codexStatus: unknown = codexResetPayload()
  let xProfileBody = profileHtml([profilePost('2113000000000000000', '2026-10-27T08:00:00Z', 'Yesterday.')])
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
      async fetch(url: string, options: { headers?: Record<string, string> } = {}) {
        fetchCalls.push({ url, headers: structuredClone(options.headers ?? {}) })
        const gate = fetchGate
        if (gate) await gate
        if (responses.has(url)) return structuredClone(responses.get(url))
        if (failures.has(url)) return { status: 503, headers: {}, body: 'unavailable' }
        if (url.endsWith('/changelog.md')) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: openAiBody }
        if (url.endsWith('/deprecations.md')) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: baselineMarkdown }
        if (url.includes('release-notes/overview.md')) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: anthropicMarkdown }
        if (url.includes('model-deprecations.md')) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: anthropicMarkdown }
        if (url.startsWith('https://api.github.com/')) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: githubBody }
        if (url === 'https://codex-resets.com/api/v1/status') return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: JSON.stringify(codexStatus) }
        if (url === 'https://x.com/ajambrosino') {
          return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: xProfileBody }
        }
        const conversation = /^https:\/\/x\.com\/ajambrosino\/status\/(\d+)$/.exec(url)
        if (conversation) return { status: 200, headers: structuredClone(responseHeaders.get(url) ?? {}), body: conversationHtml(conversation[1], []) }
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
    fetchCalls,
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
    setXProfileBody: (value: string) => { xProfileBody = value },
    setResponseHeaders: (url: string, headers: Record<string, string>) => { responseHeaders.set(url, structuredClone(headers)) },
    setResponse: (url: string, response: { status: number, headers?: Record<string, string>, body?: string }) => {
      responses.set(url, { status: response.status, headers: structuredClone(response.headers ?? {}), body: response.body ?? '' })
    },
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
  assert.match(workerSource, /@ajambrosino 發了新貼文/)
  assert.match(workerSource, /@ajambrosino 發了新續文/)
  assert.doesNotMatch(panelSource, /window\.open|location\s*=|innerHTML/)
  assert.doesNotMatch(workerSource, /timeZone\s*:\s*['"]Asia\/Taipei['"]/)
  assert.match(workerSource, /https:\/\/codex-resets\.com\/api\/v1\/status/)
  assert.match(panelSource, /appendText\(row, 'a', 'codex-source-link', 'codex-resets\.com'\)/)
  assert.match(panelSource, /codex-resets\.com\//)
  assert.match(fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8'), /codex-source-link:focus-visible/)
})

test('Update Radar heatmap separates official activity from today’s @ajambrosino posts', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(markup, /id="heat-disclosure-host" class="heat-section"/)
  assert.match(markup, /每格是當天官方更新數；Claude Code 每版、Platform 每天各算 1 則，不含 X 貼文/)
  assert.match(markup, /需留意/)
  assert.match(markup, /id="x-summary"[^>]*type="button"/)
  assert.match(panelSource, /function isXPost\(update\)/)
  assert.match(panelSource, /const officialUpdates = updates\.filter\(update => !isXPost\(update\)\)/)
  assert.match(panelSource, /isXPost\(update\) && heatDateKey\(update\) === todayKey/)
  assert.match(panelSource, /title: '每日更新熱度 · 近 26 週'/)
  assert.match(panelSource, /open: state\.disclosures\.get\(heatDisclosureId\) === true/)
  assert.match(panelSource, /meta: state\.day \? `已選 \$\{month\}\/\$\{day\}` : ''/)
  assert.match(panelSource, /postKind === 'root'/)
  assert.match(panelSource, /postKind === 'self-reply'/)
  assert.match(panelSource, /elements\.provider\.value = 'x'/)
  assert.match(panelSource, /scrollIntoView/)
  assert.match(styles, /\.x-summary:focus-visible/)
})

test('Update Radar panel copy avoids internal terms and longer labels', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const internalCopy = /背景插件|退避|自我回文|快速判讀|需要留意/
  assert.doesNotMatch(markup, internalCopy)
  assert.doesNotMatch(panelSource, internalCopy)
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
  assert.match(panelFunctionSource('matchesFilters'), /state\.day && \(isXPost\(update\) \|\| heatDateKey\(update\) !== state\.day\)/)
  assert.match(panelFunctionSource('renderHeatmap'), /if \(count\) \{[^}]*heat-cell-button[^}]*aria-pressed/s)
  assert.match(panelFunctionSource('selectDay'), /state\.day = state\.day === key \? null : key/)
  assert.match(panelFunctionSource('appliedFilterCount'), /state\.day/)
  assert.match(panelSource, /elements\.xSummary\.addEventListener\('click', \(\) => applyOverviewView\('x'\)\)/)
  assert.match(panelFunctionSource('applyOverviewView'), /view === 'x'[\s\S]*elements\.provider\.value = 'x'/)
  assert.match(panelSource, /elements\.updates\.scrollIntoView\?\.\(\{ block: 'start' \}\)/)
  assert.doesNotMatch(panelSource, /scrollToUpdates/)
  assert.match(markup, /id="day-filter" class="day-filter" hidden/)
  assert.match(markup, /id="day-filter-clear"[^>]*type="button"/)
})

test('overview navigation applies independent filter views and reports cleared filters only when needed', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const applySource = [
    'appliedFilterCount', 'clearUpdateFilters', 'applyOverviewView',
  ].map(panelFunctionSource).join('\n')
  const createHarness = (filters: Record<string, string | boolean | null> = {}) => {
    const state = { day: null as string | null, attentionOnly: false }
    const scrolls: unknown[] = []
    const statusCalls: unknown[][] = []
    const activations: Array<{ id: string; force: boolean; hasAfterRestore: boolean }> = []
    const elements = {
      search: { value: '' },
      provider: { value: '' },
      category: { value: '' },
      changeType: { value: '' },
      updates: { scrollIntoView: (options: unknown) => scrolls.push(options) },
    }
    if (typeof filters.search === 'string') elements.search.value = filters.search
    if (typeof filters.provider === 'string') elements.provider.value = filters.provider
    if (typeof filters.category === 'string') elements.category.value = filters.category
    if (typeof filters.changeType === 'string') elements.changeType.value = filters.changeType
    if (typeof filters.day === 'string') state.day = filters.day
    if (typeof filters.attentionOnly === 'boolean') state.attentionOnly = filters.attentionOnly
    const apply = runInNewContext(`(() => { ${applySource}\nreturn applyOverviewView })()`, {
      state,
      elements,
      setGlobalStatus: (...args: unknown[]) => statusCalls.push(args),
      activateTab: (id: string, options: { force: boolean; afterRestore?: () => void }) => {
        activations.push({ id, force: options.force, hasAfterRestore: typeof options.afterRestore === 'function' })
        options.afterRestore?.()
      },
    }) as (view: 'attention' | 'x' | 'all') => void
    return { state, elements, scrolls, statusCalls, activations, apply }
  }

  const attention = createHarness({
    search: '@ajambrosino', provider: 'x', day: '2026-11-04', category: 'feature', changeType: 'deprecated',
  })
  attention.apply('attention')
  assert.equal(attention.elements.search.value, '')
  assert.equal(attention.elements.provider.value, '')
  assert.equal(attention.elements.category.value, '')
  assert.equal(attention.elements.changeType.value, '')
  assert.equal(attention.state.day, null)
  assert.equal(attention.state.attentionOnly, true)
  assert.deepEqual(attention.statusCalls.map(call => call[0]), ['已清除先前的篩選'])
  assert.deepEqual(attention.activations, [{ id: 'updates', force: true, hasAfterRestore: false }])

  const x = createHarness({ search: 'Claude Code', provider: 'anthropic', day: '2026-11-04', category: 'feature', attentionOnly: true })
  x.apply('x')
  assert.equal(x.elements.search.value, '')
  assert.equal(x.elements.provider.value, 'x')
  assert.equal(x.elements.category.value, '')
  assert.equal(x.elements.changeType.value, '')
  assert.equal(x.state.day, null)
  assert.equal(x.state.attentionOnly, false)
  assert.equal(x.scrolls.length, 1)
  assert.equal((x.scrolls[0] as { block: string }).block, 'start')
  assert.deepEqual(x.statusCalls.map(call => call[0]), ['已清除先前的篩選'])
  assert.deepEqual(x.activations, [{ id: 'updates', force: true, hasAfterRestore: true }])

  for (const entryPoint of ['overviewCountButton', 'overviewAllUpdates']) {
    const all = createHarness({
      search: 'Tibo', provider: 'x', day: '2026-11-04', category: 'feature', changeType: 'added', attentionOnly: true,
    })
    all.apply('all')
    assert.equal(all.elements.search.value, '', `${entryPoint} clears search`)
    assert.equal(all.elements.provider.value, '', `${entryPoint} clears provider`)
    assert.equal(all.elements.category.value, '', `${entryPoint} clears category`)
    assert.equal(all.elements.changeType.value, '', `${entryPoint} clears change type`)
    assert.equal(all.state.day, null, `${entryPoint} clears day`)
    assert.equal(all.state.attentionOnly, false, `${entryPoint} clears attention-only`)
    assert.deepEqual(all.statusCalls.map(call => call[0]), ['已清除先前的篩選'])
  }

  const unfiltered = createHarness()
  unfiltered.apply('all')
  assert.equal(unfiltered.statusCalls.length, 0, 'an empty starting view does not show a cleared-filter message')

  assert.match(panelSource, /elements\.overviewCountButton\.addEventListener\('click', \(\) => applyOverviewView\('all'\)\)/)
  assert.match(panelSource, /elements\.overviewAttentionButton\.addEventListener\('click', \(\) => applyOverviewView\('attention'\)\)/)
  assert.match(panelSource, /elements\.overviewAllUpdates\.addEventListener\('click', \(\) => applyOverviewView\('all'\)\)/)
  assert.match(panelSource, /elements\.xSummary\.addEventListener\('click', \(\) => applyOverviewView\('x'\)\)/)
  assert.match(panelFunctionSource('renderOverviewAlerts'), /button\.addEventListener\('click', \(\) => \{\s*applyOverviewView\('attention'\)/)
  assert.doesNotMatch(panelFunctionSource('applyOverviewView'), /postMessage|storage\.get/)
  assert.match(panelFunctionSource('renderUpdatesTab'), /renderFilterControls\(\)[\s\S]*renderHeatmap\(\)[\s\S]*renderUpdates\(\)/)
})

test('overview highlight navigation keeps filters when they still show the target', () => {
  const state = { day: '2026-11-04', attentionOnly: true }
  const elements = {
    search: { value: 'target' },
    provider: { value: 'openai' },
    category: { value: 'feature' },
    changeType: { value: 'improved' },
  }
  const statusCalls: unknown[][] = []
  const source = [
    'clearUpdateFilters', 'goToOverviewHighlight',
  ].map(panelFunctionSource).join('\n')
  const navigate = runInNewContext(`(() => { ${source}\nreturn goToOverviewHighlight })()`, {
    state,
    elements,
    Date,
    matchesFilters: () => true,
    groupKey: () => null,
    byPosition: () => 0,
    setGlobalStatus: (...args: unknown[]) => statusCalls.push(args),
    activateTab: () => {},
  }) as (unit: unknown[]) => void
  navigate([{ id: 'target', position: 0 }])
  assert.equal(elements.search.value, 'target')
  assert.equal(elements.provider.value, 'openai')
  assert.equal(elements.category.value, 'feature')
  assert.equal(elements.changeType.value, 'improved')
  assert.equal(state.day, '2026-11-04')
  assert.equal(state.attentionOnly, true)
  assert.equal(statusCalls.length, 0)
})

test('Update Radar renders full @ajambrosino text and unified official disclosures', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const xPostRender = panelSource.slice(panelSource.indexOf('function renderXPost'), panelSource.indexOf('function renderXUpdate'))
  const officialRender = panelSource.slice(panelSource.indexOf('function renderOfficialUpdate'), panelSource.indexOf('function resetTypeLabel'))
  assert.match(xPostRender, /message-time/)
  assert.match(xPostRender, /message-source-label', '@ajambrosino'/)
  assert.match(xPostRender, /'貼文'/)
  assert.match(xPostRender, /'續文'/)
  assert.doesNotMatch(xPostRender, /change-label|category-label|attention-chip|appendQuickRead|appendExpandToggle/)
  assert.match(panelFunctionSource('renderOfficialUpdate'), /appendQuickRead\(disclosure\.region, update\)/)
  assert.match(panelFunctionSource('renderOfficialUpdate'), /official-full-text/)
  assert.match(officialRender, /official-record/)
  assert.match(officialRender, /update-card-meta/)
  assert.match(officialRender, /update-time/)
  assert.doesNotMatch(officialRender, /source-avatar|message-bubble|renderXPost/)
  assert.match(panelSource, /new ResizeObserver/)
  assert.match(panelSource, /window\.addEventListener\('resize'/)
  assert.match(officialRender, /buttonText: '展開'/)
  assert.doesNotMatch(panelSource, /appendExpandToggle|previewMeasurements|previewResizeObserver/)
  assert.match(officialRender, /officialHeadline\(update\)/)
  assert.match(styles, /\.message-preview \{[^}]*white-space: pre-wrap/)
  assert.match(styles, /\.update-card-title \{[^}]*-webkit-line-clamp: 2/)
  assert.match(styles, /\.official-preview \{[^}]*-webkit-line-clamp: 1/)
  assert.match(panelSource, /const attentionUnits = units\.filter\(unit => unitNeedsAttention\(unit, now\)\)/)
  assert.match(panelSource, /const attention = attentionUnits\.length/)
  assert.match(styles, /\.official-record \{[^}]*border: 1px solid var\(--radar-border-soft\);[^}]*border-radius: 8px/s)
  assert.doesNotMatch(styles, /\.official-record\.record-(?:openai|anthropic|claude-code)|border-left:\s*4px/)
  assert.match(styles, /\.update-thread \{[^}]*border: 1px solid var\(--radar-border-soft\)[^}]*border-radius: 8px/s)
  assert.match(styles, /\.thread-timeline \{[^}]*border-left: 1px solid var\(--radar-border-soft\)/)
  assert.match(styles, /\.thread-item \+ \.thread-item \{ border-top: 1px solid var\(--radar-border-soft\); \}/)
  assert.match(styles, /@media \(forced-colors: active\)/)
  assert.match(markup, /aria-label="更新摘要"/)
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

  assert.match(panelSource, /tabController\.renderCurrent\(\)/, 'startup renders only the default overview panel')
  assert.doesNotMatch(panelSource, /renderHeatmapSkeleton\(\)\s*renderUpdateListSkeleton\(\)/, 'inactive update content is deferred')
  assert.match(panelFunctionSource('renderSpotlight'), /renderSpotlightSkeleton\(target\)\s*return/)
  assert.match(panelFunctionSource('renderHeatmap'), /renderHeatmapSkeleton\(\)\s*return/)
  assert.match(panelFunctionSource('renderUpdates'), /renderUpdateListSkeleton\(\)\s*return/)
  assert.match(panelFunctionSource('renderSummaryLoading'), /setBusy\(elements\.summaryGrid, show \|\|/)
  assert.match(panelFunctionSource('renderSpotlight'), /setBusy\(target, false\)/)
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
  const source = ['updateDate', 'isXPost', 'attentionSignal', 'findThreadRootId', 'groupKey', 'byPosition', 'groupUpdates', 'updateUnits', 'isCriticalChange', 'unitNeedsAttention']
    .map(panelFunctionSource).join('\n')
  const panel = runInNewContext(`(() => { const ATTENTION_WINDOW_DAYS = 14; ${source}
return { groupUpdates, updateUnits, unitNeedsAttention } })()`) as any
  const change = (id: string, sourceId: string, extra: Record<string, unknown>) => ({ id, sourceId, provider: 'anthropic', changeType: 'fixed', title: id, summary: '', ...extra })
  const updates = [
    change('b', 'claude-code', { version: 'v2', position: 1 }),
    change('p2', 'anthropic-platform', { publishedAt: '2026-10-29', position: 1 }),
    change('o', 'openai-api', { changeType: 'added' }),
    change('a', 'claude-code', { version: 'v2', position: 0, changeType: 'removed', publishedAtTime: '2026-10-28T07:00:00.000Z' }),
    change('p1', 'anthropic-platform', { publishedAt: '2026-10-29', position: 0 }),
    change('p3', 'anthropic-platform', { publishedAt: '2026-10-28', position: 0 }),
    change('c', 'claude-code', { version: 'v1', position: 0 }),
  ]
  const groups = panel.groupUpdates(updates)
  assert.equal(JSON.stringify(groups.map((group: any) => [group.kind, group.updates.map((update: any) => update.id).join('')])),
    JSON.stringify([['changes', 'ab'], ['changes', 'p1p2'], ['single', 'o'], ['single', 'p3'], ['changes', 'c']]))
  const units = panel.updateUnits(updates)
  assert.equal(units.length, 5)
  assert.equal(JSON.stringify(units.map((unit: unknown) => panel.unitNeedsAttention(unit, FIXED_NOW))), '[true,false,false,false,false]')
})

test('Update Radar needs attention only within the 14-day publication or lifecycle window', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.match(panelSource, /const ATTENTION_WINDOW_DAYS = 14\s*\/\/[^\n]+/)
  const source = [
    'updateDate', 'isXPost', 'groupKey', 'isCriticalChange', 'attentionSignal', 'unitNeedsAttention',
  ].map(panelFunctionSource).join('\n')
  const unitNeedsAttention = runInNewContext(`(() => { const ATTENTION_WINDOW_DAYS = 14; ${source}\nreturn unitNeedsAttention })()`, { Date }) as (unit: unknown[], now: number) => boolean
  const now = Date.parse('2026-11-04T12:00:00.000Z')
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()
  const attentionUnit = (extra: Record<string, unknown> = {}) => [{
    id: 'deprecated-api',
    provider: 'openai',
    sourceId: 'openai-api',
    changeType: 'deprecated',
    publishedAtTime: daysAgo(3),
    ...extra,
  }]

  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: daysAgo(15) }), now), false, 'a 15-day-old deprecation has expired')
  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: daysAgo(3) }), now), true, 'a 3-day-old deprecation remains current')
  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: daysAgo(30), retirements: [{ date: '2026-11-14' }] }), now), true, 'a retirement in 10 days remains current')
  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: daysAgo(30), retirements: [{ date: '2026-10-15' }] }), now), false, 'a retirement date 20 days past does not extend attention')
  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: daysAgo(30), effectiveAt: '2026-11-04' }), now), true, 'an effective date today is included')
  assert.equal(unitNeedsAttention(attentionUnit({ provider: 'x', sourceId: 'x-ajambrosino', publishedAtTime: daysAgo(1), effectiveAt: '2026-11-05' }), now), false, '@ajambrosino posts never need attention')
  const invalidDateNow = Date.parse('2026-11-20T12:00:00.000Z')
  assert.equal(unitNeedsAttention(attentionUnit({ publishedAtTime: '2026-11-31', effectiveAt: '2026-11-31', retirements: [{ date: '2026-11-31' }] }), invalidDateNow), false, 'unparseable and normalized-invalid dates do not satisfy the time window')
})

test('grouped cards route large change sets to details and return focus to the details action', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(panelSource, /const CHANGE_INLINE_EXPAND_MAX = 20/)
  assert.match(panelFunctionSource('renderChangeGroup'), /matches\.length > CHANGE_INLINE_EXPAND_MAX/)
  assert.doesNotMatch(panelSource, /CHANGE_PREVIEW|previewChanges|change-preview/)
  assert.match(panelFunctionSource('renderChangeGroup'), /appendText\(actions, 'button', 'change-detail-open', `查看全部 \$\{matches\.length\} 項變更`\)/)
  assert.match(panelFunctionSource('renderChangeGroup'), /article\.append\(actions\)[\s\S]*return article/)
  assert.doesNotMatch(panelFunctionSource('renderChangeGroup').slice(0, panelFunctionSource('renderChangeGroup').indexOf('const disclosure')), /createDisclosure/)
  assert.match(panelFunctionSource('renderChangeGroup'), /appendChangeBrowser\(disclosure\.region, matches\)/)
  assert.match(panelSource, /button\.setAttribute\('aria-pressed', String\(button\.dataset\.type === selected\)\)/)
  assert.match(panelSource, /event\.key === 'Escape' && state\.detail/)
  assert.match(panelSource, /window\.scrollTo\(0, detail\.scrollY\)/)
  assert.match(panelFunctionSource('closeChangeDetail'), /const returnTarget = elements\.updates\.querySelector\(`\[data-detail-key="\$\{CSS\.escape\(detail\.key\)\}"\]`\)[\s\S]*returnTarget\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(markup, /id="change-detail" class="change-detail" hidden/)
  assert.match(markup, /id="change-detail-back"[^>]*type="button"/)
  assert.match(styles, /\.change-group-actions \{[^}]*flex-wrap: wrap/)
  assert.doesNotMatch(styles, /\.change-group-actions \.card-disclosure-button/)
  assert.match(styles, /\.change-group-actions \.change-detail-open \{[^}]*min-height: 36px[^}]*border-radius: var\(--radar-radius-pill\)/)

  class PanelMockElement {
    id = ''
    tagName = ''
    type = ''
    className = ''
    hidden = false
    dateTime = ''
    focused = false
    parent: PanelMockElement | null = null
    children: PanelMockElement[] = []
    attributes = new Map<string, string>()
    listeners = new Map<string, (...args: any[]) => void>()
    dataset: Record<string, string> = {}
    private ownText = ''
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join('') }
    set textContent(value: string) { this.replaceChildren(); this.ownText = String(value ?? '') }
    append(...children: PanelMockElement[]) {
      this.ownText = ''
      for (const child of children) {
        const oldIndex = child.parent?.children.indexOf(child) ?? -1
        if (oldIndex >= 0) child.parent!.children.splice(oldIndex, 1)
        child.parent = this
        this.children.push(child)
      }
    }
    replaceChildren(...children: PanelMockElement[]) {
      for (const child of this.children) child.parent = null
      this.children = []
      this.ownText = ''
      this.append(...children)
    }
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    getAttribute(name: string) { return this.attributes.get(name) ?? null }
    addEventListener(name: string, listener: (...args: any[]) => void) { this.listeners.set(name, listener) }
    focus() { this.focused = true }
    scrollIntoView(options: unknown) { (this as any).scrollOptions = options }
    querySelector(selector: string): PanelMockElement | null { return this.querySelectorAll(selector)[0] ?? null }
    querySelectorAll(selector: string): PanelMockElement[] {
      const attributeMatch = /^\[data-detail-key="([^"]+)"\]$/.exec(selector)
      const matches: PanelMockElement[] = []
      const queue = [...this.children]
      while (queue.length) {
        const node = queue.shift()!
        if (selector === '[role="region"]' && node.getAttribute('role') === 'region') matches.push(node)
        else if (selector === 'button[aria-expanded]' && node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null) matches.push(node)
        else if (selector === 'button' && node.tagName === 'BUTTON') matches.push(node)
        else if (selector.startsWith('.') && node.className.split(/\s+/u).includes(selector.slice(1))) matches.push(node)
        else if (attributeMatch && node.dataset.detailKey === attributeMatch[1]) matches.push(node)
        queue.push(...node.children)
      }
      return matches
    }
  }

  const context: Record<string, any> = {
    document: {
      createElement: (tagName: string) => Object.assign(new PanelMockElement(), { tagName: tagName.toUpperCase() }),
      createElementNS: (_namespace: string, tagName: string) => Object.assign(new PanelMockElement(), { tagName: tagName.toUpperCase() }),
    },
    state: { expanded: new Set<string>(['release:v2.1.316']), disclosures: new Map<string, boolean>(), activeTab: 'updates', detail: null },
    labels: { changeType: { added: '新增', improved: '改善', fixed: '修正', deprecated: '棄用', removed: '移除' } },
    CHANGE_INLINE_EXPAND_MAX: 20,
    CHANGE_SECTION_ORDER: ['added', 'improved', 'fixed', 'deprecated', 'removed'],
    byPosition: (a: any, b: any) => a.position - b.position,
    sourceLabel: () => 'Claude Code',
    unitNeedsAttention: () => false,
    formatUpdateTime: () => '現在',
    updateTimestamp: (update: any) => update.position,
    groupKey: (update: any) => `release:${update.version}`,
    changeGroupTitle: (update: any) => update.version,
    appendText: (parent: PanelMockElement, tagName: string, className: string, text: string) => {
      const node = new PanelMockElement()
      node.tagName = tagName.toUpperCase()
      node.className = className
      node.textContent = text
      parent.append(node)
      return node
    },
    createIcon: () => new PanelMockElement(),
    appendGroupedChange: (parent: PanelMockElement, update: any) => {
      const item = new PanelMockElement()
      item.tagName = 'LI'
      item.className = 'change-item'
      item.textContent = update.id
      parent.append(item)
    },
    appendSourceAction: (parent: PanelMockElement) => {
      const source = new PanelMockElement()
      source.className = 'source-button'
      source.textContent = '查看官方來源'
      parent.append(source)
    },
    openChangeDetail: (key: string) => { context.openedDetailKey = key },
  }
  context.appendChangeSections = runInNewContext(`(${panelFunctionSource('appendChangeSections')})`, context)
  context.appendChangeBrowser = runInNewContext(`(${panelFunctionSource('appendChangeBrowser')})`, context)
  context.createDisclosure = runInNewContext(`(${panelFunctionSource('createDisclosure')})`, context)
  const renderChangeGroup = runInNewContext(`(${panelFunctionSource('renderChangeGroup')})`, context) as
    (changes: any[], matches: any[], unitKey: string) => PanelMockElement
  const largeChanges = Array.from({ length: 21 }, (_, position) => ({
    id: `change-${position}`, sourceId: 'claude-code', version: 'v2.1.316', previousVersion: 'v2.1.315',
    changeType: 'added', position, publishedAt: '2026-11-04',
  }))
  const largeCard = renderChangeGroup(largeChanges, largeChanges, 'release:v2.1.316')
  const largeDetailButton = largeCard.querySelector('.change-detail-open')
  assert.equal(largeCard.querySelectorAll('button[aria-expanded]').length, 0, 'large cards have no disclosure button')
  assert.equal(largeCard.querySelectorAll('[role="region"]').length, 0, 'large cards have no disclosure region')
  assert.equal(largeCard.querySelectorAll('button').length, 1, 'the large card has only its details button')
  assert.equal(largeCard.querySelectorAll('.change-detail-open').length, 1, 'the card has exactly one details action')
  assert.equal(largeDetailButton?.textContent, '查看全部 21 項變更')
  assert.equal(largeCard.querySelectorAll('.change-preview').length, 0, 'large cards have no inline preview')
  assert.equal(largeCard.querySelectorAll('.source-button').length, 0, 'the source action remains on the details page')
  assert.ok(largeCard.children.indexOf(largeCard.querySelector('.change-counts')!) < largeCard.children.indexOf(largeDetailButton!.parent!), 'the details action follows the type counts')
  assert.equal(context.state.expanded.has('release:v2.1.316'), true, 'a stale expanded key is harmless and remains untouched')
  largeDetailButton?.listeners.get('click')?.()
  assert.equal(context.openedDetailKey, 'release:v2.1.316', 'the details action opens its matching detail page')

  const smallCard = renderChangeGroup(largeChanges.slice(0, 20), largeChanges.slice(0, 20), 'release:v2.1.315')
  const smallDisclosureButton = smallCard.querySelector('button[aria-expanded]')
  const smallRegion = smallCard.querySelector('[role="region"]')
  assert.equal(smallCard.querySelectorAll('button[aria-expanded]').length, 1, 'cards with 20 or fewer changes retain one disclosure button')
  assert.equal(smallDisclosureButton?.getAttribute('aria-expanded'), 'false', 'the small card starts collapsed')
  assert.equal(smallRegion?.hidden, true)
  assert.equal(smallCard.querySelectorAll('.change-detail-open').length, 0, 'cards with 20 or fewer changes have no details action')
  smallDisclosureButton?.listeners.get('click')?.()
  assert.equal(smallDisclosureButton?.getAttribute('aria-expanded'), 'true')
  assert.equal(smallRegion?.hidden, false)
  assert.equal(smallCard.querySelectorAll('.change-item').length, 20, 'expanding a small card shows the complete grouped list')

  const updates = new PanelMockElement()
  updates.append(largeCard)
  const detailView = new PanelMockElement()
  const tabList = new PanelMockElement()
  context.elements = {
    detailView,
    tabList,
    panels: { overview: new PanelMockElement(), updates: new PanelMockElement(), reset: new PanelMockElement() },
    updates,
  }
  context.tabController = { renderIfStale() {} }
  context.syncTabLifecycles = () => {}
  context.updateStickyMeasurements = () => {}
  context.CSS = { escape: (value: string) => value }
  context.window = { scrollTo() {} }
  context.state.detail = { key: 'release:v2.1.316', scrollY: 120 }
  const closeChangeDetail = runInNewContext(`(${panelFunctionSource('closeChangeDetail')})`, context) as () => void
  closeChangeDetail()
  assert.equal(largeDetailButton?.focused, true, 'return from the details page restores focus to the moved action button')
  assert.equal((largeDetailButton as any)?.scrollOptions?.block, 'nearest')
})

test('Update Radar uses its own palette in both themes and keeps hex colors in tokens only', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.doesNotMatch(styles, /var\(--organic-(?!font|space|radius)[a-z-]+/, 'colors must not come from the pet theme')
  assert.doesNotMatch(styles, /var\(--(?:surface|text|accent|state|border)-[a-z-]+/, 'colors must not come from the host dark theme')
  const dark = styles.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)?.[1] ?? ''
  const systemDark = styles.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/)?.[1] ?? ''
  const tokens = (block: string) => JSON.stringify(Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()]))
  assert.equal(tokens(dark), tokens(systemDark), 'manual dark and system dark use identical tokens')
  for (const token of ['--radar-bg', '--radar-surface', '--radar-text', '--radar-accent', '--provider-claude-code', '--provider-x', '--heat-level-4']) {
    assert.match(dark, new RegExp(`${token}:`), `dark theme defines ${token}`)
  }
  const outsideTokens = styles.split('\n').filter(line => /#[0-9a-f]{3,8}\b/i.test(line) && !/^\s*--[a-z0-9-]+:/.test(line))
  assert.deepEqual(outsideTokens, [])
})

test('Update Radar visual polish uses accessible SVG icons and preserves reset copy', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const iconHelper = panelFunctionSource('createIcon')
  assert.match(iconHelper, /document\.createElementNS\(SVG_NS, 'svg'\)/)
  assert.match(iconHelper, /document\.createElementNS\(SVG_NS, 'path'\)/)
  assert.match(iconHelper, /svg\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(iconHelper, /svg\.setAttribute\('focusable', 'false'\)/)
  assert.match(iconHelper, /path\.setAttribute\('d', pathData\)/)
  assert.doesNotMatch(iconHelper, /document\.createElement\(|innerHTML|insertAdjacentHTML|\beval\s*\(/)
  assert.match(panelSource, /const ICON_PATHS = Object\.freeze\(/)
  const iconPaths = panelSource.match(/const ICON_PATHS = Object\.freeze\(\{([\s\S]*?)\n\}\)/)?.[1] ?? ''
  for (const [, name] of iconPaths.matchAll(/^\s{2}([a-z][a-z-]*):/gm)) {
    if (name === 'external' || name === 'x') continue // These paths are selected together for update links.
    assert.match(panelSource, new RegExp(`createIcon\\('${name}'`), `ICON_PATHS entry ${name} is used`)
  }
  assert.match(panelSource, /createIcon\(isXPost\(update\) \? 'x' : 'external'\)/)
  assert.doesNotMatch(markup, /class="(?:eyebrow|intro)"|AI 公開更新/)
  assert.match(markup, /<header class="radar-header">/)
  assert.match(styles, /\.radar-header \{[^}]*height: 48px;[^}]*max-height: 48px/)
  assert.match(styles, /h1 \{[^}]*font-size: 16px;[^}]*font-weight: 600/)
  assert.match(markup, /<button id="refresh"[^>]*>[\s\S]*?<svg class="refresh-icon"[^>]*aria-hidden="true"[\s\S]*?<span>重新整理<\/span>/)
  assert.match(markup, /id="time-mode-label">相對時間<\/span>/)
  assert.match(panelSource, /elements\.timeModeLabel\.textContent = state\.absoluteTime \? '絕對時間' : '相對時間'/)
  assert.match(markup, /class="summary-card summary-info"/)
  assert.match(markup, /class="summary-card summary-attention"/)
  assert.match(markup, /class="summary-card summary-healthy"/)
  assert.match(styles, /\.summary-info \{ --summary-tone: var\(--radar-accent\); \}/)
  assert.match(styles, /\.summary-attention \{ --summary-tone: var\(--radar-warning\); \}/)
  assert.match(styles, /\.summary-healthy \{ --summary-tone: var\(--radar-success\); \}/)
  assert.doesNotMatch(markup, /summary-icon/)
  assert.doesNotMatch(styles, /\.summary-card[^}]*background:\s*color-mix|\.summary-icon/)
  assert.match(panelSource, /appendHighlightedNumbers\(countdown, countdownText\)/)
  assert.match(panelSource, /appendHighlightedNumbers\(countdown, formatTimeSinceReset\(reset\.stats\.lastResetAt\)\)/)
  assert.match(panelSource, /countdown\.setAttribute\('aria-label', `距預定重設時間 \$\{countdown\.textContent\}`\)/)
  const iconTags = markup.match(/<svg\b[^>]*>/g) ?? []
  assert.ok(iconTags.length >= 4, 'functional theme, refresh, and search icons remain')
  for (const iconTag of iconTags) {
    assert.match(iconTag, /aria-hidden="true"/)
    assert.match(iconTag, /focusable="false"/)
  }

  const appendHighlightedNumbers = runInNewContext(`(${panelFunctionSource('appendHighlightedNumbers')})`, {
    document: {
      createTextNode: (text: string) => ({ textContent: text, children: [] }),
      createElement: (tagName: string) => ({
        tagName, className: '', children: [], ownText: '',
        set textContent(value: string) { this.ownText = value },
        get textContent() { return this.ownText + this.children.map((node: any) => node.textContent).join('') },
        append(...nodes: any[]) { this.children.push(...nodes) },
      }),
    },
  }) as (parent: { append: (...nodes: Array<{ textContent: string, className?: string }>) => void }, value: string) => void
  const appended: Array<{ textContent: string, className?: string, children?: Array<{ textContent: string, className?: string }> }> = []
  const originalCopy = '距上次重設 27 小時'
  appendHighlightedNumbers({ append: (...nodes) => appended.push(...nodes) }, originalCopy)
  assert.equal(appended.map(node => node.textContent).join(''), originalCopy)
  assert.deepEqual(appended.flatMap(node => node.children ?? []).filter(node => node.className === 'codex-reset-number').map(node => node.textContent), ['27'])
  assert.deepEqual(appended.filter(node => node.className === 'codex-reset-value-group').map(node => node.textContent), ['27 小時'])
  assert.match(styles, /\.codex-reset-value-group \{ white-space: nowrap; \}/)
})

test('Update Radar Phase 5 applies the compact type, color, and surface rules', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.doesNotMatch(styles, /box-shadow|gradient\s*\(|backdrop-filter/i)
  assert.doesNotMatch(markup + styles, /eyebrow|class="intro"/)
  for (const [, rawSize] of styles.matchAll(/font-size\s*:\s*([^;]+);/g)) {
    const size = rawSize.trim().replace(/\s*!important$/, '')
    assert.ok(/^\d+(?:\.\d+)?px$/.test(size)
      ? ['12px', '13px', '14px', '16px', '24px'].includes(size)
      : /^var\(--radar-font-(?:small|body|heading)\)$/.test(size), `unsupported font size: ${rawSize}`)
  }
  for (const [, rawWeight] of styles.matchAll(/font-weight\s*:\s*([^;]+);/g)) {
    const weight = rawWeight.trim().replace(/\s*!important$/, '')
    assert.ok(['400', '500', '600'].includes(weight), `unsupported font weight: ${rawWeight}`)
  }
  assert.match(styles, /--radar-gap-1:\s*4px;[\s\S]*--radar-gap-2:\s*8px;[\s\S]*--radar-gap-3:\s*12px;[\s\S]*--radar-gap-4:\s*16px;/)
  assert.match(styles, /--radar-border-soft:\s*rgba\(/)
  assert.match(styles, /font-variant-numeric:\s*tabular-nums/)
  assert.match(styles, /\.radar-header \{[^}]*height: 48px;[^}]*max-height: 48px/)
  assert.match(styles, /h1 \{[^}]*font-size: 16px;[^}]*font-weight: 600/)
  assert.match(styles, /\.radar-tab \{[^}]*min-height: 40px/)
  assert.match(styles, /\.radar-tab\[aria-selected="true"\] \{[^}]*border-bottom-color: var\(--radar-accent\);[^}]*font-weight: 600/)
  assert.doesNotMatch(`${markup}${styles}${panelSource}`, /sidebarStickyTop|applySidebarLayout|--radar-sidebar-top|radar-sidebar/)

  const contrast = (foreground: string, background: string) => {
    const luminance = (hex: string) => {
      const channels = hex.match(/[\da-f]{2}/gi)!.map(value => parseInt(value, 16) / 255)
      const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const pair = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (pair[0] + 0.05) / (pair[1] + 0.05)
  }
  const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? ''
  const light = styles.match(/:root \{([^}]+)\}/)?.[1] ?? ''
  const dark = styles.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)?.[1] ?? ''
  for (const block of [light, dark]) {
    const muted = token(block, '--radar-muted') === 'var(--radar-secondary)' ? token(block, '--radar-secondary') : token(block, '--radar-muted')
    assert.ok(contrast(muted, token(block, '--radar-bg')) >= 4.5, 'muted text meets 4.5:1 contrast')
  }
})

test('Update Radar actions use the pill token while cards and row controls keep their existing radii', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /--radar-radius-pill:\s*999px;/)
  assert.match(styles, /^button \{[^}]*border-radius:\s*var\(--radar-radius-pill\);[^}]*padding:\s*0 var\(--radar-gap-3\);/m)
  assert.match(styles, /\.theme-toggle \{[^}]*border-radius:\s*50%;[^}]*\}/)
  assert.match(styles, /\.toolbar-main \.search-field input \{[^}]*border-radius:\s*var\(--radar-radius-pill\);/)
  assert.match(styles, /\.filter-toggle,\s*\.time-mode \{[^}]*min-height:\s*36px;[^}]*padding:\s*0 var\(--radar-gap-3\);[^}]*border-radius:\s*var\(--radar-radius-pill\);/)
  assert.match(styles, /\.overview-all-updates,\s*\.overview-retry \{[^}]*padding:\s*0 var\(--radar-gap-3\);[^}]*border-radius:\s*var\(--radar-radius-pill\);/)
  assert.match(styles, /\.attention-filter-chip \{[^}]*min-height:\s*36px;[^}]*padding:\s*0 var\(--radar-gap-3\);[^}]*border-radius:\s*var\(--radar-radius-pill\);/)
  assert.match(styles, /\.retry-button \{[^}]*min-height:\s*36px;[^}]*padding-inline:\s*var\(--radar-gap-3\);/)
  assert.match(styles, /\.message-meta \.source-button \{[^}]*min-height:\s*36px;[^}]*padding-inline:\s*var\(--radar-gap-3\);/)
  assert.match(styles, /\.type-chip \{[^}]*min-height:\s*36px;[^}]*padding:\s*0 var\(--radar-gap-3\);[^}]*border-radius:\s*var\(--radar-radius-pill\);/)
  assert.match(styles, /\.official-record \{[^}]*border-radius:\s*8px;/s)
  assert.match(styles, /\.summary-card \{[^}]*border-radius:\s*8px;/s)
  assert.match(styles, /\.update-type-chip \{[^}]*border-radius:\s*4px;/)
  assert.match(styles, /button:focus-visible,[\s\S]*?outline:\s*3px solid var\(--radar-accent\);\s*outline-offset:\s*2px;/)
  assert.match(styles, /@media \(forced-colors: active\)[\s\S]*?button, input, select,[\s\S]*?border-color:\s*CanvasText;/)
})

test('Phase 5a important update metadata has no decorative trailing separator', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const renderHighlights = panelFunctionSource('renderOverviewHighlights')
  assert.doesNotMatch(styles, /\.overview-highlight-source::after/)
  assert.match(renderHighlights, /appendText\(button, 'span', 'overview-highlight-source', sourceLabel\(first\)\)/)
})

test('Phase 5b summary statistics stay in one row and retain full labels', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  assert.match(styles, /\.summary-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(styles, /\.summary-card \{[^}]*flex-direction: column;[^}]*min-height: 56px/)
  assert.match(styles, /\.summary-copy strong \{[^}]*overflow: visible[^}]*white-space: nowrap/)
  assert.doesNotMatch(markup + styles, /summary-icon|grid-template-columns:\s*minmax\(0, 1fr\);[^}]*summary-grid/)
})

test('Phase 5c narrow update toolbar gives search a full row within the sticky height budget', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?grid-template-areas: "search search" "filter time"/)
  assert.match(styles, /\.toolbar-main \.search-field \{ grid-area: search; width: 100%; \}/)
  assert.match(styles, /\.filter-toggle \{ grid-area: filter;/)
  assert.match(styles, /\.time-mode \{ grid-area: time;/)
  const tabDeclarations = styles.match(/\.radar-tabs \{([^}]*)\}/)?.[1] ?? ''
  const toolbarDeclarations = styles.match(/\.toolbar \{([^}]*)\}/)?.[1] ?? ''
  const inputDeclarations = styles.match(/\.toolbar input,\s*\.toolbar select \{([^}]*)\}/)?.[1] ?? ''
  const controlsDeclarations = styles.match(/\.filter-toggle,\s*\.time-mode \{([^}]*)\}/)?.[1] ?? ''
  const mobileRowGap = styles.match(/@media \(max-width: 390px\)[\s\S]*?\.toolbar-main\s*\{[^}]*gap:\s*(\d+)px/)
  const gapToken = Number(styles.match(/--radar-gap-2:\s*(\d+)px/)?.[1] ?? 0)
  const tabHeight = Number(tabDeclarations.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)
  const toolbarPadding = toolbarDeclarations.includes('padding: var(--radar-gap-2)') ? gapToken : 0
  const toolbarBorder = Number(toolbarDeclarations.match(/border:\s*(\d+)px/)?.[1] ?? 0)
  const searchHeight = Number(inputDeclarations.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)
  const controlsHeight = Number(controlsDeclarations.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)
  const rowGap = Number(mobileRowGap?.[1] ?? 0)
  const stickyHeightAt278px = tabHeight + (toolbarPadding * 2) + (toolbarBorder * 2) + searchHeight + rowGap + controlsHeight
  assert.ok(stickyHeightAt278px <= 140, `tablist and toolbar total ${stickyHeightAt278px}px`)
})

test('Phase 5d Codex countdown keeps each number with its Chinese unit', () => {
  class TextNode {
    className = ''
    children: TextNode[] = []
    private ownText = ''
    constructor(text = '') { this.ownText = text }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join('') }
    set textContent(value: string) { this.ownText = value; this.children = [] }
    append(...nodes: TextNode[]) { this.children.push(...nodes) }
  }
  const appendHighlightedNumbers = runInNewContext(`(${panelFunctionSource('appendHighlightedNumbers')})`, {
    document: { createTextNode: (text: string) => new TextNode(text), createElement: () => new TextNode() },
  }) as (parent: TextNode, value: string) => void
  const countdown = new TextNode()
  appendHighlightedNumbers(countdown, '8 小時 2 天')
  assert.equal(countdown.textContent, '8 小時 2 天')
  assert.deepEqual(countdown.children.filter(child => child.className === 'codex-reset-value-group').map(child => child.textContent), ['8 小時', '2 天'])
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /\.codex-reset-value-group \{ white-space: nowrap; \}/)
})

test('Codex data source and retry stay on one final row', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const sourceLine = panelFunctionSource('appendCodexSourceLine')
  assert.match(sourceLine, /資料來源：/)
  assert.match(sourceLine, /appendText\(row, 'a', 'codex-source-link', 'codex-resets\.com'\)/)
  assert.match(sourceLine, /createSourceRetryButton\(row, source\)/)
  assert.match(sourceLine, /codex-reset-source-error/)
  assert.match(panelFunctionSource('createSourceRetryButton'), /立即重試/)
  assert.match(styles, /\.codex-reset-source-line[^}]*font-size: 12px/)
  assert.doesNotMatch(panelSource, /appendCodexSourceDisclosure|appendCodexSourceAttribution|resetSources/)
})

test('Phase 5f global retry status separates English names from Chinese text', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.match(panelFunctionSource('createSourceRetryButton'), /正在重新同步 \$\{source\.label/)
  assert.doesNotMatch(panelSource, /正在重新同步(?:Codex|Anthropic|OpenAI|來源)/)
})

test('panel theme keeps light or dark, otherwise follows the system, and applies data-theme', () => {
  const source = ['normalizePanelTheme', 'effectivePanelTheme', 'applyPanelTheme'].map(panelFunctionSource).join('\n')
  const theme = runInNewContext(`(() => { ${source}; return { normalizePanelTheme, effectivePanelTheme, applyPanelTheme } })()`) as any
  for (const value of ['light', 'dark']) assert.equal(theme.normalizePanelTheme(value), value)
  for (const value of [undefined, 'system', 'blue', 42]) assert.equal(theme.normalizePanelTheme(value), 'system')
  assert.equal(theme.effectivePanelTheme('system', true), 'dark')
  assert.equal(theme.effectivePanelTheme('system', false), 'light')
  assert.equal(theme.effectivePanelTheme('light', true), 'light')
  const root = { attrs: new Map<string, string>(), style: { colorScheme: '' },
    setAttribute(name: string, value: string) { this.attrs.set(name, value) }, removeAttribute(name: string) { this.attrs.delete(name) } }
  theme.applyPanelTheme('dark', root)
  assert.equal(root.attrs.get('data-theme'), 'dark'); assert.equal(root.style.colorScheme, 'dark')
  theme.applyPanelTheme('system', root)
  assert.equal(root.attrs.has('data-theme'), false); assert.equal(root.style.colorScheme, 'light dark')
})

test('appearance is a single toggle button that names the mode it switches to', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(markup, /<button id="theme-toggle" class="theme-toggle" type="button" data-mode="light" aria-label="切換為深色" title="切換為深色">/)
  assert.doesNotMatch(markup, /role="radiogroup"|appearance-option/)
  assert.match(markup, /class="icon-moon"[^>]*aria-hidden="true"/)
  assert.match(markup, /class="icon-sun"[^>]*aria-hidden="true"/)
  // 圖示表示按下後的模式：淺色顯示月亮、深色顯示太陽。
  assert.match(styles, /\.theme-toggle\[data-mode="dark"\] \.icon-sun \{ display: block; \}/)
  assert.match(panelSource, /const label = shown === 'dark' \? '切換為淺色' : '切換為深色'/)
  assert.match(panelSource, /selectPanelTheme\(elements\.themeToggle\.dataset\.mode === 'dark' \? 'light' : 'dark'\)/)
  assert.doesNotMatch(panelSource, /await api\.storage\.get\('panel-theme'\)/, 'theme read must not block panel startup')
})

test('Update Radar WAI-ARIA tabs have matching panels and default to overview', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  assert.equal((markup.match(/role="tablist"/g) ?? []).length, 1)
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 3)
  assert.equal((markup.match(/role="tabpanel"/g) ?? []).length, 3)

  const tabs = [...markup.matchAll(/<button\b(?=[^>]*role="tab")[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
  const panels = [...markup.matchAll(/<section\b(?=[^>]*role="tabpanel")[^>]*>/g)].map(match => match[0])
  const attribute = (element: string, name: string) => element.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  assert.deepEqual(tabs.map(tab => attribute(tab, 'id')), ['tab-overview', 'tab-updates', 'tab-reset'])
  assert.deepEqual(panels.map(panel => attribute(panel, 'id')), ['panel-overview', 'panel-updates', 'panel-reset'])
  for (let index = 0; index < tabs.length; index += 1) {
    assert.equal(attribute(tabs[index], 'aria-controls'), attribute(panels[index], 'id'))
    assert.equal(attribute(panels[index], 'aria-labelledby'), attribute(tabs[index], 'id'))
    assert.equal(attribute(panels[index], 'tabindex'), '0')
  }
  assert.equal(attribute(tabs[0], 'aria-selected'), 'true')
  assert.equal(attribute(tabs[0], 'tabindex'), '0')
  assert.match(tabs[0], />總覽<\/button>/)
  for (const tab of tabs.slice(1)) {
    assert.equal(attribute(tab, 'aria-selected'), 'false')
    assert.equal(attribute(tab, 'tabindex'), '-1')
  }
  assert.doesNotMatch(panels[0], /\shidden(?:\s|>)/)
  assert.match(panels[1], /\shidden(?:\s|>)/)
  assert.match(panels[2], /\shidden(?:\s|>)/)
  assert.match(markup, /role="tablist" aria-label="更新雷達功能"/)
})

test('Update Radar tab controller defers stale panels and never reads storage or posts while switching', async () => {
  const createTabController = runInNewContext(`(${panelFunctionSource('createTabController')})`) as (options: Record<string, unknown>) => any
  const state = {
    radar: null as unknown,
    dataVersion: 0,
    activeTab: 'overview',
    tabRenderedVersion: { overview: -1, updates: -1, reset: -1 },
    tabScrollY: { overview: null as number | null, updates: null as number | null, reset: null as number | null },
    detail: null,
  }
  const renders = { overview: 0, updates: 0, reset: 0 }
  const scheduled: Array<() => void> = []
  let scrollY = 48
  const apiCalls = { storageGet: 0, postMessage: 0 }
  const api = {
    storage: { async get() { apiCalls.storageGet += 1; return { found: false } } },
    ui: { async postMessage() { apiCalls.postMessage += 1; return { delivered: true } } },
  }
  await api.storage.get()
  await api.storage.get()
  await api.ui.postMessage()
  const callsAtStartup = { ...apiCalls }
  const controller = createTabController({
    state,
    renderers: {
      overview: () => { renders.overview += 1 },
      updates: () => { renders.updates += 1 },
      reset: () => { renders.reset += 1 },
    },
    now: () => scrollY,
    schedule: (callback: () => void) => scheduled.push(callback),
    restoreScroll: (next: number) => { scrollY = next },
  })
  controller.renderCurrent()
  const switchTo = (id: string) => {
    controller.activateTab(id)
    scheduled.shift()?.()
  }
  scrollY = 120
  switchTo('updates')
  assert.equal(state.tabScrollY.overview, 120, 'leaving a tab saves the current document scroll position')
  assert.equal(scrollY, 0, 'a tab without a saved position starts at the top')
  scrollY = 240
  switchTo('overview')
  assert.equal(scrollY, 120, 'returning to a visited tab restores its saved position')
  for (const id of ['updates', 'reset', 'overview', 'updates', 'reset', 'overview', 'updates', 'reset', 'overview', 'updates']) switchTo(id)
  assert.deepEqual(apiCalls, callsAtStartup, 'tab switches make no API calls')

  switchTo('overview')
  const updatesBeforeState = renders.updates
  controller.receiveState({ updates: [{ id: 'fresh' }], sources: [] })
  assert.equal(state.dataVersion, 1)
  assert.deepEqual(state.radar, { updates: [{ id: 'fresh' }], sources: [] })
  assert.equal(renders.updates, updatesBeforeState, 'a background update leaves the inactive updates panel untouched')
  switchTo('updates')
  assert.equal(renders.updates, updatesBeforeState + 1, 'the stale panel renders exactly once when activated')
  switchTo('reset')
  const rendered = { ...renders }
  for (const id of ['reset', 'overview', 'updates', 'reset', 'overview', 'updates']) switchTo(id)
  assert.deepEqual(renders, rendered, 'switching without new data does not call any renderer')
  assert.deepEqual(apiCalls, callsAtStartup)
})

test('Update Radar overview highlights sort attention, near retirements, time, and position', () => {
  const source = [
    'updateDate', 'updateTimestamp', 'isXPost', 'groupKey', 'isCriticalChange', 'attentionSignal',
    'unitNeedsAttention', 'overviewHighlights',
  ].map(panelFunctionSource).join('\n')
  const overviewHighlights = runInNewContext(`(() => { const ATTENTION_WINDOW_DAYS = 14; ${source}\nreturn overviewHighlights })()`, { Date, Math, Number }) as (units: unknown[][], now: number, limit?: number) => unknown[][]
  const now = Date.parse('2026-11-04T12:00:00.000Z')
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10)
  const unit = (id: string, options: Record<string, unknown> = {}) => [{
    id,
    provider: 'openai',
    sourceId: 'openai-api',
    changeType: 'improved',
    publishedAtTime: '2026-10-20T00:00:00.000Z',
    position: 10,
    ...options,
  }]
  const attentionPositionLate = unit('attention-position-8', { changeType: 'removed', publishedAtTime: '2026-10-30T00:00:00.000Z', position: 8 })
  const attentionPositionFirst = unit('attention-position-3', { changeType: 'deprecated', publishedAtTime: '2026-10-30T00:00:00.000Z', position: 3 })
  const attentionOlder = unit('attention-old', { changeType: 'removed', publishedAtTime: '2026-10-29T00:00:00.000Z', position: 1 })
  const retirementSoon = unit('retirement-soon', { publishedAtTime: '2026-10-01T00:00:00.000Z', position: 7, retirements: [{ date: at(10) }] })
  const fresh = unit('fresh', { publishedAtTime: '2026-11-03T00:00:00.000Z', position: 0 })
  const retirementFar = unit('retirement-far', { publishedAtTime: '2026-10-29T00:00:00.000Z', position: 2, retirements: [{ date: at(31) }] })
  const xPostUnit = unit('x-post', { provider: 'x', sourceId: 'x-ajambrosino', publishedAtTime: '2026-11-04T11:00:00.000Z' })
  const units = [fresh, xPostUnit, retirementFar, attentionPositionLate, retirementSoon, attentionOlder, attentionPositionFirst]

  const ordered = overviewHighlights(units, now, 10).map(entries => entries[0].id)
  assert.deepEqual(ordered, [
    'attention-position-3', 'attention-position-8', 'attention-old', 'retirement-soon', 'fresh', 'retirement-far',
  ])
  assert.deepEqual(overviewHighlights(units, now).map(entries => entries[0].id), ['attention-position-3', 'attention-position-8', 'attention-old'])
  assert.deepEqual(overviewHighlights(units, now, 2).map(entries => entries[0].id), ['attention-position-3', 'attention-position-8'])
  assert.deepEqual(overviewHighlights([], now), [])
})

test('overview ranking and attention-only filtering share the same current-card decision', () => {
  const source = [
    'updateDate', 'updateTimestamp', 'isXPost', 'groupKey', 'isCriticalChange', 'attentionSignal',
    'unitNeedsAttention', 'overviewHighlights',
  ].map(panelFunctionSource).join('\n')
  const helpers = runInNewContext(`(() => { const ATTENTION_WINDOW_DAYS = 14; ${source}\nreturn { unitNeedsAttention, overviewHighlights } })()`, { Date, Math, Number }) as {
    unitNeedsAttention: (unit: unknown[], now: number) => boolean,
    overviewHighlights: (units: unknown[][], now: number, limit: number) => unknown[][],
  }
  const now = Date.parse('2026-11-04T12:00:00.000Z')
  const update = (id: string, daysAgo: number, changeType: string, position: number) => ({
    id,
    provider: 'openai',
    sourceId: 'openai-api',
    changeType,
    publishedAtTime: new Date(now - daysAgo * 86_400_000).toISOString(),
    position,
  })
  const oldAttention = [update('old-attention', 15, 'deprecated', 0)]
  const freshAttention = [update('fresh-attention', 3, 'deprecated', 50)]
  const recentNormal = [update('recent-normal', 1, 'improved', 99)]
  const units = [oldAttention, freshAttention, recentNormal]
  assert.deepEqual(helpers.overviewHighlights(units, now, 3).map(unit => unit[0].id), [
    'fresh-attention', 'recent-normal', 'old-attention',
  ])

  const matchesFilters = runInNewContext(`(${panelFunctionSource('matchesFilters')})`, {
    state: { day: null, attentionOnly: true },
    elements: {
      provider: { value: '' }, category: { value: '' }, changeType: { value: '' }, search: { value: '' },
    },
    isXPost: (item: any) => item.provider === 'x',
    heatDateKey: () => '',
    unitNeedsAttention: helpers.unitNeedsAttention,
  }) as (item: unknown, unit: unknown[], now: number) => boolean
  assert.equal(matchesFilters(oldAttention[0], oldAttention, now), false, 'an expired card is hidden by attention-only')
  assert.equal(matchesFilters(freshAttention[0], freshAttention, now), true, 'a current card remains visible by attention-only')
})

test('Update Radar attention-only is a counted, clearable card-level filter', () => {
  const context = {
    state: { day: null as string | null, attentionOnly: true },
    elements: {
      search: { value: '' }, provider: { value: '' }, category: { value: '' }, changeType: { value: '' },
    },
  }
  const appliedFilterCount = runInNewContext(`(${panelFunctionSource('appliedFilterCount')})`, context) as () => number
  assert.equal(appliedFilterCount(), 1)
  const clearUpdateFilters = runInNewContext(`(${panelFunctionSource('clearUpdateFilters')})`, context) as () => void
  clearUpdateFilters()
  assert.equal(context.state.attentionOnly, false)
  assert.equal(appliedFilterCount(), 0)

  const matchesFilters = runInNewContext(`(${panelFunctionSource('matchesFilters')})`, {
    state: { day: null, attentionOnly: true },
    elements: {
      provider: { value: '' }, category: { value: '' }, changeType: { value: '' }, search: { value: '' },
    },
    isXPost: (update: any) => update.provider === 'x',
    heatDateKey: () => '',
    unitNeedsAttention: (unit: any[]) => unit.some(update => ['removed', 'deprecated'].includes(update.changeType)),
  }) as (update: unknown, unit: unknown[]) => boolean
  const grouped = [{ id: 'release-added', changeType: 'added' }, { id: 'release-removed', changeType: 'removed' }]
  assert.equal(matchesFilters(grouped[0], grouped), true, 'a qualifying grouped card remains visible as one unit')
  assert.equal(matchesFilters(grouped[0], [grouped[0]]), false, 'a non-attention card is excluded')
})

test('Update Radar overview contains only the summary and source disclosure surface', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const overviewStart = markup.indexOf('<section id="panel-overview"')
  const updatesStart = markup.indexOf('<section id="panel-updates"')
  assert.ok(overviewStart >= 0 && updatesStart > overviewStart)
  const overview = markup.slice(overviewStart, updatesStart)
  assert.doesNotMatch(overview, /id="updates"|id="heatmap"|codex-reset-facts/)
  assert.match(overview, /id="overview-alerts"[^>]*aria-label="更新警示"/)
  assert.match(overview, /id="overview-count-button"[^>]*type="button"/)
  assert.match(overview, /id="overview-attention-button"[^>]*type="button"/)
  assert.match(overview, /id="overview-sources-button"[^>]*type="button"/)
  assert.match(overview, /id="codex-overview-status"[^>]*type="button"/)
  assert.match(overview, /id="overview-highlights-list"/)
  assert.match(markup, /id="attention-only" type="checkbox"/)
  assert.match(markup, /id="active-filter-chips"/)
})

test('Update Radar desktop summary numbers and labels remain untruncated', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /\.summary-copy strong\s*\{[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap/s)
  assert.match(styles, /\.summary-copy > span\s*\{[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap/s)
  assert.match(styles, /\.summary-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(styles, /\.summary-card \{[^}]*min-height: 56px/)
  assert.doesNotMatch(styles, /@media[^{}]*\{[^}]*\.summary-grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  assert.doesNotMatch(styles, /\.summary-icon/)
})

test('Update Radar disclosure chevron is SVG only and legacy details rules are removed', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.match(panelSource, /createIcon\('chevron', 'disclosure-chevron'\)/)
  assert.match(styles, /\.disclosure-button\[aria-expanded="true"\] \.disclosure-chevron\s*\{\s*transform:\s*rotate\(180deg\);\s*\}/)
  assert.doesNotMatch(styles, /\.disclosure-chevron\s*\{[^}]*border-(?:right|bottom)/s)
  assert.doesNotMatch(styles, /\.status-summary|\.status-panel\[open\].*disclosure-chevron|::-webkit-details-marker/)
  assert.match(styles, /\.disclosure-button \.disclosure-chevron\s*\{[^}]*transition:\s*transform\s+0\.15s\s+ease/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition:\s*none !important;/)
})

test('Update Radar compact overview highlights put metadata and title on separate lines', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const compactOverview = styles.match(/@media \(max-width: 430px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(compactOverview, /\.overview-highlight-row\s*\{[^}]*grid-template-areas:[\s\S]*?"source right"\s*"title title"/)
  assert.doesNotMatch(styles, /\.overview-highlight-source::after/)
  assert.match(styles, /\.overview-highlight-version\s*\{[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap/)
  assert.match(panelSource, /appendText\(right, 'time', 'overview-highlight-time'/)
})

test('Update Radar disclosure keeps aria state, region links, and native button activation in sync', () => {
  class DisclosureElement {
    id = ''
    type = ''
    className = ''
    textContent = ''
    hidden = false
    children: DisclosureElement[] = []
    attributes = new Map<string, string>()
    listeners = new Map<string, () => void>()
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    getAttribute(name: string) { return this.attributes.get(name) ?? null }
    append(...children: DisclosureElement[]) { this.children.push(...children) }
    prepend(child: DisclosureElement) { this.children.unshift(child) }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener) }
  }
  const context: Record<string, any> = {
    document: { createElement: () => new DisclosureElement() },
    state: { disclosures: new Map<string, boolean>(), expanded: new Set<string>() },
    createIcon: (_name: string, className: string) => {
      const icon = new DisclosureElement()
      icon.className = className
      return icon
    },
  }
  context.appendText = runInNewContext(`(${panelFunctionSource('appendText')})`, context)
  const createDisclosure = runInNewContext(`(${panelFunctionSource('createDisclosure')})`, context) as (options: Record<string, unknown>) => any
  const disclosure = createDisclosure({ id: 'source-status', title: '來源狀態', meta: '2 個失敗', tone: 'danger' })
  const { button, region } = disclosure
  assert.equal(button.type, 'button', 'native button Enter/Space activation is retained')
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.equal(region.hidden, true)
  assert.equal(button.getAttribute('aria-controls'), region.id)
  assert.equal(region.getAttribute('aria-labelledby'), button.id)
  assert.equal(button.children[1].className, 'disclosure-meta disclosure-meta-danger')
  assert.equal(region.children.includes(button.children[1]), false, 'collapsed failure meta remains outside the region')
  button.listeners.get('click')?.()
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(region.hidden, false)
  assert.equal(context.state.disclosures.get('source-status'), true)
  button.listeners.get('click')?.()
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.equal(region.hidden, true)
  assert.equal(context.state.disclosures.get('source-status'), false)
  assert.match(panelFunctionSource('createDisclosure'), /button\.type = 'button'/)

  const unitKey = 'release:v2.1.316'
  const cardDisclosure = createDisclosure({
    id: 'update-release-v2-1-316', title: '更新內容', meta: '', buttonText: '展開', expandedText: '收合',
    open: context.state.expanded.has(unitKey), onToggle: (expanded: boolean) => {
      if (expanded) context.state.expanded.add(unitKey)
      else context.state.expanded.delete(unitKey)
    },
  })
  cardDisclosure.button.listeners.get('click')?.()
  assert.equal(context.state.expanded.has(unitKey), true, 'card expansion is stored under its stable unitKey')
  const redrawnCardDisclosure = createDisclosure({
    id: 'update-release-v2-1-316', title: '更新內容', meta: '', buttonText: '展開', expandedText: '收合',
    open: context.state.expanded.has(unitKey), onToggle: (expanded: boolean) => {
      if (expanded) context.state.expanded.add(unitKey)
      else context.state.expanded.delete(unitKey)
    },
  })
  assert.equal(redrawnCardDisclosure.button.getAttribute('aria-expanded'), 'true', 'a redraw restores the expanded state')
  assert.equal(redrawnCardDisclosure.region.hidden, false)

  const renderOverview = panelFunctionSource('renderOverview')
  assert.match(renderOverview, /failedCount\s*\?\s*`\$\{failedCount\} 個失敗/u)
  assert.ok(renderOverview.indexOf("disclosure.root.querySelector('.disclosure-meta')") < renderOverview.indexOf("appendText(disclosure.region, 'p'"))
})

test('Codex reset page shows reset facts and a single data source line', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const spotlight = panelFunctionSource('renderSpotlight')
  const sourceLine = panelFunctionSource('appendCodexSourceLine')
  assert.match(markup, /id="reset-spotlight-heading"[^>]*>Codex 重設/)
  assert.match(spotlight, /formatTimeSinceReset\(reset\.stats\.lastResetAt\)/)
  assert.match(spotlight, /formatScheduledCountdown\(scheduledAt\)/)
  assert.match(panelFunctionSource('formatScheduledCountdown'), /預定時間已到，等待狀態更新/)
  assert.ok(spotlight.includes("['上次重設時間', formatAbsoluteResetTime(reset.stats.lastResetAt)]"))
  assert.ok(spotlight.includes("['重設類型', latestReset?.resetType"))
  assert.ok(spotlight.includes("['累計次數', `${reset.stats.total} 次`]"))
  assert.match(spotlight, /factRows\.push\(\['預定時間'/)
  assert.match(sourceLine, /資料來源：/)
  assert.match(sourceLine, /codex-resets.com/)
  assert.match(sourceLine, /createSourceRetryButton\(row, source\)/)
  assert.match(sourceLine, /讀取失敗/)
  assert.match(panelFunctionSource('createSourceRetryButton'), /dispatchSyncRequest\([\s\S]*?type: 'radar:retry-source'/)
  assert.match(panelFunctionSource('renderSources'), /createSourceRetryButton\(actions, source\)/)
  assert.match(spotlight, /讀取失敗，顯示上次的資料。/)
  assert.match(spotlight, /無法讀取 Codex 重設資料，請稍後再試。/)
  assert.ok(panelFunctionSource('renderSpotlightSkeleton').includes("for (const width of ['78%', '54%', '36%'])"))
  assert.doesNotMatch(spotlight, /最新狀態|已排定重設|公告|renderXPost|findResetPost|disclosure/)
  assert.doesNotMatch(panelSource, /findResetPost|renderCodexResetPost|appendCodexSourceDisclosure|查看 Codex 重設|message-reset-action/)
  assert.doesNotMatch(styles, /spotlight-flag|codex-reset-post|codex-reset-disclosure|message-reset-action/)
  assert.match(styles, /.codex-reset-source-line[^}]*font-size: 12px/)
  assert.match(styles, /\.codex-reset-source-error[^}]*color: var\(--radar-danger\)/)
})

test('Codex summary and @ajambrosino today are independent overview rows', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const overviewStart = markup.indexOf('<section id="panel-overview"')
  const updatesStart = markup.indexOf('<section id="panel-updates"')
  const overview = markup.slice(overviewStart, updatesStart)
  const codexIndex = overview.indexOf('id="codex-overview-status"')
  const highlightsIndex = overview.indexOf('class="overview-highlights"')
  const xSummaryIndex = overview.indexOf('class="x-summary-section"')
  assert.ok(codexIndex >= 0 && highlightsIndex > codexIndex && xSummaryIndex > highlightsIndex)
  assert.match(overview, /aria-label="@ajambrosino 今日"/)
  assert.match(overview, /id="x-summary-text">今天 @ajambrosino 尚無新貼文/)
  assert.doesNotMatch(overview, /overview-codex-group|Codex 重設 · @ajambrosino/)
  assert.match(panelFunctionSource('renderOverviewCodexStatus'), /Codex 重設 · \$\{distance\} · 共 \$\{reset\.stats\?\.total \?\? 0\} 次/)
  assert.match(panelFunctionSource('renderOverview'), /todayXPosts = updates\.filter\(update => isXPost\(update\) && heatDateKey\(update\) === todayKey\)/)
  assert.doesNotMatch(panelFunctionSource('renderOverview'), /findResetPost|resetPostIsToday|Codex 重設.*@ajambrosino/)
  assert.match(panelFunctionSource('renderOverviewCodexStatus'), /Codex 重設 ·/)
  assert.doesNotMatch(panelFunctionSource('renderXPost'), /Codex 重設|resetType|查看 Codex 重設/)
  assert.match(styles, /grid-template-areas: "alerts" "summary" "codex" "highlights" "x-summary" "sources"/)
  assert.match(styles, /.overview-grid > #codex-overview-status { grid-area: codex; }/)
  assert.match(styles, /.overview-grid > .x-summary-section { grid-area: x-summary; }/)
})

test('Codex reset source validation drops invalid source URLs without losing reset facts', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const reset = parseCodexResetsStatus(codexResetPayload({ sourceUrl: 'https://x.com/thsottiaux/status/2115330127886463244' }), FIXED_NOW)
  assert.ok(reset)
  assert.equal(reset?.latestReset.sourceUrl, undefined)
  const accepted = parseCodexResetsStatus(codexResetPayload({ sourceUrl: 'https://x.com/ajambrosino/status/2115330127886463244' }), FIXED_NOW)
  assert.equal(accepted?.latestReset.sourceUrl, 'https://x.com/ajambrosino/status/2115330127886463244')
  assert.ok(panelSource.includes('function safeSourceUrl(value)'))
  assert.match(panelFunctionSource('safeSourceUrl'), /X_PROFILE_USERNAME/)
  assert.doesNotMatch(panelSource, /safeSourceUrl\(latestReset\?\.sourceUrl\)/)
})

test('Update Radar Phase 3 cards use one disclosure and retain accessible unit identity', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const cardFunctions = ['renderOfficialUpdate', 'renderChangeGroup', 'renderRetirement', 'renderThread']
  for (const name of cardFunctions) {
    const source = panelFunctionSource(name)
    assert.ok((source.match(/createDisclosure\(/g) ?? []).length <= 1, `${name} adds at most one disclosure`)
    assert.doesNotMatch(source, /article\.addEventListener\('click'/, `${name} leaves card background non-clickable`)
    if (source.includes('article.append(flags)')) {
      assert.ok(source.indexOf('article.append(flags)') < source.indexOf('article.append(disclosure.root)'), `${name} keeps warning metadata outside the region`)
    }
    if (source.includes('update-attention')) {
      assert.ok(source.indexOf('update-attention') < source.indexOf('createDisclosure('), `${name} keeps attention markers outside the region`)
    }
  }
  assert.match(panelSource, /card\.dataset\.unitKey = unitKey/)
  assert.match(panelSource, /button\.setAttribute\('aria-controls', `\$\{id\}-region`\)/)
  assert.match(panelSource, /region\.id = `\$\{id\}-region`/)
  assert.match(panelSource, /region\.setAttribute\('aria-labelledby', button\.id\)/)
  assert.doesNotMatch(panelSource, /document\.createElement\(['"]details['"]\)|document\.createElement\(['"]summary['"]\)/)
  assert.doesNotMatch(styles, /\.update-details|\.details-content|::-webkit-details-marker|(?:^|,\s*)summary:focus-visible/m)
  assert.doesNotMatch(panelFunctionSource('renderXUpdate'), /createDisclosure\(/, 'a standalone @ajambrosino post is shown without a disclosure')
  assert.match(panelFunctionSource('renderThread'), /buttonText: `\$\{replies\.length\} 則續文`/)
  assert.match(panelFunctionSource('renderThread'), /thread-timeline/)
})

test('Update Radar expanded unit keys survive redraws and are pruned only when data removes the card', () => {
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const receiveStateStart = panelSource.lastIndexOf('function receiveState(radar)')
  const receiveStateEnd = panelSource.indexOf('\n}\n', receiveStateStart)
  const receiveStateSource = panelSource.slice(receiveStateStart, receiveStateEnd + 2)
  const source = ['findThreadRootId', 'groupKey', 'byPosition', 'groupUpdates'].map(panelFunctionSource).join('\n') + `\n${receiveStateSource}`
  const state = { expanded: new Set(['release:v2.1.316', 'update:keep', 'update:gone']) }
  const receiveState = runInNewContext(`(() => { ${source}\nreturn receiveState })()`, {
    state,
    tabController: { receiveState: (radar: unknown) => radar },
  }) as (radar: unknown) => unknown
  const radar = { updates: [
    { id: 'release-item', sourceId: 'claude-code', version: 'v2.1.316', position: 0 },
    { id: 'keep', sourceId: 'openai-api', position: 1 },
  ] }
  assert.equal(receiveState(radar), radar)
  assert.deepEqual([...state.expanded].sort(), ['release:v2.1.316', 'update:keep'])
})

test('Update Radar heatmap disclosure is collapsed by default and reflects a selected day', () => {
  const renderUpdatesTab = panelFunctionSource('renderUpdatesTab')
  const renderHeatmap = panelFunctionSource('renderHeatmap')
  assert.match(renderUpdatesTab, /title: '每日更新熱度 · 近 26 週'/)
  assert.match(renderUpdatesTab, /open: state\.disclosures\.get\(heatDisclosureId\) === true/)
  assert.match(renderUpdatesTab, /meta: state\.day \? `已選 \$\{month\}\/\$\{day\}` : ''/)
  assert.match(renderHeatmap, /heatMeta\.textContent = state\.day \? `已選 \$\{month\}\/\$\{day\}` : ''/)
})

test('Update Radar update cards hide the browser hint and keep the footer explanation', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.doesNotMatch(panelSource, /appendText\([^\n]*'source-note', '使用系統瀏覽器開啟'/)
  assert.match(panelSource, /button\.title = '使用系統瀏覽器開啟'/)
  assert.match(panelSource, /appendText\(row, 'span', 'source-note', ''\)/)
  assert.match(styles, /\.source-note:empty \{ display: none; \}/)
  assert.match(markup, /內容為官方原文，未經 AI 摘要；連結會在系統瀏覽器開啟。/)
  assert.match(styles, /footer \{[^}]*font-size: 12px/)
})

test('Update Radar keyboard tab navigation wraps, supports Home and End, and ignores other keys', () => {
  const nextTabIndex = runInNewContext(`(${panelFunctionSource('nextTabIndex')})`) as (key: string, current: number, count: number) => number | null
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2)
  assert.equal(nextTabIndex('ArrowLeft', 2, 3), 1)
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0)
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1)
  assert.equal(nextTabIndex('Home', 2, 3), 0)
  assert.equal(nextTabIndex('End', 0, 3), 2)
  assert.equal(nextTabIndex('Enter', 0, 3), null)
  assert.equal(nextTabIndex('ArrowLeft', 0, 0), null)

  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.doesNotMatch(panelFunctionSource('activateTab'), /postMessage/)
  assert.match(panelSource, /elements\.tabList\.addEventListener\('keydown'/)
  assert.match(panelSource, /elements\.tabs\[id\]\.focus\(\)/)
  assert.match(panelSource, /window\.scrollTo\(0, Math\.min\(scrollY, maxScrollY\)\)/, 'restoration clamps when the target content is shorter')
})

test('Update Radar reset timers follow their visible tab and removed preview toggles need no observer', () => {
  const syncLifecycleSource = panelFunctionSource('syncTabLifecycles')
  const overviewResetSource = panelFunctionSource('renderOverviewCodexStatus')
  const countdownTickSource = panelFunctionSource('tickCodexCountdown')
  assert.match(syncLifecycleSource, /const countdownVisible = !state\.detail && state\.activeTab === 'reset'/)
  assert.match(overviewResetSource, /Codex 重設 · \$\{distance\} · 共 \$\{reset\.stats\?\.total \?\? 0\} 次/)
  assert.match(countdownTickSource, /if \(state\.activeTab === 'reset'\)/)
  const cleared: number[] = []
  const timers: Array<{ id: number, callback: () => void }> = []
  let nextTimer = 1
  const context = {
    state: { activeTab: 'updates', detail: null },
    codexResetCountdownTick: () => {},
    codexResetCountdownTimer: 42,
    clearTimeout: (timer: number) => cleared.push(timer),
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.push({ id, callback }); return id },
    window: { matchMedia: () => ({ matches: false }) },
  }
  const syncTabLifecycles = runInNewContext(`(${syncLifecycleSource})`, context) as () => void
  syncTabLifecycles()
  assert.deepEqual(cleared, [42], 'leaving Codex tabs clears the countdown timer')
  assert.equal(context.codexResetCountdownTimer, null)
  context.state.activeTab = 'overview'
  syncTabLifecycles()
  assert.equal(timers.length, 0, 'the overview status does not run a countdown')
  context.state.activeTab = 'reset'
  context.codexResetCountdownTimer = null
  syncTabLifecycles()
  assert.equal(timers.length, 1, 'the Codex reset tab schedules the countdown')
  context.state.detail = { key: 'detail' }
  context.codexResetCountdownTimer = 55
  syncTabLifecycles()
  assert.equal(cleared.at(-1), 55, 'the detail subview pauses the countdown')

  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  assert.doesNotMatch(panelSource, /previewMeasurements|previewResizeObserver|observePreview/)
})

test('Update Radar uses sticky single-column tabs and removes sidebar layout code', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  const desktop = styles.match(/@media \(min-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const narrowTabs = styles.match(/@media \(max-width: 300px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(markup, /<header class="radar-header">[\s\S]*<div id="radar-tabs" class="radar-tabs" role="tablist"/)
  assert.doesNotMatch(markup + styles, /radar-sticky-header/)
  const headerRule = styles.match(/\.radar-header \{([^}]*)\}/)?.[1] ?? ''
  const tabListRule = styles.match(/\.radar-tabs \{([^}]*)\}/)?.[1] ?? ''
  const scrollMarginRules = [...styles.matchAll(/([^{}]+)\{([^{}]*scroll-margin-top[^{}]*)\}/g)]
  assert.doesNotMatch(headerRule, /position:\s*sticky/)
  assert.match(tabListRule, /position:\s*sticky/)
  assert.match(tabListRule, /top:\s*0/)
  assert.match(tabListRule, /z-index:\s*6/)
  assert.match(tabListRule, /background:\s*var\(--radar-bg\)/)
  assert.match(tabListRule, /border-bottom:\s*1px solid/)
  assert.match(panelSource, /new ResizeObserver\(updateStickyMeasurements\)/)
  assert.match(panelSource, /stickyLayoutObserver\?\.observe\(elements\.tabList\)/)
  assert.doesNotMatch(panelSource, /stickyHeader/)
  assert.match(panelSource, /--radar-sticky-offset', `\$\{elements\.tabList\.getBoundingClientRect\(\)\.height\}px`/)
  assert.ok(scrollMarginRules.length > 0, 'scroll targets declare sticky-aware margins')
  for (const [, selector, declarations] of scrollMarginRules) {
    assert.match(declarations, /var\(--radar-sticky-offset\)/, `${selector.trim()} uses the tablist offset`)
  }
  assert.match(styles, /\.toolbar \{[^}]*top: var\(--radar-sticky-offset\);/)
  assert.match(styles, /\.radar-tab\[aria-selected="true"\] \{[^}]*border-bottom-color: var\(--radar-accent\);[^}]*font-weight: 600;/)
  const forcedColorsTab = styles.match(/\.radar-tab\[aria-selected="true"\] \{([^}]*)\}/g)?.at(-1) ?? ''
  assert.match(forcedColorsTab, /border-bottom: 2px solid Highlight/)
  assert.match(forcedColorsTab, /outline: 2px solid Highlight/)
  assert.match(forcedColorsTab, /font-weight: 600/)
  assert.match(narrowTabs, /\.radar-tab-count \{ display: none; \}/)
  // 電腦版和宿主其他頁籤一樣吃滿插件區，不能再出現最大寬度的上限。
  assert.match(desktop, /main\.radar-shell \{ width: 100%;/)
  assert.match(desktop, /\.tab-panel, \.updates-panel, \.reset-panel, \.change-detail \{ width: 100%; max-width: none; \}/)
  assert.doesNotMatch(desktop, /width: min\(100%, \d+px\)/)
  assert.doesNotMatch(desktop, /grid-template-columns: 368px/)
  assert.match(desktop, /\.overview-grid \{[^}]*grid-template-areas:/s, 'the overview alone uses the required two-column desktop layout')
  assert.doesNotMatch(markup + styles + panelSource, /radar-sidebar|sidebarStickyTop|applySidebarLayout|--radar-sidebar-top|data-sticky/)
  assert.doesNotMatch(styles, /overflow-y:\s*(?:auto|scroll)\b/)
  assert.match(styles, /\.update-list \{ scroll-margin-top: calc\(var\(--radar-sticky-offset\) \+ var\(--radar-toolbar-sticky-height\) \+ var\(--radar-gap-3\)\); \}/)
  assert.match(styles, /\.detail-bar \{[^}]*position: sticky;[^}]*top: var\(--radar-sticky-offset\);/)
  assert.match(panelFunctionSource('renderChangeDetail'), /elements\.tabList\.hidden = true/)
  assert.match(panelFunctionSource('renderChangeDetail'), /for \(const panel of Object\.values\(elements\.panels\)\) panel\.hidden = true/)
  assert.match(panelFunctionSource('closeChangeDetail'), /elements\.tabList\.hidden = false/)
  assert.match(panelSource, /tab\.setAttribute\('aria-selected', String\(selected\)\)[\s\S]*tab\.tabIndex = selected \? 0 : -1/)
  assert.match(panelSource, /document\.fonts\?\.ready\?\.then\(updateStickyMeasurements\)/)
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

test('@ajambrosino parser keeps today roots and chained self replies in one safe data model', () => {
  const rootId = '2113162277688070445'
  const replyId = '2113162413008884099'
  const roots = parseXProfile(profileHtml([
    profilePost(rootId, '2026-10-28T07:00:00Z', 'Root public post.'),
  ]), { now: new Date(FIXED_NOW), timeZone: 'UTC' })
  const replies = parseXSelfReplies(conversationHtml(rootId, [
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
  assert.equal(official?.latestReset.sourceUrl, 'https://x.com/ajambrosino/status/2115330127886463244')
  assert.deepEqual(official?.scheduledReset, { at: '2026-10-28T07:59:00.000Z' })
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
  assert.equal((fixture.storage.get('radar-state') as { schemaVersion: number }).schemaVersion, 5)
  assert.ok(fixture.panelMessages.some(message => message.type === 'radar:state'))
})

test('source validators persist after a successful parse and are sent on the next fetch', async () => {
  const fixture = createApiFixture()
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  fixture.setResponseHeaders(url, { etag: '"openai-v1"', 'last-modified': 'Wed, 28 Oct 2026 07:00:00 GMT' })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()

  const source = runtime.getState().sources.find(item => item.id === 'openai-api') as any
  assert.deepEqual(source.validators, { etag: '"openai-v1"', lastModified: 'Wed, 28 Oct 2026 07:00:00 GMT' })
  const calls = fixture.fetchCalls.filter(call => call.url === url)
  assert.equal(calls[0]?.headers['if-none-match'], undefined)
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  const nextCall = fixture.fetchCalls.filter(call => call.url === url).at(-1)
  assert.equal(nextCall?.headers['if-none-match'], '"openai-v1"')
  assert.equal(nextCall?.headers['if-modified-since'], 'Wed, 28 Oct 2026 07:00:00 GMT')
})

test('304 reuses source data and marks it successful without sending notifications', async () => {
  const fixture = createApiFixture()
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  fixture.setResponseHeaders(url, { etag: '"openai-v1"' })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  const cached = runtime.getState().updates.filter(update => update.sourceId === 'openai-api')
  fixture.setNow('2026-10-28T08:02:00Z')
  fixture.setResponse(url, { status: 304 })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })

  const source = runtime.getState().sources.find(item => item.id === 'openai-api') as any
  assert.deepEqual(runtime.getState().updates.filter(update => update.sourceId === 'openai-api'), cached)
  assert.equal(source.status, 'ok')
  assert.equal(source.failures, 0)
  assert.equal(source.fetchedAt, '2026-10-28T08:02:00.000Z')
  assert.equal(source.nextAttemptAt, '2026-10-28T09:02:00.000Z')
  assert.deepEqual(source.validators, { etag: '"openai-v1"' })
  assert.equal(fixture.notifications.length, 0)
})

test('Codex Resets 304 retains the reset and does not repeat its notification', async () => {
  const fixture = createApiFixture()
  const url = 'https://codex-resets.com/api/v1/status'
  fixture.setResponseHeaders(url, { etag: '"codex-v1"' })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setCodexStatus(codexResetPayload({
    id: '2115330127886463245', announcedAt: '2026-10-28T08:01:00.000Z', lastResetAt: '2026-10-28T08:01:00.000Z',
  }))
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })
  assert.equal(fixture.notifications.length, 1)
  const cached = structuredClone(runtime.getState().codexReset)

  fixture.setNow('2026-10-28T08:02:00Z')
  fixture.setResponse(url, { status: 304 })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'codex-resets' })

  const source = runtime.getState().sources.find(item => item.id === 'codex-resets') as any
  assert.deepEqual(runtime.getState().codexReset, cached)
  assert.equal(source.status, 'ok')
  assert.equal(source.failures, 0)
  assert.equal(source.fetchedAt, '2026-10-28T08:02:00.000Z')
  assert.deepEqual(source.validators, { etag: '"codex-v1"' })
  assert.equal(fixture.notifications.length, 1)
})

test('validators are not sent when a source has no cached data', async () => {
  const fixture = createApiFixture()
  fixture.storage.set('radar-state', {
    schemaVersion: 4,
    sources: [
      { id: 'openai-api', validators: { etag: '"orphan-openai"' } },
      { id: 'x-ajambrosino', validators: { etag: '"orphan-x"' } },
      { id: 'codex-resets', validators: { etag: '"orphan-codex"' } },
    ],
    updates: [], codexReset: null, knownIds: [], baselineSourceIds: [], lastCheckedAt: null, lastSuccessAt: null,
  })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()

  for (const url of [
    'https://developers.openai.com/api/docs/changelog.md',
    'https://x.com/ajambrosino',
    'https://codex-resets.com/api/v1/status',
  ]) {
    const call = fixture.fetchCalls.find(item => item.url === url)
    assert.equal(call?.headers['if-none-match'], undefined, url)
    assert.equal(call?.headers['if-modified-since'], undefined, url)
  }
  assert.equal(runtime.getState().schemaVersion, 5)
})

test('304 without cached data clears validators and retries as a full fetch', async () => {
  const fixture = createApiFixture()
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  fixture.storage.set('radar-state', {
    schemaVersion: 4,
    sources: [{ id: 'openai-api', validators: { etag: '"orphan-openai"' } }],
    updates: [], codexReset: null, knownIds: [], baselineSourceIds: [], lastCheckedAt: null, lastSuccessAt: null,
  })
  fixture.setResponse(url, { status: 304 })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  const firstSource = runtime.getState().sources.find(item => item.id === 'openai-api') as any
  assert.equal(firstSource.status, 'error')
  assert.equal(firstSource.error, 'source_cache_missing')
  assert.equal(firstSource.validators, undefined)
  assert.equal(fixture.fetchCalls.find(call => call.url === url)?.headers['if-none-match'], undefined)

  fixture.setResponse(url, { status: 200, body: baselineMarkdown })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  const nextCall = fixture.fetchCalls.filter(call => call.url === url).at(-1)
  assert.equal(nextCall?.headers['if-none-match'], undefined)
  assert.equal(runtime.getState().sources.find(item => item.id === 'openai-api')?.status, 'ok')
})

test('invalid response and stored validators are discarded before storage and requests', async () => {
  const fixture = createApiFixture()
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  fixture.setResponseHeaders(url, {
    etag: `"${'a'.repeat(257)}"`,
    'last-modified': 'Wed, 28 Oct 2026 07:00:00 GMT\u0001',
  })
  const firstRuntime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await firstRuntime.start()
  const stored = fixture.storage.get('radar-state') as any
  const openAiSource = stored.sources.find((source: any) => source.id === 'openai-api')
  assert.equal(openAiSource.validators, undefined)

  fixture.storage.set('radar-state', {
    ...stored,
    sources: stored.sources.map((source: any) => source.id === 'openai-api'
      ? { ...source, validators: { etag: `"${'b'.repeat(257)}"`, lastModified: 'bad\u0001date' } }
      : source),
  })
  const secondRuntime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await secondRuntime.start()
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  const calls = fixture.fetchCalls.filter(call => call.url === url)
  const nextCall = calls.at(-1)
  assert.equal(nextCall?.headers['if-none-match'], undefined)
  assert.equal(nextCall?.headers['if-modified-since'], undefined)
  assert.equal((fixture.storage.get('radar-state') as any).sources.find((source: any) => source.id === 'openai-api').validators, undefined)
})

test('Retry-After seconds and HTTP dates are parsed and clamped to one minute through six hours', async () => {
  const cases = [
    { status: 429, header: '120', expected: '2026-10-28T08:02:00.000Z' },
    { status: 503, header: new Date(FIXED_NOW + 120_000).toUTCString(), expected: '2026-10-28T08:02:00.000Z' },
    { status: 429, header: '1', expected: '2026-10-28T08:01:00.000Z' },
    { status: 503, header: '999999', expected: '2026-10-28T14:00:00.000Z' },
    { status: 429, header: '9'.repeat(256), expected: '2026-10-28T14:00:00.000Z' },
    { status: 429, header: new Date(FIXED_NOW - 120_000).toUTCString(), expected: '2026-10-28T08:01:00.000Z' },
    { status: 503, header: new Date(FIXED_NOW + 8 * 60 * 60 * 1000).toUTCString(), expected: '2026-10-28T14:00:00.000Z' },
  ]
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  for (const { status, header, expected } of cases) {
    const fixture = createApiFixture()
    const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
    await runtime.start()
    fixture.setResponse(url, { status, headers: { 'retry-after': header }, body: 'try later' })
    await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
    const source = runtime.getState().sources.find(item => item.id === 'openai-api') as any
    assert.equal(source.error, 'source_rate_limited')
    assert.equal(source.nextAttemptAt, expected)
  }
})

test('invalid Retry-After uses the existing retry backoff', async () => {
  const fixture = createApiFixture()
  const url = 'https://developers.openai.com/api/docs/changelog.md'
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()
  fixture.setResponse(url, { status: 429, headers: { 'retry-after': 'tomorrow' }, body: 'try later' })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'openai-api' })
  const source = runtime.getState().sources.find(item => item.id === 'openai-api') as any
  assert.equal(source.error, 'source_rate_limited')
  assert.equal(source.nextAttemptAt, '2026-10-28T08:05:00.000Z')
})

test('X profile 304 reuses today posts and conversation requests never carry validators', async () => {
  const fixture = createApiFixture()
  const profileUrl = 'https://x.com/ajambrosino'
  const postId = '2115330127886463246'
  fixture.setXProfileBody(profileHtml([profilePost(postId, '2026-10-28T07:30:00Z', 'Today post.')]))
  fixture.setResponseHeaders(profileUrl, { etag: '"x-profile-v1"', 'last-modified': 'Wed, 28 Oct 2026 07:00:00 GMT' })
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  await runtime.start()

  const conversationUrl = `https://x.com/ajambrosino/status/${postId}`
  const conversationCall = fixture.fetchCalls.find(call => call.url === conversationUrl)
  assert.equal(conversationCall?.headers['if-none-match'], undefined)
  assert.equal(conversationCall?.headers['if-modified-since'], undefined)
  fixture.setNow('2026-10-28T08:01:00Z')
  fixture.setResponse(profileUrl, { status: 304 })
  await fixture.getPanelHandler()?.({ type: 'radar:retry-source', sourceId: 'x-ajambrosino' })

  const profileCalls = fixture.fetchCalls.filter(call => call.url === profileUrl)
  assert.equal(profileCalls.at(-1)?.headers['if-none-match'], '"x-profile-v1"')
  assert.equal(profileCalls.at(-1)?.headers['if-modified-since'], 'Wed, 28 Oct 2026 07:00:00 GMT')
  assert.equal(fixture.fetchCalls.filter(call => call.url === conversationUrl).length, 1)
  assert.equal(runtime.getState().updates.some(update => update.id === `x-${postId}`), true)
  const source = runtime.getState().sources.find(item => item.id === 'x-ajambrosino') as any
  assert.equal(source.status, 'ok')
  assert.equal(source.failures, 0)
  assert.equal(fixture.notifications.length, 0)
})

test('legacy tibo-x state is discarded and a new X source establishes a quiet baseline', async () => {
  const fixture = createApiFixture()
  const previousPostId = '2113000000000000001'
  const newPostId = '2114000000000000001'
  fixture.storage.set('radar-state', {
    schemaVersion: 4,
    sources: [
      { id: 'openai-api', status: 'ok', itemCount: 0 },
      { id: 'tibo-x', status: 'ok', itemCount: 1 },
    ],
    updates: [{
      id: `x-${previousPostId}`, sourceId: 'tibo-x', provider: 'x', product: 'social',
      category: 'developer-tool', changeType: 'added', title: 'Old profile post', summary: 'Legacy cached item.',
      publishedAt: '2026-10-28', publishedAtTime: '2026-10-28T06:00:00.000Z',
      sourceUrl: `https://x.com/thsottiaux/status/${previousPostId}`, postKind: 'root',
    }],
    knownIds: [`x-${previousPostId}`, 'openai-existing-id'],
    baselineSourceIds: ['tibo-x'],
    lastCheckedAt: null,
    lastSuccessAt: null,
  })
  fixture.setXProfileBody(profileHtml([profilePost(newPostId, '2026-10-28T07:00:00Z', 'New source baseline.')]))
  const releaseFetches = fixture.pauseFetches()
  const runtime = createUpdateRadarRuntime(fixture.api, { now: fixture.now })
  const startup = runtime.start()
  await new Promise<void>(resolve => setImmediate(resolve))

  const normalized = fixture.panelMessages.find(message => message.type === 'radar:state')?.state as any
  assert.equal(normalized.schemaVersion, 5)
  assert.equal(normalized.updates.some((update: any) => update.sourceId === 'tibo-x'), false)
  assert.equal(normalized.knownIds.includes(`x-${previousPostId}`), false)
  assert.equal(normalized.knownIds.includes('openai-existing-id'), true)
  assert.equal(normalized.baselineSourceIds.includes('tibo-x'), false)
  assert.equal(normalized.sources.some((source: any) => source.id === 'tibo-x'), false)
  assert.equal(normalized.sources.some((source: any) => source.id === 'x-ajambrosino'), true)

  releaseFetches()
  await startup
  assert.equal(runtime.getState().updates.some(update => update.id === `x-${newPostId}`), true)
  assert.equal(runtime.getState().baselineSourceIds.includes('x-ajambrosino'), true)
  assert.equal(runtime.getState().knownIds.includes(`x-${previousPostId}`), false)
  assert.equal(fixture.notifications.length, 0)
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
  assert.equal(resetNotification?.link, 'https://x.com/ajambrosino/status/2115330127886463245')
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
  assert.equal(runtime.getState().schemaVersion, 5)
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

test('expanded official updates hide the preview and show only summary text after the title', () => {
  const source = ['collapsedWhitespace', 'textAfterTitle', 'officialHeadline', 'officialBodyText'].map(panelFunctionSource).join('\n')
  const helpers = runInNewContext(`(() => { ${source}\nreturn { officialHeadline, officialBodyText } })()`) as {
    officialHeadline: (update: unknown) => { headline: string; previewText: string },
    officialBodyText: (title: string, summary: string) => string,
  }
  const fullTitle = "We've deprecated fast mode for Claude Opus 4.8"
  const summary = `${fullTitle}. Fast mode is no longer available.`
  const expandedHeadline = helpers.officialHeadline({ title: `${fullTitle}…`, summary }).headline
  assert.equal(helpers.officialBodyText(expandedHeadline, summary), '', 'a title-prefix summary is not repeated as a full paragraph')
  assert.equal(helpers.officialBodyText(fullTitle, summary), 'Fast mode is no longer available.')

  const renderSource = panelFunctionSource('renderOfficialUpdate')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(renderSource, /article\.classList\.toggle\('is-expanded', expanded\)/)
  assert.match(renderSource, /officialBodyText\(headline, update\.summary\)/)
  assert.match(styles, /\.official-record\.is-expanded \.official-preview \{ display: none; \}/)
  assert.match(styles, /\.official-record\.is-expanded \.update-card-title \{[^}]*-webkit-line-clamp: unset/)
})

test('official quick-read switches to label-value rows below 360px without splitting words', () => {
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(styles, /container-name: official-update-card; container-type: inline-size;/)
  assert.match(styles, /@container official-update-card \(max-width: 360px\)/)
  assert.match(styles, /\.insight-item \{ display: grid; grid-template-columns: max-content minmax\(0, 1fr\)/)
  assert.match(styles, /\.insight-label::after \{ content: '：'; \}/)
  assert.match(styles, /\.insight-value \{[^}]*overflow-wrap: normal; word-break: keep-all;/)
})

test('official update type labels share the expanded change label for deprecated and removed records', () => {
  const labelSource = panelFunctionSource('updateChangeLabel')
  const updateChangeLabel = runInNewContext(`(() => { ${labelSource}\nreturn updateChangeLabel })()`, {
    labels: { changeType: { deprecated: '棄用', removed: '移除' }, category: { 'new-model': '新模型' } },
  }) as (update: unknown) => string
  assert.equal(updateChangeLabel({ changeType: 'deprecated', category: 'new-model' }), '棄用')
  assert.equal(updateChangeLabel({ changeType: 'removed', category: 'new-model' }), '移除')
  assert.match(panelFunctionSource('renderOfficialUpdate'), /'update-type-chip', updateChangeLabel\(update\)/)
  assert.match(panelFunctionSource('appendQuickRead'), /appendInsight\(section, '變更', updateChangeLabel\(update\)\)/)
})

test('updates density keeps accessible heading, co-locates counts, and preserves 36px actions', () => {
  const markup = fs.readFileSync(path.join(pluginRoot, 'ui/index.html'), 'utf8')
  const panelSource = fs.readFileSync(path.join(pluginRoot, 'ui/panel.js'), 'utf8')
  const styles = fs.readFileSync(path.join(pluginRoot, 'ui/panel.css'), 'utf8')
  assert.match(markup, /<h2 class="feed-heading visually-hidden">[\s\S]*?更新動態[\s\S]*?<\/h2>/)
  assert.match(markup, /id="result-status" class="result-status visually-hidden" aria-live="polite"/)
  assert.match(panelFunctionSource('renderUpdates'), /heatMeta\.textContent = \[selectedDay, elements\.resultStatus\.textContent\]/)
  assert.match(styles, /\.heat-disclosure-button \{ min-height: 36px;/)
  assert.match(styles, /\.result-status\.visually-hidden \{[\s\S]*?height: 20px;[\s\S]*?line-height: 20px;/)
  assert.match(panelFunctionSource('renderXPost'), /bubble\.append\(preview\)[\s\S]*?const sourceActions = appendText\(bubble, 'div', 'message-source-actions', ''\)[\s\S]*?appendSourceAction\(sourceActions, update, \{ inline: true \}\)/)
  assert.match(styles, /\.message-meta \.source-button \{ min-height: 36px;/)
  assert.match(styles, /\.card-disclosure \{ margin-top: 4px; border-top: 0; \}/)
  assert.match(styles, /\.card-disclosure-button \{ min-height: 36px;/)
  assert.match(panelFunctionSource('renderOfficialUpdate'), /heading\.append\(disclosure\.root\)/)
  assert.match(styles, /\.official-headline-row > \.card-disclosure \{ display: contents; \}/)
})
