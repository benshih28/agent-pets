# 階段報告：歷史分頁內容重疊、寵物狀態列擁擠與完成標記開關

> 分支 `fix/history-overlap`，基於 `main` @ 6a595e0（1.11.3）。版號尚未變更。

## 問題

1. **歷史分頁內容疊在一起**：在「歷史」分頁先看「工作階段」再切回「總覽」，工作階段清單的列會出現在總覽卡片（趨勢圖、Agent 分布、模型）後方與之間；7 天趨勢圖的 X 軸標籤（`11/2（週一）11/3（週二）…`）也互相擠在一起。約 450 px 寬時，統計卡片的數字與附註被截成「2 小時 4…」「原始事件保留 90 …」。
2. **寵物下方狀態列看不清**：一行塞「Claude (CLI+Desktop) · 專案 · 思考中 (+2)」加 Quota 百分比，名稱、專案與狀態都只剩幾個字。完成時同樣出現 `(+N)`。
3. **完成標記無法關閉**：寵物旁的「✓ N」（失敗時「⚠ N」）標記沒有設定可以關掉。

## 根本原因

- `StatusPanel.css` 有一條給儀表板 Sessions 面板用的 `.status-panel :deep(.tab-panel) { display: flex; flex: 1; min-height: 0 }`。共用元件 `<TabPanel>` 也使用 `.tab-panel` class，而歷史分頁的「總覽／工作階段」兩個子視圖正是 `<TabPanel>`。兩條規則的權重相同（編譯後都是 0,3,0），StatusPanel 的規則較晚載入，因此蓋過 `.tab-panel[hidden] { display: none }`。結果是隱藏的子視圖仍以 flex 顯示，兩個子視圖都被 `flex: 1 1 0; min-height: 0` 壓到約 138 px，內容（2144 px 與 1386 px）溢出並互相覆蓋。
  在隔離 Electron 中量到：450×720 時隱藏面板 `hidden=true` 但 `display:flex`，畫出 90 列工作階段，與總覽卡片有 129 組矩形重疊。
- 統計卡片的單欄後備規則寫在 `@media (max-width: 420px)`。面板是獨立視窗、寬度至少 460 px，viewport 查詢永遠不會成立。
- 7 天 X 軸標籤是單行「日期＋星期」，比每欄寬度還寬。
- 狀態列把所有資訊放在約 250 px 的單行裡，其中的 `(+N)` 與變體字串佔掉了狀態需要的空間。

## 變更

| 區塊 | 檔案 | 內容 |
|---|---|---|
| 子視圖顯示 | `src/components/StatusPanel.css`、`status-panel/StatusPanelSessions.vue`、`ui/TabPanel.vue` | 儀表板規則改用專屬的 `.dashboard-tab-panel`；`TabPanel` 的 `[hidden]` 改為 `display: none !important`，任何使用端的版面規則都不能讓隱藏面板重新出現。 |
| 統計卡片 | `src/components/StatusPanel.css` | `.history-view` 設為 size container；寬度 ≤520 px 時兩欄（工作時間卡橫跨兩欄）、≤280 px 時單欄、≤420 px 時頁尾改直排。附註改為可換行，不再以省略號截斷。 |
| 趨勢圖 | `growth/HistoryChart.vue`、`src/utils/history-axis.ts` | X 軸改為日期與星期兩行；圖上方預留頂端格線標籤的空間。軸標籤與長條 aria-label 改成依 days／語系計算一次的 computed，hover 不再重新格式化；`Intl.DateTimeFormat` 依語系與選項快取。 |
| 狀態列 | `DesktopPet.vue/.css`、`src/utils/session-attention.ts`、`src/utils/state-aria.ts`、`src/locales/pet/*` | 移除 `(+N)`。第一行為「名稱 · 狀態」，狀態使用短版文字（英文如 `Permission`、`Needs input`），名稱先縮；多個工作階段時第二行顯示最需要你處理的那個專案。CLI/Desktop 變體、完整專案名與完整狀態放在提示框與 `role="group"` 的 aria-label。「誰在等你」的挑選邏輯不變。 |
| 視窗高度 | `src/utils/pet-window-height.ts`、`src/stores/agentStore.ts` | 高度預算加入專案列（`STATUS_LINE_PROJECT_H` = 14 px，與狀態列一樣不隨寵物大小縮放）：單寵物每條有專案列的狀態列加一次，多寵物只加一次。判斷條件與 `statusLineText()` 共用 `showsProjectRow()`。 |
| 完成標記 | `electron/desktop-preferences.ts`、`electron/main/runtime.ts`、`src/types/desktop.ts`、`src/stores/agentStore.ts`、`src/utils/unread-results.ts`、`SettingsDesktop.vue`、`src/utils/settingsRegistry.ts`、`src/locales/*.json` | 新增布林偏好 `completionMarkersEnabled`（預設開啟），沿用既有的驗證、儲存與 `desktop-preferences-updated` 廣播，沒有新增 IPC channel。關閉時隱藏「✓／⚠ N」、Mini 模式計數與 Edge Peek 結果徽章；關閉期間不再累計，切換為關閉時清除既有計數。設定 → 桌面可切換，中英文皆可搜尋。 |
| 文件 | `README.md`、`README.zh-TW.md` | 狀態列說明與範例、設定表的桌面列。 |

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm run lint` | 通過 |
| `pnpm run test:unit` | 1028／1028 通過（`presentation-stdio` 在全套負載下逾時一次，單獨重跑兩次皆通過） |
| `pnpm exec vite build` | 通過 |
| `pnpm run check:bundle-size`／`check:bundle` | 通過 |
| `pnpm run check:contrast` | 通過 |
| `pnpm run check:design:strict` | 通過，沒有新增 finding |
| `git diff --check` | 通過 |

新增或擴充的測試：`history-layout`（`.tab-panel` 只能由 `TabPanel` 設定樣式、`[hidden]` 合約、軸標籤、圖表預先計算、統計卡片的 container query）、`pet-window-height`、`session-attention`（狀態列文字、短版狀態、`role="group"`）、`desktop-preferences`（完成標記的預設、儲存、驗證、渲染條件與不累計）、`settings-registry`（中英文搜尋）。還原 CSS 修正後，`history-layout` 中與修正相關的三個測試確實會失敗。

**隔離 Electron 實測**（`scripts/e2e-isolated-electron.mjs`：暫存 HOME／userData、假 safeStorage、`security`／`claude`／`codex` 指向 `/usr/bin/false`）：

- 歷史資料以合成的工作階段與 token 寫入暫存 `history.sqlite`。在 450×720、360×720、450×480、680×720 與淺色／深色下，先載入工作階段清單再切到總覽：隱藏面板為 `display:none`，畫出的工作階段列 0 列、重疊 0 組，總覽高度等於內容高度；7 天 X 軸標籤 0 組碰撞、0 個截斷。
- 統計卡片：450 px 時兩欄（207 px）加一張橫跨卡片，360 px 時兩欄（157 px），680 px 時三欄；卡片互不重疊，數字與附註都沒有被截斷。
- 狀態列：最壞情況（三個家族、各有多個工作階段、長專案名、zh-TW 與 en-US）時，名稱與狀態都完整；長專案名在第二行以省略號截斷；視窗高度預算 508 px 等於實際視窗高度，狀態列底部正好落在視窗內。多寵物時 180 px 的欄位裡，狀態完整，必要時名稱先縮。
- 完成標記：從設定搜尋「完成標記」並關閉後，偏好檔寫入 `false`，寵物視窗收到廣播，三種標記全數隱藏。

## 未驗證項目

- 開發機上已安裝的 Agent Pets 佔用 17373–17375 埠，無法送出真實 hook 事件；寵物狀態與 Quota 是直接注入寵物視窗的 store，歷史資料是直接寫入暫存資料庫。
- 360 px 與較矮的面板是以模擬 viewport 測試，真實面板視窗最小寬度為 460 px。
- Mini 模式只切換了 renderer 的模式，沒有實際縮小視窗。
- Windows 分層視窗的裁切行為、高對比與減少透明度外觀未在本階段實測。

## 建議版號

修補版（patch）：修正版面錯誤，並新增一個預設開啟、向下相容的偏好欄位（舊的偏好檔讀取時自動補預設值）。
