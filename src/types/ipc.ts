import { PLUGIN_ERROR_CODES } from './plugin.ts'

export const PLUGIN_REGISTRY_ERROR_CODES = Object.freeze([
  'archive_too_large', 'invalid_archive', 'invalid_manifest', 'incompatible', 'missing_entry', 'missing_icon',
  'missing_panel_entry', 'invalid_html_location', 'invalid_icon', 'registry_unavailable', 'plan_not_found',
  'permission_reconsent_required', 'signature_invalid', 'signature_confirmation_required', 'filesystem_unsafe',
  'install_failed', 'plugin_not_found',
] as const)

export type PluginRegistryError = typeof PLUGIN_REGISTRY_ERROR_CODES[number]

export const PLUGIN_CATALOG_ERROR_CODES = Object.freeze([
  'catalog_disabled', 'catalog_url_invalid', 'catalog_unavailable', 'catalog_not_found', 'catalog_invalid',
  'host_not_allowed', 'download_mismatch', 'signature_mismatch', 'plugin_not_in_catalog',
] as const)

export type PluginCatalogError = typeof PLUGIN_CATALOG_ERROR_CODES[number]

export const PLUGIN_PANEL_IPC_ERROR_CODES = Object.freeze([
  ...PLUGIN_ERROR_CODES,
  'panel_load_failed',
  'panel_unavailable',
] as const)

/** Stable error codes returned across the main/renderer IPC boundary. */
const ipcErrorCodeEntries = [
  ...PLUGIN_ERROR_CODES,
  ...PLUGIN_REGISTRY_ERROR_CODES,
  ...PLUGIN_CATALOG_ERROR_CODES,
  'panel_load_failed',
  'panel_unavailable',
  'plugin_service_unavailable',
  'preferences_unsafe',
  'secret_consent_required',
  'plugin_action_failed',
  'dialog_unavailable',
  'report_unavailable',
  'cancelled',
  'unavailable',
  'write_failed',
  'invalid_decision',
  'conflict',
  'invalid_project',
  'invalid_pet',
] as const

export const IPC_ERROR_CODES = Object.freeze([...new Set(ipcErrorCodeEntries)])
export type IpcErrorCode = typeof IPC_ERROR_CODES[number]

const ipcErrorCodeSet: ReadonlySet<string> = new Set(IPC_ERROR_CODES)
export function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return typeof value === 'string' && ipcErrorCodeSet.has(value)
}

export interface AdapterDiagnoseIpcResult {
  ok: boolean
  report?: import('./agent-adapter').DiagnosticReport
  error?: string
}

export interface AdapterInstallIpcResult {
  ok: boolean
  status?: import('./agent-adapter').AdapterDetection
  error?: string
}

export interface AdapterUninstallIpcResult {
  ok: boolean
  status?: import('./agent-adapter').AdapterDetection
  error?: string
}

export interface AdapterIntegrationStatusIpcResult {
  adapters: ReadonlyArray<import('./agent-adapter').AdapterRuntimeStatus>
}
