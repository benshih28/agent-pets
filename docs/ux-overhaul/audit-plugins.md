# Agent Pets 插件系統 UX 稽核報告（唯讀稽核）

範圍：`src/components/PluginPanel.vue/.css`、`plugin-panel/PluginPanelDialogs.vue`、`status-panel/SettingsPlugins.vue`、`src/composables/usePluginPanelController.ts`、`electron/plugin-panel-*.ts`、`plugin-catalog-updates.ts`、`plugin-tray.ts`、`plugin-badges.ts`、`StatusPanel.vue`、`DesktopPet.vue`、locales、`docs/plugins/`、phase 12–20 與 plugin-panel-* 報告。
方法：只讀程式碼與文件，未執行 App；所有行號為稽核當下 `main`（f0c2f9b）的行號。

## 總覽

| ID | 標題 | 嚴重度 |
|---|---|---|
| PL-01 | 設定頁資訊架構倒置：已安裝插件被埋在最底部 | P0 |
| PL-02 | 「選取的插件」隱性耦合：指令/設定卡只由底部診斷下拉決定 | P0 |
| PL-03 | 操作回饋（錯誤/成功訊息）位置錯誤、不會消失、離操作處很遠 | P0 |
| PL-04 | 全域單一 `busy` 旗標 + 每次變更都整頁重刷 | P1 |
| PL-05 | 安裝確認對話框：300px 寬、權限清單被截斷、風險無分級 | P0 |
| PL-06 | 首次使用/空狀態沒有引導（onboarding 缺失） | P1 |
| PL-07 | 線上目錄與更新體驗殘缺（需手動載入、無更新提示、權限比對恆為 null） | P1 |
| PL-08 | 目錄卡片與已安裝卡片資訊過載且被 `nowrap` 截斷 | P1 |
| PL-09 | 通知（Feed）入口埋在設定底部，且未讀數只在邊緣縮起模式顯示 | P1 |
| PL-10 | 面板視圖（Panel view）外框、載入與錯誤狀態不足 | P1 |
| PL-11 | 面板視窗尺寸/定位/最大化行為不一致且不持久 | P2 |
| PL-12 | 移除、撤銷主機、清除通知等破壞性操作的確認摩擦不一致 | P1 |
| PL-13 | 插件設定表單（settings/secret）缺少驗證、說明、dirty 狀態 | P1 |
| PL-14 | 鍵盤、焦點與螢幕閱讀器無障礙缺口 | P1 |
| PL-15 | 設計系統一致性：未定義 token、硬編碼 hex、非共用元件 | P2 |
| PL-16 | i18n 與文案問題（zh-TW 夾雜英文、原始碼外露、單位硬編碼） | P2 |
| PL-17 | 進階/開發者/診斷資訊對一般使用者曝光過度 | P1 |
| PL-18 | Tray、徽章、事件來源等貢獻點對使用者「不可見、不可控」 | P2 |

共 18 個大問題。每項的「修改檔案」欄位用於平行化分工：同一檔案只應由一人處理（衝突提示見文末「分工矩陣」）。

---

## PL-01 設定頁資訊架構倒置：已安裝插件被埋在最底部（P0）

**證據**
- `src/components/PluginPanel.vue:75-94` 工具列（總開關/重新整理/安裝）→ `:96-124` 「進階設定」Card（8 個數字欄位，`resourceFields` 於 `usePluginPanelController.ts:84-99`）→ `:126-211` 線上目錄 Card → 才到 `:216-319` 「已安裝」。
- 設定面板預設 460×720（`phase-15-plugin-panel-view.md:92`），在此尺寸下「已安裝」要捲動數螢幕才看得到。
- `StatusPanel.vue:42` Plugins 分頁 hint 是「安裝與管理本機插件」，但實際頁面首屏是資源硬上限數字欄位。
- 診斷、通知、指令、設定共 6 個 section 垂直堆疊在同一捲動容器（無錨點、無分頁）。

**使用者影響**：「換成插件架構後 UX 變差」的最大來源：使用者想「看我裝了什麼/開啟它」，卻先面對進階參數與目錄 URL 輸入；要找到已裝插件的設定得捲到底。

**子任務**
- [ ] 1. 重排區塊順序：已安裝 → 通知 → 目錄 → 進階（預設摺疊）。
- [ ] 2. 在頁首加入 segmented tabs：`已安裝 / 探索 / 通知 / 進階`，沿用 `StatusPanel.vue` 的 tablist 鍵盤行為（`onSettingsKeydown`）。
- [ ] 3. 把「進階設定」（資源硬上限、開發者模式）移到獨立「進階」分頁或 `<details>` 摺疊，預設關閉（見 PL-17）。
- [ ] 4. 頁首加入摘要列：「已啟用 3 / 已安裝 5 · 2 個可更新 · 1 則未讀」，點擊跳到對應分頁。
- [ ] 5. 全域總開關改為頁首小型開關，並在關閉時整頁灰化並顯示一行「插件已全域停用」橫幅（目前只靠每張卡片狀態文字）。
- [ ] 6. 工具列（`:75-94`）縮減為主要 CTA「安裝插件」與次要選單（重新整理、開發者載入資料夾）。
- [ ] 7. 切換分頁時保留捲動位置與草稿狀態（用 `v-show` 或 keep-alive）。
- [ ] 8. 更新 `docs/plugins/getting-started*.md` 的「Settings → Plugins」截圖描述與步驟。

**修改檔案**：`src/components/PluginPanel.vue`、`PluginPanel.css`、新增 `src/components/plugin-panel/PluginTabs.vue`（或 `PluginPanelShell.vue`）、`docs/plugins/getting-started*.md`、`src/locales/*.json`（新 key 僅追加）。

---

## PL-02 「選取的插件」隱性耦合：指令/設定卡只由底部診斷下拉決定（P0）

**證據**
- `PluginPanel.vue:321` `selectedPlugin?.manifest?.contributes.commands` 與 `:337` `...settings` 兩張 Card 取決於 `selectedPluginId`。
- 唯一可手動改變 `selectedPluginId` 的 UI 是 `:401` 「診斷」區的 `<Select v-model="selectedPluginId">`（`aria-label` 是「診斷」）。
- 預設值為第一個插件（`usePluginPanelController.ts:357`）；`openPluginPanelView` 也會設定它（`:209`）。
- `watch(selectedPluginId)`（`:915`）切換時：關閉開啟中的面板（`:317`）、清空設定草稿（`refreshPluginSettings` `:397-401`）。
- 已安裝卡片（`:227-317`）本身沒有「設定」「指令」入口。

**使用者影響**：使用者在 B 插件的卡片上找不到設定；設定卡片出現在列表「下方」且屬於「預設第一個插件」，極易誤改/誤以為是全域設定。切換插件會無提示丟失未儲存的設定草稿。指令按鈕下方沒有標明屬於哪個插件。

**子任務**
- [ ] 1. 移除「診斷下拉決定一切」的設計，改成「插件詳情」頁（master-detail）：點卡片進入，上方麵包屑 `← 插件 / {name}`。
- [ ] 2. 詳情頁以分段呈現：總覽、權限、設定、指令、診斷、移除；所有 section 標題顯示插件名稱。
- [ ] 3. 卡片上直接顯示主要動作：`開啟面板`、`設定`（有 settings 時）、`⋯` 更多選單（回報、移除）。
- [ ] 4. 有未儲存設定草稿時離開詳情頁需出現「放棄變更？」確認（見 PL-13）。
- [ ] 5. 指令按鈕改在詳情頁/卡片展開區，並在 disabled 時顯示原因（插件停用 / 全域停用）。
- [ ] 6. 將 `selectedPluginId` 的責任縮減為「目前詳情頁」，診斷區不再擁有它。
- [ ] 7. 在 `openPluginPanelView` 之外新增 `openPluginDetail(pluginId)`；通知、Tray、badge 點擊可 deep link 到詳情頁。
- [ ] 8. 更新 e2e/單元測試中對 `selectedPluginId` 的假設（`tests/phase-18-renderer-characterization.test.mts` 等）。

**修改檔案**：`PluginPanel.vue`、`usePluginPanelController.ts`、新增 `PluginDetail.vue`、`PluginCard.vue`、對應 tests、locales。

---

## PL-03 操作回饋位置錯誤、不會消失、離操作處很遠（P0）

**證據**
- `PluginPanel.vue:213-214` 單一 `errorMessage`/`statusMessage` 區塊夾在「目錄」與「已安裝」之間，不在視窗固定位置。
- 控制器每個動作都先清空兩者（例如 `usePluginPanelController.ts:341-342, 425-426, 459-460`），成功訊息永不自動消失（無 timer）。
- 使用者在頁尾（通知、設定儲存 `:390`）或最頂（安裝 `:87`）操作時，訊息出現在中間，通常在視窗外。
- 成功：`pluginInstallSucceeded`「插件預設為停用」（zh-TW）沒有後續動作（沒有「立即啟用」按鈕）。
- 數字欄位驗證失敗（`:633-642`、`:686-693`）只顯示一般錯誤，輸入框內值未回復，也沒有 inline 錯誤。
- `invokePluginCommand` 只顯示「已送出指令。」（`:433`），不代表結果。

**使用者影響**：按了沒反應的感覺；錯誤與觸發點脫節；使用者不知道安裝成功後下一步是什麼。

**子任務**
- [ ] 1. 新增全域 Toast/Snackbar 元件（頂部或底部固定，`role=status`/`role=alert`），成功 4 秒自動消失、錯誤需手動關閉。
- [ ] 2. 控制器把 `statusMessage/errorMessage` 改為 `notify({ tone, text, action? })` 佇列。
- [ ] 3. 安裝成功 Toast 附帶動作「立即啟用」「查看」。
- [ ] 4. 表單欄位錯誤改為欄位旁 inline（`aria-invalid` + `aria-describedby`），並自動復原為上次有效值。
- [ ] 5. 錯誤訊息加上「重試」或「查看說明」動作（目前 `pluginActionFailed` 一律「請重新整理後再試」，無診斷線索）。
- [ ] 6. 對 `localizedError`（`:275-322`）未映射的 code 保留 code 於可展開的「技術細節」。
- [ ] 7. 指令執行改為顯示 pending 狀態與結果（成功/被限流 `rate_limited`/被拒），不是只說「已送出」。
- [ ] 8. 訊息出現時不要搬動版面（固定高度 live region），避免內容跳動。

**修改檔案**：新增 `src/components/ui/Toast.vue`（共用）、`usePluginPanelController.ts`（拆出 `usePluginNotify.ts`）、`PluginPanel.vue`、`PluginPanel.css`、locales。

---

## PL-04 全域單一 `busy` 旗標 + 每次變更都整頁重刷（P1）

**證據**
- `busy` 單一 ref（`usePluginPanelController.ts:45`）；任何動作開始時所有按鈕/開關 `:disabled="busy"`（`PluginPanel.vue:80,84,87,251-258,284,287`）。
- `updatePluginPreference` / `updateGlobalPreferences` 成功後呼叫 `refreshPanel()`（`:555, :669`），而 `refreshPanel` 在 `loading` 時直接 return（`:340`），造成連續切換時第二次重刷被吞掉、畫面狀態可能過期。
- `refreshPanel` 還會順便 `refreshNotifications`（`:359`）與（若有 `requestedPluginId`）重新開啟面板（`:352-355`）。
- 單一開關切換期間整頁灰掉，無 per-item spinner、無樂觀更新。

**使用者影響**：快速切換多個開關時被「鎖住」；明明只改一個欄位卻整頁閃爍；連點可能得到過期狀態。

**子任務**
- [ ] 1. 把 `busy` 拆成 `busyScopes: Set<string>`（`global`、`plugin:{id}`、`catalog`、`install`），UI 只鎖定相關控制項。
- [ ] 2. 開關採樂觀更新：先改 UI，失敗時回滾並顯示 inline 錯誤。
- [ ] 3. `setPluginInstancePreferences` 回傳值已含新 preferences（`:669-672` 已指派），改成局部更新 snapshot，不再 `refreshPanel()`。
- [ ] 4. `refreshPanel` 在 loading 時改為排隊一次（trailing refresh），不要直接丟棄。
- [ ] 5. 卡片上顯示 per-plugin 微型 spinner/骨架。
- [ ] 6. `refreshPanel` 不再在每次呼叫時重新觸發 `openPluginPanelView`（見 PL-10 的重開 bug）。
- [ ] 7. 為連續快速切換補上單元測試（序列化 + 回滾）。

**修改檔案**：`usePluginPanelController.ts`（核心）、`PluginPanel.vue`、tests。

---

## PL-05 安裝確認對話框：300px 寬、權限清單被截斷、風險無分級（P0）

**證據**
- `ConfirmDialog.vue` `.dialog { max-width: 300px }`，且無 `max-height`/捲動；插件安裝內容放在 slot（`PluginPanelDialogs.vue:40-69`）。
- 權限清單 `ul { max-height: 110px; overflow: auto }`（`PluginPanelDialogs.vue:104`）：約 4-5 行就要內捲，使用者很可能沒看到「連線至 X」就按同意。
- 摘要把名稱·版本·作者·類型擠成一行（`pluginPlanSummary`）。
- 所有權限（`pendingPermissions` `usePluginPanelController.ts:780-800`）平鋪為相同樣式；`network`、`secrets`、`links` 與「顯示徽章」視覺權重相同。
- 警告（簽章變更、降級、新權限）為同色 `.plugin-plan-warning` 純文字，簽章金鑰變更（較高風險）與「首次信任」相同等級。
- `focusCancel` 只在需簽章確認時為 true（`PluginPanelDialogs.vue:34`）；其他情況 Enter 直接安裝。
- `incompatible` 計畫只彈出一般錯誤 `pluginIncompatible`，不顯示對話框、也不說明哪個 API 版本不相容（`:748/selectArchive :706-722`）。
- 對話框 `aria-label` 是 title，但內容標題 `h3` 與 `h2` 層級混用；焦點陷阱只收集 `button`（`ConfirmDialog.vue` onKeydown），導致 keep-data checkbox 不在 Tab 迴圈內。

**使用者影響**：安全關鍵畫面（授權）閱讀困難，容易盲按「同意並安裝」；警告無層級，讓真正危險的更新被稀釋。

**子任務**
- [ ] 1. 改為專用 `PluginInstallSheet.vue`（全寬 bottom-sheet / 寬 420px+，可捲動，標題固定、動作列 sticky）。
- [ ] 2. 權限分組並分級：`網路/外部連結`（高）、`密鑰/儲存`（高/中）、`顯示類（徽章、Tray、面板、外觀）`（低），各組有圖示與顏色語意（遵守 liquid-glass 規則）。
- [ ] 3. 「新增權限」置頂並以 diff 樣式（`+`）標示；其餘折疊為「既有權限（N）」。
- [ ] 4. 簽章區塊視覺化：已驗證 ✔ / 未簽章 ⚠ / 金鑰變更 ⛔，不同層級對應不同警示強度。
- [ ] 5. 高風險（金鑰變更、簽章移除、新增網路權限）預設 `focusCancel`，並需勾選「我已了解」才啟用確認鈕。
- [ ] 6. `incompatible` 也進入同一 Sheet，顯示「需要 API 版本 X，目前支援 Y」與唯一動作「關閉」。
- [ ] 7. 把 Tab 焦點陷阱改為涵蓋 `button, input, [tabindex]`，並在關閉時回復焦點到觸發元素（`ConfirmDialog.vue`）。
- [ ] 8. 顯示套件來源（本機檔案路徑檔名 / 目錄）、大小與（目錄安裝時）SHA-256 摘要。
- [ ] 9. 為每項權限提供「這代表什麼」的一句話說明（zh-TW 優先）。
- [ ] 10. 補上單元測試：權限分組、focusCancel 規則。

**修改檔案**：`plugin-panel/PluginPanelDialogs.vue`（或新 `PluginInstallSheet.vue`）、`src/components/ui/ConfirmDialog.vue`（共用，注意與其他功能的衝突）、`usePluginPanelController.ts`（`pendingPermissions`）、locales、tests。

---

## PL-06 首次使用/空狀態沒有引導（P1）

**證據**
- `pluginsEnabled` 預設 `false`（`electron/plugin-preferences.ts:52`），目錄預設關閉（`pluginCatalogEnabledHelp`「預設關閉」）。
- 空狀態僅一行灰字：「尚未安裝插件。」（`PluginPanel.vue:225`，`.plugin-empty` 置中灰字 `:84`），沒有 CTA、沒有說明「插件是什麼」、沒有文件連結。
- 目錄空狀態：「設定目錄網址並載入，即可瀏覽插件。」（`pluginCatalogEmpty`）——叫使用者去設定網址，但預設 URL 已存在。
- `SetupWizard.vue` 沒有任何插件步驟（grep 無結果）；`docs/plugins/README.zh-TW.md:5` 的指引在 App 內無入口。
- 安裝後預設停用（`pluginInstallSucceeded`），但沒有提示開啟全域開關（若為關閉狀態，單一啟用也沒作用）。

**使用者影響**：新使用者看到的是一個「全域關閉 + 空清單 + 進階數字」的頁面，不知道價值與下一步。

**子任務**
- [ ] 1. 設計 EmptyState 元件：插圖 + 一句價值說明 + 主 CTA「瀏覽插件目錄」與次 CTA「安裝本機檔案」。
- [ ] 2. 全域關閉時，空狀態與頁首顯示「插件目前停用 · [啟用插件]」一鍵動作。
- [ ] 3. 加入「了解插件安全」連結（開啟 `docs/plugins/security` 對應的線上頁面，使用 `links.openExternal` 已有的安全通道）。
- [ ] 4. 首次進入 Plugins 分頁時顯示一次性 coach mark（可關閉，狀態存 preferences）。
- [ ] 5. SetupWizard 加入可略過的「插件」說明步驟（不自動連網）。
- [ ] 6. 安裝成功 Toast 附帶「啟用」，並在全域關閉時同時提示。
- [ ] 7. 目錄預設關閉時，空狀態說明連網行為並提供「開啟線上目錄」按鈕，而非要求先輸入 URL。
- [ ] 8. 更新 docs `getting-started*.md` 對應畫面描述。

**修改檔案**：`PluginPanel.vue`、新 `PluginEmptyState.vue`、`SetupWizard.vue/.css`、`usePluginPanelController.ts`、locales、docs。

---

## PL-07 線上目錄與更新體驗殘缺（P1）

**證據**
- 目錄不會自動載入：即使已啟用且有 URL，也要手動按「載入」（`PluginPanel.vue:153`、`loadPluginCatalog :571-593`）；`catalogItems` 不存在於 snapshot，離開分頁即遺失。
- 「已安裝」卡片的更新狀態仰賴 `catalogItems`（`:234` 只顯示「不在線上目錄」），未載入目錄就完全看不到更新。
- 每日自動檢查只送一則 feed 系統通知：「請到設定中的插件目錄檢視」（`electron/main/runtime.ts:889-898`，`pluginCatalogAutoCheckFound`），沒有 deep link，也沒有設定頁的更新徽章。
- `permissionsIncreased` 在建置目錄項目時永遠是 `null`（`electron/plugin-catalog-updates.ts:30`），因此卡片永遠顯示「簽章/權限會在更新確認時檢查」（`PluginPanel.vue:186-197`）；更新前使用者無法得知是否新增權限。
- 無「全部更新」、無版本更新日誌（changelog）、無目錄最後檢查時間、無失敗原因細節。
- 目錄 URL 輸入框在頂層（`:135-157`）：「儲存」「還原預設」「載入」三個按鈕並列，語意重疊。
- `catalogCheckComplete` 為 true 後，「不在線上目錄」徽章會對所有手動/本機安裝插件顯示，容易被誤解為警告。

**使用者影響**：使用者以為「有更新機制」，但實際上需手動、且看不到哪些可更新、更新會有什麼風險。

**子任務**
- [ ] 1. 進入「探索」分頁且目錄啟用時自動載入（顯示快取 + 背景更新），並顯示「上次檢查：HH:mm」。
- [ ] 2. 在 snapshot 中加入 `updateAvailableCount` 與 per-plugin `updateVersion`，讓已安裝卡片不需先載目錄就能顯示「可更新 → v1.2.0」。
- [ ] 3. 設定的「插件」分頁標籤加上更新紅點/數字徽章（`StatusPanel.vue:42` 的 section 型別需支援 badge）。
- [ ] 4. 自動檢查通知加上動作：點擊直接開啟 Plugins → 探索分頁（Feed 項目 `link` 或新 IPC deep link）。
- [ ] 5. 實作 `permissionsIncreased`（比較目錄 manifest 與 `comparePluginPermissionUnits`，`plugin-catalog-updates.ts:50`），在卡片上顯示「此更新新增權限」。
- [ ] 6. 顯示更新日誌/摘要（目錄 schema 若無欄位，先放 release notes 連結）。
- [ ] 7. 加入「全部更新」（逐一進入 Sheet，不得繞過同意）。
- [ ] 8. 把 URL 設定收進「目錄設定」摺疊區，預設隱藏；`儲存/還原` 改為單一「套用」，還原預設為連結樣式。
- [ ] 9. 「不在線上目錄」徽章改為中性資訊（「本機安裝」），不使用警告語氣。
- [ ] 10. 載入中顯示骨架卡片，失敗顯示可重試的 inline 錯誤（`pluginCatalogUnavailable` 等）。

**修改檔案**：`PluginPanel.vue`（或新 `PluginCatalog.vue`）、`usePluginPanelController.ts`、`electron/plugin-catalog-updates.ts`、`electron/main/runtime.ts`（只動 `:873-904`）、`src/types/plugin-catalog.ts`、`StatusPanel.vue`、locales、docs `publishing*.md`。

---

## PL-08 目錄卡片與已安裝卡片資訊過載且被 `nowrap` 截斷（P1）

**證據**
- `PluginPanel.css:68` `.plugin-copy span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`：描述（`PluginPanel.vue:177`）、ID、簽章指紋、更新狀態全部單行省略號，**描述無法閱讀**，也沒有 tooltip（只有 `strong` 有 `:title`）。
- 目錄卡片一張最多 9 行 span（`:175-200`）：名稱、ID·作者、描述、版本、簽章、已安裝版本、權限檢查、金鑰狀態、較舊警告。
- 已安裝卡片每張同時含 7-8 個控制：啟用、靜音、頻率欄位、目標寵物、移除、回報、開啟面板，再加兩個主機清單（`:247-316`），單張卡片高度極長。
- 目錄卡片沒有圖示（已安裝卡片有），也沒有分類/標籤/截圖。
- 版本號、指紋以 `font-xs` 文字呈現，與重要資訊（更新可用）無層級區分。
- `plugin-development-badge` 使用未定義 token（見 PL-15），在實際繪製時外觀不可預期。
- `.plugin-status` 以 `max-width: 34%` 省略狀態文字（`:70`），「因崩潰停用」在窄寬會被截斷。

**使用者影響**：找不到插件在做什麼；卡片視覺雜訊高，看不出「哪個需要我處理」。

**子任務**
- [ ] 1. 重做卡片 anatomy：圖示、名稱+版本、一行描述（`-webkit-line-clamp: 2`，可展開）、狀態 chip、主要動作。
- [ ] 2. 次要資訊（ID、作者、簽章指紋、主機清單）收進展開區或詳情頁。
- [ ] 3. 狀態一律用 chip（已啟用/已停用/崩潰/不相容/可更新/開發版），顏色與圖示並用（不單靠顏色）。
- [ ] 4. 為所有被截斷文字加 `title` 或在詳情頁完整顯示；描述不得單行截斷。
- [ ] 5. 目錄卡片補上圖示（目錄 schema 若無則用預設佔位）與「已安裝/可更新/安裝」單一主按鈕。
- [ ] 6. 每張已安裝卡片控制項縮減為：啟用開關 + 主要動作 + `⋯`；其餘移至詳情頁（呼應 PL-02）。
- [ ] 7. 窄寬（≤ 460px）時改為單欄堆疊，狀態 chip 換行而非省略。
- [ ] 8. 加入列表搜尋/篩選（已安裝也需要：已啟用、可更新、有問題）。

**修改檔案**：新 `PluginCard.vue`、`PluginCatalogCard.vue`、`PluginPanel.css`（拆分）、`PluginPanel.vue`、locales。

---

## PL-09 通知（Feed）入口埋在設定底部，未讀數只在邊緣縮起模式顯示（P1）

**證據**
- 插件通知清單位於 Plugins 分頁的最底（`PluginPanel.vue:428-456`），要先捲過整頁。
- 未讀數只出現在寵物邊緣縮起徽章：`DesktopPet.vue:615-621`（`edge-peek-unread-badge`，僅 `v-if` 縮起模式）；面板標題列、設定分頁、Sessions 分頁均無未讀指示（`StatusPanel.vue` 無 `pluginFeedUnreadCount` 使用）。
- 通知列 `title · body` 串在單行 `nowrap`（`:444`、`PluginPanel.css:100`），無法閱讀完整內容。
- 只有逐則「標記已讀」（`:450`），沒有「全部標記已讀」；「全部清除」無確認（`:434`，`clearNotifications()` `:878`），且 `clearNotifications(pluginId?)` 已支援依插件清除但 UI 未提供。
- 沒有依插件篩選、沒有群組（今天/更早）、沒有未讀強調（只靠 `opacity:.68` 淡化已讀 `:98`）。
- 通知若帶 `link`，只提供「開啟通知連結」文字按鈕，沒有說明將開啟哪個網域（外部連結安全上下文）。

**使用者影響**：插件的主要價值（通知/提醒）在 UI 上幾乎看不見；使用者錯過通知也不知道去哪裡找。

**子任務**
- [ ] 1. 在 StatusPanel Sessions 主畫面（或標題列）新增通知鈴鐺 + 未讀計數，點擊進入通知收件匣。
- [ ] 2. 設定的「插件」分頁標籤顯示未讀徽章（與 PL-07 共用 badge 機制）。
- [ ] 3. 通知列改多行：插件圖示、標題（粗）、內文（最多 3 行可展開）、時間（相對時間）。
- [ ] 4. 未讀以圓點 + 粗體標示，不僅靠透明度（無障礙）。
- [ ] 5. 新增「全部標記已讀」、依插件篩選、「清除此插件」，全部清除加 undo Toast 而非 confirm。
- [ ] 6. 連結按鈕顯示目的網域（`links` host）並以外部連結圖示標示。
- [ ] 7. 空狀態說明「插件可在此傳送通知；到插件詳情可靜音」，並連結到靜音設定。
- [ ] 8. 通知列支援鍵盤操作（Enter 展開、Delete 清除）。
- [ ] 9. 維持 `edge-peek` 徽章，並在面板打開時同步（單一來源 `store.pluginFeedUnreadCount`）。

**修改檔案**：新 `PluginNotificationInbox.vue`、`StatusPanel.vue`（標題列/分頁徽章）、`DesktopPet.vue`（僅必要同步）、`src/stores/agentStore.ts`、`PluginPanel.vue`、locales。

---

## PL-10 面板視圖（Panel view）外框、載入與錯誤狀態不足（P1）

**證據**
- 外框標題固定為「插件內容」副標（`PluginPanel.vue:47`，`pluginPanelContent`），而 manifest 已解析 `contributes.panelView.title`（`electron/plugin-manifest.ts:311`）但 renderer 完全沒使用（grep `panelView.title` 無其他命中）；文件 `panel-view.zh-TW.md` 範例還特別示範 `title`。
- 載入期間：`electron/plugin-panel-view.ts:221` 最長 15 秒載入計時、握手 2 秒（`:225`），期間 `.plugin-panel-view-content` 為空白（`PluginPanel.css:12`），沒有 spinner、沒有「正在載入」文字、沒有取消。
- 載入失敗/崩潰/關閉時，`handlePluginPanelViewClosed`（`usePluginPanelController.ts:254-261`）把錯誤丟進 `errorMessage`，但此時頁面已切回列表，錯誤顯示在列表中段（見 PL-03）；沒有「重新載入」按鈕。
- **重開 bug**：`StatusPanel.vue:62-64,125-128` 傳入的 `requestedPluginId` 在使用者關閉面板後仍保留；之後任何 `refreshPanel()`（切換開關、按重新整理）都會因 `usePluginPanelController.ts:352-355` 再次 `openPluginPanelView(requestedPluginId)`，面板被「莫名重開」。
- 視窗被隱藏後再顯示：`onPanelWindowHidden`（`plugin-panel-view.ts:312-320`）只暫停，使用者沒有狀態提示；未握手時直接關閉（`reason: 'hidden'`）且被刻意不顯示錯誤（`:260`）。
- 外框沒有「返回列表」麵包屑，只有最大化與 ✕；✕ 的語意是「關閉」而非「返回插件列表」，且沒有重新載入、沒有插件設定捷徑。
- 面板中沒有連結到該插件的權限/診斷（使用者判斷信任時缺少資訊）。

**使用者影響**：開啟插件面板像「黑屏等待」；失敗時回到列表看到一則找不到來源的錯誤；有時被自動重開。

**子任務**
- [ ] 1. 外框標題使用 manifest `panelView.title[locale]`，副標改為插件名 + 版本 + 簽章狀態 chip。
- [ ] 2. 載入中顯示骨架/spinner 與「正在載入 {name}…」，超過 5 秒顯示「仍在載入，可取消」。
- [ ] 3. 面板失敗時停留在外框內顯示錯誤狀態（原因 + `重新載入` + `回到插件列表` + `回報問題`），而非直接跳回列表。
- [ ] 4. 修正 `requestedPluginId` 一次性消費：開啟後通知 StatusPanel 清除（或 controller 內部記錄已處理 token）。
- [ ] 5. 外框加入 `← 返回` 麵包屑、`↻ 重新載入`、`⚙ 設定/權限` 捷徑（跳詳情頁）。
- [ ] 6. 視窗隱藏/再顯示提供無感還原；若因 hidden 被關閉，在重新開啟面板時以 Toast 說明。
- [ ] 7. 外框 title 與 `aria-label` 使用同一來源，並替整個 section 加 `role="region"` 與標題關聯。
- [ ] 8. 增加對「面板被停用/全域關閉」的即時處理說明（目前 `closeIfNotAllowed` 靜默關閉）。
- [ ] 9. 補上 phase 報告的手動驗證項（Windows/macOS）。

**修改檔案**：`PluginPanel.vue`（外框區 `:35-72`）、`PluginPanel.css`（`:2-39`）、`usePluginPanelController.ts`（`:197-261, :352-355`）、`StatusPanel.vue`（`:120-128`）、新 `PluginPanelFrame.vue`、locales、docs `panel-view*.md`。（`electron/plugin-panel-view.ts` 僅在需要新增 `loading` 事件時才動。）

---

## PL-11 面板視窗尺寸/定位/最大化行為不一致且不持久（P2）

**證據**
- 手動調整的尺寸只存在記憶體 `PluginPanelWindowSizer.manualSizes`（`electron/plugin-panel-window.ts:53`），App 重啟即遺失；文件寫「使用者為這個插件頁手動選擇的大小優先」卻沒說只限本次工作階段（`panel-view.zh-TW.md`）。
- 尺寸夾限常數寫死：寬 320–960、高 240–800（`plugin-panel-window.ts:30-33`），在 4K 螢幕與大尺寸工作區不能更大；最大化只是 `maximizedPluginPanelWindowSize`（renderer 端 `usePluginPanelController.ts:177-182`）加上 `position: fixed` 覆蓋（`PluginPanel.css:3`），並非真正的視窗最大化。
- 最大化時 CSS 使用 `z-index: 10000; position: fixed`（`PluginPanel.css:3`），覆蓋整個設定 UI，Esc 還原（`:191-195`），但沒有在 UI 上提示 Esc，也沒有雙擊標題列還原。
- 開啟面板時視窗會 resize（`begin()` 套用 preferredSize），使用者感受到視窗大小「跳」；關閉再還原（`finish()`），位置動畫沒有說明。
- 最大化狀態在切換插件時重置（`shouldResetPluginPanelMaximized`），但不記住使用者偏好。
- 邊角：近期連續修正（`plugin-panel-corners-review.md`、`plugin-panel-resize-fix.md`、`plugin-panel-maximize-review.md`）顯示這塊仍高度脆弱，缺乏視覺回歸測試。

**使用者影響**：每次重開插件頁都得重新調整視窗；最大化表現與一般視窗不同。

**子任務**
- [ ] 1. 把 `manualSizes` 持久化到 plugin preferences（含 schema 版本，沿用既有 `plugin-preferences.ts`），並做螢幕工作區邊界保護。
- [ ] 2. 依螢幕工作區比例調整上限（例如 ≤ 90% 工作區），取代固定 960×800。
- [ ] 3. 在外框顯示最大化提示（tooltip 含「Esc 還原」）並支援雙擊標題列切換。
- [ ] 4. 面板開啟/關閉的尺寸變化加入 200ms 動畫並尊重 `prefers-reduced-motion`。
- [ ] 5. 記住每個插件的最大化偏好（可選，預設關）。
- [ ] 6. 開啟前提示「需要較大空間」的插件在小螢幕下的降級行為。
- [ ] 7. 為尺寸、角落與最大化加入截圖式回歸測試或至少更多 `plugin-panel-window` 單元測試（跨 DPI）。
- [ ] 8. 文件明確說明「尺寸記憶範圍」與「插件不能自行縮放」。

**修改檔案**：`electron/plugin-panel-window.ts`、`electron/plugin-preferences.ts`（schema 變動需 minor 版本評估）、`electron/main/runtime.ts`（只動 `:1888-2044`）、`usePluginPanelController.ts`（尺寸段）、`PluginPanel.css`、tests、docs。

---

## PL-12 破壞性操作的確認摩擦不一致（P1）

**證據**
- 「移除」每張卡片都有紅色 danger 按鈕並列在控制列（`PluginPanel.vue:284`），與靜音、頻率等設定同排，誤觸風險高；對話框預設不保留資料（`requestRemove` `usePluginPanelController.ts:829-833` 設 `keepData=false`），而文案同時說「無法復原」與「保留設定與資料」，語意矛盾。
- 「撤銷主機授權」按鈕（`:311`）一鍵立即生效，無確認、無 undo、無說明後果；但移除插件需要 Dialog——摩擦程度不一致。
- 「全部清除」通知（`:434`）無確認、無 undo。
- 「關閉全域插件開關」（`:77-82`）會停止所有插件，同樣無確認或說明受影響插件數。
- 「安裝」的確認偏重（長文字對話框），而「啟用有網路權限的插件」本身卻不需要確認。
- 關閉單個插件開關會立即關閉開啟中的面板（`closeIfNotAllowed`），沒有提示。
- 「密鑰」存檔的一次性同意（`pluginSecretConsent*`）只顯示一次，之後 macOS Keychain 提示行為使用者無從預期。

**使用者影響**：真正危險的（移除資料）位置太容易誤觸；不危險的（清除通知）反而有確認不一致。

**子任務**
- [ ] 1. 建立破壞性操作規則：不可逆資料刪除 → 對話框；可還原 → undo Toast。
- [ ] 2. 「移除」移進詳情頁/`⋯` 選單，並與一般控制分離（視覺間距 + 次級樣式）。
- [ ] 3. 移除對話框改為兩個明確選項：「移除並保留設定與資料」「移除並刪除所有資料」，預設為保留。
- [ ] 4. 撤銷主機授權加入 undo Toast（5 秒內可還原）並說明「插件之後要連線會再次詢問」。
- [ ] 5. 全域關閉時 Toast 顯示「已停止 N 個插件 · 復原」。
- [ ] 6. 清除通知改為 undo Toast（需主程序支援軟刪除 5 秒，或前端延遲提交）。
- [ ] 7. 停用插件而面板開啟中時，顯示「此插件已停用，面板已關閉」說明。
- [ ] 8. 密鑰同意文案補充「不會上傳」並提供「略過」安全替代（見 PL-13）。

**修改檔案**：`PluginPanelDialogs.vue`、`usePluginPanelController.ts`、`PluginPanel.vue`、`electron/plugin-feed.ts`（若做軟刪除）、locales。

---

## PL-13 插件設定表單（settings/secret）缺少驗證、說明、dirty 狀態（P1）

**證據**
- 設定欄位只用 `title` 當標籤（`PluginPanel.vue:338-389`），`definition.description`（若 schema 有）完全沒顯示；enum 選項直接顯示原始值 `option`（`:375`），無本地化標籤。
- 數字欄位使用 `@input` 即寫入 draft 並 `Number(raw)`（`usePluginPanelController.ts:451-454`）：空字串變 `0`，沒有 `min/max` 驗證訊息（只有 HTML 屬性，無提示）。
- 儲存按鈕總是可點（`:390`），無 dirty 指示、無「已儲存」狀態、離開不警示（`watch(selectedPluginId)` 會直接重置草稿 `:397-401`）。
- 密鑰：欄位 `type=password`，儲存空字串等同「清除」，但按鈕文案固定是「儲存」（`pluginSecretSave`），也沒有獨立的「移除密鑰」按鈕；成功訊息在清除時顯示「設定已儲存」（`:508`）。
- 密鑰同意對話框的說明「macOS 可能會詢問是否允許存取鑰匙圈」置於一次性對話框，沒有在欄位旁提示；也沒有 Windows/Linux 對應說明。
- 沒有「重設為預設」、沒有欄位層級的錯誤（`settings_invalid` 只回傳整體錯誤）。

**使用者影響**：設定很像表單半成品；清除密鑰很危險地被藏在「儲存空值」裡。

**子任務**
- [ ] 1. 顯示 `description` 與 `help`，enum 支援 `{value,label}` 本地化（schema/manifest 驗證同步）。
- [ ] 2. 數字欄位使用 `@change`/blur 驗證，顯示 min/max inline 錯誤，空值不寫入。
- [ ] 3. 加入 dirty 狀態：未變更時「儲存」disabled；變更時顯示「未儲存的變更」並提供「還原」。
- [ ] 4. 離開（切換插件/分頁/關閉）時有未儲存變更要確認。
- [ ] 5. 密鑰區改為：狀態 chip（已設定/未設定）+「設定/更新」按鈕 + 獨立「移除」按鈕（含確認）。
- [ ] 6. 密鑰欄位旁常駐說明「以系統鑰匙圈加密，不會離開本機」，依平台顯示正確文案。
- [ ] 7. 加入「重設為預設值」。
- [ ] 8. 欄位層級錯誤回傳（`settings_invalid` 附帶 key），顯示在對應欄位。
- [ ] 9. 為 settings 表單補元件測試（dirty、驗證、秘密清除）。

**修改檔案**：新 `PluginSettingsForm.vue`、`usePluginPanelController.ts`（settings 段 `:397-534`）、`electron/plugin-settings.ts`（欄位錯誤回傳，若採用）、`src/types/plugin.ts`、`docs/plugins/manifest*.md`、locales。

---

## PL-14 鍵盤、焦點與螢幕閱讀器無障礙缺口（P1）

**證據**
- 每張卡片重複同名開關：`ToggleRow` label 都是「啟用」「靜音通知」（`PluginPanel.vue:248-259`），螢幕閱讀器朗讀時無插件上下文；`移除`/`回報問題`/`開啟插件面板` 按鈕同樣沒有 `aria-label` 帶插件名（`:284-298`）。
- `ToggleRow` 為 `label` 包裹隱藏 checkbox（`ToggleRow.vue`），沒有 `role="switch"`。
- 狀態只靠顏色/文字：`tone-success/warn/neutral`（`PluginPanel.css:71-73`）；`--text-warning` 未定義時會退回 `--text-secondary`，「警告」與「中性」幾乎無差（見 PL-15）。
- 未讀通知僅靠 `opacity: .68`（`:98`）。
- 開啟面板檢視後焦點沒有移到外框/內容，也沒有「回到觸發按鈕」的焦點還原（`openPluginPanelView`/`closePluginPanelView`）；Esc 只在最大化時處理（`:191-195`），一般狀態下 Esc 不能關閉面板。
- 外框 `<section>` 沒有 `aria-label`（`PluginPanel.vue:35-41`）；錯誤 `role="alert"` 與狀態 `role="status"` 都在頁面中段，不在使用者焦點附近。
- `ConfirmDialog` 的 Tab 迴圈只含 button（見 PL-05）；關閉後未還原焦點。
- 數字欄位 `@change`，鍵盤 Enter 不會提交（需 blur）。
- `plugin-count` `aria-live="polite"`（`:222`）會在每次重新整理時朗讀數字，產生雜訊。

**使用者影響**：鍵盤與讀屏使用者幾乎無法有效管理插件；也影響一般使用者的快速操作。

**子任務**
- [ ] 1. 所有卡片內控制項加入 `aria-label`/`aria-describedby` 帶插件名（或使用 `fieldset + legend`）。
- [ ] 2. `ToggleRow` 加 `role="switch"` 與 `aria-checked`（共用元件，需與全站協調）。
- [ ] 3. 狀態 chip 加圖示與文字，不僅靠色彩；已讀/未讀使用符號與字重。
- [ ] 4. 實作焦點管理：開啟面板 → 焦點到外框標題；關閉 → 回到「開啟面板」按鈕；Dialog 關閉 → 回到觸發元素。
- [ ] 5. Esc 在面板內（非最大化）也可返回列表；說明於 tooltip。
- [ ] 6. 數字欄位支援 Enter 提交與 `inputmode="numeric"`。
- [ ] 7. live region 只用於回饋 Toast，移除 `plugin-count` 的 `aria-live`。
- [ ] 8. 列表使用 `ul/li` 或 `role=list` 並確保卡片內順序合理；快捷鍵 `j/k`（可選）。
- [ ] 9. 加入 `prefers-reduced-motion`、`forced-colors` 對普通列表區塊的覆寫（目前只有面板外框有，`PluginPanel.css:25-39`）。
- [ ] 10. 補 axe/Playwright 無障礙檢查。

**修改檔案**：`PluginPanel.vue`、`PluginPanel.css`、`ui/ToggleRow.vue`（共用）、`ui/ConfirmDialog.vue`（共用）、`usePluginPanelController.ts`、tests。

---

## PL-15 設計系統一致性：未定義 token、硬編碼 hex、非共用元件（P2）

**證據**
- 未在 `src/styles/` 定義的 token 被使用：`--font-2xs`（`PluginPanel.css:69`，無 fallback → 宣告失效）、`--text-success`（`:43,:71`）、`--text-warning`（`:72,:94`）、`--text-danger`（`:93`）、`--surface-secondary`（`:69`）。已 grep 確認 `src/styles` 無定義。
- 硬編碼：`#c33`、`#a70`（`PluginPanel.css:93-94`）；`font-size: 10px`（`:91`，低於 11px 下限，違反 `ui-design-system.md`）。
- 大量原生 `<input type=number/url/search>`、`<select>`、`<input type=checkbox>`（`PluginPanel.vue:108,138,167,262,275,345,360,368,377`），各自用 `.plugin-preference-field input` 樣式（`PluginPanel.css:76`）；僅診斷區使用共用 `Select`（`:401`）。設計系統要求使用共用 primitive 且不得出現新的一次性樣式。
- 原生 `select` 沒有關閉 OS 原生箭頭（設計文件提過此問題）。
- 狀態色：`.tone-success` fallback `--accent`、`.tone-warn` fallback `--text-secondary`（`:71-72`）。
- `Card` 的 `tone` 傳入 `pluginStatusTone`（`PluginPanel.vue:227`）但 neutral/warn 的語意色是否符合設計系統需檢查；每張卡片套 tone 容易造成「色彩氾濫」（設計文件警告）。
- 面板外框 `dark` 媒體查詢把所有 token 直接設為 `Canvas/CanvasText`（`PluginPanel.css:13-24`），無視 Liquid Glass 與 organic 主題，外框與其餘面板視覺不連貫。
- CSS 單檔 110 行、全 inline 風格壓縮成單行，難以維護。

**使用者影響**：插件分頁看起來「不像同一個 App」，且部分文字過小/狀態色不可辨。

**子任務**
- [ ] 1. 在 `src/styles/tokens.css` 新增或改用既有語意 token（success/warning/danger text、`--font-2xs` 若確需則不低於 11px）。
- [ ] 2. 移除 `#c33/#a70/10px`，全面使用 token。
- [ ] 3. 建立共用 `Input.vue`、`NumberField.vue`、`Checkbox.vue` primitive，取代原生欄位樣式。
- [ ] 4. 所有 `<select>` 改共用 `Select`，並遵守「關閉原生箭頭」。
- [ ] 5. 新增共用 `Chip/Badge.vue`，取代 `.plugin-development-badge` 與 `.plugin-status`。
- [ ] 6. 面板外框依 `liquid-glass.md` 規則重做（材質、圓角、高光），移除 `Canvas` 硬覆寫，並保留 `forced-colors` 例外。
- [ ] 7. Card `tone` 只用於需要注意的卡片（崩潰/不相容），一般卡片維持 neutral。
- [ ] 8. CSS 拆分為 `plugin-card.css`、`plugin-dialogs.css` 等並格式化多行。
- [ ] 9. 加入 lint（stylelint 或腳本）擋下未定義 token 與裸 hex。

**修改檔案**：`PluginPanel.css`、`src/styles/tokens.css`（共用，注意衝突）、新 `src/components/ui/{Input,NumberField,Checkbox,Chip}.vue`、`PluginPanel.vue`、`.agents/skills/pet-skill/references/ui-design-system.md`。

---

## PL-16 i18n 與文案問題（P2）

**證據**
- zh-TW 與 en-US 鍵值完全對應（534 對 534，無缺鍵）——但品質與一致性有缺口：
  - zh-TW 夾雜英文技術詞：`net.fetch 單次回應大小`、`net.fetch 逾時秒數`、`每插件 storage 容量`、`schedule 最短間隔`（`pluginResource*`）、`在 Tray 選單新增項目`（`pluginPermissionTray`）、`Tray 插件項目超過 30 個上限`（`pluginTrayOverflowDiagnostic`）。
  - 「密鑰」「金鑰」「鑰匙圈」混用（`pluginPermissionSecret`「讀取密鑰設定」、`pluginSignatureFingerprint`「作者金鑰」、`pluginSecretConsentMessage`「系統鑰匙圈」）。
- 技術碼外露：`diagnosticCodeLabel`（`usePluginPanelController.ts:904-914`）在 zh-TW 顯示「拒絕 {method}（{code}）」，如 `net.fetch`/`not_permitted`；日誌等級直接顯示 `entry.level` 的英文（`PluginPanel.vue:411`，大寫）；日誌訊息來自插件，不可翻譯但也沒有標示「插件提供」。
- `permissionLabel` 對未知單位直接回傳原始字串（`:759-778` `return unit`）：新增權限類型時會在授權畫面漏出內部代碼。
- 單位硬編碼：`resourceBoundText` 以英文 `MB`/`KB`/`s`/`/ min`/`/ 10 min`（`:652-662`），未走 i18n/Intl。
- 日期使用 `toLocaleString`，OK；但相對時間未使用。
- 簽章狀態 `plugin.signatureStatus === 'unverified'` 與 `plugin.development` 都映射為「開發者未驗證」（`PluginPanel.vue:237`），zh-TW 對一般使用者語意不清。
- 一般性錯誤 `pluginActionFailed`「插件操作失敗，請重新整理後再試」被 12+ 錯誤碼共用（`localizedError :303-310`），丟失資訊。
- 文案以「插件」為主，但文件、Feed 通知與 Tray 混用「外掛」/ plugin 的狀況需全面檢查。
- `pluginCatalogAutoCheckFound`：「請到設定中的插件目錄檢視」未說明路徑（見 PL-07）。

**使用者影響**：中文使用者面對半英文半中文介面，不易理解權限與限制。

**子任務**
- [ ] 1. 建立 zh-TW 術語表：插件、密鑰、金鑰、鑰匙圈、系統匣（Tray）、面板、通知；全站套用。
- [ ] 2. 重寫含英文 API 名稱的字串，把 API 名稱放括號副註（例：「網路請求單次回應大小（net.fetch）」）。
- [ ] 3. 診斷訊息對使用者以人話呈現，原始 `method/code` 收進「技術細節」。
- [ ] 4. 日誌等級以本地化 chip（錯誤/警告/資訊）顯示。
- [ ] 5. `permissionLabel` 未知單位改為「未知權限（{unit}）」並於開發環境丟出警告，補單元測試確保所有 manifest 貢獻點皆有文案。
- [ ] 6. 單位改用 `Intl.NumberFormat`/i18n key（KB、MB、秒、次/分鐘）。
- [ ] 7. 拆分 `pluginActionFailed`：為 `dialog_unavailable`、`install_failed`、`registry_unavailable`、`invalid_request` 提供專屬文案與下一步。
- [ ] 8. 加入 i18n 測試：所有 `plugin*` key 的 zh-TW 與 en-US 佔位符一致（`tests/i18n.test.mts` 擴充）。
- [ ] 9. 檢查 docs 中文版與 App 內用語一致。

**修改檔案**：`src/locales/zh-TW.json`、`en-US.json`（共用，注意衝突）、`usePluginPanelController.ts`（`permissionLabel`/`diagnosticCodeLabel`/`resourceBoundText`）、`tests/i18n.test.mts`、`docs/plugins/*.zh-TW.md`。

---

## PL-17 進階/開發者/診斷資訊對一般使用者曝光過度（P1）

**證據**
- 「進階設定」Card 位於頁面上方，含 8 個資源硬上限（`PluginPanel.vue:96-124`）與開發者模式，全部對所有使用者開放；「超出範圍的值會被拒絕」（`pluginAdvancedSettingsHelp`）。
- 診斷區（日誌、被拒絕的呼叫）對所有使用者顯示（`:395-426`）；日誌最高 180px 內捲（`PluginPanel.css:88`），沒有複製、匯出、篩選。
- 「回報問題」按鈕（`:287`）與「移除」並列，使用者不知道會送出什麼資料（`reportInstalledPluginIssue` 的資料內容沒有預覽）。
- 開發者模式只是一個 toggle（`:98-104`），沒有警示「將允許載入未簽章資料夾」之類的安全說明；開啟後頂端出現「載入資料夾」按鈕。
- 目錄 URL 編輯同樣是開發性質。
- 每張卡片「主機清單」區塊（宣告主機 vs 已授權主機 `:300-316`）兩個標題連續出現，語意難分，使用者難以理解「宣告」與「授權」的差異。

**使用者影響**：一般使用者被技術細節淹沒；進階使用者卻缺少匯出/複製等實用功能。

**子任務**
- [ ] 1. 把進階/開發者/診斷集中到「進階」分頁（預設不顯示，開啟開發者模式後才出現診斷與資料夾載入）。
- [ ] 2. 資源硬上限提供「簡單/自訂」切換與預設值預設按鈕；顯示目前使用量（記憶體、儲存）。
- [ ] 3. 開發者模式開啟時顯示安全警示 Banner 與「如何關閉」。
- [ ] 4. 診斷日誌加入複製、清除、依等級篩選、自動捲動到最新。
- [ ] 5. 「回報問題」改為在詳情頁，點擊先預覽將附帶的資訊（插件 ID、版本、近期錯誤碼；不含個資），再送出。
- [ ] 6. 主機清單改為單一表格：`網域｜插件宣告｜狀態（已允許/待詢問）｜撤銷`。
- [ ] 7. 為「宣告 vs 授權」增加 tooltip 說明。
- [ ] 8. 診斷預設顯示摘要（最近一次錯誤），展開才看全部。

**修改檔案**：`PluginPanel.vue`、新 `PluginAdvanced.vue`、`PluginDiagnostics.vue`、`PluginHostTable.vue`、`electron/plugin-report.ts`（預覽資料契約，若需）、locales、docs `debugging*.md`。

---

## PL-18 Tray、徽章、事件來源等貢獻點對使用者「不可見、不可控」（P2）

**證據**
- Tray：限制 30 項，超出僅由診斷訊息提示（`electron/plugin-tray.ts:16,32-33`、`pluginTrayOverflowDiagnostic`），使用者在設定中看不到「哪個插件的 Tray 項目被省略」，也沒有開關控制 Tray 項目。
- 徽章：每隻寵物最多 2 個（`electron/plugin-badges.ts:6`），超出顯示「還有 N 個插件徽章」；使用者無法在設定中選擇要顯示哪些徽章，或在卡片看到插件目前的徽章。
- 事件來源（eventSource）狀態只顯示在 Sessions 分頁（`StatusPanelSessions.vue:141-156`），標題「來自插件：{name}」，沒有連到插件詳情或停用捷徑。
- 寵物外觀（skins）出現在寵物選單 `pluginPetFromPlugin`，但在插件卡片中看不出「此插件提供外觀」。
- 插件貢獻的內容在卡片上沒有「提供：面板、指令、Tray、徽章、外觀」之類的能力標籤，只在安裝確認時列一次權限。
- `plugin-panel-view.ts` 使用者可見的面板入口只有設定頁；沒有 Tray/寵物右鍵選單的「開啟插件面板」捷徑（現有 Tray 只放指令）。
- 目標寵物（`targetPetId`）選擇（`PluginPanel.vue:273-283`）只針對通知/反應；用語「目標寵物」未說明影響範圍。

**使用者影響**：插件的實際作用散在 App 各處，使用者難以理解「這個東西是哪個插件造成的」，也無法就地管理。

**子任務**
- [ ] 1. 卡片加入「貢獻能力」chips（面板、指令、Tray、徽章、外觀、事件來源、排程），來自 manifest。
- [ ] 2. 詳情頁新增「在 App 中的呈現」區：Tray 項目預覽、徽章目前值、事件來源狀態。
- [ ] 3. Tray 溢位時在詳情頁/插件卡片顯示「部分指令未顯示於 Tray（上限 30）」，並提供「選擇要顯示的指令」。
- [ ] 4. 徽章顯示排序/開關設定（每插件「顯示徽章」開關）。
- [ ] 5. Sessions 分頁的插件事件來源列加上「管理」按鈕 → 詳情頁。
- [ ] 6. Tray 增加「插件面板」子選單項目（使用既有面板開啟 IPC 通道）。
- [ ] 7. 「目標寵物」改名為「通知與反應顯示在哪隻寵物」，並加說明。
- [ ] 8. 寵物選擇頁中的插件外觀標示來源並連結到插件詳情。

**修改檔案**：`PluginPanel.vue`/`PluginDetail.vue`、`electron/plugin-tray.ts`、`electron/plugin-badges.ts`（只讀/排序設定）、`StatusPanelSessions.vue`、`SettingsPets.vue`、locales、docs `contribution-points*.md`。

---

## 新畫面設計提案：「插件」區域重構

### 設計原則
1. 已安裝優先；探索/進階後置。
2. 單一詳情頁承載所有「單一插件」的設定、權限、診斷、移除。
3. 統一回饋（Toast）與統一確認規則（可還原用 undo，不可逆用 Sheet）。
4. 安全相關資訊（權限、簽章）分級、可讀、可比對。
5. 遵守 Liquid Glass 規則與既有 token；不新增一次性樣式。

### 線框（設定 → 插件，460×720 預設視窗）

```
┌ 設定 ─────────────────────────────── ✕ ┐
│ [外觀][桌面][插件●2][寵物][成長][進階]   │  ← 「插件」分頁帶更新/未讀徽章
├──────────────────────────────────────────┤
│ 插件                       [＋ 安裝插件 ▾]│  ← ▾：本機檔案 / 開發者資料夾
│ 3 個啟用 · 2 個可更新 · 1 則未讀          │
│ ┌ 全域 ───────────────────────── [●開] ┐ │
│ │ 插件已啟用（關閉會停止所有插件）       │ │
│ └──────────────────────────────────────┘ │
│ [ 已安裝 5 ] [ 探索 ] [ 通知 1 ] [ 進階 ] │  ← segmented tabs
│ ─────────────────────────────────────── │
│ 🔍 搜尋已安裝…        篩選：全部 ▾        │
│ ┌──────────────────────────────────────┐ │
│ │ ◆ Update Radar  v0.3.0   [已啟用]     │ │
│ │ 追蹤 GitHub 發版並在寵物旁提醒…（2行） │ │
│ │ ✔ 已驗證簽章 · 面板 指令 徽章          │ │  ← 能力 chips
│ │ [ 開啟面板 ]  [ 設定 ]  [●開關]  [⋯]  │ │
│ │ ⬆ 可更新至 0.4.0（新增權限）  [更新]   │ │
│ └──────────────────────────────────────┘ │
│ ┌ ◇ Demo Panel  v1.0.0  [因崩潰停用] ──┐ │
│ │ 已連續崩潰 3 次。 [重新啟用] [查看診斷] │ │  ← 問題卡置頂或醒目
│ └──────────────────────────────────────┘ │
│ ── 空狀態（無插件）：                      │
│     「插件可為寵物增加提醒、面板與外觀」     │
│     [瀏覽插件目錄]  [安裝本機檔案]  了解安全 │
└──────────────────────────────────────────┘
        ┌────────── Toast（固定於底部）──────┐
        │ ✔ 已安裝 Update Radar  [立即啟用]   │
        └────────────────────────────────────┘
```

#### 插件詳情頁
```
┌ ← 插件 / Update Radar ───────────── [⋯] ┐
│ ◆ Update Radar · v0.3.0 · 作者 xxx        │
│ ✔ 已驗證簽章（指紋 ab12 cd34 …）  [●啟用]  │
│ [ 開啟面板 ]                               │
│ ─ 總覽 ─ 設定 ─ 權限 ─ 指令 ─ 診斷 ─       │  ← 頁內分段
│ 權限（依風險分級）                         │
│  ▸ 網路：api.github.com   [撤銷]           │
│  ▸ 密鑰：token            [移除]           │
│  ▸ 顯示：徽章、Tray、面板                  │
│ 在 App 中的呈現：Tray 3 項 · 徽章「3」      │
│ 通知與反應顯示於：[主要寵物 ▾]  頻率 [10]  │
│ ─────────────────────────────────────── │
│ ⋯ 選單：回報問題（預覽內容）｜移除…         │
└──────────────────────────────────────────┘
```

#### 安裝/更新確認 Sheet（取代 300px 對話框）
```
┌ 安裝 Update Radar v0.4.0 ───────────────┐
│ 來源：線上目錄 · 作者 xxx · 128 KB       │
│ ⚠ 簽章金鑰已變更（需勾選確認）            │
│ 新增權限                                 │
│  ＋ 網路：api.example.com                │
│ 既有權限（3）▸                           │
│ ☐ 我已了解這些變更                        │
│ ─────────────────────── sticky 動作列 ── │
│            [取消]  [同意並安裝]            │
└──────────────────────────────────────────┘
```

### 元件分解與檔案歸屬（可平行）

| 元件 | 職責 | 檔案 | 對應問題 |
|---|---|---|---|
| `PluginPanelShell.vue` | 頁首摘要、全域開關、tabs、路由（列表/詳情/面板） | `plugin-panel/PluginPanelShell.vue` | PL-01, 02 |
| `PluginList.vue` + `PluginCard.vue` | 已安裝列表、搜尋/篩選、卡片 | `plugin-panel/` | PL-02, 08 |
| `PluginDetail.vue` | 詳情分段容器 | `plugin-panel/` | PL-02, 17, 18 |
| `PluginSettingsForm.vue` | 設定/密鑰表單、dirty | `plugin-panel/` | PL-13 |
| `PluginPermissions.vue` / `PluginHostTable.vue` | 權限分級、主機表 | `plugin-panel/` | PL-05, 17 |
| `PluginCatalog.vue` + `PluginCatalogCard.vue` | 探索、更新、自動載入 | `plugin-panel/` | PL-07, 08 |
| `PluginNotificationInbox.vue` | 通知收件匣 | `plugin-panel/` | PL-09 |
| `PluginInstallSheet.vue` | 安裝/更新/移除 Sheet | `plugin-panel/` | PL-05, 12 |
| `PluginPanelFrame.vue` | 面板外框、載入/錯誤狀態 | `plugin-panel/` | PL-10, 11 |
| `PluginAdvanced.vue` / `PluginDiagnostics.vue` | 進階、診斷 | `plugin-panel/` | PL-17 |
| `ui/Toast.vue`、`ui/Chip.vue`、`ui/Input.vue`、`ui/EmptyState.vue` | 共用 primitive | `src/components/ui/` | PL-03, 06, 15 |
| `usePluginPanelController.ts` 拆分 | `usePluginList`、`usePluginCatalog`、`usePluginInstall`、`usePluginPanelView`、`usePluginNotify`、`usePluginNotifications` | `src/composables/plugin/` | PL-04 及全部 |

### 建議實作階段（每階段一個 phase，依 AGENTS.md 完成驗證後等使用者確認再升版）
- **Phase A（P0 優先）**：PL-03 Toast、PL-01 區塊重排與 tabs、PL-05 安裝 Sheet、PL-02 詳情頁。
- **Phase B**：PL-04 控制器拆分與局部更新、PL-10 面板外框/重開 bug、PL-12 確認規則、PL-13 設定表單。
- **Phase C**：PL-07 目錄/更新、PL-09 通知收件匣、PL-06 onboarding、PL-08 卡片重做。
- **Phase D**：PL-14 無障礙、PL-15 設計系統、PL-16 i18n、PL-17 進階/診斷、PL-18 貢獻點可見性、PL-11 視窗尺寸持久化（涉及 preferences schema，評估 minor 版本）。

### 分工矩陣（避免檔案衝突）

| 檔案 | 建議單一負責 | 涉及問題 |
|---|---|---|
| `src/components/PluginPanel.vue` / `.css` | 拆分為新元件後由「Shell」負責人持有 | 01, 02, 03, 08, 10, 14, 15, 17 |
| `src/composables/usePluginPanelController.ts` | 控制器負責人（先拆分再讓其他人接新 composable） | 02, 03, 04, 07, 10, 12, 13, 16 |
| `plugin-panel/PluginPanelDialogs.vue` + `ui/ConfirmDialog.vue` | 對話框負責人 | 05, 12, 14 |
| `src/locales/*.json` | 文案負責人（其他人僅追加 key，合併時由單人整併） | 全部 |
| `src/styles/tokens.css` + `ui/*` | 設計系統負責人 | 14, 15 |
| `StatusPanel.vue` / `DesktopPet.vue` / `agentStore.ts` | 通知/徽章負責人 | 07, 09, 18 |
| `electron/plugin-panel-window.ts`、`plugin-preferences.ts`、`main/runtime.ts` | 視窗/持久化負責人 | 11 |
| `electron/plugin-catalog-updates.ts`、`src/types/plugin-catalog.ts` | 目錄負責人 | 07 |
| `docs/plugins/*` | 文件負責人（最後整併） | 01, 06, 10, 11, 13, 16, 17, 18 |

### 附註（未列為大問題但值得追蹤）
- `PluginPanel.vue` 解構 100+ 個回傳值（`:13-31`），而 `usePluginPanelController.ts` 回傳物件還包含不應暴露的內部變數（如 `removeNotificationsListener`、`panelViewBoundsObserver`），耦合高、難測試；屬 PL-04 的拆分範圍。
- `plugin-panel-view-bridge.ts` 的 API 錯誤處理在面板內呈現給插件作者（`Error.code`），但使用者看不到對應提示；與 PL-10 的錯誤外框可共同設計。
- 近期 `plugin-panel-corners-review`、`plugin-panel-resize-fix`、`plugin-panel-maximize-review` 三份報告都集中在視窗幾何，顯示 UX 問題常以「修補」而非「系統性設計」處理；建議在 PL-11 建立視覺回歸測試。
- 本稿未啟動 App 實測；建議 Phase A 開始前，以隔離啟動器在 macOS 與 Windows 各錄製一次「首次安裝→啟用→開啟面板→更新→移除」的流程基線。
