<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import type { AgentState } from '@/types/agent'
import type { PetAutonomousBehavior, PetBehaviorManifest } from '@/types/pet'
import type { PresentationReaction } from '@/types/presentation'
import Icon from '@/components/ui/Icon.vue'
import { useAgentStore } from '@/stores/agentStore'
import { getCachedSprite, getCachedTint, loadPetSprite, setCachedTint } from '@/composables/usePetSpriteCache'
import { frameDelayMultiplier, isSignificantTransition, motionPlanFor } from '@/utils/pet-motion-plan'

const props = defineProps<{
  state: AgentState
  petId: string
  since?: number
  mood?: number
  autonomousBehavior?: PetAutonomousBehavior
  freeze?: boolean
  /** Keeps animating but at a few frames per second (mini mode). */
  lowFps?: boolean
  /** -1 mirrors the sprite (walking left). */
  facing?: -1 | 1
}>()

// Keep low mood close to the pet's original colors; most of the visible
// progression comes from the silhouette aura instead of dimming the pet.
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
// The glow canvases only exist (and are only redrawn) while the mood makes
// them visible; at resting mood they are fully transparent anyway.
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
const documentVisible = ref(true)
const isPaused = computed(() => props.freeze === true || !documentVisible.value)

const CELL_W = 192
const CELL_H = 208

type MotionName = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review' | 'walk' | 'sleep'

interface MotionDefinition {
  name: MotionName
  row: number
  frameDurations: readonly number[]
}

interface MotionStep {
  motion: MotionDefinition
  loops: number
}

interface MotionPlan {
  steps: MotionStep[]
  repeat: boolean
}

// Keep these aligned with the v2 pet atlas contract. Apart from making each
// action read at its intended cadence, the per-row frame counts prevent short
// actions such as waving and jumping from stepping into transparent cells.
const motions: Record<MotionName, MotionDefinition> = {
  idle: { name: 'idle', row: 0, frameDurations: [280, 110, 110, 140, 140, 320] },
  waving: { name: 'waving', row: 3, frameDurations: [140, 140, 140, 280] },
  jumping: { name: 'jumping', row: 4, frameDurations: [140, 140, 140, 140, 280] },
  failed: { name: 'failed', row: 5, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { name: 'waiting', row: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
  running: { name: 'running', row: 7, frameDurations: [120, 120, 120, 120, 120, 220] },
  review: { name: 'review', row: 8, frameDurations: [150, 150, 150, 150, 150, 280] },
  // 這些 row 會由選用的 manifest 覆蓋；未宣告行為的自訂寵物安全回退至 Idle。
  walk: { name: 'walk', row: 0, frameDurations: [180, 180, 180, 180, 220] },
  sleep: { name: 'sleep', row: 0, frameDurations: [420, 420, 520, 620] },
}

const petBehaviorManifest = computed<PetBehaviorManifest | undefined>(() => (
  store.pets.find(pet => pet.id === props.petId)?.behaviorManifest
))

function behaviorMotion(name: 'walk' | 'sleep'): MotionDefinition {
  const definition = petBehaviorManifest.value?.[name]
  if (!definition) return motions.idle
  const imageFrames = imgRef.value?.naturalWidth
    ? Math.floor(imgRef.value.naturalWidth / CELL_W)
    : 6
  const frameCount = Math.max(1, Math.min(16, definition.frames ?? imageFrames))
  const frameDurations = definition.frameDurations?.slice(0, frameCount)
    ?? Array.from({ length: frameCount }, (_, index) => index === frameCount - 1 ? 260 : 150)
  return {
    name,
    row: definition.row,
    frameDurations,
  }
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const auraInnerRef = ref<HTMLCanvasElement | null>(null)
const auraOuterRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
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
let motionPlan: MotionPlan = { steps: [{ motion: motions.idle, loops: Number.POSITIVE_INFINITY }], repeat: false }
let activeMotion = motions.idle
const activeMotionName = ref<MotionName>('idle')
const activeMotionRow = ref(0)

// One-shot squash/stretch "reaction" bounce, layered on top of the looping
// state animation via a CSS class rather than extra spritesheet frames, so
// it works for every pet regardless of how many rows its sheet has.
const isReacting = ref(false)
const reactionKind = ref<PresentationReaction | null>(null)
let reactionTimer: ReturnType<typeof setTimeout> | null = null
// Each presentation reaction has its own motion (CSS class) and a short icon
// mark that floats up; the mark still shows when motion effects are off.
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
    reactionMarkTimer = setTimeout(() => { reactionMark.value = null }, 1400)
  }
}

// Achievement unlocks use a separate visual hook so a new rule can reward the
// pet without changing the state animation or granting any product ability.
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

// Idle fidgets: a periodic subtle sway (no new sprite frames needed, same
// CSS-layer trick as the reaction bounce) so a long idle stretch doesn't
// feel completely static. Only scheduled while state === 'idle'.
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

// The longer a waiting-permission/waiting-input session sits unanswered,
// the faster & shakier the pet gets, nudging the user to go respond.
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

function motionPlanForState(): MotionPlan {
  const planned = motionPlanFor({
    state: props.state,
    urgency: urgencyLevel.value,
    behavior: props.autonomousBehavior,
    petId: props.petId,
  })
  return {
    steps: planned.steps.map(step => ({
      motion: step.motion === 'walk' || step.motion === 'sleep'
        ? behaviorMotion(step.motion)
        : motions[step.motion],
      loops: step.loops,
    })),
    repeat: planned.repeat,
  }
}

function frameDelay(): number {
  const multiplier = frameDelayMultiplier({
    state: props.state,
    urgency: urgencyLevel.value,
    // After the fall plays out the pet idles slowly instead of freezing.
    sulking: props.state === 'error' && activeMotion.name === 'idle',
  })
  // Reduced motion steps even slower than the mini window does.
  const lowFpsFactor = props.lowFps ? (prefersReducedMotion() ? 6 : 3) : 1
  return Math.max(80, Math.round(activeMotion.frameDurations[currentFrame] * multiplier * lowFpsFactor))
}

function selectStep(index: number) {
  currentStep = index
  completedLoops = 0
  currentFrame = 0
  activeMotion = motionPlan.steps[currentStep].motion
  activeMotionName.value = activeMotion.name
  activeMotionRow.value = activeMotion.row
}

// The backing store is an integer multiple of the sprite cell sized to the real
// device pixels (scale x display density), so nearest-neighbour upscaling stays
// even and a Retina screen does not blur the pet.
const devicePixelRatioRef = ref(window.devicePixelRatio || 1)
const backingK = computed(() => Math.max(1, Math.min(8, Math.round(store.petScale * devicePixelRatioRef.value))))
const backingW = computed(() => CELL_W * backingK.value)
const backingH = computed(() => CELL_H * backingK.value)
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

const canvasW = computed(() => Math.round(CELL_W * store.petScale))
const canvasH = computed(() => Math.round(CELL_H * store.petScale))

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
    sample.width = CELL_W
    sample.height = CELL_H
    const ctx = sample.getContext('2d', { willReadFrequently: true })
    if (!ctx) return auraTint
    ctx.drawImage(img, 0, 0, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H)
    return deriveAuraTintFromPixels(ctx.getImageData(0, 0, CELL_W, CELL_H).data)
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
  draw()
  if (props.autonomousBehavior === 'walk' || props.autonomousBehavior === 'sleep') {
    startAnimation()
  }
}

async function spriteSourceFor(pet: (typeof store.pets)[number] | undefined, targetId: string): Promise<string | null> {
  if (pet?.pluginSkin) return pet.pluginSkin.spriteUrl
  if (pet && !pet.builtIn) return (await window.electronAPI?.getCustomPetSprite(targetId)) ?? null
  return getSrc(targetId)
}

async function loadImage() {
  // A newer request (pet switched while an older one is in flight) wins.
  const sequence = ++loadSequence
  const id = props.petId || store.defaultPetId
  const pet = store.pets.find(p => p.id === id)

  if (!pet && !store.petsLoaded) {
    return
  }

  const targetId = pet ? id : store.defaultPetId
  const isCustom = Boolean(pet && !pet.builtIn && !pet.pluginSkin)
  // A custom sheet's URL carries its modification time, so it is the cache
  // key: re-importing the same id can never show the previous image.
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

  // The sheet failed to load: show the default pet instead of an empty canvas.
  if (targetId !== store.defaultPetId) {
    const fallbackKey = store.defaultPetId
    const fallback = await loadPetSprite(fallbackKey, getSrc(store.defaultPetId))
    if (sequence === loadSequence && fallback) applyImage(fallback, fallbackKey)
  }
}

function draw() {
  const img = imgRef.value
  if (!img || !img.complete) return

  const row = activeMotion.row
  const maxFrames = activeMotion.frameDurations.length
  const frame = currentFrame % maxFrames

  const targets = [
    { canvas: canvasRef.value, tint: false },
    ...(auraInnerVisible.value ? [{ canvas: auraInnerRef.value, tint: true }] : []),
    ...(auraOuterVisible.value ? [{ canvas: auraOuterRef.value, tint: true }] : []),
  ]
  for (const target of targets) {
    const { canvas, tint } = target
    if (!canvas) continue
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    ctx.clearRect(0, 0, backingW.value, backingH.value)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      img,
      frame * CELL_W, row * CELL_H,
      CELL_W, CELL_H,
      0, 0,
      backingW.value, backingH.value
    )
    if (tint) {
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = auraTint
      ctx.fillRect(0, 0, backingW.value, backingH.value)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

// Brief cross-fade: the last drawn frame is copied to a ghost canvas that
// fades out over the new state's first frame, so rows no longer hard-cut.
const ghostRef = ref<HTMLCanvasElement | null>(null)
const ghostFading = ref(false)
let ghostTimer: ReturnType<typeof setTimeout> | null = null
const GHOST_FADE_MS = 150

function startGhostFade(): void {
  const source = canvasRef.value
  const ghost = ghostRef.value
  if (!source || !ghost || isPaused.value || prefersReducedMotion()) return
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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clearFrameTimer(): void {
  if (frameTimerId !== null) clearTimeout(frameTimerId)
  frameTimerId = null
}

// One timer per frame, sized to that frame's delay, rather than a 60fps poll
// that wakes the main thread just to find out nothing is due yet.
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
  // Non-repeating plans (notably failure) deliberately hold their final
  // frame until the store reports the next state.
  return false
}

// A glow canvas that just appeared has no pixels until the next frame.
watch([auraInnerVisible, auraOuterVisible], () => { void nextTick(draw) })

watch(() => props.petId, () => {
  currentFrame = 0
  loadImage()
  startAnimation()
})

watch(() => store.pets.find(pet => pet.id === props.petId)?.pluginSkin?.cacheKey, () => {
  currentFrame = 0
  loadImage()
  startAnimation()
})

watch(() => store.petsLoaded, () => {
  currentFrame = 0
  loadImage()
  startAnimation()
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
  if (reactionTimer !== null) {
    clearTimeout(reactionTimer)
  }
  if (rewardTimer !== null) {
    clearTimeout(rewardTimer)
  }
  if (cursorLookTimer !== null) {
    clearTimeout(cursorLookTimer)
  }
  if (reactionMarkTimer !== null) clearTimeout(reactionMarkTimer)
  if (ghostTimer !== null) clearTimeout(ghostTimer)
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
        aria-hidden="true"
      >
        <Icon :name="reactionMark.icon" :size="16" />
      </span>
    </Transition>
  </div>
</template>

<style scoped src="@/components/PetAnimation.css"></style>
