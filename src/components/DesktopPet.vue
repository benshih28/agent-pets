<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { isQuotaFamilyKey, type AgentState, type QuotaFamilyKey } from '@/types/agent'
import { locale, t, type TranslationKey } from '@/i18n'
import type { AchievementUnlock } from '@/types/achievement'
import type { PluginBadgeView } from '@/types/plugin'
import {
  canRunAutonomousBehavior,
  ShimejiScheduler,
  SHIMEJI_IDLE_DELAY_MS,
  SHIMEJI_IDLE_DELAY_MIN_MS,
  type PetAutonomousBehavior,
  type ShimejiContext,
} from '@/types/pet'
import { quotaWindowLabel, roundQuotaPercent } from '@/utils/format'
import { selectBubble } from '@/utils/feed-arbiter'
import { stateAriaLabel } from '@/utils/state-aria'
import { AGENT_STATE_PRESENTATION, stateLineLabel } from '@/utils/agent-state-presentation'
import { summarizePluginBadgesForPet } from '@/utils/plugin-badges'
import PetAnimation from '@/components/PetAnimation.vue'
import { useKeyedRefs, usePetBubbleAnchor } from '@/composables/usePetBubbleAnchor'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { describeTool } from '@/utils/pet-toast'
import { statusLineText, type StatusLineSource } from '@/utils/session-attention'
import { fitStatusLine, statusLineContentWidth, STATUS_TEXT_FONTS, type MeasureText, type StatusLineFit, type StatusLinePart } from '@/utils/status-line-fit'
import { resolvedPetTheme } from '@/composables/useTheme'
import PermissionBubble from '@/components/permission/PermissionBubble.vue'
import { usePetTheme } from '@/composables/usePetTheme'
import PermissionNoticeBubble from '@/components/permission/PermissionNoticeBubble.vue'
import { formatDateParts } from '@/utils/intl-format'
import { PET_CELL_HEIGHT } from '@/types/pet-atlas'
import { useReducedMotion } from '@/composables/useReducedMotion'

const store = useAgentStore()
const clickAreaRef = ref<HTMLElement | null>(null)
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)
let mouseDownTime = 0
const petAnimRef = ref<InstanceType<typeof PetAnimation> | null>(null)
const { items: multiPetInstances, setRef: setMultiPetRef } = useKeyedRefs<InstanceType<typeof PetAnimation>>()
const { items: multiPetItemElements, setRef: setMultiPetItem } = useKeyedRefs<HTMLElement>()

function multiPetAnimations(): InstanceType<typeof PetAnimation>[] {
  return [...multiPetInstances.values()]
}

function multiPetAnimationForPet(petId: string): InstanceType<typeof PetAnimation> | undefined {
  const line = store.familyLines.find(candidate => candidate.petId === petId)
  return line ? multiPetInstances.get(line.key) : undefined
}
const pluginBadges = ref<PluginBadgeView[]>([])
const petDocumentVisible = ref(true)
let cleanupPluginBadgeListener: (() => void) | null = null
let pluginBadgeRevision = 0

// --- Shimeji 行為排程 -------------------------------------------------------

const shimejiBehavior = ref<PetAutonomousBehavior>('idle')
const shimejiFacing = ref<-1 | 1>(1)
const pointerOverPet = ref(false)
const shimejiScheduler = new ShimejiScheduler()
// shimejiGate 已經監看這個值，系統設定改變時會自動重排 Shimeji。
const shimejiReducedMotion = useReducedMotion()
const shimejiPowerSave = ref(false)
let shimejiTimer: ReturnType<typeof setTimeout> | null = null
let shimejiIdleSince = Date.now()
let cleanupShimejiPowerSave: (() => void) | null = null
interface ShimejiBattery {
  charging: boolean
  level: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}
let shimejiBattery: ShimejiBattery | null = null

function updateShimejiPowerSave(): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  shimejiPowerSave.value = Boolean(
    connection?.saveData
    || (shimejiBattery && !shimejiBattery.charging && shimejiBattery.level <= 0.2),
  )
}

const shimejiManifestCapabilities = computed(() => {
  const multiPetActive = store.multiPetEnabled && store.familyLines.length > 1
  const petIds = multiPetActive
    ? store.familyLines.map(line => line.petId)
    : [store.activePetId]
  const entries = petIds
    .map(id => store.pets.find(pet => pet.id === id))
    .filter((pet): pet is NonNullable<typeof pet> => Boolean(pet))
  return {
    canWalk: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.walk)),
    canSleep: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.sleep)),
  }
})

function shimejiContext(random?: number): ShimejiContext {
  return {
    enabled: store.shimejiEnabled,
    reactionsEnabled: store.reactionsEnabled,
    dndEnabled: store.dndEnabled,
    reducedMotion: shimejiReducedMotion.value,
    powerSave: shimejiPowerSave.value,
    documentVisible: document.visibilityState === 'visible',
    isDragging: store.isDragging,
    windowMode: store.petWindowMode.mode,
    currentState: store.currentState,
    activeSessionCount: store.activeSessions.length,
    pendingPermission: store.permissionRequests.length > 0,
    canWalk: shimejiManifestCapabilities.value.canWalk,
    canSleep: shimejiManifestCapabilities.value.canSleep,
    idleMs: Math.max(0, Date.now() - shimejiIdleSince),
    ...(random === undefined ? {} : { random }),
  }
}

// The cursor arriving wakes a sleeping pet and holds it in place.
function onPetPointerEnter(): void {
  pointerOverPet.value = true
  if (shimejiScheduler.isSleeping) restartShimeji()
}

function stopShimejiTimer(): void {
  if (shimejiTimer) clearTimeout(shimejiTimer)
  shimejiTimer = null
}

function scheduleShimeji(delayMs: number = SHIMEJI_IDLE_DELAY_MS): void {
  stopShimejiTimer()
  if (!store.shimejiEnabled || !canRunAutonomousBehavior(shimejiContext())) return
  shimejiTimer = setTimeout(runShimejiTick, Math.max(1_500, delayMs))
}

// Would the next step run into the edge of the current display? Then the pet
// turns around instead of marching on the spot against the wall.
function walkDeltaAwayFromWall(deltaX: number): number {
  const margin = 4
  const left = (window.screen as Screen & { availLeft?: number }).availLeft ?? 0
  const right = left + window.screen.availWidth
  const nextLeft = window.screenX + deltaX
  const nextRight = window.screenX + window.outerWidth + deltaX
  return nextLeft < left + margin || nextRight > right - margin ? -deltaX : deltaX
}

function runShimejiTick(): void {
  shimejiTimer = null
  // A pet under the cursor stays put rather than walking away from it.
  if (pointerOverPet.value) {
    scheduleShimeji(SHIMEJI_IDLE_DELAY_MIN_MS)
    return
  }
  const tick = shimejiScheduler.next(shimejiContext(Math.random()))
  shimejiBehavior.value = tick.behavior
  if (tick.walkDeltaX !== undefined && tick.behavior === 'walk') {
    const deltaX = walkDeltaAwayFromWall(tick.walkDeltaX)
    shimejiFacing.value = deltaX < 0 ? -1 : 1
    window.electronAPI?.shimejiWalkStep(deltaX)
  }
  scheduleShimeji(tick.delayMs)
}

function restartShimeji(): void {
  stopShimejiTimer()
  shimejiScheduler.reset()
  shimejiBehavior.value = 'idle'
  shimejiIdleSince = Date.now()
  scheduleShimeji()
}

const shimejiGate = computed(() => [
  store.shimejiEnabled,
  store.reactionsEnabled,
  store.dndEnabled,
  store.currentState,
  store.activeSessions.length,
  store.permissionRequests.length,
  store.petWindowMode.mode,
  store.isDragging,
  store.petsLoaded,
  shimejiManifestCapabilities.value.canWalk,
  shimejiManifestCapabilities.value.canSleep,
  shimejiReducedMotion.value,
  shimejiPowerSave.value,
  document.visibilityState,
].join('|'))

watch(shimejiGate, restartShimeji)

function onShimejiVisibilityChange(): void {
  restartShimeji()
}

async function initializeShimejiEnvironment(): Promise<void> {
  document.addEventListener('visibilitychange', onShimejiVisibilityChange)

  if (window.electronAPI?.getPowerSaveState) {
    try {
      shimejiPowerSave.value = await window.electronAPI.getPowerSaveState()
    } catch {}
  }
  cleanupShimejiPowerSave = window.electronAPI?.onPowerSaveStateUpdated?.((powerSave) => {
    shimejiPowerSave.value = powerSave
  }) ?? null

  const getBattery = (navigator as Navigator & {
    getBattery?: () => Promise<ShimejiBattery>
  }).getBattery
  if (getBattery) {
    try {
      shimejiBattery = await getBattery()
      shimejiBattery.addEventListener('chargingchange', updateShimejiPowerSave)
      shimejiBattery.addEventListener('levelchange', updateShimejiPowerSave)
      updateShimejiPowerSave()
    } catch {
      // Battery API 在 Electron 中可能不存在；仍保留 Reduced Motion 與 DND 閘門。
    }
  }
}

function disposeShimejiEnvironment(): void {
  stopShimejiTimer()
  document.removeEventListener('visibilitychange', onShimejiVisibilityChange)
  cleanupShimejiPowerSave?.()
  cleanupShimejiPowerSave = null
  shimejiBattery?.removeEventListener('chargingchange', updateShimejiPowerSave)
  shimejiBattery?.removeEventListener('levelchange', updateShimejiPowerSave)
  shimejiBattery = null
}

// --- 狀態列與 Quota 顯示 ---------------------------------------------------

// Up to one line per active tool family; when nothing is active, fall back
// to a single line showing the pet's overall (idle/offline) state.
const displayLines = computed(() => {
  if (store.familyLines.length > 0) return store.familyLines
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, since: undefined, petId: store.activePetId, sessionKey: '' }]
})

// With only one active family, one pet reflects it (and the status lines
// below carry the detail). With more than one — and the opt-in Settings
// toggle on — showing a single pet forces picking a "winner", so instead
// show one small pet per family, side by side.
const isMultiPet = computed(() => store.isMultiPet)
// Reduced motion degrades the pet instead of freezing it: states that carry
// information (working, waiting, failed) keep stepping at a very low rate, and
// only a resting pet is held still.
const petAnimationFrozen = computed(() => (
  shimejiReducedMotion.value && (store.currentState === 'idle' || store.currentState === 'offline')
))
const petLowFps = computed(() => store.petWindowMode.mode === 'mini' || shimejiReducedMotion.value)

const petAriaLabel = computed(() => t('pet.ariaLabel', { state: stateAriaLabel(store.currentState) }))
// Spoken when the visible state changes, not on every session update.
const stateAnnouncement = ref('')
watch(() => store.currentState, (state, previous) => {
  if (state === previous) return
  stateAnnouncement.value = stateAriaLabel(state)
})

function onPetKeydown(e: KeyboardEvent): void {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    store.markPetInteraction()
    store.clearUnreadResults()
    store.togglePanel()
  }
}

// Mini mode shrinks the sprite to fit the fixed small window, whatever the pet size.
const MINI_FIT_PX = 88
const miniScale = computed(() => Math.min(0.42, MINI_FIT_PX / (PET_CELL_HEIGHT * store.petScale)))
const miniStatus = computed(() => {
  const { icon, labelKey } = AGENT_STATE_PRESENTATION[store.currentState].mini
  return { icon, label: t(labelKey) }
})

const bubbleSelection = computed(() => {
  const permissionRequest = Boolean(store.permissionBubbleActive && (store.permissionRequest || store.permissionOutcome))
  const permissionNotice = Boolean(store.permissionBubbleActive && store.permissionNotice)
  const agentBubbleEnabled = !store.permissionRequest && !store.permissionOutcome && !store.permissionNotice && store.bubbleActive
  const pluginFeed = store.pluginFeedItem

  return selectBubble({
    permissionRequest,
    permissionNotice,
    agentToast: Boolean(agentBubbleEnabled && store.toast),
    presentationSay: Boolean(store.presentationSay),
    activity: Boolean(store.activityBubbleActive && agentBubbleEnabled && !store.toast && !isMultiPet.value && store.activityText),
    pluginFeed: pluginFeed ? {
      priority: pluginFeed.priority,
      controls: {
        pluginsEnabled: true,
        enabled: true,
        muted: false,
        dnd: store.dndEnabled,
        visible: store.petWindowMode.mode === 'normal' && document.visibilityState === 'visible',
      },
    } : null,
  })
})

// --- 首次啟動引導（coach mark）-----------------------------------------------

const COACH_STORAGE_KEY = 'agent-pet-coach-v1'
const COACH_VISIBLE_MS = 20_000
const coachArmed = ref(false)
let coachTimer: ReturnType<typeof setTimeout> | null = null

function coachAlreadySeen(): boolean {
  try {
    return localStorage.getItem(COACH_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function dismissCoach(): void {
  if (coachTimer) clearTimeout(coachTimer)
  coachTimer = null
  if (!coachArmed.value) return
  coachArmed.value = false
  try {
    localStorage.setItem(COACH_STORAGE_KEY, '1')
  } catch {}
}

function armCoach(): void {
  if (coachAlreadySeen()) return
  coachArmed.value = true
  coachTimer = setTimeout(dismissCoach, COACH_VISIBLE_MS)
}

const coachShown = computed(() => (
  coachArmed.value
  && bubbleSelection.value === null
  && store.petWindowMode.mode === 'normal'
  && store.desktopPreferencesReady
  && !store.dndEnabled
))

const activityLabel = computed(() => {
  const raw = store.activityText
  if (!raw) return ''
  const description = describeTool(raw)
  return t(description.key as TranslationKey, description.params)
})

const toastIconName = computed(() => {
  switch (store.toast?.tone) {
    case 'error': return 'warning'
    case 'waiting': return 'bell'
    default: return 'check'
  }
})

const toastAutoCloseSeconds = computed(() => (
  store.toast ? Math.max(1, Math.round(store.toast.countdown.durationMs / 1000)) : 0
))

function openFromToast(): void {
  store.markPetInteraction()
  store.clearUnreadResults()
  store.dismissToast()
  store.togglePanel()
}

function openPluginFeedLink(itemId: string): void {
  store.openPluginFeedLink(itemId)
}

function openPluginPanelFromFeed(pluginId: string): void {
  void window.electronAPI?.openPluginPanelFromPet(pluginId)
}

const pluginFeedTargetPetId = computed(() => {
  const targetPetId = store.pluginFeedItem?.targetPetId
  if (targetPetId) return targetPetId
  return isMultiPet.value ? store.familyLines[0]?.petId ?? store.activePetId : store.activePetId
})

const pluginBadgesVisible = computed(() => petDocumentVisible.value && store.petWindowMode.mode === 'normal')

function pluginBadgeSummary(petId: string) {
  if (!pluginBadgesVisible.value) return { badges: [], hiddenCount: 0 }
  return summarizePluginBadgesForPet(pluginBadges.value, petId, pluginFeedTargetPetId.value)
}

function pluginBadgeTooltip(badge: PluginBadgeView): string {
  return t('pluginBadgeTooltip', { plugin: badge.pluginName[locale.value], text: badge.text })
}

function onPetDocumentVisibilityChange(): void {
  petDocumentVisible.value = document.visibilityState === 'visible'
}

const pluginFeedTargetStyle = usePetBubbleAnchor(
  clickAreaRef,
  multiPetItemElements,
  () => store.familyLines,
  () => isMultiPet.value && Boolean(store.pluginFeedItem),
  () => pluginFeedTargetPetId.value,
)

// pet_say bubbles follow the pet they were addressed to when several are shown.
const sayTargetStyle = usePetBubbleAnchor(
  clickAreaRef,
  multiPetItemElements,
  () => store.familyLines,
  () => isMultiPet.value && Boolean(store.presentationSay?.petId),
  () => store.presentationSay?.petId,
)

// Quota 顏色由 CSS 依 data-quota-tier 選 token（DesktopPet.css），插件主題可透過 --pet-status-* 重新上色一般與低額度填色（危急 < 20% 維持內建），也讓 token 檢查看得到用處。
type QuotaTier = 'low' | 'warning' | 'claude' | 'normal'

// 額度充足時的顏色：Claude 用品牌 accent，其他家族用 sage。新增有額度的家族時這張表少一格就編譯失敗。
const QUOTA_FAMILY_TIER = Object.freeze({
  codex: 'normal',
  claude: 'claude',
} as const satisfies Record<QuotaFamilyKey, QuotaTier>)

function quotaTier(familyKey: string): QuotaTier | undefined {
  const quota = store.quotaByFamily[familyKey]
  if (!quota || !isQuotaFamilyKey(familyKey)) return undefined
  if (quota.remainingPercent < 20) return 'low'
  if (quota.remainingPercent < 50) return 'warning'
  return QUOTA_FAMILY_TIER[familyKey]
}

usePetTheme()

function quotaFillStyle(familyKey: string): Record<string, string> {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return {}
  return {
    width: `${quota.remainingPercent}%`,
  }
}

function quotaPercent(familyKey: string): string {
  const remaining = store.quotaByFamily[familyKey]?.remainingPercent
  if (remaining === undefined) return ''
  return String(roundQuotaPercent(remaining))
}

function quotaDetails(familyKey: string) {
  const provider = store.quotaUsage?.providers.find((candidate) => candidate.id === familyKey)
  if (!provider) return []
  const primaryWindows = provider.windows.filter((window) => {
    const identity = `${window.id} ${window.label}`.toLowerCase()
    return identity.includes('session')
      || identity.includes('weekly')
      || identity.includes('five_hour')
      || identity.includes('seven_day')
  })
  return (primaryWindows.length > 0 ? primaryWindows : provider.windows).slice(0, 4)
}

function quotaDetailPercent(remainingPercent: number): string {
  return String(roundQuotaPercent(remainingPercent))
}

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return t('resetTimeUnavailable')
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return t('resetTimeUnavailable')
  // No year: the longest quota window is 7 days out, so it carries no
  // information and is the single widest chunk of the tooltip.
  return t('resetAt', { time: formatDateParts(reset, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
}

// --- Quota 下降時的閃爍動畫 -------------------------------------------------

// A quota drop is the pet "taking damage" — flash the meter for a moment so
// a change that happened while you weren't looking still registers. Driven
// by a class toggle (not a CSS transition) so consecutive drops re-run the
// animation from the start instead of being swallowed mid-flight.
const draining = ref<Record<string, boolean>>({})
const drainTimers: Record<string, number> = {}
const lastRemaining: Record<string, number> = {}

function flashDrain(familyKey: string) {
  window.clearTimeout(drainTimers[familyKey])
  draining.value = { ...draining.value, [familyKey]: false }
  requestAnimationFrame(() => {
    draining.value = { ...draining.value, [familyKey]: true }
    drainTimers[familyKey] = window.setTimeout(() => {
      draining.value = { ...draining.value, [familyKey]: false }
    }, 700)
  })
}

watch(() => store.quotaByFamily, (quotas) => {
  for (const [familyKey, quota] of Object.entries(quotas)) {
    const previous = lastRemaining[familyKey]
    lastRemaining[familyKey] = quota.remainingPercent
    // Only a meaningful drop counts: refreshes that report the same number
    // (or a reset that refills the bar) shouldn't strobe the meter.
    if (previous !== undefined && quota.remainingPercent < previous - 0.05) {
      flashDrain(familyKey)
    }
  }
}, { deep: true })

onBeforeUnmount(() => {
  Object.values(drainTimers).forEach((timer) => window.clearTimeout(timer))
})

function quotaTitle(familyKey: string): string | undefined {
  const details = quotaDetails(familyKey)
  if (details.length === 0) return undefined
  return details.map((quota) => (
    `${quotaWindowLabel(quota.id, quota.label)}：${t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) })} · ${quotaResetLabel(quota.resetsAt)}`
  )).join('\n')
}

// --- 狀態列文字、寬度預算與插件徽章 -----------------------------------------
// 各家族的狀態列：畫面上是英文短字，提示框與可存取名稱是介面語言的完整文字。
// 沒有家族時的整體狀態列（Idle／Offline）只有英文狀態詞，提示與可存取名稱也用同一個字。
function lineText(line: StatusLineSource & { state: AgentState }): string {
  return statusLineText(line, line.label ? stateAriaLabel(line.state) : stateLineLabel(line.state))
}

// 以 canvas 量字寬（不觸發版面計算），結果依字串快取；字型載入完成或主題切換時清快取重算。
// 沒有 canvas 時的保守估計（每字 8px），寧可多拿掉東西也不讓狀態被截斷。
const STATUS_TEXT_FALLBACK_CHAR_W = 8
// 快取的鍵含插件徽章文字，數量沒有上限；超過時整批清掉重量（量一次只要微秒級）。
const STATUS_TEXT_CACHE_MAX = 256
const statusFontEpoch = ref(0)
const statusTextWidths = new Map<string, number>()
let statusTextContext: CanvasRenderingContext2D | null | undefined
let statusFontSpecs: Record<StatusLinePart, string> | null = null

function statusFonts(): Record<StatusLinePart, string> {
  if (statusFontSpecs) return statusFontSpecs
  const root = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback
  statusFontSpecs = Object.fromEntries(Object.entries(STATUS_TEXT_FONTS).map(([part, font]) => (
    [part, `${font.weight} ${token(font.sizeVar, font.sizeFallback)} ${token(font.familyVar, 'sans-serif')}`]
  ))) as Record<StatusLinePart, string>
  return statusFontSpecs
}

const measureStatusText: MeasureText = (text, part) => {
  const cacheKey = `${part}\u0000${text}`
  const cached = statusTextWidths.get(cacheKey)
  if (cached !== undefined) return cached
  if (statusTextContext === undefined) statusTextContext = document.createElement('canvas').getContext('2d')
  let width = Array.from(text).length * STATUS_TEXT_FALLBACK_CHAR_W
  if (statusTextContext) {
    statusTextContext.font = statusFonts()[part]
    width = statusTextContext.measureText(text).width
  }
  if (statusTextWidths.size >= STATUS_TEXT_CACHE_MAX) statusTextWidths.clear()
  statusTextWidths.set(cacheKey, width)
  return width
}

function resetStatusTextMetrics() {
  statusTextWidths.clear()
  statusFontSpecs = null
  statusFontEpoch.value += 1
}

interface StatusLineView {
  text: string
  aria: string
  /** 沒有 Quota 提示框時的 title；含被寬度預算拿掉的徽章。 */
  title: string
  fit: StatusLineFit
  /** 寬度預算內放得下的徽章。 */
  badges: PluginBadgeView[]
  /** 「+N」的 N；放不下或沒有時為 0。 */
  overflowCount: number
}

const EMPTY_STATUS_LINE_VIEW: StatusLineView = {
  text: '',
  aria: '',
  title: '',
  fit: { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false },
  badges: [],
  overflowCount: 0,
}

// 每條狀態列的文字、可存取名稱、寬度取捨與徽章一次算好；模板只查表，
// 不再於每次 render 對每條線重複過濾徽章或重組文字。
const statusLineViews = computed<Record<string, StatusLineView>>(() => {
  void statusFontEpoch.value
  const multi = isMultiPet.value
  const lines = multi ? store.familyLines : displayLines.value
  const contentWidth = statusLineContentWidth(multi, store.petScale, store.scaledW)
  const badgesByPet = new Map<string, ReturnType<typeof pluginBadgeSummary>>()
  const views: Record<string, StatusLineView> = {}
  for (const line of lines) {
    let summary = badgesByPet.get(line.petId)
    if (!summary) {
      summary = pluginBadgeSummary(line.petId)
      badgesByPet.set(line.petId, summary)
    }
    const quota = store.quotaByFamily[line.key]
    const fit = fitStatusLine({
      contentWidth,
      label: line.label,
      state: stateLineLabel(line.state),
      readout: quota ? `${quotaPercent(line.key)}%` : null,
      badges: summary.badges.map(badge => badge.text),
      hiddenCount: summary.hiddenCount,
    }, measureStatusText)
    const text = lineText(line)
    // 被拿掉的徽章與「+N」不能從可存取名稱裡消失。
    const dropped = summary.badges.slice(fit.badgeCount).map(pluginBadgeTooltip)
    if (!fit.showOverflow && summary.hiddenCount > 0) dropped.push(t('pluginBadgeOverflow', { count: summary.hiddenCount }))
    views[line.key] = {
      text,
      aria: [text, quotaTitle(line.key) ?? '', ...dropped].filter(Boolean).join('\n'),
      title: [text, ...dropped].join('\n'),
      fit,
      badges: summary.badges.slice(0, fit.badgeCount),
      overflowCount: fit.showOverflow ? summary.hiddenCount : 0,
    }
  }
  return views
})

function lineView(key: string): StatusLineView {
  return statusLineViews.value[key] ?? EMPTY_STATUS_LINE_VIEW
}

onMounted(() => {
  document.fonts?.addEventListener('loadingdone', resetStatusTextMetrics)
  void document.fonts?.ready.then(resetStatusTextMetrics)
})

onBeforeUnmount(() => {
  document.fonts?.removeEventListener('loadingdone', resetStatusTextMetrics)
})

watch(resolvedPetTheme, resetStatusTextMetrics)

// --- Permission 泡泡 --------------------------------------------------------

// --- 視窗高度回報（ResizeObserver）------------------------------------------

// The sprite is bottom-anchored inside a window that reserves fixed
// transparent headroom above it for the quota tooltip, so how much of the
// window is actually painted varies with pet size and status-line count.
// Main can't derive that, and it's what the status panel anchors to, so
// measure it here and report every change.
let contentObserver: ResizeObserver | null = null

onMounted(() => {
  armCoach()
  store.loadPets()
  void initializeShimejiEnvironment()
  petDocumentVisible.value = document.visibilityState === 'visible'
  document.addEventListener('visibilitychange', onPetDocumentVisibilityChange)
  cleanupPluginBadgeListener = window.electronAPI?.onPluginBadgesChanged?.((badges) => {
    pluginBadgeRevision += 1
    pluginBadges.value = badges
  }) ?? null
  const getPluginBadges = window.electronAPI?.getPluginBadges
  if (getPluginBadges) {
    const revision = pluginBadgeRevision
    void getPluginBadges().then((badges) => {
      if (pluginBadgeRevision === revision) pluginBadges.value = badges
    }).catch(() => {})
  }

  if (!clickAreaRef.value || !window.electronAPI?.reportContentHeight) return
  contentObserver = new ResizeObserver(([entry]) => {
    window.electronAPI?.reportContentHeight(Math.ceil(entry.contentRect.height))
  })
  contentObserver.observe(clickAreaRef.value)
})

onBeforeUnmount(() => {
  if (singleClickTimer) clearTimeout(singleClickTimer)
  if (coachTimer) clearTimeout(coachTimer)
  contentObserver?.disconnect()
  contentObserver = null
  cleanupPluginBadgeListener?.()
  cleanupPluginBadgeListener = null
  document.removeEventListener('visibilitychange', onPetDocumentVisibilityChange)
  disposeShimejiEnvironment()
})

// --- 拖曳與點擊 --------------------------------------------------------------

let lastCursorLookAt = 0
let lastCursorLookDirection: -1 | 0 | 1 = 0
function onPetMouseMove(e: MouseEvent): void {
  store.markPetInteraction()
  if (!store.shimejiEnabled || !store.reactionsActive || store.currentState !== 'idle') return
  if (store.petWindowMode.mode !== 'normal' || store.isDragging) return
  const area = clickAreaRef.value
  if (!area) return
  const rect = area.getBoundingClientRect()
  const offset = e.clientX - (rect.left + rect.width / 2)
  const direction: -1 | 0 | 1 = offset < -12 ? -1 : offset > 12 ? 1 : 0
  if (direction === 0 || direction === lastCursorLookDirection) return
  const now = Date.now()
  if (now - lastCursorLookAt < 350) return
  lastCursorLookAt = now
  lastCursorLookDirection = direction
  if (isMultiPet.value) {
    multiPetAnimations().forEach(anim => anim.playCursorLook(direction))
  } else {
    petAnimRef.value?.playCursorLook(direction)
  }
}

// A press only becomes a drag after the pointer travels this far; a shaky
// click on a trackpad must still open the panel.
const DRAG_START_DISTANCE_PX = 4
const dragLift = ref(false)

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  dismissCoach()
  store.markPetInteraction()
  hasMoved.value = false
  mouseDownTime = Date.now()
  // Keeps the window catching events while the button is held, even before a
  // drag has actually begun.
  store.isDragging = true
  dragOffset.value = { x: e.screenX, y: e.screenY }
  let dragStarted = false

  // Actual window movement is driven entirely by the main process polling
  // screen.getCursorScreenPoint() (see electron/ipc/pet-motion.ts) rather than
  // by accumulating deltas between renderer mousemove events. On Windows,
  // moving a frameless window under the cursor makes the OS resend a
  // synthetic mousemove for the new window position; a delta-from-previous
  // approach picks that up as extra "movement" and re-moves the window again —
  // a feedback loop that reads as the pet drifting for as long as the button
  // is held. Polling the OS cursor position directly sidesteps that loop.
  const onMove = (moveEvent: MouseEvent) => {
    if (dragStarted) return
    const dx = moveEvent.screenX - dragOffset.value.x
    const dy = moveEvent.screenY - dragOffset.value.y
    if (Math.abs(dx) > DRAG_START_DISTANCE_PX || Math.abs(dy) > DRAG_START_DISTANCE_PX) {
      dragStarted = true
      hasMoved.value = true
      dragLift.value = true
      window.electronAPI?.startDrag()
    }
  }

  const onUp = () => {
    store.isDragging = false
    dragLift.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    // Must fire unconditionally, even on a plain click with no movement: it is
    // the only signal that stops the main process' cursor-poll loop, and
    // gating it on hasMoved left that loop running after a plain click so the
    // pet kept chasing the cursor until the next mousedown replaced it.
    window.electronAPI?.notifyDragEnd(hasMoved.value)
    if (dragStarted) {
      // Landing squash: the pet settles where it was dropped.
      if (isMultiPet.value) multiPetAnimations().forEach(anim => anim.playReaction())
      else petAnimRef.value?.playReaction()
    }
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onEdgeMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return
  e.stopPropagation()
  // The main process restores the saved Normal bounds before starting its
  // cursor poll. Calling the same drag path keeps mouse and keyboard entry
  // points consistent without letting the renderer choose native bounds.
  onMouseDown(e)
}

// A single click waits briefly so a double click (pat) can cancel it instead of
// also toggling the panel twice.
const SINGLE_CLICK_DELAY_MS = 220
let singleClickTimer: ReturnType<typeof setTimeout> | null = null

function onDoubleClick(e: MouseEvent): void {
  if (e.button !== 0 || hasMoved.value) return
  if (singleClickTimer) clearTimeout(singleClickTimer)
  singleClickTimer = null
  // Rewarded pats show a heart and bump mood; capped pats still react.
  store.patPet()
  const reaction = 'encouraging' as const
  if (isMultiPet.value) multiPetAnimations().forEach(anim => anim.playReaction(reaction))
  else petAnimRef.value?.playReaction(reaction)
}

function onClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (hasMoved.value) return
  store.clearUnreadResults()
  if (isMultiPet.value) {
    multiPetAnimations().forEach(anim => anim.playReaction())
  } else {
    petAnimRef.value?.playReaction()
  }
  if (singleClickTimer) clearTimeout(singleClickTimer)
  singleClickTimer = setTimeout(() => {
    singleClickTimer = null
    store.togglePanel()
  }, SINGLE_CLICK_DELAY_MS)
}

function onPetContextMenu(e: MouseEvent): void {
  const target = e.target instanceof Element ? e.target : null
  if (!target) return
  // Only the actual sprite and its compact Edge representation are hide
  // targets. Permission cards, status lines, toasts, and other controls do not
  // inherit this shortcut.
  const isPetSurface = Boolean(target.closest('[data-pet-context-target="hide"]'))
  if (!isPetSurface) return
  // "Hide on right-click" is an explicit opt-in; otherwise show the full menu.
  if (store.rightClickHideEnabled) window.electronAPI?.requestPetHide()
  else window.electronAPI?.showPetContextMenu()
}

// --- Presentation 與成就回饋動畫 ---------------------------------------------

watch(() => store.presentationReaction, (reaction) => {
  // An explicit MCP request is always shown: with motion effects off the pet
  // still gets its icon mark, just without the movement.
  if (!reaction) return
  const kind = reaction.reaction
  if (isMultiPet.value) {
    if (reaction.petId) {
      multiPetAnimationForPet(reaction.petId)?.playReaction(kind)
    } else {
      multiPetAnimations().forEach(anim => anim.playReaction(kind))
    }
    return
  }
  if (!reaction.petId || reaction.petId === store.activePetId) {
    petAnimRef.value?.playReaction(kind)
  }
}, { deep: true })

function playAchievementReward(unlock: AchievementUnlock): void {
  if (!store.reactionsActive) return
  if (isMultiPet.value) {
    const target = multiPetAnimationForPet(unlock.petId)
    if (target) {
      target.playReward()
      return
    }
    multiPetAnimations().forEach(anim => anim.playReward())
    return
  }
  if (unlock.petId === store.activePetId) petAnimRef.value?.playReward()
}

watch(() => store.achievementUnlock, (unlock) => {
  if (unlock) playAchievementReward(unlock)
})

// Level-up / evolution reuses the reward animation (growth stream).
watch(() => store.levelUpEvent, (event) => {
  if (event && store.reactionsActive) petAnimRef.value?.playReward()
})
</script>

<template>
  <div
    class="desktop-pet"
    :class="[`mode-${store.petWindowMode.mode}`, store.petWindowMode.edge ? `edge-${store.petWindowMode.edge}` : '']"
    :data-pet-mode="store.petWindowMode.mode"
    :style="{ '--mini-scale': miniScale }"
  >
    <div
      ref="clickAreaRef"
      class="pet-click-area"
      :class="{ dragging: dragLift }"
      :role="store.petWindowMode.mode === 'edge' ? undefined : 'button'"
      :tabindex="store.petWindowMode.mode === 'edge' ? undefined : 0"
      :aria-label="store.petWindowMode.mode === 'edge' ? undefined : petAriaLabel"
      @keydown="onPetKeydown"
      @dblclick="onDoubleClick"
      @mousedown="onMouseDown"
      @mouseenter="onPetPointerEnter"
      @mouseleave="pointerOverPet = false"
      @mousemove="onPetMouseMove"
      @click="onClick"
      @contextmenu.prevent="onPetContextMenu"
    >
      <div
        v-if="store.petWindowMode.mode === 'edge'"
        class="edge-peek-handle"
        role="button"
        tabindex="0"
        :aria-label="t('expandFromEdge')"
        data-pet-hit-target="solid"
        data-pet-context-target="hide"
        @mousedown.stop="onEdgeMouseDown"
        @click.stop="store.setPetMode('normal')"
        @keydown.enter.prevent="store.setPetMode('normal')"
        @keydown.space.prevent="store.setPetMode('normal')"
      >
        <span
          class="edge-peek-avatar"
          aria-hidden="true"
          :style="{ '--edge-peek-avatar-scale': 0.5 / store.petScale }"
        >
          <PetAnimation
            :state="store.currentState"
            :pet-id="store.activePetId"
            :since="store.highestPrioritySession?.lastSeenAt"
            autonomous-behavior="idle"
            :freeze="petAnimationFrozen"
            :low-fps="petLowFps"
            :facing="shimejiFacing"
          />
        </span>
        <span class="edge-peek-grip" aria-hidden="true" />
        <span
          v-if="store.completionMarkersEnabled && store.unreadResults.count > 0"
          class="edge-peek-result-badge"
          :class="{ error: store.unreadResults.hasError }"
          :aria-label="t('pet.unreadResultsAria', { count: store.unreadResults.count })"
        >
          {{ store.unreadResults.count }}
        </span>
        <span
          v-if="store.pluginFeedUnreadCount > 0"
          class="edge-peek-unread-badge"
          :aria-label="t('pluginFeedUnreadNotifications', { count: store.pluginFeedUnreadCount })"
        >
          {{ store.pluginFeedUnreadCount > 99 ? '99+' : store.pluginFeedUnreadCount }}
        </span>
      </div>

      <template v-else>
      <Transition v-if="bubbleSelection === 'permission-request'" name="toast" mode="out-in">
        <PermissionBubble :key="store.permissionRequest ? `permission-${store.permissionRequest.requestId}` : `permission-outcome-${store.permissionOutcome?.requestId}`" />
      </Transition>

      <Transition v-else-if="bubbleSelection === 'permission-notice' && store.permissionBubbleActive && store.permissionNotice" name="toast" mode="out-in">
        <PermissionNoticeBubble key="permission-notice" />
      </Transition>

      <Transition v-else-if="bubbleSelection === 'presentation-say' && store.presentationSay" name="toast" mode="out-in">
        <div
          key="presentation-say"
          class="pet-toast presentation-say"
          :style="sayTargetStyle"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <Icon class="presentation-say-icon" name="pets" :size="14" />
          <span class="presentation-say-text">{{ store.presentationSay.message }}</span>
        </div>
      </Transition>

      <Transition v-else-if="bubbleSelection === 'agent-toast' || bubbleSelection === 'activity'" name="toast" mode="out-in">
        <div
          v-if="store.toast"
          :key="`toast-${store.toast.id}`"
          class="pet-toast timed-toast"
          :class="[store.toast.tone, { paused: store.toastPaused }]"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
          @mousedown.stop
          @mouseenter="store.pauseToast()"
          @mouseleave="store.resumeToast()"
          @focusin="store.pauseToast()"
          @focusout="store.resumeToast()"
          @click.stop="openFromToast"
        >
          <span class="timed-toast-head">
            <Icon class="timed-toast-icon" :name="toastIconName" :size="14" />
            <strong class="timed-toast-title">{{ store.toast.title }}</strong>
            <span v-if="store.toast.meta" class="timed-toast-meta">{{ store.toast.meta }}</span>
          </span>
          <span v-if="store.toast.detail" class="timed-toast-detail">{{ store.toast.detail }}</span>
          <Button variant="ghost" size="sm" class="timed-toast-action" @mousedown.stop @click.stop="openFromToast">
            {{ t('pet.toastOpen') }}
          </Button>
          <span
            class="toast-countdown-track"
            aria-hidden="true"
          >
            <span
              class="toast-countdown-fill"
              :style="{ '--toast-duration': `${store.toast.countdown.durationMs}ms` }"
            />
          </span>
          <span class="sr-only">{{ t('pet.toastAutoClose', { seconds: toastAutoCloseSeconds }) }}</span>
        </div>
        <div v-else-if="!isMultiPet && store.activityText" key="activity" class="pet-toast activity" data-pet-hit-target="solid">
          <Icon class="activity-icon" name="settings" :size="14" />
          <span class="activity-text">{{ activityLabel }}</span>
        </div>
      </Transition>

      <Transition v-else-if="bubbleSelection === 'plugin-feed-normal' || bubbleSelection === 'plugin-feed-low'" name="toast" mode="out-in">
        <article
          v-if="store.pluginFeedItem"
          :key="`plugin-feed-${store.pluginFeedItem.id}`"
          class="pet-toast plugin-feed-toast"
          :style="pluginFeedTargetStyle"
          :data-target-pet-id="pluginFeedTargetPetId"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
          @mousedown.stop
          @click.stop
        >
          <img v-if="store.pluginFeedItem.iconUrl" class="plugin-feed-icon" :src="store.pluginFeedItem.iconUrl" alt="" />
          <div class="plugin-feed-copy">
            <span class="plugin-feed-source">{{ store.pluginFeedItem.pluginName[locale] }}</span>
            <!-- raw-control: 整則插件訊息（標題＋內文）都是連結；Button 是單行置中的動作按鈕，沒有多行內容的版型 -->
            <button
              v-if="store.pluginFeedItem.link"
              type="button"
              class="plugin-feed-message plugin-feed-link"
              :aria-label="t('pluginFeedOpenLink')"
              @click.stop="openPluginFeedLink(store.pluginFeedItem.id)"
            >
              <strong>{{ store.pluginFeedItem.title }}</strong>
              <span>{{ store.pluginFeedItem.body }}</span>
            </button>
            <div v-else class="plugin-feed-message">
              <strong>{{ store.pluginFeedItem.title }}</strong>
              <span>{{ store.pluginFeedItem.body }}</span>
            </div>
            <Button
              v-if="store.pluginFeedItem.panelViewAvailable"
              variant="secondary"
              size="sm"
              class="plugin-feed-open-panel"
              @mousedown.stop
              @click.stop="openPluginPanelFromFeed(store.pluginFeedItem.pluginId)"
            >
              {{ t('pluginOpenPanel') }}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon-only
            class="plugin-feed-close"
            :aria-label="t('close')"
            @mousedown.stop
            @click.stop="store.completePluginFeed(store.pluginFeedItem.id)"
          >
            <Icon name="close" :size="12" />
          </Button>
        </article>
      </Transition>

      <Transition v-else-if="coachShown" name="toast">
        <div
          key="coach"
          class="pet-toast coach-mark"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
          @mousedown.stop
          @click.stop
        >
          <span class="coach-copy">{{ t('pet.coachText') }}</span>
          <Button size="sm" variant="secondary" @mousedown.stop @click.stop="dismissCoach">{{ t('pet.coachDismiss') }}</Button>
        </div>
      </Transition>

      <span class="sr-only" role="status" aria-live="polite">{{ stateAnnouncement }}</span>

      <span
        v-if="store.petWindowMode.mode === 'mini'"
        class="mini-status"
        role="status"
        :aria-label="miniStatus.label"
        :title="miniStatus.label"
        :style="{ '--mini-ring': AGENT_STATE_PRESENTATION[store.currentState].color }"
      >
        <span class="mini-status-badge" :class="{ pulse: store.currentState !== 'idle' && store.currentState !== 'offline' }">
          <Icon v-if="miniStatus.icon" :name="miniStatus.icon" :size="11" />
          <span v-else class="mini-status-dot" />
        </span>
        <span v-if="store.completionMarkersEnabled && store.unreadResults.count > 0" class="mini-status-count">{{ store.unreadResults.count }}</span>
      </span>

      <span
        v-if="store.completionMarkersEnabled && store.unreadResults.count > 0"
        class="unread-badge"
        :class="{ error: store.unreadResults.hasError }"
        role="status"
        :aria-label="t('pet.unreadResultsAria', { count: store.unreadResults.count })"
        data-pet-hit-target="solid"
        @mousedown.stop
        @click.stop="store.clearUnreadResults()"
      >
        <Icon :name="store.unreadResults.hasError ? 'warning' : 'check'" :size="11" />
        {{ store.unreadResults.count }}
      </span>

      <template v-if="isMultiPet">
        <div class="multi-pet-row">
          <div v-for="line in store.familyLines" :key="line.key" :ref="(el) => setMultiPetItem(line.key, el)" class="multi-pet-item">
            <PetAnimation
              :ref="(el) => setMultiPetRef(line.key, el)"
              :state="line.state"
              :pet-id="line.petId"
              :since="line.since"
              :mood="store.moodVisualsEnabled ? store.mood : undefined"
              :autonomous-behavior="shimejiBehavior"
              :freeze="petAnimationFrozen"
              :low-fps="petLowFps"
              :facing="shimejiFacing"
            />
            <div
              class="status-line multi-pet-status-line"
              role="group"
              :class="{
                'has-quota': store.quotaByFamily[line.key],
                'quota-motion': store.reactionsActive,
                'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
                'quota-drain': store.reactionsActive && draining[line.key],
              }"
              :data-quota-tier="quotaTier(line.key)"
              :aria-label="lineView(line.key).aria"
              :title="store.quotaByFamily[line.key] ? undefined : lineView(line.key).title"
              :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
              data-pet-hit-target="solid"
            >
              <span class="line-dot" :class="`dot-${line.state}`" :style="{ background: AGENT_STATE_PRESENTATION[line.state].color, color: AGENT_STATE_PRESENTATION[line.state].color }" />
              <span v-if="lineView(line.key).fit.showLabel" class="line-text">
                <span class="line-label">{{ line.label }}</span>
                <span class="line-sep">·</span>
              </span>
              <span class="line-state">{{ stateLineLabel(line.state) }}</span>
              <span v-if="pluginBadgesVisible" class="plugin-status-badges">
                <template v-for="badge in lineView(line.key).badges" :key="badge.pluginId">
                  <span class="plugin-badge-anchor" tabindex="0" :aria-label="pluginBadgeTooltip(badge)">
                    <span class="plugin-badge-pill" :class="`tone-${badge.tone}`">{{ badge.text }}</span>
                    <span class="plugin-badge-tooltip" role="tooltip">{{ pluginBadgeTooltip(badge) }}</span>
                  </span>
                </template>
                <span
                  v-if="lineView(line.key).overflowCount > 0"
                  class="plugin-badge-pill plugin-badge-overflow"
                  :aria-label="t('pluginBadgeOverflow', { count: lineView(line.key).overflowCount })"
                >+{{ lineView(line.key).overflowCount }}</span>
              </span>
              <span v-if="store.quotaByFamily[line.key] && lineView(line.key).fit.showReadout" class="quota-readout">
                {{ quotaPercent(line.key) }}%
              </span>
              <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
                <span v-if="line.label" class="quota-tooltip-line">{{ lineView(line.key).text }}</span>
                <span
                  v-for="quota in quotaDetails(line.key)"
                  :key="quota.id"
                  class="quota-tooltip-row"
                >
                  <span class="quota-tooltip-summary">
                    <strong>{{ quotaWindowLabel(quota.id, quota.label) }}</strong>
                    <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                  </span>
                  <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
                </span>
              </span>
              <span
                v-if="store.quotaByFamily[line.key]"
                class="quota-meter"
                role="progressbar"
                :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
              >
                <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
              </span>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <PetAnimation
          ref="petAnimRef"
          :state="store.currentState"
          :pet-id="store.activePetId"
          :since="store.highestPrioritySession?.lastSeenAt"
          :mood="store.moodVisualsEnabled ? store.mood : undefined"
          :autonomous-behavior="shimejiBehavior"
          :freeze="petAnimationFrozen"
          :low-fps="petLowFps"
          :facing="shimejiFacing"
        />
        <TransitionGroup tag="div" name="status-line" class="status-lines">
          <div
            v-for="line in displayLines"
            :key="line.key"
            class="status-line"
            role="group"
            :class="{
              'has-quota': store.quotaByFamily[line.key],
              'quota-motion': store.reactionsActive,
              'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
              'quota-drain': store.reactionsActive && draining[line.key],
            }"
            :data-quota-tier="quotaTier(line.key)"
            :aria-label="lineView(line.key).aria"
            :title="store.quotaByFamily[line.key] ? undefined : lineView(line.key).title"
            :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
            data-pet-hit-target="solid"
          >
            <span class="line-dot" :class="`dot-${line.state}`" :style="{ background: AGENT_STATE_PRESENTATION[line.state].color, color: AGENT_STATE_PRESENTATION[line.state].color }" />
            <span v-if="line.label && lineView(line.key).fit.showLabel" class="line-text">
              <span class="line-label">{{ line.label }}</span>
              <span class="line-sep">·</span>
            </span>
            <span class="line-state">{{ stateLineLabel(line.state) }}</span>
            <span v-if="pluginBadgesVisible" class="plugin-status-badges">
              <template v-for="badge in lineView(line.key).badges" :key="badge.pluginId">
                <span class="plugin-badge-anchor" tabindex="0" :aria-label="pluginBadgeTooltip(badge)">
                  <span class="plugin-badge-pill" :class="`tone-${badge.tone}`">{{ badge.text }}</span>
                  <span class="plugin-badge-tooltip" role="tooltip">{{ pluginBadgeTooltip(badge) }}</span>
                </span>
              </template>
              <span
                v-if="lineView(line.key).overflowCount > 0"
                class="plugin-badge-pill plugin-badge-overflow"
                :aria-label="t('pluginBadgeOverflow', { count: lineView(line.key).overflowCount })"
              >+{{ lineView(line.key).overflowCount }}</span>
            </span>
            <span v-if="store.quotaByFamily[line.key] && lineView(line.key).fit.showReadout" class="quota-readout">
              {{ quotaPercent(line.key) }}%
            </span>
            <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
              <span v-if="line.label" class="quota-tooltip-line">{{ lineView(line.key).text }}</span>
              <span
                v-for="quota in quotaDetails(line.key)"
                :key="quota.id"
                class="quota-tooltip-row"
              >
                <span class="quota-tooltip-summary">
                  <strong>{{ quotaWindowLabel(quota.id, quota.label) }}</strong>
                  <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                </span>
                <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
              </span>
            </span>
            <span
              v-if="store.quotaByFamily[line.key]"
              class="quota-meter"
              role="progressbar"
              :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
            >
              <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
            </span>
          </div>
        </TransitionGroup>
      </template>
      </template>
    </div>
  </div>
</template>

<style scoped src="@/components/DesktopPet.css"></style>
<style scoped src="@/components/DesktopPetBubbles.css"></style>
