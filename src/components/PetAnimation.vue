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
  lowFps?: boolean
  facing?: -1 | 1
}>()

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

function atlasGrid(): PetAtlasGrid | null {
  const img = imgRef.value
  return img?.naturalWidth ? petAtlasGridFromSize(img.naturalWidth, img.naturalHeight) : null
}

const motionTable = computed<PetMotionTable>(() => resolvePetMotionTable(petBehaviorManifest.value, atlasGrid()))
const sprite = usePetSpriteLoader(() => props.petId, onSpriteApplied)
const imgRef = sprite.image
let frameTimerId: ReturnType<typeof setTimeout> | null = null
let animationFinished = false
let currentFrame = 0
let currentStep = 0
let completedLoops = 0
let motionPlan: MotionPlan = { steps: [{ motion: PET_ATLAS_MOTIONS.idle, loops: Number.POSITIVE_INFINITY }], repeat: false }
let planTable: PetMotionTable | null = null
let activeMotion: PetMotionDefinition = PET_ATLAS_MOTIONS.idle
let frameDelays: readonly number[] = PET_ATLAS_MOTIONS.idle.frameDurations
const activeMotionName = ref<PetMotionName>('idle')
const activeMotionRow = ref(0)

const {
  isReacting, reactionKind, reactionMark, isRewarding, cursorLookDirection,
  playReaction, playReward, playCursorLook,
} = usePetReactions()
const reactionMarkStyle = { '--pet-mark-duration': `${REACTION_MARK_MS}ms` }

defineExpose({ playReaction, playReward, playCursorLook })

const { isFidgeting, schedule: scheduleFidget, stop: stopFidgetTimer } = usePetFidget(() => isPaused.value, () => props.state)
const { isWaiting, urgencyLevel, start: startUrgencyTimer, stop: stopUrgencyTimer } = usePetUrgency(() => isPaused.value, () => props.state, () => props.since)

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
const LOW_FPS_REDUCED_FACTOR = 6

function updateFrameDelays(): void {
  const multiplier = frameDelayMultiplier({
    state: props.state,
    urgency: urgencyLevel.value,
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
  // 不重複的計畫（尤其是失敗）刻意停在最後一格，等 store 回報下一個狀態。
  return false
}

function onSpriteApplied(): void {
  currentFrame = 0
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

// 剛出現的光暈 canvas 在下一格之前沒有像素。
watch([auraInnerVisible, auraOuterVisible], () => { void nextTick(draw) })

watch(() => props.petId, reloadPet)
watch(() => currentPet.value?.pluginSkin?.cacheKey, reloadPet)
watch(() => store.petsLoaded, reloadPet)
watch(petBehaviorManifest, () => { if (motionTable.value !== planTable) startAnimation() })
// 已排好的那一格要改用新延遲，否則從慢速切回正常要等完舊的長延遲。
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
