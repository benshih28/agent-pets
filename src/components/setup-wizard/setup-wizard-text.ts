// 設定精靈的文字對照：安裝結果、診斷檢查、健康狀態、能力矩陣與設定目錄提示。
// 與畫面無關的純函式與 key 表；onboarding-i18n 測試會讀這個檔案確認每個後端錯誤／檢查碼都有在地化文字。
import type { AdapterRuntimeStatus, AgentAdapterId, AgentConfigDirIgnoredReason, DiagnosticReport, InstallErrorCode, InstallOutcome } from '@/types/agent-adapter'
import type { AgentSource } from '@/types/agent'
import { t, type TranslationKey } from '@/i18n'

export interface ToolStatus extends AdapterRuntimeStatus {
  verifiedAt?: number
  testError?: string
  diagnosis?: DiagnosticReport
  /** Result of the last install/repair, shown inside the card until the next one. */
  outcome?: InstallOutcome
  /** A genuine event from the tool itself (not the built-in receiver test). */
  realEvent?: { source: AgentSource, at: number }
  realEventTimedOut?: boolean
}

const INSTALL_ERROR_KEYS: Record<InstallErrorCode, TranslationKey> = {
  config_unparseable: 'onboarding.errorConfigUnparseable',
  config_unsafe: 'onboarding.errorConfigUnsafe',
  config_too_large: 'onboarding.errorConfigTooLarge',
  config_changed: 'onboarding.errorConfigChanged',
  permission_denied: 'onboarding.errorPermissionDenied',
  file_busy: 'onboarding.errorFileBusy',
  read_only: 'onboarding.errorReadOnly',
  node_missing: 'onboarding.errorNodeMissing',
  node_unsupported: 'onboarding.errorNodeUnsupported',
  config_dir_unusable: 'onboarding.errorConfigDirUnusable',
  unknown: 'onboarding.errorUnknown',
}

export function outcomeText(outcome: InstallOutcome): string {
  if (outcome.action === 'failed') {
    const code = outcome.errorCode ?? 'unknown'
    const raw = outcome.errorPath ?? ''
    const isConfigIssue = code.startsWith('config_')
    return t(INSTALL_ERROR_KEYS[code], { path: isConfigIssue ? raw : raw ? ` (${raw})` : '' })
  }
  return t(`onboarding.outcome.${outcome.action}`, { count: outcome.changedFiles.length })
}

export const RESTART_KEYS: Record<AgentAdapterId, TranslationKey> = {
  opencode: 'onboarding.restartOpenCode',
  codex: 'onboarding.restartCodex',
  'claude-code': 'onboarding.restartClaudeCode',
  'generic-http': 'onboarding.restartOpenCode',
}

const CHECK_KEYS: Readonly<Record<string, TranslationKey>> = {
  'runtime.warn': 'onboarding.check.runtime.warn',
  'opencode-cli.pass': 'onboarding.check.opencode-cli.pass',
  'opencode-cli.warn': 'onboarding.check.opencode-cli.warn',
  'opencode-desktop.pass': 'onboarding.check.opencode-desktop.pass',
  'opencode-desktop.warn': 'onboarding.check.opencode-desktop.warn',
  'plugin-current.pass': 'onboarding.check.plugin-current.pass',
  'plugin-current.warn': 'onboarding.check.plugin-current.warn',
  'permission-channel.pass': 'onboarding.check.permission-channel.pass',
  'hooks-file.pass': 'onboarding.check.hooks-file.pass',
  'hooks-file.fail': 'onboarding.check.hooks-file.fail',
  'hooks-enabled.pass': 'onboarding.check.hooks-enabled.pass',
  'hooks-enabled.fail': 'onboarding.check.hooks-enabled.fail',
  'settings-file.pass': 'onboarding.check.settings-file.pass',
  'settings-file.fail': 'onboarding.check.settings-file.fail',
  'hook-script.pass': 'onboarding.check.hook-script.pass',
  'hook-script.fail': 'onboarding.check.hook-script.fail',
  'hook-script-current.pass': 'onboarding.check.hook-script-current.pass',
  'hook-script-current.warn': 'onboarding.check.hook-script-current.warn',
  'hook-command.pass': 'onboarding.check.hook-command.pass',
  'hook-command.fail': 'onboarding.check.hook-command.fail',
  'node.pass': 'onboarding.check.node.pass',
  'node.fail': 'onboarding.check.node.fail',
  'agent-present.pass': 'onboarding.check.agent-present.pass',
  'agent-present.warn': 'onboarding.check.agent-present.warn',
  'loopback.pass': 'onboarding.check.loopback.pass',
  'token.pass': 'onboarding.check.token.pass',
  'permissions.pass': 'onboarding.check.permissions.pass',
}

const FIX_KEYS: Readonly<Record<string, TranslationKey>> = {
  'hooks-file': 'onboarding.fix.hooks-file',
  'hooks-enabled': 'onboarding.fix.hooks-enabled',
  'settings-file': 'onboarding.fix.settings-file',
  'hook-script': 'onboarding.fix.hook-script',
  'hook-script-current': 'onboarding.fix.hook-script-current',
  'plugin-current': 'onboarding.fix.plugin-current',
  'hook-command': 'onboarding.fix.hook-command',
  'node': 'onboarding.fix.node',
}

// --- 設定目錄（CLAUDE_CONFIG_DIR／CODEX_HOME／XDG_CONFIG_HOME）-----------------------------------
const CONFIG_DIR_IGNORED_KEYS = {
  invalid: 'onboarding.configDir.ignored.invalid',
  not_absolute: 'onboarding.configDir.ignored.not_absolute',
  missing: 'onboarding.configDir.ignored.missing',
} as const satisfies Record<AgentConfigDirIgnoredReason, TranslationKey>

export interface ConfigDirNote {
  key: 'env' | 'ignored' | 'stale'
  text: string
  warn: boolean
}

export function buildConfigDirNotes(tool: ToolStatus): ConfigDirNote[] {
  const dir = tool.configDir
  if (!dir) return []
  const params = { variable: dir.variable, path: dir.path }
  const notes: ConfigDirNote[] = []
  // 預設位置且沒有殘留時不顯示：絕大多數使用者沒設定這些變數，不需要多一行。
  if (dir.ignored) notes.push({ key: 'ignored', text: t(CONFIG_DIR_IGNORED_KEYS[dir.ignored], params), warn: true })
  else if (dir.source === 'env') notes.push({ key: 'env', text: t('onboarding.configDir.env', params), warn: false })
  if (dir.staleLocation) notes.push({ key: 'stale', text: t('onboarding.configDir.stale', { path: dir.staleLocation }), warn: true })
  return notes
}

const SUMMARY_KEYS: Readonly<Record<string, TranslationKey>> = {
  ready: 'onboarding.summary.ready',
  needs_install: 'onboarding.summary.needs_install',
  degraded: 'onboarding.summary.degraded',
  needs_approval: 'onboarding.summary.needs_approval',
  error: 'onboarding.summary.error',
}

export function checkText(check: { id: string, status: string, code?: string, message: string }): string {
  const key = check.code ? CHECK_KEYS[check.code] : undefined
  return key ? t(key) : check.message
}

export function checkFix(check: { id: string, status: string }): string {
  const key = check.status === 'pass' ? undefined : FIX_KEYS[check.id]
  return key ? t(key) : ''
}

export function summaryText(tool: ToolStatus): string {
  const key = SUMMARY_KEYS[tool.health]
  return key ? t(key) : (tool.message ?? '')
}

const HEALTH_LABEL_KEYS: Partial<Record<ToolStatus['health'], TranslationKey>> = {
  ready: 'healthReady',
  needs_install: 'healthNeedsInstall',
  degraded: 'healthDegraded',
  needs_approval: 'healthNeedsApproval',
}

export function healthLabel(tool: ToolStatus): string {
  return t(HEALTH_LABEL_KEYS[tool.health] ?? 'healthError')
}

export interface CapabilityRow {
  id: string
  supported: boolean
  label: string
}

// Plain-language capability matrix. Permission distinguishes "answer on the pet" from "shown on the
// pet, answer in the tool" because that is the difference users actually run into.
export function capabilityRows(tool: ToolStatus): CapabilityRow[] {
  const c = tool.capabilities
  const name = tool.displayName
  const permission = c.permissions === 'respond'
    ? t('onboarding.capPermissionRespond')
    : c.permissions === 'observe'
      ? t('onboarding.capPermissionObserve', { name })
      : t('onboarding.capPermissionNone')
  return [
    { id: 'status', supported: c.lifecycle, label: t('onboarding.capStatus') },
    { id: 'tools', supported: c.toolActivity, label: t('onboarding.capTools') },
    { id: 'input', supported: c.waitingInput, label: t('onboarding.capInput') },
    { id: 'permission', supported: c.permissions !== 'none', label: permission },
    { id: 'tokens', supported: c.tokenUsage !== 'none', label: t(c.tokenUsage === 'exact' ? 'onboarding.capTokensExact' : 'onboarding.capTokensEstimated') },
    { id: 'quota', supported: c.quota !== 'none', label: t('onboarding.capQuota') },
  ]
}
