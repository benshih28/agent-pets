import type { PluginInstallPlan } from '../types/plugin'

// 授權畫面用的權限分級。單位字串格式與主行程 plugin-registry.ts 的 permissionUnits() 一致，
// 例如 `network:api.example.com`、`secrets:token`、`contributes:panelView`。
export type PermissionGroupId = 'network' | 'data' | 'display'
export type PermissionRisk = 'high' | 'medium' | 'low'

export interface PermissionEntry {
  unit: string
  /** 單位類別，例如 network / links / secrets / contributes。 */
  kind: string
  /** 類別之後的細節，例如主機名稱。 */
  detail: string
  group: PermissionGroupId
  risk: PermissionRisk
  /** 本程式認得的權限；false 時畫面要顯示「未知權限」而不是內部代碼。 */
  known: boolean
}

export interface PermissionGroup {
  id: PermissionGroupId
  risk: PermissionRisk
  entries: PermissionEntry[]
}

const RISK_ORDER: Record<PermissionRisk, number> = { high: 3, medium: 2, low: 1 }
const GROUP_ORDER: PermissionGroupId[] = ['network', 'data', 'display']
const KNOWN_CONTRIBUTIONS = new Set(['feed', 'reaction', 'panelView', 'commands', 'tray', 'badge', 'eventSource'])

export function parsePermissionUnit(unit: string): PermissionEntry {
  const separator = unit.indexOf(':')
  const kind = separator < 0 ? unit : unit.slice(0, separator)
  const detail = separator < 0 ? '' : unit.slice(separator + 1)
  const entry = (group: PermissionGroupId, risk: PermissionRisk, known = true): PermissionEntry => ({
    unit, kind, detail, group, risk, known,
  })
  if (kind === 'network' || kind === 'links') return entry('network', 'high')
  if (kind === 'secrets') return entry('data', 'high')
  if (kind === 'storage' || kind === 'schedule' || kind === 'agentStatus') return entry('data', 'medium')
  if (kind === 'contributes') {
    const name = detail.startsWith('skins:') ? 'skins' : detail
    if (name === 'skins' || KNOWN_CONTRIBUTIONS.has(name)) return entry('display', 'low')
  }
  // 不認得的單位一律當成高風險資料類，避免新權限被悄悄降級顯示。
  return entry('data', 'high', false)
}

export function permissionUnitsOfPlan(plan: Pick<PluginInstallPlan, 'permissions' | 'contributes'>): string[] {
  const units: string[] = []
  for (const host of plan.permissions?.network?.hosts ?? []) units.push(`network:${host}`)
  if (plan.permissions?.network?.userGranted) units.push('network:userGranted')
  for (const host of plan.permissions?.links?.hosts ?? []) units.push(`links:${host}`)
  if (plan.permissions?.storage) units.push('storage')
  if (plan.permissions?.agentStatus) units.push('agentStatus')
  if (plan.permissions?.schedule) units.push('schedule')
  for (const secret of plan.permissions?.secrets ?? []) units.push(`secrets:${secret}`)
  if (plan.contributes?.feed) units.push('contributes:feed')
  if (plan.contributes?.reaction) units.push('contributes:reaction')
  if (plan.contributes?.panelView) units.push('contributes:panelView')
  if (plan.contributes?.commands?.length) units.push('contributes:commands')
  if (plan.contributes?.tray?.commands.length) units.push('contributes:tray')
  if (plan.contributes?.badge) units.push('contributes:badge')
  if (plan.contributes?.skins?.length) units.push(`contributes:skins:${plan.contributes.skins.length}`)
  if (plan.contributes?.eventSource) units.push('contributes:eventSource')
  return units
}

export function groupPermissionUnits(units: readonly string[]): PermissionGroup[] {
  const groups = new Map<PermissionGroupId, PermissionGroup>()
  for (const unit of units) {
    const entry = parsePermissionUnit(unit)
    const group = groups.get(entry.group) ?? { id: entry.group, risk: entry.risk, entries: [] }
    group.entries.push(entry)
    if (RISK_ORDER[entry.risk] > RISK_ORDER[group.risk]) group.risk = entry.risk
    groups.set(entry.group, group)
  }
  for (const group of groups.values()) {
    group.entries.sort((left, right) => RISK_ORDER[right.risk] - RISK_ORDER[left.risk])
  }
  return GROUP_ORDER.flatMap(id => groups.get(id) ?? [])
}

export type InstallAcknowledgementReason =
  | 'signature-key-changed'
  | 'signature-removed'
  | 'added-network'
  | 'added-secrets'

// 高風險變更需要使用者明確勾選「我已了解」才能按下確認，且預設焦點落在取消。
// 只會讓流程更嚴格：主行程仍照原本的 requiresReconsent / requiresSignatureConfirmation 驗證。
export function installAcknowledgementReasons(
  plan: Pick<PluginInstallPlan, 'kind' | 'signatureChange' | 'requiresSignatureConfirmation' | 'addedPermissions' | 'requiresReconsent'> | null,
): InstallAcknowledgementReason[] {
  if (!plan || plan.kind === 'incompatible') return []
  const reasons: InstallAcknowledgementReason[] = []
  if (plan.signatureChange === 'key-changed') reasons.push('signature-key-changed')
  if (plan.signatureChange === 'signed-to-unsigned') reasons.push('signature-removed')
  if (plan.requiresSignatureConfirmation && reasons.length === 0) reasons.push('signature-key-changed')
  if (plan.requiresReconsent) {
    if (plan.addedPermissions.some(unit => unit.startsWith('network:') || unit.startsWith('links:'))) reasons.push('added-network')
    if (plan.addedPermissions.some(unit => unit.startsWith('secrets:'))) reasons.push('added-secrets')
  }
  return reasons
}

export function shouldFocusCancelOnInstall(plan: Parameters<typeof installAcknowledgementReasons>[0]): boolean {
  return installAcknowledgementReasons(plan).length > 0
}
