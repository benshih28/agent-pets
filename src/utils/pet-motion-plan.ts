import type { AgentState } from '@/types/agent'
import type { PetAutonomousBehavior } from '@/types/pet'
// tests/pet-motion-plan.test.mts 用 Node 直接執行，值 import 必須是相對路徑。
import { AGENT_STATE_POLICY } from '../types/agent.ts'
import { PET_ATLAS_MOTIONS, type PetMotionName } from '../types/pet-atlas.ts'

export type PlannedMotion = PetMotionName

export interface PlannedStep {
  motion: PlannedMotion
  loops: number
}

export interface PlannedMotionPlan {
  steps: PlannedStep[]
  repeat: boolean
}

export const SUCCESS_DISPLAY_MS = AGENT_STATE_POLICY.success.quiet.afterMs

// 慶祝動作用內建節奏跑一輪的長度；寵物包改了時長，揮手次數也只會差一點點。
const loopMs = (frames: readonly number[]) => frames.reduce((sum, ms) => sum + ms, 0)
const JUMP_LOOP_MS = loopMs(PET_ATLAS_MOTIONS.jumping.frameDurations)
const WAVE_LOOP_MS = loopMs(PET_ATLAS_MOTIONS.waving.frameDurations)

export const SUCCESS_JUMP_LOOPS = 2
export const SUCCESS_WAVE_LOOPS = Math.max(
  1,
  Math.floor((SUCCESS_DISPLAY_MS - SUCCESS_JUMP_LOOPS * JUMP_LOOP_MS) / WAVE_LOOP_MS) - 1,
)
export const ERROR_FAILED_LOOPS = 2

export interface MotionPlanInput {
  state: AgentState
  urgency: 0 | 1 | 2
  behavior?: PetAutonomousBehavior
  petId: string
  random?: () => number
}

function hashPetId(petId: string): number {
  let sum = 0
  for (const char of petId) sum += char.charCodeAt(0)
  return sum
}

// petId 讓不同寵物錯開、不會同時揮手。
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

/** 離線維持正常速度：變暗是 CSS 做的。 */
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

/** thinking ↔ tool-running、offline ↔ idle 一直在跳，必須保持安靜。 */
export function isSignificantTransition(from: AgentState | undefined, to: AgentState): boolean {
  if (from === undefined || from === to) return false
  if (to === 'success' || to === 'error' || WAITING_STATES.has(to)) return true
  return WAITING_STATES.has(from)
}
