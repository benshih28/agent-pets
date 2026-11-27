import * as path from 'node:path'
import { isAppReleaseUrl, isValidAppVersion } from './app-update.ts'
import { readBoundedJson, writeJsonAtomic } from './desktop-preferences.ts'
import { isRecord } from './value-guards.ts'
import type { AppUpdateResult } from '../src/types/app-update.ts'

export interface AppUpdateStored {
  enabled: boolean
  lastCheckedAt: number | null
  lastCheckedDay: string | null
  lastResult: AppUpdateResult | null
  latestVersion: string | null
  latestUrl: string | null
  lastNotifiedVersion: string | null
}

export const APP_UPDATE_DEFAULTS: AppUpdateStored = Object.freeze({
  enabled: false,
  lastCheckedAt: null,
  lastCheckedDay: null,
  lastResult: null,
  latestVersion: null,
  latestUrl: null,
  lastNotifiedVersion: null,
})

const RESULTS = new Set<string>(['up_to_date', 'update_available', 'failed'])

export function sanitizeAppUpdateStored(value: unknown): AppUpdateStored {
  const result: AppUpdateStored = { ...APP_UPDATE_DEFAULTS }
  if (!isRecord(value)) return result
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled
  if (typeof value.lastCheckedAt === 'number' && Number.isSafeInteger(value.lastCheckedAt) && value.lastCheckedAt > 0) {
    result.lastCheckedAt = value.lastCheckedAt
  }
  if (typeof value.lastCheckedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastCheckedDay)) {
    result.lastCheckedDay = value.lastCheckedDay
  }
  if (typeof value.lastResult === 'string' && RESULTS.has(value.lastResult)) result.lastResult = value.lastResult as AppUpdateResult
  if (isValidAppVersion(value.latestVersion) && isAppReleaseUrl(value.latestUrl)) {
    result.latestVersion = value.latestVersion
    result.latestUrl = value.latestUrl
  } else if (result.lastResult === 'update_available') {
    result.lastResult = null
  }
  if (isValidAppVersion(value.lastNotifiedVersion)) result.lastNotifiedVersion = value.lastNotifiedVersion
  return result
}

export class AppUpdateStore {
  private readonly filePath: string
  private cache: AppUpdateStored | null = null

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, 'app-update.json')
  }

  get(): AppUpdateStored {
    this.cache ??= sanitizeAppUpdateStored(readBoundedJson(this.filePath))
    return this.cache
  }

  update(patch: Partial<AppUpdateStored>): AppUpdateStored {
    const next = sanitizeAppUpdateStored({ ...this.get(), ...patch })
    writeJsonAtomic(this.filePath, next)
    this.cache = next
    return next
  }
}
