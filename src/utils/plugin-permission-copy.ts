// 權限單位 → 畫面文字（標籤與說明）。分組與風險等級仍由 plugin-permissions.ts 決定；
// 授權與重新同意一律由主程序判定，這裡只負責顯示。
import { t, tPlural, type TranslationKey, type TranslationParams } from '@/i18n'
import { groupPermissionUnits, parsePermissionUnit, type PermissionGroupId, type PermissionRisk } from '@/utils/plugin-permissions'
import { lookupOwn } from '@/utils/own-lookup'

export interface PermissionEntryView {
  unit: string
  label: string
  hint: string
  risk: PermissionRisk
  known: boolean
}

export interface PermissionGroupView {
  id: PermissionGroupId
  risk: PermissionRisk
  entries: PermissionEntryView[]
}

type PermissionCopy = {
  hint: TranslationKey
  params?: (detail: string, unit: string) => TranslationParams
} & (
  | { label: TranslationKey; plural?: false }
  // 複數標籤以 `<label>.one`/`.other` 存放，不是 TranslationKey，由 tPlural 依 count 取用。
  | { label: string; plural: true }
)

// 依權限種類（`kind:detail` 的 kind）。
const KIND_COPY = {
  network: { label: 'pluginPermissionNetwork', hint: 'plugins.hintNetwork', params: host => ({ host }) },
  links: { label: 'pluginPermissionLinks', hint: 'plugins.hintLinks', params: host => ({ host }) },
  storage: { label: 'pluginPermissionStorage', hint: 'plugins.hintStorage' },
  agentStatus: { label: 'pluginPermissionAgentStatus', hint: 'plugins.hintAgentStatus' },
  schedule: { label: 'pluginPermissionSchedule', hint: 'plugins.hintSchedule' },
  secrets: { label: 'pluginPermissionSecret', hint: 'plugins.hintSecrets', params: name => ({ name }) },
} as const satisfies Record<string, PermissionCopy>

const NETWORK_USER_GRANTED_COPY: PermissionCopy = { label: 'plugins.permNetworkUserGranted', hint: 'plugins.hintNetworkUserGranted' }

// 其餘依 detail（貢獻點名稱）。
const CONTRIBUTION_COPY = {
  feed: { label: 'pluginPermissionFeed', hint: 'plugins.hintFeed' },
  reaction: { label: 'pluginPermissionReaction', hint: 'plugins.hintReaction' },
  panelView: { label: 'pluginPermissionPanel', hint: 'plugins.hintPanel' },
  commands: { label: 'pluginPermissionCommands', hint: 'plugins.hintCommands' },
  tray: { label: 'pluginPermissionTray', hint: 'plugins.hintTray' },
  badge: { label: 'pluginPermissionBadge', hint: 'plugins.hintBadge' },
  eventSource: { label: 'pluginPermissionEventSource', hint: 'plugins.hintEventSource' },
  panelThemeFonts: { label: 'pluginPermissionPanelThemeFonts', hint: 'plugins.hintPanelThemeFonts' },
} as const satisfies Record<string, PermissionCopy>

// 帶數量的貢獻點（`skins:3`、`panelThemes:2`）。
const COUNTED_CONTRIBUTION_COPY = [
  ['skins:', { label: 'pluginPermissionSkins', hint: 'plugins.hintSkins', plural: true }],
  ['panelThemes:', { label: 'pluginPermissionPanelThemes', hint: 'plugins.hintPanelThemes', plural: true }],
] as const satisfies ReadonlyArray<readonly [string, PermissionCopy]>

const UNKNOWN_COPY: PermissionCopy = { label: 'plugins.permUnknown', hint: 'plugins.hintUnknown', params: (_detail, unit) => ({ unit }) }

function resolveCopy(unit: string): { copy: PermissionCopy; params: TranslationParams | undefined } {
  const { kind, detail } = parsePermissionUnit(unit)
  if (kind === 'network' && detail === 'userGranted') return { copy: NETWORK_USER_GRANTED_COPY, params: undefined }
  const exact: PermissionCopy | undefined = lookupOwn(KIND_COPY, kind) ?? lookupOwn(CONTRIBUTION_COPY, detail)
  if (exact) return { copy: exact, params: exact.params?.(detail, unit) }
  const counted = COUNTED_CONTRIBUTION_COPY.find(([prefix]) => detail.startsWith(prefix))
  if (counted) return { copy: counted[1], params: { count: detail.slice(counted[0].length) } }
  return { copy: UNKNOWN_COPY, params: UNKNOWN_COPY.params?.(detail, unit) }
}

export function permissionLabel(unit: string): string {
  const { copy, params } = resolveCopy(unit)
  if (copy.plural) return tPlural(copy.label, Number(params?.count) || 0, params)
  return t(copy.label, params)
}

export function permissionHint(unit: string): string {
  return t(resolveCopy(unit).copy.hint)
}

export function toPermissionGroupViews(units: readonly string[]): PermissionGroupView[] {
  return groupPermissionUnits(units).map(group => ({
    id: group.id,
    risk: group.risk,
    entries: group.entries.map(entry => ({
      unit: entry.unit,
      label: permissionLabel(entry.unit),
      hint: permissionHint(entry.unit),
      risk: entry.risk,
      known: entry.known,
    })),
  }))
}
