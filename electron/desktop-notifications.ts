import { Notification } from 'electron'
import type { DesktopPreferences } from '../src/types/desktop'
import type { AchievementUnlock } from '../src/types/achievement'
import type { AgentStatusEvent } from './event-server'
import { t } from '../src/i18n.ts'
import { AttentionTracker, type AttentionRequestLike, type AttentionSummary } from './attention-tracker'
import { readBoundedJson, writeJsonAtomic } from './desktop-preferences'
import {
  aggregateTerminalNotifications,
  classifyNotification,
  NotificationCooldown,
  type NotificationCandidate,
  type NotificationKind,
} from './notification-policy'

type NotificationOutcome =
  | 'shown'
  | 'clicked'
  | 'suppressed-cooldown'
  | 'suppressed-dnd'
  | 'suppressed-disabled'
  | 'suppressed-foreground'
  | 'unsupported'

interface NotificationLogRecord {
  at: number
  kind: NotificationKind
  outcome: NotificationOutcome
  count: number
}

export interface NotificationTarget {
  source: string
  sessionId: string
}

interface DesktopNotificationServiceOptions {
  logFilePath: string
  getPreferences: () => DesktopPreferences
  isAppFocused: () => boolean
  /** `target` is set only for a waiting-permission / waiting-input notification about one session. */
  onNotificationClick: (target?: NotificationTarget) => void
  onAttentionChanged: (summary: AttentionSummary) => void
  batchWindowMs?: number
}

const MAX_LOG_RECORDS = 200
const LOG_FLUSH_DELAY_MS = 2_000

export class DesktopNotificationService {
  private readonly options: DesktopNotificationServiceOptions
  private readonly cooldown = new NotificationCooldown()
  private readonly terminalQueue = new Map<string, NotificationCandidate>()
  private readonly batchWindowMs: number
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private readonly attention = new AttentionTracker()
  private lastAttentionKey = ''
  // Newest notification per key: a repeat for the same session replaces the old
  // one instead of stacking in the notification centre.
  private readonly shown = new Map<string, Notification>()
  private dndMissed = 0
  private logRecords: NotificationLogRecord[] | null = null
  private logTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: DesktopNotificationServiceOptions) {
    this.options = options
    this.batchWindowMs = options.batchWindowMs ?? 10_000
  }

  handleEvent(event: AgentStatusEvent): void {
    // Attention is state-based and independent of whether a notification is
    // shown, so DND / cooldown / focus never change what the tray reports.
    if (this.attention.observeEvent(event)) this.emitAttention()
    const candidate = classifyNotification(event)
    if (!candidate) return

    if (!this.cooldown.take(candidate.key)) {
      this.log(candidate.kind, 'suppressed-cooldown')
      return
    }

    if (candidate.terminal) {
      this.terminalQueue.set(candidate.key, candidate)
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushTerminalQueue(), this.batchWindowMs)
      }
      return
    }

    this.deliver(candidate.title, candidate.body, candidate.kind, 1, candidate.key, candidate.session)
  }

  showAchievement(unlock: AchievementUnlock): void {
    const quality = unlock.tokenQuality === 'exact'
      ? t('achievementTokenExact')
      : unlock.tokenQuality === 'estimated'
        ? t('achievementTokenEstimated')
        : ''
    const description = t(unlock.descriptionKey)
    const body = quality
      ? `${description} · ${t('achievementTokenQuality', { quality })}`
      : description
    this.deliver(
      `${t('achievementUnlocked')} · ${t(unlock.titleKey)}`,
      body,
      'achievement',
      1,
    )
  }

  /** Notifications silenced since DND started; resets the counter. */
  takeDndMissedCount(): number {
    const missed = this.dndMissed
    this.dndMissed = 0
    return missed
  }

  showDndSummary(missed: number): void {
    this.deliver(t('permission.dndEndedTitle'), t('permission.dndEndedBody', { count: missed }), 'summary', 1)
  }

  /** Active broker requests; removes the double count with their status events. */
  setPermissionRequests(requests: ReadonlyArray<AttentionRequestLike>): void {
    this.attention.setRequests(requests)
    this.emitAttention()
  }

  getAttention(): AttentionSummary {
    return this.attention.summary()
  }

  private emitAttention(): void {
    const summary = this.attention.summary()
    const key = `${summary.permission}/${summary.external}/${summary.input}`
    if (key === this.lastAttentionKey) return
    this.lastAttentionKey = key
    this.options.onAttentionChanged(summary)
  }

  destroy(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer)
    this.batchTimer = null
    this.terminalQueue.clear()
    for (const notification of this.shown.values()) {
      try { notification.close() } catch { /* already gone */ }
    }
    this.shown.clear()
    this.flushLog()
  }

  private flushTerminalQueue(): void {
    this.batchTimer = null
    const candidates = [...this.terminalQueue.values()]
    this.terminalQueue.clear()
    if (candidates.length === 0) return

    const message = aggregateTerminalNotifications(candidates)
    this.deliver(message.title, message.body, candidates[0].kind, candidates.length)
  }

  private deliver(
    title: string,
    body: string,
    kind: NotificationKind,
    count: number,
    key?: string,
    target?: NotificationTarget,
  ): void {
    const preferences = this.options.getPreferences()
    if (!preferences.notificationsEnabled) {
      this.log(kind, 'suppressed-disabled', count)
      return
    }
    if (preferences.dndEnabled) {
      this.dndMissed += count
      this.log(kind, 'suppressed-dnd', count)
      return
    }
    if (this.options.isAppFocused()) {
      this.log(kind, 'suppressed-foreground', count)
      return
    }
    if (!Notification.isSupported()) {
      this.log(kind, 'unsupported', count)
      return
    }

    try {
      if (key) {
        try { this.shown.get(key)?.close() } catch { /* already gone */ }
      }
      const notification = new Notification({ title, body, silent: true })
      if (key) this.shown.set(key, notification)
      if (this.shown.size > 200) this.shown.delete(this.shown.keys().next().value as string)
      notification.on('click', () => {
        this.log(kind, 'clicked', count)
        this.options.onNotificationClick(target ? { ...target } : undefined)
      })
      notification.show()
      this.log(kind, 'shown', count)
    } catch {
      this.log(kind, 'unsupported', count)
    }
  }

  private log(kind: NotificationKind, outcome: NotificationOutcome, count = 1): void {
    if (!this.logRecords) {
      const existing = readBoundedJson(this.options.logFilePath)
      this.logRecords = Array.isArray(existing)
        ? existing.filter((record): record is NotificationLogRecord => (
            Boolean(record)
            && typeof record === 'object'
            && typeof record.at === 'number'
            && typeof record.kind === 'string'
            && typeof record.outcome === 'string'
            && typeof record.count === 'number'
          ))
        : []
    }
    this.logRecords.push({ at: Date.now(), kind, outcome, count })
    if (this.logRecords.length > MAX_LOG_RECORDS) this.logRecords.splice(0, this.logRecords.length - MAX_LOG_RECORDS)
    // Debounced: event bursts no longer re-read and rewrite the file each time.
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => this.flushLog(), LOG_FLUSH_DELAY_MS)
      this.logTimer.unref?.()
    }
  }

  private flushLog(): void {
    if (this.logTimer) clearTimeout(this.logTimer)
    this.logTimer = null
    if (!this.logRecords) return
    try {
      writeJsonAtomic(this.options.logFilePath, this.logRecords)
    } catch {
      // Notification logging is diagnostic only. A read-only/corrupt userData
      // directory must never break event ingestion or Agent state updates.
    }
  }
}
