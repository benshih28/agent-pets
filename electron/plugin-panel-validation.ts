import type { IpcErrorCode } from '../src/types/ipc.ts'
import { isPluginErrorCode } from '../src/types/plugin.ts'
import { isPluginId, isSafeItemId } from '../src/types/id-patterns.ts'

/** IPC 處理器以依賴注入取得的插件 id 檢查；與 manifest 同一份規則（src/types/id-patterns.ts）。 */
export const isPluginPanelPluginId = isPluginId

export const isPluginPanelNotificationId = isSafeItemId

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
