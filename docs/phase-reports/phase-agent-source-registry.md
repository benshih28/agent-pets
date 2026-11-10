# Agent 來源資料收成單一 registry

## 範圍

這次的做法比照主題色 `--ap-*` 與 1.12.3 的狀態 registry。原本散在各處、以 Agent 來源或工具家族為 key 的資料，現在集中到 `src/types/agent.ts` 的兩張表：

- `AGENT_SOURCE_REGISTRY`：key 是 `AgentSource`，欄位有 `label`、`family`、`variant`。
- `AGENT_FAMILY_REGISTRY`：key 是 `AgentFamilyKey`，欄位有 `label`、`adapterId`、`quotaProvider`、`localUsageSource`。

兩張表都用 `as const satisfies Record<…>` 檢查，並用 `freezeRegistry` 凍結。主程序與 renderer 都 import 這個檔案，它在執行期不 import 其他模組。完整清單與新增步驟見 [docs/dev/agent-sources.md](../dev/agent-sources.md)。

## 盤點

| 位置（改動前） | 用途 | 處理 |
|---|---|---|
| `src/types/agent.ts` `SOURCE_LABELS`、`SOURCE_FAMILIES`、`ALL_SOURCES` | 名稱、家族、來源清單（三份手寫） | 改成由兩張表推導 |
| `src/types/agent-adapter.ts:7-9` `*_SOURCES`；capabilities 的 `quota` | adapter 的來源與額度 | 加上 `family`，`sources` 與 `quota` 改為推導 |
| `src/types/agent-adapter.ts:29` 與 `capabilities.ts:23` | `GENERIC_HTTP_CAPABILITIES` 定義了兩份 | 只留 `capabilities.ts` 那份 |
| `electron/event-normalizer.ts:5,13` | 事件來源白名單；`EXTERNAL_ONLY` notice 的第二份副本 | 改用 `ALL_SOURCES` 加舊版別名 `opencode`；notice 改為共用 |
| `electron/notification-policy.ts:17` `SOURCE_NAMES` | 通知上的家族名稱 | 改從家族表取得 |
| `electron/ipc/integrations.ts:5,17` | 測試事件來源（`Array.includes`）、安裝目標的 `===` 鏈 | 改用 `isAgentSource`；安裝目標改用 Set |
| `electron/ipc/session-jump.ts:8` | 來源白名單 | 改用 `isAgentSource` |
| `electron/achievements.ts:64-65` | 以本機紀錄計 token 的 adapter 與來源 | 改用 `LOCAL_USAGE_*` |
| `electron/history-sessions.ts:46` | adapter → 本機紀錄的來源（歷史 session key） | 改用 `LOCAL_USAGE_SOURCE_BY_ADAPTER`，並用 `Object.hasOwn` 查表 |
| `electron/claude-permission-notice.ts:3`、`permission-adapter-server.ts:35-37`、`main/runtime.ts:3127,3167-3170` | Claude 與可回覆權限的來源；adapter port 註冊 | 改用 `familySourceSet`、`PERMISSION_ADAPTER_SOURCES` |
| `electron/plugin-event-source.ts:22` | 插件不能使用的家族名稱 | 改由來源、家族與 adapter id 推導，再加上 3 個固定名稱 |
| `electron/presentation-controller.ts:170` | 插件 `agentFamily` 的 `===` 鏈 | 改用 Set，並以泛型綁住公開契約型別 |
| `electron/agent-adapter.ts:118` | 每個事件都做 `sources.includes` | 改成比對 `familyOfSource`，O(1) |
| `electron/quota.ts:81`、`src/types/electron-api.ts:179,212`、`electron/preload.ts:510` | quota provider id 與測試來源的字面型別 | 改用 `QuotaFamilyKey`、`AgentSource` |
| `src/stores/agentStore.ts` | `isQuotaCapableSource` 的 `||` 鏈、兩處 provider 過濾、3 處 `find(...includes)`、`includes('desktop')`、`endsWith('-desktop')`、`agentFamily` 巢狀三元 | 全部改成查表或用 guard |
| `src/components/status-panel/StatusPanelSessions.vue:44,58,62` | 家族篩選、每個 session 都做 `find(...includes)`、quota 家族 | 改為查表與 `QUOTA_FAMILY_KEYS` |
| `src/components/status-panel/StatusPanelUsage.vue:33` | provider → adapter | 改從家族表取得 |
| `src/components/DesktopPet.vue:425` | `familyKey === 'claude'` 決定品牌色 | 改用 `QUOTA_FAMILY_TIER`（`satisfies Record<QuotaFamilyKey, …>`） |
| `src/utils/permission-source.ts` | 來源名稱、Claude 的「也可以在…回答」 | 先驗證再查表；後者依 `family` 與 `variant` 查表 |
| `src/utils/session-view.ts:36` | 每個 session 都做 `sources.includes` | 每次呼叫建一次 Set |

### 沒有合併的對照

以下幾項跟來源同名，但屬於不同契約：

- `host-app.ts` 的 `claude-desktop`：執行 App 的 id。
- `project-mcp-setup.ts` 的 `client`：MCP 用戶端設定的目標。
- `IntegrationTarget`／`AdapterInstallTarget`：安裝目標。
- 主題的 font family。

`SetupWizard.vue` 的 `RESTART_KEYS` 本來就是窮盡的 `Record<AgentAdapterId, …>`，維持原樣。`HistorySessions.vue` 本來就讀 adapter registry，也維持原樣。

### 留在 hook 裡的來源資料

`integrations/agent-hook.mjs`（12 處）、`integrations/install.mjs`（3 處）、`electron/setup.ts`（32 處）都還各自寫著來源字串，沒有動：

- `integrations/*.mjs` 安裝後是在 app 之外由 Node 單獨執行，不能 import `src/`。
- `setup.ts` 與 `hook-config.ts` 依這輪的分工不能修改。

因為這樣，安裝目標 `'claude'`／`'claudeCode'` 的 Set 仍然列在 `electron/ipc/integrations.ts`，並註明它對應 `setup.ts` 的 `IntegrationTarget`。

## 沒有改的值

- 來源 id、家族 key（`agent-pet-family-map` 的 key，也是 quota provider id）、`adapterId`（歷史 `adapter_id`，也是插件 `agentFamily`）、`localUsageSource`（歷史 session 摘要的 key）全部沿用原值。
- `data-quota-tier='claude'`、狀態列家族順序（Codex、Claude、OpenCode）、`PLUGIN_EVENT_SOURCE_RESERVED_FAMILIES` 的 12 個成員也都沒變。
- `tests/agent-source-registry.test.mts` 把這些值逐一固定，hook 檔案沒有修改。

## 安全與效能

- 已修正：`localUsageKeySource('constructor', …)` 原本會從原型鏈拿到 `Object` 函式，組出錯誤的 key；`permissionSourceName('constructor')` 也有同樣的問題。現在一律先用 Set 驗證或 `Object.hasOwn`。
- 已修正：其他視窗改了 `agent-pet-family-map` 時，`App.vue` 會把解析出的物件原封不動指定給 store，任何 key 和非字串的值都會進來。現在跟啟動時一樣，經過 `syncFamilyPetIds` 只收家族 key 與字串值。
- 插件保留名稱改為推導後，新增的內建來源會自動列入保留，插件不能冒充。
- 事件熱路徑：adapter 的來源檢查，以及面板每個 session 的家族查詢，都從線性搜尋改成 O(1) 查表。

## 驗證

- `pnpm install --frozen-lockfile --offline`：通過，node_modules 是實體目錄，不是 symlink。
- `pnpm exec vue-tsc --noEmit`：通過。
- `pnpm run lint`：通過。
- `pnpm run check:design:strict`：通過。`unused` 為 1，屬既有狀態；`rawColors` 為 0。
- `pnpm exec vite build`：通過。
- `pnpm run test:unit`：見本線 commit 前最後一次執行（下方「最後結果」）。新增的 `tests/agent-source-registry.test.mts` 有 9 個測試，涵蓋窮盡、契約值、推導關係、主程序白名單、通知名稱、normalizer、原型鏈名稱與凍結。`tests/status-line-fit.test.mts` 改為也接受查表回傳的 tier。`docs/security/ipc-inventory.md` 已重新產生。
- 隔離 Electron 實機（`scripts/e2e-isolated-electron.mjs`，假 safeStorage、暫時 HOME）：
  - 27373 已被另一條線的測試 app 佔用，本 app 的事件埠一直在等待。我先送出的 5 個 HTTP 事件被對方以 401 拒絕，沒有任何效果。
  - 因此改用 CDP 直接呼叫 renderer 的 `store.handleEvent`。主程序 normalizer 的部分由單元測試涵蓋。
  - 送入 5 個來源後：
    - 狀態列 3 行，依 Codex、Claude、OpenCode 排序，CLI／Desktop 標示正確。
    - `currentFamilyKey` 為 `claude`。
    - quota 家族為 codex、claude，`data-quota-tier` 分別是 `normal`、`claude`。
    - 權限提示顯示 `Claude`／desktop。
    - 插件 `agentFamily` 為 `codex`、`claude-code`、`opencode`。
    - `syncFamilyPetIds` 丟掉了 `bogus` key 與數字值。

### 最後結果

test:unit 1247 個：1246 通過、1 略過、0 失敗。改動前的基準是 1238 個：1237 通過、1 略過。

## 殘餘風險

- 只在 macOS 驗證，Windows／Linux 沒有實測。
- 真實 hook → 事件埠 → 畫面這條路徑，這次沒有在 Electron 裡跑，原因是 27373 被占用。來源白名單的行為由單元測試涵蓋。
- hook 檔案裡的來源字串仍然要人工同步，檢查清單在 `docs/dev/agent-sources.md`。

## 版本

依指示不升版，1.12.5 由整合線統一處理。這次沒有改公開契約的值，也沒有改持久化格式；建議用 patch。
