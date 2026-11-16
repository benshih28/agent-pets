# 1.13.2 整合輪線 2：主程序 runtime 拆分與效能

- **開始時間**：2026-11-10 22:21（Asia/Taipei）
- **基準 commit**：`38a75fa`（版本 1.13.1），分支 `claude/main-runtime-0a9a97`
- **工作記錄**：Work Intelligence session `bf919ac0-631d-4432-9c6d-d46971c02279`（父記錄為規劃 `d1b66599-3e15-4bb7-8d11-a928cfbfcbb7`）
- **背景**：[refactor-11-main-runtime.md](refactor-11-main-runtime.md)「未拆的部分與建議」

## 範圍

| # | 項目 | 結果 |
|---|---|---|
| 1 | Plugin runtime 抽出 | 完成：`plugin-catalog-runtime.ts`、`plugin-runtime.ts`（`createPluginRuntime(deps)` → `{ start, dispose }`） |
| 2 | 成長服務抽出 | 完成：`growth-service.ts`；`achievementProgressTimer` 納入 teardown |
| 3 | 視窗建立與面板幾何 | 完成：初始模式還原移進 `petWindowModes.restore(saved)`；面板尺寸／定位抽成 `panel-geometry.ts`；`createPanelWindow` 的事件接線與 plugin panel view bounds 留在 `runtime.ts` |
| 4 | 本機用量掃描移到 worker thread | 量測後**不採用**，保留主執行緒；改為縮小 SQLite 寫入批次（500 → 100） |
| 5 | 大檔複雜度檢查 | `achievements.ts` 定義查找改 Map；`history.ts`、`plugin-panel-themes.ts`、`quota.ts` 檢查後不需改 |
| 6 | `bench:lag` 基準 | 完成：基準檔、門檻與 `pnpm bench:lag:check` |

不在範圍：新增 agent、Codex 權限回覆、OpenCode 額度／token、App 更新檢查與第二波項目、版本號。

## `runtime.ts` 行數

| 時點 | 行數 |
|---|---|
| 基準 `38a75fa` | 3,107 |
| 抽出 plugin runtime／catalog、面板幾何、初始模式還原後 | 2,378 |
| 抽出 growth 服務後（最終） | 2,187 |

新模組：`plugin-runtime.ts` 688 行、`plugin-catalog-runtime.ts` 143 行、`growth-service.ts` 348 行、`panel-geometry.ts` 約 200 行；`pet-window-mode-service.ts` 342 → 391 行。`main.ts` 930 → 879 行，仍是組裝根。

## 服務契約

所有新服務只接收 `Pick<MainState, …>` 與回呼，不 import `runtime.ts` 或 Electron 值（只有型別），可直接在 Node 測試執行；`runtime.ts` 建立單一實例並保留原本的匯出名稱，`electron/ipc/*` 與托盤的接線不必修改。

| 服務 | 自己持有 | `dispose()` |
|---|---|---|
| `createPluginCatalogRuntime(deps)` | catalog gateway、自動檢查排程（計時器仍放在 `mainState.pluginCatalogAutoCheckTimer`，`disposeMainTimers` 仍看得到） | 清除每小時自動檢查計時器 |
| `createPluginRuntime(deps)` | `start()` = 原 `createPluginServices()`（20 多個 controller、store、IPC registrar），Electron 值、`WebContentsView`、host window 工廠、i18n、路徑表都由 deps 注入 | 依原 teardown 順序釋放：panel view → developer watcher → broker → feed → agent status → secrets／consent／settings → runtime contexts → preferences snapshot → host window → event source |
| `createGrowthService(deps)` | progression／achievement store 的建立與重試、local token 帳本、history 補算、progression／achievement 廣播、事件熱路徑 `handleEvent`；私有 `progressionGate`、`achievementProgressTimer`、`localTokenLedgerChanged` | progression close → 成就重試計時器 → 成就進度去抖計時器 → achievement close |
| `petWindowModes.restore(saved, options)` | 冷啟動時還原 normal／mini／edge 與 `normalPetBounds`、`edgeRestoreBounds`，回傳視窗初始 bounds | （沿用既有 `dispose()`） |
| `createPanelGeometry(deps)` | 面板尺寸檔（延遲建立，`before-quit` flush 由 `runtime.ts` 註冊）、定位、min／max、使用者拖曳結算、精靈最小尺寸 | 無自有計時器以外的資源；`panelSettleTimer` 仍在 `mainState`，由 `disposeMainTimers` 清除 |

`main.ts` 的事件 `onEvent` 中 progression＋achievement 兩段換成 `growth.handleEvent(event)`；服務內兩段各自的 try/catch、錯誤訊息與熱路徑守門（`achievementsEnabled && achievementStore && (state === 'success' || tokenUsage !== undefined)`）不變，執行順序仍是 session snapshot → session jump → 桌面通知 → progression → achievement → history queue。

## 刻意的行為差異

1. **結束時清除成就進度去抖計時器**：改前 `achievementProgressTimer`（已 `unref`）沒有任何清理步驟；改後由 `growth.dispose()` 清除。（`tests/main-runtime-lifecycle.test.mts` 快照註解、`tests/growth-service.test.mts`）
2. **本機用量匯入批次 500 → 100 筆**：寫入結果相同；`onRecordsImported`（成就帳本同步）呼叫次數變為約 5 倍，下游是冪等 upsert。（`tests/local-usage.test.mts` 的批次測試）
3. `restore()` 只在存檔模式為 edge 時才讀取 `edgeModeEnabled` 偏好（純讀取，無副作用）。

其餘啟動步驟名稱與順序、teardown／will-quit 的項目與位置、renderer crash 後的重送清單、`webPreferences`、`secureRendererWindow`、`configureSecureProtocol`、IPC sender guard 皆不變。

## 量測

### 本機用量掃描（worker 評估）

詳見 [docs/perf/local-usage-worker.md](../perf/local-usage-worker.md)。fixture 約 4 萬行／32MB、匯入 16,000 筆，三個組合在獨立子行程交錯 9 輪：

| 組合 | mean | p99 | max | 總耗時（ms，中位數） |
|---|---|---|---|---|
| main500（改前） | 12.17 | 147.59 | 273.15 | 7198 |
| main100（採用） | 10.73 | 116.06 | 184.16 | 7566 |
| worker100（原型） | 9.03 | 143.65 | 257.82 | 6757 |

確定性量測：單批 `recordTokenUsageBatch` 同步耗時 500 筆 31.5ms、100 筆 7.1ms。量測期間 load average 50～350，lag 直方圖不可當作使用者機器的數字；worker 沒有可辨識的 p99 改善，因此不做（理由與打包風險見 perf 文件）。

### `bench:lag` 基準

[docs/perf/event-loop-lag-baseline.md](../perf/event-loop-lag-baseline.md)：5 次中位數 mean 5.43、p99 7.29、max 14.18（ms），門檻 mean ≤ 12、p99 ≤ 25、max ≤ 300。CI 指令 `pnpm bench:lag:check`（新增的唯一一行 package script），實際接進 workflow 由線 4 負責。

## 驗證證據

- **基準**（`38a75fa`，任何修改前）：`pnpm test:unit` 1,555 項，1,553 過、1 失敗（`agent-hook-delivery`「with the pet closed the hook does not wait…」，計時類）、1 skip。
- **最終**：見下方「收工檢查」。新增測試：`growth-service` 9 項、`plugin-catalog-runtime` 10 項、`plugin-runtime` 3 項、`panel-geometry` 17 項、`pet-window-mode-service` 新增 `restore()` 9 項、`local-usage` 新增批次 1 項，`main-runtime-lifecycle` 新增 plugin／catalog／growth 三個 `dispose()` 順序快照。
- **隔離 Electron 實機**（`node scripts/e2e-isolated-electron.mjs --offscreen`，隔離 HOME 與 userData、假 safeStorage、埠 29373–29375）：以 main process inspector 確認（並先比對 inspector 的 `process.pid` 就是這次啟動的 Electron）：
  - 冷啟動後寵物與面板兩個視窗都建立，`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`；
  - 對 `/v1/events` 送 tool-running 事件回 204，寵物與面板都顯示該 session；
  - 兩個 renderer `forcefullyCrashRenderer()` 後，日誌出現 `render-process-gone (killed)` → 250ms 後重載，重載後 session 仍在（狀態重送正常）；
  - 再送 success 事件回 204，經 growth 熱路徑，日誌沒有 progression／achievement 錯誤；`history`、`progression`、`achievements`、`project-routing` 資料庫都已建立；
  - `app.quit()` 後 Electron 程序結束，事件埠已釋放。

## 收工檢查

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | main-process lint passed |
| `pnpm run check:design:strict` | 通過（rawColors 0、unused 0、rawControls 0） |
| `tests/ipc-inventory.test.mts` | 4／4 通過 |
| `pnpm test:unit` | 1,607 項：1,604 過、2 失敗、1 skip；2 項失敗都是 `agent-hook-delivery.test.mts` 的 hook 計時測試（第 110、228 行），當時 load average 約 340，基準就有同類失敗，與本線無關 |
| `pnpm run bench:lag:check` ×3 | 都在門檻內（p99 11.35／7.97／7.67 ms，max 70.32／29.59／94.96 ms） |
| `git diff --check` | 通過 |
| `pnpm audit --prod` | No known vulnerabilities found |
| `pnpm exec vite build` | 通過（只為隔離 Electron 驗證；未執行 `pnpm build`） |

## 安全審查

- 沒有新增或改名 IPC 頻道；`docs/security/ipc-inventory.md` 因 registrar 搬到 `plugin-runtime.ts` 而重新產生，頻道清單不變；`tests/ipc-inventory.test.mts` 的 plugin `createView`／`plugin-network` session 安全斷言改讀新檔並加一條斷言確認 `runtime.ts` 仍以工廠建立 `WebContentsView`，沒有放寬。
- IPC sender guard（`assertTrustedIpcSender`、`assertPluginPanelSender`、`isTrustedIpcSender`）、`secureRendererWindow`、`configureSecureProtocol`、`webPreferences` 留在原位；新服務只透過 deps 取得 guard 函式。
- Permission Control Plane（permission broker、OpenCode adapter server、audit）與 Presentation MCP（`createPresentationServices`）未搬移、未與新服務共用可變狀態。
- e2e catalog fixture 分支逐字保留；無 fixture 時不會落到真實網路（新測試覆蓋）。
- `pnpm audit --prod`：No known vulnerabilities found。diff 掃描沒有本機路徑、個資、憑證或環境變數值。
- 效能：成就定義查找 O(d) → O(1)、快照 O(d²) → O(d)；本機用量單批同步阻塞約 31ms → 7ms；事件熱路徑沒有新增同步 I/O。

## 範圍外順手修的問題

- `scripts/e2e-isolated-electron.mjs`（**屬線 4**，改動小而獨立）：inspector／devtools 埠被佔用時 Electron 只印一行錯誤仍照常啟動並印出 READY，驗證腳本就會連到別人的程序。本線驗證時因此連到另一個工作樹在 9449 上的隔離測試 App，讓它的 renderer 崩潰並結束了它（使用者的正式版不受影響；已通知線 1、線 3 並在共用筆記留下說明）。修正：啟動前先確認兩個埠空著，否則以 `AGENT_PETS_E2E_ABORT` 中止。
- `tests/ipc-inventory.test.mts`、`tests/plugin-extension-registry.test.mts`、`tests/pet-style-tokens.test.mts`：原本以字串讀 `runtime.ts` 的來源斷言，改讀搬移後的新檔（斷言內容不變）。
- `docs/design/Plugin-Panel-Theme-Spec.md`、`docs/architecture/refactor-opportunities-2026-11-10.zh-TW.md`、`docs/phase-reports/refactor-11-main-runtime.md`：更新過期的模組位置說明。

## 殘餘風險

- `pluginRuntime.start()`（原 `createPluginServices()`）本體只靠逐字搬移、型別檢查與來源快照保證；實機只驗證了冷啟動、全域停用插件狀態下的面板與正常結束，沒有實際安裝／啟用插件、catalog 自動檢查與 developer watcher。
- 實機驗證只在 macOS（x64）；Windows／Linux 未驗證。貼邊模式還原只有單元測試（假螢幕），實機為預設 normal 模式。
- 量測在高負載機器上進行；`bench:lag` 基準偏保守，建議在安靜的機器或 CI runner 上重跑 5 次後更新。
- `agent-hook-delivery` 的計時測試在本機高負載下會失敗（基準就有，屬線 1 的檔案，與本線無關）。
- `docs/ux-overhaul/audit-*.md`、`docs/reviews/phase-13-review.md` 等歷史審查以行號引用 `runtime.ts`，屬當時的快照，未改寫。

## 版本建議

本線不改版本。由總控在整合分支統一升 patch（1.13.2）。
