<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import type { AgentState } from '@/types/agent'
import type { PetAutonomousBehavior, PetBehaviorManifest } from '@/types/pet'
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
import { usePetSpriteLoader } from '@/composables/usePetSpriteLoader'
import { REACTION_MARK_MS, usePetReactions } from '@/composables/usePetReactions'
import { usePetFidget, usePetUrgency } from '@/composables/usePetIdleMotion'
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

const currentPet = computed(() => store.pets.find(pet => pet.id === props.petId))
const petBehaviorManifest = computed<PetBehaviorManifest | undefined>(() => currentPet.value?.behaviorManifest)

// 圖載入前格線未知，只套用解析器的上下限；換圖（imgRef 改變）後會用實際尺寸重算。
function atlasGrid(): PetAtlasGrid | null {
  const img = imgRef.value
  return img?.naturalWidth ? petAtlasGridFromSize(img.naturalWidth, img.naturalHeight) : null
}

// 只在 manifest 或圖改變時解析一次；播放時換動作是 O(1) 查表。
const motionTable = computed<PetMotionTable>(() => resolvePetMotionTable(petBehaviorManifest.value, atlasGrid()))
// sprite 載入完成後重排或重畫；格線資訊（動作表）要等圖載入才知道實際欄列數。
const sprite = usePetSpriteLoader(() => props.petId, onSpriteApplied)
const imgRef = sprite.image
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
const {
  isReacting, reactionKind, reactionMark, isRewarding, cursorLookDirection,
  playReaction, playReward, playCursorLook,
} = usePetReactions()
// 動畫長度與 usePetReactions 的計時器共用同一個常數，所以只有一個來源。
const reactionMarkStyle = { '--pet-mark-duration': `${REACTION_MARK_MS}ms` }

defineExpose({ playReaction, playReward, playCursorLook })

// --- 閒置小動作與等待急迫程度 -----------------------------------------------------
const { isFidgeting, schedule: scheduleFidget, stop: stopFidgetTimer } = usePetFidget(() => isPaused.value, () => props.state)
const { isWaiting, urgencyLevel, start: startUrgencyTimer, stop: stopUrgencyTimer } = usePetUrgency(() => isPaused.value, () => props.state, () => props.since)

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

// --- 繪製 ---------------------------------------------------------------------------
// 每一格都會呼叫：直接畫到固定的三張 canvas，不建陣列或物件。
function drawCell(canvas: HTMLCanvasElement | null, img: HTMLImageElement, sx: number, sy: number, w: number, h: number, tint: string | null): void {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, sx, sy, PET_CELL_WIDTH, PET_CELL_HEIGHT, 0, 0, w, h)
  if (tint === null) return
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = tint
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
  drawCell(canvasRef.value, img, sx, sy, w, h, null)
  if (auraInnerVisible.value) drawCell(auraInnerRef.value, img, sx, sy, w, h, sprite.auraTint())
  if (auraOuterVisible.value) drawCell(auraOuterRef.value, img, sx, sy, w, h, sprite.auraTint())
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

function onSpriteApplied(): void {
  currentFrame = 0
  // 換圖後動作表才知道實際欄列數；表真的變了（或正在走路、睡覺）才重排，否則只重畫。
  if (motionTable.value !== planTable || props.autonomousBehavior === 'walk' || props.autonomousBehavior === 'sleep') {
    startAnimation()
  } else {
    draw()
  }
}

function reloadPet(): void {
  currentFrame = 0
  void sprite.load()
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
  void sprite.load()
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
  if (ghostTimer !== null) clearTimeout(ghostTimer)
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
