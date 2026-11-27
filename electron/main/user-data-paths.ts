import { join, resolve } from 'node:path'

// 這些名稱已寫在使用者磁碟上，改值會讓既有資料變孤兒；要新增項目，不要改名。
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
  legacyPermissionAudit: 'permission-audit.json',
} as const satisfies Record<string, string>

export type UserDataEntry = keyof typeof USER_DATA_ENTRIES

export type UserDataPaths = Readonly<Record<UserDataEntry, string>> & {
  readonly root: string
  pluginVersionRoot(pluginId: string, version: string): string
}

export function createUserDataPaths(root: string): UserDataPaths {
  const entries = Object.fromEntries(
    Object.entries(USER_DATA_ENTRIES).map(([key, name]) => [key, join(root, name)]),
  ) as Record<UserDataEntry, string>
  return Object.freeze({
    ...entries,
    root,
    // 用 `resolve` 而非 `join`：與插件 protocol 的路徑包含檢查一致。
    pluginVersionRoot: (pluginId: string, version: string) => resolve(root, USER_DATA_ENTRIES.plugins, pluginId, version),
  })
}

export function memoizeUserDataPaths(resolveRoot: () => string): () => UserDataPaths {
  let paths: UserDataPaths | null = null
  return () => (paths ??= createUserDataPaths(resolveRoot()))
}
