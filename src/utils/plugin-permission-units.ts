// 插件權限單位的唯一產生器。主行程用 grantedPermissionUnits() 決定安裝要授權什麼、寫進
// registry.json 的 grantedPermissions.units，以及更新時是否要重新同意；安裝畫面用
// permissionUnitsInDisplayOrder() 列出同一批單位。兩邊共用同一份規則，新增 contribution 時
// CONTRIBUTION_PERMISSION_UNITS 少一格就編譯失敗，不會只改到其中一邊。
// 主行程與 Node 測試都直接載入這個檔，所以執行期 import 只能用相對路徑。
import type { PluginContributionId, PluginContributions, PluginContributionValueMap, PluginManifest } from '../types/plugin.ts'

export interface PermissionUnitSource {
  permissions?: PluginManifest['permissions']
  contributes?: PluginContributions
}

type ContributionUnitTable = {
  readonly [K in PluginContributionId]: (value: PluginContributionValueMap[K]) => readonly string[]
}

// 鍵的順序就是畫面的顯示順序。只有在 manifest 裡為 truthy 的 contribution 才會呼叫。
const CONTRIBUTION_PERMISSION_UNITS: ContributionUnitTable = Object.freeze({
  feed: () => ['contributes:feed'],
  reaction: () => ['contributes:reaction'],
  // 設定欄位只是插件自己的偏好表單，沒有新的能力；密鑰欄位另由 permissions.secrets 授權。
  settings: () => [],
  panelView: () => ['contributes:panelView'],
  commands: commands => commands.length ? ['contributes:commands'] : [],
  tray: tray => tray.commands.length ? ['contributes:tray'] : [],
  badge: () => ['contributes:badge'],
  skins: skins => skins.length ? [`contributes:skins:${skins.length}`] : [],
  eventSource: () => ['contributes:eventSource'],
  panelThemes: themes => [
    ...themes.length ? [`contributes:panelThemes:${themes.length}`] : [],
    ...themes.some(theme => theme.fonts.length > 0) ? ['contributes:panelThemeFonts'] : [],
  ],
})

// ContributionUnitTable 是窮舉的映射型別，所以 Object.keys 正好是全部的 contribution id。
const CONTRIBUTION_IDS = Object.keys(CONTRIBUTION_PERMISSION_UNITS) as PluginContributionId[]

const PERMISSION_DISPLAY_ORDER: ReadonlyMap<string, number> = new Map(
  ['network', 'links', 'storage', 'agentStatus', 'schedule', 'secrets'].map((key, index) => [key, index]),
)

function hasHosts(value: unknown): value is { hosts: readonly string[]; userGranted?: boolean } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'hosts' in value
}

// manifest 驗證之外再保守一層：任何其他為 true 的權限鍵都自成一個單位，讓未來新增的權限
// 一定進入授權清單與更新差異，畫面也會把它顯示成「未知權限」而不是略過。
function permissionKeyUnits(key: string, value: unknown): string[] {
  if ((key === 'network' || key === 'links') && hasHosts(value)) {
    const units = value.hosts.map(host => `${key}:${host}`)
    if (key === 'network' && value.userGranted) units.push('network:userGranted')
    return units
  }
  if (key === 'secrets' && Array.isArray(value)) return value.map(secret => `secrets:${secret}`)
  if (key === 'schedule' && value) return ['schedule']
  return value === true ? [key] : []
}

function contributionUnits<K extends PluginContributionId>(contributes: PluginContributions, id: K): readonly string[] {
  const value = contributes[id]
  return value ? CONTRIBUTION_PERMISSION_UNITS[id](value) : []
}

/** 安裝畫面的順序：網路、連結、儲存、Agent 狀態、排程、密鑰，再依 contribution 順序；不去重。 */
export function permissionUnitsInDisplayOrder(source: PermissionUnitSource): string[] {
  const permissions = Object.entries(source.permissions ?? {})
    .map(([key, value], index) => ({ key, value, rank: PERMISSION_DISPLAY_ORDER.get(key) ?? PERMISSION_DISPLAY_ORDER.size + index }))
    .sort((left, right) => left.rank - right.rank)
  const contributes = source.contributes ?? {}
  return [
    ...permissions.flatMap(({ key, value }) => permissionKeyUnits(key, value)),
    ...CONTRIBUTION_IDS.flatMap(id => contributionUnits(contributes, id)),
  ]
}

/** 主行程的授權單位：去重並排序，是 grantedPermissions.units 與更新差異的比較基準。 */
export function grantedPermissionUnits(source: PermissionUnitSource): string[] {
  return [...new Set(permissionUnitsInDisplayOrder(source))].sort()
}
