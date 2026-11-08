import type { AgentSession, AgentSource, AgentState } from '../types/agent.ts'

// Pure view helpers for the Sessions list: grouping by urgency, filtering,
// project-name disambiguation and compact elapsed formatting.

export type SessionBucket = 'attention' | 'running' | 'other'
export type SessionFilter = 'all' | 'attention' | 'running'
export type SessionSort = 'priority' | 'recent'

const ATTENTION_STATES: ReadonlySet<AgentState> = new Set(['waiting-permission', 'waiting-input', 'error'])
const RUNNING_STATES: ReadonlySet<AgentState> = new Set(['thinking', 'tool-running'])

export function sessionBucket(state: AgentState): SessionBucket {
  if (ATTENTION_STATES.has(state)) return 'attention'
  if (RUNNING_STATES.has(state)) return 'running'
  return 'other'
}

export interface SessionGroups {
  attention: AgentSession[]
  running: AgentSession[]
  other: AgentSession[]
  offline: AgentSession[]
}

export interface SessionViewOptions {
  filter: SessionFilter
  /** Restrict to these sources (a tool family); null = every source. */
  sources: readonly AgentSource[] | null
  sort: SessionSort
}

export function groupSessions(sessions: readonly AgentSession[], options: SessionViewOptions): SessionGroups {
  const groups: SessionGroups = { attention: [], running: [], other: [], offline: [] }
  for (const session of sessions) {
    if (options.sources && !options.sources.includes(session.source)) continue
    if (session.state === 'offline') { groups.offline.push(session); continue }
    const bucket = sessionBucket(session.state)
    if (options.filter !== 'all' && options.filter !== bucket) continue
    groups[bucket].push(session)
  }
  const byRecent = (a: AgentSession, b: AgentSession) => b.lastSeenAt - a.lastSeenAt
  if (options.sort === 'recent') for (const key of ['attention', 'running', 'other'] as const) groups[key].sort(byRecent)
  groups.offline.sort(byRecent)
  return groups
}

export function countByBucket(sessions: readonly AgentSession[]): Record<SessionBucket, number> {
  const counts: Record<SessionBucket, number> = { attention: 0, running: 0, other: 0 }
  for (const session of sessions) {
    if (session.state !== 'offline') counts[sessionBucket(session.state)] += 1
  }
  return counts
}

function pathSegments(project: string): string[] {
  return project.split(/[/\\]/).filter(Boolean)
}

// Last path segment; when two different projects share it, prefix the parent
// directory so "app" and "app" read as "work/app" and "play/app".
export function projectLabels(projects: readonly (string | undefined)[]): Map<string, string> {
  const labels = new Map<string, string>()
  const byBase = new Map<string, Set<string>>()
  for (const project of projects) {
    if (!project) continue
    const base = pathSegments(project).at(-1) ?? project
    const set = byBase.get(base) ?? new Set<string>()
    set.add(project)
    byBase.set(base, set)
  }
  for (const [base, fullPaths] of byBase) {
    for (const full of fullPaths) {
      const segments = pathSegments(full)
      labels.set(full, fullPaths.size > 1 && segments.length > 1 ? `${segments.at(-2)}/${base}` : base)
    }
  }
  return labels
}

// 12s, 1:05, 1:02:03 — whole seconds, since the list repaints once a second.
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  if (total < 60) return `${total}s`
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
