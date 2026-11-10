<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import type { AgentState } from '@/types/agent'
import type { PetAutonomousBehavior, PetBehaviorManifest } from '@/types/pet'
import type { PresentationReaction } from '@/types/presentation'
import Icon from '@/components/ui/Icon.vue'
import { useAgentStore } from '@/stores/agentStore'
import {
  PET_ATLAS_MOTIONS,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  petAtlasGridFromSize,
  resolvePetMotionTable,
  type PetAtlasGrid,
  type PetMotionDefinition,
  type PetMotionName,
  type PetMotionTable,
} from '@/types/pet-atlas'
import { getCachedSprite, getCachedTint, loadPetSprite, setCachedTint } from '@/composables/usePetSpriteCache'
import { useReducedMotion } from '@/composables/useReducedMotion'
import { frameDelayMultiplier, isSignificantTransition, motionPlanFor } from '@/utils/pet-motion-plan'

const props = defineProps<{
  state: AgentState
  petId: string
  since?: number
  mood?: number
  autonomousBehavior?: PetAutonomousBehavior
  freeze?: boolean
  /** 仍會播放，但每秒只有幾格（迷你模式）。 */
  lowFps?: boolean
  /** -1 會把 sprite 左右鏡射（往左走）。 */
  facing?: -1 | 1
}>()

// --- 心情與光暈 ---------------------------------------------------------------
// 心情低時盡量維持寵物原本的顏色；看得出來的變化主要來自輪廓光暈，而不是把寵物調暗。
const moodTier = computed<'happy' | 'neutral' | 'low'>(() => {
  if (props.mood === undefined) return 'neutral'
  if (props.mood >= 70) return 'happy'
  if (props.mood <= 25) return 'low'
  return 'neutral'
})

type MoodEnergyTier = 'resting' | 'charged' | 'radiant' | 'overdrive'

const moodValue = computed(() => Math.max(0, Math.min(100, props.mood ?? 10)))
const moodEnergyTier = computed<MoodEnergyTier>(() => {
  if (moodValue.value >= 90) return 'overdrive'
  if (moodValue.value >= 70) return 'radiant'
  if (moodValue.value >= 40) return 'charged'
  return 'resting'
})
// 光暈 canvas 只在心情讓它可見時才存在（也才重畫）；休息狀態下它本來就全透明。
const auraInnerVisible = computed(() => props.mood !== undefined && moodValue.value > 10)
const auraOuterVisible = computed(() => props.mood !== undefined && moodValue.value > 60)
const moodAuraStyle = computed<Record<string, string>>(() => {
  const energy = Math.max(0, (moodValue.value - 10) / 90)
  const auraSpeed = 3.8 - energy * 2.1
  const outerEnergy = Math.max(0, (moodValue.value - 60) / 40)
  const innerScale = 1 + energy * 0.018
  const outerScale = 1.012 + energy * 0.028
  return {
    '--aura-inner-opacity': (energy * 0.4).toFixed(3),
    '--aura-outer-opacity': (outerEnergy * 0.22).toFixed(3),
    '--aura-inner-scale': innerScale.toFixed(3),
    '--aura-inner-peak': (innerScale + 0.006).toFixed(3),
    '--aura-outer-scale': outerScale.toFixed(3),
    '--aura-outer-peak': (outerScale + 0.01).toFixed(3),
    '--aura-speed': `${auraSpeed.toFixed(2)}s`,
    '--aura-speed-fast': `${(auraSpeed * 0.72).toFixed(2)}s`,
    '--aura-brightness': (1.05 + energy * 0.45).toFixed(3),
    '--aura-blur': `${(0.45 + energy * 0.75).toFixed(2)}px`,
    '--aura-blur-wide': `${(1.4 + energy * 1.8).toFixed(2)}px`,
  }
})

// --- 動作表與播放狀態 -----------------------------------------------------------
const store = useAgentStore()
const reducedMotion = useReducedMotion()
const documentVisible = ref(true)
const isPaused = computed(() => props.freeze === true || !documentVisible.value)

interface MotionStep {
  motion: PetMotionDefinition
  loops: number
}

interface MotionPlan {
  steps: MotionStep[]
  repeat: boolean
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const auraInnerRef = ref<HTMLCanvasElement | null>(null)
const auraOuterRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

const currentPet = computed(() => store.pets.find(pet => pet.id === props.petId))
const petBehaviorManifest = computed<PetBehaviorManifest | undefined>(() => currentPet.value?.behaviorManifest)

// 圖載入前格線未知，只套用解析器的上下限；換圖（imgRef 改變）後會用實際尺寸重算。
function atlasGrid(): PetAtlasGrid | null {
  const img = imgRef.value
  return img?.naturalWidth ? petAtlasGridFromSize(img.naturalWidth, img.naturalHeight) : null
}

// 只在 manifest 或圖改變時解析一次；播放時換動作是 O(1) 查表。
const motionTable = computed<PetMotionTable>(() => resolvePetMotionTable(petBehaviorManifest.value, atlasGrid()))
// 光暈色由 sprite 像素算出；算不出來時用色盤的高光色（--organic-highlight），不寫死顏色。
function paletteHighlight(): string {
  if (typeof document === 'undefined') return 'transparent'
  return getComputedStyle(document.documentElement).getPropertyValue('--organic-highlight').trim() || 'transparent'
}
let auraTint = paletteHighlight()
let frameTimerId: ReturnType<typeof setTimeout> | null = null
let animationFinished = false
let currentFrame = 0
let currentStep = 0
let completedLoops = 0
let motionPlan: MotionPlan = { steps: [{ motion: PET_ATLAS_MOTIONS.idle, loops: Number.POSITIVE_INFINITY }], repeat: false }
/** 目前這份計畫是用哪張動作表建的；換圖後表沒變就不必重排。 */
let planTable: PetMotionTable | null = null
let activeMotion: PetMotionDefinition = PET_ATLAS_MOTIONS.idle
/** 目前動作每一格的實際延遲（已乘上狀態節奏與低幀率倍率），每格只查表。 */
let frameDelays: readonly number[] = PET_ATLAS_MOTIONS.idle.frameDurations
const activeMotionName = ref<PetMotionName>('idle')
const activeMotionRow = ref(0)

// --- 反應、獎勵與游標注視 ---------------------------------------------------------
// 一次性的擠壓／伸展彈跳疊在循環動畫上，用 CSS class 而不是額外的 sprite 格，
// 所以不管圖集有幾列，每隻寵物都能用。
const isReacting = ref(false)
const reactionKind = ref<PresentationReaction | null>(null)
let reactionTimer: ReturnType<typeof setTimeout> | null = null
// 每種反應有自己的動作（CSS class）和一個往上飄的小圖示；關閉動態效果時圖示仍會顯示。
const REACTION_MARKS: Record<PresentationReaction, string> = {
  happy: 'sparkle',
  curious: 'question',
  thinking: 'dots',
  surprised: 'exclaim',
  encouraging: 'heart',
}
const REACTION_DURATION_MS: Record<PresentationReaction, number> = {
  happy: 560, curious: 760, thinking: 900, surprised: 420, encouraging: 700,
}
// 反應標記的 CSS 動畫長度由這個常數經 --pet-mark-duration 帶進去，計時器與動畫只有一個來源。
const REACTION_MARK_MS = 1400
const reactionMarkStyle = { '--pet-mark-duration': `${REACTION_MARK_MS}ms` }
const reactionMark = ref<{ id: number; icon: string } | null>(null)
let reactionMarkTimer: ReturnType<typeof setTimeout> | null = null
let reactionMarkId = 0

function playReaction(kind?: PresentationReaction) {
  isReacting.value = false
  reactionKind.value = kind ?? null
  requestAnimationFrame(() => {
    isReacting.value = true
    if (reactionTimer) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => { isReacting.value = false }, kind ? REACTION_DURATION_MS[kind] : 260)
  })
  if (kind) {
    reactionMark.value = { id: ++reactionMarkId, icon: REACTION_MARKS[kind] }
    if (reactionMarkTimer) clearTimeout(reactionMarkTimer)
    reactionMarkTimer = setTimeout(() => { reactionMark.value = null }, REACTION_MARK_MS)
  }
}

// 成就解鎖用獨立的視覺掛勾，新規則可以獎勵寵物，但不會改動狀態動畫或給予任何產品能力。
const isRewarding = ref(false)
let rewardTimer: ReturnType<typeof setTimeout> | null = null
function playReward() {
  isRewarding.value = false
  requestAnimationFrame(() => {
    isRewarding.value = true
    if (rewardTimer) clearTimeout(rewardTimer)
    rewardTimer = setTimeout(() => { isRewarding.value = false }, 900)
  })
}

const cursorLookDirection = ref<-1 | 0 | 1>(0)
let cursorLookTimer: ReturnType<typeof setTimeout> | null = null
function playCursorLook(direction: -1 | 1): void {
  cursorLookDirection.value = direction
  if (cursorLookTimer) clearTimeout(cursorLookTimer)
  cursorLookTimer = setTimeout(() => { cursorLookDirection.value = 0 }, 420)
}

defineExpose({ playReaction, playReward, playCursorLook })

// --- 閒置小動作 -------------------------------------------------------------------
// 定期輕微搖晃（和反應彈跳一樣是 CSS 層，不需要新的 sprite 格），讓長時間閒置不會完全靜止。
// 只在 state === 'idle' 時排程。
const isFidgeting = ref(false)
let fidgetTimer: ReturnType<typeof setTimeout> | null = null
let fidgetResetTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFidget() {
  if (isPaused.value) return
  if (fidgetTimer) clearTimeout(fidgetTimer)
  const delay = 6000 + Math.random() * 9000
  fidgetTimer = setTimeout(() => {
    if (props.state === 'idle') {
      isFidgeting.value = false
      requestAnimationFrame(() => {
        isFidgeting.value = true
        if (fidgetResetTimer) clearTimeout(fidgetResetTimer)
        fidgetResetTimer = setTimeout(() => { isFidgeting.value = false }, 700)
      })
    }
    scheduleFidget()
  }, delay)
}

function stopFidgetTimer() {
  if (fidgetTimer) {
    clearTimeout(fidgetTimer)
    fidgetTimer = null
  }
  if (fidgetResetTimer) {
    clearTimeout(fidgetResetTimer)
    fidgetResetTimer = null
  }
  isFidgeting.value = false
}

// --- 等待的急迫程度 ---------------------------------------------------------------
// 等待權限／輸入越久沒人回應，寵物動得越快、越抖，提醒使用者去回覆。
const isWaiting = computed(() => props.state === 'waiting-permission' || props.state === 'waiting-input')
const urgencyTick = ref(Date.now())
let urgencyTimer: ReturnType<typeof setInterval> | null = null

function startUrgencyTimer() {
  if (urgencyTimer || isPaused.value) return
  urgencyTick.value = Date.now()
  urgencyTimer = setInterval(() => { urgencyTick.value = Date.now() }, 500)
}

function stopUrgencyTimer() {
  if (urgencyTimer) {
    clearInterval(urgencyTimer)
    urgencyTimer = null
  }
}

const urgencyLevel = computed<0 | 1 | 2>(() => {
  if (!isWaiting.value || !props.since) return 0
  const elapsedSec = Math.max(0, urgencyTick.value - props.since) / 1000
  if (elapsedSec >= 30) return 2
  if (elapsedSec >= 12) return 1
  return 0
})

// --- 動作計畫與逐格計時 -------------------------------------------------------------
function motionPlanForState(): MotionPlan {
  const planned = motionPlanFor({
    state: props.state,
    urgency: urgencyLevel.value,
    behavior: props.autonomousBehavior,
    petId: props.petId,
  })
  const table = motionTable.value
  planTable = table
  return {
    steps: planned.steps.map(step => ({ motion: table[step.motion], loops: step.loops })),
    repeat: planned.repeat,
  }
}

const MIN_FRAME_DELAY_MS = 80
const LOW_FPS_FACTOR = 3
// 減少動態效果時比迷你視窗再慢一倍。
const LOW_FPS_REDUCED_FACTOR = 6

// 節奏只和狀態、急迫程度、是否在生悶氣、低幀率有關，換動作或這些條件改變時才重算；
// 每一格只讀 frameDelays[currentFrame]，計時器路徑上不配置任何物件。
function updateFrameDelays(): void {
  const multiplier = frameDelayMultiplier({
    state: props.state,
    urgency: urgencyLevel.value,
    // 摔倒播完後改成慢慢地閒置，而不是停在一格。
    sulking: props.state === 'error' && activeMotion.name === 'idle',
  })
  const lowFpsFactor = props.lowFps ? (reducedMotion.value ? LOW_FPS_REDUCED_FACTOR : LOW_FPS_FACTOR) : 1
  const factor = multiplier * lowFpsFactor
  frameDelays = activeMotion.frameDurations.map(ms => Math.max(MIN_FRAME_DELAY_MS, Math.round(ms * factor)))
}

function frameDelay(): number {
  return frameDelays[currentFrame] ?? MIN_FRAME_DELAY_MS
}

function selectStep(index: number) {
  currentStep = index
  completedLoops = 0
  currentFrame = 0
  activeMotion = motionPlan.steps[currentStep].motion
  activeMotionName.value = activeMotion.name
  activeMotionRow.value = activeMotion.row
  updateFrameDelays()
}

// --- 畫布尺寸與像素密度 -------------------------------------------------------------
// 背景緩衝區是 sprite 格的整數倍，依實際裝置像素（倍率 × 螢幕密度）決定，
// 讓最近鄰放大保持均勻，Retina 螢幕上也不會糊。
const devicePixelRatioRef = ref(window.devicePixelRatio || 1)
const backingK = computed(() => Math.max(1, Math.min(8, Math.round(store.petScale * devicePixelRatioRef.value))))
const backingW = computed(() => PET_CELL_WIDTH * backingK.value)
const backingH = computed(() => PET_CELL_HEIGHT * backingK.value)
let densityQuery: MediaQueryList | null = null

function watchDensity(): void {
  densityQuery?.removeEventListener('change', onDensityChange)
  if (typeof window.matchMedia !== 'function') return
  densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
  densityQuery.addEventListener('change', onDensityChange)
}

function onDensityChange(): void {
  devicePixelRatioRef.value = window.devicePixelRatio || 1
  watchDensity()
}

watch(backingK, () => { void nextTick(draw) })

const canvasW = computed(() => Math.round(PET_CELL_WIDTH * store.petScale))
const canvasH = computed(() => Math.round(PET_CELL_HEIGHT * store.petScale))

// --- 載入 sprite 與光暈色 ----------------------------------------------------------
function getSrc(id: string): string {
  const base = import.meta.env.BASE_URL || './'
  return `${base}pets/${id}/spritesheet.webp`
}

function deriveAuraTintFromPixels(pixels: Uint8ClampedArray): string {
  try {
    let red = 0
    let green = 0
    let blue = 0
    let weightTotal = 0
    let fallbackRed = 0
    let fallbackGreen = 0
    let fallbackBlue = 0
    let fallbackWeight = 0

    for (let index = 0; index < pixels.length; index += 16) {
      const alpha = pixels[index + 3] / 255
      if (alpha < 0.25) continue
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      const brightness = Math.max(r, g, b)
      const fallback = alpha * Math.max(0.2, brightness / 255)
      fallbackRed += r * fallback
      fallbackGreen += g * fallback
      fallbackBlue += b * fallback
      fallbackWeight += fallback
      if (chroma < 24 || brightness < 48) continue
      const weight = alpha * chroma * (0.55 + brightness / 510)
      red += r * weight
      green += g * weight
      blue += b * weight
      weightTotal += weight
    }

    const divisor = weightTotal || fallbackWeight
    if (!divisor) return auraTint
    const sourceRed = weightTotal ? red : fallbackRed
    const sourceGreen = weightTotal ? green : fallbackGreen
    const sourceBlue = weightTotal ? blue : fallbackBlue
    const channels = [sourceRed / divisor, sourceGreen / divisor, sourceBlue / divisor]
    const strongest = Math.max(...channels)
    const lift = strongest > 0 ? Math.min(1.65, 220 / strongest) : 1
    const [r, g, b] = channels.map(channel => Math.round(Math.min(255, channel * lift + 18)))
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return auraTint
  }
}

function deriveAuraTint(img: HTMLImageElement): string {
  try {
    const sample = document.createElement('canvas')
    sample.width = PET_CELL_WIDTH
    sample.height = PET_CELL_HEIGHT
    const ctx = sample.getContext('2d', { willReadFrequently: true })
    if (!ctx) return auraTint
    ctx.drawImage(img, 0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT, 0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT)
    return deriveAuraTintFromPixels(ctx.getImageData(0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT).data)
  } catch {
    return auraTint
  }
}

let loadSequence = 0

function applyImage(img: HTMLImageElement, cacheKey: string): void {
  imgRef.value = img
  auraTint = getCachedTint(cacheKey) ?? deriveAuraTint(img)
  setCachedTint(cacheKey, auraTint)
  currentFrame = 0
  // 換圖後動作表才知道實際欄列數；表真的變了（或正在走路、睡覺）才重排，否則只重畫。
  if (motionTable.value !== planTable || props.autonomousBehavior === 'walk' || props.autonomousBehavior === 'sleep') {
    startAnimation()
  } else {
    draw()
  }
}

async function spriteSourceFor(pet: (typeof store.pets)[number] | undefined, targetId: string): Promise<string | null> {
  if (pet?.pluginSkin) return pet.pluginSkin.spriteUrl
  if (pet && !pet.builtIn) return (await window.electronAPI?.getCustomPetSprite(targetId)) ?? null
  return getSrc(targetId)
}

async function loadImage() {
  // 較新的請求（舊的還在載入時又換了寵物）優先。
  const sequence = ++loadSequence
  const id = props.petId || store.defaultPetId
  const pet = store.pets.find(p => p.id === id)

  if (!pet && !store.petsLoaded) {
    return
  }

  const targetId = pet ? id : store.defaultPetId
  const isCustom = Boolean(pet && !pet.builtIn && !pet.pluginSkin)
  // 自訂圖的 URL 帶有修改時間，直接拿來當快取鍵：重新匯入同一個 id 不會顯示舊圖。
  const source = await spriteSourceFor(pet, targetId)
  if (sequence !== loadSequence) return
  const cacheKey = pet?.pluginSkin?.cacheKey ?? (isCustom && source ? source : targetId)
  const cached = getCachedSprite(cacheKey)
  if (cached) {
    applyImage(cached, cacheKey)
    return
  }
  const loaded = source ? await loadPetSprite(cacheKey, source) : null
  if (sequence !== loadSequence) return
  if (loaded) {
    applyImage(loaded, cacheKey)
    return
  }

  // 圖載入失敗：改顯示預設寵物，而不是空白畫布。
  if (targetId !== store.defaultPetId) {
    const fallbackKey = store.defaultPetId
    const fallback = await loadPetSprite(fallbackKey, getSrc(store.defaultPetId))
    if (sequence === loadSequence && fallback) applyImage(fallback, fallbackKey)
  }
}

// --- 繪製 ---------------------------------------------------------------------------
// 每一格都會呼叫：直接畫到固定的三張 canvas，不建陣列或物件。
function drawCell(canvas: HTMLCanvasElement | null, img: HTMLImageElement, sx: number, sy: number, w: number, h: number, tint: boolean): void {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, sx, sy, PET_CELL_WIDTH, PET_CELL_HEIGHT, 0, 0, w, h)
  if (!tint) return
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = auraTint
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
}

function draw() {
  const img = imgRef.value
  if (!img || !img.complete) return
  const sx = (currentFrame % activeMotion.frameDurations.length) * PET_CELL_WIDTH
  const sy = activeMotion.row * PET_CELL_HEIGHT
  const w = backingW.value
  const h = backingH.value
  drawCell(canvasRef.value, img, sx, sy, w, h, false)
  if (auraInnerVisible.value) drawCell(auraInnerRef.value, img, sx, sy, w, h, true)
  if (auraOuterVisible.value) drawCell(auraOuterRef.value, img, sx, sy, w, h, true)
}

// 短暫交叉淡出：把上一格複製到殘影 canvas，在新狀態第一格期間淡出，換列時不會硬切。
const ghostRef = ref<HTMLCanvasElement | null>(null)
const ghostFading = ref(false)
let ghostTimer: ReturnType<typeof setTimeout> | null = null
const GHOST_FADE_MS = 150

function startGhostFade(): void {
  const source = canvasRef.value
  const ghost = ghostRef.value
  if (!source || !ghost || isPaused.value || reducedMotion.value) return
  const ctx = ghost.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, backingW.value, backingH.value)
  ctx.drawImage(source, 0, 0)
  ghostFading.value = false
  requestAnimationFrame(() => {
    ghostFading.value = true
    if (ghostTimer) clearTimeout(ghostTimer)
    ghostTimer = setTimeout(() => { ghostFading.value = false }, GHOST_FADE_MS)
  })
}

function clearFrameTimer(): void {
  if (frameTimerId !== null) clearTimeout(frameTimerId)
  frameTimerId = null
}

// --- 播放控制 -----------------------------------------------------------------------
// 每格一個計時器、長度就是那一格的延遲，而不是 60fps 輪詢、醒來才發現還沒到時間。
function scheduleNextFrame(): void {
  clearFrameTimer()
  frameTimerId = setTimeout(animationStep, frameDelay())
}

function startAnimation() {
  clearFrameTimer()
  animationFinished = false

  motionPlan = motionPlanForState()
  selectStep(0)
  draw()
  if (isPaused.value) return
  scheduleNextFrame()
}

function pauseAnimation(): void {
  clearFrameTimer()
}

function resumeAnimation(): void {
  if (isPaused.value || frameTimerId !== null || animationFinished) return
  scheduleNextFrame()
}

function animationStep(): void {
  frameTimerId = null
  if (isPaused.value || animationFinished) return
  if (advanceAnimationFrame()) scheduleNextFrame()
  else animationFinished = true
}

function advanceAnimationFrame(): boolean {
  if (currentFrame < activeMotion.frameDurations.length - 1) {
    currentFrame++
    draw()
    return true
  }
  completedLoops++
  const step = motionPlan.steps[currentStep]
  if (completedLoops < step.loops) {
    currentFrame = 0
    draw()
    return true
  }
  if (currentStep < motionPlan.steps.length - 1) {
    selectStep(currentStep + 1)
    draw()
    return true
  }
  if (motionPlan.repeat) {
    selectStep(0)
    draw()
    return true
  }
  // 不重複的計畫（尤其是失敗）刻意停在最後一格，
  // 等 store 回報下一個狀態。
  return false
}

function reloadPet(): void {
  currentFrame = 0
  loadImage()
  startAnimation()
}

// --- 監看 ---------------------------------------------------------------------------
// 剛出現的光暈 canvas 在下一格之前沒有像素。
watch([auraInnerVisible, auraOuterVisible], () => { void nextTick(draw) })

watch(() => props.petId, reloadPet)
watch(() => currentPet.value?.pluginSkin?.cacheKey, reloadPet)
watch(() => store.petsLoaded, reloadPet)
// 寵物包的覆蓋值在播放中被換掉時重排，不必等下一次狀態改變。
watch(petBehaviorManifest, () => { if (motionTable.value !== planTable) startAnimation() })
// 只影響節奏：重算延遲表、不重排計畫；已排好的那一格改用新延遲，
// 否則從慢速切回正常時要等完舊的長延遲（最多數秒）才會變快。
watch([() => props.lowFps, reducedMotion], () => {
  updateFrameDelays()
  if (frameTimerId !== null) scheduleNextFrame()
})

watch(() => props.state, (newState, oldState) => {
  startGhostFade()
  startAnimation()
  if (!isPaused.value && isSignificantTransition(oldState, newState)) {
    playReaction()
  }
  if (newState === 'idle' && !isPaused.value) {
    scheduleFidget()
  } else {
    stopFidgetTimer()
  }
  if (newState === 'waiting-permission' || newState === 'waiting-input') {
    startUrgencyTimer()
  } else {
    stopUrgencyTimer()
  }
})

watch(urgencyLevel, (newLevel, oldLevel) => {
  if (isWaiting.value && newLevel !== oldLevel) {
    startAnimation()
  }
})

watch(() => props.autonomousBehavior, (newBehavior, oldBehavior) => {
  if (!isPaused.value && newBehavior === 'poke' && newBehavior !== oldBehavior) playReaction()
  if (newBehavior !== 'cursor-look') startAnimation()
})

watch(() => props.freeze, (freeze) => {
  startAnimation()
  if (freeze) stopFidgetTimer()
  else if (!document.hidden && props.state === 'idle') scheduleFidget()
  if (freeze) stopUrgencyTimer()
  else if (isWaiting.value) startUrgencyTimer()
})

// --- 可見性與生命週期 ---------------------------------------------------------------
function handleDocumentVisibilityChange(): void {
  documentVisible.value = document.visibilityState === 'visible'
  if (documentVisible.value) resumeAnimation()
  else pauseAnimation()
  if (!documentVisible.value) {
    stopFidgetTimer()
    stopUrgencyTimer()
  } else {
    if (props.state === 'idle' && !props.freeze) scheduleFidget()
    if (isWaiting.value && !props.freeze) startUrgencyTimer()
  }
}

onMounted(() => {
  watchDensity()
  documentVisible.value = document.visibilityState === 'visible'
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange)
  loadImage()
  startAnimation()
  if (props.state === 'idle' && !isPaused.value) {
    scheduleFidget()
  }
  if (isWaiting.value && !isPaused.value) {
    startUrgencyTimer()
  }
})

onUnmounted(() => {
  densityQuery?.removeEventListener('change', onDensityChange)
  clearFrameTimer()
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
  for (const timer of [reactionTimer, rewardTimer, cursorLookTimer, reactionMarkTimer, ghostTimer]) {
    if (timer !== null) clearTimeout(timer)
  }
  stopFidgetTimer()
  stopUrgencyTimer()
})
</script>

<template>
  <div
    class="pet-visual"
    :class="[`mood-energy-${moodEnergyTier}`, { 'multi-pet-energy': store.isMultiPet, 'facing-left': props.facing === -1 }]"
    :style="[{ width: canvasW + 'px', height: canvasH + 'px' }, moodAuraStyle]"
    :data-mood="moodValue"
    :data-mood-energy="moodEnergyTier"
    data-pet-context-target="hide"
  >
    <canvas
      v-if="auraOuterVisible"
      ref="auraOuterRef"
      :width="backingW"
      :height="backingH"
      :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
      class="pet-aura-canvas pet-aura-outer"
      aria-hidden="true"
    />
    <canvas
      v-if="auraInnerVisible"
      ref="auraInnerRef"
      :width="backingW"
      :height="backingH"
      :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
      class="pet-aura-canvas pet-aura-inner"
      aria-hidden="true"
    />

    <canvas
      ref="ghostRef"
      :width="backingW"
      :height="backingH"
      :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
      class="pet-ghost-canvas"
      :class="{ fading: ghostFading }"
      aria-hidden="true"
    />

    <canvas
      ref="canvasRef"
      :width="backingW"
      :height="backingH"
      :data-animation-action="activeMotionName"
      :data-animation-row="activeMotionRow"
      :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
      class="pet-canvas"
      :class="{
        'pet-reacting': store.reactionsActive && isReacting && !reactionKind,
        [`pet-react-${reactionKind}`]: store.reactionsActive && isReacting && !!reactionKind,
        'pet-fidgeting': store.ambientActive && isFidgeting && !isReacting && urgencyLevel === 0,
        'pet-urgent-1': store.reactionsActive && !isReacting && urgencyLevel === 1,
        'pet-urgent-2': store.reactionsActive && !isReacting && urgencyLevel === 2,
        'pet-idle-ambient': store.ambientActive && props.state === 'idle' && !isReacting && !isFidgeting,
        'pet-thinking-ambient': store.ambientActive && props.state === 'thinking' && !isReacting,
        'pet-tool-ambient': store.ambientActive && props.state === 'tool-running' && !isReacting,
        'pet-waiting-input': store.reactionsActive && props.state === 'waiting-input' && !isReacting && urgencyLevel === 0,
        'pet-rewarding': store.reactionsActive && isRewarding,
        'pet-offline-ambient': props.state === 'offline',
        'pet-mood-happy': moodTier === 'happy',
        'pet-mood-low': moodTier === 'low',
        'pet-cursor-look-left': cursorLookDirection === -1,
        'pet-cursor-look-right': cursorLookDirection === 1,
        'pet-frozen': props.freeze,
      }"
    />
    <Transition name="pet-mark">
      <span
        v-if="reactionMark"
        :key="reactionMark.id"
        class="pet-reaction-mark"
        :style="reactionMarkStyle"
        aria-hidden="true"
      >
        <Icon :name="reactionMark.icon" :size="16" />
      </span>
    </Transition>
  </div>
</template>

<style scoped src="@/components/PetAnimation.css"></style>
