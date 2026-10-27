import type { PetStatusChange } from '../src/types/plugin.ts'
import type { PresentationStatusSnapshot } from '../src/types/presentation.ts'
import { normalizePresentationStatus } from './presentation-controller.ts'

interface PendingStatusChange {
  value: PetStatusChange
  initialDnd: boolean
  timer: ReturnType<typeof setTimeout>
}

interface PluginAgentStatusControllerOptions {
  emit: (change: PetStatusChange) => void
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
}

export const PLUGIN_STATUS_COALESCE_MS = 1_000

export class PluginAgentStatusController {
  private readonly emit: (change: PetStatusChange) => void
  private readonly now: () => number
  private readonly schedule: NonNullable<PluginAgentStatusControllerOptions['schedule']>
  private readonly cancel: NonNullable<PluginAgentStatusControllerOptions['cancel']>
  private current: PresentationStatusSnapshot = { activePets: [], dnd: false, enabled: true }
  private readonly previousStates = new Map<string, string>()
  private readonly pending = new Map<string, PendingStatusChange>()

  constructor(options: PluginAgentStatusControllerOptions) {
    this.emit = options.emit
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
    this.cancel = options.cancel ?? (timer => clearTimeout(timer))
  }

  update(value: unknown): void {
    const next = normalizePresentationStatus(value)
    const oldById = new Map(this.current.activePets.map(pet => [pet.petId, pet] as const))
    const nextIds = new Set(next.activePets.map(pet => pet.petId))
    const at = this.safeNow()
    if (at === null) return

    for (const pet of next.activePets) {
      const previous = oldById.get(pet.petId)
      const stateChanged = previous ? previous.visibleState !== pet.visibleState : pet.visibleState !== 'offline'
      const dndChanged = this.current.dnd !== next.dnd
      if (!stateChanged && !dndChanged) continue
      this.queue({
        petId: pet.petId,
        name: pet.name,
        agentFamily: pet.agentFamily ?? null,
        previousState: previous?.visibleState ?? 'offline',
        visibleState: pet.visibleState,
        dnd: next.dnd,
        at,
      }, this.current.dnd)
    }

    for (const previous of this.current.activePets) {
      if (nextIds.has(previous.petId)) continue
      this.queue({
        petId: previous.petId,
        name: previous.name,
        agentFamily: previous.agentFamily ?? null,
        previousState: previous.visibleState,
        visibleState: 'offline',
        dnd: next.dnd,
        at,
      }, this.current.dnd)
    }

    this.current = next
  }

  getStatus(): PetStatusChange[] {
    const at = this.safeNow() ?? 0
    return this.current.activePets.map(pet => ({
      petId: pet.petId,
      name: pet.name,
      agentFamily: pet.agentFamily ?? null,
      previousState: this.previousStates.get(pet.petId) ?? pet.visibleState,
      visibleState: pet.visibleState,
      dnd: this.current.dnd,
      at,
    }))
  }

  flushPending(): void {
    for (const [petId, pending] of this.pending) {
      this.cancel(pending.timer)
      this.pending.delete(petId)
      this.emit(copyStatusChange(pending.value))
    }
  }

  destroy(): void {
    for (const pending of this.pending.values()) this.cancel(pending.timer)
    this.pending.clear()
    this.current = { activePets: [], dnd: false, enabled: true }
    this.previousStates.clear()
  }

  private queue(value: PetStatusChange, initialDnd: boolean): void {
    const previous = this.pending.get(value.petId)
    if (previous) {
      if (value.visibleState === previous.value.previousState && value.dnd === previous.initialDnd) {
        this.cancel(previous.timer)
        this.pending.delete(value.petId)
        this.previousStates.delete(value.petId)
        return
      }
      previous.value = { ...value, previousState: previous.value.previousState }
      this.previousStates.set(value.petId, previous.value.previousState)
      return
    }
    const timer = this.schedule(() => {
      const current = this.pending.get(value.petId)
      if (!current) return
      this.pending.delete(value.petId)
      this.emit(copyStatusChange(current.value))
    }, PLUGIN_STATUS_COALESCE_MS)
    this.previousStates.set(value.petId, value.previousState)
    this.pending.set(value.petId, { value: copyStatusChange(value), initialDnd, timer })
  }

  private safeNow(): number | null {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}

function copyStatusChange(value: PetStatusChange): PetStatusChange {
  return {
    petId: value.petId,
    name: value.name,
    agentFamily: value.agentFamily,
    previousState: value.previousState,
    visibleState: value.visibleState,
    dnd: value.dnd,
    at: value.at,
  }
}
