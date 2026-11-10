import type { PetMotionManifest, PetMotionName, PetMotionOverride, PetOptionalMotionName } from './pet-atlas.ts'

/** 自主行為（Shimeji）會要求的選用動作。 */
export type PetBehaviorName = PetOptionalMotionName
export type PetAutonomousBehavior = 'idle' | 'walk' | 'sleep' | 'cursor-look' | 'poke'

export interface PluginSkinPetSource {
  pluginId: string
  pluginName: string
  spriteUrl: string
  cacheKey: string
  kind: 'person' | 'animal'
}

export type PetBehaviorDefinition = PetMotionOverride
/** 寵物包介面：任何 PetMotionName 都能被覆蓋（規格見 types/pet-atlas.ts）。 */
export type PetBehaviorManifest = PetMotionManifest
export type { PetMotionName }

export interface ShimejiContext {
  enabled: boolean
  reactionsEnabled: boolean
  dndEnabled: boolean
  reducedMotion: boolean
  powerSave: boolean
  documentVisible: boolean
  isDragging: boolean
  windowMode: 'normal' | 'mini' | 'edge'
  currentState: string
  activeSessionCount: number
  pendingPermission: boolean
  canWalk: boolean
  canSleep: boolean
  idleMs: number
  random?: number
}

export interface ShimejiTick {
  behavior: PetAutonomousBehavior
  delayMs: number
  walkDeltaX?: number
}

export const SHIMEJI_MIN_TICK_MS = 1_500
export const SHIMEJI_IDLE_DELAY_MS = 15_000
export const SHIMEJI_IDLE_DELAY_MIN_MS = 8_000
export const SHIMEJI_IDLE_DELAY_MAX_MS = 25_000
/** While asleep the scheduler just re-checks at this pace. */
export const SHIMEJI_SLEEP_RECHECK_MS = 15_000
export const SHIMEJI_SLEEP_AFTER_MS = 90_000
export const SHIMEJI_WALK_STEP_PX = 18
export const SHIMEJI_WALK_STEP_DELAY_MS = 1_800
export const SHIMEJI_MAX_WALK_STEPS = 4

function shimejiRoll(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(0.999999, value))
}

export function canRunAutonomousBehavior(context: ShimejiContext): boolean {
  if (!context.enabled || !context.reactionsEnabled) return false
  if (context.dndEnabled || context.reducedMotion || context.powerSave) return false
  if (!context.documentVisible || context.isDragging || context.windowMode !== 'normal') return false
  if (context.pendingPermission) return false
  if (context.activeSessionCount > 0 && context.currentState !== 'idle') return false
  return context.activeSessionCount === 0
    || context.currentState === 'idle'
    || context.currentState === 'offline'
}

export function chooseAutonomousBehavior(context: ShimejiContext): PetAutonomousBehavior {
  if (!canRunAutonomousBehavior(context)) return 'idle'
  const value = shimejiRoll(context.random)
  if (context.canSleep && context.idleMs >= SHIMEJI_SLEEP_AFTER_MS && value < 0.22) return 'sleep'
  if (context.canWalk && value < 0.62) return 'walk'
  return 'idle'
}

export class ShimejiScheduler {
  private walkRemaining = 0
  private walkDirection: -1 | 1 = 1
  private sleeping = false

  reset(): void {
    this.walkRemaining = 0
    this.sleeping = false
  }

  get isSleeping(): boolean {
    return this.sleeping
  }

  next(context: ShimejiContext): ShimejiTick {
    if (!canRunAutonomousBehavior(context)) {
      this.reset()
      return { behavior: 'idle', delayMs: SHIMEJI_IDLE_DELAY_MS }
    }

    // Once asleep the pet stays asleep until something resets the scheduler
    // (activity, the cursor arriving, a click) — it does not wake on its own.
    if (this.sleeping && context.canSleep) {
      return { behavior: 'sleep', delayMs: SHIMEJI_SLEEP_RECHECK_MS }
    }
    this.sleeping = false

    if (this.walkRemaining > 0 && context.canWalk) {
      this.walkRemaining -= 1
      return {
        behavior: 'walk',
        delayMs: SHIMEJI_WALK_STEP_DELAY_MS,
        walkDeltaX: this.walkDirection * SHIMEJI_WALK_STEP_PX,
      }
    }

    const value = shimejiRoll(context.random)
    const behavior = chooseAutonomousBehavior(context)
    if (behavior === 'walk') {
      this.walkDirection = value < 0.5 ? -1 : 1
      this.walkRemaining = 1 + Math.floor(value * SHIMEJI_MAX_WALK_STEPS)
      return {
        behavior,
        delayMs: SHIMEJI_WALK_STEP_DELAY_MS,
        walkDeltaX: this.walkDirection * SHIMEJI_WALK_STEP_PX,
      }
    }

    if (behavior === 'sleep') {
      this.sleeping = true
      return { behavior, delayMs: SHIMEJI_SLEEP_RECHECK_MS }
    }

    // Vary the pause so idle gestures do not tick like a metronome.
    const idleDelay = SHIMEJI_IDLE_DELAY_MIN_MS
      + shimejiRoll(context.random) * (SHIMEJI_IDLE_DELAY_MAX_MS - SHIMEJI_IDLE_DELAY_MIN_MS)
    return {
      behavior,
      delayMs: Math.max(SHIMEJI_MIN_TICK_MS, Math.round(idleDelay)),
    }
  }
}
