import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectFeed } from '../src/collector.mjs'

const datedMarkdown = `
## October, 2026

### Oct 21

Feature · API: v1/responses

Added a bounded test feature to the API.
`

const anthropicMarkdown = `
### October 21, 2026

- Added a bounded test feature to the Claude API.
`

const releasesJson = JSON.stringify([{
  tag_name: 'v2.1.307',
  published_at: '2026-10-21T10:00:00Z',
  html_url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.307',
  body: '- Added a bounded Claude Code feature',
}])

function successResponse(url) {
  if (url.includes('api.github.com')) return new Response(releasesJson, { status: 200 })
  if (url.includes('platform.claude.com')) return new Response(anthropicMarkdown, { status: 200 })
  return new Response(datedMarkdown, { status: 200 })
}

test('collector keeps the previous source entries when one source becomes unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'update-radar-collector-'))
  const feedPath = join(directory, 'feed.json')
  const first = await collectFeed({
    feedPath,
    now: () => new Date('2026-10-22T00:00:00Z'),
    fetchImpl: async url => successResponse(String(url)),
    publicXFetcher: async () => [],
  })
  const original = first.updates.filter(update => update.sourceId === 'openai-api')
  assert.equal(original.length, 1)
  assert.equal(first.sources.find(source => source.id === 'tibo-x').status, 'ok')
  assert.equal(first.sources.find(source => source.id === 'tibo-x').mode, 'public-page')

  const second = await collectFeed({
    feedPath,
    now: () => new Date('2026-10-22T01:00:00Z'),
    fetchImpl: async (url) => {
      if (String(url).includes('/changelog.md')) throw new Error('offline')
      return successResponse(String(url))
    },
    publicXFetcher: async () => [],
  })
  const source = second.sources.find(item => item.id === 'openai-api')
  assert.equal(source.status, 'stale')
  assert.equal(source.error, 'source_unavailable')
  assert.deepEqual(second.updates.filter(update => update.sourceId === 'openai-api'), original)
})

test('a Tibo-only refresh preserves official sources and merges original X posts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'update-radar-x-collector-'))
  const feedPath = join(directory, 'feed.json')
  const first = await collectFeed({
    feedPath,
    now: () => new Date('2026-10-22T00:00:00Z'),
    fetchImpl: async url => successResponse(String(url)),
    publicXFetcher: async () => [],
  })
  const officialUpdates = first.updates.filter(update => update.sourceId !== 'tibo-x')

  const second = await collectFeed({
    feedPath,
    now: () => new Date('2026-10-22T00:05:00Z'),
    sourceIds: ['tibo-x'],
    timeZone: 'UTC',
    publicXFetcher: async () => [{
      id: 'x-999999999',
      sourceId: 'tibo-x',
      provider: 'x',
      product: 'social',
      category: 'developer-tool',
      changeType: 'added',
      title: 'A new original AI tooling update.',
      summary: 'A new original AI tooling update.',
      publishedAt: '2026-10-22',
      publishedAtTime: '2026-10-22T00:04:00.000Z',
      sourceUrl: 'https://x.com/thsottiaux/status/999999999',
    }],
  })

  assert.deepEqual(second.updates.filter(update => update.sourceId !== 'tibo-x'), officialUpdates)
  assert.equal(second.sources.find(source => source.id === 'tibo-x').status, 'ok')
  assert.equal(second.updates.find(update => update.sourceId === 'tibo-x').id, 'x-999999999')
})

test('Tibo cached posts expire when the local calendar day changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'update-radar-x-day-'))
  const feedPath = join(directory, 'feed.json')
  const yesterdayPost = {
    id: 'x-999999998',
    sourceId: 'tibo-x',
    provider: 'x',
    product: 'social',
    category: 'feature',
    changeType: 'added',
    title: 'Yesterday',
    summary: 'Yesterday',
    publishedAt: '2026-10-21',
    publishedAtTime: '2026-10-21T12:00:00.000Z',
    sourceUrl: 'https://x.com/thsottiaux/status/999999998',
  }
  await collectFeed({
    feedPath,
    now: () => new Date('2026-10-21T13:00:00Z'),
    sourceIds: ['tibo-x'],
    timeZone: 'UTC',
    publicXFetcher: async () => [yesterdayPost],
  })
  const today = await collectFeed({
    feedPath,
    now: () => new Date('2026-10-22T00:01:00Z'),
    sourceIds: ['openai-api'],
    timeZone: 'UTC',
    fetchImpl: async url => successResponse(String(url)),
    publicXFetcher: async () => [],
  })
  assert.equal(today.updates.some(update => update.id === yesterdayPost.id), false)
  assert.equal(today.sources.find(source => source.id === 'tibo-x').itemCount, 0)
})
