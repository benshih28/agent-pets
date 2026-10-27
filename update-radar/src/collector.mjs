import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  FEED_SCHEMA_VERSION,
  MAX_FEED_BYTES,
  MAX_FEED_ITEMS,
  SOURCE_DEFINITIONS,
  TIBO_X_SOURCE,
} from './config.mjs'
import { fetchOfficialSource } from './fetch-source.mjs'
import { parseDatedMarkdown, parseGithubReleases } from './normalize.mjs'
import { fetchTiboPublicPosts, localDateKey } from './x-public-source.mjs'

const ALL_SOURCE_DEFINITIONS = Object.freeze([...SOURCE_DEFINITIONS, TIBO_X_SOURCE])

function sanitizedError(error) {
  const value = error instanceof Error ? error.message : 'source_unavailable'
  return /^[a-z0-9_]{3,64}$/.test(value) ? value : 'source_unavailable'
}

function parseSource(definition, body) {
  if (definition.kind === 'dated-markdown') return parseDatedMarkdown(definition, body)
  if (definition.kind === 'github-releases') return parseGithubReleases(definition, body)
  throw new Error('unsupported_source_kind')
}

async function readPreviousFeed(feedPath) {
  try {
    const raw = await readFile(feedPath)
    if (raw.byteLength > MAX_FEED_BYTES) return null
    const feed = JSON.parse(raw.toString('utf8'))
    if (feed?.schemaVersion !== FEED_SCHEMA_VERSION || !Array.isArray(feed.updates)) return null
    return feed
  } catch {
    return null
  }
}

function sortUpdates(updates) {
  return [...updates].sort((left, right) => {
    const dateOrder = String(right.publishedAtTime ?? right.publishedAt ?? '')
      .localeCompare(String(left.publishedAtTime ?? left.publishedAt ?? ''))
    if (dateOrder) return dateOrder
    const sourceOrder = left.sourceId.localeCompare(right.sourceId)
    if (sourceOrder) return sourceOrder
    return left.id.localeCompare(right.id)
  })
}

function previousUpdatesFor(previous, sourceId) {
  return previous?.updates?.filter(update => update?.sourceId === sourceId) ?? []
}

function mergeUpdates(newUpdates, previousUpdates, maxItems) {
  const unique = new Map()
  for (const update of [...newUpdates, ...previousUpdates]) {
    if (update && typeof update.id === 'string' && !unique.has(update.id)) unique.set(update.id, update)
  }
  return sortUpdates([...unique.values()]).slice(0, maxItems)
}

function retainedResult(definition, previous, generatedAt, retainedUpdates) {
  const updates = retainedUpdates ?? previousUpdatesFor(previous, definition.id)
  const source = previous?.sources?.find(item => item?.id === definition.id)
  if (source) return { source: { ...source, itemCount: updates.length }, updates }
  return {
    source: {
      id: definition.id,
      provider: definition.provider,
      status: 'error',
      itemCount: 0,
      fetchedAt: generatedAt,
      publicUrl: definition.publicUrl,
      error: 'not_collected',
    },
    updates,
  }
}

async function collectDefinition(definition, context) {
  const allStaleUpdates = previousUpdatesFor(context.previous, definition.id)
  const staleUpdates = definition.kind === 'x-public-profile'
    ? allStaleUpdates.filter(update => (
        localDateKey(update?.publishedAtTime, context.timeZone)
        === localDateKey(context.currentTime, context.timeZone)
      ))
    : allStaleUpdates

  if (context.selectedSourceIds && !context.selectedSourceIds.has(definition.id)) {
    return retainedResult(definition, context.previous, context.generatedAt, staleUpdates)
  }

  try {
    let updates
    if (definition.kind === 'x-public-profile') {
      const freshUpdates = await context.publicXFetcher({
        fetchImpl: context.fetchImpl,
        now: context.currentTime,
        timeZone: context.timeZone,
      })
      updates = mergeUpdates(freshUpdates, staleUpdates, definition.maxItems)
    } else {
      const response = await fetchOfficialSource(definition.url, { fetchImpl: context.fetchImpl })
      updates = parseSource(definition, response.body)
      if (updates.length === 0) throw new Error('source_format_changed')
    }

    return {
      source: {
        id: definition.id,
        provider: definition.provider,
        status: 'ok',
        itemCount: updates.length,
        fetchedAt: context.generatedAt,
        publicUrl: definition.publicUrl,
        ...(definition.kind === 'x-public-profile' ? { mode: 'public-page' } : {}),
      },
      updates,
    }
  } catch (error) {
    return {
      source: {
        id: definition.id,
        provider: definition.provider,
        status: staleUpdates.length > 0 ? 'stale' : 'error',
        itemCount: staleUpdates.length,
        fetchedAt: context.generatedAt,
        publicUrl: definition.publicUrl,
        error: sanitizedError(error),
      },
      updates: staleUpdates,
    }
  }
}

export async function collectFeed(options) {
  const now = options.now ?? (() => new Date())
  const fetchImpl = options.fetchImpl ?? fetch
  const previous = await readPreviousFeed(options.feedPath)
  const generatedAt = now().toISOString()
  const currentTime = new Date(generatedAt)
  const selectedSourceIds = options.sourceIds ? new Set(options.sourceIds) : null
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const publicXFetcher = options.publicXFetcher ?? fetchTiboPublicPosts

  const context = {
    currentTime,
    fetchImpl,
    generatedAt,
    previous,
    publicXFetcher,
    selectedSourceIds,
    timeZone,
  }
  const results = await Promise.all(ALL_SOURCE_DEFINITIONS.map(definition => collectDefinition(definition, context)))

  const unique = new Map()
  for (const result of results) {
    for (const update of result.updates) {
      if (update && typeof update.id === 'string' && !unique.has(update.id)) unique.set(update.id, update)
    }
  }

  const feed = {
    schemaVersion: FEED_SCHEMA_VERSION,
    generatedAt,
    sources: results.map(result => result.source),
    updates: sortUpdates([...unique.values()]).slice(0, MAX_FEED_ITEMS),
  }

  await mkdir(dirname(options.feedPath), { recursive: true })
  const temporaryPath = `${options.feedPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(feed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, options.feedPath)
  return feed
}
