import type { PluginLocalizedText } from './plugin.ts'

export const DEFAULT_PLUGIN_CATALOG_URL = 'https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json'

export function shouldShowCatalogPermissionCheck(
  permissionsIncreased: boolean | null,
  updateAvailable: boolean,
): boolean {
  return updateAvailable && permissionsIncreased === null
}

export interface PluginCatalogVersion {
  version: string
  apiVersion: string
  url: string
  sha256: string
  size: number
  publishedAt: string
}

export interface PluginCatalogPlugin {
  id: string
  name: PluginLocalizedText
  description: PluginLocalizedText
  author: string
  homepage?: string
  publicKeyFingerprint?: string
  versions: PluginCatalogVersion[]
}

export interface PluginCatalogDocument {
  schemaVersion: 1
  plugins: PluginCatalogPlugin[]
}

export interface PluginCatalogPanelItem {
  plugin: PluginCatalogPlugin
  latestVersion: PluginCatalogVersion
  installedVersion: string | null
  updateAvailable: boolean
  catalogOlder: boolean
  permissionsIncreased: boolean | null
  signingKeyChange: 'changed' | 'unchanged' | 'unknown'
}
