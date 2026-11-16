// 寵物心情（短期、只在 renderer）：完成工具、持續工作與成功會加分，失敗扣分，每天回到起始值。
// 長期的 XP 與等級由主程序的 Progression 服務決定，這裡不碰。
//
// - 事件輸入：`awardTaskProgress()`（每個 agent 狀態事件）、`rewardOutcome()`（session 進入 success／error）、
//   `forgetTask()`（session 被移除、淘汰或標成 offline）、`patPet()`、`resetMood()`。
// - 計時器：無；時間加分以事件的 timestamp 計算。
// - storage：`agent-pet-mood`、`-mood-date`、`-mood-version`、`-mood-visuals`、`-pat`（見 STORAGE_KEYS）；
//   store 建立時版本不同或跨日就寫入重設值。
// - 跨視窗同步：`mood` 與 `moodVisualsEnabled` 由 App.vue 的 storage 事件直接寫入這兩個 ref。
import { ref } from 'vue'
import type { AgentState, AgentStatusEvent } from '@/types/agent'
import type { PresentationMood } from '@/types/presentation'
import { readStored, writeStored } from '@/utils/local-storage'
import { MOOD_BASELINE, MOOD_SYSTEM_VERSION, STORAGE_KEYS } from '@/utils/storage-keys'

const MOOD_SUCCESS_REWARD = 4
const MOOD_ERROR_PENALTY = 6
const MOOD_TOOL_COMPLETIONS_PER_POINT = 2
const MOOD_TOOL_PROGRESS_CAP = 8
const MOOD_TIME_INTERVAL_MS = 5 * 60_000
const MOOD_TIME_PROGRESS_CAP = 4
// Petting the pet lifts its mood a little, capped per day so it cannot be farmed.
const PAT_DAILY_LIMIT = 5

const WORKING_STATES: ReadonlySet<AgentState> = new Set(['thinking', 'tool-running', 'waiting-permission', 'waiting-input'])
const TASK_END_STATES: ReadonlySet<AgentState> = new Set(['success', 'error', 'idle', 'offline'])

interface MoodTaskProgress {
  startedAt: number
  completedTools: number
  toolPoints: number
  timePoints: number
}

// Resets to baseline at the start of each new (local) day — a fresh start
// rather than carrying yesterday's mood forward indefinitely.
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function clampMood(value: number): number {
  if (Number.isNaN(value)) return MOOD_BASELINE
  return Math.max(0, Math.min(100, value))
}

function persistMoodReset() {
  writeStored(STORAGE_KEYS.mood, MOOD_BASELINE)
  writeStored(STORAGE_KEYS.moodDate, todayKey())
  writeStored(STORAGE_KEYS.moodVersion, MOOD_SYSTEM_VERSION)
}

export function moodLabel(value: number): PresentationMood {
  if (value >= 70) return 'happy'
  if (value <= 25) return 'low'
  return 'neutral'
}

export function usePetMood() {
  // 版本不同（migration）或跨日都重設回起始值。
  const needsMoodReset = readStored(STORAGE_KEYS.moodVersion) !== MOOD_SYSTEM_VERSION
    || readStored(STORAGE_KEYS.moodDate) !== todayKey()
  if (needsMoodReset) persistMoodReset()
  const mood = ref(needsMoodReset ? MOOD_BASELINE : clampMood(readStored(STORAGE_KEYS.mood)))
  const moodVisualsEnabled = ref(readStored(STORAGE_KEYS.moodVisuals))
  const taskProgress = new Map<string, MoodTaskProgress>()

  function adjustMood(delta: number) {
    mood.value = clampMood(mood.value + delta)
    writeStored(STORAGE_KEYS.mood, mood.value)
  }

  // Always sets to the low daily baseline, so the visible energy build-up is
  // earned through successful tasks rather than starting halfway charged.
  function resetMood() {
    mood.value = MOOD_BASELINE
    taskProgress.clear()
    persistMoodReset()
  }

  function patPet(): boolean {
    const today = todayKey()
    const saved = readStored(STORAGE_KEYS.patCount)
    const count = saved.day === today ? saved.count : 0
    if (count >= PAT_DAILY_LIMIT) return false
    writeStored(STORAGE_KEYS.patCount, { day: today, count: count + 1 })
    adjustMood(1)
    return true
  }

  function setMoodVisualsEnabled(enabled: boolean) {
    moodVisualsEnabled.value = enabled
    writeStored(STORAGE_KEYS.moodVisuals, enabled)
  }

  /** 目前這個 session 的工作從何時開始；給完成泡泡算用時（要在 `awardTaskProgress` 清掉之前讀）。 */
  function taskStartedAt(key: string): number | undefined {
    return taskProgress.get(key)?.startedAt
  }

  function forgetTask(key: string) {
    taskProgress.delete(key)
  }

  // Light meta-progression rewards completed tools, sustained work, and
  // successful finishes while errors pull it down. It has no gameplay
  // stakes, just a bit of a "the pet has been having a good day" feel.
  function awardTaskProgress(event: AgentStatusEvent, key: string, prevState?: AgentState) {
    const eventAt = Number.isFinite(event.timestamp) ? event.timestamp : Date.now()
    const explicitTaskStart = event.originalEvent === 'UserPromptSubmit'
    const resumedFromTerminal = prevState !== undefined && TASK_END_STATES.has(prevState)

    if (explicitTaskStart || (WORKING_STATES.has(event.state) && (!taskProgress.has(key) || resumedFromTerminal))) {
      taskProgress.set(key, { startedAt: eventAt, completedTools: 0, toolPoints: 0, timePoints: 0 })
    }

    const progress = taskProgress.get(key)
    if (!progress) return

    let reward = 0
    if (prevState === 'tool-running' && event.state === 'thinking') {
      progress.completedTools += 1
      const earnedToolPoints = Math.min(
        MOOD_TOOL_PROGRESS_CAP,
        Math.floor(progress.completedTools / MOOD_TOOL_COMPLETIONS_PER_POINT),
      )
      reward += earnedToolPoints - progress.toolPoints
      progress.toolPoints = earnedToolPoints
    }

    const elapsed = Math.max(0, eventAt - progress.startedAt)
    const earnedTimePoints = Math.min(MOOD_TIME_PROGRESS_CAP, Math.floor(elapsed / MOOD_TIME_INTERVAL_MS))
    reward += earnedTimePoints - progress.timePoints
    progress.timePoints = earnedTimePoints

    if (reward > 0) adjustMood(reward)
    if (TASK_END_STATES.has(event.state)) taskProgress.delete(key)
  }

  function rewardOutcome(state: 'success' | 'error') {
    adjustMood(state === 'success' ? MOOD_SUCCESS_REWARD : -MOOD_ERROR_PENALTY)
  }

  return {
    mood,
    moodVisualsEnabled,
    resetMood,
    patPet,
    setMoodVisualsEnabled,
    taskStartedAt,
    forgetTask,
    awardTaskProgress,
    rewardOutcome,
  }
}
