import { createHash } from 'node:crypto'

const MONTHS = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null
  return date.toISOString().slice(0, 10)
}

function parseDateText(value, fallbackYear) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?::|\b)/)
  if (isoMatch) return isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  const monthMatch = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/)
  if (!monthMatch) return null
  const month = MONTHS[monthMatch[1].toLowerCase()]
  const year = Number(monthMatch[3] ?? fallbackYear)
  if (!month || !Number.isInteger(year)) return null
  return isoDate(year, month, Number(monthMatch[2]))
}

function dateHeadingTitle(value) {
  return value
    .replace(/^\d{4}-\d{2}-\d{2}:?\s*/, '')
    .replace(/^[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?:?\s*/, '')
    .trim()
}

function stripMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?。！？])/g, '$1')
    .trim()
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function firstSentence(value) {
  const clean = stripMarkdown(value)
  const sentence = clean.match(/^(.{24,180}?[.!?。！？])(?:\s|$)/)?.[1]
  return truncate(sentence ?? clean, 180)
}

function extractSubjects(raw, metadata = '') {
  const values = []
  for (const match of raw.matchAll(/`([^`\n]{1,80})`/g)) values.push(match[1])
  for (const match of metadata.matchAll(/(?:Model|API):\s*([^·]+)/gi)) values.push(match[1].trim())
  return [...new Set(values.filter(value => /^[\w./:+ -]{1,80}$/.test(value)))].slice(0, 12)
}

function inferChangeType(text) {
  const normalized = text.toLowerCase()
  if (/\b(deprecat|sunset|retir|shut(?:ting)? down)\w*/.test(normalized)) return 'deprecated'
  if (/\b(remov(?:e|ed|al)|no longer available)\b/.test(normalized)) return 'removed'
  if (/\bfix(?:ed|es)?\b/.test(normalized)) return 'fixed'
  if (/\b(improv(?:e|ed|ement)|updat(?:e|ed)|lowered|reduced|expanded)\b/.test(normalized)) return 'improved'
  return 'added'
}

function inferCategory(text, product) {
  const normalized = text.toLowerCase()
  if (product === 'claude-code') return 'developer-tool'

  const namesModel = /\b(?:gpt[- ](?:\d|image|live|realtime|transcribe)|claude[- ](?:opus|sonnet|haiku|\d)|o\d(?:\b|-))/.test(normalized)
  const isModelLifecycle = /\b(?:new model|released|launched|deprecat\w*|retir\w*|model snapshots?|chat-latest snapshot)\b/.test(normalized)
  if (namesModel && isModelLifecycle) return 'new-model'

  if (/\b(codex|claude code|sdk|cli|command line|vs ?code|mcp|developer tool)\b/.test(normalized)) {
    return 'developer-tool'
  }
  if (/\b(api|endpoint|parameter|header|rate limit|pricing|token|prompt cach|v1\/)\b/.test(normalized)) {
    return 'api-change'
  }
  return 'feature'
}

function extractEffectiveAt(text) {
  const match = text.match(/(?:shut down|shutdown|removed|retired|effective)(?:\s+on|\s+date\s*(?:is|:))?\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
  return match ? parseDateText(match[1]) : null
}

function extractReplacement(raw) {
  const match = raw.match(/(?:migrate|switch|replacement|replace(?:d)?)(?:\s+from\s+`[^`]+`)?\s+(?:to|is)\s+`([^`]{1,80})`/i)
  return match?.[1] ?? null
}

function metadataAndBody(raw) {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  if (/^(Feature|Update|Fix|Announcement)(?:\s*·.*)?$/i.test(first)) {
    return { metadata: first, body: lines.slice(1).join('\n') }
  }
  return { metadata: '', body: lines.join('\n') }
}

export function normalizeUpdate(definition, rawEntry) {
  const { metadata, body } = metadataAndBody(rawEntry.body)
  const plain = stripMarkdown(body)
  if (!plain) return null

  const title = rawEntry.headingTitle || firstSentence(body)
  const comparisonText = `${metadata} ${title} ${plain}`
  const publishedAt = rawEntry.publishedAt ?? null
  const version = rawEntry.version ?? null
  const identity = [definition.id, publishedAt ?? '', version ?? '', title, sha256(rawEntry.body)].join('\n')

  return {
    id: `${definition.provider}-${sha256(identity).slice(0, 24)}`,
    sourceId: definition.id,
    provider: definition.provider,
    product: definition.product,
    category: inferCategory(comparisonText, definition.product),
    changeType: inferChangeType(comparisonText),
    title: truncate(stripMarkdown(title), 180),
    summary: truncate(plain, 700),
    publishedAt,
    effectiveAt: extractEffectiveAt(plain) ?? rawEntry.effectiveAt ?? null,
    version,
    subjects: extractSubjects(rawEntry.body, metadata),
    replacement: extractReplacement(rawEntry.body) ?? rawEntry.replacement ?? null,
    sourceUrl: rawEntry.sourceUrl ?? definition.publicUrl,
    sourceHash: sha256(rawEntry.body),
  }
}

export function extractDatedSections(markdown) {
  const sections = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let contextYear = null
  let current = null

  const pushCurrent = () => {
    if (current && current.lines.some(line => line.trim())) sections.push(current)
    current = null
  }

  for (const line of lines) {
    const heading = line.match(/^(#{2,3})\s+(.+?)\s*$/)
    if (heading) {
      const monthContext = heading[2].match(/^[A-Za-z]+,\s*(\d{4})$/)
      if (monthContext) {
        pushCurrent()
        contextYear = Number(monthContext[1])
        continue
      }

      const publishedAt = parseDateText(heading[2], contextYear)
      if (publishedAt) {
        pushCurrent()
        current = {
          publishedAt,
          headingTitle: dateHeadingTitle(heading[2]),
          lines: [],
        }
        continue
      }

      if (current && heading[1].length <= 2) pushCurrent()
    }

    if (current) current.lines.push(line)
  }

  pushCurrent()
  return sections
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}/
const SHUTDOWN_DATE_HEADER = /\b(?:shutdown|retirement)\s+date\b/i
const NOTICE_DATE_HEADER = /\bnotice\s+date\b/i
const AFFECTED_HEADER = /\baffected\b/i
const REPLACEMENT_HEADER = /\breplacement\b/i
const MAX_NOTICE_TITLE_NAMES = 3

function isTableLine(line) {
  return line.trim().startsWith('|')
}

// 儲存格內的 \| 是同一格裡的多個名稱，不是欄位分隔。
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/)
    .map(cell => cell.replace(/\\\|/g, ' / ').trim())
}

// OpenAI 停用頁改成「停用日 | 受影響項目 | 替代 | 公告日」的總表後就沒有日期標題了。
// 改以公告日分組，一次公告成一筆；只用正規化後的三欄組內容，狀態欄或欄寬改變時識別碼不變。
// 與外掛 plugin/dist/core.js 的同名函式保持相同的分組與識別規則。
export function extractNoticeTableSections(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const groups = new Map()
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableLine(lines[index]) || !TABLE_DIVIDER.test(lines[index + 1])) continue
    const header = tableCells(lines[index])
    const shutdownIndex = header.findIndex(cell => SHUTDOWN_DATE_HEADER.test(cell))
    const noticeIndex = header.findIndex(cell => NOTICE_DATE_HEADER.test(cell))
    const affectedIndex = header.findIndex(cell => AFFECTED_HEADER.test(cell))
    const replacementIndex = header.findIndex(cell => REPLACEMENT_HEADER.test(cell))
    let rowIndex = index + 2
    for (; rowIndex < lines.length && isTableLine(lines[rowIndex]); rowIndex += 1) {
      if (shutdownIndex < 0 || noticeIndex < 0 || affectedIndex < 0) continue
      const cells = tableCells(lines[rowIndex])
      const publishedAt = parseDateText(stripMarkdown(cells[noticeIndex] ?? ''))
      const affected = cells[affectedIndex] ?? ''
      const name = stripMarkdown(affected).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
      if (!publishedAt || !name) continue
      const shutdown = stripMarkdown(cells[shutdownIndex] ?? '')
      const replacement = replacementIndex >= 0 ? cells[replacementIndex] ?? '' : ''
      if (!groups.has(publishedAt)) groups.set(publishedAt, new Map())
      const rows = groups.get(publishedAt)
      const key = `${shutdown}\n${name}`
      if (!rows.has(key)) rows.set(key, { shutdown, affected, replacement, name })
    }
    index = rowIndex - 1
  }

  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([publishedAt, rowMap]) => {
      const rows = [...rowMap.values()].sort((left, right) => {
        // 同一公告的列可能分散在「即將停用」與「已停用」表；固定排序，列跨表移動時標題與識別碼才不會變。
        const leftKey = JSON.stringify([parseDateText(left.shutdown) ?? left.shutdown, left.name, stripMarkdown(left.replacement)])
        const rightKey = JSON.stringify([parseDateText(right.shutdown) ?? right.shutdown, right.name, stripMarkdown(right.replacement)])
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
      })
      const names = rows.slice(0, MAX_NOTICE_TITLE_NAMES).map(row => row.name).join(' · ')
      const more = rows.length > MAX_NOTICE_TITLE_NAMES ? ` +${rows.length - MAX_NOTICE_TITLE_NAMES}` : ''
      const headingTitle = `Deprecated: ${names}${more}`
      const shutdownDates = rows.map(row => parseDateText(row.shutdown)).filter(Boolean).sort()
      const replacements = [...new Set(rows.map(row => stripMarkdown(row.replacement)).filter(Boolean))]
      return {
        publishedAt,
        headingTitle,
        effectiveAt: shutdownDates[0] ?? null,
        replacement: replacements.length === 1 ? truncate(replacements[0], 80) : null,
        lines: [
          headingTitle,
          '',
          '| Shutdown date | Affected model | Recommended replacement |',
          '| --- | --- | --- |',
          ...rows.map(row => `| ${row.shutdown} | ${row.affected} | ${row.replacement} |`),
        ],
      }
    })
}

function splitTopLevelBullets(lines) {
  const chunks = []
  let current = null

  for (const line of lines) {
    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (current) chunks.push(current.join('\n'))
      current = [bullet[1]]
    } else if (current) {
      current.push(line)
    }
  }

  if (current) chunks.push(current.join('\n'))
  return chunks.filter(chunk => stripMarkdown(chunk))
}

export function parseDatedMarkdown(definition, markdown) {
  const updates = []
  const datedSections = extractDatedSections(markdown)
  const sections = datedSections.length ? datedSections : extractNoticeTableSections(markdown)
  for (const section of sections) {
    const bulletChunks = definition.splitBullets ? splitTopLevelBullets(section.lines) : []
    const chunks = bulletChunks.length > 0 ? bulletChunks : [section.lines.join('\n')]

    for (const chunk of chunks) {
      const update = normalizeUpdate(definition, {
        body: chunk,
        publishedAt: section.publishedAt,
        headingTitle: section.headingTitle,
        effectiveAt: section.effectiveAt,
        replacement: section.replacement,
      }, updates.length)
      if (update) updates.push(update)
      if (updates.length >= definition.maxItems) return updates
    }
  }
  return updates
}

export function parseGithubReleases(definition, jsonText) {
  let releases
  try {
    releases = JSON.parse(jsonText)
  } catch {
    throw new Error('invalid_github_json')
  }
  if (!Array.isArray(releases)) throw new Error('invalid_github_json')

  const updates = []
  for (const release of releases.slice(0, 10)) {
    if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string') continue
    const version = release.tag_name.slice(0, 80)
    const publishedDate = typeof release.published_at === 'string' ? new Date(release.published_at) : null
    const publishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
      ? publishedDate.toISOString().slice(0, 10)
      : null
    const sourceUrl = typeof release.html_url === 'string' && /^https:\/\/github\.com\/anthropics\/claude-code\/releases\//.test(release.html_url)
      ? release.html_url
      : definition.publicUrl
    const bodyLines = typeof release.body === 'string' ? release.body.replace(/\r\n?/g, '\n').split('\n') : []
    const chunks = splitTopLevelBullets(bodyLines)

    for (const chunk of chunks) {
      const update = normalizeUpdate(definition, {
        body: chunk,
        publishedAt,
        headingTitle: '',
        version,
        sourceUrl,
      }, updates.length)
      if (update) updates.push(update)
      if (updates.length >= definition.maxItems) return updates
    }
  }
  return updates
}
