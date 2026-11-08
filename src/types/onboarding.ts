export const ONBOARDING_VERSION = 1

export type OnboardingAction = 'completed' | 'skipped' | 'reset'

export interface OnboardingState {
  version: number
  completedAt?: number
  skippedAt?: number
}

export function isOnboardingAction(value: unknown): value is OnboardingAction {
  return value === 'completed' || value === 'skipped' || value === 'reset'
}
