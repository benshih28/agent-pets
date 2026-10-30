export const SOURCE_DEFINITIONS = Object.freeze([
  {
    id: 'openai-api', label: 'OpenAI API', provider: 'openai', product: 'api', kind: 'dated-markdown',
    url: 'https://developers.openai.com/api/docs/changelog.md',
    publicUrl: 'https://developers.openai.com/api/docs/changelog', splitBullets: false, maxItems: 48, intervalSec: 3600,
  },
  {
    id: 'openai-deprecations', label: 'OpenAI Deprecations', provider: 'openai', product: 'api', kind: 'dated-markdown',
    url: 'https://developers.openai.com/api/docs/deprecations.md',
    publicUrl: 'https://developers.openai.com/api/docs/deprecations', splitBullets: false, maxItems: 32, intervalSec: 3600,
  },
  {
    id: 'anthropic-platform', label: 'Claude Platform', provider: 'anthropic', product: 'api', kind: 'dated-markdown',
    url: 'https://platform.claude.com/docs/en/release-notes/overview.md',
    publicUrl: 'https://platform.claude.com/docs/en/release-notes/overview', splitBullets: true, maxItems: 48, intervalSec: 3600,
  },
  {
    id: 'anthropic-model-deprecations', label: 'Claude Models', provider: 'anthropic', product: 'model', kind: 'dated-markdown',
    url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md',
    publicUrl: 'https://platform.claude.com/docs/en/about-claude/model-deprecations', splitBullets: false, maxItems: 24, intervalSec: 3600,
  },
  {
    id: 'claude-code', label: 'Claude Code', provider: 'anthropic', product: 'claude-code', kind: 'github-releases',
    url: 'https://api.github.com/repos/anthropics/claude-code/releases?per_page=10',
    publicUrl: 'https://github.com/anthropics/claude-code/releases', maxItems: 150, intervalSec: 3600,
  },
  {
    id: 'tibo-x', label: 'Tibo / X', provider: 'x', product: 'social', kind: 'x-public-profile', username: 'thsottiaux',
    url: 'https://x.com/thsottiaux', publicUrl: 'https://x.com/thsottiaux', maxItems: 20, intervalSec: 600,
  },
  {
    id: 'codex-resets', label: 'Codex 重設', provider: 'codex', product: 'quota', kind: 'codex-reset-status',
    url: 'https://codex-resets.com/api/v1/status', publicUrl: 'https://codex-resets.com/', maxItems: 0, intervalSec: 600,
  },
])

const MONTHS = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
})
const PROFILE_POST_PATTERN_SOURCE = String.raw`data-href="\/thsottiaux\/status\/(\d{1,19})"`
const POST_TEXT_PATTERN = /<div[^>]*class="[^"]*whitespace-pre-wrap[^"]*wrap-break-word[^"]*"[^>]*>([\s\S]*?)<\/div>/
const POST_TIMESTAMP_PATTERN = /"timestamp":(\d{13})/
const EMBEDDED_VALUE_PATTERN = /value:("(?:\\.|[^"\\])*")/g
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export function truncate(value, maxLength) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function stableHash(value) {
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193) >>> 0
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function parseDateText(value, fallbackYear) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?::|\b)/)
  if (isoMatch) return isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  const monthMatch = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/)
  if (!monthMatch) return null
  const month = MONTHS[monthMatch[1].toLowerCase()]
  const year = Number(monthMatch[3] ?? fallbackYear)
  return month && Number.isInteger(year) ? isoDate(year, month, Number(monthMatch[2])) : null
}

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?。！？])/g, '$1')
    .trim()
}

function firstSentence(value) {
  const clean = stripMarkdown(value)
  return truncate(clean.match(/^(.{24,180}?[.!?。！？])(?:\s|$)/)?.[1] ?? clean, 180)
}

// 變更紀錄的條目以動詞開頭（可能先有 [VSCode] 這類標籤）；開頭動詞比全文關鍵字可靠，
// 例如「Fixed logout reporting success when the sign-in was not removed」是修正而不是移除。
const LEADING_CHANGE_VERBS = Object.freeze([
  [/^deprecat(?:ed|es|e)\b/, 'deprecated'],
  [/^(?:removed|removes|dropped)\b/, 'removed'],
  [/^(?:fixed|fixes)\b/, 'fixed'],
  [/^(?:improved|improves|changed|changes|updated|updates|reduced|increased|made|renamed)\b/, 'improved'],
  [/^(?:added|adds|introduced)\b/, 'added'],
])

function inferChangeType(text, title = '') {
  const lead = title.trim().toLowerCase().replace(/^\[[^\]]{1,40}\]\s*/, '')
  for (const [pattern, type] of LEADING_CHANGE_VERBS) if (pattern.test(lead)) return type
  const normalized = text.toLowerCase()
  if (/\b(deprecat|sunset|retir|shut(?:ting)? down)\w*/.test(normalized)) return 'deprecated'
  if (/\b(remov(?:e|ed|al)|no longer available)\b/.test(normalized)) return 'removed'
  if (/\bfix(?:ed|es)?\b/.test(normalized)) return 'fixed'
  if (/\b(improv(?:e|ed|ement)|updat(?:e|ed)|lowered|reduced|expanded)\b/.test(normalized)) return 'improved'
  return 'added'
}

function inferCategory(text, product) {
  if (product === 'claude-code') return 'developer-tool'
  if (product === 'social') return 'feature'
  const normalized = text.toLowerCase()
  const namesModel = /\b(?:gpt[- ](?:\d|image|live|realtime|transcribe)|claude[- ](?:opus|sonnet|haiku|\d)|o\d(?:\b|-))/.test(normalized)
  const lifecycle = /\b(?:new model|released|launched|deprecat\w*|retir\w*|model snapshots?|chat-latest snapshot)\b/.test(normalized)
  if (namesModel && lifecycle) return 'new-model'
  if (/\b(codex|claude code|sdk|cli|command line|vs ?code|mcp|developer tool)\b/.test(normalized)) return 'developer-tool'
  if (/\b(api|endpoint|parameter|header|rate limit|pricing|token|prompt cach|v1\/)\b/.test(normalized)) return 'api-change'
  return 'feature'
}

function extractSubjects(raw, metadata = '') {
  const values = []
  for (const match of raw.matchAll(/`([^`\n]{1,80})`/g)) values.push(match[1])
  for (const match of metadata.matchAll(/(?:Model|API):\s*([^·]+)/gi)) values.push(match[1].trim())
  return [...new Set(values.filter(value => /^[\w./:+ -]{1,80}$/.test(value)))].slice(0, 12)
}

function extractEffectiveAt(text) {
  const match = text.match(/(?:shut down|shutdown|removed|retired|effective)(?:\s+on|\s+date\s*(?:is|:))?\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
  return match ? parseDateText(match[1]) : null
}

function extractReplacement(raw) {
  return raw.match(/(?:migrate|switch|replacement|replace(?:d)?)(?:\s+from\s+`[^`]+`)?\s+(?:to|is)\s+`([^`]{1,80})`/i)?.[1] ?? null
}

const RETIREMENT_DATE_HEADER = /\b(?:shutdown|retirement)\s+date\b/i
const RETIREMENT_MODEL_HEADER = /\b(?:model|system|snapshot|endpoint)/i
const RETIREMENT_REPLACEMENT_HEADER = /\breplacement\b/i
const MAX_RETIREMENTS = 12

function isTableLine(line) {
  return line.trim().startsWith('|')
}

// 儲存格內的 \| 是同一格裡的多個名稱（例如別名與快照），不是欄位分隔。
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, ' / ').trim())
}

// 停用公告的重點（哪些型號、哪天停用、改用什麼）都在表格裡；壓成一段文字後就讀不出來，所以逐列解析。
export function extractRetirements(raw) {
  const rows = []
  const lines = String(raw ?? '').split('\n')
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableLine(lines[index]) || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue
    const header = tableCells(lines[index])
    const dateIndex = header.findIndex(cell => RETIREMENT_DATE_HEADER.test(cell))
    const replacementIndex = header.findIndex(cell => RETIREMENT_REPLACEMENT_HEADER.test(cell))
    const modelIndex = header.findIndex((cell, cellIndex) => (
      cellIndex !== dateIndex && cellIndex !== replacementIndex && RETIREMENT_MODEL_HEADER.test(cell)
    ))
    if (dateIndex < 0 || modelIndex < 0) continue
    for (let rowIndex = index + 2; rowIndex < lines.length && isTableLine(lines[rowIndex]); rowIndex += 1) {
      const cells = tableCells(lines[rowIndex])
      const model = truncate(stripMarkdown(cells[modelIndex] ?? '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'), 120)
      if (!model) continue
      const replacement = replacementIndex >= 0 ? truncate(stripMarkdown(cells[replacementIndex] ?? ''), 120) : ''
      rows.push({ model, date: parseDateText(stripMarkdown(cells[dateIndex] ?? '')), replacement: replacement || null })
      if (rows.length >= MAX_RETIREMENTS) return rows
    }
  }
  return rows
}

function metadataAndBody(raw) {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  if (/^(Feature|Update|Fix|Announcement)(?:\s*·.*)?$/i.test(lines[0] ?? '')) {
    return { metadata: lines[0], body: lines.slice(1).join('\n') }
  }
  return { metadata: '', body: lines.join('\n') }
}

function normalizeUpdate(definition, rawEntry) {
  const { metadata, body } = metadataAndBody(rawEntry.body)
  const plain = stripMarkdown(body)
  if (!plain) return null
  const retirements = extractRetirements(body)
  // 表格已另外解析；摘要只留說明文字，分類仍用全文判斷。
  const prose = retirements.length ? stripMarkdown(body.split('\n').filter(line => !isTableLine(line)).join('\n')) : plain
  const retirementDates = retirements.map(row => row.date).filter(Boolean).sort()
  const replacements = [...new Set(retirements.map(row => row.replacement).filter(Boolean))]
  const title = rawEntry.headingTitle || firstSentence(body)
  const version = rawEntry.version ?? null
  const canonicalBody = stripMarkdown(rawEntry.body)
  const identity = [definition.id, rawEntry.publishedAt ?? '', version ?? '', title, stableHash(canonicalBody)].join('\n')
  return {
    id: `${definition.provider}-${stableHash(identity)}`,
    sourceId: definition.id,
    provider: definition.provider,
    product: definition.product,
    category: inferCategory(`${metadata} ${title} ${plain}`, definition.product),
    changeType: inferChangeType(`${metadata} ${title} ${plain}`, stripMarkdown(title)),
    title: truncate(stripMarkdown(title), 180),
    // 條列式來源大多一條只有一句，標題就是全文；不重複存一份，狀態才放得進 256 KB 的面板訊息上限。
    summary: prose === stripMarkdown(title) ? '' : truncate(prose, 700),
    publishedAt: rawEntry.publishedAt ?? null,
    effectiveAt: extractEffectiveAt(plain) ?? retirementDates[0] ?? null,
    version,
    subjects: extractSubjects(rawEntry.body, metadata),
    replacement: extractReplacement(rawEntry.body) ?? (replacements.length === 1 ? truncate(replacements[0], 80) : null),
    ...(retirements.length ? { retirements } : {}),
    sourceUrl: rawEntry.sourceUrl ?? definition.publicUrl,
  }
}

function extractDatedSections(markdown) {
  const sections = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let contextYear = null
  let current = null
  const push = () => {
    if (current?.lines.some(line => line.trim())) sections.push(current)
    current = null
  }
  for (const line of lines) {
    const heading = line.match(/^(#{2,3})\s+(.+?)\s*$/)
    if (heading) {
      const month = heading[2].match(/^[A-Za-z]+,\s*(\d{4})$/)
      if (month) { push(); contextYear = Number(month[1]); continue }
      const publishedAt = parseDateText(heading[2], contextYear)
      if (publishedAt) {
        push()
        current = {
          publishedAt,
          headingTitle: heading[2].replace(/^\d{4}-\d{2}-\d{2}:?\s*/, '').replace(/^[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?:?\s*/, '').trim(),
          lines: [],
        }
        continue
      }
      if (current && heading[1].length <= 2) push()
    }
    if (current) current.lines.push(line)
  }
  push()
  return sections
}

function splitTopLevelBullets(lines) {
  const chunks = []
  let current = null
  for (const line of lines) {
    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) { if (current) chunks.push(current.join('\n')); current = [bullet[1]] } else if (current) current.push(line)
  }
  if (current) chunks.push(current.join('\n'))
  return chunks.filter(chunk => stripMarkdown(chunk))
}

export function parseDatedMarkdown(definition, markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return []
  const updates = []
  for (const section of extractDatedSections(markdown)) {
    const bullets = definition.splitBullets ? splitTopLevelBullets(section.lines) : []
    for (const [position, chunk] of (bullets.length ? bullets : [section.lines.join('\n')]).entries()) {
      const update = normalizeUpdate(definition, { body: chunk, publishedAt: section.publishedAt, headingTitle: section.headingTitle })
      if (update) updates.push(bullets.length ? { ...update, position } : update)
      if (updates.length >= definition.maxItems) return updates
    }
  }
  return updates
}

export function parseGithubReleases(definition, jsonText) {
  let releases
  try { releases = JSON.parse(jsonText) } catch { throw new Error('invalid_github_json') }
  if (!Array.isArray(releases)) throw new Error('invalid_github_json')
  const updates = []
  for (const release of releases.slice(0, 10)) {
    if (!release || typeof release.tag_name !== 'string') continue
    const version = truncate(release.tag_name, 80)
    const published = typeof release.published_at === 'string' ? new Date(release.published_at) : null
    const publishedAt = published && Number.isFinite(published.getTime()) ? published.toISOString().slice(0, 10) : null
    const sourceUrl = typeof release.html_url === 'string' && /^https:\/\/github\.com\/anthropics\/claude-code\/releases\//.test(release.html_url)
      ? release.html_url : definition.publicUrl
    const chunks = splitTopLevelBullets(typeof release.body === 'string' ? release.body.replace(/\r\n?/g, '\n').split('\n') : [])
    const releaseUpdates = []
    for (const [position, chunk] of chunks.entries()) {
      const update = normalizeUpdate(definition, { body: chunk, publishedAt, headingTitle: '', version, sourceUrl })
      if (update) releaseUpdates.push({ ...update, position })
    }
    // 面板以版本為單位顯示，只收完整版本，否則版本卡的分類數量會少算；最新版本超過上限時才截斷。
    if (updates.length > 0 && updates.length + releaseUpdates.length > definition.maxItems) break
    updates.push(...releaseUpdates.slice(0, definition.maxItems))
    if (updates.length >= definition.maxItems) break
  }
  return updates
}

function decodeHtmlText(value) {
  const decodePoint = (digits, radix) => {
    const point = Number.parseInt(digits, radix)
    return Number.isInteger(point) && point >= 0 && point <= 0x10FFFF ? String.fromCodePoint(point) : ''
  }
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, digits) => decodePoint(digits, 16))
    .replace(/&#(\d{1,7});/g, (_match, digits) => decodePoint(digits, 10))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'").replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function localDateKey(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function normalizedTiboUpdate({ id, text, createdAt, timeZone, postKind, replyToId = null }) {
  const definition = SOURCE_DEFINITIONS.find(source => source.id === 'tibo-x')
  const update = normalizeUpdate(definition, {
    body: text, headingTitle: '', publishedAt: localDateKey(createdAt, timeZone),
    sourceUrl: `https://x.com/${definition.username}/status/${id}`,
  })
  return update ? {
    ...update, id: `x-${id}`, publishedAtTime: createdAt.toISOString(), postKind,
    ...(replyToId ? { replyToId: `x-${replyToId}` } : {}),
  } : null
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
  for (let index = 0; index < matches.length && updates.length < 20; index += 1) {
    const id = matches[index][1]
    if (seen.has(id)) continue
    seen.add(id)
    const start = matches[index].index ?? 0
    const end = matches[index + 1]?.index ?? Math.min(html.length, start + 100_000)
    const fragment = html.slice(start, end)
    const timestamp = Number(fragment.match(POST_TIMESTAMP_PATTERN)?.[1])
    const textMatch = fragment.match(POST_TEXT_PATTERN)
    if (!Number.isFinite(timestamp) || !textMatch) continue
    const createdAt = new Date(timestamp)
    if (createdAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS || localDateKey(createdAt, options.timeZone) !== today) continue
    const update = normalizedTiboUpdate({ id, text: decodeHtmlText(textMatch[1]), createdAt, timeZone: options.timeZone, postKind: 'root' })
    if (update) updates.push(update)
  }
  return updates
}

function conversationPayloads(html) {
  const payloads = []
  let inspected = 0
  for (const match of html.matchAll(new RegExp(EMBEDDED_VALUE_PATTERN.source, 'g'))) {
    if (++inspected > 100) break
    try {
      const decoded = JSON.parse(match[1])
      if (!decoded.includes('threaded_conversation_with_injections_v2')) continue
      const payload = JSON.parse(decoded)
      if (payload?.data?.threaded_conversation_with_injections_v2) payloads.push(payload)
    } catch {}
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
      if (entry?.content?.content?.tweet_results) results.push(entry.content.content.tweet_results)
      for (const item of (Array.isArray(entry?.content?.items) ? entry.content.items.slice(0, 100) : [])) {
        if (item?.item?.content?.tweet_results) results.push(item.item.content.tweet_results)
      }
    }
  }
  return results
}

export function parseTiboSelfReplies(html, options = {}) {
  const rootId = String(options.rootId ?? '')
  if (typeof html !== 'string' || !/^\d{1,19}$/.test(rootId) || !html.includes(rootId)) throw new Error('x_conversation_invalid')
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  const today = localDateKey(now, options.timeZone)
  const payloads = conversationPayloads(html)
  if (!Number.isFinite(now.getTime()) || payloads.length === 0) throw new Error('x_conversation_format_changed')
  const candidates = new Map()
  for (const payload of payloads) {
    for (const tweetResult of timelineTweetResults(payload)) {
      const tweet = tweetResult?.result
      const id = String(tweetResult?.rest_id ?? tweet?.rest_id ?? '')
      const replyToId = String(tweet?.reply_to_results?.rest_id ?? '')
      if (!/^\d{1,19}$/.test(id) || candidates.has(id)
        || tweet?.core?.user_results?.result?.core?.screen_name !== 'thsottiaux'
        || tweet?.reply_to_user_results?.result?.core?.screen_name !== 'thsottiaux'
        || !/^\d{1,19}$/.test(replyToId)) continue
      candidates.set(id, { id, replyToId, tweet })
    }
  }
  const updates = []
  const parents = new Set([rootId])
  const pending = [...candidates.values()]
  for (let pass = 0; pass < 20 && pending.length > 0; pass += 1) {
    let accepted = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const candidate = pending[index]
      if (!parents.has(candidate.replyToId)) continue
      pending.splice(index, 1)
      const timestamp = Number(candidate.tweet?.details?.created_at_ms)
      const text = typeof candidate.tweet?.details?.full_text === 'string' ? candidate.tweet.details.full_text.trim() : ''
      const createdAt = new Date(timestamp)
      if (!Number.isFinite(timestamp) || !text || createdAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS
        || localDateKey(createdAt, options.timeZone) !== today) continue
      const update = normalizedTiboUpdate({ id: candidate.id, text, createdAt, timeZone: options.timeZone, postKind: 'self-reply', replyToId: candidate.replyToId })
      if (update) { updates.push(update); parents.add(candidate.id); accepted = true }
    }
    if (!accepted) break
  }
  return updates
}

export function parseSource(definition, body) {
  if (definition.kind === 'dated-markdown') return parseDatedMarkdown(definition, body)
  if (definition.kind === 'github-releases') return parseGithubReleases(definition, body)
  throw new Error('unsupported_source_kind')
}

export function sortUpdates(updates) {
  return [...updates].sort((left, right) => {
    const date = String(right.publishedAtTime ?? right.publishedAt ?? '').localeCompare(String(left.publishedAtTime ?? left.publishedAt ?? ''))
    return date || left.sourceId.localeCompare(right.sourceId) || left.id.localeCompare(right.id)
  })
}

export function withVersionComparisons(updates) {
  const sorted = sortUpdates(updates)
  return sorted.map((update, index) => {
    if (!update.version) return update
    const previous = sorted.slice(index + 1).find(candidate => (
      candidate.sourceId === update.sourceId && candidate.version && candidate.version !== update.version
    ))
    return previous ? { ...update, previousVersion: previous.version } : update
  })
}
