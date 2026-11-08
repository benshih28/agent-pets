# 稽核報告：狀態面板與設定資訊架構（Status Panel & Settings IA）

範圍：`src/components/StatusPanel.vue/.css`、`src/components/status-panel/*.vue`、`agentStore.ts` 的 panel resize、`electron/ipc/window-controls.ts`、`electron/main/runtime.ts` 的 `computePanelBounds` / blur-hide。
方法：靜態閱讀（唯讀）。行號為稽核當下 main 分支（f0c2f9b）。
已驗證乾淨：StatusPanel.css 沒有裸 hex / rgba、沒有 < 11px 的 font-size（皆走 token；`--organic-font-body-sm` = 12.5px，tokens.css:188）。status-panel 內只有 1 個原生表單元素（SettingsPets.vue:111 的 `<input>`），沒有 `window.confirm`，破壞性操作一律走 `ConfirmDialog`。以下問題聚焦在 IA、狀態、鍵盤、尺寸與文案。

---

## SP-01 設定導航無階層：7 個平鋪 pill + 快捷開關 + 內容，垂直深度過大　[P1]
**證據**
- StatusPanel.vue:221-243 設定頁由 `settings-nav`（flex-wrap pill，StatusPanel.css:852-858）、隱藏的 header（css:889 `display:none`，但 DOM 仍輸出 h2，vue:240-243）、`settings-quick-toggles`（vue:245-255，每顆 min-height 68px，css:899-902）、再才是實際內容，全部在同一個 `overflow-y:auto` 容器（css:842-850）內捲動。
- pill 於 460px 寬下會換行成 2 列（7 項），nav 本身隨內容捲走，切換分類後看不到 nav。
**使用者影響**：進入設定後第一屏約 220px 都是 nav + 三顆開關，真正設定項被擠到折線下；捲動後要回頂端才能換分類。
**子任務**
- [ ] 把 nav 改成固定（sticky）側欄或頂端單列可橫向捲動的 segmented control
- [ ] 7 項分類合併為 4 個群組（見文末新設計）：通用 / 寵物 / 桌面與通知 / 整合與進階
- [ ] 移除 `settings-content-header`（隱藏但仍渲染的 h2 + kicker，造成螢幕閱讀器重複標題）
- [ ] 快捷開關移入「通知與勿擾」群組頂端，不再佔全域第一屏
- [ ] 讓內容區（而非整個 settings-content）成為唯一捲動區，nav 固定
- [ ] 記住上次的分類（目前 vue:112-114 每次進設定重置為 appearance）
- [ ] 在 nav 上顯示有「需要注意」的小圓點（例如 plugin 更新、權限不可用）
- [ ] 為 nav 加 `aria-orientation` 與對應 `tabpanel`（目前只有 tablist，無 tabpanel，見 SP-07）
**修改檔案**：`StatusPanel.vue`、`StatusPanel.css`、`src/locales/*.json`

## SP-02 沒有設定搜尋，且設定項分類不可預期　[P1]
**證據**
- 全面無搜尋框（grep 無 search/filter）。設定項散落：`presentationMcp` 在 SettingsDesktop.vue:35 的「系統整合」卡，但 MCP 面板入口卻在 SettingsAdvanced.vue:20-23；通知/勿擾/音效在快捷列（vue:245-255），不在任何分類頁；`petReactions` 在 Appearance 而 `moodVisuals` 在 Growth（SettingsGrowth.vue:62）；`permissionBubble` 在 Desktop（SettingsDesktop.vue:31）。
- 「Advanced」分類（label `advanced`）只有兩張卡，plugins 的 icon 也用 `advanced`（vue:42，與 advanced 同 icon）。
**使用者影響**：找「勾選氣泡 / 通知 / MCP」要猜在哪一頁；plugins 與 advanced 圖示相同。
**子任務**
- [ ] 建立 `settingsRegistry.ts`：每個設定項 `{id, section, labelKey, helpKey, keywords[]}` 單一來源
- [ ] 新增 SettingsSearch 輸入（Cmd/Ctrl+F 或 `/` 聚焦），結果跨分類列出並可跳轉高亮
- [ ] 重新歸類 permissionBubble、presentationMcp、moodVisuals、reactions（見新設計表）
- [ ] 搜尋無結果空狀態與清除鍵
- [ ] 同義詞（zh-TW：勿擾 / 免打擾 / DND；en：focus）寫入 keywords
- [ ] 為 plugins 與 advanced 提供不同 icon（目前重複）
- [ ] 搜尋命中項捲動到視區並短暫高亮（reduced-motion 時略過動畫）
- [ ] 單元測試：registry 與 locale 鍵一致
**修改檔案**：新增 `src/components/status-panel/SettingsSearch.vue`、`src/utils/settingsRegistry.ts`；改 `StatusPanel.vue`、各 Settings*.vue、locales

## SP-03 面板高度為魔術數字且不隨內容/螢幕調整　[P0]
**證據**
- agentStore.ts:1463/1469/1474/1481/1486/1493 硬編碼 `resizePanel(720,460)`、`(520,680)`、`(560,460)`、`(560,720)`；高度 560 / 720 與寬 460 / 680 / 720 散落於 6 處，`resizePanel(height,width)` 參數順序易混（`(520,680)` 是高 520、寬 680）。
- window-controls.ts:86 `clamp(height,160,900)` 不看 work area；runtime.ts:1847-1877 `computePanelBounds` 只 clamp y，不縮減 height，1366x768 或 Dock/選單列佔用時 720 高 + gap 會超出 workArea，底部被裁（`maxY = max(workArea.y, …)` 時 y 被釘在頂端、內容仍溢出）。
- 內容少（Sessions 空狀態）時仍固定 560。
**使用者影響**：小筆電螢幕設定頁底部按鈕（重啟/退出）看不到且無法捲動到（視窗本身溢出螢幕，而非內部捲動）。
**子任務**
- [ ] 將所有尺寸抽成 `PANEL_SIZES = { sessions, settings, wizard, mcp }` 常數（共用於 renderer 與 electron）
- [ ] 改為 `resizePanel({ height, width })` 物件參數，避免順序誤用
- [ ] computePanelBounds 加入 `height = min(height, workArea.height - 2*PANEL_GAP)`
- [ ] renderer 以內容量測回報理想高度（ResizeObserver）讓主行程在 min/max 內調整
- [ ] 定義 min/max（如 sessions 360–640、settings 480–720）並測試 768p 螢幕
- [ ] 視窗縮小後內部 `overflow-y:auto` 的容器要真的生效（驗證 `min-height:0` 鏈）
- [ ] 高度變化加上與 pet 錨點一致的動畫，避免跳動（現為瞬間 setBounds，window-controls.ts:86）
- [ ] 補單元測試：workArea 高 600 時 panel bounds 全部在 workArea 內
**修改檔案**：`src/stores/agentStore.ts`、`electron/ipc/window-controls.ts`、`electron/main/runtime.ts`、`src/types/electron-api.ts`、`src/components/StatusPanel.vue`

## SP-04 Sessions 清單缺乏排序、篩選、群組，長標籤與資訊密度不足　[P1]
**證據**
- StatusPanelSessions.vue:12-13 僅把 `store.sessionList` 切成 active / offline，無排序控制、無篩選（來源、狀態、專案）；標題行 `SOURCE_LABELS · formatProject(project)`（vue:100-102）只取路徑最後一段，同名專案（兩個 `app`）無法區分；`white-space:nowrap + ellipsis`（css:285-287）截斷後沒有 tooltip / `title`。
- 每筆只顯示 detail 與時間，沒有「持續時間」「token」「工作目錄」，也不可點擊展開或跳到終端。
- offline 區每列無法單獨移除，只有「全部清除」（vue:119-123）。
**使用者影響**：多專案並行時看不出哪個 session 需要我處理；長專案名被截斷無從得知全名。
**子任務**
- [ ] 預設排序：需要輸入/權限 > 執行中 > 思考中 > 成功 > 離線，同級依 lastSeenAt
- [ ] 加入篩選 chips：全部 / 需要處理 / 執行中，並依來源（Codex / Claude / Plugin）篩選
- [ ] 專案名截斷加 `title` 與完整路徑 popover；同名專案顯示父層目錄做消歧
- [ ] 每列可展開顯示：完整路徑、起始時間、工具名、token 使用
- [ ] offline 列支援單列移除與「僅保留最近 N 筆」
- [ ] 「需要處理」狀態（waiting-permission/input）置頂並有計數徽章顯示在 tab 上
- [ ] session 列改成可鍵盤聚焦（目前是 `div`，vue:93-113 無 tabindex）
- [ ] elapsedLabel 以 `1.0s` 每秒重繪整個清單（vue:23-27 + StatusPanel nowTick 1s），改只重繪計時文字、長時間改 `mm:ss`
**修改檔案**：`StatusPanelSessions.vue`、`StatusPanel.css`、`src/utils/format.ts`、locales

## SP-05 用量/額度資訊重複且可讀性差　[P1]
**證據**
- `formatReset` 於 StatusPanelSessions.vue:56-67 與 StatusPanelUsage.vue:17-28 完全重複複製；`quotaPercent` 同樣重複（Sessions:69 / Usage:11）。
- Sessions 底部 quota-strip（vue:158-168）寫死 `'Codex' : 'Claude'`（vue:21），未來新增供應商需改兩處；Usage 頁每個視窗 (`quota-window`) 同時顯示「X 後重置」與完整日期（Usage vue:73-77），資訊重複。
- 顯示的是「剩餘 %」但進度條色調固定 `success`/`accent`（Sessions:164、Usage:67），低於 10% 時沒有警示色（grep 無 warning/danger tone 使用）。
- tab 名稱「Token 剩餘」(locale zh-TW:8) 與頁面其實是「額度」。
**使用者影響**：快用完時沒有視覺警示；命名誤導（不是 token 而是配額 %）。
**子任務**
- [ ] 抽出 `useQuotaFormat()` composable 共用 formatReset / quotaPercent / formatResetAt
- [ ] ProgressTrack 依剩餘量切 tone：>30 success、10–30 warning、<10 danger（並附文字 icon，不只靠顏色）
- [ ] Tab 重新命名為「額度 / Quota」
- [ ] 重置時間只顯示一種：相對時間為主，hover/title 顯示絕對時間
- [ ] 供應商 label 由 `quotaUsage.providers[].name` 驅動，移除硬編碼
- [ ] 顯示「資料更新於 HH:mm」並在過期 (>10 分) 時標示 stale
- [ ] 供應商錯誤時提供「重試」按鈕與可複製的錯誤摘要（現僅顯示文字，Usage vue:46-48）
- [ ] 顯示每個供應商是否已登入的 onboarding 空狀態（目前 quotaUsage 為 null 且無 error 時整個頁面空白，Usage vue:42-86 缺 else 分支）
**修改檔案**：`StatusPanelUsage.vue`、`StatusPanelSessions.vue`、新增 `src/composables/useQuotaFormat.ts`、`ProgressTrack.vue`、locales

## SP-06 Usage 頁缺少空白狀態分支；Loading / Error / Empty 一致性差　[P1]
**證據**
- StatusPanelUsage.vue:42-86：`v-if loading && !usage` / `v-else-if error && !usage` / `v-else-if usage`，若 `!usage && !loading && !error`（首次尚未請求或回傳 null）渲染空白。
- Loading 一律是純文字 `panel-empty`（Usage vue:42-44；History vue:119 用 `t('checking')`，兩頁文案不同：`loadingQuota` vs `checking`）；沒有 skeleton，也沒有 `aria-busy`。
- 已有資料時背景重新整理失敗，錯誤被吞（`error && !usage` 條件），使用者看不到。
- History 載入失敗後沒有重試鈕（History vue:120）。
- SettingsGrowth 有 `role="status"` 的 unavailable 區塊（vue:61），其他頁沒有一致的 `EmptyState` primitive。
**子任務**
- [ ] 新增 `ui/EmptyState.vue`（icon、標題、說明、動作）統一 empty/error/loading
- [ ] 新增 `ui/Skeleton.vue`，Usage/History 用骨架取代純文字
- [ ] 補 Usage 的 `v-else` 空狀態（含「重新整理」）
- [ ] 有舊資料時刷新失敗，顯示頂端非阻塞 banner（stale + 重試）
- [ ] History 錯誤狀態加重試按鈕
- [ ] 所有狀態區加 `role="status"`/`aria-live="polite"`，容器加 `aria-busy`
- [ ] 統一 loading 文案 key（`loadingQuota` / `checking` 合併為通用）
- [ ] 單元測試覆蓋四種狀態
**修改檔案**：`StatusPanelUsage.vue`、`StatusPanelHistory.vue`、`SettingsGrowth.vue`、新增 `ui/EmptyState.vue`、`ui/Skeleton.vue`、locales

## SP-07 Tab / tabpanel ARIA 與鍵盤導覽不完整　[P1]
**證據**
- Dashboard tabs 僅處理左右方向鍵（StatusPanel.vue:83-91），缺 Home/End；Settings nav 同（vue:93-101）。兩個 handler 近乎重複。
- Settings nav 有 `role="tab"`（vue:221-237）但內容容器沒有 `role="tabpanel"` / `aria-labelledby`，也沒有 `aria-controls`。
- Dashboard 三個 panel 使用 `v-show`（vue:214-216），隱藏 panel 的子孫仍在 DOM，但 `display:none` 本身會移出 tab 順序，OK；然而 `aria-controls="panel-sessions"` 指向的 id 在子元件中，正確。問題是三個子元件全部常駐掛載，History 的 `onHistoryUpdated` 等監聽器（History vue:268-272）與 timer 在背景運作。
- 全面沒有 Esc 關閉面板的處理（grep `Escape` 只在 ConfirmDialog.vue:33），也沒有開啟時自動 focus 的位置。SetupWizard 沒有 `role=dialog`/Esc（grep 無），ProjectMcpPanel 有 role=dialog/aria-modal（vue:171-172）但無 focus trap。
**使用者影響**：鍵盤與螢幕閱讀器使用者無法快速關閉面板、跳到頭尾分頁。
**子任務**
- [ ] 抽出 `useRovingTabs(ids, current, onSelect)` composable，處理 ←/→/Home/End，兩處共用
- [ ] Settings 內容區加 `role="tabpanel"`、`aria-labelledby`、`tabindex="0"`
- [ ] 面板層級 Esc：先關 wizard/MCP/對話框，再回 sessions，最後 hide
- [ ] 面板開啟時 focus 到標題或第一個 tab；關閉時把 focus 還給 pet（主行程）
- [ ] SetupWizard 加 `role="dialog" aria-modal aria-label` 與 focus trap；ProjectMcpPanel 補 focus trap
- [ ] 開啟 overlay 時對背景 `inert`
- [ ] 非作用中的 tab 內容用 `v-if + KeepAlive` 或暫停背景刷新
- [ ] e2e：鍵盤只靠 Tab / 方向鍵 / Esc 走完整流程
**修改檔案**：`StatusPanel.vue`、新增 `src/composables/useRovingTabs.ts`、`SetupWizard.vue`、`ProjectMcpPanel.vue`、`App.vue`

## SP-08 面板開關與失焦行為：blur-hide 與編輯中狀態、ConfirmDialog 互動脆弱　[P0]
**證據**
- runtime.ts:1824-1833 `blur` → `schedulePanelBlurHide`（runtime.ts:2190-2203）：任何失焦（切到終端查看 session、拖曳系統對話框）都會隱藏。僅用 `mainState.dialogOpen` 保護原生對話框；renderer 內的 ConfirmDialog / 重新命名輸入 / SetupWizard 步驟中途失焦會被關閉，且 `handlePanelOpened`（agentStore.ts:1507-1514）在非 restore 時一律回到 sessions，丟失 wizard 進度與未提交的 rename（SettingsPets.vue:116 `@blur="confirmRename"` 會在 hide 時送出）。
- 使用者想「釘住」面板對照終端輸出無選項；`panelToggle`（window-controls.ts:60-69）無 pin 概念。
- 無 Esc、無點外面板關閉的使用者設定。
**使用者影響**：看 sessions 的目的就是對照終端，但一點終端面板就消失；設定到一半被關閉。
**子任務**
- [ ] 加入 `panelPinned` 偏好與標題列圖釘按鈕（pinned 時 blur 不隱藏）
- [ ] 偏好 `panelHideOnBlur`（預設 true）放在 Desktop 設定
- [ ] wizard / MCP / 對話框開啟時暫停 blur-hide（renderer 回報 `panel:modal-open`）
- [ ] restore 路徑：保留 settings 分類與捲動位置
- [ ] rename 輸入失焦因 hide 而 blur 時，不要自動提交空/半成品
- [ ] 失焦隱藏延遲的值寫成常數並測試（schedulePanelBlurHide）
- [ ] 加入 Esc 與 `Cmd/Ctrl+,` 開設定的快捷鍵說明
- [ ] 測試：panel 開啟時點 pet 不閃爍（既有保護需要回歸測試）
**修改檔案**：`electron/main/runtime.ts`、`electron/ipc/window-controls.ts`、`electron/ipc/channels.ts`、`src/stores/agentStore.ts`、`StatusPanel.vue`、`SettingsDesktop.vue`、preload、locales

## SP-09 Wizard / MCP 面板用「改視窗尺寸 + overlay」實作，狀態機分散在 3 處　[P1]
**證據**
- `showWizard` / `showProjectMcpPanel` / `panelView` 三個獨立旗標（agentStore.ts:1459-1498；App.vue:346-352），每個 open/close 函式手動維護互斥與尺寸（例如 `closeSetupWizard` 還原尺寸用 `panelView === 'settings' ? 720 : 560`，agentStore.ts:1474；`closeProjectMcpPanel` 一律還原 720，但 openProjectMcpPanel 可能是從 sessions 觸發 → 狀態不一致）。
- `openProjectMcpPanel` 把 `panelView` 強制設為 settings（agentStore.ts:1479）；關閉後使用者停在 settings 而非來源頁。
- 寬度在 wizard(680)/MCP(720) 與一般(460) 之間跳動，pet 錨點每次重算，面板會左右跳。
**子任務**
- [ ] 以單一 `panelRoute` 狀態機取代三旗標：`sessions | settings/<section> | wizard | mcp`，含 `returnTo`
- [ ] 路由進出集中處理 resize，使用 SP-03 的尺寸常數
- [ ] 關閉 wizard/MCP 時返回來源路由（含設定分類）
- [ ] Wizard/MCP 改成面板內頁（push/pop 動畫）而非另開寬度，或固定寬度 560 以避免跳動
- [ ] 在 header 顯示 breadcrumb（設定 › 進階 › MCP）和返回鈕
- [ ] 狀態機單元測試（所有轉換）
- [ ] 持久化未完成的 wizard 進度到 session storage（配合 SP-08）
- [ ] 刪除 App.vue 對 overlay 的重複條件
**修改檔案**：`src/stores/agentStore.ts`、`src/App.vue`、`StatusPanel.vue`、`SetupWizard.vue`、`ProjectMcpPanel.vue`、`SettingsAdvanced.vue`

## SP-10 快捷開關列：命名混亂、狀態只靠文字、無開關語意　[P1]
**證據**
- StatusPanel.vue:245-255 三顆 `Button` 以 `active` class 表示開關，文字「通知 開啟」，aria-label 與可視文字重複組合（`${t('notifications')} ${enabled}`），沒有 `aria-pressed`/`role="switch"`；螢幕閱讀器無法得知是切換按鈕。
- 三顆按鈕邏輯完全重複 3 次（可 v-for）；音效 icon 固定 `volume-off`（vue:252）即使開啟時也是「靜音」圖示，視覺相反。
- 勿擾與通知的關係未說明（勿擾開時通知是否還有意義）。
- 這組全域開關只在設定頁出現，卻是最常用的操作（應在 sessions 頁標題列一鍵可達）。
**子任務**
- [ ] 改用 `ToggleChip`（`role="switch"` + `aria-checked`），移除重複 aria-label
- [ ] v-for 資料驅動，三顆合為一個陣列
- [ ] 音效圖示依狀態切換 `volume` / `volume-off`
- [ ] 勿擾開啟時，通知與音效顯示為「已被勿擾覆蓋」disabled 態並說明
- [ ] 把「勿擾」做成 sessions 頁 header 的一鍵 toggle
- [ ] 狀態用 icon + 文字（非僅 class color），並確保 4.5:1 對比
- [ ] 加入「勿擾排程」的規劃位（見新設計，可後續）
- [ ] 補 en-US/zh-TW 文案：`enabledShort`/`disabledShort` 的組句順序（中文「通知 開啟」vs 英文 "Notifications On"）
**修改檔案**：`StatusPanel.vue`、`StatusPanel.css`、新增 `ui/ToggleChip.vue`、`Icon.vue`、locales

## SP-11 Pets 設定頁：原生 input、混合 role=button 容器、無搜尋與空狀態　[P1]
**證據**
- SettingsPets.vue:111-119 唯一裸 `<input>`，樣式靠 `.pet-rename-input`（css:1212-1222），未用 `ui/` primitive；`@blur="confirmRename"` 與 `@keyup.escape` 並存，Esc 後 blur 仍可能再次提交。
- pet 項為 `div role="button"` 內含巢狀按鈕（vue:122-130，註解已承認），巢狀互動元素違反 ARIA（button 內不可含 button），螢幕閱讀器會讀成單一按鈕。
- 沒有 pet 搜尋、排序、分組（內建 / 匯入 / 專案 / 外掛 skin）；pet 多時一長串。
- 專案寵物區 `projectPetsNoProjects` 空狀態只有文字（vue:195）。
- 無「匯入寵物」入口在此頁就近可見性（需確認，視 Pets 其餘內容）。
**子任務**
- [ ] 新增 `ui/TextField.vue` 取代裸 input（含 label、錯誤、maxlength 計數）
- [ ] rename：Esc 取消時設旗標跳過 blur 提交
- [ ] pet 列改為 `radiogroup`（radio 語意）+ 旁側 menu 按鈕，移除巢狀 button
- [ ] 分組標題：目前使用 / 內建 / 匯入 / 外掛
- [ ] 頂部搜尋框（pet 超過 8 個時顯示）
- [ ] 改名驗證：空白、重複名稱、超長提示
- [ ] 專案寵物區空狀態改 `EmptyState` 並提供說明連結
- [ ] 移除/隱藏確認文案區分「隱藏內建」與「永久刪除」
**修改檔案**：`SettingsPets.vue`、`StatusPanel.css`、新增 `ui/TextField.vue`、locales

## SP-12 Appearance / Desktop / Growth 的控制項設計與命名不一致　[P2]
**證據**
- SettingsAppearance.vue:7-10 寵物尺寸選項 label 寫死 `S/M/L/XL/XXL`，未走 i18n，也沒有實際倍率或預覽；數值 0.6–1.5 無單位說明。
- 主題（深色/淺色）、面板透明度等外觀項不在 Appearance（只有尺寸與反應）；Appearance 僅 2 張卡，內容過薄，而 Growth 一頁含心情、成長、成就三個主題（SettingsGrowth.vue 全檔）。
- SettingsDesktop 單頁 3 卡 / 9 個開關（vue:11-45），分組「windowModes / desktopBehavior / system」的 `system` 內含 MCP 與開機啟動，但 SettingsAdvanced 又放 MCP（SP-02）。
- ToggleRow 的 `disabled` 不支援項目，help 文案改成「不可用」（Desktop vue:21,29），但沒有說明原因或解法（如平台不支援）。
- SettingsGrowth.vue:38-40 hardcode `Lv`、`XP`（vue:57-58）。
**子任務**
- [ ] 尺寸改 `SegmentedControl`，label 走 i18n 並附預覽縮圖與百分比 tooltip
- [ ] 外觀頁合併「尺寸 + 反應 + 心情視覺」，Growth 拆為「成就」獨立分類或移至 History 子頁
- [ ] 不支援的 toggle 顯示標籤 `Badge`「僅 macOS/打包版」並說明
- [ ] 移除 `Lv`/`XP` 硬編碼，改 `levelShort`/`xpShort` key
- [ ] Desktop 內依「視窗」「顯示/隱藏」「系統」三個子標題重排並加摺疊
- [ ] 每張 Card 加 `id` 與 anchor 供搜尋跳轉（SP-02）
- [ ] 重設為預設值按鈕（每個分類底部）
- [ ] 測試：Card/ToggleRow 排版在 en-US 長文案下不溢出
**修改檔案**：`SettingsAppearance.vue`、`SettingsDesktop.vue`、`SettingsGrowth.vue`、新增 `ui/SegmentedControl.vue`、`ui/Badge.vue`、locales

## SP-13 History 頁資訊密度高但文案/格式硬編碼、圖表可及性弱　[P1]
**證據**
- StatusPanelHistory.vue 單頁堆疊 hero + 3 stat tile + growth line + 長條圖 + agent 分佈 + footer，無摺疊，捲動很長。
- 硬編碼：`historyDuration` 的 `m` / `h`（vue:96-99）、`✓` / `!`（vue:227）、tooltip 拼接 `` `${n}${t('historyCompleted')} · ${m}${t('historyFailed')}` ``（vue:201，中文無空白、英文黏在一起）、aria-label 英文 `tokens`（vue:206）。
- 長條圖每天一個欄位，retentionDays 變大時（`historySummary.days`）無橫向捲動/縮減策略，數值標籤 `history-bar-value` 重疊風險。
- `formatUpdated(new Date(generatedAt).toISOString())`（vue:196）多餘轉換；`historyProjectFilter` 切換時沒有 loading 指示（若已有資料則整頁閃爍）。
- 匯出/清除只在頁尾，且結果訊息 `history-action-status` 固定在最底（vue:233）未必在視區。
- 重複：`evolutionLabels`/`moodStage` 與 SettingsGrowth.vue:18-30 完全重複。
**子任務**
- [ ] 抽出 `useProgressionLabels()` composable，消除與 Growth 的重複
- [ ] 時長、單位全部走 `Intl.NumberFormat` unit / i18n key
- [ ] 圖表加 `<table>` 無障礙備援或 `aria-describedby` 摘要
- [ ] 圖表欄位多時顯示每 N 天標籤並可橫向捲動
- [ ] 區塊可摺疊（趨勢 / 代理分佈）並記住狀態
- [ ] 篩選切換時顯示局部 loading，不清空舊資料
- [ ] 匯出/清除結果改 toast/inline 靠近按鈕
- [ ] 日期範圍選擇（7 / 30 天）
**修改檔案**：`StatusPanelHistory.vue`、`SettingsGrowth.vue`、`src/utils/format.ts`、新增 composable、`StatusPanel.css`、locales

## SP-14 Plugins 設定頁僅為薄包裝，面板尺寸被插件接管導致 IA 斷裂　[P1]
**證據**
- SettingsPlugins.vue:1-9 僅轉包 `PluginPanel`；vue:42 plugins 用與 advanced 相同 icon。
- 插件面板自己處理視窗尺寸（usePluginPanelController.ts:151-181 `resizePanel(target…)`、runtime.ts:1792-1815 手動尺寸記憶），進入 plugins 分類時視窗大小可變、而 nav 與快捷列仍在，離開時需還原（`restoreWindowSize`）；與 SP-03 的固定尺寸衝突。
- `onPanelOpenPluginView` 先設空字串再 nextTick 設 id（StatusPanel.vue:125-129）是以時序 hack 觸發 watcher。
- 外掛事件來源狀態 `pluginEventSourceStatuses` 在 Sessions 顯示（Sessions vue:127-150），但管理入口在 Settings › Plugins，兩處沒有互相連結。
**子任務**
- [ ] 以 `requestId` 計數代替「清空再設定」hack
- [ ] Plugins 作為頂層入口（header 的圖示或 nav 獨立群組），與一般設定視覺區隔
- [ ] Sessions 的插件事件區加「管理插件」連結跳到 Settings › Plugins
- [ ] 進出 plugins 時以 SP-09 路由統一處理尺寸還原
- [ ] 插件載入失敗/不可用的空狀態與錯誤文案
- [ ] 插件列表搜尋與啟用狀態篩選
- [ ] 區分「已安裝 / 可用更新 / 目錄」三區塊（IA 層級）
- [ ] 需要時顯示插件 view 的焦點管理（原生 view 的 focus 返回 renderer）
**修改檔案**：`SettingsPlugins.vue`、`StatusPanel.vue`、`src/composables/usePluginPanelController.ts`、`PluginPanel.vue`、`electron/main/runtime.ts`

## SP-15 Header 與全域導航：返回/設定/關閉語意與資訊量不足　[P2]
**證據**
- StatusPanel.vue:154-176：settings 時左側只有返回鈕 + 「設定」標題，沒有當前分類；sessions 時顯示寵物名與副標（level · stage · streak），但沒有整體狀態摘要（例如「3 個執行中 / 1 待處理」）。
- 關閉鈕與返回鈕皆為 ghost icon-only，`title` 與 `aria-label` 重複；沒有快捷鍵提示。
- `panelPetSubtitle` 在 progression 為 null 時顯示 `petProgressLoading`（vue:70）永遠載入，沒有失敗態。
- 寵物頭像只做裝飾 `aria-hidden`，無法點擊切換寵物。
**子任務**
- [ ] header 副標改為「N 執行中 · M 待處理」，成長資訊移到 hover/次要
- [ ] 設定頁標題顯示當前分類（breadcrumb）
- [ ] progression 載入逾時顯示「資料不可用」而非無限 loading
- [ ] 按鈕 tooltip 顯示快捷鍵（Esc、Cmd+,）
- [ ] 頭像點擊跳到 Pets 設定或快速換寵物
- [ ] header 可拖曳區域確認（`-webkit-app-region`）不遮蓋按鈕
- [ ] 待處理數量以 badge 顯示在 tab 與 pet 上（跨視窗）
**修改檔案**：`StatusPanel.vue`、`StatusPanel.css`、`agentStore.ts`、locales

## SP-16 文案完整性與一致性（zh-TW / en-US）　[P2]
**證據**
- 兩個 locale 檔鍵數一致，但詞彙不一致：`plugins`=「插件」(zh-TW:342) 與其他處可能使用「外掛」；`system`=「系統整合」(zh-TW:535) 卻與 `desktop` 內「系統」卡同名但內容不同；`clearShort`（Sessions 離線清除）與 `historyClearShort` 同字不同鍵；`keepControl`=「保持控制權」(zh-TW:157) 作為含「重啟/退出」的卡標題，語意不明。
- 硬編碼字串：Sessions `Codex`/`Claude`（Sessions vue:21）、Appearance `S/M/L`、Growth `Lv`/`XP`、History `m`/`h`/`✓`/`!`、Usage 無。
- `checking`=「檢查中…」被用作 History 載入文案（語意應為「載入中」）。
- `enabledShort/disabledShort` 拼接句型（StatusPanel.vue:246-253）不符中文語序與可翻譯性。
- `workspacePreferences` kicker 實際隱藏（css:889），為死字串。
**子任務**
- [ ] 建立詞彙表（插件 vs 外掛、勿擾 vs 免打擾）並統一
- [ ] 抽換所有硬編碼字串為 i18n key
- [ ] 以 ICU-style 參數化組句（`notificationsOn` / `notificationsOff`）
- [ ] 重新命名 `keepControl` →「應用程式控制」/ "App controls"，`system` 卡區分
- [ ] 移除死 key（`workspacePreferences` 等）並在 CI 加 unused-key 檢查
- [ ] 增加 locale parity 測試（含參數佔位符一致）
- [ ] 長文案 en-US/zh-TW 溢出視覺測試（pill、toggle、button）
**修改檔案**：`src/locales/zh-TW.json`、`src/locales/en-US.json`、各 `status-panel/*.vue`、`StatusPanel.vue`、測試

## SP-17 捲動行為與版面約束不一致（多重 overflow 容器）　[P2]
**證據**
- Sessions：`session-scroll` 獨立捲動，quota-strip 固定於底（css:241-246, 441）；Settings：整個 `settings-content` 捲動，含 nav（css:842-850）；History / Usage 的 `history-view`/`usage-view` 捲動策略各自寫（css 約 495-499、838-861）。
- 沒有捲動陰影/漸層提示尚有內容；`scrollbar-gutter` 未設定，捲軸出現時版面位移。
- 捲動位置在切換 tab 後行為不明（v-show 保留 vs 設定分類重新掛載重置）。
- Dashboard tabs 使用 `width:max-content`（css:195）而非全寬，與設定 nav 的外觀不同。
**子任務**
- [ ] 統一 `.panel-body` 容器（固定 header/nav，單一捲動區）
- [ ] 加上頂/底部捲動陰影（CSS mask 或 `animation-timeline: scroll()`）
- [ ] 設定 `scrollbar-gutter: stable`
- [ ] 切換設定分類時重置捲動，回到上一分類時保留（per-section memory）
- [ ] 統一 tabs 外觀（Dashboard 與 Settings 用同一元件）
- [ ] 在小高度（<480）時 header/tabs 壓縮
- [ ] Liquid Glass 規則檢查：捲動區背景與 blur 不重疊閃爍
**修改檔案**：`StatusPanel.css`、`StatusPanel.vue`、新增 `ui/ScrollArea.vue`

## SP-18 面板長期更新負載與背景工作　[P2]
**證據**
- StatusPanel.vue:74-81 每秒 `nowTick` 驅動所有子元件（Sessions、Usage、含隱藏的 History）重新計算；`document.hidden` 才停止，但面板被 `hide()` 時 `document.hidden` 不一定為 true（BrowserWindow hide 在 Electron 通常會觸發 visibilitychange，需驗證）。
- 三個 dashboard 子元件常駐掛載並各自處理 IPC 訂閱（History vue:268-272）。
- 掛載時即 `refreshQuota()` + `loadPets()` + `refreshProjectPets()` 全量（vue:130-132）。
**子任務**
- [ ] nowTick 只在 Sessions 有 live session 時啟動
- [ ] 面板 hide 時由主行程通知 renderer 暫停（`panel:visibility` IPC）
- [ ] History / Usage 改為懶掛載（首次進入才載入）
- [ ] quota 刷新節流與在面板開啟時才刷新
- [ ] 效能測試：面板隱藏時 CPU 使用
**修改檔案**：`StatusPanel.vue`、`electron/main/runtime.ts`、`StatusPanelHistory.vue`、`agentStore.ts`

---

## 新面板畫面設計提案

### 設計原則
- 單一固定寬度 460（wizard/MCP 變成面板內頁，不再改寬度），高度依內容在 `[min,max]` 內自適應並受 workArea 限制（SP-03）。
- 頂層導覽：底部或頂部 3 個主分頁（工作階段 / 額度 / 歷史）+ 右上設定；設定為全頁 push，內有搜尋與 4 個分類。
- 全部使用 `ui/` primitives；顏色走 token；Liquid Glass 僅用於面板外殼與 header，內容區使用不透明 surface（見 liquid-glass.md 規範）。

### 主導覽（Sessions 主畫面）
```
┌──────────────────────────────────────────────┐
│ (pet) 小墨             3 執行中 · 1 待處理   [釘] [⚙] [×] │  Header (glass)
├──────────────────────────────────────────────┤
│ [工作階段 (4)]  [額度]  [歷史]                │  Tabs (roving, badge)
├──────────────────────────────────────────────┤
│ ⚠ 權限請求 · Claude · agent-pets   [允許][拒絕] │  InlinePermissionCard
├──────────────────────────────────────────────┤
│ [全部] [需要處理 1] [執行中 2]   來源 ▾  排序 ▾ │  Filter bar
│ 需要處理                                      │
│  ● Claude · agent-pets   等待權限     12.3s  │
│    ~/sideProject/agent-pets  Bash             │
│ 執行中                                        │
│  ● Codex · web-app       思考中       4.1s   │
│ 離線 (2)                       [清除全部]      │
│  ○ Claude · docs        10:32            [×] │
├──────────────────────────────────────────────┤
│ Codex 72% ▓▓▓▓▓▓▓░░ 2h 後重置  Claude 18% ▓▓░ │  Quota strip (warning tone <30%)
└──────────────────────────────────────────────┘
```
元件：`PanelHeader`、`DashboardTabs`（RovingTabs）、`SessionFilterBar`、`SessionGroup`、`SessionRow`（可展開、可聚焦）、`QuotaStrip`、`EmptyState`。

### 額度（Usage）
```
┌ 額度 ───────────────────────── 更新於 14:05 [重新整理] ┐
│ Codex  Pro                                           │
│  5 小時視窗   剩餘 72%  ▓▓▓▓▓▓▓░░░   2 小時後重置      │
│  每週         剩餘  9%  ▓░░░░░░░░░   ⚠ 3 天後重置      │ ← danger tone + icon
│ Claude Max                                           │
│  …                                                   │
│ ─ 資料來自本機登入 · [重試] (錯誤時)                  │
└──────────────────────────────────────────────────────┘
```
元件：`ProviderCard`、`QuotaRow`（ProgressTrack 三色 + 文字）、`StaleBanner`、`EmptyState`（未登入引導）、`useQuotaFormat`。

### 歷史（History）
```
┌ 歷史  [專案 ▾] [7天|30天] ─────────────────────┐
│ ┌Token 1.2M┐ ┌完成 34┐ ┌活躍 5h 20m┐            │
│ ▸ 每日 Token 趨勢  (可摺疊，圖表附表格備援)      │
│   ▂▃▅▇▂▁▃                                       │
│ ▸ 代理分佈                                       │
│ 匯出 | 清除  (結果 toast 靠近按鈕)               │
└──────────────────────────────────────────────────┘
```
元件：`StatTile`、`CollapsibleCard`、`BarChart`（a11y table）、`RangeSegmented`。

### 設定（全頁 push，含搜尋）
```
┌ ‹ 設定                                        [×] ┐
│ [🔍 搜尋設定…                         (/)]         │
│ [通用] [寵物] [桌面與通知] [整合與進階]            │ ← sticky SegmentedControl
├────────────────────────────────────────────────────┤
│ 通用：語言 · 外觀(尺寸/反應/心情視覺) · 面板行為(釘選/失焦隱藏) │
│ 寵物：我的寵物(搜尋/分組) · 專案寵物 · 成長與成就   │
│ 桌面與通知：通知/勿擾/音效 · 視窗模式 · 桌面行為 · 開機啟動 │
│ 整合與進階：插件 · MCP · 設定精靈 · 重新啟動/退出    │
└────────────────────────────────────────────────────┘
```
設定項歸屬表（舊 → 新）：language、appearance → 通用；pets、growth → 寵物；desktop(windowModes/behavior)、快捷開關、permissionBubble → 桌面與通知；plugins、presentationMcp、advanced、system → 整合與進階。
元件：`SettingsPage`、`SettingsSearch`、`SegmentedControl`、`SettingsSection`（含 anchor id 由 settingsRegistry 驅動）、`ToggleChip`/`ToggleRow`、`TextField`、`Badge`、`EmptyState`、`useRovingTabs`、`panelRoute` 狀態機（SP-09）。

### 實作順序建議（避免檔案衝突的並行分組）
1. A 組（electron/尺寸）：SP-03、SP-08、SP-18 → `runtime.ts`、`window-controls.ts`、`agentStore.ts` resize 區
2. B 組（路由/導覽）：SP-01、SP-07、SP-09、SP-14、SP-15 → `StatusPanel.vue/.css`、`agentStore.ts` 路由區、`App.vue`
3. C 組（Sessions/Usage/History）：SP-04、SP-05、SP-06、SP-13 → 三個 `StatusPanel*.vue`
4. D 組（設定頁內容）：SP-02、SP-10、SP-11、SP-12 → `Settings*.vue`、`ui/*` 新元件
5. E 組（文案/樣式）：SP-16、SP-17 → `locales/*.json`、`StatusPanel.css`（最後合併）
注意：`StatusPanel.vue`/`.css`/locales 為多組共用熱點，建議由 B 組先行，其餘排隊。
