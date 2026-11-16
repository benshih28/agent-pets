import { DailyCheckSchedule, type DailyCheckResult } from './daily-check-schedule.ts'
import {
  comparePluginSemver,
  selectLatestCompatiblePluginVersion,
} from './plugin-catalog.ts'
import type { PluginCatalogDocument, PluginCatalogPanelItem } from '../src/types/plugin-catalog.ts'
import { asRecord } from './value-guards.ts'

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
  appVersion?: string,
): PluginCatalogPanelItem[] {
  const installed = new Map(installedPlugins.map(plugin => [plugin.id, plugin] as const))
  const items: PluginCatalogPanelItem[] = []
  for (const plugin of catalog.plugins) {
    const latestVersion = selectLatestCompatiblePluginVersion(plugin, '1', appVersion)
    if (!latestVersion) {
      // 這個 API 有版本，但全都需要更新的 app：顯示 "requires Agent Pets X"。
      const blocked = selectLatestCompatiblePluginVersion(plugin, '1')
      const required = blocked ? lowestRequiredAppVersion(plugin.versions) : null
      if (blocked && required) {
        items.push({
          plugin,
          latestVersion: blocked,
          installedVersion: installed.get(plugin.id)?.currentVersion ?? null,
          updateAvailable: false,
          catalogOlder: false,
          permissionsIncreased: null,
          signingKeyChange: 'unknown',
          requiresAppVersion: required,
        })
      }
      continue
    }
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

function lowestRequiredAppVersion(versions: PluginCatalogDocument['plugins'][number]['versions']): string | null {
  let lowest: string | null = null
  for (const version of versions) {
    if (version.apiVersion !== '1' || !version.minAppVersion) continue
    if (lowest === null || (comparePluginSemver(version.minAppVersion, lowest) ?? 1) < 0) lowest = version.minAppVersion
  }
  return lowest
}

/** Compares a downloaded manifest's permission units against the persisted user grants. */
export function comparePluginPermissionUnits(grantedPermissions: unknown, requestedUnits: unknown): boolean | null {
  const grantedUnits = readGrantedPermissionUnits(grantedPermissions)
  if (!grantedUnits || !Array.isArray(requestedUnits) || requestedUnits.some(unit => typeof unit !== 'string')) return null
  return requestedUnits.some(unit => !grantedUnits.has(unit))
}

function readGrantedPermissionUnits(value: unknown): Set<string> | null {
  const units = asRecord(value)?.units
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

export type PluginCatalogAutoCheckResult = DailyCheckResult

/** Plugin 目錄的每日自動檢查：排程規則由 DailyCheckSchedule 共用，這裡只加上更新數量的合理範圍。 */
export class PluginCatalogAutoCheckSchedule extends DailyCheckSchedule<number> {
  constructor(dependencies: PluginCatalogAutoCheckDependencies) {
    super({
      ...dependencies,
      isValidResult: count => Number.isSafeInteger(count) && count >= 0 && count <= 500,
    })
  }
}
