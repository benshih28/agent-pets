import * as fs from 'node:fs'
import { readConfigText, writeTextAtomic } from './safe-config-write.ts'
import type { OnboardingAction, OnboardingState } from '../src/types/onboarding.ts'
import { ONBOARDING_VERSION } from '../src/types/onboarding.ts'

// Main-owned first-run state. Stores only timestamps and a flow version: no paths or user data.
export class OnboardingStore {
  private readonly filePath: string
  private readonly now: () => number

  constructor(filePath: string, now: () => number = Date.now) {
    this.filePath = filePath
    this.now = now
  }

  get(): OnboardingState {
    let raw: string | null = null
    try { raw = readConfigText(this.filePath) } catch { return { version: ONBOARDING_VERSION } }
    if (!raw) return { version: ONBOARDING_VERSION }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
      const state: OnboardingState = { version: ONBOARDING_VERSION }
      const completedAt = finite(parsed.completedAt)
      const skippedAt = finite(parsed.skippedAt)
      if (completedAt !== undefined) state.completedAt = completedAt
      if (skippedAt !== undefined) state.skippedAt = skippedAt
      return state
    } catch {
      return { version: ONBOARDING_VERSION }
    }
  }

  update(action: OnboardingAction): OnboardingState {
    const next: OnboardingState = { version: ONBOARDING_VERSION }
    const current = this.get()
    if (action === 'completed') next.completedAt = this.now()
    else if (action === 'skipped') {
      next.skippedAt = this.now()
      if (current.completedAt !== undefined) next.completedAt = current.completedAt
    }
    // 'reset' clears both so the intro shows again.
    fs.mkdirSync(this.filePath.replace(/[\\/][^\\/]*$/, ''), { recursive: true })
    writeTextAtomic(this.filePath, `${JSON.stringify(next)}\n`, { mode: 0o600 })
    return next
  }
}
