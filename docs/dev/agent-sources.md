# Agent 來源 registry

以 Agent 來源（`AgentSource`）或工具家族（`AgentFamilyKey`）為 key 的資料都寫在 `src/types/agent.ts` 的兩張表裡。兩張表都用 `as const satisfies Record<…>` 檢查，少一格或多一格都會編譯失敗，並以 `deepFreeze`（`src/types/freeze.ts`） 凍結。主行程與 renderer 都 import 這個檔案；它在執行期不 import 任何其他模組。

| 表 | key | 欄位 |
|---|---|---|
| `AGENT_SOURCE_REGISTRY` | `AgentSource`（6 個） | `label`（面板上的完整名稱，不翻譯）、`family`、`variant`（`cli`／`desktop`） |
| `AGENT_FAMILY_REGISTRY` | `AgentFamilyKey`（`codex`、`claude`、`opencode`） | `label`（狀態列、篩選器、通知）、`adapterId`、`quotaProvider`、`localUsageSource` |

家族表的列順序就是狀態列與設定頁的家族順序。

## 由這兩張表推導的值

- `src/types/agent.ts`：`ALL_SOURCES`、`AGENT_FAMILY_KEYS`、`SOURCE_LABELS`、`FAMILY_SOURCES`、`SOURCE_FAMILIES`、`QUOTA_FAMILY_KEYS`（型別 `QuotaFamilyKey`）、`FAMILY_ADAPTER_IDS`（型別 `AgentFamilyAdapterId`）、`LOCAL_USAGE_SOURCE_BY_ADAPTER`、`LOCAL_USAGE_ADAPTER_IDS`、`LOCAL_USAGE_SOURCES`、`SourceOfFamily<F>`。驗證函式：`isAgentSource`、`isAgentFamilyKey`、`isQuotaFamilyKey`、`familyOfSource`、`isDesktopSource`、`isQuotaCapableSource`、`familySourceSet`。這些驗證都用 Set 查，`constructor` 這類原型鏈上的名稱不會被當成合法值。
- `src/types/agent-adapter.ts`：每個 adapter 的 `family`、`sources`、`sourceLabels`，以及 `capabilities.quota`。
- 主行程：事件來源白名單（`event-normalizer.ts`，另外接受舊版 OpenCode 插件送的 `opencode`）、測試事件 IPC 與跳回 session IPC 的來源檢查、權限來源（`permission-adapter-server.ts` 的 `PERMISSION_ADAPTER_SOURCES`）、Claude 權限來源（`claude-permission-notice.ts`、`main/runtime.ts`）、通知標題上的名稱、本機紀錄 token 的 adapter 與來源（`achievements.ts`、`history-sessions.ts`）、插件不能使用的家族名稱（`plugin-event-source.ts`）、插件 `agentFamily` 的檢查（`presentation-controller.ts`），以及 quota provider id 的型別。
- renderer：狀態列分行與 CLI／Desktop 標示、每家族的寵物、quota 條與 provider 過濾、面板的家族篩選、權限提示上的名稱、用量頁 quota 卡片與 5 小時區塊的對應。

## 值不能改名

這些字串都已經寫進使用者的資料或插件契約。改名之前要先有遷移方案：

- 來源 id：存在歷史資料庫的事件與 session 裡，hook 也會送這些值。
- 家族 key：`localStorage` 的 `agent-pet-family-map` 用它當 key，也是主行程 quota 的 provider id。
- `adapterId`：歷史資料庫的 `adapter_id`，也是插件 `agentFamily` 的值（`src/types/plugin.ts`、`src/types/presentation.ts`）。
- `localUsageSource`：歷史 session 的摘要 key `adapter:agent:rawSessionId` 裡的 `agent`。

`tests/agent-source-registry.test.mts` 把上面每個值都固定住；改到任何一格，測試就會失敗。

## 新增一個來源或家族

1. 在 `AgentSource`（或 `AgentFamilyKey`）的 union 加上新值，再到表裡補一列。漏填的話型別檢查會失敗。
2. 新家族要在 `AGENT_ADAPTER_REGISTRY` 加一個 adapter。`family` 指向新家族；`sources` 由家族推導，不要手寫。
3. 下列地方會因型別檢查失敗而提醒你補上：
   - `src/components/SetupWizard.vue` 的 `RESTART_KEYS`
   - 家族有訂閱額度時，`src/components/DesktopPet.vue` 的 `QUOTA_FAMILY_TIER`
   - `electron/presentation-controller.ts`：插件 `agentFamily` 的字面型別要先擴充，這裡才會編譯通過。擴充那個型別等於改了公開契約，要同步更新 `docs/plugins/`。
4. hook 這一側要另外改，它們不讀 registry：`integrations/agent-hook.mjs`、`integrations/install.mjs`、`electron/setup.ts`（含 `IntegrationTarget`）、`electron/hook-config.ts`。`integrations/*.mjs` 安裝後是在 app 之外由 Node 單獨執行，不能 import `src/`；`setup.ts` 與 `hook-config.ts` 負責寫入使用者的設定檔，這一輪由 hook 強化線負責，所以沒有改成讀 registry。
5. 更新 `tests/agent-source-registry.test.mts` 裡固定的值。

## 刻意沒有併進來的對照

這些只是剛好跟來源同名，其實是另一份契約：

- `src/types/host-app.ts` 的 `claude-desktop`：session 執行所在的 App（終端機、IDE、桌面 App），不是事件來源。
- `electron/project-mcp-setup.ts` 的 `client: 'claude' | 'opencode'`：要寫入哪一個 MCP 用戶端的設定檔。
- `IntegrationTarget` 與 `AdapterInstallTarget`（`claudeCode`，以及舊版面板送的 `claude`）：安裝目標，定義在 hook 檔案 `electron/setup.ts`。
- `src/utils/permission-source.ts`：「也可以在終端機或 App 裡回答」這兩句只適用於 Claude，所以依 `family === 'claude'` 加上 `variant` 查表，沒有新增 registry 欄位。
- 主題的 font family 與 `plugin-theme-*` 裡的 `Family`：字型，跟 Agent 無關。
