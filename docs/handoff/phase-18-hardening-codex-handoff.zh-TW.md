# 交接：Phase 18 重構、效能、安全與可擴充性

> 給執行者（Codex）的完整指示。請 **從頭到尾讀完** 再開始。
> 前置：Phase 17 已複檢通過（`docs/reviews/phase-17-review.md`）。本 Phase 不新增功能，目標是讓既有程式更快、更安全、更容易擴充，**使用者看得到的行為完全不變**。

---

## 0. 工作方式

**沿用 `docs/handoff/plugin-host-codex-handoff.zh-TW.md` §0.2–§0.7 與 `docs/handoff/plugin-distribution-codex-handoff.zh-TW.md` §0 的全部規則**，以下為差異與補充：

- **分支：** `feat/phase-18-hardening`（已建立，基於 `feat/plugin-distribution`，包含 Phase 17）。所有工作 commit 在這個分支並 push。不要開 PR、不要合併、不要 rebase、不要 force push。
- **版本：** 不改版本號。使用者已決定 Phase 18 複檢通過後由複檢者升版為 `1.3.1` 並發版。
- **行為不變（最重要）：** 這是 patch 版本，所以：
  - 不改 UI 外觀與文字、不改插件公開契約（manifest、Host API、錯誤碼、上限數值）、不改 IPC 對 renderer 的回傳格式。
  - 不改持久化資料格式（偏好檔、SQLite schema、registry JSON）。只能新增索引；若非改不可，停下來回報。
  - 每個重構都要先有測試鎖住現有行為（characterization test），再改程式。
- **隔離驗收：** 一律 `node scripts/e2e-isolated-electron.mjs`。腳本已會把 `security`、`claude`、`codex` 導向 `/usr/bin/false`，並只傳白名單環境變數，**不得修改或繞過這些保護**。報告要記錄開始與結束時的 `__agentPetsE2E.calls` 與 `__agentPetsE2E.blockedExecs`。
- **個資：** 不得上傳使用者個資或環境資訊（email、本機絕對路徑、環境變數、token、鑰匙圈資料、主機名稱）。效能報告中的路徑一律寫成相對路徑或 `<tmp>`。
- **不新增 runtime 相依；** devDependencies 也不要加。效能量測用 Node 內建的 `performance.now()`、`process.hrtime.bigint()`、`node:test`。
- **工作記錄：** 新建一筆，`idempotencyKey`：`agent-pets-phase-18-hardening`；`title`：`Phase 18：重構、效能、安全與可擴充性`；`parentSessionId`：`0a84ada3-c88c-4197-9e8e-3d84a1747e6a`。每個檔案都要有 `changedFileChanges` 狀態與 provenance。
- **停點：** P18.6 完成後停止回報。checkpoint 之間不要停。

## 1. 效能原則（演算法優先）

使用者要求「像解 LeetCode 一樣把效能做到最好」。具體要求：

1. **先量測再優化。** 每個優化項目都要有基準測試（benchmark），在報告寫出：改前、改後的時間複雜度（Big-O），以及實際量測數字（中位數與 p95，至少 30 次）。沒有量測數據的優化不算完成。
2. **選對資料結構。** 典型替換：
   - 以 id 查找 → `Map`／`Set`，O(1)，取代陣列 `find`／`findIndex`／`includes` 的 O(n)。
   - 依優先順序取最大值 → 二元堆積（binary heap），O(log n)，或固定少量優先等級的分桶佇列，O(1)。
   - 滑動視窗限流 → 環狀緩衝區（ring buffer）或雙端佇列，攤銷 O(1)，取代每次 `filter` 的 O(n)。
   - 有上限的快取 → LRU（`Map` 插入順序即可實作），每次操作 O(1)。
   - 只追加的檔案 → 依位移（byte offset）增量讀取，O(新增位元組數)，取代每次整檔重讀的 O(檔案總大小)。
3. **等價性測試。** 每個新演算法都要和舊實作比對：用固定亂數種子產生至少 1,000 組隨機輸入，新舊輸出必須完全相同（自製簡易 property-based test，不加套件）。比對完成後才能刪除舊實作。
4. **不做沒必要的微優化。** 量測顯示不是瓶頸的地方，維持可讀性優先，在報告註明「量測後不需優化」。

## 2. 安全原則

- 每個 IPC handler 都要：驗證寄件者（既有的 `assertTrustedIpcSender`／對應視窗）、逐欄驗證輸入、失敗時 fail closed。
- Electron 視窗設定基準：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`、禁止任意導覽與新視窗、所有 session 都有權限處理函式。
- 檔案路徑一律經 `safeJoin` 與 realpath 檢查，拒絕 symlink。
- 不在 log、錯誤訊息、UI 顯示 token、密鑰或本機路徑。

---

## 3. Phase 18 checkpoints

### P18.0 前置修正與量測基準

- **F1（Phase 17 複檢必修）：** `tests/fixtures/plugins/ok-event-source`、`evil-event-source` 的 `dist/main.js` 改成 `export default { activate(api) { ... } }`。新增測試：所有 fixture 與 `docs/plugins/examples/` 中有 `entry` 的插件，都必須 `export default` 一個帶 `activate` 函式的物件（靜態檢查即可）。在隔離 Electron 實際安裝這兩個插件並記錄結果（不能是 `disabled_crashed`）。
- 新增 `scripts/bench/`（Node 腳本，不加相依）與 `pnpm bench` 指令：對下列項目建立可重複的基準測試（固定亂數種子產生測試資料）：
  1. 本機用量統計（`electron/local-usage.ts`）：模擬 50 個、合計 200MB 的 JSONL 檔，量「第一次掃描」與「只新增 1MB 後再掃描」。
  2. Agent 狀態事件處理（`src/stores/agentStore.ts` 中可抽成純函式的部分）：1,000 個 session、10,000 筆事件。
  3. 泡泡仲裁與插件通知佇列（`src/utils/feed-arbiter.ts`、`electron/plugin-feed.ts`）：10,000 筆通知進出。
  4. 各種限流器（plugin net、feed、badge、eventSource、commands）：每秒 10,000 次呼叫。
  5. History 主要查詢（`electron/history.ts`）：10 萬筆事件的資料庫，量七日統計與專案篩選，並附 `EXPLAIN QUERY PLAN`。
  6. 冷啟動：從啟動到 `AGENT_PETS_E2E_READY` 後第一個視窗載入完成（隔離環境量 5 次取中位數）。
  7. 打包大小：`dist/` 與 `dist-electron/` 各檔案大小。
- 把結果寫進 `docs/perf/phase-18-baseline.md`（只寫相對路徑）。
- `Checkpoint: P18.0`。

### P18.1 安全稽核與修補

- 產出 `docs/security/ipc-inventory.md`：列出 **所有** `ipcMain.handle`／`ipcMain.on` 頻道，每列寫：允許的寄件視窗、輸入驗證方式、對應的 preload API、對應測試。可以用腳本從原始碼產生，並加測試確保清單和程式一致（新增頻道沒寫進清單就失敗）。
- 修補清單中缺少寄件者驗證或輸入驗證的 handler。
- 新增契約測試：`electron/preload.ts` 暴露的 API、`src/env.d.ts` 的型別、`main.ts` 註冊的頻道三者一致（沒有多餘或遺漏）。
- 視窗與 session 稽核：逐一列出所有 `BrowserWindow`／`WebContentsView`／session 的安全設定，不符合 §2 基準的修正；`will-navigate`、`setWindowOpenHandler`、`setPermissionRequestHandler`、`setPermissionCheckHandler` 都要有。
- Electron fuses：確認打包設定的 fuses（`RunAsNode` 關閉、`EnableNodeOptionsEnvironmentVariable` 關閉、`EnableNodeCliInspectArguments` 關閉、`OnlyLoadAppFromAsar` 開啟等）；若目前未設定，評估後在 `package.json` 的 electron-builder 設定加上，並確認打包後仍能用 `--app-root` 驗收（驗收用的是解開的 asar，不受影響）。
- 主程序中處理不可信輸入的路徑（插件套件、目錄 JSON、事件伺服器）檢查是否有未設上限的迴圈、正則表達式回溯（ReDoS）或過大的記憶體配置；有就修並補測試。
- 不改變 Claude／Codex 額度功能的正式行為（它讀取鑰匙圈是既有產品功能），只需在清單中標註，並確認只在使用者開啟額度頁面時才觸發；如果不是，記錄在報告的待決事項，不要自行改產品行為。
- `Checkpoint: P18.1`。

### P18.2 拆分 `electron/main.ts`（可擴充性）

- 目標：`main.ts` 只負責組裝（建立服務、建立視窗、呼叫註冊函式），目標行數 < 1,200。
- 依領域拆成 `electron/ipc/<domain>.ts`（例如 `pets`、`history`、`plugins`、`plugin-catalog`、`permission`、`quota`、`setup`、`desktop`），每個檔案匯出 `register<Domain>Ipc(deps)`，依賴以參數注入（不要用全域變數），讓 handler 可以在測試中直接呼叫。
- 新增 `electron/ipc/channels.ts`：所有頻道名稱的唯一來源；`main`、`preload` 都從這裡引用，不再手寫字串。
- 寄件者驗證包成共用的 `handleTrusted(channel, window, handler)` 之類的輔助函式，避免每個 handler 自己寫一次。
- 純搬移與注入，不改邏輯；每搬完一個領域就跑完整 `pnpm test:unit`。
- 在 `.agents/skills/pet-skill/references/project-map.md` 更新模組地圖，並新增「如何新增一個 IPC 頻道」「如何新增一個插件貢獻點」「如何新增一個 Agent adapter」三段步驟說明（列出要動的檔案，目標每項不超過 4 個檔案）。
- `Checkpoint: P18.2`。

### P18.3 主程序效能（演算法）

依 P18.0 的量測結果，至少完成下列項目（每項都要有等價性測試與前後量測）：

1. **本機用量增量讀取：** `local-usage.ts` 依 `(dev, ino, size, mtimeMs)` 記住每個檔案已解析到的 byte offset 與累計結果；檔案只有變長就從上次位移續讀，變短或 inode 改變才整檔重讀。處理跨讀取邊界的不完整行。快取有上限（LRU），只存在記憶體。
2. **限流器：** 統一成一個共用的滑動視窗限流模組（環狀緩衝區），取代各模組中以陣列 `filter` 清除舊時間戳的寫法；行為（何時回 `rate_limited`）必須與現有完全一致。
3. **插件通知佇列：** `plugin-feed.ts` 的排序與去重改成 `Map` 去重 + 依優先等級的分桶佇列（或二元堆積）；輸出順序與現有一致。
4. **同步檔案操作：** 列出 `main.ts`（拆分後的各 ipc 模組）中 32 處 `*Sync` 呼叫，在使用者操作或事件熱路徑上的改成非同步或加快取；只在啟動時執行一次的可保留，並在報告說明。
5. **History 查詢：** 依 `EXPLAIN QUERY PLAN` 補必要的索引（只新增索引，不改 schema）；多筆寫入包在 transaction 中。
6. **IPC 廣播合併：** 高頻的狀態廣播（Agent 狀態、插件通知數、eventSource）在同一個事件循環內合併成一次送出，renderer 收到的最終狀態不變。
- `Checkpoint: P18.3`。

### P18.4 Renderer 效能與元件拆分

- `src/stores/agentStore.ts`：session 以 `Map<id, session>` 為主要索引，衍生清單用 `computed` 一次計算；把可測的邏輯抽成 `src/utils/` 純函式並補測試；消除事件處理中的 O(n) 掃描。
- 拆分 `PluginPanel.vue`（約 1,500 行）與 `StatusPanel.vue`（約 1,400 行）：依分頁或區塊拆成子元件，每個檔案目標 < 500 行；設定分頁用 `defineAsyncComponent` 延遲載入。外觀與互動完全不變（拆分前後在隔離 Electron 截圖比對：淺色、深色各一張，每個設定分頁）。
- 動畫與計時器：確認寵物動畫只用 `requestAnimationFrame`，視窗隱藏、Mini 模式或 reduced motion 時暫停；`App.vue` 等處的 `setInterval` 在視窗隱藏時停止或拉長間隔。
- 量測：renderer bundle 大小、設定面板第一次開啟時間、1,000 個 session 時的事件處理時間，前後比較。
- 遵守 `agent-pets-conventions`（`@/` 別名、i18n、switch／對照表取代長 if-else、共用元件）與 `liquid-glass.md`。
- `Checkpoint: P18.4`。

### P18.5 可擴充性收尾

- Agent adapter 與插件貢獻點：確認新增一個 adapter 或貢獻點時，只需在一個 registry 中登記並實作介面，其餘（IPC、preload、型別、文件清單）由 registry 推導或有測試提醒遺漏。
- 型別：IPC payload 型別集中在 `src/types/`，main 與 renderer 共用；不再有 `unknown as` 之類的強制轉型繞過檢查（真的必要的地方加註解說明原因）。
- 錯誤碼：插件錯誤碼、IPC 錯誤碼各自集中定義成 union 與常數清單，文件表格由測試比對一致。
- `Checkpoint: P18.5`。

### P18.6 全面回歸與收尾

- 跑完 §0.4、§0.4a、§0.4b。
- 隔離 Electron 全面回歸（開發版與打包內容 `--app-root` 各一次），至少涵蓋：寵物顯示與狀態列、設定每個分頁、插件安裝／啟停／移除、面板頁、Tray 指令、徽章、外觀、線上目錄 fixture 安裝與更新、簽章拒絕、eventSource、History 與成長頁。記錄 `calls` 與 `blockedExecs` 起訖值。
- `docs/perf/phase-18-results.md`：與 baseline 對照的表格（項目、複雜度前後、量測前後、改善百分比）；沒有改善或變慢的項目要說明原因。
- `docs/phase-reports/phase-18-hardening.md`：checkpoint 表、驗收結果、安全稽核結果、殘餘風險、待決事項。
- 停止並回報。**不要改版本號。**

---

## 4. 不在本次範圍

- 新功能、UI 改版、插件公開契約變更、資料格式遷移。
- Windows／Linux 實機驗證（記錄為未驗證）。
- 更換框架或建置工具。
