// 這個檔案不 import 任何東西，Node 測試可以直接載入。

// 保留路徑 `_host`／`_shared` 含底線，本來就不符合這個字元集，所以不需要另外排除。
export const PLUGIN_ID_SOURCE = '[a-z0-9-]{3,48}'
export const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`)
export const PLUGIN_COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const SAFE_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
export const KEY_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/
export const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/
/** 不含 pre-release／build。 */
export const SEMVER_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
// 各入口的長度上限不同且都是既有契約，所以依上限分成三個具名常數，不提供任意長度的版本。
export const OPAQUE_ID_CHARS = '[A-Za-z0-9._:-]'
const opaqueIdPattern = (maxLength: number) => new RegExp(`^${OPAQUE_ID_CHARS}{1,${maxLength}}$`)
export const OPAQUE_ID_64_PATTERN = opaqueIdPattern(64)
/** `agent-hook.mjs` 有一份相同的字面值。 */
export const OPAQUE_ID_128_PATTERN = opaqueIdPattern(128)
export const OPAQUE_ID_256_PATTERN = opaqueIdPattern(256)

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value)
}

export const isPluginId = (value: unknown): value is string => matches(PLUGIN_ID_PATTERN, value)
export const isPluginCommandId = (value: unknown): value is string => matches(PLUGIN_COMMAND_ID_PATTERN, value)
export const isSafeItemId = (value: unknown): value is string => matches(SAFE_ITEM_ID_PATTERN, value)
export const isKeyFingerprint = (value: unknown): value is string => matches(KEY_FINGERPRINT_PATTERN, value)
export const isProjectId = (value: unknown): value is string => matches(PROJECT_ID_PATTERN, value)
export const isSemverCore = (value: unknown): value is string => matches(SEMVER_CORE_PATTERN, value)
export const isUuidV4 = (value: unknown): value is string => matches(UUID_V4_PATTERN, value)
export const isOpaqueId64 = (value: unknown): value is string => matches(OPAQUE_ID_64_PATTERN, value)
export const isOpaqueId128 = (value: unknown): value is string => matches(OPAQUE_ID_128_PATTERN, value)
export const isOpaqueId256 = (value: unknown): value is string => matches(OPAQUE_ID_256_PATTERN, value)
