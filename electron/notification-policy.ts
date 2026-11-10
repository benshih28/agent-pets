import type { AgentStatusEvent } from './event-server'
import { t, type TranslationKey } from '../src/i18n.ts'
import { AGENT_FAMILY_REGISTRY, AGENT_SOURCE_REGISTRY, AGENT_STATE_POLICY, isAgentSource, isAgentState, type NotifiableAgentState } from '../src/types/agent.ts'

export type NotificationKind = NotifiableAgentState | 'achievement' | 'summary'

export interface NotificationCandidate {
  key: string
  kind: NotificationKind
  title: string
  body: string
  terminal: boolean
  /** 只有非結束類（等待權限／等待輸入）才有：正在等使用者的那個 session，點通知時可切到它的 App。 */
  session?: { source: string; sessionId: string }
}

// 通知標題用家族名稱（CLI 與 Desktop 同名）；來源不在 registry 裡時退回通用字。
function sourceName(source: unknown): string {
  return isAgentSource(source) ? AGENT_FAMILY_REGISTRY[AGENT_SOURCE_REGISTRY[source].family].label : 'Agent'
}

// 哪些狀態要通知、是不是結束類由 AGENT_STATE_POLICY 決定；這裡只補主程序才有的標題文案。
// 狀態表新增一個會通知的狀態時，這張表少一格就編譯失敗。
const NOTIFICATION_TITLE_KEYS = {
  'waiting-permission': 'notificationNeedsPermission',
  'waiting-input': 'notificationWaitingInput',
  success: 'notificationCompleted',
  error: 'notificationFailed',
} as const satisfies Record<NotifiableAgentState, TranslationKey>

function isNotifiableState(state: unknown): state is NotifiableAgentState {
  return isAgentState(state) && AGENT_STATE_POLICY[state].notification !== null
}

function notificationTitle(event: AgentStatusEvent, kind: NotifiableAgentState, source: string): string {
  // Codex／Claude 的權限無法在 Agent Pets 裡回覆，標題要講明，免得使用者以為點通知就能核准。
  if (kind === 'waiting-permission' && event.permissionNotice?.responseMode === 'external_only') {
    return t('permission.notifyExternal', { source })
  }
  return t(NOTIFICATION_TITLE_KEYS[kind], { source })
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
  if (!isNotifiableState(event.state)) return null

  const source = sourceName(event.source)
  const project = displayText(event.project)
  const body = project || t('agentTask')
  const keyBase = `${event.source}:${event.sessionId}`

  const kind = event.state
  const terminal = AGENT_STATE_POLICY[kind].notification.terminal
  return {
    key: `${keyBase}:${kind}`,
    kind,
    title: notificationTitle(event, kind, source),
    body,
    terminal,
    ...(terminal ? {} : { session: { source: event.source, sessionId: event.sessionId } }),
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
