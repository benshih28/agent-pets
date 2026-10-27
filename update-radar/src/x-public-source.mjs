import { TIBO_X_SOURCE } from './config.mjs'
import { fetchOfficialSource } from './fetch-source.mjs'
import { normalizeUpdate } from './normalize.mjs'

const PROFILE_POST_PATTERN_SOURCE = String.raw`data-href="\/thsottiaux\/status\/(\d{1,19})"`
const POST_TEXT_PATTERN = /<div[^>]*class="[^"]*whitespace-pre-wrap[^"]*wrap-break-word[^"]*"[^>]*>([\s\S]*?)<\/div>/
const POST_TIMESTAMP_PATTERN = /"timestamp":(\d{13})/
const EMBEDDED_VALUE_PATTERN = /value:("(?:\\.|[^"\\])*")/g
const MAX_PROFILE_POSTS = 20
const MAX_CONVERSATION_LOOKUPS = 5
const MAX_EMBEDDED_VALUES = 100
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const PROFILE_HEADERS = Object.freeze({
  accept: 'text/html,application/xhtml+xml;q=0.9',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
})

function decodeHtmlText(value) {
  const decodeCodePoint = (digits, radix) => {
    const codePoint = Number.parseInt(digits, radix)
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
      ? String.fromCodePoint(codePoint)
      : ''
  }
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, digits) => decodeCodePoint(digits, 16))
    .replace(/&#(\d{1,7});/g, (_match, digits) => decodeCodePoint(digits, 10))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function localDateKey(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function normalizedTiboUpdate({ id, text, createdAt, timeZone, postKind, replyToId = null }) {
  const publishedAtTime = createdAt.toISOString()
  const update = normalizeUpdate(TIBO_X_SOURCE, {
    body: text,
    headingTitle: '',
    publishedAt: localDateKey(createdAt, timeZone),
    sourceUrl: `https://x.com/${TIBO_X_SOURCE.username}/status/${id}`,
  })
  return update
    ? { ...update, id: `x-${id}`, publishedAtTime, postKind, ...(replyToId ? { replyToId: `x-${replyToId}` } : {}) }
    : null
}

export function parseTiboPublicProfile(html, options = {}) {
  if (typeof html !== 'string' || !html.includes('@thsottiaux')) throw new Error('x_profile_invalid')
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) throw new Error('x_profile_invalid')
  const today = localDateKey(now, options.timeZone)
  const matches = [...html.matchAll(new RegExp(PROFILE_POST_PATTERN_SOURCE, 'g'))]
  if (matches.length === 0) throw new Error('x_profile_format_changed')

  const updates = []
  const seen = new Set()
  for (let index = 0; index < matches.length && updates.length < MAX_PROFILE_POSTS; index += 1) {
    const id = matches[index][1]
    if (seen.has(id)) continue
    seen.add(id)
    const start = matches[index].index ?? 0
    const end = matches[index + 1]?.index ?? Math.min(html.length, start + 100_000)
    const fragment = html.slice(start, end)
    const timestampValue = Number(fragment.match(POST_TIMESTAMP_PATTERN)?.[1])
    const textMatch = fragment.match(POST_TEXT_PATTERN)
    if (!Number.isFinite(timestampValue) || !textMatch) continue

    const createdAt = new Date(timestampValue)
    if (createdAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) continue
    if (localDateKey(createdAt, options.timeZone) !== today) continue
    const text = decodeHtmlText(textMatch[1])
    if (!text) continue

    const update = normalizedTiboUpdate({
      id,
      text,
      createdAt,
      timeZone: options.timeZone,
      postKind: 'root',
    })
    if (update) updates.push(update)
  }
  return updates
}

function embeddedConversationPayloads(html) {
  const payloads = []
  let inspected = 0
  for (const match of html.matchAll(new RegExp(EMBEDDED_VALUE_PATTERN.source, 'g'))) {
    inspected += 1
    if (inspected > MAX_EMBEDDED_VALUES) break
    try {
      const decoded = JSON.parse(match[1])
      if (!decoded.includes('threaded_conversation_with_injections_v2')) continue
      const payload = JSON.parse(decoded)
      if (payload?.data?.threaded_conversation_with_injections_v2) payloads.push(payload)
    } catch {
      // Ignore unrelated or incomplete streamed values.
    }
  }
  return payloads
}

function timelineTweetResults(payload) {
  const results = []
  const instructions = payload?.data?.threaded_conversation_with_injections_v2?.instructions
  if (!Array.isArray(instructions)) return results
  for (const instruction of instructions.slice(0, 20)) {
    if (!Array.isArray(instruction?.entries)) continue
    for (const entry of instruction.entries.slice(0, 100)) {
      const direct = entry?.content?.content?.tweet_results
      if (direct) results.push(direct)
      if (!Array.isArray(entry?.content?.items)) continue
      for (const item of entry.content.items.slice(0, 100)) {
        const nested = item?.item?.content?.tweet_results
        if (nested) results.push(nested)
      }
    }
  }
  return results
}

export function parseTiboSelfReplies(html, options = {}) {
  const rootId = String(options.rootId ?? '')
  if (typeof html !== 'string' || !/^\d{1,19}$/.test(rootId) || !html.includes(rootId)) {
    throw new Error('x_conversation_invalid')
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) throw new Error('x_conversation_invalid')
  const today = localDateKey(now, options.timeZone)
  const payloads = embeddedConversationPayloads(html)
  if (payloads.length === 0) throw new Error('x_conversation_format_changed')

  const candidates = new Map()
  for (const payload of payloads) {
    for (const tweetResult of timelineTweetResults(payload)) {
      const tweet = tweetResult?.result
      const id = String(tweetResult?.rest_id ?? tweet?.rest_id ?? '')
      const author = tweet?.core?.user_results?.result?.core?.screen_name
      const replyToAuthor = tweet?.reply_to_user_results?.result?.core?.screen_name
      const replyToId = String(tweet?.reply_to_results?.rest_id ?? '')
      if (
        !/^\d{1,19}$/.test(id)
        || candidates.has(id)
        || author !== TIBO_X_SOURCE.username
        || replyToAuthor !== TIBO_X_SOURCE.username
        || !/^\d{1,19}$/.test(replyToId)
      ) continue
      candidates.set(id, { id, replyToId, tweet })
    }
  }

  const updates = []
  const acceptedParents = new Set([rootId])
  const pending = [...candidates.values()]
  for (let pass = 0; pass < pending.length; pass += 1) {
    let acceptedInPass = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const { id, replyToId, tweet } = pending[index]
      if (!acceptedParents.has(replyToId)) continue
      pending.splice(index, 1)
      const timestampValue = Number(tweet?.details?.created_at_ms)
      const text = typeof tweet?.details?.full_text === 'string' ? tweet.details.full_text.trim() : ''
      if (!Number.isFinite(timestampValue) || !text) continue
      const createdAt = new Date(timestampValue)
      if (createdAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) continue
      if (localDateKey(createdAt, options.timeZone) !== today) continue

      const update = normalizedTiboUpdate({
        id,
        text,
        createdAt,
        timeZone: options.timeZone,
        postKind: 'self-reply',
        replyToId,
      })
      if (!update) continue
      updates.push(update)
      acceptedParents.add(id)
      acceptedInPass = true
    }
    if (!acceptedInPass) break
  }
  return updates
}

export async function fetchTiboPublicPosts(options = {}) {
  const response = await fetchOfficialSource(TIBO_X_SOURCE.url, {
    fetchImpl: options.fetchImpl,
    maxRedirects: 0,
    headers: PROFILE_HEADERS,
  })
  const parseOptions = {
    now: options.now ?? new Date(),
    timeZone: options.timeZone,
  }
  const roots = parseTiboPublicProfile(response.body, parseOptions)
  const conversationResults = await Promise.allSettled(
    roots.slice(0, MAX_CONVERSATION_LOOKUPS).map(async (root) => {
      const rootId = root.id.slice(2)
      const detail = await fetchOfficialSource(`https://x.com/${TIBO_X_SOURCE.username}/status/${rootId}`, {
        fetchImpl: options.fetchImpl,
        maxRedirects: 0,
        headers: PROFILE_HEADERS,
      })
      return parseTiboSelfReplies(detail.body, { ...parseOptions, rootId })
    }),
  )
  const selfReplies = conversationResults
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value)
  const unique = new Map([...roots, ...selfReplies].map(update => [update.id, update]))
  return [...unique.values()]
    .sort((left, right) => right.publishedAtTime.localeCompare(left.publishedAtTime))
    .slice(0, MAX_PROFILE_POSTS)
}
