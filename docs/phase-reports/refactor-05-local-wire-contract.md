# 重構階段 5：本機通訊契約與 Agent 顯示名稱

- **開始時間**：2026-11-10 11:54（Asia/Taipei）
- **完成時間**：2026-11-10 12:11（Asia/Taipei）
- **基準 commit**：`bde2f70`（分支 `claude/refactor-05-wire-8d0f7a`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 8 項、第 11 項；排程見 3.1 節

## 範圍

1. **第 8 項**：建立單一 local wire contract 模組，收納預設 port（17373／17374／17375）、dev 覆寫用的環境變數名稱、部署目錄名 `.desktop-pet`、部署目錄內 hook 會讀的檔名（三個 token、Claude 權限 opt-in 標記）、token／client／server header 名稱、`/v1/...` endpoint。main（`ports.ts`、`event-server.ts`、`presentation-mcp.ts`、`permission-adapter-server.ts`、`server-health.ts`、`runtime.ts`）與 `setup.ts`（含內嵌 OpenCode plugin 模板，改以插值取用）都從它取值。
2. `integrations/agent-hook.mjs`、`integrations/presentation-mcp.mjs` 安裝後在 app 之外由 Node 單獨執行，保留字面值；新增契約測試逐一比對它們與契約模組相同，`validSources` 與 `AGENT_SOURCE_REGISTRY` 比對。
3. **第 11 項**：`src/utils/agent-label.ts` 改由 adapter registry 查表，未知 id 原樣顯示。

不在範圍：三個 loopback server 的 token 比對與 bounded body 讀取（階段 6）；OpenCode plugin 檔名 `desktop-pet.js` 與 agent 設定目錄（屬第 10 項，已於階段 1 處理）；`scripts/` 下的 e2e 腳本字面值。

## 驗收條件

1. 所有預設 port、header 名稱（含送出時的大小寫）、路徑與檔名字串與基準逐字相同；OpenCode 模板產生的內容與基準位元組相同。
2. dev／e2e 的 port 覆寫與 packaged build 忽略環境變數的行為不變（`tests/local-ports.test.mts`）。
3. 契約測試：`agent-hook.mjs`、`presentation-mcp.mjs` 的每個字面值與契約模組相同；`validSources` 等於使用 hook 的家族在 registry 內的來源。
4. `agentDisplayName()`：`codex`、`claude-code`、`opencode`、`generic-http`、`unknown` 的顯示結果與基準相同（測試固定），未知 id 原樣顯示，i18n key 不變。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗）、`git diff --check` 通過。
6. 隔離 Electron 加真實 hook（`scripts/e2e-real-hook.mts`）驗證 event、permission、presentation 三條通道仍能送達。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試清單 | 通過 | 基準 `test:unit`（`bde2f70`）：1333 項，1299 過、11 失敗、23 skip，見「基準失敗清單」 |
| 2 | 建立契約模組，main 與 setup.ts 改用 | 通過 | `vue-tsc` 通過；OpenCode 模板兩個來源的產出與基準逐位元組相同。本步驟開始時沒有先存「進行中」，完成後才更新，特此註記 |
| 3 | 契約測試與 agent-label 查表 | 通過 | 相關 5 個測試檔 22 項全過；舊版 `agentDisplayName` 與新版對 5 個 History id × 2 語系結果逐一相同 |
| 4 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 5 | 隔離 Electron 真實 hook 驗證 | 通過 | event、permission、presentation 三條通道與認證負向檢查，見「Electron 實機驗證」。本步驟開始時記錄表沒有先改「進行中」，特此註記 |
| 6 | 收尾記錄、更新文件、commit | 通過 | commit 於分支 `claude/refactor-05-wire-8d0f7a` |

## 基準失敗清單（`bde2f70`）

1333 項：1299 過、11 失敗、23 skip。失敗：「a file edit is medium only inside the project and never for execution-relevant paths」「a symlinked staging root is refused」「startup recovery restores interrupted replaces and removes only our own stale entries」「git helpers never follow gitdir or commondir outside the picked folder」「git helpers refuse a symlinked info directory or exclude file」「removing hooks from a symlinked dotfile keeps the link and its target」（以上為 symlink EPERM 類）；「a permission request still reaches the pet when the hook is stalled right after sending starts」「a status event still arrives when the hook process is stalled before it can send」「a starting app that never opens its port holds the hook for a bounded time only」「with the pet closed the hook does not wait, even if a crash left an old marker」「the worst-case draft (every key mid-grey) validates within a timing ceiling」（以上為 hook 停滯與計時類）。

基準執行期間，總控已開始修改 `ports.ts`、`server-health.ts`、`event-server.ts`（未存檔前即啟動測試，執行中途才寫入）；上述失敗全部是 symlink 與計時類，與這三個檔無關，因此仍採用為基準。

## 盤點結果

grep `1737[345]`、`desktop-pet`、`*-token`、`x-agent-pets-*`、`/v1/`、`AGENT_PETS_*_PORT` 於 `electron/`、`src/`、`integrations/`、`scripts/`：

| 位置 | 改前 | 處理 |
|---|---|---|
| `electron/main/ports.ts` | `DEFAULT_LOCAL_PORTS` 與三個環境變數名稱 | 改從契約取值並轉出 `DEFAULT_LOCAL_PORTS`（`tests/local-ports.test.mts` 仍從這裡匯入）；`LocalPorts` 由契約推導 |
| `electron/event-server.ts` | `'/v1/events'`、`'x-agent-pets-token'`、fallback `17373`、啟動日誌網址 | 契約 |
| `electron/main/server-health.ts` | `'x-agent-pets-server'`、`'127.0.0.1'`、`'/v1/events'` | 契約；`AGENT_PETS_SERVER_HEADER` 保留名稱 |
| `electron/permission-adapter-server.ts` | 五個 `'POST /v1/permission/*'`、`'x-agent-pets-permission-token'`；未使用的 `PERMISSION_ADAPTER_PORT` | 路由 key 在載入時由契約組好；刪除無人使用的 `PERMISSION_ADAPTER_PORT` |
| `electron/presentation-mcp.ts` | 三個 `/v1/presentation/*`（共 7 處）、兩個 header；未使用的 `PRESENTATION_MCP_PORT` | 契約；允許路徑改為 `ReadonlySet`；刪除無人使用的 `PRESENTATION_MCP_PORT`；`PRESENTATION_TOKEN_HEADER`／`PRESENTATION_CLIENT_HEADER` 保留名稱 |
| `electron/main/runtime.ts` 測試事件 | host、`'/v1/events'`、`'x-agent-pets-token'` | 契約 |
| `electron/setup.ts` 路徑函式 | `.desktop-pet` 三處、七個檔名 | 契約（`hookScriptPath`／`hookWrapperPath` 改經 `hookScriptDeployPath()`，結果相同） |
| `electron/setup.ts` OpenCode 模板 | 兩個 token 路徑、host、`17373`／`17374`、`X-Agent-Pets-Token`／`X-Agent-Pets-Permission-Token`、六處 `/v1/...` | 以插值取用契約；header 經 `headerCase()` 轉成既有的大小寫 |
| `src/types/agent-adapter.ts`、`electron/agent-adapter*.ts` | generic-http 的 `sourceLabels` 與三則英文診斷訊息中的 `/v1/events` | 契約 |
| `integrations/agent-hook.mjs`、`integrations/presentation-mcp.mjs` | 全部字面值 | **不改**；由契約測試逐一比對 |

刻意不納入：`electron/hook-config.ts` 的 `AGENT_PETS_HOOK_PATH` 正規式（以契約組出的路徑測試它仍認得）、`electron/diagnostics/redact.ts` 的遮蔽正規式（測試確認三個 token header 都會被遮蔽）、`setup.ts` 讀 `integrations/` 原始檔的檔名（那是 repo 內的來源檔，不是部署契約）、OpenCode plugin 檔名 `desktop-pet.js`（屬 agent 設定目錄）、`scripts/` 的 e2e 腳本與 `docs/ux-overhaul/security-review.md` 的歷史記錄。

## 設計摘要

- 新增 `src/types/local-wire.ts`（不 import 任何模組，主程序、renderer 共用型別檔與 Node 測試都直接載入）：`LOCAL_WIRE_HOST`、`DEFAULT_LOCAL_PORTS`、`LOCAL_PORT_ENV`（`satisfies Record<keyof typeof DEFAULT_LOCAL_PORTS, string>`）、`DEPLOY_DIR_NAME`、`DEPLOY_FILES`、`LOCAL_WIRE_HEADERS`、`LOCAL_WIRE_PATHS`。所有表 `Object.freeze` + `as const`，路徑以樣板字面值從兩個 prefix 推導，型別仍是精確的字串字面值。
- 放在 `src/types/` 而不是 `electron/`：`src/types/agent-adapter.ts`（renderer 也用）需要 `/v1/events`；與前幾階段的共用契約（`id-patterns.ts`、`pet-window.ts`）位置一致。
- **OpenCode 模板**：內容逐位元組與基準相同（兩個來源都比對過），所以 `openCodePluginIsCurrent()` 對已部署的 plugin 仍回 `true`，升級後不會重寫使用者的 plugin 檔。plugin 跑在 OpenCode 裡、一律連預設埠，這點不變（dev 覆寫本來就不影響 plugin）。
- **header 大小寫**：契約存 Node 收到的小寫名稱；OpenCode 模板以 `headerCase()` 轉回既有送出的 `X-Agent-Pets-Token`／`X-Agent-Pets-Permission-Token`，hook 與 MCP 腳本本來就送小寫，不變。
- **第 11 項**：`agentDisplayName()` 改為 `Map` 查表：`AGENT_ADAPTER_REGISTRY` 的 `family` → `FAMILY_LABEL_KEYS`（`as const satisfies Record<AgentFamilyKey, TranslationKey>`，新增家族時漏填會編譯失敗）→ 既有 i18n key。沒有家族的 `generic-http` 與未知 id 原樣顯示。檔內執行期 import 改為相對路徑，讓 Node 測試能直接載入（`@/` 只留在 `import type`，符合 conventions §1 的閉包規則）。
- **行為差異（刻意）**：改前以子字串且不分大小寫判斷，`my-codex-fork`、`Codex`、`claude` 這類 id 會顯示成產品名；改後原樣顯示。History 實際只會出現 registry 的四個 id（`history.ts` 以 `isOpaqueId256` 收下 adapter 指定的 id，而 adapter 只允許 registry id，事件只能自稱 `generic-http`）與空值的 `unknown`，這五個的顯示結果不變（測試固定，並以舊函式逐一比對兩個語系）。

## Electron 實機驗證（Windows 11，隔離 HOME，螢幕外）

以 `vite build` 後的 repo 啟動 `scripts/e2e-isolated-electron.mjs --offscreen --hook-port-base 28773 --debug-port 9378 --inspect-port 9379`；日誌顯示三個 server 分別聽在 `127.0.0.1:28773/v1/events`、`28774`、`28775`。沒有點擊任何畫面元素。

| 通道 | 做法 | 結果 |
|---|---|---|
| event（真實 Claude Code hook） | `scripts/e2e-real-hook.mts --home <隔離 HOME> --hook-port-base 28773`：在隔離 HOME 執行真正的安裝程式，從產生的 `settings.json` 讀出 hook 指令執行 | `all 8 hook events rendered as expected`（SessionStart → SessionEnd 的 session 狀態、寵物狀態與動畫列全部正確） |
| permission（setup.ts 產生的 OpenCode plugin） | 呼叫 `openCodePluginContent('opencode-cli')`，只把 `17373`／`17374` 換成隔離埠（斷言只改兩行），以隔離 HOME 載入後送 `permission.asked`，再送 `permission.replied` | 寵物 store：session `waiting-permission`、來源 `opencode-cli`、一筆 `pending` 權限請求；回覆後請求清空、session 回到 `thinking` |
| presentation（隔離 HOME 內實際部署的 `presentation-mcp.mjs`） | 以 `AGENT_PETS_PRESENTATION_PORT=28775` 啟動，stdio 送 `initialize`、`pet_status`、`pet_say` | `pet_status` 回傳真實寵物資料；`pet_say` `accepted: true`；寵物畫面出現該句泡泡 |
| 認證與路由（負向） | 直接對三個埠送請求 | event：無 token 401、錯 token 401、帶 Origin 403、未知路徑 404、`x-agent-pets-server: event`；permission：無 token 401、未知路由 404；presentation：無 token 401、未知路徑 404 |

結束時兩個視窗 `document.hasFocus()` 皆為 `false`，寵物視窗 `screenX = -18752`、面板 `hidden`。之後結束 app、刪除隔離暫存目錄，確認 28773–28775 已無監聽。驗證腳本在 session scratchpad，不在版本控制內。

偏差：`e2e-real-hook.mts` 的安全檢查拒絕位於使用者家目錄下的隔離 HOME，而 Windows 的暫存目錄就在 profile 底下；依階段 1 的做法，只在執行該腳本的程序把 `USERPROFILE` 設為不存在的路徑（腳本仍斷言所有寫入都在隔離 HOME 內，hook 子程序另外拿到隔離的 `HOME`／`USERPROFILE`）。另外第一次 presentation 驗證把 `pet_say` 的參數名寫錯（`text`，應為 `message`）、且誤以為 `pet_status.enabled` 必為 `true`，修正驗證腳本後重跑通過；這兩點是驗證腳本的錯，不是程式行為。沒有另外建置基準版做 A/B（階段 4 的做法），改由「模板逐位元組相同」「integration 腳本未修改」與契約測試保證線上字串不變。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| OpenCode 模板 | 改前從原始碼取出的模板與改後 `openCodePluginContent()` 的輸出，兩個來源逐位元組相同（改前的取法少了結尾換行，補上後 `cmp` 相同） |
| `agentDisplayName` | 舊函式與新函式對 `codex`、`claude-code`、`opencode`、`generic-http`、`unknown` × zh-TW／en-US 結果逐一相同 |
| 新增測試 | `tests/local-wire-contract.test.mts` 6 項（固定契約每個值、`agent-hook.mjs` 與 `presentation-mcp.mjs` 逐行比對、OpenCode 模板插值與 header 大小寫、hook 路徑辨識、診斷遮蔽）；`tests/agent-label.test.mts` 2 項；`agent-source-registry` 的 `validSources` 測試改為要求正好等於 Codex＋Claude 家族的來源；`opencode-plugin.test.mts` 改用真正的產生函式 |
| 相關測試檔 | contract、label、opencode-plugin、agent-source-registry、local-ports、presentation-mcp、presentation-stdio、permission-adapter、event-server、server-health、claude-permission-hook、setup-install、hook-config：98 項，94 過、2 失敗（皆在基準清單：symlink EPERM）、2 skip |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1341 項：1309 過、9 失敗、23 skip（基準 1333 項：1299 過、11 失敗）。9 個失敗全部在基準清單內；基準的「a starting app that never opens its port…」「the worst-case draft…」這次通過（計時偶發） |
| `git diff --check` | 通過 |
| 祕密掃描 | 對整份 diff 的新增行掃 `ghp_`／`sk-`／私鑰／password／secret 樣式，無命中 |
| 相依套件 | 沒有新增或更新相依套件，`pnpm-lock.yaml` 未變，本階段不重跑 audit |

## 安全審查

- **loopback 綁定**：`listenOnLocalPort()` 與綁定位址未修改；實機日誌三個 server 都在 `127.0.0.1`。
- **認證**：三個 server 的 token 比對（`timingSafeEqual`、長度先比）程式不變，只把 header 名稱改為契約常數，值相同；實機負向檢查回 401／403／404。
- **body／rate limit／method**：`MAX_BODY_BYTES`、事件 rate limiter、permission 建立預算、presentation 每 10 秒 60 次、method allowlist、`headersTimeout`／`requestTimeout` 都沒有改。presentation 允許路徑由三個 `===` 改為 `Set.has`，集合相同；`request.url` 為 `undefined` 時仍拒絕。
- **packaged build 忽略環境變數**：`resolveLocalPorts()` 的 `isPackaged` 分支不變，`tests/local-ports.test.mts` 通過；環境變數名稱只是改為從契約讀。
- **已部署 hook 相容**：`integrations/*.mjs` 未修改；OpenCode 模板輸出逐位元組相同；契約測試把每個值寫死，改值會失敗。
- **未改**：IPC、token 產生與檔案權限（`ensureToken()`）、部署目錄的建立與清理流程、權限決策邏輯。階段 6 的 server 骨架（token 比對、bounded body）刻意未動。

## Code review 紀錄

- 新語法：契約表 `as const`＋`Object.freeze`，`LOCAL_PORT_ENV` 用 `satisfies` 對齊 port 的 key；路徑以樣板字面值推導仍保有字面型別；`FAMILY_LABEL_KEYS` 用 `as const satisfies Record<AgentFamilyKey, TranslationKey>`；`flatMap` 加型別收斂取代 `filter`＋`as`。沒有新增 `as` 轉型（`agent-label.ts` 的 `as const` 只用於 tuple）。
- 效能：`agentDisplayName` 由最多三次 `toLowerCase`＋`includes` 改為一次 `Map.get`；permission 路由 key 在載入時組好；presentation 路徑檢查改 `Set`。熱路徑沒有新增任何 I/O。
- 風格：`electron/` 以相對路徑加 `.ts` 匯入契約；`agent-label.ts` 執行期相對匯入、`@/` 只用於 `import type`（Node 測試閉包規則）；註解為繁體中文、只寫原因與限制。沒有新增使用者可見文字，i18n key 未變，不涉及 Liquid Glass。
- 複檢修正：`permission-adapter-server.ts` 的路由 key 註解原本寫「每個請求不組字串」，但請求端仍會組 `${method} ${pathname}`，改為描述實際行為。
- 子代理：本階段牽涉已部署 hook 相容性與安全邊界、而且每個替換都要逐字核對，由總控親自實作與複檢，沒有派發子代理。

## 殘餘風險

1. **macOS／Linux 未實測**：只在 Windows 11 驗證；變更是字串常數替換，不涉及平台差異。
2. **Claude Code 權限回覆路徑沒有實機驗證**：permission 通道以 OpenCode plugin 實測；`agent-hook.mjs` 的 PermissionRequest 路徑需要開啟主程序偏好，由 `tests/claude-permission-hook.test.mts`（真正的 hook 對假 server）覆蓋，且 hook 檔本身未修改、路徑由契約測試比對。
3. **契約測試以原始碼比對**：`integrations/*.mjs` 的檢查是讀檔比對特定寫法，重新排版 hook 也會讓測試失敗；這是刻意的（hook 改動應有人複核），失敗訊息會指出哪個字面值找不到。
4. **`agentDisplayName` 對非 registry id 的顯示改變**：如上所述 History 不會出現這類 id；若將來插件或匯入資料帶入自訂 adapter id，會原樣顯示而不是被子字串猜成產品名。
5. 本機既有失敗測試與偶發計時測試不在本階段處理。

## 版本建議

本階段不改版本。整體重構依 3.1 節排程在全部階段完成後統一升 minor（1.12.5 → 1.13.0）；單看本階段屬 patch 等級（內部重構、對外契約值不變）。

## 檔案變更狀態

| 路徑 | 類型 | 目的 | 狀態 |
|---|---|---|---|
| `src/types/local-wire.ts` | 新增 | 本機通訊契約唯一來源 | 完成 |
| `electron/main/ports.ts` | 修改 | 預設 port 與環境變數名稱改從契約取 | 完成 |
| `electron/event-server.ts` | 修改 | 路徑、header、fallback port | 完成 |
| `electron/main/server-health.ts` | 修改 | server header、host、探測路徑 | 完成 |
| `electron/permission-adapter-server.ts` | 修改 | 路由 key、token header；刪除未使用的 port 常數 | 完成 |
| `electron/presentation-mcp.ts` | 修改 | 路徑與 header；允許路徑改 Set；刪除未使用的 port 常數 | 完成 |
| `electron/main/runtime.ts` | 修改 | 測試事件的 host、路徑、header | 完成 |
| `electron/setup.ts` | 修改 | 部署路徑函式；OpenCode 模板插值與 `headerCase()` | 完成 |
| `electron/agent-adapter.ts`、`electron/agent-adapter-operations.ts` | 修改 | 診斷訊息中的 `/v1/events` | 完成 |
| `src/types/agent-adapter.ts` | 修改 | generic-http 的 `sourceLabels` | 完成 |
| `src/utils/agent-label.ts` | 修改 | 改由 adapter registry 查表 | 完成 |
| `tests/local-wire-contract.test.mts` | 新增 | 契約值固定與 integration 腳本比對 | 完成 |
| `tests/agent-label.test.mts` | 新增 | History adapter id 顯示結果固定 | 完成 |
| `tests/agent-source-registry.test.mts` | 修改 | `validSources` 改為等於經過 hook 的家族來源 | 完成 |
| `tests/opencode-plugin.test.mts` | 修改 | 改用真正的模板產生函式 | 完成 |
| `docs/dev/agent-sources.md` | 修改 | 更新「hook 這一側要另外改」與 agent-label 推導 | 完成 |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 記錄契約模組位置與規則 | 完成 |
| `docs/phase-reports/refactor-05-local-wire-contract.md` | 新增 | 本階段工作記錄 | 完成 |
