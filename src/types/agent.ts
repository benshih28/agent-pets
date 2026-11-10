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
  /** 主程序算出的標準專案指紋；絕不是原始路徑。 */
  projectId?: string
  /** 主程序的路由結果；沒有時沿用舊版「用目前選擇的寵物」行為。 */
  routedPetId?: string
  state: AgentState
  originalEvent?: string
  timestamp: number
  eventId?: string
  sourceEventId?: string
  toolName?: string
  tokenUsage?: AgentTokenUsage
  permissionNotice?: PermissionNotice
  /** session 執行所在的終端機／IDE／桌面 App（只允許白名單 id）。 */
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
  /** 第一次看到這個 session 的時間；「誰在找你」排序時穩定的同分判斷。 */
  firstSeenAt?: number
  toolName?: string
  permissionNotice?: PermissionNotice
  host?: AgentHost
}

// --- 狀態 registry（主程序與 renderer 共用的策略） --------------------------------
// 每個 AgentState 的策略只寫在這一張表；satisfies 讓新增狀態時漏填任何一格都編譯失敗。
// 畫面呈現（標籤、顏色、aria、迷你徽章、音效）在 src/utils/agent-state-presentation.ts，
// 這裡只放主程序也要用的純資料，不能匯入 Vue 或 i18n runtime。

/** sessions.final_state 的目標值；keep 代表沿用上一輪的結果（idle 不改變結局）。 */
export type AgentStateHistoryOutcome = 'success' | 'error' | 'cancelled' | 'open' | 'keep'

export interface AgentStatePolicy {
  /** 多個 session 同時存在時，誰代表寵物的整體狀態；數字越大越優先。 */
  readonly priority: number
  /**
   * 桌面通知；null 表示不通知。terminal 是結束類通知：會彙整成一則，點了也不切換 App；
   * 非 terminal 是在等使用者，通知會帶上 session 讓點擊能跳回去。
   */
  readonly notification: { readonly terminal: boolean } | null
  readonly historyOutcome: AgentStateHistoryOutcome
}

export const AGENT_STATE_POLICY = deepFreeze({
  offline: { priority: 0, notification: null, historyOutcome: 'cancelled' },
  idle: { priority: 20, notification: null, historyOutcome: 'keep' },
  thinking: { priority: 70, notification: null, historyOutcome: 'open' },
  'tool-running': { priority: 80, notification: null, historyOutcome: 'open' },
  'waiting-permission': { priority: 100, notification: { terminal: false }, historyOutcome: 'open' },
  'waiting-input': { priority: 85, notification: { terminal: false }, historyOutcome: 'open' },
  success: { priority: 60, notification: { terminal: true }, historyOutcome: 'success' },
  error: { priority: 90, notification: { terminal: true }, historyOutcome: 'error' },
} as const satisfies Record<AgentState, AgentStatePolicy>)

export const AGENT_STATES: readonly AgentState[] = Object.freeze(Object.keys(AGENT_STATE_POLICY) as AgentState[])

// 用 Set 而不是 `in`：'constructor' 之類原型鏈上的名稱不會被當成狀態；每個事件都會查，建一次重複用。
const AGENT_STATE_SET: ReadonlySet<string> = new Set(AGENT_STATES)

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && AGENT_STATE_SET.has(value)
}

/** 會發桌面通知的狀態，由上表推導，主程序的通知標題表用它強制窮盡。 */
export type NotifiableAgentState = {
  [K in AgentState]: (typeof AGENT_STATE_POLICY)[K]['notification'] extends null ? never : K
}[AgentState]

export const STATE_PRIORITY: Readonly<Record<AgentState, number>> = Object.freeze(Object.fromEntries(
  AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].priority]),
) as Record<AgentState, number>)

// --- 來源 registry（主程序與 renderer 共用） ---------------------------------------
// 每個 AgentSource 與工具家族的資料只寫在下面兩張表；satisfies 讓新增來源或家族時漏填任何一格都編譯失敗。
// 表裡的字串都是外部契約：來源 id 存在歷史資料庫、家族 key 存在 localStorage（familyPetIds）
// 且是 quota 的 provider id、adapterId 是插件 agentFamily 的值，改名會讓舊資料對不上。

/** 同一個工具的 CLI 與 Desktop 版本合併成一個家族：狀態列一行、每家族一隻寵物、一個 quota。 */
export type AgentFamilyKey = 'codex' | 'claude' | 'opencode'

export interface AgentFamilyDefinition {
  /** 狀態列、篩選器與桌面通知用的家族名稱。 */
  readonly label: string
  /** 這個家族的 adapter；也是插件 agentFamily 與歷史 adapter_id 的值。 */
  readonly adapterId: AgentAdapterId
  /** 服務商有訂閱額度：主程序 quota 的 provider id 就是家族 key。 */
  readonly quotaProvider: boolean
  /**
   * 本機紀錄讀取器（electron/local-usage.ts）把 token 記在哪個來源名下；null 表示沒有本機紀錄。
   * 歷史資料庫的 session 摘要用它組 key，值不能改。
   */
  readonly localUsageSource: AgentSource | null
}

// 列的順序就是狀態列與設定頁的家族順序。
export const AGENT_FAMILY_REGISTRY = deepFreeze({
  codex: { label: 'Codex', adapterId: 'codex', quotaProvider: true, localUsageSource: 'codex' },
  claude: { label: 'Claude', adapterId: 'claude-code', quotaProvider: true, localUsageSource: 'claude' },
  opencode: { label: 'OpenCode', adapterId: 'opencode', quotaProvider: false, localUsageSource: null },
} as const satisfies Record<AgentFamilyKey, AgentFamilyDefinition>)

export interface AgentSourceDefinition {
  /** 面板與 toast 上的完整來源名稱；刻意不翻譯，是工具的產品名。 */
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

// 跟 AGENT_STATE_SET 同理：Set 擋掉原型鏈上的名稱，事件與 IPC 的驗證是 O(1)。
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

/** 屬於某些家族的來源，由上表推導（例如主程序的權限來源白名單）。 */
export type SourceOfFamily<F extends AgentFamilyKey> = {
  [S in AgentSource]: (typeof AGENT_SOURCE_REGISTRY)[S]['family'] extends F ? S : never
}[AgentSource]

/** 每個家族的來源，順序同 ALL_SOURCES。 */
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

// 同一個工具的 CLI 與 Desktop 版本合併成狀態列上的同一行；順序同 AGENT_FAMILY_REGISTRY。
export const SOURCE_FAMILIES: readonly SourceFamily[] = Object.freeze(AGENT_FAMILY_KEYS.map(key => Object.freeze({
  key,
  label: AGENT_FAMILY_REGISTRY[key].label,
  sources: FAMILY_SOURCES[key],
})))

/** 有訂閱額度的家族，由上表推導；主程序 quota 的 provider id 用它限定。 */
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

/**
 * 來源所屬的家族；不在 registry 裡時是 null。renderer 收到的來源已由主程序驗證，
 * 仍經過這裡查表，讓一筆意外的來源只會被略過，不會讓整個 computed 丟錯。
 */
export function familyOfSource(source: string): AgentFamilyKey | null {
  return isAgentSource(source) ? AGENT_SOURCE_REGISTRY[source].family : null
}

export function isDesktopSource(source: string): boolean {
  return isAgentSource(source) && AGENT_SOURCE_REGISTRY[source].variant === 'desktop'
}

/** 這個來源的工具有訂閱額度：只有這些 session 值得輪詢或刷新 quota。 */
export function isQuotaCapableSource(source: string): boolean {
  const family = familyOfSource(source)
  return family !== null && AGENT_FAMILY_REGISTRY[family].quotaProvider
}

/** 某些家族所有來源的 Set，給主程序的白名單用（例如 Claude 的權限來源）；建一次重複用。 */
export function familySourceSet<F extends AgentFamilyKey>(...families: F[]): ReadonlySet<string> {
  return new Set<string>(families.flatMap(family => FAMILY_SOURCES[family]))
}

/** 有家族的 adapter（插件 agentFamily 的合法值）。 */
export type AgentFamilyAdapterId = (typeof AGENT_FAMILY_REGISTRY)[AgentFamilyKey]['adapterId']

export const FAMILY_ADAPTER_IDS: readonly AgentFamilyAdapterId[] = Object.freeze(
  AGENT_FAMILY_KEYS.map(family => AGENT_FAMILY_REGISTRY[family].adapterId),
)

// --- 本機紀錄 token（local-usage）由家族表推導 -------------------------------------
const LOCAL_USAGE_FAMILIES = AGENT_FAMILY_KEYS.filter(family => AGENT_FAMILY_REGISTRY[family].localUsageSource !== null)

/** adapter id → 本機紀錄讀取器記帳用的來源；歷史 session 摘要的 key 用到，值不能改。 */
export const LOCAL_USAGE_SOURCE_BY_ADAPTER: Readonly<Partial<Record<AgentAdapterId, AgentSource>>> = Object.freeze(Object.fromEntries(
  LOCAL_USAGE_FAMILIES.map(family => [AGENT_FAMILY_REGISTRY[family].adapterId, AGENT_FAMILY_REGISTRY[family].localUsageSource]),
))
/** token 以本機紀錄為準的 adapter；它們的即時事件 token 不重複計入。 */
export const LOCAL_USAGE_ADAPTER_IDS: ReadonlySet<string> = new Set(Object.keys(LOCAL_USAGE_SOURCE_BY_ADAPTER))
/** 同上，以事件來源判斷（舊事件沒有 adapterId）。 */
export const LOCAL_USAGE_SOURCES: ReadonlySet<string> = new Set(LOCAL_USAGE_FAMILIES.flatMap(family => FAMILY_SOURCES[family]))
