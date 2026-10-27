import { randomUUID } from 'node:crypto'
import type {
  PresentationError,
  PresentationIntent,
  PresentationIntentInput,
  PresentationIntentResult,
  PresentationMood,
  PresentationPetStatus,
  PresentationStatusSnapshot,
} from '../src/types/presentation.ts'
import { PRESENTATION_REACTIONS, type PresentationReaction } from '../src/types/presentation.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { SlidingWindowLimiter } from './sliding-window-limiter.ts'

export const PRESENTATION_MIN_TTL_MS = 1_000
export const PRESENTATION_MAX_TTL_MS = 15_000
export const PRESENTATION_DEFAULT_TTL_MS = 4_000
export const PRESENTATION_MAX_MESSAGE_LENGTH = 240
export const PRESENTATION_MAX_QUEUE_DEPTH = 32
export const PRESENTATION_MAX_CLIENT_REQUESTS = 3
export const PRESENTATION_RATE_WINDOW_MS = 10_000

export interface PresentationControllerOptions {
  emit: (intent: PresentationIntent) => void
  getStatus: () => PresentationStatusSnapshot
  getBlockReason: () => Extract<PresentationError, 'disabled' | 'dnd_enabled'> | null
  now?: () => number
  createId?: () => string
}

interface PendingPresentation {
  clientId: string
  intent: PresentationIntent
}

interface NormalizedInput {
  kind: PresentationIntentInput['kind']
  petId?: string
  reaction?: PresentationReaction
  message?: string
  ttlMs: number
}

export type PresentationValidationResult = {
  ok: true
  value: NormalizedInput
} | {
  ok: false
  error: Extract<PresentationError, 'invalid_request' | 'invalid_message' | 'invalid_reaction' | 'invalid_pet'>
}

const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/
const SAFE_NAME_LENGTH = 64
const SAFE_MESSAGE_CONTROL = /[\u0000-\u001f\u007f]/g
const SAFE_MESSAGE_MARKUP = /[<>]/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isPresentationClientId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

export function sanitizePresentationClientId(value: unknown): string | null {
  return isPresentationClientId(value) ? value : null
}

export function sanitizePresentationPetId(value: unknown): string | null {
  return isValidPetId(value, 64) ? value : null
}

export function normalizePresentationMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .normalize('NFKC')
    .replace(SAFE_MESSAGE_CONTROL, ' ')
    .replace(SAFE_MESSAGE_MARKUP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length === 0 || normalized.length > PRESENTATION_MAX_MESSAGE_LENGTH) return null
  return normalized
}

export function normalizePresentationInput(value: unknown): PresentationValidationResult {
  if (!isRecord(value) || (value.kind !== 'react' && value.kind !== 'say')) {
    return { ok: false, error: 'invalid_request' }
  }

  let petId: string | undefined
  if (value.petId !== undefined) {
    petId = sanitizePresentationPetId(value.petId) ?? undefined
    if (!petId) return { ok: false, error: 'invalid_pet' }
  }

  const ttlMs = value.ttlMs === undefined
    ? PRESENTATION_DEFAULT_TTL_MS
    : value.ttlMs
  if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs)
    || ttlMs < PRESENTATION_MIN_TTL_MS || ttlMs > PRESENTATION_MAX_TTL_MS) {
    return { ok: false, error: 'invalid_request' }
  }

  if (value.kind === 'react') {
    if (!PRESENTATION_REACTIONS.includes(value.reaction as PresentationReaction)) {
      return { ok: false, error: 'invalid_reaction' }
    }
    return {
      ok: true,
      value: {
        kind: 'react',
        ...(petId ? { petId } : {}),
        reaction: value.reaction as PresentationReaction,
        ttlMs,
      },
    }
  }

  const message = normalizePresentationMessage(value.message)
  if (!message) return { ok: false, error: 'invalid_message' }
  return {
    ok: true,
    value: {
      kind: 'say',
      ...(petId ? { petId } : {}),
      message,
      ttlMs,
    },
  }
}

function clampLevel(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(1_000_000, value))
    : 1
}

function normalizeMood(value: unknown): PresentationMood {
  return value === 'low' || value === 'happy' ? value : 'neutral'
}

function normalizeVisibleState(value: unknown): PresentationPetStatus['visibleState'] {
  return value === 'idle'
    || value === 'thinking'
    || value === 'tool-running'
    || value === 'waiting-permission'
    || value === 'waiting-input'
    || value === 'success'
    || value === 'error'
    ? value
    : 'offline'
}

export function normalizePresentationStatus(value: unknown): PresentationStatusSnapshot {
  const raw = isRecord(value) ? value : {}
  const activePets: PresentationPetStatus[] = []
  if (Array.isArray(raw.activePets)) {
    for (const candidate of raw.activePets.slice(0, 16)) {
      if (!isRecord(candidate)) continue
      const petId = sanitizePresentationPetId(candidate.petId)
      if (!petId) continue
      const name = typeof candidate.name === 'string'
        ? candidate.name.normalize('NFKC').replace(SAFE_MESSAGE_CONTROL, ' ').replace(SAFE_MESSAGE_MARKUP, ' ').trim().slice(0, SAFE_NAME_LENGTH)
        : petId
      activePets.push({
        petId,
        name: name || petId,
        agentFamily: candidate.agentFamily === 'codex' || candidate.agentFamily === 'claude-code' || candidate.agentFamily === 'opencode'
          ? candidate.agentFamily : null,
        mood: normalizeMood(candidate.mood),
        level: clampLevel(candidate.level),
        visibleState: normalizeVisibleState(candidate.visibleState),
      })
    }
  }
  return {
    activePets,
    dnd: raw.dnd === true,
    enabled: raw.enabled !== false,
  }
}

export class PresentationController {
  private readonly emitIntent: (intent: PresentationIntent) => void
  private readonly getStatusSnapshot: () => PresentationStatusSnapshot
  private readonly getBlockReason: () => Extract<PresentationError, 'disabled' | 'dnd_enabled'> | null
  private readonly now: () => number
  private readonly createId: () => string
  private readonly pending = new Map<string, PendingPresentation>()
  private readonly recentByClient = new Map<string, SlidingWindowLimiter>()
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: PresentationControllerOptions) {
    this.emitIntent = options.emit
    this.getStatusSnapshot = options.getStatus
    this.getBlockReason = options.getBlockReason
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  getStatus(): PresentationStatusSnapshot {
    this.cleanupExpired()
    return normalizePresentationStatus(this.getStatusSnapshot())
  }

  getQueueDepth(): number {
    this.cleanupExpired()
    return this.pending.size
  }

  submit(clientId: string, input: unknown): PresentationIntentResult {
    this.cleanupExpired()
    const blockReason = this.getBlockReason()
    if (blockReason) return { accepted: false, error: blockReason }
    if (!isPresentationClientId(clientId)) return { accepted: false, error: 'invalid_request' }

    const normalized = normalizePresentationInput(input)
    if (!normalized.ok) return { accepted: false, error: normalized.error }

    const now = this.now()
    let limiter = this.recentByClient.get(clientId)
    if (!limiter) {
      limiter = new SlidingWindowLimiter(PRESENTATION_RATE_WINDOW_MS, PRESENTATION_MAX_CLIENT_REQUESTS)
    }
    const rate = limiter.check(now, PRESENTATION_MAX_CLIENT_REQUESTS)
    if (!rate.allowed) {
      this.recentByClient.set(clientId, limiter)
      return { accepted: false, error: 'rate_limited', retryAfterMs: rate.retryAfterMs }
    }
    if (this.pending.size >= PRESENTATION_MAX_QUEUE_DEPTH) {
      return { accepted: false, error: 'queue_full', queued: this.pending.size }
    }

    const intent: PresentationIntent = {
      id: this.createId(),
      kind: normalized.value.kind,
      ...(normalized.value.petId ? { petId: normalized.value.petId } : {}),
      ...(normalized.value.reaction ? { reaction: normalized.value.reaction } : {}),
      ...(normalized.value.message ? { message: normalized.value.message } : {}),
      createdAt: now,
      expiresAt: now + normalized.value.ttlMs,
    }
    this.pending.set(intent.id, { clientId, intent })
    limiter.record(now)
    this.recentByClient.set(clientId, limiter)
    try {
      this.emitIntent(intent)
    } catch {
      this.pending.delete(intent.id)
      return { accepted: false, error: 'not_found' }
    }
    this.scheduleCleanup()
    return {
      accepted: true,
      id: intent.id,
      queued: this.pending.size,
      expiresAt: intent.expiresAt,
    }
  }

  submitPluginReaction(pluginId: string, input: unknown): PresentationIntentResult {
    this.cleanupExpired()
    if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId)) return { accepted: false, error: 'invalid_request' }
    const status = normalizePresentationStatus(this.getStatusSnapshot())
    if (status.dnd) return { accepted: false, error: 'dnd_enabled' }
    const normalized = normalizePresentationInput({
      ...(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}),
      kind: 'react',
    })
    if (!normalized.ok) return { accepted: false, error: normalized.error }
    if (normalized.value.kind !== 'react') return { accepted: false, error: 'invalid_request' }
    if (this.pending.size >= PRESENTATION_MAX_QUEUE_DEPTH) {
      return { accepted: false, error: 'queue_full', queued: this.pending.size }
    }

    const now = this.now()
    const intent: PresentationIntent = {
      id: this.createId(),
      kind: 'react',
      source: 'plugin',
      ...(normalized.value.petId ? { petId: normalized.value.petId } : {}),
      ...(normalized.value.reaction ? { reaction: normalized.value.reaction } : {}),
      createdAt: now,
      expiresAt: now + normalized.value.ttlMs,
    }
    this.pending.set(intent.id, { clientId: `plugin-${pluginId}`, intent })
    try {
      this.emitIntent(intent)
    } catch {
      this.pending.delete(intent.id)
      return { accepted: false, error: 'not_found' }
    }
    this.scheduleCleanup()
    return { accepted: true, id: intent.id, queued: this.pending.size, expiresAt: intent.expiresAt }
  }

  disconnectClient(clientId: string): number {
    if (!isPresentationClientId(clientId)) return 0
    let removed = 0
    for (const [id, pending] of this.pending) {
      if (pending.clientId === clientId) {
        this.pending.delete(id)
        removed += 1
      }
    }
    this.recentByClient.delete(clientId)
    this.scheduleCleanup()
    return removed
  }

  clear(): void {
    this.pending.clear()
    this.recentByClient.clear()
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer)
    this.cleanupTimer = null
  }

  cleanupExpired(): void {
    const now = this.now()
    for (const [id, pending] of this.pending) {
      if (pending.intent.expiresAt <= now) this.pending.delete(id)
    }
    for (const [clientId, limiter] of this.recentByClient) {
      limiter.prune(now)
      if (limiter.size > 0) this.recentByClient.set(clientId, limiter)
      else this.recentByClient.delete(clientId)
    }
    this.scheduleCleanup()
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer)
    this.cleanupTimer = null
    let nextAt = Number.POSITIVE_INFINITY
    for (const pending of this.pending.values()) nextAt = Math.min(nextAt, pending.intent.expiresAt)
    for (const limiter of this.recentByClient.values()) {
      const earliest = limiter.earliestTimestamp
      if (earliest !== null) nextAt = Math.min(nextAt, earliest + PRESENTATION_RATE_WINDOW_MS)
    }
    if (!Number.isFinite(nextAt)) return
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null
      this.cleanupExpired()
    }, Math.max(1, nextAt - this.now()))
  }
}
