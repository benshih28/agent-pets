// 識別值格式的唯一來源：manifest、目錄、IPC、協定路由、儲存路徑、Worker 宿主與渲染端都用這一份，
// 不再各自複製 regex。這個檔案不 import 任何東西，Node 測試可以直接載入。

/**
 * 插件 id。保留路徑 `_host`／`_shared`（agent-pets://plugin/ 底下）含底線，本來就不符合這個
 * 字元集，所以不需要另外排除。`PLUGIN_ID_SOURCE` 是不含錨點的本體，供組合其他 pattern。
 */
export const PLUGIN_ID_SOURCE = '[a-z0-9-]{3,48}'
export const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`)
/** 插件命令 id（`contributes.commands[].id`、托盤命令）。 */
export const PLUGIN_COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
/** 主機產生的項目 id（插件通知、展示訊息）。 */
export const SAFE_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
/** 簽章公鑰指紋（SHA-256 的前 16 個十六進位字元）。 */
export const KEY_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/
/** 專案 id（正規化路徑的 32 位十六進位雜湊）。 */
export const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/
/** 不含 pre-release／build 的語意化版本 `x.y.z`（插件版本、App 版本）。 */
export const SEMVER_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
/** `crypto.randomUUID()` 產生的 v4 UUID（插件宿主與面板頁的 session token）。 */
export const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
/**
 * 由 agent、hook 或主程序產生、只拿來比對的不透明識別碼字元集：英數與 `.`、`_`、`:`、`-`。
 * 各入口的長度上限不同且都是既有契約，所以依上限分成三個具名常數，不提供任意長度的版本。
 */
export const OPAQUE_ID_CHARS = '[A-Za-z0-9._:-]'
const opaqueIdPattern = (maxLength: number) => new RegExp(`^${OPAQUE_ID_CHARS}{1,${maxLength}}$`)
/** History 工作階段清單的 adapter 篩選。 */
export const OPAQUE_ID_64_PATTERN = opaqueIdPattern(64)
/** 權限請求的 instance／session／permission／decision id、進度事件的寵物 id；`agent-hook.mjs` 有一份相同的字面值。 */
export const OPAQUE_ID_128_PATTERN = opaqueIdPattern(128)
/** History 事件的 `eventId`、`adapterId`。 */
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
