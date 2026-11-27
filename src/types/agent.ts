import type { PermissionNotice } from './capabilities'
import type { AgentAdapterId } from './agent-adapter'
import type { AgentHost } from './host-app'
import { deepFreeze } from './freeze.ts'

export type AgentSource =
  | 'opencode-cli'
  | 'opencode-desktop'
  | 'codex'
  | 'codex-desktop'
  | 'claude'
  | 'claude-desktop'

export type AgentState =
  | 'offline'
  | 'idle'
  | 'thinking'
  | 'tool-running'
  | 'waiting-permission'
  | 'waiting-input'
  | 'success'
  | 'error'

export interface AgentTokenUsage {
  input?: number
  output?: number
  quality: 'estimated' | 'exact'
}

export interface AgentStatusEvent {
  adapterId?: AgentAdapterId
  source: AgentSource
  sessionId: string
  project?: string
  /** 專案指紋，絕不是原始路徑。 */
  projectId?: string
  routedPetId?: string
  state: AgentState
  originalEvent?: string
  timestamp: number
  eventId?: string
  sourceEventId?: string
  toolName?: string
  tokenUsage?: AgentTokenUsage
  permissionNotice?: PermissionNotice
  /** 只允許白名單 id。 */
  host?: AgentHost
}

export interface AgentSession {
  key: string
  source: AgentSource
  sessionId: string
  project?: string
  projectId?: string
  routedPetId?: string
  state: AgentState
  lastSeenAt: number
  /** 排序同分時的穩定 tie-break。 */
  firstSeenAt?: number
  /** 只在狀態真的改變時更新；心跳不動它，寵物才不會在 session 間來回跳。 */
  stateChangedAt?: number
  toolName?: string
  permissionNotice?: PermissionNotice
  host?: AgentHost
}

// 主程序也要用，不能匯入 Vue 或 i18n runtime。

/** keep 代表沿用上一輪的結果（idle 不改變結局）。 */
export type AgentStateHistoryOutcome = 'success' | 'error' | 'cancelled' | 'open' | 'keep'

/** agent 不保證送結束事件，每個狀態都要有期限；到期只改顯示，下一個真實事件直接蓋過。 */
export interface AgentStateQuietRule {
  /** 從最後一個真實事件算起，連續降級不會重新計時。 */
  readonly afterMs: number
  readonly to: AgentState | 'remove'
  /** 權限中介還有未回覆的請求時不到期：是人在處理，不是 agent 不見了。 */
  readonly heldByPendingPermission?: true
}

/** 寵物本體跟隨哪個 session 的分層：attention 一定優先、recent 依最近狀態轉換、background 不搶焦點。 */
export type AgentPetFocus = 'attention' | 'recent' | 'background'

export interface AgentStatePolicy {
  /** 數字越大越優先。 */
  readonly priority: number
  readonly petFocus: AgentPetFocus
  readonly quiet: AgentStateQuietRule
  /** terminal 會彙整成一則且點了不切換 App；非 terminal 帶上 session 讓點擊跳回去。 */
  readonly notification: { readonly terminal: boolean } | null
  readonly historyOutcome: AgentStateHistoryOutcome
}

const MINUTE_MS = 60_000
const GONE_AFTER_MS = 15 * MINUTE_MS

export const AGENT_STATE_POLICY = deepFreeze({
  offline: { priority: 0, petFocus: 'background', notification: null, historyOutcome: 'cancelled', quiet: { afterMs: 45 * MINUTE_MS, to: 'remove' } },
  idle: { priority: 20, petFocus: 'background', notification: null, historyOutcome: 'keep', quiet: { afterMs: GONE_AFTER_MS, to: 'offline' } },
  // 思考間隔 99.9% 短於 2.3 分鐘；超過 5 分鐘多半是漏了結束事件。
  thinking: { priority: 70, petFocus: 'recent', notification: null, historyOutcome: 'open', quiet: { afterMs: 5 * MINUTE_MS, to: 'idle' } },
  // 工具合法地跑很久，不靠時間提早判斷；中斷由主程序讀對話紀錄檔處理。
  'tool-running': { priority: 80, petFocus: 'recent', notification: null, historyOutcome: 'open', quiet: { afterMs: GONE_AFTER_MS, to: 'offline' } },
  'waiting-permission': {
    priority: 100, petFocus: 'attention', notification: { terminal: false }, historyOutcome: 'open',
    quiet: { afterMs: GONE_AFTER_MS, to: 'offline', heldByPendingPermission: true },
  },
  'waiting-input': { priority: 85, petFocus: 'attention', notification: { terminal: false }, historyOutcome: 'open', quiet: { afterMs: GONE_AFTER_MS, to: 'offline' } },
  // src/utils/pet-motion-plan.ts 的慶祝動作長度跟著這個值算。
  success: { priority: 60, petFocus: 'recent', notification: { terminal: true }, historyOutcome: 'success', quiet: { afterMs: 4_000, to: 'idle' } },
  error: { priority: 90, petFocus: 'attention', notification: { terminal: true }, historyOutcome: 'error', quiet: { afterMs: GONE_AFTER_MS, to: 'offline' } },
} as const satisfies Record<AgentState, AgentStatePolicy>)

export const AGENT_STATES: readonly AgentState[] = Object.freeze(Object.keys(AGENT_STATE_POLICY) as AgentState[])

// 用 Set 而不是 `in`：避免 'constructor' 等原型鏈名稱被當成狀態。
const AGENT_STATE_SET: ReadonlySet<string> = new Set(AGENT_STATES)

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && AGENT_STATE_SET.has(value)
}

export type NotifiableAgentState = {
  [K in AgentState]: (typeof AGENT_STATE_POLICY)[K]['notification'] extends null ? never : K
}[AgentState]

export const STATE_PRIORITY: Readonly<Record<AgentState, number>> = Object.freeze(Object.fromEntries(
  AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].priority]),
) as Record<AgentState, number>)

// 表裡的字串是外部契約：來源 id 存在歷史資料庫、家族 key 存在 localStorage 且是 quota 的 provider id、
// adapterId 是插件 agentFamily 的值，改名會讓舊資料對不上。

export type AgentFamilyKey = 'codex' | 'claude' | 'opencode'

export interface AgentFamilyDefinition {
  readonly label: string
  readonly adapterId: AgentAdapterId
  readonly quotaProvider: boolean
  /** 歷史資料庫的 session 摘要用它組 key，值不能改。 */
  readonly localUsageSource: AgentSource | null
}

// 列的順序就是狀態列與設定頁的家族順序。
export const AGENT_FAMILY_REGISTRY = deepFreeze({
  codex: { label: 'Codex', adapterId: 'codex', quotaProvider: true, localUsageSource: 'codex' },
  claude: { label: 'Claude', adapterId: 'claude-code', quotaProvider: true, localUsageSource: 'claude' },
  opencode: { label: 'OpenCode', adapterId: 'opencode', quotaProvider: false, localUsageSource: null },
} as const satisfies Record<AgentFamilyKey, AgentFamilyDefinition>)

export interface AgentSourceDefinition {
  /** 產品名，刻意不翻譯。 */
  readonly label: string
  readonly family: AgentFamilyKey
  readonly variant: 'cli' | 'desktop'
}

export const AGENT_SOURCE_REGISTRY = deepFreeze({
  'opencode-cli': { label: 'OpenCode CLI', family: 'opencode', variant: 'cli' },
  'opencode-desktop': { label: 'OpenCode Desktop', family: 'opencode', variant: 'desktop' },
  codex: { label: 'Codex CLI', family: 'codex', variant: 'cli' },
  'codex-desktop': { label: 'Codex Desktop', family: 'codex', variant: 'desktop' },
  claude: { label: 'Claude CLI', family: 'claude', variant: 'cli' },
  'claude-desktop': { label: 'Claude Desktop', family: 'claude', variant: 'desktop' },
} as const satisfies Record<AgentSource, AgentSourceDefinition>)

export const ALL_SOURCES: readonly AgentSource[] = Object.freeze(Object.keys(AGENT_SOURCE_REGISTRY) as AgentSource[])
export const AGENT_FAMILY_KEYS: readonly AgentFamilyKey[] = Object.freeze(Object.keys(AGENT_FAMILY_REGISTRY) as AgentFamilyKey[])

const AGENT_SOURCE_SET: ReadonlySet<string> = new Set(ALL_SOURCES)
const AGENT_FAMILY_SET: ReadonlySet<string> = new Set(AGENT_FAMILY_KEYS)

export function isAgentSource(value: unknown): value is AgentSource {
  return typeof value === 'string' && AGENT_SOURCE_SET.has(value)
}

export function isAgentFamilyKey(value: unknown): value is AgentFamilyKey {
  return typeof value === 'string' && AGENT_FAMILY_SET.has(value)
}

export const SOURCE_LABELS: Readonly<Record<AgentSource, string>> = Object.freeze(Object.fromEntries(
  ALL_SOURCES.map(source => [source, AGENT_SOURCE_REGISTRY[source].label]),
) as Record<AgentSource, string>)

export type SourceOfFamily<F extends AgentFamilyKey> = {
  [S in AgentSource]: (typeof AGENT_SOURCE_REGISTRY)[S]['family'] extends F ? S : never
}[AgentSource]

export const FAMILY_SOURCES: { readonly [F in AgentFamilyKey]: readonly SourceOfFamily<F>[] } = Object.freeze(Object.fromEntries(
  AGENT_FAMILY_KEYS.map(family => [
    family,
    Object.freeze(ALL_SOURCES.filter(source => AGENT_SOURCE_REGISTRY[source].family === family)),
  ]),
) as unknown as { readonly [F in AgentFamilyKey]: readonly SourceOfFamily<F>[] })

export interface SourceFamily {
  readonly key: AgentFamilyKey
  readonly label: string
  readonly sources: readonly AgentSource[]
}

export const SOURCE_FAMILIES: readonly SourceFamily[] = Object.freeze(AGENT_FAMILY_KEYS.map(key => Object.freeze({
  key,
  label: AGENT_FAMILY_REGISTRY[key].label,
  sources: FAMILY_SOURCES[key],
})))

export type QuotaFamilyKey = {
  [K in AgentFamilyKey]: (typeof AGENT_FAMILY_REGISTRY)[K]['quotaProvider'] extends true ? K : never
}[AgentFamilyKey]

export const QUOTA_FAMILY_KEYS: readonly QuotaFamilyKey[] = Object.freeze(
  AGENT_FAMILY_KEYS.filter(family => AGENT_FAMILY_REGISTRY[family].quotaProvider) as QuotaFamilyKey[],
)
const QUOTA_FAMILY_SET: ReadonlySet<string> = new Set(QUOTA_FAMILY_KEYS)

export function isQuotaFamilyKey(value: unknown): value is QuotaFamilyKey {
  return typeof value === 'string' && QUOTA_FAMILY_SET.has(value)
}

/** 不在 registry 時為 null，讓意外的來源只被略過，不會讓 computed 丟錯。 */
export function familyOfSource(source: string): AgentFamilyKey | null {
  return isAgentSource(source) ? AGENT_SOURCE_REGISTRY[source].family : null
}

export function isDesktopSource(source: string): boolean {
  return isAgentSource(source) && AGENT_SOURCE_REGISTRY[source].variant === 'desktop'
}

export function isQuotaCapableSource(source: string): boolean {
  const family = familyOfSource(source)
  return family !== null && AGENT_FAMILY_REGISTRY[family].quotaProvider
}

export function familySourceSet<F extends AgentFamilyKey>(...families: F[]): ReadonlySet<string> {
  return new Set<string>(families.flatMap(family => FAMILY_SOURCES[family]))
}

export type AgentFamilyAdapterId = (typeof AGENT_FAMILY_REGISTRY)[AgentFamilyKey]['adapterId']

export const FAMILY_ADAPTER_IDS: readonly AgentFamilyAdapterId[] = Object.freeze(
  AGENT_FAMILY_KEYS.map(family => AGENT_FAMILY_REGISTRY[family].adapterId),
)

const LOCAL_USAGE_FAMILIES = AGENT_FAMILY_KEYS.filter(family => AGENT_FAMILY_REGISTRY[family].localUsageSource !== null)

/** 歷史 session 摘要的 key 用到，值不能改。 */
export const LOCAL_USAGE_SOURCE_BY_ADAPTER: Readonly<Partial<Record<AgentAdapterId, AgentSource>>> = Object.freeze(Object.fromEntries(
  LOCAL_USAGE_FAMILIES.map(family => [AGENT_FAMILY_REGISTRY[family].adapterId, AGENT_FAMILY_REGISTRY[family].localUsageSource]),
))
/** token 以本機紀錄為準；這些 adapter 的即時事件 token 不重複計入。 */
export const LOCAL_USAGE_ADAPTER_IDS: ReadonlySet<string> = new Set(Object.keys(LOCAL_USAGE_SOURCE_BY_ADAPTER))
/** 以事件來源判斷，因為舊事件沒有 adapterId。 */
export const LOCAL_USAGE_SOURCES: ReadonlySet<string> = new Set(LOCAL_USAGE_FAMILIES.flatMap(family => FAMILY_SOURCES[family]))
