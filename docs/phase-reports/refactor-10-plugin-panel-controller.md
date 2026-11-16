# 重構階段 10：Plugin 面板控制器按功能拆分

- **開始時間**：2026-11-10 15:34（Asia/Taipei）
- **完成時間**：2026-11-10 17:30（Asia/Taipei）
- **基準 commit**：`d5f5b47`（分支 `claude/refactor-10-plugin-ctrl-dc25f8`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 4 項；排程見 3.1 節

## 範圍

**第 4 項（Plugin 面板控制器按功能拆分）**：`src/composables/usePluginPanelController.ts`（1,508 行）同時處理 catalog、安裝、設定／secret、通知與原生 panel view。本階段依職責把功能完整的部分抽成 `src/composables/plugin/` 下的 composable，原控制器只負責組裝；共同的 scoped busy、序列佇列、refresh 協調與錯誤通知先抽成明確的依賴介面。

不在範圍：元件修改、IPC／preload／主程序修改、授權判定（仍在 main）、視覺變更。

## 驗收條件

1. `usePluginPanelController()` 回傳的欄位名稱、種類與型別不變（匯出清單測試＋臨時型別探針），使用它的元件不需修改。
2. 改前以 characterization 測試（Node 掛載真的控制器、假 IPC、假計時器）固定：未儲存設定的離開確認、secret consent 流程、非同步回應競態、panel view 開關與焦點還原、事件訂閱在 unmount 時清理；改後同一組測試通過。
3. 子 composable 之間不直接改對方的 ref，只透過依賴介面（getter、回呼）溝通。
4. secret 值不進 log、錯誤訊息或新的 state；授權判定仍在 main。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗）、`git diff --check` 通過；隔離 Electron 驗證安裝 fixture、設定儲存、未儲存離開確認、secret consent、原生 panel view 開關與焦點還原、通知顯示。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`d5f5b47`）：1405 項，1368 過、14 失敗、23 skip，見「基準失敗清單」 |
| 2 | 控制器 harness 與 characterization 測試（對原始控制器通過） | 通過 | 對 `d5f5b47` 原始控制器 32／35；失敗的 3 項是要修的既有缺陷（見「刻意的行為差異」） |
| 3 | 抽出共用依賴介面（busy、refresh、錯誤通知、競態守衛） | 通過 | `panel-deps.ts`；單元測試 6 項 |
| 4 | 抽出設定編輯（含 secret、consent、離開確認） | 通過 | `usePluginSettingsEditor.ts`；步驟 4–6 連續實作，狀態表在三者完成後一起更新，開始時沒有逐一先改「進行中」，特此註記 |
| 5 | 抽出原生 panel view lifecycle | 通過 | `usePluginPanelView.ts`；見步驟 4 註記 |
| 6 | 其他職責（通知、診斷、權限文字查表）與效能調整 | 通過 | 通知、診斷、權限文字、資源單位；characterization 38／38（實機修正後 39／39），型別探針全部欄位相同；見步驟 4 註記 |
| 7 | Code review、phase gates、安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 8 | 隔離 Electron 實機驗證 | 通過 | 第一輪發現設定儲存的既有缺陷（刻意差異 7），修正後重跑該項通過；見「隔離 Electron 驗證」 |
| 9 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-10-plugin-ctrl-dc25f8` |

## 基準失敗清單（`d5f5b47`）

任何程式修改前的完整 `test:unit`：1405 項，1368 過、**14 失敗**、23 skip。7 項 symlink EPERM 類（「a failed replace restores the previous pet…」「a file edit is medium only inside the project…」「a symlinked staging root is refused」「startup recovery restores interrupted replaces…」「git helpers never follow gitdir or commondir…」「git helpers refuse a symlinked info directory…」「removing hooks from a symlinked dotfile…」）、6 項 hook 計時類（「a busy app still gets the event…」「a permission request still reaches the pet when the hook is stalled…」「a starting app that never opens its port…」「a status event still arrives when the hook process is stalled…」「an answer that is cut off or never finishes…」「with the pet closed the hook does not wait…」）、1 項 `panel-theme-diagnostics` 的 timing ceiling（「the worst-case draft (every key mid-grey) validates within a timing ceiling」）。

## 盤點結果與拆分決策

| 職責 | 依賴 | 決策 |
|---|---|---|
| 忙碌範圍、序列佇列、快照 refresh 協調、錯誤／成功通知、錯誤碼文字 | 通知佇列、資源上限 | **抽成依賴介面** `panel-deps.ts`（序列佇列沿用既有 `plugin-state-sync.ts` 的 `createSerialQueue`） |
| 設定編輯：草稿、驗證、儲存、secret、secret consent、移除 secret、未儲存離開確認 | 目前選取的插件、忙碌範圍、通知 | **抽出** `usePluginSettingsEditor.ts` |
| 原生 panel view：開關、重新載入、放大／還原、外框位置同步、Esc、主程序關閉事件、焦點還原、監聽清理 | 插件查找、全域啟用、「選取插件」回呼、錯誤通知 | **抽出** `usePluginPanelView.ts` |
| 通知收件匣：清單、已讀、連結、延遲提交的清除與復原、變更訂閱 | 插件查找、通知 | **抽出** `usePluginNotifications.ts` |
| 診斷：日誌、被拒絕的呼叫、人話標籤 | 目前選取的插件、資源上限 | **抽出** `usePluginDiagnostics.ts` |
| 權限標籤／說明（if 鏈） | `parsePermissionUnit` | **改查表** `src/utils/plugin-permission-copy.ts` |
| 資源上限單位與 KB 換算（if 鏈） | i18n、`formatNumber` | **改查表** `src/utils/plugin-resource-limits.ts` |
| 快照、目前選取／詳情頁、指令、寵物清單、徽章／event source 訂閱 | 所有功能共用 | **保留**在控制器（組裝與跨功能狀態） |
| Catalog、安裝、移除、回報、全域與單一插件偏好 | 彼此交錯（見「未拆的部分」） | **保留**，只把重複的 catalog 重設抽成 `resetCatalog()`、改用 Map 查找 |

### 各 composable 的契約（也寫在每個檔頭）

| 模組 | 讀取（不寫入） | 寫入 | 競態守衛 | 監聽與清理 |
|---|---|---|---|---|
| `usePluginSettingsEditor.ts` | `selectedPluginId`、`selectedPlugin`、`pluginById` | 自己的草稿、錯誤、`pendingLeave`、`pendingSecret*Key` | 每次載入以 `createLatestRequest` 換序號；載入、儲存、secret 的結果都只在序號仍有效時寫入 | 無 |
| `usePluginPanelView.ts` | `pluginById`、`enabledGlobally` | 自己的 panel view 狀態；選取插件只經 `selectPlugin` 回呼 | 開啟／關閉／主程序關閉事件都換序號；較舊的開啟結果若已建立頁面就立即關閉 | 掛載：keydown（capture）＋`onPluginPanelViewClosed`；外框出現：ResizeObserver＋resize／scroll；卸載：全部移除並關閉仍開著的頁面 |
| `usePluginNotifications.ts` | `pluginById` | 自己的清單與隱藏集合 | `createCoalescedRefresh`：一次只有一個在途請求，後到的呼叫共用一次結尾刷新 | 掛載：`onPluginNotificationsChanged`；卸載：取消訂閱、提交尚未提交的清除（清掉復原計時器） |
| `usePluginDiagnostics.ts` | `selectedPluginId`、資源上限 | 自己的日誌與診斷 | 每次載入換序號 | 無 |

控制器只把 `selectedPluginId` 等跨功能狀態以唯讀方式傳入，換插件時由控制器的 watch 依序呼叫 `closePluginPanelView()`、`refreshDiagnostics()`、`refreshPluginSettings()`；詳情頁的開關（`openPluginDetail`／`closePluginDetail`）仍在控制器，只把「要執行的動作」交給 `guardUnsavedSettings()`。

## 設計摘要

- 子 composable 都在控制器（也就是 `PluginPanel.vue` 的 setup）內同步呼叫，`watch`／`onMounted`／`onUnmounted` 綁在同一個元件實例；各自註冊、各自清理，控制器的 `onUnmounted` 只剩通知佇列與徽章／event source 訂閱。
- 對外欄位：控制器以解構取得各 composable 的成員，再用原本的 return 清單回傳，名稱與順序不變。原本的 `removeNotificationsListener`、`removePanelClosedListener`、`panelViewBoundsObserver`、`panelViewRequestSequence` 四個欄位一直回傳「建立當下的初始值」（`let` 變數的值複本；前三者的型別因控制流收斂為 `null`），元件不讀；以 `LegacyInitialValues` 原樣保留，不再連到真正的內部狀態。
- `PermissionEntryView`／`PermissionGroupView` 移到 `plugin-permission-copy.ts`，控制器以 `export type` 轉出，`PluginInstallSheet.vue` 不需修改。
- `createQueuedRefresh` 保留快照刷新原本的語意（進行中再被呼叫時立即返回，結尾以 silent 再抓一次）；通知清單改用語意更強的 `createCoalescedRefresh`（呼叫者會等到最新結果）。
- 錯誤碼、診斷原因、權限種類／貢獻點以 `lookupOwn()`（`Object.hasOwn`）查表，`constructor`、`__proto__` 之類的字串不會拿到原型上的值。

### 刻意的行為差異

以下 7 項都有測試，對 `d5f5b47` 的原始控制器失敗、拆分後通過（第 7 項是實機驗證時發現後補上）：

1. **較舊的設定回應不會覆蓋目前插件**：快速從 A 切到 B，A 的 `getPluginSettings` 晚回來時，原本會把 A 的值與 secret 狀態填進 B 的表單，按儲存就會把 A 的值寫進 B。
2. **較舊的診斷回應不會覆蓋目前插件**：同上，原本會顯示 A 的日誌。
3. **儲存期間換了插件，結果不寫進新表單**：原本會把 A 的儲存結果寫進 B 的草稿與 `pluginSettings`；成功 toast 照常顯示。secret 的儲存與移除結果同理（同一個守衛）。
4. **同意 secret consent 時草稿已被清空就不送出**：原本會以空字串呼叫 `setPluginSecret`，等同移除既有的密鑰。
5. **同一時間的通知刷新合併**：原本每次變更事件各送一次 `listPluginNotifications`，較舊的回應可能在較新的之後才寫入；現在一次只有一個在途請求，加一次結尾刷新。
6. **錯誤碼與診斷原因查表忽略原型名稱**：原本 `localizedError('constructor')` 會拿到 `Object` 函式並讓 `t()` 拋例外。主程序的錯誤碼來自固定清單，實務上不會發生，屬防禦性修正。

7. **設定儲存送出純物件**（實機驗證發現的既有缺陷）：原本把 reactive 的 `settingsDraft.value` 直接交給 `setPluginSettings`，`ipcRenderer.invoke` 的 structured clone 對 Vue Proxy 丟出「An object could not be cloned」，主程序根本沒收到請求，設定頁的「儲存設定」一律顯示「插件操作失敗」。以同一套流程啟動 `d5f5b47` 的建置也重現，確認不是本階段造成。修正為送出 `{ ...settingsDraft.value }`（值都是純量）；新增的測試在還原修正時失敗。

另外，舊回應被丟棄時不再顯示它的錯誤 toast（例如切走之後 A 的載入失敗），因為那個錯誤已不屬於畫面上的插件。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過（exit 0；刻意差異 7 修正後重跑仍通過） |
| `pnpm.cmd exec vite build` | 通過（修正後重建，供實機重跑使用） |
| `pnpm.cmd run test:unit`（完整負載，三次） | 第 1 次：1449 項，1412 過、14 失敗——基準清單少了「a failed replace restores…」（這次通過），多了 `ipc-inventory`（見下）。重新產生 IPC 清單後第 2 次：1449 項，**1414 過、12 失敗**，全部在基準清單內（「a failed replace restores…」與 `panel-theme-diagnostics` timing ceiling 兩項偶發失敗這次通過）。修正刻意差異 7 後第 3 次：1450 項，**1416 過、11 失敗**，全部在基準清單內。三次都沒有新增失敗 |
| `tests/plugin-panel-controller-characterization.test.mts` | 前兩次 38／38、修正後 39／39（三次完整負載都全部通過；計時器全部是 node:test 假計時器，非同步回應以可控 Promise 驅動） |
| 對原始控制器跑同一份 characterization | 把 `d5f5b47` 的控制器暫時放回：32／38，失敗的正好是刻意差異 1–6 的測試（證明測試有效、其餘行為相同）；換回後 38／38。刻意差異 7 的測試是後補的，以暫時還原那一行修正驗證：失敗 1 項，恢復後通過 |
| `tests/plugin-panel-deps.test.mts` | 6／6 |
| 型別探針（臨時檔，已刪除） | 把 `d5f5b47` 的控制器複製成 `__baseline_controller.ts`，以 `Eq<Old[K], New[K]>` 逐一比對全部 140 個回傳欄位，並比對整體回傳型別、參數型別與 `PermissionGroupView`／`PermissionEntryView`／`PluginDetailSection`／`PluginInstalledFilter`，`vue-tsc` 通過；探針中故意的錯誤會被抓到。第一次探針抓到 `removeNotificationsListener` 等三個欄位原本的型別是 `null`（`let` 變數在 return 處被控制流收斂），已改成相同型別 |
| 相關既有測試（`plugin-panel-view-ui`、`plugin-notify`、`plugin-state-sync`、`intl-format-callsites`） | 全部通過；`plugin-panel-view-ui` 的原始碼檢查改讀 `usePluginPanelView.ts`，`restorePluginPanelViewMaximized(true)` 仍是 4 處 |
| `ipc-inventory` | 新測試檔提到 preload API 名稱，產生器把它列為對應測試；以 `node scripts/generate-ipc-inventory.mjs --write` 重新產生後 4／4 |
| `pnpm.cmd run check:design:strict` | 通過（rawColors 0） |
| `node scripts/lint-main-process.mjs` | 通過 |
| `git diff --check` | 通過 |

測試數 1405 → 1450：新增 characterization 39 項（API 清單 1、掛載與訂閱清理 3、未儲存離開確認 3、設定儲存 1、secret 與 consent 4、忙碌範圍 1、競態 6、panel view 開關／放大／焦點 7、props 請求 1、通知 3、清單篩選 1、權限文字 1、資源上限 1、錯誤碼 2、拆分時新增的守衛 3、純物件送出 1）與 `panel-deps` 6 項。

## 隔離 Electron 驗證

以 `scripts/e2e-isolated-electron.mjs --offscreen --hook-port-base 28673 --debug-port 9368 --inspect-port 9369`（隔離 HOME／userData、假 safeStorage、所有視窗 `showInactive()` 在螢幕外）啟動，以 CDP 讀寫面板 DOM、以主程序 inspector 讀視窗與 `__agentPetsE2E`。由 Sonnet 子代理執行，總控複檢其回報與輸出紀錄（抽查假 secret 不在任何日誌、隔離 root 已刪除、沒有殘留 Electron 行程）。腳本與打包的插件放在 session scratchpad，不進版本控制。插件：`tests/fixtures/plugins/ok-panel`、`ok-notify` 以 `scripts/pack-test-plugin.mjs` 打包；因為沒有含設定與 secret 的 fixture，另在 scratchpad 複製 ok-panel 為 `e2e-settings`（加 `contributes.settings` 的 City 字串與 Token secret、`permissions.secrets`）。

| 項目 | 方法 | 結果 |
|---|---|---|
| 安裝 | 每次先 push `dialogQueue` 再按「安裝插件…」，同意並安裝 | 三個插件的安裝 Sheet 都出現，權限群組與文字正確（e2e-settings 多一列高風險「讀取密鑰設定「token」」），清單「已安裝 3」 |
| 設定儲存 | 改 City、按「儲存設定」；主程序對 `plugin-settings-set` 加 spy；`Page.reload` 後重新進入 | 第一輪：一律「插件操作失敗」，主程序沒收到請求；以同流程啟動 `d5f5b47` 的建置也重現 → 既有缺陷，修正為刻意差異 7。修正後重跑：toast「插件設定已儲存。」、「所有變更都已儲存」，主程序收到 `["e2e-settings",{"city":"Tainan"}]` 並回 ok；reload 後讀回 `Tainan` |
| 未儲存離開確認 | 改 City 不存，按麵包屑「插件」 | 出現 `aria-modal` 對話框「放棄未儲存的設定？」；「繼續編輯」後仍在原頁、草稿保留；「放棄變更」後回清單，重新進入時為已儲存的值（修正前後兩輪都通過） |
| Secret consent | 在 Token 輸入假值，按「設定密鑰」，先取消再接受；再移除 | 第一次出現「儲存密鑰前請先閱讀」，`encryptString` 0 次、取消後仍 0、草稿保留；接受後 `encryptString` 1 次、欄位清空、顯示「已設定」、toast「密鑰已安全儲存。」；移除經確認對話框後 `secrets.token=false`。假值在面板 DOM、`innerHTML`、app stdout／stderr、renderer console 紀錄中都是 0 筆 |
| 原生 panel view | 詳情頁「開啟插件面板」；放大／還原；Escape 與「返回插件列表」各關一次 | 外框出現、設定視窗 `contentView.children` 0 → 1、多一個 `agent-pets://plugin/…/ui/` webContents；放大 460×720 → 1524×804、還原回 460；兩種關閉方式都 children 1 → 0、插件頁 webContents 移除，`document.activeElement` 回到原本的「開啟插件面板」按鈕 |
| 通知 | 啟用 ok-notify，開通知分頁；全部清除再復原 | 顯示「Plugin ready / Storage round-trip passed.」；清除後「目前沒有插件通知」與「已清除 1 則通知」＋「復原」，復原後通知回來 |
| 不打擾使用者 | 主程序 `isFocused()`、`getBounds()`；renderer `document.hasFocus()` | 面板 x = −18924、寵物 x = −18752，都未取得焦點；全程沒有截圖 |

腳本調整紀錄（都是腳本問題）：主程序 inspector 沒有 `require`，改用 `process.mainModule.require`；首次開啟是設定精靈，先按「稍後再說」；分頁標籤帶徽章，點擊改用前綴比對；復原 toast 會自動消失，清除與復原改在同一支腳本連續執行；重跑時面板被 Chromium 背景節流讓頁面計時器不觸發，改由主程序先 `setBackgroundThrottling(false)`＋`showInactive()`。

**驗證環境事故（已修復）**：子代理建置基準版時在 scratchpad 以 junction 指向本 worktree 的 `node_modules` 再執行 `vite build`，pnpm 因此改寫了 worktree `node_modules` 頂層的 12 個連結與 `.bin` 的 shim。子代理先修回連結；總控以 `pnpm.cmd install --frozen-lockfile --offline --force` 重建，確認 `.bin` 不再指向 scratchpad，並重跑 `vue-tsc`、`vite build`、完整 `test:unit`。`node_modules` 不在版本控制內，被追蹤的檔案沒有受影響；Electron 二進位由啟動器重新下載。

順帶觀察（既有、本階段未修改的檔案）：`PluginNotificationInbox.vue` 在元件建立時固定 `now`，之後才到的通知會顯示「2 分鐘後」這類未來時間；`ok-notify` 與複製出的 fixture 圖示 `assets/icon.png` 回 404。

## 安全審查

- **信任邊界**：沒有新增或修改 IPC channel、preload 方法、主程序程式、檔案操作或通知；`electron/` 沒有任何改動。`docs/security/ipc-inventory.md` 的差異只有「對應測試」欄多列 renderer 端的 characterization 測試（產生器依檔名比對 API 名稱；它不是主程序 handler 的契約測試）。
- **授權判定仍在 main**：secret consent 是否已同意（`getPluginSecretConsent`／`acceptPluginSecretConsent`）、secret 能否寫入、panel view 能否開啟、尺寸上限、安裝授權與重新同意，renderer 都只是把使用者動作轉給主程序並顯示結果；本階段沒有在 renderer 增加任何判定。
- **Secret 值**：只存在既有的 `secretDrafts`，原樣交給 `setPluginSecret`，成功後立即清空；沒有新增保存它的 state、log 或錯誤訊息。`setError()` 的 `detail` 只帶錯誤碼與主程序已清理的開發者模式提示（`panel-deps.test.mts` 固定）。characterization 測試在 consent 成功、consent 失敗、儲存失敗三種情況檢查 toast 佇列不含 secret 值；刻意差異 4 修正了「同意後以空值送出等同移除密鑰」的缺陷。
- **競態**：設定、secret、診斷與通知的較舊回應不再寫入目前插件的畫面（刻意差異 1–3、5），減少把 A 插件的設定值寫進 B 插件的可能。
- **實機**：secret consent 未同意前主程序沒有加密寫入（`encryptString` 0 次），假 secret 不出現在 DOM、console 與 app 輸出；設定儲存改送淺拷貝的純物件，只含既有的純量欄位，不帶 secret。
- **原型鏈查表**：錯誤碼、診斷原因、權限種類與貢獻點的查表都改用 `Object.hasOwn`。
- **相依套件**：`package.json`／`pnpm-lock.yaml` 未變，未重跑 `pnpm audit`。
- **秘密掃描**：新增行沒有 token 或憑證；測試中的 `sk-test-0123456789` 是假的字串，只用來確認不會被回顯。

## Code review 紀錄

- **語法**：錯誤碼表、診斷原因、權限文字、資源單位、`planKindLabel` 都改成 `as const satisfies Record<…>`；`Object.hasOwn` 取代一般物件查表；`resourceBoundText` 以 `switch` 窮舉單位（漏一個單位會編譯失敗）；`updateSetting` 的值以型別註記取代 `as PluginSettingScalar`；`?.`、`??`、`.at()`、`??=` 照用。`lookupOwn()` 內唯一的 `as keyof Table` 在 `Object.hasOwn` 檢查之後。
- **效能**：`selectedPlugin`、`detailPlugin`、`panelViewPlugin`、`openPluginDetail`、`consumePanelRequest`、`notificationSource` 對插件清單的 `find`／`some` 改查快取的 `pluginsById` Map（只在快照改變時重建）；`catalogItemFor` 改查 `catalogById`；`filteredPlugins` 的「可更新」篩選原本對每個插件掃一次 catalog，改為先建 Set，排序比較時原本每次呼叫兩次 `pluginStatusTone`，改為每個插件算一次；`refreshPanel` 對新快照的兩次 `some` 改為一個 Set；同一時間的通知刷新合併成一次在途＋一次結尾。前後以 characterization 測試確認結果相同（清單篩選與排序、catalog 查找的測試在原始控制器也通過）。
- **保留的線性搜尋**：`commandOf()` 在單一插件的指令清單找一筆、`updateResourceLimit()` 在 8 個欄位找一筆，資料量固定且很小，另建索引不划算。
- **風格**：新檔一律 `@/` 匯入（測試以 `tests/support/src-alias.mts` 解析）；註解只寫原因並改為繁體中文（原本兩則英文註解一併翻譯）；各模組檔頭寫契約；控制器以 `// ---` 區段標頭組織。
- **子代理**：程式拆分都要改同一個控制器檔（組裝與 return），由總控直接實作；隔離 Electron 實機驗證派給一個 Sonnet 子代理（只寫 scratchpad 腳本、不改 repo），結果由總控複檢（見「隔離 Electron 驗證」）。
- **未修改** `.claude/skills/agent-pets-conventions`（未追蹤的 `.claude/` 目錄）；pet-skill 的 `project-map.md` 已補上控制器、composable 與 harness 的位置。

## 未拆的部分與建議

1. **Catalog、安裝、更新佇列**：`catalogItems` 有四個寫入者——`loadPluginCatalog()`、`updateGlobalPreferences()`（關閉線上目錄或換網址時重設）、`saveCatalogUrl()`（同上）、`confirmInstall()`（安裝後背景重新載入）；`pendingPlan` 又同時被「全部更新」佇列的 watch、檔案／資料夾安裝與 catalog 安裝寫入。要拆需要先定義「catalog 失效」與「安裝完成」兩個事件介面，再把更新佇列放進安裝 composable；一次搬動的交錯比設定與 panel view 高，本階段不硬拆。建議下一步：先抽 `usePluginCatalog()`（對外提供 `invalidateCatalog()`／`reloadCatalogIfLoaded()`），全域偏好與安裝改呼叫這兩個介面，再抽 `usePluginInstallFlow()`。
2. **全域偏好與單一插件偏好**（樂觀更新、回滾、序列佇列、撤銷主機授權的復原 toast）：直接改 `snapshot` 內的偏好，與 catalog 重設、快照 refresh 相依，等 catalog 拆好再一起移動。
3. **`pluginStatusLabel`／`pluginStatusTone`** 的 if 鏈判斷的是多個不同條件（狀態、manifest、兩個啟用旗標），依 `agent-pets-conventions` §4 維持 if。
4. `tests/phase-18-renderer-characterization.test.mts` 等以原始碼字串檢查的舊測試不受影響；之後拆 catalog 時，應以本階段的 harness 改寫成行為測試。
5. **後續缺陷**（實機觀察，不在本階段範圍）：`PluginNotificationInbox.vue` 的相對時間以元件建立時的 `now` 計算，晚到的通知顯示成未來時間；建議改用 `useNow()`。

## 殘餘風險

- 實機驗證只在 Windows；macOS／Linux 的原生插件頁與焦點行為未測（本階段沒有平台相關程式）。
- harness 的假 DOM 只模擬控制器用到的部分（`getBoundingClientRect`、`closest`、`focus`、`[aria-modal]`、ResizeObserver），真實的版面與捲動由實機驗證涵蓋。
- 計時類既有測試（`agent-hook-delivery`、`panel-theme-diagnostics`）在完整負載下偶發失敗；新增的測試全部用假計時器或可控的 Promise。

## 版本建議

本階段屬於結構重構，不改公開契約、持久化格式或安全邊界，單獨看是 patch；依 3.1 節排程，整體重構最後統一升 **minor**，本階段不改版本號。

## 檔案變更狀態

| 路徑 | 狀態 | 目的 |
|---|---|---|
| `src/composables/usePluginPanelController.ts` | 修改 | 1,508 → 877 行；改為組裝共用依賴與 4 個功能 composable，對外欄位與型別不變；插件與 catalog 查找改用 Map；`planKindLabel` 改 `as const satisfies` 常數表 |
| `src/composables/plugin/panel-deps.ts` | 新增 | 忙碌範圍、快照／通知 refresh 協調、競態守衛、錯誤／成功通知與錯誤碼文字表 |
| `src/composables/plugin/usePluginSettingsEditor.ts` | 新增 | 設定與 secret 編輯、consent、未儲存離開確認 |
| `src/composables/plugin/usePluginPanelView.ts` | 新增 | 原生插件頁的 renderer 端生命週期 |
| `src/composables/plugin/usePluginNotifications.ts` | 新增 | 通知收件匣與延遲提交的清除 |
| `src/composables/plugin/usePluginDiagnostics.ts` | 新增 | 詳情頁診斷 |
| `src/utils/plugin-permission-copy.ts` | 新增 | 權限標籤／說明查表（取代兩條 17 層 if 鏈）與群組 view |
| `src/utils/plugin-resource-limits.ts` | 新增 | 資源上限單位表、KB 換算、範圍文字 |
| `src/utils/own-lookup.ts` | 新增 | 只認自有 key 的查表 helper |
| `tests/plugin-panel-controller-characterization.test.mts` | 新增 | Node 掛載真的控制器的 characterization 39 項 |
| `tests/plugin-panel-deps.test.mts` | 新增 | 共用依賴的單元測試 6 項 |
| `tests/support/plugin-panel-harness.mts` | 新增 | 最小 Vue renderer、假 DOM／IPC／計時器的控制器 harness |
| `tests/plugin-panel-view-ui.test.mts` | 修改 | 原始碼檢查改讀 `usePluginPanelView.ts`（斷言不變） |
| `docs/security/ipc-inventory.md` | 修改 | 產生器重新產生（只有「對應測試」欄） |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 控制器、composable 與 harness 的位置 |
| `docs/phase-reports/refactor-10-plugin-panel-controller.md` | 新增 | 本工作記錄 |
