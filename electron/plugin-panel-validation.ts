import type { IpcErrorCode } from '../src/types/ipc.ts'
import { isPluginErrorCode } from '../src/types/plugin.ts'
export function isPluginPanelPluginId(value: unknown): value is string {
  return typeof value === 'string' && /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(value)
}

export function isPluginPanelNotificationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value)
}

export function isPluginPanelPreferencePatch(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Object.keys(value)
  if (keys.length > 16) return false
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16 * 1024
  } catch {
    return false
  }
}

export function isPluginPanelInstallConfirmation(
  token: unknown,
  acceptAdditionalPermissions: unknown,
  acceptSignatureChange: unknown,
): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 128
    && typeof acceptAdditionalPermissions === 'boolean'
    && typeof acceptSignatureChange === 'boolean'
}

export function pluginPanelErrorCode(error: unknown): IpcErrorCode {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'unsafe_file') {
    return 'preferences_unsafe'
  }
  if (error && typeof error === 'object' && 'code' in error && isPluginErrorCode(error.code)
    && ['secret_unavailable', 'secret_not_found', 'settings_invalid', 'too_large', 'not_permitted'].includes(error.code)) {
    return error.code
  }
  if (error instanceof TypeError && error.message === 'Plugin catalog URL is invalid') return 'catalog_url_invalid'
  if (error instanceof TypeError) return 'invalid_request'
  return 'plugin_action_failed'
}
