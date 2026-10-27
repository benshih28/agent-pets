import {
  comparePluginSemver,
  selectLatestCompatiblePluginVersion,
} from './plugin-catalog.ts'
import type { PluginCatalogDocument, PluginCatalogPanelItem } from '../src/types/plugin-catalog.ts'

export interface InstalledPluginUpdateState {
  id: string
  currentVersion: string
  grantedPermissions: unknown
  signatureStatus?: 'unsigned' | 'valid' | 'unverified'
  signatureFingerprint?: string
  trustedKeyFingerprint?: string
}

export function buildPluginCatalogPanelItems(
  catalog: PluginCatalogDocument,
  installedPlugins: InstalledPluginUpdateState[],
): PluginCatalogPanelItem[] {
  const installed = new Map(installedPlugins.map(plugin => [plugin.id, plugin] as const))
  const items: PluginCatalogPanelItem[] = []
  for (const plugin of catalog.plugins) {
    const latestVersion = selectLatestCompatiblePluginVersion(plugin, '1')
    if (!latestVersion) continue
    const installedPlugin = installed.get(plugin.id)
    const installedVersion = installedPlugin?.currentVersion ?? null
    const comparison = installedVersion === null ? null : comparePluginSemver(latestVersion.version, installedVersion)
    const updateAvailable = comparison !== null && comparison > 0
    const catalogOlder = comparison !== null && comparison < 0
    const permissionsIncreased = null
    const trustedFingerprint = installedPlugin?.trustedKeyFingerprint
      ?? (installedPlugin?.signatureStatus === 'valid' ? installedPlugin.signatureFingerprint : undefined)
    const signingKeyChange = updateAvailable && trustedFingerprint && plugin.publicKeyFingerprint
      ? trustedFingerprint === plugin.publicKeyFingerprint ? 'unchanged' : 'changed'
      : 'unknown'
    items.push({
      plugin,
      latestVersion,
      installedVersion,
      updateAvailable,
      catalogOlder,
      permissionsIncreased,
      signingKeyChange,
    })
  }
  return items
}

/** Compares a downloaded manifest's permission units against the persisted user grants. */
export function comparePluginPermissionUnits(grantedPermissions: unknown, requestedUnits: unknown): boolean | null {
  const grantedUnits = readGrantedPermissionUnits(grantedPermissions)
  if (!grantedUnits || !Array.isArray(requestedUnits) || requestedUnits.some(unit => typeof unit !== 'string')) return null
  return requestedUnits.some(unit => !grantedUnits.has(unit))
}

function readGrantedPermissionUnits(value: unknown): Set<string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const units = (value as Record<string, unknown>).units
  if (!Array.isArray(units) || units.some(unit => typeof unit !== 'string')) return null
  return new Set(units as string[])
}

export interface PluginCatalogAutoCheckDependencies {
  isEnabled: () => boolean
  getLastCheckedDay: () => string | null
  setLastCheckedDay: (day: string) => void
  check: () => Promise<number>
  notify: (updateCount: number) => void
  now?: () => number
}

export type PluginCatalogAutoCheckResult =
  | 'disabled'
  | 'already-checked'
  | 'already-running'
  | 'checked'
  | 'failed'

export class PluginCatalogAutoCheckSchedule {
  private readonly isEnabled: PluginCatalogAutoCheckDependencies['isEnabled']
  private readonly getLastCheckedDay: PluginCatalogAutoCheckDependencies['getLastCheckedDay']
  private readonly setLastCheckedDay: PluginCatalogAutoCheckDependencies['setLastCheckedDay']
  private readonly check: PluginCatalogAutoCheckDependencies['check']
  private readonly notify: PluginCatalogAutoCheckDependencies['notify']
  private readonly now: () => number
  private running = false

  constructor(dependencies: PluginCatalogAutoCheckDependencies) {
    this.isEnabled = dependencies.isEnabled
    this.getLastCheckedDay = dependencies.getLastCheckedDay
    this.setLastCheckedDay = dependencies.setLastCheckedDay
    this.check = dependencies.check
    this.notify = dependencies.notify
    this.now = dependencies.now ?? Date.now
  }

  async checkIfDue(): Promise<PluginCatalogAutoCheckResult> {
    if (this.running) return 'already-running'
    try {
      if (!this.isEnabled()) return 'disabled'
      const timestamp = this.now()
      if (!Number.isFinite(timestamp)) return 'failed'
      const day = new Date(timestamp).toISOString().slice(0, 10)
      if (this.getLastCheckedDay() === day) return 'already-checked'
      this.setLastCheckedDay(day)
      this.running = true
      const count = await this.check()
      if (!Number.isSafeInteger(count) || count < 0 || count > 500) return 'failed'
      this.notify(count)
      return 'checked'
    } catch {
      return 'failed'
    } finally {
      this.running = false
    }
  }
}
