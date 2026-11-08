import type { AgentStatusEvent } from './event-server'
import { t } from '../src/i18n.ts'

export type NotificationKind = 'waiting-permission' | 'waiting-input' | 'success' | 'error' | 'achievement' | 'summary'

export interface NotificationCandidate {
  key: string
  kind: NotificationKind
  title: string
  body: string
  terminal: boolean
  /**
   * Only for waiting-permission / waiting-input: the one session that is waiting for the user, so a
   * click on that notification may switch to its app. Completions and errors never switch apps.
   */
  session?: { source: string; sessionId: string }
}

const SOURCE_NAMES: Record<string, string> = {
  'opencode-cli': 'OpenCode',
  'opencode-desktop': 'OpenCode',
  codex: 'Codex',
  'codex-desktop': 'Codex',
  claude: 'Claude',
  'claude-desktop': 'Claude',
}

function displayText(value: string | undefined, maxLength = 96): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function classifyNotification(event: AgentStatusEvent): NotificationCandidate | null {
  if (event.originalEvent === 'AgentPetsIntegrationTest') return null

  const source = SOURCE_NAMES[event.source] ?? 'Agent'
  const project = displayText(event.project)
  const body = project || t('agentTask')
  const keyBase = `${event.source}:${event.sessionId}`
  const session = { source: event.source, sessionId: event.sessionId }

  switch (event.state) {
    case 'waiting-permission':
      return {
        key: `${keyBase}:waiting-permission`,
        kind: 'waiting-permission',
        // Codex / Claude cannot be answered from Agent Pets; say so in the title so
        // clicking the notification is not mistaken for a way to approve here.
        title: event.permissionNotice?.responseMode === 'external_only'
          ? t('permission.notifyExternal', { source })
          : t('notificationNeedsPermission', { source }),
        body,
        terminal: false,
        session,
      }
    case 'waiting-input':
      return {
        key: `${keyBase}:waiting-input`,
        kind: 'waiting-input',
        title: t('notificationWaitingInput', { source }),
        body,
        terminal: false,
        session,
      }
    case 'success':
      return {
        key: `${keyBase}:success`,
        kind: 'success',
        title: t('notificationCompleted', { source }),
        body,
        terminal: true,
      }
    case 'error':
      return {
        key: `${keyBase}:error`,
        kind: 'error',
        title: t('notificationFailed', { source }),
        body,
        terminal: true,
      }
    default:
      return null
  }
}

export class NotificationCooldown {
  private readonly cooldownMs: number
  private readonly seen = new Map<string, number>()

  constructor(cooldownMs = 60_000) {
    this.cooldownMs = cooldownMs
  }

  take(key: string, now = Date.now()): boolean {
    const previous = this.seen.get(key)
    if (previous !== undefined && now - previous < this.cooldownMs) return false
    this.seen.set(key, now)
    if (this.seen.size > 1_000) this.prune(now)
    return true
  }

  private prune(now: number): void {
    for (const [key, seenAt] of this.seen) {
      if (now - seenAt >= this.cooldownMs) this.seen.delete(key)
    }
  }
}

export function aggregateTerminalNotifications(candidates: NotificationCandidate[]): {
  title: string
  body: string
} {
  if (candidates.length === 1) {
    return { title: candidates[0].title, body: candidates[0].body }
  }

  const completed = candidates.filter(candidate => candidate.kind === 'success').length
  const failed = candidates.filter(candidate => candidate.kind === 'error').length
  return {
    title: failed > 0
      ? t('permission.notifyAggregateFailed', { count: candidates.length, failed })
      : t('notificationAggregate', { count: candidates.length }),
    body: [
      completed > 0 ? t('notificationCompletedCount', { count: completed }) : '',
      failed > 0 ? t('notificationFailedCount', { count: failed }) : '',
    ].filter(Boolean).join(' · '),
  }
}
