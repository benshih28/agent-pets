# 重構階段 11：main runtime 按服務拆分；userData 路徑表

- **開始時間**：2026-11-10 17:47（Asia/Taipei）
- **完成時間**：2026-11-10 18:43（Asia/Taipei）
- **基準 commit**：`26b0b4e`（分支 `claude/refactor-11-runtime-765b09`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 6 項與「其他觀察」的 userData 路徑表；排程見 3.1 節

## 範圍

1. **userData 路徑表**：新增純函式模組 `electron/main/user-data-paths.ts`，`electron/main/runtime.ts` 與 `electron/main.ts` 裡所有 `join(app.getPath('userData'), …)` 改用它；檔名字串一律不變。
2. **第 6 項（main runtime 按服務拆分）**：延續 Phase 18 的服務邊界，從 `runtime.ts` 抽出至少一組完整的 runtime 服務，以明確依賴與 `dispose` 介面連接。

不在範圍：原子寫檔實作（階段 12）、renderer 端桌面偏好鏡像（階段 9 報告提到，本階段不處理）、`PluginNotificationInbox.vue` 相對時間缺陷（階段 10 記錄）、版本號。

## 驗收條件

1. 路徑表輸出的每個路徑與改前的 `join(app.getPath('userData'), …)` 字面相同（契約測試固定每個檔名），`app.getPath('userData')` 在啟動路徑只解析一次。
2. 抽出的服務改前先以 characterization 測試固定行為；`main.ts` 的啟動步驟順序、`teardownMainServices`／`will-quit` 的清理項目、renderer crash 後 `resyncRendererState` 的重送清單不變（若有刻意差異，須在快照中明確標示）。
3. IPC sender guard、CSP、`webPreferences`、`agent-pets://` protocol handler 不變；Permission Control Plane 與 Presentation MCP 不共用新的可變狀態。
4. `vue-tsc --noEmit`、`vite build`、`test:unit`（與基準比對不新增失敗）、`git diff --check`、`pnpm build` 通過。
5. 隔離 Electron 驗證：冷啟動、寵物與面板視窗、真實 hook 事件送達、renderer crash 後狀態重送、正常結束清理（無殘留程序與 port）。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`26b0b4e`）：1450 項，1416 過、11 失敗、23 skip，見「基準失敗清單」；生命週期 characterization（`tests/main-runtime-lifecycle.test.mts`）對 `26b0b4e` 原始碼 6／6 通過 |
| 2 | userData 路徑表與契約測試 | 通過 | `user-data-paths.ts`（純函式）＋`app-user-data.ts`（只讀一次 `app.getPath`）；21 處改用路徑表；契約測試 4／4 |
| 3 | 服務一：寵物視窗模式（characterization 先行） | 通過 | `pet-window-mode-service.ts`；單元測試 13／13；生命週期快照只多一行刻意的 `petWindowModes.dispose()` |
| 4 | 服務二：History runtime（資料庫開啟、本機用量掃描、計時器） | 通過 | `history-runtime-service.ts`；單元測試 12／12；`cancelHistoryStoreRetry()` 換成 `historyRuntime.dispose()`（刻意差異 2） |
| 5 | Code review、phase gates、安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 6 | `pnpm build` 與隔離 Electron 實機驗證 | 通過 | 實機驗證全過；`pnpm build` 第一次在 electron-builder 階段因 worktree `node_modules` 缺 `graceful-fs` 失敗（offline install 的環境問題），`pnpm install --frozen-lockfile --offline --force` 後重跑通過 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-11-runtime-765b09` |

## 盤點結果與拆分決策

`runtime.ts`（3,415 行）依職責盤點後的決定：

| 職責 | 依賴 | 決策 |
|---|---|---|
| userData 底下的檔名（散在 `runtime.ts` 16 處、`main.ts` 4 處、`diagnostics/main-log.ts` 1 處） | `app.getPath('userData')` | **抽成路徑表** `user-data-paths.ts`（純函式）；`app-user-data.ts` 記憶化綁定 Electron |
| 寵物視窗模式：normal／mini／edge 的 bounds、貼邊停留與重新貼邊計時器、視窗狀態持久化、模式廣播、顯示器變動重新安置 | screen、偏好、Permission Broker（唯讀）、面板定位、托盤、plugin feed | **抽出** `pet-window-mode-service.ts` |
| History runtime：開資料庫（損毀恢復、退避重試）、本機用量掃描（週期、補掃、節流、延後首跑）、定期清除 | 路徑表、powerMonitor、agent 設定目錄、成就／廣播回呼 | **抽出** `history-runtime-service.ts` |
| 成就（retry、token 帳本、history 補算）、成長廣播 | progression／achievement store、桌面通知 | **保留**：與事件伺服器熱路徑、IPC 交錯（見「未拆的部分」） |
| Plugin runtime 組裝（`createPluginServices()` 約 520 行） | 20 多個 controller 與 mainState 欄位 | **保留**（見「未拆的部分」） |
| 視窗建立、面板尺寸／定位、全螢幕自動隱藏 | 模式服務、偏好、plugin panel view | **保留**；建立視窗仍直接寫入模式欄位的初值 |
| Permission／Presentation 服務 | 各自 token、server | **保留**，邊界未動 |

### 兩個服務的契約

| 服務 | 讀取 | 寫入 | 自己持有 | `dispose()` |
|---|---|---|---|---|
| `createPetWindowModeService(deps)` | `petWindow`、`panelWindow`、`dragPollHandle`；`edgeModeEnabled()`、`hasActivePermissionRequests()` | `mainState` 的 `petWindowMode`、`petWindowEdge`、`normalPetBounds`、`edgeRestoreBounds`、`edgeDwellHandle`、`edgeDwellCandidate`、`shimejiPersistHandle`；`writeWindowState()` | 重新貼邊輪詢 interval（原本是 `runtime.ts` 模組變數） | 停止重新貼邊輪詢與停留計時器 |
| `createHistoryRuntimeService(deps)` | `progressionStore`、`projectRoutingStore`、`isQuitting`；`isOnBatteryPower()`、`configDirs()` | `mainState` 的 `historyStore`、`localUsageReader`、`localUsageScanTimer`、`localUsageScanPromise` | 重試、延後首跑、補掃、清除的計時器與退避次數、上次掃描時間、連續無進度次數 | 停止重試、延後首跑、補掃、清除計時器 |

兩個服務都只接收型別化的 `Pick<MainState, …>` 與明確回呼，不 import `runtime.ts` 或 Electron 值（只有型別），因此能在 Node 測試直接執行。`runtime.ts` 建立單一實例並保留原本的匯出名稱（`setPetWindowMode`、`createHistoryServices`、`refreshLocalUsage` 等），`main.ts`、IPC registrar、托盤與 pet-motion 的接線不必修改。Electron 的 `screen` 以延後綁定的包裝傳入，模組載入時不觸碰 `screen`。

## 刻意的行為差異

1. **結束時停止重新貼邊輪詢**：改前 `edgeRedockHandle` 是模組變數，`teardownMainServices` 與 `disposeMainTimers` 都不會清除；改後 teardown 呼叫 `petWindowModes.dispose()`。（`tests/main-runtime-lifecycle.test.mts` 快照與 `pet-window-mode-service.test.mts` 的「dispose stops the re-dock poll」）
2. **結束時停止本機用量補掃與清除計時器**：改前 `cancelHistoryStoreRetry()` 只清延後首跑與重試；補掃 timeout 與 6 小時清除 interval（都已 `unref`）不會被清。改後 `historyRuntime.dispose()` 一併停止。（同上兩份測試）

兩者都只影響結束流程中已不需要的計時器；其餘 teardown 與 will-quit 的項目與順序逐行相同。

## 檔案變更狀態

| 路徑 | 類型 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-11-main-runtime.md` | 新增 | 本工作記錄 |
| `electron/main/user-data-paths.ts` | 新增 | userData 路徑表（純函式、凍結物件、`as const satisfies` 檔名清單、記憶化 helper） |
| `electron/main/app-user-data.ts` | 新增 | 綁定 `app.getPath('userData')` 的記憶化存取點 |
| `electron/main/pet-window-mode-service.ts` | 新增 | 寵物視窗模式服務 |
| `electron/main/history-runtime-service.ts` | 新增 | History runtime 服務 |
| `electron/main/runtime.ts` | 修改 | 16 處 userData 路徑改用路徑表；寵物視窗模式與 History runtime 改為服務實例＋同名匯出；移除不再使用的匯入。3,415 → 3,107 行 |
| `electron/main.ts` | 修改 | 4 處 userData 路徑改用路徑表；teardown 改呼叫兩個服務的 `dispose()` |
| `electron/diagnostics/main-log.ts` | 修改 | log 目錄改用路徑表，移除不再使用的 `app`／`join` 匯入 |
| `tests/user-data-paths.test.mts` | 新增 | 檔名契約、與舊 `join`／`resolve` 等價、只解析一次、來源不再手寫 userData 路徑 |
| `tests/support/source-blocks.mts` | 新增 | 取出函式區塊敘述行的測試 helper |
| `tests/main-runtime-lifecycle.test.mts` | 新增 | 啟動步驟順序、teardown／will-quit 清理、crash 重送清單、`webPreferences`、`secureRendererWindow` 快照 |
| `tests/pet-window-mode-service.test.mts` | 新增 | 模式切換副作用順序、權限待處理時維持完整尺寸、貼邊停留／取消、重新貼邊、dispose、shimeji 去抖、顯示器變動、已銷毀視窗 |
| `tests/history-runtime-service.test.mts` | 新增 | 開啟一次、延後首跑、退避重試與上限、結束中不重試、節流與補掃、共用在途掃描、週期掃描、清除、dispose |

## 基準失敗清單（`26b0b4e`）

任何程式修改前啟動的完整 `test:unit`：1450 項，1416 過、**11 失敗**、23 skip。6 項 symlink EPERM 類（「a file edit is medium only inside the project…」「a symlinked staging root is refused」「git helpers never follow gitdir or commondir…」「git helpers refuse a symlinked info directory…」「removing hooks from a symlinked dotfile…」「startup recovery restores interrupted replaces…」）、5 項 hook 計時類（「a busy app still gets the event…」「a permission request still reaches the pet when the hook is stalled…」「a starting app that never opens its port…」「a status event still arrives when the hook process is stalled…」「with the pet closed the hook does not wait…」）。註：路徑表編輯在此次執行後段才開始；失敗項目都與檔案內容無關。

## 驗證證據

| 項目 | 結果 |
|---|---|
| 生命週期 characterization 對基準 | `git archive 26b0b4e electron` 解到暫存目錄，同一份測試 6／6 通過 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm exec vite build` | 通過 |
| `pnpm run test:unit` | 1485 項：1452 過、**10 失敗**、23 skip；10 項全部在基準失敗清單內（基準的「a busy app still gets the event…」這次通過），沒有新增失敗。新增 35 項全過 |
| `git diff --check` | 通過 |
| `pnpm build` | 通過（18:22–18:42）：`vue-tsc`、`vite build`、electron-builder 簽章與打包，產出 `release/AgentPets-1.12.5.exe`（portable）與 `agent-pets-1.12.5-x64.nsis.7z`。第一次失敗原因見步驟 6 |

### 隔離 Electron 驗證

以 `vite build` 後的 repo 啟動 `scripts/e2e-isolated-electron.mjs --offscreen --hook-port-base 28973 --debug-port 9578 --inspect-port 9579`（隔離 HOME／userData、螢幕外、`showInactive()`，沒有點擊任何畫面元素）。

| 項目 | 方法 | 結果 |
|---|---|---|
| 冷啟動 | 啟動日誌與主程序 inspector 列出 `BrowserWindow` | 三個 server 聽在 28973（`/v1/events`）、28974、28975；寵物（260×423）與面板視窗皆建立，位置在螢幕外 |
| userData 檔名 | 列出隔離 userData | `achievements.sqlite`、`desktop-preferences.json`、`history.sqlite`、`logs/`、`progression.sqlite`、`project-routing.sqlite`、`window-state.json` 等，名稱與改前相同 |
| 真實 hook | `scripts/e2e-real-hook.mts --home <隔離 HOME> --hook-port-base 28973 --debug-port 9578` | `all 8 hook events rendered as expected` |
| 寵物視窗模式 | 從寵物 renderer 呼叫 `electronAPI.setPetWindowMode('mini'／'normal')` | `window-state.json` 依序寫入 `mode:"mini"`（96 邏輯像素的迷你視窗）與 `mode:"normal"`（回到 260×423、`normalBounds` 保留） |
| renderer crash 後重送 | 主程序對寵物 `webContents` 記錄 `send` 頻道後 `forcefullyCrashRenderer()` | `render-process-gone: crashed` → 自動重載；重送 `pet-window-mode-updated`、`power-save-state-updated`、`plugin-badges-updated`、`plugin-feed-unread-count`、`progression-updated`、`achievements-updated`、`history-updated`、`permission-requests-updated`、`desktop-preferences-updated`；重載後 DOM 顯示寵物與 session 清單 |
| 正常結束 | 主程序 `app.quit()` | 程序結束；28973–28975、9578、9579 無監聽；沒有殘留的隔離 `electron.exe`；`main.log` 唯一的 ERROR 是刻意觸發的 crash。之後刪除隔離暫存目錄 |

Electron 二進位檔在這個 worktree 的 offline install 中沒有下載，從主 checkout 同版本（43.3.0）的 `node_modules/.pnpm/electron@43.3.0…/dist` 複製到 worktree 的同一位置後執行。依階段 1／5 的做法，`e2e-real-hook.mts` 執行時把該程序的 `USERPROFILE` 設為不存在的路徑（Windows 暫存目錄在 profile 底下，腳本的安全檢查會拒絕）；hook 子程序仍拿到隔離的 HOME。

## 安全審查

- **IPC sender guard**：沒有新增或修改 IPC 頻道與 registrar；`ipc-inventory` 測試通過（無未受 guard 的頻道）。
- **視窗安全設定**：寵物與面板的 `webPreferences`（`contextIsolation`、`nodeIntegration: false`、`sandbox`、`webSecurity`、`webviewTag: false`、`devTools: !app.isPackaged`）與 `secureRendererWindow()` 由快照固定，逐行不變；`app.enableSandbox()`、`registerSchemesAsPrivileged`、`configureSecureProtocol()` 未修改。
- **Protocol handler 的路徑包含檢查**：插件版本目錄仍以 `resolve(userData, 'plugins', id, version)` 計算（契約測試比對），`readRegularFileWithin` 的根目錄不變。
- **Permission Control Plane**：模式服務只拿到唯讀的 `hasActivePermissionRequests()`，判定仍在 Broker；Permission token、relay、adapter server 未動。
- **Presentation MCP**：未修改，與兩個新服務沒有共用狀態。
- **資料位置**：路徑表不新增或改名任何檔案；記憶化只讓 `app.getPath('userData')` 讀一次（生產環境沒有任何 `app.setPath`，e2e 啟動器在 app 程式碼載入前就設定）。

## Code review 紀錄

- 新語法：`as const satisfies Record<string, string>`（檔名表）、`??=`（記憶化、`outsideSince`）、`?.`、`Pick<MainState, …>` 型別收斂取代 `as`，型別守衛 `liveWindow()` 取代重複的 `!w || w.isDestroyed()`；`.at(-1)` 用於測試。`using`／`Symbol.dispose` 未採用：服務的生命週期由 `teardownMainServices` 的固定順序控制，不是區塊範圍，改用 `using` 反而會隱藏順序。
- 效能：啟動路徑少了約 20 次 `app.getPath('userData')` 呼叫；沒有新增同步 I/O 或計時器；模式切換共同收尾 `settleModeChange()` 保持原順序。沒有另跑 `scripts/bench/` 量測：變動只是函式搬移與一次性的路徑表建立，不影響啟動關鍵路徑。
- 重複程式碼：三個 `apply*Bounds` 的共同收尾合併為 `settleModeChange()`；`dispose()` 可重複呼叫。
- 風格：新增註解為繁體中文；從 `runtime.ts` 原樣搬移的既有英文註解保留。`electron/**` 內維持相對路徑匯入；新模組的執行期匯入都帶 `.ts` 副檔名，可直接被 Node 測試載入。
- 子代理：本階段沒有派發子代理；所有修改由總控直接完成並複檢。

## 未拆的部分與建議

> 後續（1.13.2 整合輪線 2）：Plugin runtime、plugin catalog、成就與成長廣播、初始模式還原與面板幾何都已抽出，見 [phase-main-runtime-split.md](phase-main-runtime-split.md)。以下保留為本階段當時的紀錄。

- **Plugin runtime 組裝（`createPluginServices()` 約 520 行）**：在單一函式內建立 20 多個 controller，彼此以 `mainState.pluginRuntimeContexts` 等共用 Map 互相查詢，且 teardown 順序（panel view → developer watcher → broker → … → host window）有依賴。建議下一步先抽 `plugin-catalog`（`createMainPluginCatalogGateway`、自動檢查排程，計時器在 `disposeMainTimers`）這種邊界清楚的子集，再把 controller 建立改成 `createPluginRuntime(deps)` 回傳 `{ start, dispose }`，以 teardown 快照固定順序。
- **成就服務**：retry、token 帳本、history 補算都與事件伺服器熱路徑（`main.ts` 的 `onEvent`）及成長廣播交錯；`achievementProgressTimer` 也沒有被 teardown 清除（已 `unref`，影響小）。建議與成長廣播一起抽成 growth 服務。
- **視窗建立與面板尺寸**：`createPetWindow()` 仍直接寫入模式欄位初值，面板尺寸／定位與 plugin panel view 的 bounds 交錯；建議下一輪把「初始模式還原」移進模式服務的 `restore(saved)`，再抽面板幾何。
- 抽出服務後 `runtime.ts` 為 3,107 行。

## 殘餘風險

- 兩個服務的單元測試是對抽出後的實作撰寫；改前的實作綁在 Electron 與 `mainState` 上無法在 Node 執行，等價性以逐行搬移的 diff 審查、生命週期快照與實機驗證保證。
- 實機驗證只在 Windows；macOS 的全螢幕可見性、Linux 未驗證（本階段未修改相關程式）。
- 貼邊模式的停留／重新貼邊只在單元測試以假螢幕驗證，實機只驗證了 mini／normal 切換。

## 版本建議

本階段不改版本。整體重構完成後依排程統一升 minor 版。
