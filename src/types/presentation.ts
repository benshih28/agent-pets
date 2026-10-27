import type { AgentState } from '@/types/agent'

export const PRESENTATION_REACTIONS = [
  'happy',
  'curious',
  'thinking',
  'surprised',
  'encouraging',
] as const

export type PresentationReaction = typeof PRESENTATION_REACTIONS[number]
export type PresentationIntentKind = 'react' | 'say'

export interface PresentationIntent {
  id: string
  kind: PresentationIntentKind
  source?: 'plugin'
  petId?: string
  reaction?: PresentationReaction
  message?: string
  createdAt: number
  expiresAt: number
}

export interface PresentationIntentInput {
  kind: PresentationIntentKind
  petId?: string
  reaction?: PresentationReaction
  message?: string
  ttlMs?: number
}

export type PresentationError =
  | 'disabled'
  | 'dnd_enabled'
  | 'invalid_request'
  | 'invalid_message'
  | 'invalid_reaction'
  | 'invalid_pet'
  | 'rate_limited'
  | 'queue_full'
  | 'not_found'
  | 'unauthorized'

export interface PresentationIntentResult {
  accepted: boolean
  id?: string
  queued?: number
  expiresAt?: number
  error?: PresentationError
  retryAfterMs?: number
}

export type PresentationMood = 'low' | 'neutral' | 'happy'

export interface PresentationPetStatus {
  petId: string
  name: string
  agentFamily?: 'codex' | 'claude-code' | 'opencode' | null
  mood: PresentationMood
  level: number
  visibleState: AgentState
}

export interface PresentationStatusSnapshot {
  activePets: PresentationPetStatus[]
  dnd: boolean
  enabled: boolean
}

export interface PresentationStatusUpdate extends PresentationStatusSnapshot {}
