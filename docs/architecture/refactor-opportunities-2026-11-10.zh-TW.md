# Agent Pets 共用模組抽取評估

評估日期：2026-11-10（Asia/Taipei）  
評估基準：`main`／`1.12.5`／`404ab6f`

本文件先回顧 Git 重構紀錄，再對照目前原始碼，整理仍可整合與抽出的模組。以下是建議，尚未實作或完成驗收；行數為評估當下的概略規模，不單獨作為重構理由。

## 1. Git 紀錄：已完成的集中化

| Commit | 已完成的工作 |
|---|---|
| `774edb3` | Phase 18：按領域拆分 IPC registrar，集中頻道與 sender guard，分離 main runtime／state。 |
| `fe84c52` | Phase 18：集中擴充 registry、IPC 型別與錯誤碼。 |
| `730487b` | App 與 CLI 共用安裝邏輯。 |
| `2fe0552` | 集中 Plugin ID 等識別碼格式與驗證。 |
| `1eda8e2` | 面板視窗各種表面由共用語意調色盤推導。 |
| `dea032c` | 統一 sprite atlas 契約，加入 pet-pack `behaviorManifest`。 |
| `47d4bb4` | 集中 Agent 狀態的 policy／presentation registry。 |
| `b73a9aa` | 集中 Agent source／family registry。 |
| `fdbec75` | 集中 sound cue registry。 |
| `65a91bb` | Agent 與 sound registry 共用 `deepFreeze`。 |
| `293358e` | 集中 motion／spacing tokens，強化設計 token 檢查。 |

下一輪應延續既有共用來源，處理仍存在的重複資料與混合職責，避免另外建立平行的 registry 或工具集。

## 2. 抽取機會與優先順序

### 1. 寵物視窗尺寸契約

**證據：** [runtime.ts](../../electron/main/runtime.ts) 的 `createPetWindow()` 仍手寫 `250／260／232／190`，註解要求與 renderer 保持同步；[pet-window-height.ts](../../src/utils/pet-window-height.ts) 與 [agentStore.ts](../../src/stores/agentStore.ts) 分別持有高度與寬度相關常數。

**建議：** 將基礎尺寸、tooltip 留白、最小寬度與初始尺寸計算集中至不依賴 Electron／Vue 的模組，由 main 與 renderer 共用。保留 renderer 的 DOM 量測，以及 main 對儲存 bounds 的驗證與 work-area 限制。

**效益：** 降低啟動預設尺寸與載入後尺寸不一致，以及 tooltip 空間被裁切的風險。

**驗證重點：** 無儲存尺寸的冷啟動、不同 pet scale、單寵／多寵模式、tooltip 留白、既有尺寸還原與多螢幕／DPI。

### 2. Plugin 權限清單產生器

**證據：** [plugin-registry.ts](../../electron/plugin-registry.ts) 的 `permissionUnits()` 與 [plugin-permissions.ts](../../src/utils/plugin-permissions.ts) 的 `permissionUnitsOfPlan()` 各自列舉 network、links、secrets、schedule 及各種 contribution。專案已有 [PLUGIN_CONTRIBUTION_REGISTRY](../../src/types/plugin.ts)，但權限單位的組裝仍分散。

**建議：** 抽出共用的純函式，統一權限單位的產生規則，明確保留 main 的排序／去重，以及 UI 所需的顯示順序。後續再評估 contribution 的 capability 標籤與文案 metadata 是否適合從既有 registry 推導。

**效益：** 新增 contribution 時，減少安裝授權清單與 UI 顯示漏改其中一邊的機會。

**驗證重點：** 既有權限單位字串、順序／去重、更新差異與重新同意判定。main 仍負責 manifest 驗證與授權判定；共用 UI metadata 不得改變安全決策。

### 3. 圖片格式辨識

**證據：** [runtime.ts](../../electron/main/runtime.ts) 的 `isSupportedRasterImage()`、`rasterContentType()` 與 [plugin-registry.ts](../../electron/plugin-registry.ts) 的 `hasRasterSignature()` 重複檢查 PNG／WebP signature；runtime 另接受 JPEG。

**建議：** 抽出回傳圖片格式或 MIME 的純函式，各入口保留自己的格式白名單。

**效益：** 統一 signature 與 MIME 辨識，減少格式修正時的重複維護。

**驗證重點：** 截斷與錯誤 signature、PNG／WebP／JPEG，以及各入口原有的接受範圍。格式辨識不能取代尺寸、動畫、EXIF 或實際解碼驗證。

### 4. Plugin 面板控制器按功能拆分

**證據：** [usePluginPanelController.ts](../../src/composables/usePluginPanelController.ts) 約 1,507 行，同時處理 catalog、安裝、設定／secret、通知，以及原生 panel view。

**建議：** 先選一個職責完整的功能，例如設定編輯或 panel view lifecycle，抽成專用 composable；原控制器保留組裝職責。共同的 scoped busy、序列佇列、refresh 協調與錯誤通知需要明確的依賴介面。

**效益：** 讓單一功能的修改與生命週期更容易追蹤，減少跨功能狀態耦合。

**驗證重點：** 未儲存設定的離開確認、secret consent、非同步回應競態、panel view 開關／焦點還原，以及事件訂閱清理。

### 5. 寵物 store 按領域拆分

**證據：** [agentStore.ts](../../src/stores/agentStore.ts) 約 2,317 行，管理 sessions、mood、toast、MCP presentation、permission UI、面板導航與寵物偏好。

**建議：** 逐步抽出領域狀態與控制器，先維持現有 store 對元件的 API。一次只拆一個領域，並明確定義事件輸入、計時器、儲存與清理責任。

**效益：** 讓狀態更新與副作用的歸屬更清楚，縮小每次功能修改需要理解的範圍。

**驗證重點：** session 狀態與淘汰規則、toast／presentation 的優先序與 TTL、跨視窗同步、localStorage 既有 key，以及計時器清理。Permission Broker 與持久化 XP 的權威仍在 main。

### 6. main runtime 按服務拆分

> 狀態（2026-11-10）：階段 11 抽出寵物視窗模式與 History runtime；1.13.2 整合輪線 2 再抽出 Plugin runtime、plugin catalog、growth 服務與面板幾何，`runtime.ts` 降到約 2,190 行，見 [phase-main-runtime-split.md](../phase-reports/phase-main-runtime-split.md)。

**證據：** [runtime.ts](../../electron/main/runtime.ts) 約 3,443 行，包含 Plugin 組裝、視窗模式、History／Progression／Permission 服務與協定處理。Phase 18 已完成第一輪 runtime／state 分離。

**建議：** 延續既有服務邊界，每次抽出一組 runtime，例如 Plugin runtime 或視窗管理；透過明確依賴與啟動／dispose 介面連接，避免只把大檔搬到另一個位置。

**效益：** 簡化組裝根，讓服務啟動、恢復、廣播與關閉的責任可單獨理解與驗證。

**驗證重點：** 啟動順序、renderer crash 後的狀態重送、關閉清理、IPC sender guard，以及既有安全設定。Permission Control Plane 與 Presentation MCP 必須維持獨立邊界。

### 7. 原子寫檔的底層機制

**證據：** [plugin-data-file.ts](../../electron/plugin-data-file.ts)、[panel-theme-user-store.ts](../../electron/panel-theme-user-store.ts) 與 [project-mcp-registry.ts](../../electron/project-mcp-registry.ts) 都有暫存檔、rename、權限設定與失敗清理流程。專案已共用 [fs-rename.ts](../../electron/fs-rename.ts)，另有 [safe-config-write.ts](../../electron/safe-config-write.ts)。

**建議：** 僅共用可證明等價的底層寫入步驟，保留各領域的大小限制、目錄驗證、備份與 symlink 政策。`safe-config-write.ts` 會追隨使用者 dotfile 的 symlink，不適合直接套用到拒絕 symlink 的私有資料儲存。

**效益：** 減少重複的暫存檔與清理實作，讓失敗處理集中受測。

**驗證重點：** rename 失敗、暫存檔清理、檔案權限、symlink 行為，以及既有備份／恢復政策。

## 2.1 補充：第二輪掃描發現的散落來源

以下項目在第一版評估中未列出，依「重複會造成行為不一致的風險」排序。

### 8. 本機通訊契約（port、token 路徑、header、endpoint）

**證據：** [ports.ts](../../electron/main/ports.ts) 已有 `DEFAULT_LOCAL_PORTS`，但 `17373／17374／17375` 仍在 [event-server.ts](../../electron/event-server.ts) 的 fallback、[setup.ts](../../electron/setup.ts) 內嵌的 OpenCode plugin 模板、[agent-hook.mjs](../../integrations/agent-hook.mjs) 與 [presentation-mcp.mjs](../../integrations/presentation-mcp.mjs) 各寫一次。`~/.desktop-pet` 及 `event-token`／`permission-token`／`presentation-token` 在 `setup.ts`（兩處：路徑函式與 OpenCode 模板）及兩支 integration 腳本各自拼接。Token header 只有 `PRESENTATION_TOKEN_HEADER` 抽成常數，event 與 permission header 在 server、hook 與 OpenCode 模板中為字面值（大小寫也不一致）。`/v1/permission/*` 路徑只出現在 OpenCode 模板與 server 中。

**建議：** 建立單一「local wire contract」模組（port、部署目錄名、token 檔名、header、endpoint），main 與 `setup.ts` 直接匯入；integration `.mjs` 腳本因為獨立部署無法匯入，改由建置時注入或以契約測試比對字面值，OpenCode 模板以插值取用同一份常數。

**效益：** 避免改 port、路徑或 header 時漏改已部署的 hook，造成事件靜默遺失。

**驗證重點：** 已安裝的舊版 hook 仍能連線（預設值不可變）、dev／e2e 的 port 覆寫、packaged build 忽略環境變數。

### 9. Loopback HTTP server 的共用骨架

**證據：** [event-server.ts](../../electron/event-server.ts)、[presentation-mcp.ts](../../electron/presentation-mcp.ts) 與 [permission-adapter-server.ts](../../electron/permission-adapter-server.ts) 各自實作 token 的 `timingSafeEqual` 比對、限制大小的 body 讀取與 JSON 解析。三者的 413 錯誤格式不一致（`'request too large'` 與 `'request_too_large'`），body 讀取一邊用 `on('data')`、一邊用 `for await`；只有 permission server 另外檢查 `remoteAddress` 是否為 loopback。

**建議：** 抽出純粹的 `readBoundedJson(request, maxBytes)`、`tokenMatches(supplied, expected)` 與統一錯誤回應；各 server 保留自己的路由、大小上限、rate limit 與授權政策。是否讓其他兩個 server 也檢查 loopback 位址，應另外作為安全決策評估，不在抽取時默默變更。

**效益：** 安全相關的比對與資源限制集中受測，降低單一 server 修正後其他兩個沒跟上的機會。

**驗證重點：** 超過上限的 body、分段 chunk、空 body、錯誤 JSON、token 長度不同、既有 client 對錯誤碼的解析。

### 10. Agent 設定目錄解析

**證據：** `~/.codex`、`~/.claude` 與 `~/.config/opencode` 分別在 [setup.ts](../../electron/setup.ts)、[project-mcp-setup.ts](../../electron/project-mcp-setup.ts)、[local-usage.ts](../../electron/local-usage.ts) 與 [quota.ts](../../electron/quota.ts) 中自行組合。只有 `quota.ts` 尊重 `CODEX_HOME`；hook 安裝（`~/.codex/hooks.json`）、local usage 掃描與偵測都忽略它。OpenCode plugin 路徑寫死 `~/.config`，未參考 `XDG_CONFIG_HOME`；`CLAUDE_CONFIG_DIR` 則全專案都未處理。

**建議：** 在 agent source／family registry 旁新增每個 agent 的設定目錄 resolver（含環境變數覆寫規則），所有安裝、偵測、用量與 quota 入口共用。

**效益：** 這項不只是整理，而是已確認的相容性缺陷（見下方查證）。

**查證結果（2026-11-10，依官方文件與原始碼）：**

| Agent | 官方覆寫變數 | 本專案行為 | 結論 |
|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR`：官方文件說明設定後「every `~/.claude` path」都改到該目錄，包含 `settings.json`、`.credentials.json`、`projects/` | 安裝 hook（`claudeCodeSettingsPath()`）、quota 憑證、local usage 掃描全部寫死 `~/.claude` | **已確認**：hook 會寫進 Claude Code 不讀的檔案，事件與權限回覆全部失效；quota 與用量也讀不到 |
| Codex | `CODEX_HOME`：官方文件說明它是 config、auth、logs、sessions 的根目錄 | 只有 quota 的 `codexAuthPath()` 讀取；`config.toml`（開啟 hooks feature）、`hooks.json`、`sessions/` 掃描寫死 `~/.codex` | **已確認**：`config.toml` 與 sessions 位置錯誤；`hooks.json` 官方文件只寫 `~/.codex/hooks.json`，但說明 hooks 位於「active config layers」旁，推定也跟著 `CODEX_HOME`，需實測 |
| OpenCode | 官方文件未明載 `XDG_CONFIG_HOME`；第三方工具依 OpenCode 實作採 `OPENCODE_CONFIG_DIR` → `$XDG_CONFIG_HOME/opencode` → `~/.config/opencode` | 寫死 `~/.config/opencode/plugin/` | **未確認**，需讀 OpenCode 原始碼或實測。另外目前官方文件寫 `plugins/`（複數），本專案用 `plugin/`；程式註解稱已實測可用，可能新舊版都支援，應一併確認 |

**額外限制：** 即使改為讀取 `process.env`，Electron 從 GUI 啟動時（特別是 macOS Dock／Finder）不會繼承 shell 設定檔中的 `export`；Windows 使用者環境變數與 CLI 安裝路徑（`setup.ts` 由 CLI 執行時）則看得到。修正時需決定：只讀 GUI 環境、另外讀取 login shell 環境，或在設定頁讓使用者手動指定目錄並顯示偵測到的路徑。

**影響範圍：** 只影響有設定上述變數的使用者（本機評估環境四個變數都未設定，因此無法在此重現）。預設路徑的使用者不受影響。

**驗證重點：** 有／無環境變數、Windows／macOS／Linux 路徑、既有安裝的移除與升級不會遺漏舊位置（變數變更前後兩處都可能殘留 hook）、`~` 與相對路徑（Claude Code 文件要求絕對路徑）。

### 11. Agent 顯示名稱繞過 registry

**證據：** [agent-label.ts](../../src/utils/agent-label.ts) 以 `id.includes('codex')`、`includes('claude')` 等子字串判斷顯示名稱，而 [agent-adapter.ts](../../src/types/agent-adapter.ts) 的 adapter registry 已有 `displayName`；[agent-hook.mjs](../../integrations/agent-hook.mjs) 另有一份 `validSources` 清單。

**建議：** 顯示名稱改由 adapter／source registry 查表；hook 的來源清單納入第 8 項的契約測試。

**效益：** 新增 agent 時不必記得修改子字串規則，避免 id 互相包含時誤判。

**驗證重點：** History 中既有 adapter id、未知 id 原樣顯示、i18n key 不變。

### 12. Renderer localStorage key 清單

**證據：** 約 30 個 `agent-pet-*` key 散在 [agentStore.ts](../../src/stores/agentStore.ts)（字面值，約 36 處）、[i18n.ts](../../src/i18n.ts)、[useTheme.ts](../../src/composables/useTheme.ts)、[StatusPanel.vue](../../src/components/StatusPanel.vue)、[StatusPanelHistory.vue](../../src/components/status-panel/StatusPanelHistory.vue)、[DesktopPet.vue](../../src/components/DesktopPet.vue) 與 [GrowthAchievements.vue](../../src/components/growth/GrowthAchievements.vue)。[App.vue](../../src/App.vue) 與 `useTheme.ts` 各自監聽 `storage` 事件做跨視窗同步。

**建議：** 建立集中的 key registry（key、型別、預設值、是否跨視窗同步），並提供有 try/catch 的讀寫 helper；key 字串必須維持原值以保留既有偏好。可與第 5 項 store 拆分一起進行。

**效益：** 避免 key 拼錯或重複，讓跨視窗同步與 migration（例如 `agent-pet-mood-version`）有單一位置可查。

**驗證重點：** 既有使用者資料的讀取、無效值回退預設、跨視窗同步、隱私模式下 storage 例外。

### 13. 識別碼格式與 clamp 等小型重複

**證據：** `/^[A-Za-z0-9._:-]{1,N}$/` 在 [history.ts](../../electron/history.ts)、[history-sessions.ts](../../electron/history-sessions.ts)、[permission-broker.ts](../../electron/permission-broker.ts)、[permission-adapter-server.ts](../../electron/permission-adapter-server.ts)、[progression-events.ts](../../src/utils/progression-events.ts) 與 `agent-hook.mjs` 各自定義，長度上限有 64／128／256 三種；`2fe0552` 集中的 [id-patterns.ts](../../src/types/id-patterns.ts) 未涵蓋這類 ID。`clamp()` 在 `runtime.ts`、`pet-drag.ts`、`pet-window-mode.ts` 各有一份。

**建議：** 把這類 ID 格式納入既有 `id-patterns.ts`，以具名常數區分不同長度；`clamp` 併入共用數值工具。這項風險低，適合搭配其他階段順手處理。

**驗證重點：** 各入口原本的長度上限不可放寬或收緊。

### 14. 相對時間與時長格式

**證據：** [intl-format.ts](../../src/utils/intl-format.ts) 的 `formatRelative()` 與 [relative-time.ts](../../src/utils/relative-time.ts) 的 `formatRelativeTime()` 都快取 `Intl.RelativeTimeFormat`，但取整方式（`trunc`／`round`）與一週以上改顯示日期的規則不同；`formatDuration()` 與 [token-format.ts](../../src/utils/token-format.ts) 的 `durationParts()` 也有重疊。[history-axis.ts](../../src/utils/history-axis.ts) 另有自己的 `Intl.DateTimeFormat` 快取。

**建議：** 統一放在 `intl-format.ts`，以選項表達「一週後顯示日期」等差異，並共用 formatter 快取。

**效益：** 同一畫面中不同元件對同一時間顯示不一致的機會降低。

**驗證重點：** 邊界值（59 秒、1.5 小時、7 天）、兩種語系、既有測試快照。

### 15. 本地化文字型別與語系清單

**證據：** `{ 'zh-TW': string; 'en-US': string }` 在 electron 端（[state.ts](../../electron/main/state.ts)、[ipc/plugin-feed.ts](../../electron/ipc/plugin-feed.ts) 等）內嵌約 9 次，而 [plugin.ts](../../src/types/plugin.ts) 已有 `PluginLocalizedText`；[plugin-event-source.ts](../../electron/plugin-event-source.ts) 另寫一份 `['zh-TW', 'en-US']`，[locale.ts](../../src/types/locale.ts) 的 `isAppLocale()` 也沒有使用 `SUPPORTED_LOCALES`。

**建議：** 統一使用 `PluginLocalizedText` 或由 `AppLocale` 推導的 `Record<AppLocale, string>`，語系清單只從 `SUPPORTED_LOCALES` 取得。

**效益：** 未來新增語系時，型別檢查會指出所有需要補的位置。

**驗證重點：** 純型別變更，以 type-check 與既有測試確認。

### 其他觀察（優先度低）

- `app.getPath('userData')` 底下的檔名（`history.sqlite`、`progression.sqlite`、`panel-size.json` 等）約 15 處散在 [runtime.ts](../../electron/main/runtime.ts) 與 [main.ts](../../electron/main.ts)，可集中成 userData 路徑表，也方便診斷與資料清除功能列舉。
- 51 個測試檔各自使用 `mkdtemp` 建立暫存目錄，沒有共用 helper；可在測試基礎設施階段一併整理。
- 元件中的 UI 計時（複製提示 1.8–2 秒、確認重設 4 秒等）為字面值，可評估是否納入 motion token，但屬於 UX 調整而非一致性風險。

## 3. 建議執行方式

1. 第一階段處理寵物視窗尺寸契約：重複明確，範圍容易界定。
2. 第二階段處理 Plugin 權限清單：先固定既有輸出，再抽共用函式並檢查授權差異。
3. 圖片格式辨識可獨立處理；大型 controller／store／runtime 拆分則各自成階段。
4. 原子寫檔涉及不同檔案安全政策，應在邊界與失敗案例釐清後獨立處理。
5. 第 10 項（Agent 設定目錄）已確認是 `CLAUDE_CONFIG_DIR`／`CODEX_HOME` 使用者會遇到的缺陷，建議作為缺陷修正階段，排在第一階段之前；OpenCode 部分待實測後再決定是否納入。
6. 第 8、9 項（本機通訊契約與 loopback server 骨架）牽涉已部署 hook 與安全邊界，應以契約測試先固定現有字面值，再分開處理。
7. 第 11–15 項風險低，可併入相關階段順手處理，不必單獨成階段。

### 3.1 執行排程（2026-11-10 定案）

整合分支：`claude/shared-sources-refactor`。每階段在獨立 worktree 的子 session 中進行，完成後由總控審核並合併回整合分支；全部完成後一次升 minor 版並開 PR。

| 階段 | 項目 | 工作記錄 | 完成 commit |
|---|---|---|---|
| 1 | 第 10 項：Agent 設定目錄修正（含 login shell 查詢，見 [計畫](../design/Agent-Config-Dir-Fix-Plan.zh-TW.md)） | `docs/phase-reports/refactor-01-agent-config-dirs.md` | `35f6cb9` |
| 2 | 第 1 項：寵物視窗尺寸契約；第 13 項：ID 格式與 `clamp` | `refactor-02-pet-window-size.md` | `647960e` |
| 3 | 第 2 項：Plugin 權限清單產生器 | `refactor-03-plugin-permission-units.md` | `1926b08` |
| 4 | 第 3 項：圖片格式辨識 | `refactor-04-raster-signature.md` | `bde2f70` |
| 5 | 第 8 項：本機通訊契約；第 11 項：Agent 顯示名稱 | `refactor-05-local-wire-contract.md` | `b3a6f25` |
| 6 | 第 9 項：Loopback HTTP server 骨架 | `refactor-06-loopback-server.md` | `f55d2a2` |
| 7 | 第 14 項：時間格式；第 15 項：本地化型別 | `refactor-07-intl-locale.md` | `940a00b` |
| 8 | 第 12 項：localStorage key registry | `refactor-08-storage-keys.md` | `5fdffe6` |
| 9 | 第 5 項：agentStore 按領域拆分 | `refactor-09-agent-store.md` | `d5f5b47` |
| 10 | 第 4 項：Plugin 面板控制器拆分 | `refactor-10-plugin-panel-controller.md` | `26b0b4e` |
| 11 | 第 6 項：main runtime 拆分；userData 路徑表 | `refactor-11-main-runtime.md` | `7a30439` |
| 12 | 第 7 項：原子寫檔底層機制 | `refactor-12-atomic-write.md` | `2c02127` |
| 收尾 | 升 minor 版（1.13.0）、PR、auto-fix、auto-merge | [`phase-release-1-13-0.md`](../phase-reports/phase-release-1-13-0.md) | 本 PR |

測試暫存目錄 helper 與 UI 計時字面值（低優先觀察）在相關階段順手處理，不單獨成階段。

每次只進行一個階段，先固定現有行為，再完成適當的功能驗證與安全複查。依專案規則，完成後先交由使用者確認，再決定是否升版。

## 4. 本次評估範圍與限制

- 已檢視 Git 紀錄、專案技能、架構文件、相關原始碼與部分測試內容。
- 上述項目是抽取機會，不代表已確認存在使用者可見的缺陷，也不承諾效能提升。
- 本次僅新增分析文件，沒有修改產品程式、版本、Git tag 或 release。
- 未執行單元測試、建置、Electron 實機驗證或正式安全驗收。
- 後續已依 3.1 節排程完成全部 12 個階段的實作（各階段的完成 commit 見排程表）；每個階段的範圍、驗證證據、安全審查與殘餘風險記錄在 `docs/phase-reports/refactor-01-agent-config-dirs.md` 至 `docs/phase-reports/refactor-12-atomic-write.md`。
