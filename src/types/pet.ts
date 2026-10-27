export type PetBehaviorName = 'walk' | 'sleep'
export type PetAutonomousBehavior = 'idle' | 'walk' | 'sleep' | 'cursor-look' | 'poke'

export interface PluginSkinPetSource {
  pluginId: string
  pluginName: string
  spriteUrl: string
  cacheKey: string
  kind: 'person' | 'animal'
}

export interface PetBehaviorDefinition {
  row: number
  frames?: number
  frameDurations?: number[]
}

export type PetBehaviorManifest = Partial<Record<PetBehaviorName, PetBehaviorDefinition>>

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

  reset(): void {
    this.walkRemaining = 0
  }

  next(context: ShimejiContext): ShimejiTick {
    if (!canRunAutonomousBehavior(context)) {
      this.reset()
      return { behavior: 'idle', delayMs: SHIMEJI_IDLE_DELAY_MS }
    }

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

    return {
      behavior,
      delayMs: Math.max(SHIMEJI_MIN_TICK_MS, SHIMEJI_IDLE_DELAY_MS),
    }
  }
}
