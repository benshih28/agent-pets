import type { AchievementStore } from '../achievements.ts'
import type { ProgressionStore } from '../progression.ts'
import { createProgressionChangeGate, createVisibleSender } from '../ipc/progression-broadcast-gate.ts'
import { IPC_CHANNELS } from '../ipc/channels.ts'
import type { HistoryTokenUsageRecord } from '../../src/types/history'
import type { AchievementUnlock } from '../../src/types/achievement'
import type { AgentStatusEvent } from '../../src/types/agent'
import type { ProgressionAwardEvent, ProgressionEventResult, ProgressionSnapshot } from '../../src/types/progression'
import type { GrowthResetResult } from '../../src/types/growth-maintenance.ts'
import { DEFAULT_PET_ID } from '../../src/utils/pet-id.ts'
import type { MainState } from './state.ts'

// Init can fail transiently (antivirus/cloud-sync briefly holding the file); retry with backoff instead of silently disabling achievements.
export const ACHIEVEMENT_STORE_RETRY_DELAYS_MS = [3_000, 10_000, 30_000]
export const ACHIEVEMENT_PROGRESS_DEBOUNCE_MS = 1_000
const DAY_MS = 24 * 60 * 60 * 1000

export type GrowthState = Pick<MainState,
  | 'progressionStore' | 'achievementStore' | 'achievementStoreRetryTimer' | 'achievementStoreRetryAttempt'
  | 'historyStore' | 'desktopNotifications'>

export interface GrowthWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface GrowthServiceDeps {
  state: GrowthState
  getWindows(): ReadonlyArray<GrowthWindow | null>
  openProgressionStore(): ProgressionStore
  openAchievementStore(): AchievementStore
  achievementsEnabled(): boolean
  logError(message: string, error?: unknown): void
  logMain(level: 'error', channel: string, message: string, detail?: unknown): void
  now?: () => number
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface GrowthService {
  startProgression(): void
  startAchievements(): void
  handleEvent(event: AgentStatusEvent): void
  activePetId(): string
  setActivePet(petId: string): ProgressionSnapshot | null
  syncLocalTokenUsage(records: readonly HistoryTokenUsageRecord[], retentionDays: number): void
  evaluateLocalTokens(): void
  reconcileFromHistory(): void
  resetGrowth(): GrowthResetResult
  broadcastProgression(snapshot?: ProgressionSnapshot): void
  broadcastProgressionIfChanged(snapshot: ProgressionSnapshot): void
  broadcastProgressionAwards(result: ProgressionEventResult): void
  broadcastAchievements(petId?: string): void
  broadcastAchievementUnlock(unlock: AchievementUnlock): void
  resyncProgression(window: GrowthWindow): void
  logAchievementDiagnostic(label: string, error: unknown, extra?: unknown): void
  /** 釋放順序：progression close → 重試計時器 → achievement close。 */
  dispose(): void
}

export function createGrowthService(deps: GrowthServiceDeps): GrowthService {
  const { state } = deps
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.setTimeout ?? ((callback, delay) => setTimeout(callback, delay))
  const cancel = deps.clearTimeout ?? (handle => clearTimeout(handle))
  const progressionGate = createProgressionChangeGate()
  const progressionSender = createVisibleSender<GrowthWindow>()
  let achievementProgressTimer: ReturnType<typeof setTimeout> | null = null
  let localTokenLedgerChanged = false

  function activePetId(): string {
    return state.progressionStore?.getActivePetId() ?? DEFAULT_PET_ID
  }

  function sendProgressionTo(window: GrowthWindow): void {
    const snapshot = state.progressionStore?.getSnapshot()
    if (snapshot) window.webContents.send(IPC_CHANNELS.progressionUpdated, snapshot)
  }

  function resyncProgression(window: GrowthWindow): void {
    progressionSender.resync(window, sendProgressionTo)
  }

  function broadcastProgression(snapshot?: ProgressionSnapshot): void {
    const next = snapshot ?? state.progressionStore?.getSnapshot()
    if (!next) return
    progressionGate.record(next)
    for (const window of deps.getWindows()) {
      progressionSender.send(window, w => w.webContents.send(IPC_CHANNELS.progressionUpdated, next))
    }
  }

  function broadcastProgressionIfChanged(snapshot: ProgressionSnapshot): void {
    if (!progressionGate.shouldBroadcast(snapshot)) return
    broadcastProgression(snapshot)
  }

  // Awards are already deduplicated by the ledger; the renderer derives toasts and level-ups from this, never XP itself.
  function broadcastProgressionAwards(result: ProgressionEventResult): void {
    if (result.awards.length === 0) return
    const payload: ProgressionAwardEvent = {
      petId: result.snapshot.petId,
      awards: result.awards.map(award => ({ ruleId: award.ruleId, amount: award.amount })),
      at: now(),
      levelBefore: result.levelBefore,
      levelAfter: result.snapshot.level,
      stageBefore: result.stageBefore,
      stageAfter: result.snapshot.evolutionStage,
    }
    for (const window of deps.getWindows()) {
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.progressionAwarded, payload)
      }
    }
  }

  function broadcastAchievements(petId?: string): void {
    const targetPet = petId ?? activePetId()
    const snapshot = state.achievementStore?.getSnapshot(
      targetPet,
      state.progressionStore?.getSnapshot(targetPet),
    )
    if (!snapshot) return
    for (const window of deps.getWindows()) {
      if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.achievementsUpdated, snapshot)
    }
  }

  function broadcastAchievementUnlock(unlock: AchievementUnlock): void {
    state.desktopNotifications?.showAchievement(unlock)
    for (const window of deps.getWindows()) {
      if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.achievementUnlocked, unlock)
    }
    // The gallery must stay scoped to the selected pet rather than jumping to the routed background pet.
    broadcastAchievements()
  }

  function logAchievementDiagnostic(label: string, error: unknown, extra?: unknown): void {
    deps.logMain('error', 'achievements', `[${label}] attempt=${state.achievementStoreRetryAttempt}`, { error, extra })
  }

  function setActivePet(petId: string): ProgressionSnapshot | null {
    if (!state.progressionStore) return null
    const snapshot = state.progressionStore.setActivePet(petId)
    broadcastProgression(snapshot)
    broadcastAchievements(petId)
    return snapshot
  }

  function startProgression(): void {
    if (state.progressionStore) return
    try {
      state.progressionStore = deps.openProgressionStore()
    } catch (error) {
      // A missing SQLite runtime must not prevent the pet from starting; no in-memory fallback is presented as durable XP.
      deps.logError('Progression storage is unavailable', error)
      state.progressionStore = null
    }
  }

  function scheduleAchievementStoreRetry(): void {
    if (state.achievementStoreRetryTimer) return
    const delay = ACHIEVEMENT_STORE_RETRY_DELAYS_MS[state.achievementStoreRetryAttempt]
    if (delay === undefined) return
    state.achievementStoreRetryAttempt += 1
    state.achievementStoreRetryTimer = schedule(() => {
      state.achievementStoreRetryTimer = null
      startAchievements()
    }, delay)
  }

  function startAchievements(): void {
    if (state.achievementStore) return
    try {
      state.achievementStore = deps.openAchievementStore()
      state.achievementStoreRetryAttempt = 0
      if (state.achievementStoreRetryTimer) {
        cancel(state.achievementStoreRetryTimer)
        state.achievementStoreRetryTimer = null
      }
      // A retry can succeed after the renderer's init call came back null; push the snapshot so the gallery recovers without a reload.
      broadcastAchievements()
      reconcileFromHistory()
    } catch (error) {
      // A broken achievement database must never prevent XP, permissions, history, or event ingest.
      deps.logError('Achievement storage is unavailable', error)
      logAchievementDiagnostic('init', error)
      state.achievementStore = null
      scheduleAchievementStoreRetry()
    }
  }

  function handleEvent(event: AgentStatusEvent): void {
    let progressionResult: ProgressionEventResult | undefined
    try {
      progressionResult = state.progressionStore?.handleEvent(event, event.routedPetId)
      if (progressionResult) {
        broadcastProgressionIfChanged(progressionResult.snapshot)
        broadcastProgressionAwards(progressionResult)
      }
    } catch (error) {
      deps.logError('Progression event handling failed', error)
    }
    try {
      // Heartbeat events carry no new fact: do not open the achievement transaction for them.
      if (
        deps.achievementsEnabled()
        && state.achievementStore
        && (event.state === 'success' || event.tokenUsage !== undefined)
      ) {
        const routedPetId = event.routedPetId ?? progressionResult?.snapshot.petId ?? activePetId()
        const unlocks = state.achievementStore.recordEvent(event, routedPetId, progressionResult?.snapshot)
        unlocks.forEach(broadcastAchievementUnlock)
      }
    } catch (error) {
      deps.logError('Achievement event handling failed', error)
      logAchievementDiagnostic('recordEvent', error, event)
    }
  }

  // The ledger always updates so no token is lost while achievements are off; unlock evaluation runs only for the active pet when enabled.
  function syncLocalTokenUsage(records: readonly HistoryTokenUsageRecord[], retentionDays: number): void {
    const store = state.achievementStore
    if (!store) return
    try {
      // Ledger only: a first import arrives in many small batches, so unlock evaluation runs once per scan.
      const result = store.syncLocalTokenUsage(records, {
        // One day of slack past the scanner's own retention cutoff.
        compactBefore: now() - (retentionDays + 1) * DAY_MS,
        evaluatePetId: null,
      })
      if (result.changed) localTokenLedgerChanged = true
    } catch (error) {
      deps.logError('Achievement local token sync failed', error)
      logAchievementDiagnostic('local-token-sync', error)
    }
  }

  function evaluateLocalTokens(): void {
    if (!localTokenLedgerChanged) return
    localTokenLedgerChanged = false
    const store = state.achievementStore
    if (!store) return
    try {
      if (deps.achievementsEnabled()) {
        const petId = activePetId()
        const unlocks = store.evaluateTokenAchievements(petId, state.progressionStore?.getSnapshot(petId))
        unlocks.forEach(broadcastAchievementUnlock)
        if (unlocks.length > 0) return
      }
      if (!achievementProgressTimer) {
        achievementProgressTimer = schedule(() => {
          achievementProgressTimer = null
          broadcastAchievements()
        }, ACHIEVEMENT_PROGRESS_DEBOUNCE_MS)
        achievementProgressTimer.unref?.()
      }
    } catch (error) {
      deps.logError('Achievement local token evaluation failed', error)
      logAchievementDiagnostic('local-token-evaluate', error)
    }
  }

  function reconcileFromHistory(): void {
    if (
      !state.achievementStore
      || !state.historyStore
      || !deps.achievementsEnabled()
    ) return
    try {
      // Incremental: sessions since the last reconcile, minus one day of overlap for late-arriving events.
      const startedAt = now()
      const previous = state.historyStore.getAchievementReconciledAt()
      // 重設成長資料之後只看重設時間以後的 session，否則歷史會把剛清掉的成就補回來。
      const since = Math.max(previous > 0 ? previous - DAY_MS : 0, state.achievementStore.getGrowthResetAt())
      const unlocks = state.achievementStore.reconcileCompletedSessions(
        state.historyStore.getAchievementCompletedSessions(since),
        petId => state.progressionStore?.getSnapshot(petId),
      )
      state.historyStore.setAchievementReconciledAt(startedAt)
      unlocks.forEach(broadcastAchievementUnlock)
    } catch (error) {
      deps.logError('Achievement history reconciliation failed', error)
      logAchievementDiagnostic('history-reconcile', error)
    }
  }

  // 進度與成就是兩個檔案、SQLite 沒有跨檔交易：成就端先 BEGIN IMMEDIATE 並刪完，在提交前呼叫進度端重設（自成交易先提交）；
  // 進度端丟錯就讓成就端回復。唯一的縫隙是進度端提交後成就端 COMMIT 失敗，此時回報 failed，重設可重複執行。
  // 重設時間寫在成就資料庫內、同一個交易提交，之後 reconcile／本機 token 同步都以它為下限。
  function resetGrowth(): GrowthResetResult {
    const progression = state.progressionStore
    const achievements = state.achievementStore
    // 成就資料庫暫時開不起來時不做半套：重設時間存在那裡，缺它就補不了防回灌保護。
    if (!progression || !achievements) return { ok: false, error: 'unavailable' }
    const cutoff = now()
    try {
      achievements.resetGrowth(cutoff, () => { progression.resetGrowth() })
    } catch (error) {
      deps.logError('Growth reset failed', error)
      logAchievementDiagnostic('growth-reset', error)
      return { ok: false, error: 'failed' }
    }
    localTokenLedgerChanged = false
    if (achievementProgressTimer) cancel(achievementProgressTimer)
    achievementProgressTimer = null
    try { state.historyStore?.setAchievementReconciledAt(cutoff) } catch (error) { deps.logError('Growth reset marker failed', error) }
    broadcastProgression()
    broadcastAchievements()
    return { ok: true }
  }

  function dispose(): void {
    state.progressionStore?.close()
    state.progressionStore = null
    if (state.achievementStoreRetryTimer) cancel(state.achievementStoreRetryTimer)
    state.achievementStoreRetryTimer = null
    if (achievementProgressTimer) cancel(achievementProgressTimer)
    achievementProgressTimer = null
    state.achievementStore?.close()
    state.achievementStore = null
  }

  return {
    startProgression,
    startAchievements,
    handleEvent,
    activePetId,
    setActivePet,
    syncLocalTokenUsage,
    evaluateLocalTokens,
    reconcileFromHistory,
    resetGrowth,
    broadcastProgression,
    broadcastProgressionIfChanged,
    broadcastProgressionAwards,
    broadcastAchievements,
    broadcastAchievementUnlock,
    resyncProgression,
    logAchievementDiagnostic,
    dispose,
  }
}
