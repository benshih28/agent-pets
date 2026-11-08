import type { AgentSession, AgentSource } from '@/types/agent'
import { SOURCE_FAMILIES, STATE_PRIORITY } from '../types/agent.ts'

// States that wait on the user; among these the most recent one is shown first.
const ATTENTION_STATES: ReadonlySet<AgentSession['state']> = new Set(['waiting-permission', 'waiting-input', 'error'])

// "Who needs you" ordering: higher state priority first. Among waiting sessions the most recent
// wins (it rarely changes: waiting sessions send few events). Among working sessions lastSeenAt
// changes on every heartbeat, so the tie-break is the stable firstSeenAt (oldest first), then the
// key; otherwise two busy sessions would swap the line (and the multi-pet sprite) on each event.
export function compareAttention(a: AgentSession, b: AgentSession): number {
  const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
  if (priorityDelta !== 0) return priorityDelta
  if (ATTENTION_STATES.has(a.state)) {
    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta
  } else {
    const ageDelta = (a.firstSeenAt ?? a.lastSeenAt) - (b.firstSeenAt ?? b.lastSeenAt)
    if (ageDelta !== 0) return ageDelta
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export interface FamilyAttention<T extends AgentSession = AgentSession> {
  key: string
  label: string
  /** Most urgent active session of the family (compareAttention order). */
  top: T
  count: number
  sources: ReadonlySet<AgentSource>
}

const FAMILY_BY_SOURCE: ReadonlyMap<AgentSource, number> = new Map(
  SOURCE_FAMILIES.flatMap((family, index) => family.sources.map(source => [source, index] as const)),
)

/**
 * One pass over every session: per tool family, the most urgent active session, the active count
 * and which sources are active. O(n) with no sort, so it is cheap to recompute on every event.
 * Families come back in SOURCE_FAMILIES order; families with no active session are omitted.
 */
export function summarizeFamilies<T extends AgentSession>(sessions: Iterable<T>): FamilyAttention<T>[] {
  const slots: Array<{ top: T; count: number; sources: Set<AgentSource> } | undefined> = new Array(SOURCE_FAMILIES.length)
  for (const session of sessions) {
    if (session.state === 'offline') continue
    const index = FAMILY_BY_SOURCE.get(session.source)
    if (index === undefined) continue
    const slot = slots[index]
    if (!slot) {
      slots[index] = { top: session, count: 1, sources: new Set([session.source]) }
      continue
    }
    slot.count += 1
    slot.sources.add(session.source)
    if (compareAttention(session, slot.top) < 0) slot.top = session
  }
  const result: FamilyAttention<T>[] = []
  SOURCE_FAMILIES.forEach((family, index) => {
    const slot = slots[index]
    if (slot) result.push({ key: family.key, label: family.label, top: slot.top, count: slot.count, sources: slot.sources })
  })
  return result
}

/** The single most urgent active session, O(n). */
export function mostUrgentSession<T extends AgentSession>(sessions: Iterable<T>): T | null {
  let best: T | null = null
  for (const session of sessions) {
    if (session.state === 'offline') continue
    if (!best || compareAttention(session, best) < 0) best = session
  }
  return best
}

export interface StatusLineSource {
  label: string
  variants: readonly string[]
  project?: string
}

/**
 * 寵物下方狀態列的完整文字（tooltip / aria-label）。寵物寬度只有約 250px，狀態列本身維持
 * 單行細條，只畫「名稱 · 狀態」：狀態永遠完整、名稱先縮。CLI/Desktop 變體與專案名稱只放在
 * 這段完整文字裡；其他工作階段的數量不再顯示。
 */
export function statusLineText(line: StatusLineSource, stateLabel: string): string {
  const nameWithVariants = line.label && line.variants.length > 0
    ? `${line.label} (${line.variants.join('+')})`
    : line.label
  return [nameWithVariants, line.project, stateLabel].filter(Boolean).join(' · ')
}
