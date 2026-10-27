# 交接：插件宿主（Plugin Host）Phase 12–16 實作

> 給執行者（Codex）的完整指示。請 **從頭到尾讀完** 再開始。
> 設計依據：`docs/architecture/Plugin-System-Plan.zh-TW.md`（以下稱「規劃文件」）。本文件與規劃文件衝突時，以本文件為準，並在 phase report 記錄衝突。

---

## 0. 工作方式（最重要）

### 0.1 分支與合併

- 分支：`feat/plugin-host`（已建立，基於 `main` 的 `a4567d6`）。所有工作都 commit 在這個分支。
- **不要開 PR、不要合併、不要 rebase、不要 force push。** 整個 Phase 12–16 完成並經使用者確認後，才由使用者開 PR 合併。
- 每完成一個 checkpoint：跑完 §0.4 的檢查 → commit → `git push origin feat/plugin-host`。

### 0.2 一次執行一個 Phase，Phase 結束就停

- 每次只做 **一個 Phase**（例如只做 Phase 12）。Phase 內依序完成所有 checkpoint（12.1、12.2…），**checkpoint 之間不要停下來問**。
- Phase 最後一個 checkpoint 完成後 **停止**，回報（見 §0.6），等待複檢。複檢意見會以「修正清單」交回給你，修完再開始下一個 Phase。
- 遇到本文件沒寫、而且會影響安全邊界或公開契約的決定：**不要自己猜**。選最保守的做法（拒絕／不開放／fail closed），在 phase report 的「待決問題」列出，繼續做其他部分。

### 0.3 絕對不能做的事

- 不改 `package.json` 的 `version`，不改 `pnpm-lock.yaml` 的版本資訊，不打 tag，不發 release（`main` 上版本號一變就會自動發版）。
- 不修改 `.claude/` 目錄。
- 不新增 `package-lock.json`；只用 `pnpm`。
- 不新增任何 runtime 相依套件（`dependencies`）。真的需要時停下來在報告中說明。devDependencies 也盡量不加。
- 不給插件任何 Node、檔案系統、shell、Permission 回應、XP、成就、quota、history 的存取。
- 不在 log、錯誤訊息、UI 顯示 token、密鑰、`x-agent-pets-token`。
- 不重構與當前 checkpoint 無關的程式碼；`electron/main.ts` 只加「接線」，邏輯放進新的獨立模組。

### 0.4 每個 checkpoint 必跑的檢查

```bash
pnpm exec vue-tsc --noEmit
pnpm test:unit
pnpm exec vite build
pnpm check:bundle
git diff --check
```

全部通過才能 commit。失敗就修到通過；修不好就在 commit 前停下並回報，**不要 commit 壞掉的狀態**。

注意：不要跑 `pnpm build`（它會執行清理本機 Agent Pets 程序的 preflight 並打包），除非該 checkpoint 明確要求。

§0.4 是 **每個 checkpoint 的最低要求**，不是唯一允許的指令。下列 §0.4a、§0.4b 在 Phase 的最後一個 checkpoint（或複檢修正收尾）**必須執行**。

### 0.4a Electron 實機驗證（必做）

Phase 13 複檢證明：單元測試全過，但插件在真實 Electron 中完全跑不起來。所以每個 Phase 收尾都要實際啟動 Electron 驗證。不需要操作畫面，用下面的隔離方式即可：

1. `pnpm exec vite build`
2. **一律使用隔離啟動腳本**（不要再自己組 electron 指令或用 `pnpm dev`）：
   ```bash
   node scripts/e2e-isolated-electron.mjs
   ```
   腳本會在 App 任何程式載入前：設定暫存 userData、以暫存 `HOME` 啟動、把 `safeStorage` 換成會計數的假實作，並驗證三者；任一不符就直接結束、不載入 App。看到輸出 `AGENT_PETS_E2E_READY {...}`（含暫存路徑與 `fakeSafeStorage: true`）才繼續；沒看到就停止驗收並回報。
3. 主程序 inspector 可讀 `globalThis.__agentPetsE2E`（`root`、`userData`、`calls`：safeStorage 各方法呼叫次數）。驗收報告要記錄開始與結束時的 `calls`。
   （本機 17373–17375 埠被已安裝的 App 佔用時會印出 already in use，屬正常。）
4. `curl http://127.0.0.1:9348/json/list` 取得各視窗的 WebSocket；`curl http://127.0.0.1:9349/json/list` 取得主程序。用 Node 內建 `WebSocket` 送 CDP `Runtime.evaluate`（`awaitPromise: true, returnByValue: true`）。
5. 需要選檔時，在主程序執行
   `process.mainModule.require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['<套件路徑>'] })`，再在面板呼叫 `window.electronAPI.selectPluginArchive()` 等 API。
6. 寵物視窗的狀態可用 `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')` 讀寫；截圖用 CDP `Page.captureScreenshot`。
7. 若曾修改建置輸出，驗完重新 `pnpm exec vite build`。
8. **絕對不可觸發使用者的 macOS 鑰匙圈或系統權限視窗**：隔離啟動腳本已在載入前替換 `safeStorage`，不需要也不可以再用真實實作測試。插件面板或 Worker 的測試 **不可呼叫真實的相機、麥克風、定位、螢幕錄影等 API**（會跳 macOS 權限視窗）；權限拒絕改用 `navigator.permissions.query(...)`、`Notification.requestPermission()` 這類不會跳系統視窗的方式驗證。真實鑰匙圈與系統權限行為列為「未驗證（需使用者在正式版手動確認）」。
9. 驗完用 `pkill -f "agent-pets-e2e-"` 關閉。

### 0.4b 安全檢查（必做）

- `pnpm audit --prod --audit-level moderate`，記錄結果。
- 對本 Phase 的 diff 做 secret pattern 掃描（私鑰、GitHub／OpenAI／Slack token、AWS key、Google API key），記錄結果。

### 0.5 commit 訊息格式

```
feat(plugin): [P12.1] 新增插件 manifest 型別與驗證

<條列做了什麼>

Checkpoint: P12.1
```

- 類型可用 `feat` / `refactor` / `test` / `docs`；方括號內為 checkpoint 編號。
- 一個 checkpoint 可以有多個 commit，但最後一個 commit 的訊息要有 `Checkpoint: P12.1` 這行，代表該 checkpoint 完成。

### 0.6 Phase 結束時的回報

Phase 最後一個 checkpoint 必須：

1. 寫 `docs/phase-reports/phase-<N>-<slug>.md`（格式參考 `docs/phase-reports/phase-6-presentation-mcp.md`），內容包含：
   - 日期、目前版本（不改）、階段狀態、建議版本（整個 Phase 12–16 建議 minor `1.3.0`，但 **不要改**）。
   - checkpoint 表：編號、內容、commit SHA、結果。
   - Acceptance criteria 表（本文件每個 Phase 的「驗收」逐條對應）。
   - 每個 §0.4 檢查的實際指令與結果（測試數量、通過／失敗）。
   - 安全檢查（照 `.agents/skills/pet-skill/references/phase-gates.md` 的 Security gate 逐項）。
   - 實際 Electron 驗證步驟與結果（`pnpm dev` 下實際操作了什麼、看到什麼）。沒驗到的寫「未驗證」，不要寫通過。
   - 「手動驗收步驟」清單：無法自己操作 Electron 視窗時，寫出複檢者可以直接照做的步驟與每一步的預期結果。
   - 殘餘風險、未測平台（例如只在 macOS 驗證，Windows 未驗證）。
   - 待決問題。
2. 更新工作記錄（見 §0.7）。
3. push 後停止，最後一則訊息只寫：Phase 編號、最後 commit SHA、phase report 路徑、待決問題清單。

### 0.7 工作記錄（Work Intelligence）

規則：**一個 Phase 一筆工作記錄，Phase 內每個 checkpoint 更新同一筆。**

- 專案已在 Work Intelligence 追蹤。依 work-intelligence skill 的流程操作。
- 規劃 Session（父記錄）：`0a84ada3-c88c-4197-9e8e-3d84a1747e6a`。
- **Phase 第一個 checkpoint 完成時**：`work_finalize_session` 建立該 Phase 的記錄。
  - `idempotencyKey`：`agent-pets-plugin-host-phase-12`（Phase 13 用 `-phase-13`，以此類推）
  - `title`：`插件宿主 Phase 12：Plugin Core`（依 Phase 名稱）
  - `parentSessionId`：`0a84ada3-c88c-4197-9e8e-3d84a1747e6a`
  - `verification.status`：`in_progress`
  - `startedAt`：開始這個 Phase 的時間（有依據才填，不要猜）
  - `changedFiles`：目前為止這個 Phase 實際改動的檔案
- **之後每個 checkpoint 完成時**：更新同一筆，不要建立新記錄。
  - 用 `work_update_session_work_summary`（`mode: "patch"`，每次新的 idempotencyKey，例如 `agent-pets-plugin-host-phase-12-cp2`）補上 outcomes／scope／verification。
  - 用 `work_update_session_metadata` 更新 changedFiles 與 git commit。
- **Phase 最後一個 checkpoint**：把 verification 改成 `passed` 或 `failed`（依實際結果），`nextSteps` 寫待決問題與未驗證項目。
- 複檢後的修正也更新同一筆記錄，不要開新的。

---

## 1. 開始前先讀

1. `AGENTS.md`、`.agents/skills/pet-skill/SKILL.md` 及其 `references/`（特別是 `project-map.md`、`phase-gates.md`、`liquid-glass.md`、`ui-design-system.md`）。
2. 規劃文件全文。
3. 以下既有程式，新程式要照它們的寫法：

| 參考 | 用途 |
|---|---|
| `electron/presentation-controller.ts` + `tests/presentation-controller.test.mts` | 輸入驗證（`isRecord`、NFKC、去控制字元與 `<>`）、TTL、佇列、速率限制、可注入 `now()` 的寫法與測試寫法 |
| `electron/desktop-preferences.ts` | 偏好檔的讀寫（`readBoundedJson`、`writeJsonAtomic`）、patch 驗證 |
| `electron/main.ts` 的 `assertTrustedIpcSender`、`safeJoin`、`isSupportedRasterImage`、`readRegularFileWithin`、`configureSecureProtocol`、`import-pet-zip` handler | IPC 寄件者驗證、路徑安全、圖片驗證、`agent-pets://` protocol、zip 匯入 |
| `electron/preload.ts` + `src/env.d.ts` | preload 暴露 API 的寫法；兩者必須同步 |
| `src/i18n.ts`、`src/locales/zh-TW.json`、`src/locales/en-US.json` | 所有 UI 文字；新 key 兩個語系都要加（缺一個會編譯失敗） |
| `src/components/ui/*`、`src/styles/tokens.css` | 按鈕、卡片、開關、下拉、確認框、圖示；不要手刻 |
| `src/components/DesktopPet.vue`（約 520–640 行的 `v-if` 泡泡鏈）、`src/stores/agentStore.ts` | 現有泡泡與 toast |
| `src/components/StatusPanel.vue` | 設定面板與分頁（`role="tablist"`、`settings-tab-*`） |

4. 測試指令是 `node --test`，測試檔放 `tests/*.test.mts`，從 `../electron/xxx.ts` 匯入。**可測的邏輯一律寫成不依賴 Electron 的純模組**（不要在可測模組 import `electron`），Electron 接線放在另外的檔案或 `main.ts`。

---

## 2. 全域設計規則（所有 Phase 都適用）

- **所有來自插件的資料都不可信**：Main 端逐筆驗證型別、長度、範圍；驗證失敗回錯誤碼，不 throw 到插件、不中斷其他插件。
- **插件身分由宿主決定**：哪個 Worker／面板頁是哪個插件，由宿主建立時記錄；**絕對不採用訊息裡自稱的 pluginId**。
- **fail closed**：任何不確定（權限未宣告、設定讀取失敗、超過上限）一律拒絕。
- **路徑**：插件檔案只從 `userData/plugins/<id>/<version>/` 讀取，一律經 `safeJoin` + realpath 檢查（參考 `readRegularFileWithin`），拒絕 symlink。
- **錯誤碼**：統一用字串 union（例如 `'not_permitted' | 'rate_limited' | 'invalid_request' | 'too_large' | 'timeout' | 'host_not_allowed' | 'disabled'`），定義在 `src/types/plugin.ts`。
- **UI 文字**：全部走 `t()`，zh-TW 與 en-US 同時新增。插件提供的文字（名稱、通知）一律當純文字顯示（Vue `{{ }}` 插值），絕不用 `v-html`。
- **視覺**：照 `liquid-glass.md`；插件通知泡泡沿用現有 `pet-toast` 樣式體系，加上來源標籤；面板內容用穩定的內容層，不要 glass-on-glass。
- **id 規則**：插件 id 符合 `^[a-z0-9-]{3,48}$`，且不能是保留字 `_host`、`_shared`。

---

## 3. Phase 12 — Plugin Core（不執行任何第三方程式碼）

目標：把契約、驗證、套件安全、泡泡仲裁、插件通知控制器與偏好做成 **純模組 + 測試**。這個 Phase 結束時，App 的使用者可見行為 **完全不變**。

### P12.1 契約與 manifest 驗證

- 新增 `src/types/plugin.ts`：
  - `PluginManifest`（欄位照規劃文件 §4 範例：`id`、`name`（zh-TW/en-US）、`version`（semver `x.y.z`）、`apiVersion`（目前只接受 `"1"`）、`author`、`entry`、`icon?`、`permissions`、`contributes`）。
  - `permissions`：`network?: { hosts: string[]; userGranted?: boolean }`、`secrets?: string[]`、`schedule?: { minIntervalSec: number }`、`storage?: boolean`、`agentStatus?: boolean`。
    （注意：規劃文件範例寫成 `network: ["api.x.com"]`，這裡統一改為物件形式以容納 `userGranted`；規格文件以此為準。）
  - `contributes`：`feed?: boolean`、`reaction?: boolean`、`settings?: PluginSettingsSchema`、`panelView?: { entry; title; preferredSize? }`。
  - `FeedItemInput`、`PluginFeedItem`（宿主送進 renderer 的淨化版本，含 `pluginId`、`pluginName`、`iconUrl?`）、`PetStatusChange`、錯誤碼 union、`PluginRuntimeState`（`installed`/`enabled`/`disabled_crashed`/`incompatible`）。
- 新增 `electron/plugin-manifest.ts`：`parsePluginManifest(value: unknown): { ok: true; manifest } | { ok: false; error: string }`。
  - 規則：未知頂層欄位拒絕；字串長度上限（name ≤ 48、author ≤ 64、title ≤ 48）；`network.hosts` 每個必須是合法主機名稱或 `*.domain.tld`（萬用字元只能在最左邊、至少兩層），拒絕 IP、`localhost`、含 port、含 path；最多 20 個 host；`secrets` key 符合 `^[a-zA-Z][a-zA-Z0-9_]{0,31}$`、最多 10 個；`schedule.minIntervalSec` 為 30–3600 的整數；`entry`／`panelView.entry`／`icon` 為相對路徑、不含 `..`、不以 `/` 開頭；`entry` 必須 `.js`、`panelView.entry` 必須 `.html`、`icon` 必須 `.png`/`.webp`；`settings` schema 只允許 `type: object` + `properties`，property 只允許 `type` 為 `string`/`number`/`boolean`、可有 `title`（zh-TW/en-US 物件或字串）、`enum`、`maxLength`、`minimum`、`maximum`、`format: "secret"`、`default`；最多 20 個 property。`format: "secret"` 的 key 必須同時出現在 `permissions.secrets`。
  - `preferredSize` 超出範圍時夾到界限內（寬 320–960、高 240–800），不視為錯誤。
- 新增 `tests/plugin-manifest.test.mts`：每條規則至少一個正向與一個反向案例。

### P12.2 共用 archive-guard

- 新增 `electron/archive-guard.ts`（不 import electron）：輸入 zip bytes 與限制參數，回傳安全的檔案 map 或錯誤。
  - 限制：總解壓大小、單檔大小、檔案數、副檔名白名單、禁止絕對路徑／`..`／反斜線路徑／磁碟代號、忽略目錄項目、拒絕重複路徑（大小寫不敏感比對）。
  - 用 `fflate` 的 `unzipSync`，並用 `filter` 在解壓前先檢查 `originalSize`，避免 zip bomb 先解壓才發現。
- 讓 `electron/main.ts` 的 `import-pet-zip` handler 改用 archive-guard（寵物匯入的既有限制數值不變）。
- 插件套件的限制：總大小 ≤ 5MB、檔案數 ≤ 64、副檔名 `.js .json .png .webp .html .css`；`.html` 只能在 `panelView.entry` 所在目錄；**這條插件專屬規則放在 P13.1 的安裝流程檢查**，archive-guard 本身保持通用。
- 新增 `tests/archive-guard.test.mts`：在測試內用 fflate `zipSync` 動態產生 zip（不要提交二進位檔），涵蓋正常、`../evil`、絕對路徑、超量檔案、超大單檔、副檔名不允許、重複路徑。
- 驗收：既有寵物 zip 匯入行為不變（手動在 `pnpm dev` 匯入一個寵物 zip 確認）。

### P12.3 泡泡仲裁純函式

- 新增 `src/utils/feed-arbiter.ts`：`selectBubble(candidates): BubbleSelection`。候選與優先順序照規劃文件 §3.3：
  1. permission request
  2. permission notice
  3. Presentation MCP say（複檢 R6 修正：維持 Phase 12 前順序）
  4. Agent timed toast
  5. plugin feed（normal）
  6. activity 文字／plugin feed（low）
- 把 `DesktopPet.vue` 現有的 `v-if / v-else-if` 鏈改為依 `selectBubble` 的結果渲染（插件候選目前永遠是空的）。**所有現有條件要原封保留**（例如 `permissionBubbleActive`、`bubbleActive`、`!isMultiPet && activityText`），只是搬進純函式。
- 新增 `tests/feed-arbiter.test.mts`：每個優先順序組合，以及「插件通知不受 `bubbleEnabled` 影響、只看插件側開關」。
- 驗收：`pnpm dev` 下觸發權限請求、完成 toast、MCP `pet_say`（可用既有 presentation 測試方式）、activity，顯示結果與改動前相同；在 phase report 逐項記錄。

### P12.4 插件通知控制器與插件偏好

- 新增 `electron/plugin-feed.ts`（不 import electron，可注入 `now()`）：`PluginFeedController`
  - `submit(pluginId, input)`：驗證 `FeedItemInput`（title ≤ 60、body ≤ 240，用與 `normalizePresentationMessage` 相同的淨化；`link` 必須 https 且 host 在該插件允許清單（由呼叫者傳入判斷函式）；`priority` 只收 `low`/`normal`；`ttlMs` 1000–15000，預設 6000；`dedupeKey` ≤ 128）。
  - 每插件速率（預設 5 則／10 分鐘，由偏好提供）、全域上限（預設 60 則／10 分鐘）、佇列深度 8、`dedupeKey` 去重（同插件 24 小時內同 key 只收一次，最多記 500 個 key）。
  - 可見性：呼叫者提供 `isPetVisible()`；不可見時 **不送 renderer**，改存進通知中心並增加未讀數；可見性由 false 變 true 時只補送 **最新一則**。
  - 通知中心：每插件最多保留 100 則、全部最多 500 則，可列出、標記已讀、清除；提供 `unreadCount()`。
  - DND、插件總開關關閉、該插件停用或靜音：不送 renderer、也不計入速率；靜音的仍進通知中心。
- 新增 `electron/plugin-preferences.ts`（照 `desktop-preferences.ts` 的寫法）：
  - 全域：`pluginsEnabled`（預設 `false`）、資源上限（規劃文件 §3.4 表格的預設值與硬上限；超出硬上限的值拒絕）、`developerMode`（預設 `false`）。
  - 每插件：`enabled`（安裝後預設 `false`）、`muted`、`rateLimitPer10Min`（1–30，預設 5）、`targetPetId`（`null` 表示主寵物）、`grantedHosts`（字串陣列，最多 50）。
  - 存在 `userData/plugin-preferences.json`，用 `writeJsonAtomic`。
- 新增 `tests/plugin-feed.test.mts`、`tests/plugin-preferences.test.mts`。

### P12.5 Phase 12 收尾

- 寫 `docs/phase-reports/phase-12-plugin-core.md`。
- 驗收清單（報告中逐條勾）：
  - [ ] 使用者可見行為與 Phase 12 前完全相同（泡泡、寵物匯入）。
  - [ ] manifest、archive-guard、feed-arbiter、plugin-feed、plugin-preferences 都有正反向測試且通過。
  - [ ] 新純模組沒有 import `electron`。
  - [ ] 沒有新增 runtime 相依、沒有改版本號。
- 停止並回報。

---

## 4. Phase 13 — Sandbox Host + 本機安裝

目標：可以從本機檔案安裝插件、在沙箱 Worker 中執行，並透過 `feed`、`reaction`、`storage`、`log` 讓寵物顯示插件通知。

### P13.1 PluginRegistry（安裝、更新、移除）

- 新增 `electron/plugin-registry.ts`（核心邏輯不 import electron；路徑由呼叫者傳入）。
- 安裝流程：讀檔（≤ 5MB）→ archive-guard（插件限制）→ 讀 `plugin.json` → `parsePluginManifest` → 檢查 `entry`、`icon`、`panelView.entry` 檔案確實存在於套件內 → `.html` 位置規則 → icon 用 `isSupportedRasterImage` 驗證 → 產生「安裝計畫」（新安裝／更新／降版／重裝同版，以及權限差異）回給 UI 確認 → 使用者確認後寫入 `userData/plugins/<id>/<version>/`（先寫到暫存目錄再 rename，失敗要清掉暫存）→ 更新 `userData/plugins/registry.json`（目前版本、狀態、安裝時間、已同意的權限快照）。
- 更新：保留設定與資料；新版權限比已同意的多 → 需要重新同意，未同意則維持舊版。
- 降版：允許，安裝計畫標示 `downgrade`，UI 要再確認一次並列出權限差異。
- `apiVersion` 不是 `"1"` → 安裝計畫標示 `incompatible`，拒絕安裝。
- 移除：參數 `keepData: boolean`。`keepData=false` 刪除程式檔、storage、設定、通知中心紀錄、已授權網域；`keepData=true` 只刪程式檔，其餘保留，重裝同 id 時沿用。**密鑰（P14 才有）一律刪除**，先在 registry 預留這個步驟。
- 只保留目前版本的程式檔，舊版本目錄在更新成功後刪除。
- 新增 `tests/plugin-registry.test.mts`（用暫存目錄 `fs.mkdtempSync`）。

### P13.2 `agent-pets://plugin/` protocol 與 Plugin Host 視窗

- 擴充 `configureSecureProtocol`：處理 `agent-pets://plugin/<id>/<path>`：
  - `<id>` 為已安裝且 **已啟用** 的插件，檔案從其目前版本目錄讀取（`readRegularFileWithin`，單檔上限 5MB）。
  - `<id>` 為 `_host`：回傳宿主內建的 host 頁與 worker bootstrap（見下）。
  - 所有回應加上 `x-content-type-options: nosniff` 與 CSP：
    `default-src 'none'; script-src agent-pets://plugin; worker-src agent-pets://plugin; connect-src 'none'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  - Content-Type 依副檔名；`.js` 用 `text/javascript`。
- Plugin Host 視窗（新增 `electron/plugin-host-window.ts`）：
  - 隱藏的 `BrowserWindow`（`show: false`），`webPreferences`：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`、`partition: 'plugin-host'`（不持久化）、`devTools: !app.isPackaged`、`preload` 指向新的 `plugin-host-preload.js`。
  - 載入 `agent-pets://plugin/_host/index.html`。
  - 該 session：`setPermissionRequestHandler` 一律拒絕；`webRequest.onBeforeRequest` 只放行 `agent-pets://plugin/` 開頭的 URL，其他全部 cancel；禁止 `will-navigate`、`setWindowOpenHandler` 回 deny、`will-download` cancel。
  - 沒有任何啟用中的插件時不建立；最後一個插件停用時關閉。
  - 在寵物視窗 `ready-to-show` 之後才建立（不拖慢啟動）。
- 新增 preload `electron/plugin-host-preload.ts`，在 `vite.config.mts` 的 `preload.input` 改成物件形式加入第二個 entry（先確認 `vite-plugin-electron/simple` 支援；不支援就在報告中說明替代做法）。這個 preload **只** 暴露一個 `MessagePort` 的取得方式（例如 `window.agentPetsPluginHost.onPort(cb)`），不暴露任何其他 API。
- Host 頁（內建字串或 `electron/plugin-host/` 下的靜態檔，打包時要能被讀到）：
  - 從 preload 拿到與 Main 通訊的 port。
  - 依 Main 指示為每個插件建立 `new Worker('agent-pets://plugin/_host/worker-bootstrap.js?plugin=<id>', { type: 'module', name: <id> })`；在 Host 頁記錄 `Worker 物件 → pluginId`，轉送訊息給 Main 時 **由 Host 頁加上 pluginId**，Main 再以「這條 port 是 Host 視窗的」為前提信任它。
  - worker-bootstrap：建立 `api` 物件（只是 RPC stub：送 `{ id, method, args }`、等待結果），然後 `await import('agent-pets://plugin/<id>/<entry>')`，呼叫其 `default.activate(api)`。
  - 規劃文件中的 `definePlugin` 只是作者端的語法糖：宿主只要求 entry 的 default export 有 `activate(api)` 函式，可選 `deactivate()`。
- 心跳：Main 每 10 秒對每個 Worker 發 ping，30 秒沒回應 → 終止該 Worker、記一次崩潰；連續 3 次崩潰 → 狀態改 `disabled_crashed`，並在通知中心記一則系統訊息。
- 記憶體：依規劃文件 §3.4 的修正做法（Host 程序總記憶體監控），每 30 秒檢查一次。

### P13.3 RPC 與 Host API（feed / reaction / storage / log）

- 新增 `electron/plugin-broker.ts`：處理來自 Host 的 RPC。每個請求：
  1. 結構驗證（`{ id: string ≤ 64, method: 已知字串, args: 陣列 }`，訊息 JSON 序列化後 ≤ 256KB）。
  2. 權限檢查（`feed.notify` 需要 `contributes.feed`；`pet.react` 需要 `contributes.reaction`；`storage.*` 需要 `permissions.storage`）。
  3. 執行並回 `{ id, ok: true, value }` 或 `{ id, ok: false, error }`。
- `pet.react`：沿用 `PRESENTATION_REACTIONS` 與 presentation 的 TTL 規則，走與 MCP 相同的低優先層，受插件總開關、該插件啟用、DND 控制，並套用 feed 的速率限制。
- `storage`：每插件一個 JSON 檔 `userData/plugins/<id>/data/storage.json`，key ≤ 128 字、值必須 JSON 可序列化、總大小 ≤ 偏好中的上限；寫入用 `writeJsonAtomic`，並節流（同插件 1 秒內合併寫入）。
- `log`：每則 ≤ 1000 字、每插件保留最後 200 則（記憶體內），只在面板診斷頁顯示；內容當純文字處理。
- 新增 `tests/plugin-broker.test.mts`：未宣告權限、超大訊息、未知 method、storage 超量、速率限制。

### P13.4 寵物端的插件通知

- Main 把 `PluginFeedController` 放行的通知以新 IPC 頻道 `plugin-feed-item` 送到寵物視窗（只送淨化後的 `PluginFeedItem`）。`preload.ts` 與 `env.d.ts` 同步新增監聽 API。
- `agentStore` 新增插件通知候選，交給 `selectBubble`。
- 泡泡內容：插件圖示（16px，來源 `agent-pets://plugin/<id>/<icon>`；寵物視窗的 CSP 如有需要要允許這個來源的圖片）、插件名稱標籤、title、body、關閉按鈕；有 `link` 時本體可點擊。點擊送 IPC `plugin-feed-open-link`（帶通知 id，不帶 URL），Main 依 id 找到原始 URL、再次檢查白名單後 `shell.openExternal`。
- 顯示在哪隻寵物：`targetPetId`，`null` 時為主寵物（目前選定的寵物；多寵物模式下最左邊那一隻）。
- 可見性：Mini／Edge、`desktop-visibility` 隱藏、全螢幕偵測為隱藏時，視為不可見；Edge 把手顯示未讀數（沿用 Edge handle 的現有樣式加一個小數字徽章，數字 > 99 顯示 `99+`）。
- 所有新 IPC handler 都用 `assertTrustedIpcSender`，並驗證 payload。
- 接線 `PluginFeedController` 時：泡泡顯示結束（倒數到期或使用者關閉）要呼叫 `complete(itemId)`，否則佇列會卡住；寵物可見性（Mini／Edge／隱藏／全螢幕）每次改變都要呼叫 `onVisibilityChanged()`；DND 狀態改變時也呼叫一次。
- 注意 phase-gates 的「Hot-path synchronous I/O」：通知路徑上不要做同步檔案寫入。

### P13.5 設定面板「插件」分頁

在 `StatusPanel.vue` 的設定分頁新增「插件」（若檔案太大，把內容拆成新元件 `src/components/PluginPanel.vue`，參考 `ProjectMcpPanel.vue` 的拆法）。內容：

- 插件總開關（`ToggleRow`）。
- 「安裝插件…」按鈕 → Main 開原生檔案選擇（副檔名 `.agentpet-plugin`）→ 回傳安裝計畫 → `ConfirmDialog` 顯示：插件名稱、版本、作者、安裝類型（新安裝／更新／降版）、權限清單（用 i18n 把每個權限翻成人話，例如「連線至 api.x.com」「在狀態泡泡顯示通知」「可得知 Agent 何時忙碌／閒置／等待」），以及固定警示「插件來自第三方，Agent Pets 無法保證其內容」。降版時多一行「你正在安裝較舊的版本」。
- 已安裝清單：每列顯示圖示、名稱、版本、狀態（啟用／停用／因崩潰停用／不相容），操作：啟用開關、靜音、移除。長名稱要用 `min-width: 0` + 省略號（phase-gates 常見問題）。
- 移除確認框含「保留設定與資料」勾選（預設不勾）。
- 診斷：選一個插件可看到最近 log 與被拒原因。
- 通知中心：列出插件通知（來源、時間、內容），可標記已讀、清除。
- 所有新文字加到兩個語系。
- 新 IPC 一律只允許面板視窗呼叫（`assertTrustedIpcSender(event, panelWindow)`）。

### P13.6 測試插件與 Phase 13 收尾

- 在 `tests/fixtures/plugins/` 建立測試插件的 **原始檔**（`plugin.json` + `dist/main.js` + icon），測試時用 `zipSync` 打包。至少：
  - `ok-notify`：每次啟動送一則通知、寫入並讀回 storage。
  - `evil-fetch`：嘗試 `fetch('https://example.com')`、`new WebSocket(...)`、`importScripts`、`import('https://...')`。
  - `evil-loop`：`while(true){}`。
  - `evil-spam`：一次送 100 則通知。
  - `evil-xss`：通知內容含 `<img src=x onerror=alert(1)>`。
  - `evil-spoof`：RPC 訊息中自稱是 `ok-notify`、呼叫未宣告權限的 method。
  - `evil-zip`：含 `../` 路徑、超量檔案（直接在測試中產生）。
- 單元測試涵蓋可純測的部分；Worker 行為用 `pnpm dev` 實際安裝驗證，並在報告記錄每個 evil 插件的實際結果。
- 開發用的打包方式：在報告中寫出你用來把 fixture 打成 `.agentpet-plugin` 的指令（可寫一個 `scripts/pack-test-plugin.mjs`，只供測試，不進產品）。
- 寫 `docs/phase-reports/phase-13-plugin-sandbox.md`。驗收：
  - [ ] 本機安裝、更新、降版確認、重新同意、移除（保留／不保留）都在 `pnpm dev` 實測。
  - [ ] `ok-notify` 的通知以泡泡顯示，帶來源標籤；寵物縮小時進通知中心、Edge 把手有未讀數、恢復後只補最新一則。
  - [ ] 每個 evil 插件都被擋下或被終止，App 其他功能正常。
  - [ ] 插件總開關關閉時，沒有任何插件在執行（Host 視窗不存在）。
  - [ ] 新 IPC 都驗證寄件者與 payload。
- 停止並回報。

---

## 5. Phase 14 — 網路、密鑰、設定、排程、Agent 狀態

### P14.1 `net.fetch`

- 新增 `electron/plugin-net.ts`：
  - 純函式（可測）：URL 驗證（只收 `https:`、無帳密、port 只能空或 443）、host 比對（manifest hosts，含 `*.domain` 萬用字元，加上 `grantedHosts`）、IP 黑名單判斷（IPv4／IPv6 的 loopback、私有、link-local、CGNAT `100.64/10`、`0.0.0.0/8`、multicast、IPv4-mapped IPv6）。
  - 執行：先 `dns.lookup(host, { all: true })`，任何一個結果落在黑名單就拒絕；再用 Electron `net.fetch`（或 `net.request`），`redirect: 'manual'`，自己跟隨 redirect（最多 3 次），每一跳都重新做 URL、host、DNS 檢查。
  - 限制：逾時、單次回應大小（串流讀取，超過就中止）、每分鐘次數，數值來自偏好。
  - 請求：method 只收 `GET`/`POST`/`PUT`/`DELETE`/`PATCH`；header 名稱白名單外的拒絕（不允許 `Host`、`Cookie`、`Origin` 等）；body ≤ 256KB 字串。
  - 回應：`{ status, headers（只回 content-type、etag、last-modified、retry-after）, body: string }`；非文字回應以 base64 回傳並標示。
  - 不帶 cookie（用獨立、不持久的 session）。
- 已知限制寫進報告：DNS 檢查與實際連線之間仍有 DNS rebinding 的時間差。

### P14.2 執行時網域申請 `net.requestHost`

- 需要 `permissions.network.userGranted: true`。
- 驗證 host（單一主機名稱，不收萬用字元、IP、localhost、私有網段）。
- 跳出確認框：用 `dialog.showMessageBox`（附在寵物或面板視窗），文字走 `t()`，內容顯示插件名稱、網域、插件提供的理由（≤ 120 字，純文字）。按鈕：「允許」「拒絕」。
- 同意 → 加入 `grantedHosts`。拒絕 → 24 小時內同網域直接回 `denied`。每插件每 10 分鐘最多 3 次申請。
- 面板該插件設定中可檢視、撤銷已授權網域。

### P14.3 密鑰與設定

- 密鑰：`safeStorage.encryptString` 加密，存在 `userData/plugins/<id>/data/secrets.json`（值為 base64 密文）。`safeStorage.isEncryptionAvailable()` 為 false 時拒絕儲存並在 UI 說明。只能從面板設定頁寫入；`secrets.get` 只能讀 manifest 宣告的 key。移除插件時一律刪除。
- 設定：面板依 manifest 的 `settings` schema 產生表單（只支援 P12.1 定義的子集），`format: "secret"` 的欄位用密碼輸入框、寫入密鑰儲存、不回顯原值（只顯示「已設定」）。
- `settings.get()` 回傳非密鑰欄位；`settings.onChange` 在使用者儲存後通知 Worker。

### P14.4 排程與 Agent 狀態

- `schedule.every(sec, fn)`：在 bootstrap 端實作，但最短間隔由 Main 告知（取 manifest `minIntervalSec` 與偏好最短間隔的較大值）；小於最短間隔的值自動提高。插件停用時清除。
- `pet.status()` / `pet.onStatusChange()`：需要 `permissions.agentStatus`。資料只含 `petId`、`name`、`agentFamily`（`'codex' | 'claude-code' | 'opencode' | null`）、`previousState`、`visibleState`、`dnd`、`at`。同一隻寵物 1 秒內的變化合併成一次。**新增測試確認輸出物件的 key 恰好是這些**（防止日後誤加 session／專案欄位）。
- 資料來源：沿用 Presentation status 的淨化快照（`PresentationStatusSnapshot`）路徑，必要時擴充 `agentFamily`，不要從原始事件直接組。

### P14.5 每插件設定與進階資源上限

- 每插件設定頁：通知速率（1–30）、顯示的寵物（下拉：主寵物＋目前所有寵物）、靜音、已授權網域清單（可撤銷）、插件自己的 settings 表單。
- 「插件 ▸ 進階」：規劃文件 §3.4 表格的每一項，顯示預設值，超出硬上限的輸入拒絕並提示範圍。
- 權限升級重新同意：P13.1 已有流程，這裡補 UI 與實測。

### P14.6 開發者模式與對外規格

- 開發者模式（進階頁的開關，預設關）：開啟後可「從資料夾載入插件」，略過打包但 **其他驗證完全相同**；資料夾內檔案變更時（`fs.watch`，debounce 500ms）自動重新載入該插件；面板標示「開發中」。
- 對外開發者文件（給第三方作者），結構見下方 §7.1「插件開發者文件規格」。本 checkpoint 要完成：
  - `docs/plugins/README.zh-TW.md` 與 `docs/plugins/README.md`（索引頁）。
  - §7.1 中標示 **P14.6** 的所有頁面（中英文各一份）。
  - `docs/plugins/plugin.schema.json`：manifest 的 JSON Schema（與 `parsePluginManifest` 一致；在測試中加一個檢查，確保 schema 中的必要欄位、列舉值與驗證器一致）。
  - `docs/plugins/agent-pets-plugin.d.ts`：Host API 型別，每個方法附 JSDoc（用途、需要的權限、可能的錯誤碼、範例）。
  - 文件中的範例程式碼放在 `docs/plugins/examples/<名稱>/`（`plugin.json` + `dist/main.js`），**只供參考，不打包、不隨 App 發佈**；新增一個測試確認每個範例的 `plugin.json` 都能通過 `parsePluginManifest`。
- 寫 `docs/phase-reports/phase-14-plugin-network-settings.md`。驗收：
  - [ ] 測試插件透過 manifest host 成功 fetch；未宣告 host、http、IP、localhost、私有網段、redirect 到私有網段全部被擋。
  - [ ] `requestHost` 確認框、拒絕冷卻、申請速率、撤銷都實測。
  - [ ] 密鑰加密儲存、不回顯、移除時刪除。
  - [ ] `onStatusChange` 在 Codex／Claude 狀態改變時收到事件，欄位只有規定的那些。
  - [ ] 開發者模式資料夾載入與自動重載。
  - [ ] **照 `docs/plugins/getting-started` 入門教學從零做一個插件，用開發者模式載入，在隔離 Electron 中確認泡泡出現**；教學中任何與實際不符的步驟都要修正文件。
- 停止並回報。

---

## 6. Phase 15 — 自訂面板頁（panelView）

### P15.0 威脅模型（先寫，再實作）

- 寫 `docs/security/plugin-panel-view-threat-model.md`，格式參考 `docs/security/phase-2-permission-broker-threat-model.md`。至少涵蓋：逃出沙箱、連外、偽裝成系統 UI、點擊劫持、讀取父視窗、拖放檔案、下載、權限請求、導覽、記憶體耗盡、與 Worker 的訊息濫用。
- commit 後再開始 P15.1。

### P15.1 WebContentsView

- 在面板視窗中，以 `WebContentsView` 載入 `agent-pets://plugin/<id>/<panelView.entry>`。
- `webPreferences`：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`partition: 'plugin-ui-<id>'`（不持久化）、新的 `plugin-ui-preload`。
- preload 只暴露 `api` 的子集：`feed.notify`、`pet.status`、`storage.*`、`settings.get`、`log.*`、`ui.postMessage/onMessage`；**不暴露 `secrets.get`、`net.requestHost`**。`net.fetch` 可暴露（同樣經 Main 白名單）。
- 該 session：`webRequest` 只放行 `agent-pets://plugin/<id>/`（同一插件）與 `agent-pets://plugin/_shared/`；`will-navigate`、`setWindowOpenHandler`、`will-download`、`setPermissionRequestHandler`、拖放檔案全部拒絕。
- 面板頁不可見或使用者切到其他分頁時銷毀 `WebContentsView`。

### P15.2 外框、尺寸、從泡泡開啟

- 外框（面板 renderer 繪製，在 `WebContentsView` 外圍）：插件圖示、名稱、「插件內容」標記、關閉按鈕。`WebContentsView` 的 bounds 只占外框內部區域，外框永遠不被覆蓋。
- 尺寸：依 `preferredSize` 調整面板視窗大小（不超過螢幕工作區）；使用者手動拉過的大小優先，且只對該插件頁生效；切回其他分頁時恢復原本面板大小。插件不能在執行中改尺寸或位置。
- 泡泡「開啟插件面板」按鈕：只在該插件有 `panelView` 時顯示；按下開啟設定面板並切到該插件頁。
- `agent-pets://plugin/_shared/tokens.css`：讀取 `src/styles/tokens.css` 的內容提供（唯讀）。

### P15.3 面板頁 ↔ Worker 訊息通道

- `api.ui.postMessage(data)` / `api.ui.onMessage(cb)`：經 Main 轉送，只限同一插件的 Worker 與面板頁；每則 ≤ 256KB、可 JSON 序列化、每秒 ≤ 20 則；面板頁未開啟時，Worker 送出的訊息直接丟棄。

### P15.4 測試與收尾

- 測試插件 `ok-panel`（顯示 storage 內容、與 Worker 互傳訊息）與 `evil-panel`（嘗試 fetch、`window.open`、`location = 'https://...'`、`window.parent`、`top`、下載、`navigator.mediaDevices.getUserMedia`、拖放、畫一個長得像權限確認框的畫面）。
- 在 `pnpm dev` 實測並記錄每一項。
- 視覺：外框在深色／淺色、高對比、reduced motion 下正確；面板縮放時 `WebContentsView` bounds 正確。
- 開發者文件：完成 §7.1 中標示 **P15** 的頁面（面板頁開發指南），更新索引頁、`agent-pets-plugin.d.ts`（`ui.postMessage`／`onMessage`、`preferredSize`）、`plugin.schema.json`，並新增 `docs/plugins/examples/panel-demo/`（面板頁與背景互傳訊息的最小範例）。在隔離 Electron 中載入這個範例確認可用。
- 寫 `docs/phase-reports/phase-15-plugin-panel-view.md`。
- 停止並回報。

---

## 7. Phase 16 — 徽章、指令、Tray、寵物外觀

目標：補齊規劃文件中 v2 的四個插入點。全部沿用前面 Phase 的 RPC、權限、偏好與 UI 架構，不要另起一套。

### P16.1 manifest 擴充

- `contributes` 新增：
  - `commands?: Array<{ id: string; title: LocalizedText }>`：最多 10 個；`id` 符合 `^[a-z][a-z0-9-]{0,31}$`、插件內不可重複；title ≤ 32 字。
  - `tray?: { commands: string[] }`：最多 5 個，每個必須是 `commands` 裡已宣告的 id。
  - `badge?: boolean`。
  - `skins?: Array<{ id; displayName: LocalizedText; spritesheet: string; kind: 'person' | 'animal'; behaviorManifest?: unknown }>`：最多 5 個；`id` 符合 `^[a-z0-9-]{1,32}$`；`spritesheet` 為套件內 `.webp`/`.png` 相對路徑；`behaviorManifest` 交給既有 `parsePetBehaviorManifest`（`electron/pet-behavior-manifest.ts`）清理。
- `entry` 改為選填，規則：**沒有 `entry` 時，除了 `contributes.skins` 以外不得宣告任何 contribution 或 permission**（違反就拒絕安裝）；有 `entry` 時照舊。沒有 `entry` 的插件不建立 Worker。加正反向測試。
- 套件大小：有 `skins` 時總大小上限放寬到 25MB、單一 spritesheet ≤ 20MB（與既有寵物匯入的 `MAX_PET_IMAGE_BYTES` 一致）；沒有 `skins` 仍是 5MB。
- 同步更新 `docs/plugins/plugin.schema.json`、`agent-pets-plugin.d.ts`、規格文件。
- 權限同意框新增對應的人話描述（「在 Tray 選單新增項目」「在寵物狀態列顯示徽章」「提供 N 個寵物外觀」）。

### P16.2 commands

- Host API：`api.commands.onInvoke(cb: (commandId: string) => void): Disposable`。
- 觸發來源只有使用者操作：Tray 選單（P16.3）與面板該插件頁的「指令」清單（按鈕）。插件不能自己觸發、不能呼叫別的插件的指令。
- Main 收到觸發 → 確認插件啟用、指令已宣告 → 送給該插件 Worker。插件未執行時（例如剛被停用）回報失敗並在面板顯示。
- 每個指令 1 秒內只送一次（防連點）。

### P16.3 Tray

- `electron/desktop-tray.ts` 的選單在既有項目之後、「結束」之前新增「插件」子選單：只列出 **已啟用** 且有 `contributes.tray` 的插件，每個插件一個子選單，裡面是它的指令；全部插件項目合計最多 30 個，超過的不顯示並在面板診斷說明。
- 標籤用插件名稱與指令 title（依目前語系），純文字、超過 32 字截斷加省略號。
- 插件總開關關閉或沒有任何項目時，不顯示「插件」子選單。
- 插件安裝／移除／啟停、語系變更時呼叫 `rebuild()`。
- `DesktopTrayActions` 新增取得插件選單項目與觸發指令的 callback，Tray 本身不直接依賴 registry（保持現有的注入寫法）。

### P16.4 徽章（badge）

- Host API：`api.badge.set(badge: { text: string; tone?: 'neutral' | 'info' | 'warning' } | null)`。
  - `text` ≤ 6 個字（以 `Intl.Segmenter` 或 `Array.from` 計算字元，不要用 `.length`），淨化規則同通知；`null` 清除。
  - 每插件每秒最多 1 次，超過回 `rate_limited`。
- 顯示：在該插件 `targetPetId`（預設主寵物）的狀態列旁（單寵物：`DesktopPet.vue` 約 706 行的 `status-lines`；多寵物：該寵物的 `multi-pet-status-line`）。每隻寵物最多顯示 2 個插件徽章，其餘合併成 `+N`；hover／focus 顯示 tooltip「插件名稱：文字」。
- 寵物看不到時（Mini／Edge／隱藏）不顯示，也不計入未讀。
- 插件停用、移除、崩潰時自動清除。
- 視覺：小型膠囊，沿用 tokens；`warning` 用既有警示色 token；不要做成新的 glass 層（glass-on-glass）。長文字已有字數上限，但仍要 `min-width: 0` 與省略號防溢出。
- 新增 `tests/plugin-badge.test.mts`：字數計算（含 emoji、CJK）、速率、`+N` 合併邏輯（抽成純函式）。

### P16.5 寵物外觀（skins）

- 安裝時驗證每個 spritesheet：存在於套件內、`isSupportedRasterImage`、大小上限。
- 列表：`load-pets` 回傳的寵物清單加入「來自插件」的外觀，id 用 `plugin:<pluginId>:<skinId>`（`availablePetIds()` 與所有使用 pet id 的驗證都要認得這個格式；`sanitizePetId` 目前不允許 `:`，**新增專用的驗證函式**，不要放寬 `sanitizePetId`）。
- 圖片經 `agent-pets://plugin/<id>/<spritesheet>` 提供，依實際 bytes 判斷 content-type（參考 `rasterContentType`）。只有插件 **已啟用** 時才提供與列出。
- 寵物選擇 UI：插件外觀顯示「來自插件：<插件名稱>」標籤；不能重新命名、不能單獨刪除（要移除插件）。
- 插件停用或移除時，若某隻寵物正在使用它的外觀：改回預設寵物，並在通知中心記一則系統訊息。XP／進度記錄沿用既有 pet id 對應方式，**不要刪除** 任何進度資料。
- **既有的寵物 zip 匯入與單張 spritesheet 匯入維持不變**（規劃文件的「整併」在 v1 只代表共用驗證邏輯，不移除舊功能）。
- `electron/plugin-preferences.ts` 的 `targetPetId` 驗證目前只收 `[A-Za-z0-9._-]`，要擴充為也接受合法的 `plugin:<pluginId>:<skinId>`（用同一個專用驗證函式）。
- 新增測試：plugin skin id 驗證、`availablePetIds` 包含已啟用插件外觀、停用後不包含、`targetPetId` 可設為插件外觀 id。

### P16.6 Phase 16 收尾與整體收尾

- 測試插件：`ok-commands`（宣告 2 個指令與 tray、收到指令時送通知並更新徽章）、`ok-skin`（只有 skins、沒有 entry）、`evil-badge`（超長文字、每 10ms 設定一次）、`evil-skin`（spritesheet 是改副檔名的非圖片、超過大小）。
- 以隔離啟動腳本（§0.4a）實測：Tray 子選單出現與消失、指令觸發、徽章顯示與 `+N`、外觀出現在選擇清單並可套用、停用插件後外觀退回預設。Tray 選單以主程序 inspector 讀取選單模板／呼叫 click callback 驗證，不要操作使用者真實選單列。
- 寫 `docs/phase-reports/phase-16-plugin-contributions.md`。
- **整體收尾**（Phase 12–16）：
  - 更新 `README.md` 與 `README.zh-TW.md`：插件功能說明、安裝方式、安全說明、指向 `docs/plugins/`。
  - 更新 `.agents/skills/pet-skill/references/project-map.md`：新增插件相關模組與安全控制。
  - 更新規劃文件狀態為「已實作（Phase 12–16）」，並列出實作與規劃的差異。
  - 打包驗證（**不要** 執行 `pnpm build`／`pnpm build:fast`：它們的 prebuild 會關掉使用者正在用的 Agent Pets；**不要** 直接開啟打包出來的 `.app`：會使用真實 userData、鑰匙圈與 `~/.desktop-pet`）：
    1. `pnpm exec vite build && pnpm check:bundle`
    2. `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --config.compression=store`（關閉簽章身分探索，避免查詢鑰匙圈）（只產生未封裝的 app 資料夾，不做 dmg）
    3. 把 `release/**/Agent Pets.app/Contents/Resources/app.asar` 以 `pnpm exec asar extract <app.asar> <暫存資料夾>` 解開到暫存資料夾
    4. `node scripts/e2e-isolated-electron.mjs --app-root <暫存資料夾>`，等 `AGENT_PETS_E2E_READY`，安裝 `ok-notify`、`ok-skin`、`panel-demo` 驗證通知、外觀與面板 `tokens.css`（確認打包內容沒有漏檔），在報告記錄。
  - 另寫 `docs/phase-reports/plugin-host-summary.md`：Phase 12–16 總覽、所有 checkpoint commit、整體殘餘風險、建議版本 `1.3.0`。
  - 開發者文件收尾：
    - 完成 §7.1 中標示 **P16** 的頁面，並把 `commands`、`tray`、`badge`、`skins` 補進 API 參考、權限顯示文字、限制表、錯誤碼表。
    - 新增範例：`docs/plugins/examples/pomodoro/`（番茄鐘，只用 `agentStatus`、`schedule`、`feed`、`badge`）、`docs/plugins/examples/skin-pack/`（只有外觀、沒有 entry）。
    - 全文校對：每個 API、權限、錯誤碼、上限數值都要和程式碼一致（列出比對結果）；中英文兩份內容一致；所有連結有效。
    - **驗收**：照入門教學從零做一個插件、照面板頁指南做一個面板頁、安裝 `skin-pack` 範例，三者都在隔離 Electron 中成功；把過程寫進 summary 報告。
- 停止並回報。**不要改版本號**；版本由使用者確認後另外處理。

---

## 7.1 插件開發者文件規格

目標讀者是 **沒看過本 repo 原始碼的第三方開發者**。原則：

- 中英文各一份，檔名 `<頁面>.zh-TW.md` 與 `<頁面>.md`，內容一致。
- 每個 API 都要有可以直接複製的範例，以及失敗時會發生什麼（錯誤碼、使用者看到什麼）。
- 所有數值（上限、速率、大小）都要寫出來，並與程式碼一致；改程式時要同步改文件。
- 不寫內部實作細節（Main 模組名稱、IPC 頻道），只寫作者看得到的行為。

| 頁面（`docs/plugins/`） | 內容 | 完成於 |
|---|---|---|
| `README` | 索引：插件能做什麼、不能做什麼（一段話）、各頁連結、目前 `apiVersion` | P14.6（P15、P16 更新） |
| `getting-started` | 入門教學：建立資料夾 → 寫 `plugin.json` 與 `dist/main.js` → 開啟開發者模式 → 從資料夾載入 → 看到泡泡 → 改程式自動重載 → 打包成 `.agentpet-plugin` → 安裝。目標 10 分鐘完成。 | P14.6 |
| `manifest` | `plugin.json` 每個欄位：型別、必填與否、格式規則、上限、範例；`entry` 何時可省略（P16 補） | P14.6（P16 更新） |
| `permissions` | 每個權限：用途、宣告方式、**安裝確認框顯示的繁中／英文原文**、`network.userGranted` 與 `requestHost` 的確認流程、權限增加時更新需要重新同意 | P14.6（P16 更新） |
| `api-reference` | Host API 每個方法：簽名、需要的權限、回傳值、會 reject 的錯誤碼、範例；說明呼叫成功時直接回傳值、失敗時丟出帶 `code` 的 `Error` | P14.6（P15、P16 更新） |
| `contribution-points` | `feed`、`reaction`、`settings`、`agentStatus`（P14.6）；`panelView`（P15）；`commands`、`tray`、`badge`、`skins`（P16）：每個在畫面上長什麼樣子、顯示優先順序、使用者能做的操作 | P14.6／P15／P16 |
| `sandbox` | 執行環境：背景程式跑在受限 Worker；**被移除或被擋的 Web API 清單**（`fetch`、`WebSocket`、`XMLHttpRequest`、`EventSource`、`indexedDB`、`caches`、`BroadcastChannel`、巢狀 `Worker` 等）與替代做法（`api.net.fetch`、`api.storage`）；不能存取其他插件 | P14.6 |
| `limits` | 規劃文件 §3.4 的預設值與硬上限表、通知速率與佇列、TTL、文字長度、`storage` 大小、`net.fetch` 大小／逾時／次數、`schedule` 最短間隔；超過時的行為 | P14.6（P16 更新） |
| `notifications` | 通知何時會出現、何時進通知中心（勿擾、寵物縮小或隱藏、靜音、速率超過）、`dedupeKey` 用法、連結限制、與 Agent 泡泡的優先順序 | P14.6 |
| `debugging` | 開發者模式、在哪看 log 與被拒原因、常見問題（插件被停用＝連續崩潰 3 次、通知沒跳出來、`host_not_allowed`、`rate_limited`、`not_permitted` 的原因與處理）、心跳逾時的條件 | P14.6 |
| `packaging-and-versioning` | 打包規則（zip 結構、允許的副檔名、大小與檔案數上限）、版本號、更新與降版時使用者看到什麼、`apiVersion` 相容與過渡期規則 | P14.6 |
| `security` | 給作者的安全須知：插件被視為不受信任、不要在 log 或通知放密鑰、密鑰只透過 `secrets` 讀取、使用者可隨時撤銷權限 | P14.6 |
| `panel-view` | 面板頁開發指南：檔案放哪、`preferredSize`、可用的 API 子集（沒有 `secrets.get`、`requestHost`）、被禁止的行為（連網、開新視窗、導覽、下載、拖放）、`ui.postMessage`／`onMessage` 與背景互傳、`tokens.css` 用法、外框由宿主繪製 | P15 |
| `examples` | 各範例的說明與連結：`hello-feed`（P14.6，入門教學的完成版）、`github-pr-watch`（P14.6，示範 `network`、`secrets`、`schedule`、`dedupeKey`）、`panel-demo`（P15）、`pomodoro`、`skin-pack`（P16） | P14.6／P15／P16 |

---

## 8. 不在本次範圍

- Phase 17（插件目錄、簽章、自動更新）與 `eventSource`。
- 系統通知、泡泡自訂按鈕、`sounds`。
- 每插件精確記憶體隔離（列為殘餘風險）。
