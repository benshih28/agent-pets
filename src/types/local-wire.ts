// --- 本機通訊契約（主程序、setup.ts、OpenCode plugin 模板共用） -----------------------
// hook 與 OpenCode plugin 已經部署在使用者電腦上，會一直用這裡的值連線；任何一個字串
// 改掉，舊版 hook 就會靜默送不到。integrations/*.mjs 由 Node 單獨執行、不能 import 這個檔，
// 它們的字面值由 tests/local-wire-contract.test.mts 逐一比對。
// 主程序、renderer 與 Node 測試都會直接載入這個檔，所以它不 import 任何模組。

export const LOCAL_WIRE_HOST = '127.0.0.1'

/** 三個 loopback server；與 src/types/reliability.ts 的 LocalServerId 同一組 key。 */
export const DEFAULT_LOCAL_PORTS = Object.freeze({
  event: 17_373,
  permission: 17_374,
  presentation: 17_375,
} as const)

/** 只有非 packaged build 會讀的覆寫變數（electron/main/ports.ts）；presentation-mcp.mjs 也讀第三個。 */
export const LOCAL_PORT_ENV = Object.freeze({
  event: 'AGENT_PETS_EVENT_PORT',
  permission: 'AGENT_PETS_PERMISSION_PORT',
  presentation: 'AGENT_PETS_PRESENTATION_PORT',
} as const satisfies Record<keyof typeof DEFAULT_LOCAL_PORTS, string>)

/** 家目錄下的部署目錄：hook 腳本、token、標記檔與自訂寵物都在這裡。 */
export const DEPLOY_DIR_NAME = '.desktop-pet'

/** 部署目錄內 hook／plugin／MCP 腳本會讀的檔名。 */
export const DEPLOY_FILES = Object.freeze({
  eventToken: 'event-token',
  permissionToken: 'permission-token',
  presentationToken: 'presentation-token',
  /** 使用者開啟「從寵物回答 Claude Code 權限」時才存在；hook 看到才會等寵物的決定。 */
  claudePermissionRespond: 'claude-permission-respond',
  hookScript: 'agent-hook.mjs',
  hookWrapper: 'agent-hook.cmd',
  presentationMcpScript: 'presentation-mcp.mjs',
} as const)

// Node 收到的 header 名稱一律是小寫，server 端用這裡的值查 request.headers。
export const LOCAL_WIRE_HEADERS = Object.freeze({
  eventToken: 'x-agent-pets-token',
  permissionToken: 'x-agent-pets-permission-token',
  presentationToken: 'x-agent-pets-presentation-token',
  presentationClient: 'x-agent-pets-client',
  /** 不帶 token 也會回的 header，讓第二個實例認出佔用埠的是 Agent Pets。 */
  server: 'x-agent-pets-server',
} as const)

const PERMISSION_PREFIX = '/v1/permission'
const PRESENTATION_PREFIX = '/v1/presentation'

export const LOCAL_WIRE_PATHS = Object.freeze({
  events: '/v1/events',
  /** agent-hook.mjs 以 `${prefix}/${route}` 組出下面五個路徑。 */
  permissionPrefix: PERMISSION_PREFIX,
  permissionRequest: `${PERMISSION_PREFIX}/request`,
  permissionDecision: `${PERMISSION_PREFIX}/decision`,
  permissionResult: `${PERMISSION_PREFIX}/result`,
  permissionResolved: `${PERMISSION_PREFIX}/resolved`,
  permissionResolvedSession: `${PERMISSION_PREFIX}/resolved-session`,
  presentationStatus: `${PRESENTATION_PREFIX}/status`,
  presentationIntents: `${PRESENTATION_PREFIX}/intents`,
  presentationDisconnect: `${PRESENTATION_PREFIX}/disconnect`,
} as const)
