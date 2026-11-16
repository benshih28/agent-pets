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
- renderer：狀態列分行與 CLI／Desktop 標示、每家族的寵物、quota 條與 provider 過濾、面板的家族篩選、權限提示上的名稱、用量頁 quota 卡片與 5 小時區塊的對應、History 的 agent 名稱（`src/utils/agent-label.ts`：adapter id 經 `AGENT_ADAPTER_REGISTRY` 對到家族，再查既有的 i18n key；沒有家族的 `generic-http` 與未知 id 原樣顯示）。

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
   - `src/components/setup-wizard/setup-wizard-text.ts` 的 `RESTART_KEYS`
   - 家族有訂閱額度時，`src/composables/usePetStatusLines.ts` 的 `QUOTA_FAMILY_TIER`
   - `electron/presentation-controller.ts`：插件 `agentFamily` 的字面型別要先擴充，這裡才會編譯通過。擴充那個型別等於改了公開契約，要同步更新 `docs/plugins/`。
4. hook 這一側要另外改，它們不讀 registry（使用者層設定目錄的位置與環境變數則集中在 `electron/agent-config-dirs.ts` 的 `AGENT_CONFIG_DIR_SPECS`，新家族若有可搬移的設定目錄要加在那裡）：
   - `integrations/agent-hook.mjs` 的 `validSources`：新家族若走這支 hook，把它的來源加進去。`integrations/*.mjs` 安裝後是在 app 之外由 Node 單獨執行，不能 import `src/`，所以保留字面值；`tests/agent-source-registry.test.mts` 要求 `validSources` 正好等於經過 hook 的家族（目前是 Codex 與 Claude）在 registry 裡的來源，漏加或多加都會失敗，新家族走 hook 時也要更新那個測試裡的家族清單。
   - `integrations/install.mjs`、`electron/setup.ts`（含 `IntegrationTarget`）、`electron/hook-config.ts`：負責寫入使用者的設定檔，這一輪由 hook 強化線負責，沒有改成讀 registry。
   - 連線用的 port、`~/.desktop-pet` 與 token 檔名、header、`/v1/...` 路徑不用另外改：它們只寫在 `src/types/local-wire.ts`，`setup.ts` 的 OpenCode plugin 模板以插值取用，hook 與 presentation MCP 腳本的字面值由 `tests/local-wire-contract.test.mts` 比對。
5. 更新 `tests/agent-source-registry.test.mts` 裡固定的值。
6. 在 `electron/transcript-turn-end.ts` 的 `TRANSCRIPT_FORMATS` 填上新家族（漏填會編譯失敗）：agent 會在本機寫對話紀錄檔、而且能從結尾看出回合已結束或被中斷時，提供「怎麼找檔案」與「怎麼判讀一筆紀錄」；沒有就填 `null`。agent 不保證會送結束事件，填了這一格，中斷後才能在幾秒內回到閒置，否則只能等狀態期限（`AGENT_STATE_POLICY` 的 `quiet`）。

## hook 與 plugin 的手動同步字面值

`integrations/*.mjs` 與 `setup.ts` 裡的 OpenCode plugin 模板安裝後在 app 之外執行，不能 import TS，所以下列值是手寫的，各由一個測試比對原始碼文字（不在 vm 裡執行：`agent-hook.mjs` 一載入就會 `main()` 並結束程序）。新增或改名時，測試失敗就是同步提醒。

| 字面值 | 來源 | 守護測試 |
|---|---|---|
| `validSources` | `AGENT_SOURCE_REGISTRY`（Codex＋Claude 家族） | `agent-source-registry.test.mts` |
| 預設來源 `codex`、`claude-desktop` 對應、plugin 的 `SOURCE` | `AGENT_SOURCE_REGISTRY`、`FAMILY_SOURCES` | `hook-literal-contract.test.mts` |
| `mapClaudeEvent`／`mapCodexEvent`／plugin `setState` 回傳的狀態 | `AGENT_STATES`（並要求每個狀態都有路徑送出） | `hook-literal-contract.test.mts` |
| `case` 事件名稱 | `setup.ts` 的 `CLAUDE_CODE_HOOK_EVENTS`／`CODEX_HOOK_EVENTS`（已安裝必須有 `case`，有 `case` 必須已安裝） | `hook-literal-contract.test.mts` |
| `RESOLVING_EVENTS` | 必須是已對應且已安裝的 Claude 事件 | `hook-literal-contract.test.mts` |
| `MIN_WAIT_SECONDS`／`MAX_WAIT_SECONDS` | `src/types/permission.ts` | `hook-literal-contract.test.mts` |
| `claude-permission-respond` 內容的 `enabled`／`waitSeconds` | `setup.ts` 的 `syncClaudePermissionRespondOptIn` | `hook-literal-contract.test.mts` |
| host 提示的 `termProgram`／`entrypoint`／`bundleId` 格式與送出的 key | `electron/host-app.ts`（plugin 與 hook 兩份互相比對） | `hook-literal-contract.test.mts` |
| `presentation-mcp.mjs` 的 reaction、ttl、訊息長度、`petId` 格式 | `PRESENTATION_REACTIONS`、`PRESENTATION_*_TTL_MS`、`PRESENTATION_MAX_MESSAGE_LENGTH`、`isValidPetId` | `hook-literal-contract.test.mts` |
| `agent-hook.cmd` 的檔名與 `__NODE_EXECUTABLE__` | `DEPLOY_FILES.hookScript`、`setup.ts` 的替換 | `hook-literal-contract.test.mts` |
| `PET_URL`、`PERMISSION_URL`、`DEPLOY_DIR`、token 檔名、header、權限 route、啟動標記檔名 | `src/types/local-wire.ts`、`hookStartupMarkerName` | `local-wire-contract.test.mts` |
| `IDENTIFIER_PATTERN` | `OPAQUE_ID_128_PATTERN` | `id-patterns.test.mts` |

沒有 TS 對照的值（`DENY_MESSAGE`、輪詢與重試間隔、`STARTUP_MARKER_MAX_AGE_MS`）由行為測試固定（`claude-permission-hook`、`agent-hook-delivery`）。

## 刻意沒有併進來的對照

這些只是剛好跟來源同名，其實是另一份契約：

- `src/types/host-app.ts` 的 `claude-desktop`：session 執行所在的 App（終端機、IDE、桌面 App），不是事件來源。
- `electron/project-mcp-setup.ts` 的 `client: 'claude' | 'opencode'`：要寫入哪一個 MCP 用戶端的設定檔。
- `IntegrationTarget` 與 `AdapterInstallTarget`（`claudeCode`，以及舊版面板送的 `claude`）：安裝目標，定義在 hook 檔案 `electron/setup.ts`。
- `src/utils/permission-source.ts`：「也可以在終端機或 App 裡回答」這兩句只適用於 Claude，所以依 `family === 'claude'` 加上 `variant` 查表，沒有新增 registry 欄位。
- 主題的 font family 與 `plugin-theme-*` 裡的 `Family`：字型，跟 Agent 無關。
