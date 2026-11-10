import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch, reactive } from 'vue'
import { t, translateBackendError, setLocale as applyLocale } from '@/i18n'
import type {
  AgentSession,
  AgentSource,
  AgentState,
  AgentStatusEvent,
} from '@/types/agent'
import {
  AGENT_FAMILY_REGISTRY,
  ALL_SOURCES,
  FAMILY_SOURCES,
  familyOfSource,
  isAgentFamilyKey,
  isAgentState,
  isDesktopSource,
  isQuotaCapableSource,
  isQuotaFamilyKey,
  SOURCE_LABELS,
  STATE_PRIORITY,
  type AgentFamilyKey,
} from '@/types/agent'
import type { DesktopPreferences, DesktopPreferencesPatch, LaunchAtStartupStatus } from '@/types/desktop'
import type { DesktopVisibilityCapabilities } from '@/types/desktop-visibility'
import type { AppLocale } from '@/types/locale'
import type {
  PermissionDecideResult,
  PermissionDecisionValue,
  PermissionOutcome,
  PermissionOutcomeKind,
  PermissionRequestView,
} from '@/types/permission'
import { CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS } from '@/types/permission'
import { classifyDecideResponse, inferVanishedOutcome, outcomeVisibleMs } from '@/utils/permission-view'
import type { ProgressionSnapshot } from '@/types/progression'
import type { AchievementSnapshot, AchievementUnlock } from '@/types/achievement'
import { ACHIEVEMENT_DEFINITIONS } from '@/types/achievement'
import type { PetWindowMode, PetWindowModeState } from '@/types/pet-window'
import { normalizePetWindowModeState } from '@/types/pet-window'
import { PET_CELL_WIDTH } from '@/types/pet-atlas'
import type { PetBehaviorManifest, PluginSkinPetSource } from '@/types/pet'
import type { PluginFeedItem } from '@/types/plugin'
import type { ProjectPetView } from '@/types/project-pet'
import type {
  PresentationIntent,
  PresentationMood,
  PresentationReaction,
  PresentationStatusUpdate,
} from '@/types/presentation'
import { PRESENTATION_REACTIONS } from '@/types/presentation'
import { formatProject } from '@/utils/format'
import { AgentSessionIndex } from '@/utils/agent-session-index'
import { compareAttention, mostUrgentSession, summarizeFamilies } from '@/utils/session-attention'
import { isHostAppId, type AgentHost } from '@/types/host-app'
import type { SessionJumpAction, SessionJumpResult } from '@/types/session-jump'
import {
  UNREAD_AWAY_MS,
  WAITING_INPUT_DELAY_MS,
  formatElapsedShort,
  toastDurationFor,
  type ToastTone,
} from '@/utils/pet-toast'
import { SOUND_DEFAULTS, type SoundCue } from '@/types/sound'
import { shouldPlaySuccessSound } from '@/utils/sound-policy'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import { SUCCESS_DISPLAY_MS } from '@/utils/pet-motion-plan'
import { readPetFeedbackDefaults } from '@/utils/pet-defaults'
import { SESSION_REMOVE_MS, sessionLifecycleAction } from '@/utils/session-lifecycle'
import { isDesktopEffectActive } from '@/utils/desktop-effects'
import {
  levelUpFromAward,
  normalizeProgressionAwardEvent,
  RECENT_AWARD_LIMIT,
  recentAwardsFromEvent,
  type LevelUpEvent,
  type RecentAward,
} from '@/utils/progression-events'
import { isPluginSkinPetId, isValidPetId } from '@/utils/pet-id'
import { petWindowHeight } from '@/utils/pet-window-height'
import { noteUnread } from '@/utils/unread-results'
import {
  INITIAL_PANEL_ROUTE,
  panelResizeRequest,
  reducePanelRoute,
  type PanelRouteAction,
  type PanelRouteState,
} from '@/utils/panel-route'
import {
  createToastCountdown,
  type ToastCountdown,
} from '@/utils/toast-countdown'
import { isPluginId, isSafeItemId } from '@/types/id-patterns'

export interface PetEntry {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
  behaviorManifest?: PetBehaviorManifest
  pluginSkin?: PluginSkinPetSource
}

const MAX_SESSION_COUNT = 200
// 面板清單排序的最後一層：來源名稱的 localeCompare 順序在載入時算成名次，
// 每次比較只做整數相減，不必在每次事件重排時反覆做語系比對（順序與 localeCompare 相同）。
const SOURCE_LABEL_RANK = Object.freeze(Object.fromEntries(
  [...ALL_SOURCES]
    .sort((a, b) => SOURCE_LABELS[a].localeCompare(SOURCE_LABELS[b]))
    .map((source, rank) => [source, rank]),
) as Record<AgentSource, number>)
const ACHIEVEMENT_DEFINITION_BY_ID = new Map(ACHIEVEMENT_DEFINITIONS.map(entry => [entry.id, entry]))
// Kept at/below the main process' quota cache TTL so a poll that arrives on
// schedule actually reaches the usage API instead of being answered from a
// still-warm cache — otherwise the two throttles stack and the meter lags by
// up to twice this interval.
const QUOTA_REFRESH_MS = 2 * 60_000
// A session that just finished has spent quota the usage API needs a moment
// to account for, so settle before asking rather than re-reading a stale
// number and then waiting a full poll interval for the real one. This is what
// actually keeps the meter current; the interval above is only a backstop.
const QUOTA_SETTLE_DELAY_MS = 8_000
// Floor between two session-driven refreshes, so a batch of agents finishing
// one after another can't turn the settle hook into a tight polling loop.
const QUOTA_SETTLE_MIN_INTERVAL_MS = 45_000
const PET_BASE_W = 250 // wide enough for a status line like "OpenCode (CLI+Desktop)"
const MOOD_BASELINE = 10
const MOOD_SYSTEM_VERSION = '2'
const MOOD_SUCCESS_REWARD = 4
const MOOD_ERROR_PENALTY = 6
const MOOD_TOOL_COMPLETIONS_PER_POINT = 2
const MOOD_TOOL_PROGRESS_CAP = 8
const MOOD_TIME_INTERVAL_MS = 5 * 60_000
const MOOD_TIME_PROGRESS_CAP = 4
// Always kept available as the ultimate fallback (see PetAnimation's
// loadImage and the various "|| 'aang-airbender'" defaults below) — so it's
// the one pet that can't be removed/hidden from the list.
const DEFAULT_PET_ID = 'aang-airbender'
const MAX_QUOTA_WINDOWS = 32
const MAX_QUOTA_TEXT_LENGTH = 96
const EVOLUTION_STAGES = new Set(['egg', 'baby', 'teen', 'adult', 'master'])
const PRESENTATION_MAX_QUEUE = 8
const PRESENTATION_HIGH_PRIORITY = STATE_PRIORITY['waiting-input']

type QuotaUsage = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getQuotaUsage']>>
type QuotaProviderErrorKind = NonNullable<QuotaUsage['providers'][number]['errorKind']>
const QUOTA_ERROR_KINDS = new Set<string>(['not-signed-in', 'expired', 'timeout', 'rate-limited', 'unavailable'])

function normalizeQuotaUsage(value: unknown): QuotaUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!Array.isArray(raw.providers)) return null

  const providers: QuotaUsage['providers'] = []
  const seen = new Set<string>()
  for (const candidate of raw.providers.slice(0, 2)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const provider = candidate as Record<string, unknown>
    if (!isQuotaFamilyKey(provider.id) || seen.has(provider.id)) continue
    if (typeof provider.name !== 'string' || !Array.isArray(provider.windows)) continue
    const windows: QuotaUsage['providers'][number]['windows'] = []
    for (const candidateWindow of provider.windows.slice(0, MAX_QUOTA_WINDOWS)) {
      if (!candidateWindow || typeof candidateWindow !== 'object' || Array.isArray(candidateWindow)) continue
      const window = candidateWindow as Record<string, unknown>
      if (typeof window.id !== 'string' || typeof window.label !== 'string') continue
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
      if (typeof window.remainingPercent !== 'number' || !Number.isFinite(window.remainingPercent)) continue
      // Clamp rather than drop: an over-quota reading must show as exhausted.
      const usedPercent = Math.min(100, Math.max(0, window.usedPercent))
      const remainingPercent = Math.min(100, Math.max(0, window.remainingPercent))
      const resetsAt = typeof window.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
        ? new Date(window.resetsAt).toISOString()
        : undefined
      windows.push({
        id: window.id.slice(0, MAX_QUOTA_TEXT_LENGTH),
        label: window.label.slice(0, MAX_QUOTA_TEXT_LENGTH),
        usedPercent,
        remainingPercent,
        ...(window.overage === true || window.usedPercent > 100 ? { overage: true } : {}),
        ...(resetsAt ? { resetsAt } : {}),
      })
    }
    seen.add(provider.id)
    providers.push({
      id: provider.id,
      name: provider.name.slice(0, MAX_QUOTA_TEXT_LENGTH),
      ...(typeof provider.plan === 'string' ? { plan: provider.plan.slice(0, MAX_QUOTA_TEXT_LENGTH) } : {}),
      windows,
      ...(typeof provider.error === 'string' ? { error: provider.error.slice(0, 240) } : {}),
      ...(QUOTA_ERROR_KINDS.has(provider.errorKind as string) ? { errorKind: provider.errorKind as QuotaProviderErrorKind } : {}),
      ...(typeof provider.fetchedAt === 'string' && Number.isFinite(Date.parse(provider.fetchedAt))
        ? { fetchedAt: new Date(provider.fetchedAt).toISOString() }
        : {}),
      ...(provider.stale === true ? { stale: true } : {}),
    })
  }
  return { updatedAt: new Date(raw.updatedAt).toISOString(), providers }
}

function normalizeProgressionSnapshot(value: unknown): ProgressionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const integerFields = ['totalXp', 'level', 'xpIntoLevel', 'xpToNext', 'currentStreak', 'longestStreak', 'updatedAt']
  if (
    typeof raw.petId !== 'string'
    || !EVOLUTION_STAGES.has(String(raw.evolutionStage))
    || integerFields.some((field) => !Number.isSafeInteger(raw[field]))
    || Number(raw.totalXp) < 0
    || Number(raw.level) < 1
    || Number(raw.xpIntoLevel) < 0
    || Number(raw.xpToNext) <= 0
    || Number(raw.currentStreak) < 0
    || Number(raw.longestStreak) < 0
  ) return null
  const lastActiveLocalDate = typeof raw.lastActiveLocalDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastActiveLocalDate)
    ? raw.lastActiveLocalDate
    : undefined
  return {
    petId: raw.petId,
    totalXp: raw.totalXp as number,
    level: raw.level as number,
    xpIntoLevel: raw.xpIntoLevel as number,
    xpToNext: raw.xpToNext as number,
    evolutionStage: raw.evolutionStage as ProgressionSnapshot['evolutionStage'],
    currentStreak: raw.currentStreak as number,
    longestStreak: raw.longestStreak as number,
    ...(lastActiveLocalDate ? { lastActiveLocalDate } : {}),
    updatedAt: raw.updatedAt as number,
  }
}

function sanitizeHost(value: unknown): AgentHost | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!isHostAppId(raw.app)) return undefined
  if (raw.kind !== 'terminal' && raw.kind !== 'ide' && raw.kind !== 'desktop' && raw.kind !== 'unknown') return undefined
  return { kind: raw.kind, app: raw.app, switchable: raw.switchable === true }
}

interface MoodTaskProgress {
  startedAt: number
  completedTools: number
  toolPoints: number
  timePoints: number
}

export const useAgentStore = defineStore('agent', () => {
  // --- 核心狀態 ----------------------------------------------------------
  const sessionsByKey = reactive(new Map<string, AgentSession>())
  const sessionIndex = new AgentSessionIndex(sessionsByKey)
  const sessionList = computed(() => [...sessionsByKey.values()].sort((a, b) => {
    const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
    if (priorityDelta !== 0) return priorityDelta
    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta
    return SOURCE_LABEL_RANK[a.source] - SOURCE_LABEL_RANK[b.source]
  }))
  // Preserve the store's existing object-shaped view for any internal caller
  // that still needs keyed access; the Map remains the source of truth.
  const sessions = computed(() => Object.fromEntries(sessionsByKey))
  const isDragging = ref(false)
  const petWindowMode = ref<PetWindowModeState>({ mode: 'normal' })
  // Panel navigation: one state machine (utils/panel-route.ts) replaces three flags.
  const panelRoute = ref<PanelRouteState>(INITIAL_PANEL_ROUTE)
  const panelView = computed(() => panelRoute.value.view)
  const showWizard = computed(() => panelRoute.value.overlay === 'wizard')
  const showProjectMcpPanel = computed(() => panelRoute.value.overlay === 'mcp')
  const selectedPet = ref<string>(localStorage.getItem('agent-pet-id') || 'aang-airbender')
  const petScale = ref(parseFloat(localStorage.getItem('agent-pet-scale') || '1'))
  const pets = ref<PetEntry[]>([])
  const petsLoaded = ref(false)
  const projectPets = ref<ProjectPetView[]>([])
  const projectPetsLoading = ref(false)
  const projectPetsError = ref('')
  const projectPetsEnabled = ref(true)
  // shallowRef: quotaUsage is always replaced wholesale (never mutated via a
  // nested property write), so deep reactivity tracking on its providers/
  // windows arrays would just be wasted work on every quota refresh.
  const quotaUsage = shallowRef<QuotaUsage | null>(null)
  const quotaLoading = ref(false)
  const quotaError = ref('')
  // Seconds a forced refresh must wait (cooldown answer from the main
  // process), or null. Lets the UI say "wait N s" instead of silently no-op.
  const quotaThrottleSec = ref<number | null>(null)
  // When the last refresh request completed (ms), for "next auto refresh".
  const quotaCheckedAt = ref(0)
  // Bumped whenever a Codex/Claude session reaches a terminal state, i.e.
  // right after quota was actually spent. App.vue watches this and schedules
  // one settled refresh, so the meter tracks real usage instead of only the
  // fixed poll interval.
  const quotaStaleSignal = ref(0)
  let quotaRequestedAt = 0

  // Built-in pets ship as bundled assets, so "removing" one just hides it
  // from your own picker rather than deleting a file — persisted the same
  // way custom-pet deletion is, just via a local id list instead of disk.
  function loadHiddenBuiltins(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem('agent-pet-hidden') || '[]')
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  const hiddenBuiltinIds = ref<string[]>(loadHiddenBuiltins())
  const visiblePets = computed(() => {
    const hidden = new Set(hiddenBuiltinIds.value)
    return pets.value.filter(p => !hidden.has(p.id))
  })

  // Per-family skin overrides (e.g. Codex looks like the cat, Claude looks
  // like the monkey king) — a family with no entry here just falls back to
  // the global `selectedPet`. Keyed by AgentFamilyKey（localStorage 的既有格式，key 不能改名）.
  // 啟動時與其他視窗改了 localStorage 時都走這裡：只收家族 registry 裡的 key 與字串值，
  // 寫回時不會把手改或舊版留下的雜項帶下去，另一個視窗也不能塞進非字串的值。
  function parseFamilyPetIds(json: string | null): Record<string, string> {
    try {
      const raw = JSON.parse(json || '{}')
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (isAgentFamilyKey(k) && typeof v === 'string') out[k] = v
        }
        return out
      }
    } catch {}
    return {}
  }
  const familyPetIds = ref<Record<string, string>>(parseFamilyPetIds(localStorage.getItem('agent-pet-family-map')))

  function syncFamilyPetIds(json: string | null): void {
    familyPetIds.value = parseFamilyPetIds(json)
  }

  // 寫入路徑跟讀取（parseFamilyPetIds）用同一個白名單：不是家族 registry 裡的 key 一律忽略。
  function setFamilyPet(familyKey: string, petId: string | null) {
    if (!isAgentFamilyKey(familyKey)) return
    const next = { ...familyPetIds.value }
    if (petId) {
      next[familyKey] = petId
    } else {
      delete next[familyKey]
    }
    familyPetIds.value = next
    localStorage.setItem('agent-pet-family-map', JSON.stringify(next))
  }

  // Falls back to the global default if the family has no override, or its
  // override points at a pet that's since been removed/hidden.
  function getPetForFamily(familyKey: string): string {
    const override = Object.hasOwn(familyPetIds.value, familyKey) ? familyPetIds.value[familyKey] : undefined
    if (override && visiblePets.value.some(p => p.id === override)) {
      return override
    }
    return selectedPet.value
  }

  const toast = ref<{
    id: number
    tone: ToastTone
    /** Semantic headline, e.g. "Done" / "Failed" / "3 tasks done". */
    title: string
    /** Source and project, e.g. "Claude · my-repo". */
    meta: string
    /** Optional second line (elapsed time). */
    detail?: string
    /** How many finished results this bubble stands for. */
    count: number
    countdown: ToastCountdown
  } | null>(null)
  const toastPaused = ref(false)
  let toastPausedRemainingMs: number | null = null
  const toastRemainingMs = ref(0)
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastProgressTimer: ReturnType<typeof setTimeout> | null = null
  let toastSequence = 0
  const pluginFeedItem = shallowRef<PluginFeedItem | null>(null)
  const pluginFeedUnreadCount = ref(0)
  let pluginFeedTimer: ReturnType<typeof setTimeout> | null = null
  const moodTaskProgress = new Map<string, MoodTaskProgress>()

  // Light meta-progression rewards completed tools, sustained work, and
  // successful finishes while errors pull it down. It has no gameplay
  // stakes, just a bit of a "the pet has been having a good day" feel.
  // Resets to baseline at the start of each new (local) day — a fresh start
  // rather than carrying yesterday's mood forward indefinitely.
  function todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }

  let initialMood = clampMood(parseFloat(localStorage.getItem('agent-pet-mood') || String(MOOD_BASELINE)))
  const needsMoodReset = localStorage.getItem('agent-pet-mood-version') !== MOOD_SYSTEM_VERSION
    || localStorage.getItem('agent-pet-mood-date') !== todayKey()
  if (needsMoodReset) {
    initialMood = MOOD_BASELINE
    localStorage.setItem('agent-pet-mood', String(MOOD_BASELINE))
    localStorage.setItem('agent-pet-mood-date', todayKey())
    localStorage.setItem('agent-pet-mood-version', MOOD_SYSTEM_VERSION)
  }
  const mood = ref(initialMood)
  const moodVisualsEnabled = ref(localStorage.getItem('agent-pet-mood-visuals') !== '0')

  // 主程序的偏好設定送到之前先用 localStorage 快取；只有 '1' 算開，沒有快取時跟 SOUND_DEFAULTS.soundEnabled 一樣是關。
  const soundEnabled = ref(localStorage.getItem('agent-pet-sound') === '1')
  const soundVolume = ref(SOUND_DEFAULTS.soundVolume)
  const soundOnPermission = ref(SOUND_DEFAULTS.soundOnPermission)
  const soundOnError = ref(SOUND_DEFAULTS.soundOnError)
  const soundOnSuccess = ref(SOUND_DEFAULTS.soundOnSuccess)

  // Off by default — showing one pet per active tool family is a bigger
  // visual/layout change than the other additions, so it stays opt-in
  // rather than silently changing behavior for people with 2+ tools running.
  const multiPetEnabled = ref(localStorage.getItem('agent-pet-multi') === '1')

  // Off by default — the click/state-change bounce, idle fidget sway, and
  // waiting-permission shake found it distracting. Off leaves the core
  // sprite state animation (and frame speed-up / mood glow) untouched.
  // On by default (key-event feedback: reaction bounce, urgency shake, reward
  // glow). Decorative ambient motion is a separate, opt-in switch below.
  const feedbackDefaults = readPetFeedbackDefaults(localStorage)
  const reactionsEnabled = ref(feedbackDefaults.reactions)

  // On by default — completion / failure / waiting bubbles. The noisier
  // "what's it doing" tool-activity bubble is its own opt-in switch.
  const bubbleEnabled = ref(feedbackDefaults.bubble)
  const ambientEnabled = ref(feedbackDefaults.ambient)
  const activityBubbleEnabled = ref(feedbackDefaults.activity)
  // shallowRef: all three are always replaced wholesale (setPermissionRequests,
  // setProgressionSnapshot, setAchievementsSnapshot each assign a fresh value),
  // never mutated in place — see the comment on quotaUsage above.
  const permissionRequests = shallowRef<PermissionRequestView[]>([])
  const progression = shallowRef<ProgressionSnapshot | null>(null)
  const achievements = shallowRef<AchievementSnapshot | null>(null)
  const achievementUnlock = ref<AchievementUnlock | null>(null)
  // XP the main process actually granted (newest first), and the last
  // level-up/evolution. Both come only from main's award notifications, so a
  // cold load or a replayed event can never look like a fresh celebration.
  const recentAwards = shallowRef<RecentAward[]>([])
  const levelUpEvent = shallowRef<LevelUpEvent | null>(null)
  let awardSequence = 0
  const presentationQueue = ref<PresentationIntent[]>([])
  const presentationActive = ref<PresentationIntent | null>(null)
  const presentationReaction = ref<{
    id: string
    reaction: PresentationReaction
    petId?: string
  } | null>(null)
  let presentationTimer: ReturnType<typeof setTimeout> | null = null

  // Desktop-wide preferences are owned by the Electron main process so the
  // Tray and both renderer windows always agree. Sound is initialized from
  // the legacy localStorage value once, preserving existing user choice.
  const dndEnabled = ref(false)
  const notificationsEnabled = ref(true)
  const permissionBubbleEnabled = ref(true)
  const claudePermissionRespondEnabled = ref(false)
  const claudePermissionWaitSeconds = ref(CLAUDE_PERMISSION_WAIT_DEFAULT_SECONDS)
  const presentationMcpEnabled = ref(true)
  const achievementsEnabled = ref(true)
  const edgeModeEnabled = ref(false)
  const shimejiEnabled = ref(false)
  const captureExclusionEnabled = ref(false)
  const fullscreenAutoHideEnabled = ref(false)
  const rightClickHideEnabled = ref(false)
  const completionMarkersEnabled = ref(true)
  const sessionJumpEnabled = ref(true)
  const sessionJumpSwitchAppEnabled = ref(true)
  const desktopVisibilityCapabilities = ref<DesktopVisibilityCapabilities>({
    captureExclusion: { supported: false, mode: 'unsupported' },
    fullscreenAutoHide: { supported: false, mode: 'unsupported' },
  })
  const launchAtStartup = ref(false)
  const launchAtStartupSupported = ref(false)
  const launchAtStartupStatus = ref<LaunchAtStartupStatus>('unsupported')
  const desktopPreferencesReady = ref(false)
  const reactionsActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    reactionsEnabled.value,
  ))
  const bubbleActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    bubbleEnabled.value,
  ))
  const ambientActive = computed(() => isDesktopEffectActive(
    desktopPreferencesReady.value,
    dndEnabled.value,
    ambientEnabled.value,
  ))
  const activityBubbleActive = computed(() => bubbleActive.value && activityBubbleEnabled.value)
  // Presentation-only preference; it never changes Broker or adapter state.
  const permissionBubbleActive = computed(() => (
    desktopPreferencesReady.value && permissionBubbleEnabled.value
  ))
  const presentationSay = computed(() => (
    desktopPreferencesReady.value
    && presentationMcpEnabled.value
    && !dndEnabled.value
    && presentationActive.value?.kind === 'say'
    ? presentationActive.value
    : null
  ))

  // --- 心情（Mood） -------------------------------------------------------

  function clampMood(value: number): number {
    if (Number.isNaN(value)) return MOOD_BASELINE
    return Math.max(0, Math.min(100, value))
  }

  function adjustMood(delta: number) {
    mood.value = clampMood(mood.value + delta)
    localStorage.setItem('agent-pet-mood', String(mood.value))
  }

  // Always sets to the low daily baseline, so the visible energy build-up is
  // earned through successful tasks rather than starting halfway charged.
  function resetMood() {
    mood.value = MOOD_BASELINE
    moodTaskProgress.clear()
    localStorage.setItem('agent-pet-mood', String(MOOD_BASELINE))
    localStorage.setItem('agent-pet-mood-date', todayKey())
    localStorage.setItem('agent-pet-mood-version', MOOD_SYSTEM_VERSION)
  }

  // Petting the pet lifts its mood a little, capped per day so it cannot be farmed.
  const PAT_DAILY_LIMIT = 5

  function patPet(): boolean {
    let count = 0
    try {
      const [day, saved] = (localStorage.getItem('agent-pet-pat') ?? '').split(':')
      if (day === todayKey()) count = Number(saved) || 0
    } catch {}
    if (count >= PAT_DAILY_LIMIT) return false
    try {
      localStorage.setItem('agent-pet-pat', `${todayKey()}:${count + 1}`)
    } catch {}
    adjustMood(1)
    return true
  }

  function setMoodVisualsEnabled(enabled: boolean) {
    moodVisualsEnabled.value = enabled
    localStorage.setItem('agent-pet-mood-visuals', enabled ? '1' : '0')
  }

  // --- Toast 提示 ----------------------------------------------------------

  function clearToastTimers() {
    if (toastTimer) clearTimeout(toastTimer)
    if (toastProgressTimer) clearTimeout(toastProgressTimer)
    toastTimer = null
    toastProgressTimer = null
  }

  function armToastTimers(toastId: number, remainingMs: number) {
    clearToastTimers()
    toastRemainingMs.value = remainingMs
    const startedAt = Date.now()
    const tick = () => {
      if (toast.value?.id !== toastId) return
      const remaining = Math.max(0, remainingMs - (Date.now() - startedAt))
      toastRemainingMs.value = remaining
      toastProgressTimer = remaining > 0 ? setTimeout(tick, Math.min(100, remaining)) : null
    }
    toastProgressTimer = setTimeout(tick, 100)
    toastTimer = setTimeout(() => {
      if (toast.value?.id !== toastId) return
      dismissToast()
    }, remainingMs)
  }

  // --- 不在場時的未讀結果 / 等待輸入提醒 ----------------------------------------

  const unreadResults = ref({ count: 0, hasError: false })
  let lastPetInteractionAt = Date.now()
  let cueSink: ((cue: SoundCue) => void) | null = null
  const waitingInputTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function markPetInteraction() {
    lastPetInteractionAt = Date.now()
  }

  function clearUnreadResults() {
    if (unreadResults.value.count === 0) return
    unreadResults.value = { count: 0, hasError: false }
  }

  function noteUnreadResult(tone: 'success' | 'error') {
    const away = Date.now() - lastPetInteractionAt >= UNREAD_AWAY_MS
    const next = noteUnread(unreadResults.value, tone, completionMarkersEnabled.value, away)
    if (next !== unreadResults.value) unreadResults.value = next
  }

  // App.vue decides whether this window may actually make sound.
  function setCueSink(sink: ((cue: SoundCue) => void) | null) {
    cueSink = sink
  }

  function cancelWaitingInputReminder(key: string) {
    const timer = waitingInputTimers.get(key)
    if (timer) clearTimeout(timer)
    waitingInputTimers.delete(key)
  }

  // The prompt must still be unanswered after a short grace period before the
  // pet speaks up, so a question answered at once never flashes a bubble.
  function scheduleWaitingInputReminder(key: string) {
    cancelWaitingInputReminder(key)
    waitingInputTimers.set(key, setTimeout(() => {
      waitingInputTimers.delete(key)
      const session = sessionsByKey.get(key)
      if (!session || session.state !== 'waiting-input') return
      showToast(session.source, session.project, 'waiting')
      cueSink?.(AGENT_STATE_PRESENTATION['waiting-input'].cue)
    }, WAITING_INPUT_DELAY_MS))
  }

  function dismissToast() {
    clearToastTimers()
    toast.value = null
    toastRemainingMs.value = 0
    toastPaused.value = false
    toastPausedRemainingMs = null
  }

  // Hovering the bubble freezes its countdown so a slow reader never loses it.
  function pauseToast() {
    const current = toast.value
    if (!current || toastPaused.value) return
    toastPausedRemainingMs = toastRemainingMs.value
    toastPaused.value = true
    clearToastTimers()
  }

  function resumeToast() {
    const current = toast.value
    if (!current || !toastPaused.value) return
    const remaining = toastPausedRemainingMs ?? 0
    toastPaused.value = false
    toastPausedRemainingMs = null
    if (remaining <= 0) dismissToast()
    else armToastTimers(current.id, remaining)
  }

  function showToast(
    source: AgentSource,
    project: string | undefined,
    tone: ToastTone,
    elapsedMs?: number,
  ) {
    const label = SOURCE_LABELS[source]
    const proj = formatProject(project)
    const startedAt = Date.now()
    const durationMs = toastDurationFor(tone)
    const countdown = createToastCountdown(tone, startedAt, durationMs)
    if (!countdown) return

    // Several tasks finishing back to back collapse into one count instead of
    // each bubble overwriting the previous one.
    const previous = toast.value
    const merge = tone === 'success' && previous?.tone === 'success'
    const count = merge ? previous.count + 1 : 1
    const elapsed = formatElapsedShort(elapsedMs)
    const nextToast = {
      id: ++toastSequence,
      tone,
      title: count > 1
        ? t('pet.toastManyDone', { count })
        : t(tone === 'success' ? 'pet.toastDone' : tone === 'error' ? 'pet.toastFailed' : 'pet.toastWaiting'),
      meta: count > 1 ? '' : proj ? `${label} · ${proj}` : label,
      ...(count === 1 && elapsed ? { detail: t('pet.toastElapsed', { time: elapsed }) } : {}),
      count,
      countdown,
    }

    toast.value = nextToast
    toastPaused.value = false
    toastPausedRemainingMs = null
    armToastTimers(nextToast.id, durationMs)
  }

  // --- Presentation MCP（本機 MCP client 的簡短反應/語音佇列） -----------------

  function normalizePluginFeedItem(value: unknown): PluginFeedItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    if (!isSafeItemId(raw.id)
      || !isPluginId(raw.pluginId)
      || !raw.pluginName || typeof raw.pluginName !== 'object' || Array.isArray(raw.pluginName)
      || typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 60
      || typeof raw.body !== 'string' || raw.body.length === 0 || raw.body.length > 240
      || (raw.priority !== 'low' && raw.priority !== 'normal')
      || typeof raw.createdAt !== 'number' || !Number.isSafeInteger(raw.createdAt)
      || typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt)
      || raw.expiresAt <= Date.now() || raw.expiresAt > Date.now() + 15_000) return null
    const name = raw.pluginName as Record<string, unknown>
    if (typeof name['zh-TW'] !== 'string' || name['zh-TW'].length === 0 || name['zh-TW'].length > 48
      || typeof name['en-US'] !== 'string' || name['en-US'].length === 0 || name['en-US'].length > 48) return null

    let targetPetId: string | undefined
    if (raw.targetPetId !== undefined) {
      if (!isValidPetId(raw.targetPetId, 64)) return null
      targetPetId = raw.targetPetId
    }

    let iconUrl: string | undefined
    if (raw.iconUrl !== undefined) {
      if (typeof raw.iconUrl !== 'string') return null
      try {
        const icon = new URL(raw.iconUrl)
        if (icon.protocol !== 'agent-pets:' || icon.hostname !== 'plugin' || icon.username || icon.password
          || icon.port || icon.search || icon.hash || !icon.pathname.startsWith(`/${raw.pluginId}/`)) return null
        iconUrl = icon.href
      } catch { return null }
    }

    let link: string | undefined
    if (raw.link !== undefined) {
      if (typeof raw.link !== 'string') return null
      try {
        const url = new URL(raw.link)
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
        link = url.href
      } catch { return null }
    }
    return {
      id: raw.id,
      pluginId: raw.pluginId,
      ...(targetPetId ? { targetPetId } : {}),
      pluginName: { 'zh-TW': name['zh-TW'], 'en-US': name['en-US'] },
      ...(iconUrl ? { iconUrl } : {}),
      title: raw.title,
      body: raw.body,
      ...(link ? { link } : {}),
      priority: raw.priority,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
      ...(raw.panelViewAvailable === true ? { panelViewAvailable: true } : {}),
    }
  }

  function handlePluginFeedItem(value: unknown): void {
    const item = normalizePluginFeedItem(value)
    if (!item) return
    if (pluginFeedTimer) clearTimeout(pluginFeedTimer)
    pluginFeedItem.value = item
    pluginFeedTimer = setTimeout(() => completePluginFeed(item.id), Math.max(1, item.expiresAt - Date.now()))
  }

  function completePluginFeed(itemId: unknown): void {
    const item = pluginFeedItem.value
    if (!item || item.id !== itemId) return
    if (pluginFeedTimer) clearTimeout(pluginFeedTimer)
    pluginFeedTimer = null
    pluginFeedItem.value = null
    void window.electronAPI?.completePluginFeed(item.id).catch(() => {})
  }

  function setPluginFeedUnreadCount(value: unknown): void {
    pluginFeedUnreadCount.value = typeof value === 'number' && Number.isSafeInteger(value)
      ? Math.max(0, Math.min(1_000_000, value))
      : 0
  }

  function openPluginFeedLink(itemId: string): void {
    void window.electronAPI?.openPluginFeedLink(itemId)
  }

  function clearPresentation(): void {
    if (presentationTimer) clearTimeout(presentationTimer)
    presentationTimer = null
    presentationQueue.value = []
    presentationActive.value = null
    presentationReaction.value = null
  }

  function clearMcpPresentation(): void {
    if (presentationTimer) clearTimeout(presentationTimer)
    presentationTimer = null
    presentationQueue.value = presentationQueue.value.filter(intent => intent.source === 'plugin')
    if (presentationActive.value?.source !== 'plugin') {
      presentationActive.value = null
      presentationReaction.value = null
    }
    pumpPresentation()
  }

  function presentationBlocked(source?: PresentationIntent['source']): boolean {
    return !desktopPreferencesReady.value
      || (source !== 'plugin' && !presentationMcpEnabled.value)
      || dndEnabled.value
      || (STATE_PRIORITY[currentState.value] ?? 0) >= PRESENTATION_HIGH_PRIORITY
  }

  function normalizePresentationIntent(value: unknown): PresentationIntent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    if ((raw.kind !== 'react' && raw.kind !== 'say')
      || typeof raw.id !== 'string'
      || typeof raw.createdAt !== 'number'
      || typeof raw.expiresAt !== 'number'
      || !Number.isFinite(raw.createdAt)
      || !Number.isFinite(raw.expiresAt)
      || raw.expiresAt <= Date.now()) return null
    const source = raw.source === undefined ? undefined : raw.source === 'plugin' ? 'plugin' : null
    if (source === null || (source === 'plugin' && raw.kind !== 'react')) return null

    const petId = raw.petId === undefined
      ? undefined
      : typeof raw.petId === 'string'
        && isValidPetId(raw.petId, 64)
        ? raw.petId
        : null
    if (petId === null) return null

    if (raw.kind === 'react') {
      if (!PRESENTATION_REACTIONS.includes(raw.reaction as PresentationReaction)) return null
      return {
        id: raw.id.slice(0, 80),
        kind: 'react',
        ...(source ? { source } : {}),
        ...(petId ? { petId } : {}),
        reaction: raw.reaction as PresentationReaction,
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
      }
    }

    if (typeof raw.message !== 'string') return null
    const message = raw.message
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (message.length === 0 || message.length > 240) return null
    return {
      id: raw.id.slice(0, 80),
      kind: 'say',
      ...(petId ? { petId } : {}),
      message,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
    }
  }

  function pumpPresentation(): void {
    if (presentationTimer) clearTimeout(presentationTimer)
    presentationTimer = null
    const now = Date.now()
    presentationQueue.value = presentationQueue.value.filter(intent => intent.expiresAt > now
      && (intent.source === 'plugin' || presentationMcpEnabled.value))
    if (!desktopPreferencesReady.value || dndEnabled.value
      || (STATE_PRIORITY[currentState.value] ?? 0) >= PRESENTATION_HIGH_PRIORITY) {
      clearPresentation()
      return
    }
    if (presentationActive.value && presentationActive.value.expiresAt > now
      && (presentationActive.value.source === 'plugin' || presentationMcpEnabled.value)) {
      presentationTimer = setTimeout(pumpPresentation, presentationActive.value.expiresAt - now)
      return
    }
    presentationActive.value = presentationQueue.value.shift() ?? null
    presentationReaction.value = null
    if (!presentationActive.value) return

    if (presentationActive.value.kind === 'react' && presentationActive.value.reaction) {
      presentationReaction.value = {
        id: presentationActive.value.id,
        reaction: presentationActive.value.reaction,
        ...(presentationActive.value.petId ? { petId: presentationActive.value.petId } : {}),
      }
    }
    presentationTimer = setTimeout(pumpPresentation, Math.max(1, presentationActive.value.expiresAt - now))
  }

  function handlePresentationIntent(value: unknown): void {
    const intent = normalizePresentationIntent(value)
    if (!intent || presentationBlocked(intent.source)) return
    if (intent.petId) {
      const knownPetIds = new Set([
        activePetId.value,
        ...familyLines.value.map(line => line.petId),
      ])
      if (!knownPetIds.has(intent.petId)) return
    }
    if (presentationQueue.value.length >= PRESENTATION_MAX_QUEUE) {
      presentationQueue.value.shift()
    }
    presentationQueue.value.push(intent)
    pumpPresentation()
  }

  function setSoundEnabled(enabled: boolean) {
    soundEnabled.value = enabled
    localStorage.setItem('agent-pet-sound', enabled ? '1' : '0')
    updateDesktopPreferences({ soundEnabled: enabled })
  }

  function setSoundOption(patch: Pick<DesktopPreferencesPatch, 'soundVolume' | 'soundOnPermission' | 'soundOnError' | 'soundOnSuccess'>) {
    updateDesktopPreferences(patch)
  }

  // --- 桌面偏好設定（同步自 Electron 主行程） -------------------------------

  function applyDesktopPreferences(preferences: DesktopPreferences) {
    applyLocale(preferences.locale)
    dndEnabled.value = preferences.dndEnabled
    notificationsEnabled.value = preferences.notificationsEnabled
    permissionBubbleEnabled.value = preferences.permissionBubbleEnabled
    claudePermissionRespondEnabled.value = preferences.claudePermissionRespondEnabled
    claudePermissionWaitSeconds.value = preferences.claudePermissionWaitSeconds
    presentationMcpEnabled.value = preferences.presentationMcpEnabled
    achievementsEnabled.value = preferences.achievementsEnabled
    edgeModeEnabled.value = preferences.edgeModeEnabled
    shimejiEnabled.value = preferences.shimejiEnabled
    captureExclusionEnabled.value = preferences.captureExclusionEnabled
    fullscreenAutoHideEnabled.value = preferences.fullscreenAutoHideEnabled
    rightClickHideEnabled.value = preferences.rightClickHideEnabled
    completionMarkersEnabled.value = preferences.completionMarkersEnabled !== false
    if (!completionMarkersEnabled.value) clearUnreadResults()
    sessionJumpEnabled.value = preferences.sessionJumpEnabled !== false
    sessionJumpSwitchAppEnabled.value = preferences.sessionJumpSwitchAppEnabled !== false
    desktopVisibilityCapabilities.value = preferences.visibilityCapabilities
    soundEnabled.value = preferences.soundEnabled
    soundVolume.value = preferences.soundVolume
    soundOnPermission.value = preferences.soundOnPermission
    soundOnError.value = preferences.soundOnError
    soundOnSuccess.value = preferences.soundOnSuccess
    launchAtStartup.value = preferences.launchAtStartup
    launchAtStartupSupported.value = preferences.launchAtStartupSupported
    launchAtStartupStatus.value = preferences.launchAtStartupStatus ?? 'unsupported'
    desktopPreferencesReady.value = true
    localStorage.setItem('agent-pet-sound', preferences.soundEnabled ? '1' : '0')
    if (preferences.dndEnabled) clearPresentation()
    else if (!preferences.presentationMcpEnabled) clearMcpPresentation()
  }

  async function initializeDesktopPreferences() {
    if (!window.electronAPI?.initializeDesktopPreferences) {
      desktopPreferencesReady.value = true
      return
    }
    try {
      applyDesktopPreferences(
        await window.electronAPI.initializeDesktopPreferences(soundEnabled.value),
      )
    } catch {
      console.error('Failed to initialize desktop preferences')
    }
  }

  function updateDesktopPreferences(patch: DesktopPreferencesPatch) {
    if (!window.electronAPI?.setDesktopPreferences) return
    void window.electronAPI.setDesktopPreferences(patch)
      .then(applyDesktopPreferences)
      .catch(() => {
        console.error('Failed to update desktop preferences')
        void initializeDesktopPreferences()
      })
  }

  function setDndEnabled(enabled: boolean) {
    dndEnabled.value = enabled
    updateDesktopPreferences({ dndEnabled: enabled })
  }

  function setNotificationsEnabled(enabled: boolean) {
    notificationsEnabled.value = enabled
    updateDesktopPreferences({ notificationsEnabled: enabled })
  }

  function setPermissionBubbleEnabled(enabled: boolean) {
    permissionBubbleEnabled.value = enabled
    updateDesktopPreferences({ permissionBubbleEnabled: enabled })
  }

  function setClaudePermissionRespondEnabled(enabled: boolean) {
    claudePermissionRespondEnabled.value = enabled
    updateDesktopPreferences({ claudePermissionRespondEnabled: enabled })
  }

  function setClaudePermissionWaitSeconds(seconds: number) {
    claudePermissionWaitSeconds.value = seconds
    updateDesktopPreferences({ claudePermissionWaitSeconds: seconds })
  }

  function setPresentationMcpEnabled(enabled: boolean) {
    presentationMcpEnabled.value = enabled
    if (!enabled) clearMcpPresentation()
    updateDesktopPreferences({ presentationMcpEnabled: enabled })
  }

  function setAchievementsEnabled(enabled: boolean) {
    achievementsEnabled.value = enabled
    updateDesktopPreferences({ achievementsEnabled: enabled })
  }

  function setEdgeModeEnabled(enabled: boolean) {
    edgeModeEnabled.value = enabled
    updateDesktopPreferences({ edgeModeEnabled: enabled })
  }

  function setShimejiEnabled(enabled: boolean) {
    shimejiEnabled.value = enabled
    updateDesktopPreferences({ shimejiEnabled: enabled })
  }

  function setCaptureExclusionEnabled(enabled: boolean) {
    if (!desktopVisibilityCapabilities.value.captureExclusion.supported) return
    captureExclusionEnabled.value = enabled
    updateDesktopPreferences({ captureExclusionEnabled: enabled })
  }

  function setFullscreenAutoHideEnabled(enabled: boolean) {
    if (!desktopVisibilityCapabilities.value.fullscreenAutoHide.supported) return
    fullscreenAutoHideEnabled.value = enabled
    updateDesktopPreferences({ fullscreenAutoHideEnabled: enabled })
  }

  function setRightClickHideEnabled(enabled: boolean) {
    rightClickHideEnabled.value = enabled
    updateDesktopPreferences({ rightClickHideEnabled: enabled })
  }

  function setCompletionMarkersEnabled(enabled: boolean) {
    completionMarkersEnabled.value = enabled
    if (!enabled) clearUnreadResults()
    updateDesktopPreferences({ completionMarkersEnabled: enabled })
  }

  function setSessionJumpEnabled(enabled: boolean) {
    sessionJumpEnabled.value = enabled
    updateDesktopPreferences({ sessionJumpEnabled: enabled })
  }

  function setSessionJumpSwitchAppEnabled(enabled: boolean) {
    sessionJumpSwitchAppEnabled.value = enabled
    updateDesktopPreferences({ sessionJumpSwitchAppEnabled: enabled })
  }

  // "Switch to app" is offered only when main said this session's app can be activated
  // (macOS, allowlisted app, not an explicit generic-http event) and the user has it turned on.
  function canSwitchToSessionApp(session: Pick<AgentSession, 'host'> | undefined): boolean {
    return Boolean(sessionJumpEnabled.value && sessionJumpSwitchAppEnabled.value && session?.host?.switchable)
  }

  function sessionByKey(key: string): AgentSession | undefined {
    return sessionsByKey.get(key)
  }

  /** Runs a jump-back action for one session; the main process holds the path and app id. */
  async function runSessionJump(key: string, action: SessionJumpAction): Promise<SessionJumpResult> {
    const session = sessionIndex.get(key)
    const run = window.electronAPI?.runSessionJump
    if (!session || !run) return { ok: false, error: 'unknown_session' }
    try {
      return await run({ action, source: session.source, sessionId: session.sessionId })
    } catch {
      return { ok: false, error: 'failed' }
    }
  }

  function setLocalePreference(next: AppLocale) {
    const applied = applyLocale(next)
    updateDesktopPreferences({ locale: applied })
  }

  function setLaunchAtStartup(enabled: boolean) {
    if (!launchAtStartupSupported.value) return
    launchAtStartup.value = enabled
    updateDesktopPreferences({ launchAtStartup: enabled })
  }

  function openLoginItemsSettings() {
    void window.electronAPI?.openLoginItemsSettings?.().catch(() => {})
  }

  function setMultiPetEnabled(enabled: boolean) {
    multiPetEnabled.value = enabled
    localStorage.setItem('agent-pet-multi', enabled ? '1' : '0')
  }

  function setReactionsEnabled(enabled: boolean) {
    reactionsEnabled.value = enabled
    localStorage.setItem('agent-pet-fx', enabled ? '1' : '0')
  }

  function setBubbleEnabled(enabled: boolean) {
    bubbleEnabled.value = enabled
    localStorage.setItem('agent-pet-bubble', enabled ? '1' : '0')
  }

  function setAmbientEnabled(enabled: boolean) {
    ambientEnabled.value = enabled
    localStorage.setItem('agent-pet-ambient', enabled ? '1' : '0')
  }

  function setActivityBubbleEnabled(enabled: boolean) {
    activityBubbleEnabled.value = enabled
    localStorage.setItem('agent-pet-activity', enabled ? '1' : '0')
  }

  // --- 寵物選擇與視窗模式 -----------------------------------------------------

  function setPet(petId: string) {
    selectedPet.value = petId
    localStorage.setItem('agent-pet-id', petId)
    void setProgressionPet(petId)
  }

  function setScale(scale: number) {
    petScale.value = scale
    localStorage.setItem('agent-pet-scale', String(scale))
  }

  function setPetWindowModeState(value: unknown): void {
    petWindowMode.value = normalizePetWindowModeState(value)
  }

  async function setPetMode(mode: PetWindowMode): Promise<void> {
    try {
      const state = await window.electronAPI?.setPetWindowMode(mode)
      if (state) setPetWindowModeState(state)
    } catch {
      // Main remains authoritative; the next mode broadcast restores state.
    }
  }

  async function initializePetWindowMode(): Promise<void> {
    try {
      const state = await window.electronAPI?.initializePetWindowMode()
      if (state) setPetWindowModeState(state)
    } catch {
      petWindowMode.value = { mode: 'normal' }
    }
  }

  // --- 成長進度與成就 ---------------------------------------------------------

  function setProgressionSnapshot(value: unknown): boolean {
    const normalized = normalizeProgressionSnapshot(value)
    if (!normalized) return false
    progression.value = normalized
    return true
  }

  function handleProgressionAwarded(value: unknown): boolean {
    const event = normalizeProgressionAwardEvent(value)
    if (!event) return false
    const fresh = recentAwardsFromEvent(event, awardSequence)
    awardSequence += fresh.length
    recentAwards.value = [...fresh, ...recentAwards.value].slice(0, RECENT_AWARD_LIMIT)
    const levelUp = levelUpFromAward(event, `${event.petId}:${event.levelAfter}:${event.at}`)
    if (levelUp) levelUpEvent.value = levelUp
    return true
  }

  function setAchievementsSnapshot(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const raw = value as Partial<AchievementSnapshot>
    const generatedAt = raw.generatedAt
    const petId = raw.petId
    if (
      raw.schemaVersion !== 1
      || typeof petId !== 'string'
      || !isValidPetId(petId, 128)
      || !Number.isSafeInteger(generatedAt)
      || !Array.isArray(raw.achievements)
      || raw.achievements.length !== ACHIEVEMENT_DEFINITIONS.length
    ) return false

    const seen = new Set<string>()
    const normalized = raw.achievements.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const item = candidate as Partial<AchievementSnapshot['achievements'][number]>
      const definition = (typeof item.id === 'string' ? ACHIEVEMENT_DEFINITION_BY_ID.get(item.id) : undefined)
      if (
        !definition
        || seen.has(definition.id)
        || item.version !== definition.version
        || item.titleKey !== definition.titleKey
        || item.descriptionKey !== definition.descriptionKey
        || item.visualReward !== definition.visualReward
        || typeof item.unlocked !== 'boolean'
        || (item.unlockedAt !== undefined && (!Number.isSafeInteger(item.unlockedAt) || item.unlockedAt < 0))
        || (item.tokenQuality !== 'none' && item.tokenQuality !== 'estimated' && item.tokenQuality !== 'exact')
        || item.category !== definition.category
        || typeof item.hidden !== 'boolean'
        || !item.progress
        || !Number.isSafeInteger(item.progress.current)
        || !Number.isSafeInteger(item.progress.target)
        || item.progress.current < 0
        || item.progress.target <= 0
      ) return null
      seen.add(definition.id)
      return {
        id: definition.id,
        version: definition.version,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        visualReward: definition.visualReward,
        unlocked: item.unlocked,
        ...(item.unlockedAt === undefined ? {} : { unlockedAt: item.unlockedAt }),
        tokenQuality: item.tokenQuality,
        category: definition.category,
        hidden: item.hidden,
        progress: { current: Math.min(item.progress.current, item.progress.target), target: item.progress.target },
      }
    })
    if (normalized.some(item => item === null)) return false
    const safeAchievements = normalized as AchievementSnapshot['achievements']
    achievements.value = {
      schemaVersion: 1,
      generatedAt: generatedAt as number,
      petId,
      totalUnlocked: safeAchievements.filter(item => item.unlocked).length,
      achievements: safeAchievements,
    }
    return true
  }

  function handleAchievementUnlocked(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const raw = value as Partial<AchievementUnlock>
    const definition = (typeof raw.achievementId === 'string' ? ACHIEVEMENT_DEFINITION_BY_ID.get(raw.achievementId) : undefined)
    const petId = raw.petId
    const unlockedAt = raw.unlockedAt
    const tokenQuality = raw.tokenQuality
    if (
      typeof petId !== 'string'
      || !isValidPetId(petId, 128)
      || !definition
      || raw.version !== definition.version
      || raw.titleKey !== definition.titleKey
      || raw.descriptionKey !== definition.descriptionKey
      || raw.visualReward !== definition.visualReward
      || typeof raw.achievementId !== 'string'
      || !Number.isSafeInteger(unlockedAt)
      || (unlockedAt as number) < 0
      || (tokenQuality !== 'none' && tokenQuality !== 'estimated' && tokenQuality !== 'exact')
    ) return false
    achievementUnlock.value = {
      petId,
      achievementId: definition.id,
      version: definition.version,
      unlockedAt: unlockedAt as number,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      visualReward: definition.visualReward,
      tokenQuality: tokenQuality as AchievementUnlock['tokenQuality'],
    }
    return true
  }

  async function initializeAchievements(): Promise<void> {
    try {
      const snapshot = await window.electronAPI?.initializeAchievements(selectedPet.value)
      if (snapshot) setAchievementsSnapshot(snapshot)
    } catch {
      achievements.value = null
    }
  }

  async function initializeProgression(): Promise<void> {
    try {
      const snapshot = await window.electronAPI?.initializeProgression(selectedPet.value)
      if (snapshot) setProgressionSnapshot(snapshot)
    } catch {
      progression.value = null
    }
  }

  async function setProgressionPet(petId: string): Promise<void> {
    if (!isValidPetId(petId, 128)) return
    try {
      const snapshot = await window.electronAPI?.setProgressionPet(petId)
      if (snapshot) setProgressionSnapshot(snapshot)
      await initializeAchievements()
    } catch {
      // Main remains authoritative; a later broadcast restores the snapshot.
    }
  }

  async function handlePluginSkinsChanged(removedPetIds: unknown): Promise<void> {
    const removed = new Set(Array.isArray(removedPetIds)
      ? removedPetIds.filter((petId): petId is string => isPluginSkinPetId(petId)).slice(0, 250)
      : [])
    const selectedPetId = selectedPet.value
    const selectedWasRemoved = removed.has(selectedPetId)
    const removedFamilyEntries = Object.entries(familyPetIds.value)
      .filter(([, petId]) => removed.has(petId))
    const routedPetId = highestPrioritySession.value?.routedPetId
    const routedWasRemoved = Boolean(routedPetId && removed.has(routedPetId))
    const activeRemovedIds = new Set<string>()
    if (selectedWasRemoved) activeRemovedIds.add(selectedPetId)
    for (const [, petId] of removedFamilyEntries) activeRemovedIds.add(petId)
    if (routedPetId && routedWasRemoved) activeRemovedIds.add(routedPetId)

    await loadPets()
    if (selectedWasRemoved || routedWasRemoved) setPet(DEFAULT_PET_ID)
    for (const [familyKey] of removedFamilyEntries) setFamilyPet(familyKey, DEFAULT_PET_ID)

    if (activeRemovedIds.size > 0) {
      void window.electronAPI?.notifyPluginSkinFallback([...activeRemovedIds])
    }
  }

  // --- Agent 事件處理與工作階段生命週期 ---------------------------------------

  function getSessionKey(source: AgentSource, sessionId: string): string {
    return `${source}:${sessionId}`
  }

  function isWorkingState(state: AgentState): boolean {
    return state === 'thinking'
      || state === 'tool-running'
      || state === 'waiting-permission'
      || state === 'waiting-input'
  }

  function awardMoodProgress(event: AgentStatusEvent, key: string, prevState?: AgentState) {
    const eventAt = Number.isFinite(event.timestamp) ? event.timestamp : Date.now()
    const explicitTaskStart = event.originalEvent === 'UserPromptSubmit'
    const resumedFromTerminal = prevState === 'idle'
      || prevState === 'success'
      || prevState === 'error'
      || prevState === 'offline'

    if (
      explicitTaskStart
      || (isWorkingState(event.state) && (!moodTaskProgress.has(key) || resumedFromTerminal))
    ) {
      moodTaskProgress.set(key, {
        startedAt: eventAt,
        completedTools: 0,
        toolPoints: 0,
        timePoints: 0,
      })
    }

    const progress = moodTaskProgress.get(key)
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
    const earnedTimePoints = Math.min(
      MOOD_TIME_PROGRESS_CAP,
      Math.floor(elapsed / MOOD_TIME_INTERVAL_MS),
    )
    reward += earnedTimePoints - progress.timePoints
    progress.timePoints = earnedTimePoints

    if (reward > 0) adjustMood(reward)

    if (event.state === 'success' || event.state === 'error' || event.state === 'idle' || event.state === 'offline') {
      moodTaskProgress.delete(key)
    }
  }

  // 回傳這個事件值得播的音效（或 null），由呼叫端 App.vue 決定要不要播、在哪裡播：
  // 寵物與面板兩個視窗都跑同一份 store，音效只能由其中一個發出，否則會播兩次。
  function handleEvent(event: AgentStatusEvent): SoundCue | null {
    const key = getSessionKey(event.source, event.sessionId)
    const existing = sessionIndex.get(key)
    const prevState = existing?.state

    if (event.originalEvent === 'AgentPetsIntegrationTest' && event.state === 'offline') {
      removeSession(key)
      return null
    }

    if (existing) {
      existing.state = event.state
      existing.lastSeenAt = event.timestamp
      existing.project = event.project
      existing.projectId = event.projectId
      existing.routedPetId = event.routedPetId
      existing.toolName = event.toolName
      existing.permissionNotice = event.permissionNotice
      const host = sanitizeHost(event.host)
      if (host) existing.host = host
      sessionIndex.updatePriority(key, event.state, event.timestamp)
    } else {
      const evicted = sessionIndex.upsert({
        key,
        source: event.source,
        sessionId: event.sessionId,
        project: event.project,
        projectId: event.projectId,
        routedPetId: event.routedPetId,
        state: event.state,
        lastSeenAt: event.timestamp,
        firstSeenAt: event.timestamp,
        toolName: event.toolName,
        permissionNotice: event.permissionNotice,
        ...(sanitizeHost(event.host) ? { host: sanitizeHost(event.host) } : {}),
      }, MAX_SESSION_COUNT)
      if (evicted) moodTaskProgress.delete(evicted.key)
    }

    if ((STATE_PRIORITY[event.state] ?? 0) >= PRESENTATION_HIGH_PRIORITY) {
      clearPresentation()
    }

    // Read before awardMoodProgress clears it on a terminal state.
    const taskStartedAt = moodTaskProgress.get(key)?.startedAt

    awardMoodProgress(event, key, prevState)

    if (event.state === 'waiting-input') {
      if (prevState !== 'waiting-input') scheduleWaitingInputReminder(key)
    } else {
      cancelWaitingInputReminder(key)
    }

    if ((event.state === 'success' || event.state === 'error') && prevState !== event.state) {
      if (isQuotaCapableSource(event.source)) quotaStaleSignal.value += 1
      showToast(
        event.source,
        event.project,
        event.state,
        taskStartedAt === undefined ? undefined : Date.now() - taskStartedAt,
      )
      noteUnreadResult(event.state)
      adjustMood(event.state === 'success' ? MOOD_SUCCESS_REWARD : -MOOD_ERROR_PENALTY)
      if (event.state === 'success' && !shouldPlaySuccessSound(
        taskStartedAt === undefined ? undefined : Date.now() - taskStartedAt,
      )) return null
      return AGENT_STATE_PRESENTATION[event.state].cue
    }

    if (event.state !== 'waiting-permission' && dismissedPermissionNotices.value.has(key)) {
      const next = new Set(dismissedPermissionNotices.value)
      next.delete(key)
      dismissedPermissionNotices.value = next
    }

    if (event.state === 'waiting-permission' && prevState !== 'waiting-permission') {
      return AGENT_STATE_PRESENTATION['waiting-permission'].cue
    }

    return null
  }

  function cleanupStale() {
    const now = Date.now()
    const hasPendingPermission = permissionRequests.value.length > 0
    for (const session of [...sessionIndex.values()]) {
      const action = sessionLifecycleAction(session, now, { hasPendingPermission })
      if (action === 'remove') {
        // Offline long enough that nobody is looking for it any more.
        sessionIndex.delete(session.key)
        moodTaskProgress.delete(session.key)
      } else if (action === 'offline') {
        // No update in a long time means the process died without sending a
        // terminal event (Stop/SessionEnd) — treat it as gone rather than
        // letting a stuck thinking/tool-running state mask real sessions.
        session.state = 'offline'
        sessionIndex.updatePriority(session.key, session.state, session.lastSeenAt)
        moodTaskProgress.delete(session.key)
      }
    }
  }

  // After a renderer reload/crash the in-memory list is empty although agents
  // may still be running. Main keeps a light mirror; merge it in without
  // replaying events (no toasts, mood or sound) and never over live data.
  function restoreSessionSnapshot(entries: unknown): number {
    if (!Array.isArray(entries)) return 0
    const now = Date.now()
    let restored = 0
    for (const raw of entries.slice(0, MAX_SESSION_COUNT)) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Partial<AgentSession>
      if (typeof entry.source !== 'string' || typeof entry.sessionId !== 'string') continue
      if (!isAgentState(entry.state)) continue
      if (typeof entry.lastSeenAt !== 'number' || !Number.isFinite(entry.lastSeenAt)) continue
      if (now - entry.lastSeenAt > SESSION_REMOVE_MS) continue
      const key = getSessionKey(entry.source as AgentSource, entry.sessionId)
      if (sessionIndex.get(key)) continue
      sessionIndex.upsert({
        key,
        source: entry.source as AgentSource,
        sessionId: entry.sessionId,
        project: typeof entry.project === 'string' ? entry.project : undefined,
        projectId: typeof entry.projectId === 'string' ? entry.projectId : undefined,
        routedPetId: typeof entry.routedPetId === 'string' ? entry.routedPetId : undefined,
        state: entry.state,
        lastSeenAt: entry.lastSeenAt,
        firstSeenAt: typeof entry.firstSeenAt === 'number' && Number.isFinite(entry.firstSeenAt) ? entry.firstSeenAt : entry.lastSeenAt,
        toolName: typeof entry.toolName === 'string' ? entry.toolName : undefined,
        ...(sanitizeHost(entry.host) ? { host: sanitizeHost(entry.host) } : {}),
      }, MAX_SESSION_COUNT)
      restored += 1
    }
    return restored
  }

  function handleSuccessTimeout() {
    const now = Date.now()
    for (const session of sessionIndex.values()) {
      if (session.state === 'success') {
        if (now - session.lastSeenAt > SUCCESS_DISPLAY_MS) {
          session.state = 'idle'
          sessionIndex.updatePriority(session.key, session.state, session.lastSeenAt)
        }
      }
    }
  }

  function removeSession(key: string) {
    cancelWaitingInputReminder(key)
    sessionIndex.delete(key)
    moodTaskProgress.delete(key)
  }

  function clearOfflineSessions() {
    for (const session of [...sessionIndex.values()]) {
      if (session.state === 'offline') {
        sessionIndex.delete(session.key)
        moodTaskProgress.delete(session.key)
      }
    }
  }

  // --- Quota 與工作階段衍生狀態（computed） -----------------------------------

  // Unsorted on purpose: the pet only needs counts and the per-family winner (summarizeFamilies),
  // so the hot path never pays for sessionList's full sort. The panel sorts its own view.
  const activeSessions = computed(() => [...sessionsByKey.values()].filter(session => session.state !== 'offline'))

  const hasQuotaCapableSessions = computed(
    () => activeSessions.value.some((session) => isQuotaCapableSource(session.source)),
  )

  const quotaByFamily = computed<Record<string, { label: string; remainingPercent: number; resetsAt?: string }>>(() => {
    const result: Record<string, { label: string; remainingPercent: number; resetsAt?: string }> = {}
    for (const provider of quotaUsage.value?.providers ?? []) {
      if (provider.error || !isQuotaFamilyKey(provider.id)) continue
      // Prefer the short session window. Some Codex accounts currently only
      // receive a weekly window, so fall back instead of hiding the meter.
      const quotaWindow = provider.windows.find(
        (window) => window.id === 'session' || window.label.toLowerCase() === 'session',
      ) ?? provider.windows.find(
        (window) => window.id === 'weekly' || window.label.toLowerCase() === 'weekly',
      ) ?? provider.windows[0]
      if (!quotaWindow || !Number.isFinite(quotaWindow.remainingPercent)) continue
      result[provider.id] = {
        label: quotaWindow.label,
        remainingPercent: Math.max(0, Math.min(100, quotaWindow.remainingPercent)),
        ...(quotaWindow.resetsAt ? { resetsAt: quotaWindow.resetsAt } : {}),
      }
    }
    return result
  })

  function setQuotaUsage(usage: unknown): boolean {
    const normalized = normalizeQuotaUsage(usage)
    if (!normalized) return false
    quotaUsage.value = normalized
    quotaError.value = ''
    return true
  }

  async function refreshQuota(force = false) {
    if (!window.electronAPI?.getQuotaUsage || quotaLoading.value) return quotaUsage.value
    const now = Date.now()
    if (!force && quotaUsage.value && now - quotaRequestedAt < QUOTA_REFRESH_MS) return quotaUsage.value
    quotaLoading.value = true
    quotaError.value = ''
    quotaThrottleSec.value = null
    quotaRequestedAt = now
    try {
      const usage = await window.electronAPI.getQuotaUsage(force)
      const throttled = (usage as { throttled?: { retryInSec?: unknown } } | null)?.throttled?.retryInSec
      if (typeof throttled === 'number' && Number.isFinite(throttled)) quotaThrottleSec.value = Math.max(1, Math.round(throttled))
      if (!setQuotaUsage(usage)) {
        quotaError.value = 'Quota service returned invalid data.'
      }
      quotaCheckedAt.value = Date.now()
      return quotaUsage.value
    } catch (error) {
      quotaError.value = translateBackendError(error instanceof Error ? error.message : t('quotaLoadFailed'))
      return quotaUsage.value
    } finally {
      quotaLoading.value = false
    }
  }

  const hasSuccessSessions = computed(() => {
    return activeSessions.value.some((s) => s.state === 'success')
  })

  // One line per tool family (CLI + Desktop combined), only shown while that
  // family has an active session — up to one line per AGENT_FAMILY_REGISTRY row.
  // `variants` records which of CLI/Desktop are actually active so the line
  // can still say which one, even though they share a row.
  const familyLines = computed(() => summarizeFamilies(sessionsByKey.values()).map((family) => {
    const top = family.top
    const variants = FAMILY_SOURCES[family.key]
      .filter((source) => family.sources.has(source))
      .map((source) => (isDesktopSource(source) ? 'Desktop' : 'CLI'))
    return {
      key: family.key,
      label: family.label,
      variants,
      state: top.state,
      // 最需要你處理的工作階段（優先度，其次最近）；專案名稱只出現在狀態列的提示與 aria-label。
      project: top.project,
      since: top.lastSeenAt,
      petId: top.routedPetId ?? getPetForFamily(family.key),
      sessionKey: top.key,
    }
  }))

  // When more than one tool family is active at once and the user has opted
  // in, the pet window shows one small pet per family side by side instead
  // of collapsing them all into a single highest-priority pet.
  const isMultiPet = computed(() => multiPetEnabled.value && familyLines.value.length > 1)

  // 每隻寵物一格 sprite 寬，加上 .multi-pet-row 的間距（倍率 1 時 8px）與一點餘裕。
  const MULTI_PET_CELL_W = PET_CELL_WIDTH + 12
  // The quota tooltip (DesktopPet.vue) shrinks to its content but is capped
  // at 244px regardless of pet size, same reasoning as
  // QUOTA_TOOLTIP_HEADROOM_H below — the pet window must stay at least that
  // wide (plus a little slack either side of the centered tooltip) or a
  // small pet size clips the tooltip at the window edge.
  const QUOTA_TOOLTIP_MIN_W = 260
  const scaledW = computed(() => {
    if (isMultiPet.value) {
      const count = familyLines.value.length
      return Math.round((count * MULTI_PET_CELL_W + 16) * petScale.value)
    }
    return Math.max(Math.round(PET_BASE_W * petScale.value), QUOTA_TOOLTIP_MIN_W)
  })
  const scaledH = computed(() => {
    // The toast/activity bubble deliberately does NOT grow the window here
    // (see DesktopPet.vue) — it overlays the existing canvas instead, so
    // showing/hiding it never triggers a resize+reposition of the window.
    // The tooltip headroom below is unscaled and always reserved (rather
    // than added only while a tooltip is open) for the same reason: growing
    // the window on hover would reposition/animate it, which is distracting
    // for a "just glance at it" hover interaction.
    return petWindowHeight(familyLines.value.length, isMultiPet.value, petScale.value)
  })

  const highestPrioritySession = computed<AgentSession | null>(() => mostUrgentSession(sessionsByKey.values()))

  const currentState = computed<AgentState>(() => {
    return highestPrioritySession.value?.state ?? 'offline'
  })

  const currentSource = computed(() => {
    return highestPrioritySession.value?.source ?? null
  })

  // Reverse-lookup from the currently-controlling source into its tool
  // family for multi-pet skin selection.
  const currentFamilyKey = computed<AgentFamilyKey | null>(() => {
    const source = currentSource.value
    return source ? familyOfSource(source) : null
  })

  const activePetId = computed(() => {
    const routedPetId = highestPrioritySession.value?.routedPetId
    if (routedPetId && pets.value.some(pet => pet.id === routedPetId)) return routedPetId
    // Per-family skins are a multi-pet feature. When that mode is off, keep
    // the original single-pet behavior: always render the global selection.
    if (!multiPetEnabled.value) return selectedPet.value
    return currentFamilyKey.value ? getPetForFamily(currentFamilyKey.value) : selectedPet.value
  })

  // Live "what's it doing right now" bubble text — only meaningful while a
  // tool is actively running and the hook payload included a tool name.
  const activityText = computed<string | null>(() => {
    const s = highestPrioritySession.value
    if (!s || s.state !== 'tool-running' || !s.toolName) return null
    return s.toolName
  })

  // Codex / Claude can only *report* a permission wait; the answer has to be
  // given in the original tool. Every such session is listed (not just the
  // highest-priority one) so the user can see how many agents are blocked.
  const dismissedPermissionNotices = shallowRef<ReadonlySet<string>>(new Set())

  const permissionNoticeItems = computed(() => (
    [...sessionsByKey.values()]
      .filter(session => (
        session.state === 'waiting-permission'
        && session.permissionNotice?.responseMode === 'external_only'
        && !dismissedPermissionNotices.value.has(session.key)
      ))
      // Only the (few) waiting sessions are sorted, not the whole list.
      .sort(compareAttention)
      .map((session) => {
        const family = familyOfSource(session.source)
        return {
          key: session.key,
          source: family ? AGENT_FAMILY_REGISTRY[family].label : session.source,
          project: session.project ?? '',
          desktop: isDesktopSource(session.source),
          sessionKey: session.key,
        }
      })
  ))

  const permissionNotice = computed(() => {
    const items = permissionNoticeItems.value
    const first = items[0]
    if (!first) return null
    const multiple = items.length > 1
    return {
      title: multiple
        ? t('permission.noticeTitleMulti', { count: items.length })
        : t('permission.noticeTitle', { source: first.source, project: first.project || t('projectUnknown') }),
      detail: multiple
        ? t('permission.noticeExternalOnly')
        : first.desktop
          ? t('permission.noticeWhereApp', { source: first.source })
          : t('returnToTerminal'),
      items,
    }
  })

  function dismissPermissionNotice(): void {
    const next = new Set(dismissedPermissionNotices.value)
    for (const item of permissionNoticeItems.value) next.add(item.key)
    dismissedPermissionNotices.value = next
  }

  function moodLabel(value: number): PresentationMood {
    if (value >= 70) return 'happy'
    if (value <= 25) return 'low'
    return 'neutral'
  }

  function getPresentationStatus(): PresentationStatusUpdate {
    const lines = familyLines.value.length > 0
      ? familyLines.value
      : [{ key: '', petId: activePetId.value, state: currentState.value }]
    const activePets = lines.slice(0, 16).map(line => ({
      petId: line.petId,
      name: pets.value.find(pet => pet.id === line.petId)?.displayName ?? line.petId,
      agentFamily: isAgentFamilyKey(line.key) ? AGENT_FAMILY_REGISTRY[line.key].adapterId : null,
      mood: moodLabel(mood.value),
      level: progression.value?.level ?? 1,
      visibleState: line.state,
    }))
    return {
      activePets,
      dnd: dndEnabled.value,
      enabled: presentationMcpEnabled.value,
    }
  }

  // --- Permission 請求 ---------------------------------------------------------

  const permissionRequest = computed(() => permissionRequests.value[0] ?? null)

  // Result of the most recent request that left the broker's active queue
  // (expired, handled elsewhere, delivery failed). Shown briefly so a bubble
  // never just vanishes silently.
  const permissionOutcome = shallowRef<PermissionOutcome | null>(null)
  let permissionOutcomeTimer: ReturnType<typeof setTimeout> | null = null
  // Requests with a decide() call in flight: the broker's broadcast can land
  // before the IPC result does, and that result decides what the UI says.
  const decidingRequestIds = new Set<string>()

  function showPermissionOutcome(
    request: Pick<PermissionRequestView, 'requestId' | 'agentId' | 'action' | 'projectId'>,
    kind: PermissionOutcomeKind,
  ): void {
    if (permissionOutcomeTimer) clearTimeout(permissionOutcomeTimer)
    permissionOutcome.value = {
      kind,
      requestId: request.requestId,
      agentId: request.agentId,
      action: request.action,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      at: Date.now(),
    }
    permissionOutcomeTimer = setTimeout(dismissPermissionOutcome, outcomeVisibleMs(kind))
  }

  function dismissPermissionOutcome(): void {
    if (permissionOutcomeTimer) clearTimeout(permissionOutcomeTimer)
    permissionOutcomeTimer = null
    permissionOutcome.value = null
  }

  // The broker's `agentId` is the literal AgentSource string for every
  // respond-capable adapter (see electron/permission-adapter-server.ts,
  // which sets `agentId: payload.source` from the same 'opencode-cli' /
  // 'opencode-desktop' values AgentStatusEvent.source uses), so a request
  // and the session it blocks share the exact same getSessionKey().
  function settleWaitingPermission(agentId: string, sessionId: string): void {
    const key = getSessionKey(agentId as AgentSource, sessionId)
    const session = sessionIndex.get(key)
    if (!session || session.state !== 'waiting-permission') return
    // The user (or the broker's own TTL) has resolved this request, but a
    // Codex/Claude session may never send a follow-up hook event — without
    // this, the pet stays stuck showing "Waiting Permission" forever even
    // though nothing is actually waiting anymore (see GH issue #1). This is
    // a local, visual-only fallback: any real event still overwrites it.
    session.state = 'idle'
    session.permissionNotice = undefined
    sessionIndex.updatePriority(key, session.state, session.lastSeenAt)
  }

  function setPermissionRequests(value: unknown): void {
    if (!Array.isArray(value)) {
      permissionRequests.value = []
      return
    }
    const now = Date.now()
    const next = value.filter((request): request is PermissionRequestView => (
      Boolean(request)
      && typeof request === 'object'
      && typeof request.requestId === 'string'
      && typeof request.action === 'string'
      && typeof request.description === 'string'
      && typeof request.expiresAt === 'number'
      && Number.isFinite(request.expiresAt)
      && request.expiresAt > now
      && (request.status === 'pending' || request.status === 'deciding')
      && Array.isArray(request.allowedDecisions)
    ))
    // A request that drops out of the pending/deciding set — decided,
    // expired, or cancelled — is done blocking its session even if we were
    // never told the outcome explicitly (e.g. TTL expiry has no decidePermission
    // caller at all).
    const stillPending = new Set(next.map(request => request.requestId))
    for (const request of permissionRequests.value) {
      if (stillPending.has(request.requestId)) continue
      // decidePermission() reports and settles these itself once the IPC returns.
      if (decidingRequestIds.has(request.requestId)) continue
      settleWaitingPermission(request.agentId, request.sessionId)
      showPermissionOutcome(request, inferVanishedOutcome(request, now))
    }
    // A new request supersedes any result card for an older one.
    if (next.length > 0 && permissionOutcome.value?.kind !== 'error') dismissPermissionOutcome()
    permissionRequests.value = next
  }

  async function initializePermissionRequests(): Promise<void> {
    try {
      setPermissionRequests(await window.electronAPI?.initializePermissionRequests())
    } catch {
      permissionRequests.value = []
    }
  }

  async function decidePermission(
    requestId: string,
    decision: PermissionDecisionValue,
  ): Promise<PermissionDecideResult> {
    const request = permissionRequests.value.find(candidate => candidate.requestId === requestId)
    if (!request) return { ok: false, kind: 'cancelled' }
    decidingRequestIds.add(requestId)
    let result: PermissionDecideResult
    try {
      result = classifyDecideResponse(await window.electronAPI?.decidePermission(requestId, decision))
    } catch (error) {
      console.warn('[permission] decision IPC failed', error instanceof Error ? error.name : 'unknown')
      result = { ok: false, kind: 'error' }
    } finally {
      decidingRequestIds.delete(requestId)
    }
    // Only a delivered decision means the agent is no longer waiting. For a
    // failed delivery or IPC error the pet must keep showing the wait — the
    // agent really is still blocked.
    if (result.ok || result.kind === 'cancelled' || result.kind === 'expired') {
      settleWaitingPermission(request.agentId, request.sessionId)
    }
    if (!result.ok) showPermissionOutcome(request, result.kind)
    return result
  }

  // --- 控制面板視窗導覽 ---------------------------------------------------------

  // The panel lives in its own always-on-top window (see electron/main.ts),
  // so opening/closing/resizing it never touches the pet window's bounds.
  function togglePanel() {
    window.electronAPI?.togglePanel()
  }

  // Pinning and in-progress modal flows (wizard, MCP setup, confirmations)
  // suspend the main process's hide-on-blur so the panel stays for reference.
  const panelPinned = ref(false)
  const panelModalLocks = reactive(new Set<string>())
  const panelModalOpen = computed(() => showWizard.value || showProjectMcpPanel.value || panelModalLocks.size > 0)
  watch(panelModalOpen, open => window.electronAPI?.setPanelBlurLock?.({ modal: open }))

  function setPanelPinned(pinned: boolean) {
    panelPinned.value = pinned
    window.electronAPI?.setPanelBlurLock?.({ pinned })
  }

  function setPanelModalLock(key: string, open: boolean) {
    if (open) panelModalLocks.add(key)
    else panelModalLocks.delete(key)
  }

  // Every transition goes through here so the window size always follows the route.
  function navigatePanel(action: PanelRouteAction, options: { resize?: boolean } = {}) {
    const next = reducePanelRoute(panelRoute.value, action)
    const request = panelResizeRequest(panelRoute.value, next)
    panelRoute.value = next
    if (options.resize !== false && request) window.electronAPI?.resizePanel(request)
  }

  function closePanel() {
    const before = panelRoute.value
    navigatePanel({ type: 'close-overlay' }, { resize: false })
    window.electronAPI?.hidePanel()
    // Hide first, then drop an overlay's minimum size, so the window never visibly resizes on close.
    if (before.overlay) window.electronAPI?.resizePanel({ release: true })
  }

  function openSettings() {
    navigatePanel({ type: 'open-settings' })
  }

  function openSetupWizard() {
    navigatePanel({ type: 'open-overlay', overlay: 'wizard' })
  }

  function closeSetupWizard() {
    navigatePanel({ type: 'close-overlay' })
  }

  function openProjectMcpPanel() {
    navigatePanel({ type: 'open-overlay', overlay: 'mcp' })
  }

  function closeProjectMcpPanel() {
    navigatePanel({ type: 'close-overlay' })
  }

  function backToSessions() {
    navigatePanel({ type: 'back-to-sessions' })
  }

  // Called by electron/main.ts whenever the panel window transitions from
  // hidden to visible. A restore keeps the previous screen (including a
  // suspended plugin panel); any other open goes back to the Sessions view
  // (the main process already sized the window for it).
  const panelOpenCount = ref(0)
  function handlePanelOpened(options?: { restore?: boolean }) {
    panelOpenCount.value += 1
    if (options?.restore) return
    navigatePanel({ type: 'reset' }, { resize: false })
  }

  // --- 寵物視窗尺寸同步 -----------------------------------------------------

  function resizePetWindow() {
    window.electronAPI?.resizeWindow(scaledW.value, scaledH.value)
  }

  // Grows/shrinks the pet window whenever scale or active status-line count
  // changes — firing from either window's store instance is harmless, since
  // main process just re-applies the same bounds to the (single) pet window.
  watch([scaledW, scaledH], resizePetWindow, { immediate: true })

  // --- 寵物清單與專案寵物綁定 -------------------------------------------------

  async function loadPets() {
    try {
      const list = await window.electronAPI?.loadPets()
      if (list) {
        pets.value = list
      }
    } finally {
      petsLoaded.value = true
    }
  }

  // Project-pet IPC is panel-only (main.ts rejects other senders), and the pet
  // window also calls loadPets(), so panel callers refresh this explicitly.
  async function refreshProjectPets(): Promise<ProjectPetView[]> {
    if (window.electronAPI?.getProjectPetsEnabled) {
      try {
        projectPetsEnabled.value = await window.electronAPI.getProjectPetsEnabled()
      } catch {
        projectPetsEnabled.value = false
      }
    }
    if (!window.electronAPI?.listProjectPets || !projectPetsEnabled.value) return projectPets.value
    projectPetsLoading.value = true
    projectPetsError.value = ''
    try {
      const list = await window.electronAPI.listProjectPets()
      projectPets.value = Array.isArray(list) ? list : []
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
    } finally {
      projectPetsLoading.value = false
    }
    return projectPets.value
  }

  async function setProjectPetsEnabled(enabled: boolean): Promise<boolean> {
    if (!window.electronAPI?.setProjectPetsEnabled) return false
    try {
      projectPetsEnabled.value = await window.electronAPI.setProjectPetsEnabled(enabled)
    } catch {
      return false
    }
    if (projectPetsEnabled.value) void refreshProjectPets()
    else projectPets.value = []
    return projectPetsEnabled.value
  }

  async function addProjectPet(): Promise<boolean> {
    if (!window.electronAPI?.pickProjectPet) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.pickProjectPet()
      if (!result.ok) {
        if (result.error !== 'cancelled') projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      const existing = projectPets.value.findIndex(project => project.projectId === result.project.projectId)
      if (existing >= 0) projectPets.value[existing] = result.project
      else projectPets.value = [result.project, ...projectPets.value]
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  async function setProjectPetBinding(projectId: string, petId: string | null): Promise<boolean> {
    if (!window.electronAPI?.setProjectPetBinding) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.setProjectPetBinding(projectId, petId)
      if (!result.ok) {
        projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      const index = projectPets.value.findIndex(project => project.projectId === result.project.projectId)
      if (index >= 0) projectPets.value[index] = result.project
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  async function removeProjectPet(projectId: string): Promise<boolean> {
    if (!window.electronAPI?.archiveProjectPet) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.archiveProjectPet(projectId)
      if (!result.ok) {
        projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      projectPets.value = projectPets.value.filter(project => project.projectId !== projectId)
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  // --- 寵物重新命名／移除 -------------------------------------------------------

  async function renamePet(petId: string, newName: string) {
    const ok = await window.electronAPI?.renameCustomPet(petId, newName)
    if (ok) {
      const pet = pets.value.find(p => p.id === petId)
      if (pet) pet.displayName = newName
    }
  }

  async function removePet(petId: string) {
    if (petId === DEFAULT_PET_ID) return

    const pet = pets.value.find(p => p.id === petId)
    if (pet?.builtIn) {
      if (!hiddenBuiltinIds.value.includes(petId)) {
        hiddenBuiltinIds.value = [...hiddenBuiltinIds.value, petId]
        localStorage.setItem('agent-pet-hidden', JSON.stringify(hiddenBuiltinIds.value))
      }
    } else {
      await window.electronAPI?.removeCustomPet(petId)
      pets.value = pets.value.filter(p => p.id !== petId)
    }

    if (selectedPet.value === petId) {
      setPet(visiblePets.value[0]?.id || DEFAULT_PET_ID)
    }

    for (const [familyKey, assignedId] of Object.entries(familyPetIds.value)) {
      if (assignedId === petId) {
        setFamilyPet(familyKey, null)
      }
    }
    void refreshProjectPets()
  }

  return {
    sessions,
    sessionList,
    isDragging,
    petWindowMode,
    panelRoute,
    panelView,
    selectedPet,
    petScale,
    scaledW,
    scaledH,
    pets,
    visiblePets,
    familyPetIds,
    petsLoaded,
    projectPets,
    projectPetsLoading,
    projectPetsError,
    projectPetsEnabled,
    quotaUsage,
    quotaLoading,
    quotaError,
    quotaThrottleSec,
    quotaCheckedAt,
    quotaByFamily,
    quotaStaleSignal,
    hasQuotaCapableSessions,
    quotaRefreshMs: QUOTA_REFRESH_MS,
    quotaSettleDelayMs: QUOTA_SETTLE_DELAY_MS,
    quotaSettleMinIntervalMs: QUOTA_SETTLE_MIN_INTERVAL_MS,
    defaultPetId: DEFAULT_PET_ID,
    showWizard,
    showProjectMcpPanel,
    toast,
    toastRemainingMs,
    toastPaused,
    unreadResults,
    markPetInteraction,
    clearUnreadResults,
    setCueSink,
    pauseToast,
    resumeToast,
    dismissToast,
    pluginFeedItem,
    pluginFeedUnreadCount,
    mood,
    moodVisualsEnabled,
    soundEnabled,
    soundVolume,
    soundOnPermission,
    soundOnError,
    soundOnSuccess,
    setSoundOption,
    dndEnabled,
    notificationsEnabled,
    permissionBubbleEnabled,
    claudePermissionRespondEnabled,
    claudePermissionWaitSeconds,
    setClaudePermissionRespondEnabled,
    setClaudePermissionWaitSeconds,
    presentationMcpEnabled,
    achievementsEnabled,
    edgeModeEnabled,
    shimejiEnabled,
    captureExclusionEnabled,
    fullscreenAutoHideEnabled,
    rightClickHideEnabled,
    completionMarkersEnabled,
    sessionJumpEnabled,
    sessionJumpSwitchAppEnabled,
    desktopVisibilityCapabilities,
    launchAtStartup,
    launchAtStartupSupported,
    launchAtStartupStatus,
    openLoginItemsSettings,
    desktopPreferencesReady,
    multiPetEnabled,
    reactionsEnabled,
    bubbleEnabled,
    ambientEnabled,
    activityBubbleEnabled,
    reactionsActive,
    bubbleActive,
    ambientActive,
    activityBubbleActive,
    permissionBubbleActive,
    isMultiPet,
    activeSessions,
    hasSuccessSessions,
    familyLines,
    highestPrioritySession,
    currentState,
    currentSource,
    currentFamilyKey,
    activePetId,
    activityText,
    permissionNotice,
    dismissPermissionNotice,
    presentationSay,
    presentationReaction,
    handlePresentationIntent,
    clearPresentation,
    handlePluginFeedItem,
    completePluginFeed,
    setPluginFeedUnreadCount,
    openPluginFeedLink,
    getPresentationStatus,
    permissionRequests,
    permissionRequest,
    permissionOutcome,
    dismissPermissionOutcome,
    progression,
    achievements,
    achievementUnlock,
    recentAwards,
    levelUpEvent,
    handleProgressionAwarded,
    setProgressionSnapshot,
    setAchievementsSnapshot,
    handleAchievementUnlocked,
    initializeProgression,
    initializeAchievements,
    setProgressionPet,
    handlePluginSkinsChanged,
    setPermissionRequests,
    initializePermissionRequests,
    decidePermission,
    handleEvent,
    cleanupStale,
    restoreSessionSnapshot,
    handleSuccessTimeout,
    removeSession,
    clearOfflineSessions,
    togglePanel,
    closePanel,
    openSettings,
    openSetupWizard,
    closeSetupWizard,
    openProjectMcpPanel,
    closeProjectMcpPanel,
    backToSessions,
    handlePanelOpened,
    panelPinned,
    panelOpenCount,
    setPanelPinned,
    setPanelModalLock,
    setPet,
    setScale,
    setPetWindowModeState,
    setShimejiEnabled,
    setPetMode,
    initializePetWindowMode,
    setSoundEnabled,
    applyDesktopPreferences,
    initializeDesktopPreferences,
    setDndEnabled,
    setNotificationsEnabled,
    setPermissionBubbleEnabled,
    setPresentationMcpEnabled,
    setAchievementsEnabled,
    setEdgeModeEnabled,
    setCaptureExclusionEnabled,
    setFullscreenAutoHideEnabled,
    setCompletionMarkersEnabled,
    setRightClickHideEnabled,
    setSessionJumpEnabled,
    setSessionJumpSwitchAppEnabled,
    canSwitchToSessionApp,
    sessionByKey,
    runSessionJump,
    setLocalePreference,
    setLaunchAtStartup,
    setMultiPetEnabled,
    setReactionsEnabled,
    setBubbleEnabled,
    setAmbientEnabled,
    setActivityBubbleEnabled,
    setFamilyPet,
    syncFamilyPetIds,
    getPetForFamily,
    resetMood,
    setMoodVisualsEnabled,
    patPet,
    resizePetWindow,
    loadPets,
    refreshProjectPets,
    addProjectPet,
    setProjectPetBinding,
    removeProjectPet,
    setProjectPetsEnabled,
    setQuotaUsage,
    refreshQuota,
    renamePet,
    removePet,
  }
})
