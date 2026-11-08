import type { AgentState } from '@/types/agent'
import type { PetAutonomousBehavior } from '@/types/pet'

// Pure state -> animation mapping, kept out of the component so the timing
// rules can be unit-tested.

export type PlannedMotion = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review' | 'walk' | 'sleep'

export interface PlannedStep {
  motion: PlannedMotion
  loops: number
}

export interface PlannedMotionPlan {
  steps: PlannedStep[]
  repeat: boolean
}

/** How long a finished session shows as "success" before returning to idle. */
export const SUCCESS_DISPLAY_MS = 4_000

// Approximate length of one loop of each celebration row (sum of frame durations).
const JUMP_LOOP_MS = 700
const WAVE_LOOP_MS = 700

export const SUCCESS_JUMP_LOOPS = 2
export const SUCCESS_WAVE_LOOPS = Math.max(
  1,
  Math.floor((SUCCESS_DISPLAY_MS - SUCCESS_JUMP_LOOPS * JUMP_LOOP_MS) / WAVE_LOOP_MS) - 1,
)
/** The failed row plays this many times, then the pet settles into a quiet idle. */
export const ERROR_FAILED_LOOPS = 2

export interface MotionPlanInput {
  state: AgentState
  urgency: 0 | 1 | 2
  behavior?: PetAutonomousBehavior
  petId: string
  /** Injected for tests; defaults to Math.random. */
  random?: () => number
}

function hashPetId(petId: string): number {
  let sum = 0
  for (const char of petId) sum += char.charCodeAt(0)
  return sum
}

/**
 * Loops of plain idle before a wave. The petId offsets pets from each other so
 * several never gesture together; the random part keeps one pet from becoming
 * perfectly predictable.
 */
export function idleLoopsFor(petId: string, random: () => number = Math.random): number {
  return 8 + (hashPetId(petId) % 4) + Math.floor(random() * 7)
}

export function motionPlanFor(input: MotionPlanInput): PlannedMotionPlan {
  const { state, urgency, behavior, petId } = input
  const canUseAutonomousMotion = state === 'idle' || state === 'offline'
  if (canUseAutonomousMotion && (behavior === 'walk' || behavior === 'sleep')) {
    return { steps: [{ motion: behavior, loops: Number.POSITIVE_INFINITY }], repeat: false }
  }

  switch (state) {
    case 'idle':
      return {
        steps: [
          { motion: 'idle', loops: idleLoopsFor(petId, input.random) },
          { motion: 'waving', loops: 1 },
        ],
        repeat: true,
      }
    case 'thinking':
      return { steps: [{ motion: 'review', loops: 8 }, { motion: 'running', loops: 12 }], repeat: true }
    case 'tool-running':
      return { steps: [{ motion: 'running', loops: 12 }, { motion: 'review', loops: 8 }], repeat: true }
    case 'waiting-permission':
    case 'waiting-input':
      if (urgency === 0) {
        return { steps: [{ motion: 'waiting', loops: Number.POSITIVE_INFINITY }], repeat: false }
      }
      return {
        steps: [
          { motion: 'waiting', loops: 12 },
          { motion: 'waving', loops: urgency === 2 ? 8 : 6 },
        ],
        repeat: true,
      }
    case 'success':
      return {
        steps: [
          { motion: 'jumping', loops: SUCCESS_JUMP_LOOPS },
          { motion: 'waving', loops: SUCCESS_WAVE_LOOPS },
          { motion: 'idle', loops: Number.POSITIVE_INFINITY },
        ],
        repeat: false,
      }
    case 'error':
      // Show the fall twice, then sulk quietly instead of freezing on one
      // frame until the session finally goes stale.
      return {
        steps: [
          { motion: 'failed', loops: ERROR_FAILED_LOOPS },
          { motion: 'idle', loops: Number.POSITIVE_INFINITY },
        ],
        repeat: false,
      }
    case 'offline':
    default:
      return { steps: [{ motion: 'idle', loops: Number.POSITIVE_INFINITY }], repeat: false }
  }
}

/** Per-state frame pacing. Offline keeps normal pace: its dimness comes from CSS. */
export function frameDelayMultiplier(input: {
  state: AgentState
  urgency: 0 | 1 | 2
  sulking: boolean
}): number {
  if (input.sulking) return 1.8
  if (input.state === 'idle' || input.state === 'offline') return 1.25
  if (input.urgency === 2) return 0.6
  if (input.urgency === 1) return 0.78
  return 1
}

const WAITING_STATES: ReadonlySet<AgentState> = new Set(['waiting-permission', 'waiting-input'])

/**
 * Only transitions that carry meaning get the squash bounce; thinking <->
 * tool-running and offline <-> idle flicker constantly and must stay calm.
 */
export function isSignificantTransition(from: AgentState | undefined, to: AgentState): boolean {
  if (from === undefined || from === to) return false
  if (to === 'success' || to === 'error' || WAITING_STATES.has(to)) return true
  return WAITING_STATES.has(from)
}
