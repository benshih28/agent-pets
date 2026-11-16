import { join, resolve } from 'node:path'

// 主程序直接放在 Electron `userData` 底下的檔案與目錄。這些名稱已經寫在使用者的磁碟上，
// 改值等於把既有資料搬走（變成孤兒），要新增項目而不是改名。
// 收到整個 `userData` 目錄的 store（plugin registry、偏好、secret、設定、面板主題）自己管理檔名。
export const USER_DATA_ENTRIES = {
  logs: 'logs',
  plugins: 'plugins',
  panelSize: 'panel-size.json',
  desktopPreferences: 'desktop-preferences.json',
  notificationLog: 'notification-log.json',
  onboarding: 'onboarding.json',
  projectMcpRegistry: 'project-mcp-registry.json',
  projectRouting: 'project-routing.sqlite',
  progression: 'progression.sqlite',
  achievements: 'achievements.sqlite',
  history: 'history.sqlite',
  permissionAudit: 'permission-audit.jsonl',
  /** JSONL 之前的舊版稽核記錄；只在啟動時讀一次以遷移並修剪。 */
  legacyPermissionAudit: 'permission-audit.json',
} as const satisfies Record<string, string>

export type UserDataEntry = keyof typeof USER_DATA_ENTRIES

export type UserDataPaths = Readonly<Record<UserDataEntry, string>> & {
  readonly root: string
  /** 已安裝插件版本的目錄：`<userData>/plugins/<pluginId>/<version>`。 */
  pluginVersionRoot(pluginId: string, version: string): string
}

/** `userData` 目錄的純路徑表，不做任何 I/O。 */
export function createUserDataPaths(root: string): UserDataPaths {
  const entries = Object.fromEntries(
    Object.entries(USER_DATA_ENTRIES).map(([key, name]) => [key, join(root, name)]),
  ) as Record<UserDataEntry, string>
  return Object.freeze({
    ...entries,
    root,
    // 用 `resolve` 而非 `join`：與插件 protocol 的路徑包含檢查一致（改前就是 resolve）。
    pluginVersionRoot: (pluginId: string, version: string) => resolve(root, USER_DATA_ENTRIES.plugins, pluginId, version),
  })
}

/** 第一次使用時才解析 root，之後重用同一張表。 */
export function memoizeUserDataPaths(resolveRoot: () => string): () => UserDataPaths {
  let paths: UserDataPaths | null = null
  return () => (paths ??= createUserDataPaths(resolveRoot()))
}
