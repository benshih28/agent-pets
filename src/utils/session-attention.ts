import type { AgentFamilyKey, AgentSession, AgentSource } from '@/types/agent'
import { AGENT_STATE_POLICY, AGENT_STATES, SOURCE_FAMILIES, STATE_PRIORITY } from '../types/agent.ts'

const ATTENTION_STATES: ReadonlySet<AgentSession['state']> = new Set(
  AGENT_STATES.filter(state => AGENT_STATE_POLICY[state].petFocus === 'attention'),
)

// Working sessions tie-break on stable firstSeenAt then key: lastSeenAt changes every heartbeat,
// so two busy sessions would otherwise swap places on each event.
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
  key: AgentFamilyKey
  label: string
  top: T
  count: number
  sources: ReadonlySet<AgentSource>
}

const FAMILY_BY_SOURCE: ReadonlyMap<AgentSource, number> = new Map(
  SOURCE_FAMILIES.flatMap((family, index) => family.sources.map(source => [source, index] as const)),
)

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

const PET_FOCUS_RANK = { attention: 2, recent: 1, background: 0 } as const

// stateChangedAt, not lastSeenAt, so heartbeats from two busy sessions do not make the pet jump.
export function mostUrgentSession<T extends AgentSession>(sessions: Iterable<T>): T | null {
  let best: T | null = null
  for (const session of sessions) {
    if (session.state === 'offline') continue
    if (!best || comparePetFocus(session, best) < 0) best = session
  }
  return best
}

function comparePetFocus(a: AgentSession, b: AgentSession): number {
  const tierA = AGENT_STATE_POLICY[a.state].petFocus
  const tierB = AGENT_STATE_POLICY[b.state].petFocus
  if (tierA !== tierB) return PET_FOCUS_RANK[tierB] - PET_FOCUS_RANK[tierA]
  if (tierA === 'recent') {
    const changedDelta = (b.stateChangedAt ?? b.lastSeenAt) - (a.stateChangedAt ?? a.lastSeenAt)
    if (changedDelta !== 0) return changedDelta
  }
  return compareAttention(a, b)
}

export interface StatusLineSource {
  label: string
  variants: readonly string[]
  project?: string
}

export function statusLineText(line: StatusLineSource, stateLabel: string): string {
  const nameWithVariants = line.label && line.variants.length > 0
    ? `${line.label} (${line.variants.join('+')})`
    : line.label
  return [nameWithVariants, line.project, stateLabel].filter(Boolean).join(' · ')
}
