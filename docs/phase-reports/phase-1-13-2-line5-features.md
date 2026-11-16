# 階段報告：1.13.2 整合輪線 5——更新檢查、額度預測、成長重設與資料庫整理、Windows 跳回

> 分支 `claude/features-wave2-7db1df`，基於 `claude/integration-1-13-2` @ a1660e8（1.13.1）。版號尚未變更。

## 範圍

| 項目 | 主要檔案 | 內容 |
|---|---|---|
| App 更新檢查 | `electron/app-update.ts`、`electron/app-update-store.ts`、`electron/main/app-update-runtime.ts`、`electron/daily-check-schedule.ts`、`electron/ipc/app-update.ts`、`src/stores/appUpdateStore.ts`、`SettingsAdvanced.vue` | 只檢查並提示，不下載、不安裝。網址是寫死的 `api.github.com/repos/Ponpon55837/agent-pets/releases/latest`，renderer 與設定都不能改。網路沿用 `pluginNetworkClient`：主機白名單只有 `api.github.com`、逾時 10 秒、回應上限 256 KB、每分鐘 3 次，DNS 與 redirect 檢查也沿用。每日排程與 plugin 目錄共用新抽出的 `DailyCheckSchedule`，`PluginCatalogAutoCheckSchedule` 改為繼承它，行為不變。只讀 `tag_name`、`html_url`、`draft`、`prerelease`；`html_url` 不在本專案 releases 底下就自己組網址；draft、prerelease 與帶後綴的版本不提示。「查看版本」由主程序用已驗證、已儲存的網址開啟，renderer 不傳網址。自動檢查預設關閉，沿用插件線上目錄預設不連網的慣例。手動「立即檢查」是明確操作，不受開關限制，但每分鐘最多 3 次。同一版本只通知一次。設定存在 `userData/app-update.json`，讀入時重新驗證。 |
| 額度預測 | `src/utils/quota-forecast.ts`、`src/stores/agent/quota.ts`、`useQuotaFormat.ts`、`StatusPanelUsage.vue` | 只對有額度百分比與重置時間的來源做。renderer 在 `setQuotaUsage` 為每個「服務商:視窗」保留最多 60 筆樣本；重置時間變動超過 5 分鐘、用量下降或時間戳倒退時清空，錯誤或 stale 的讀數不記錄。用最後一段單調樣本做最小平方回歸，單次掃描 O(n)。少於 3 筆、跨度不到 10 分鐘、沒有或已過重置時間、讀數超過 20 分鐘或有非有限值時不顯示預測，不顯示猜測值。 |
| 成長重設與資料庫整理 | `electron/main/growth-service.ts`、`electron/progression.ts`、`electron/achievements.ts`、`electron/history.ts`、`electron/sqlite-maintenance.ts`、`electron/main/db-maintenance-service.ts`、`electron/ipc/growth-maintenance.ts`、`GrowthDataTools.vue` | 重設用共用 `ConfirmDialog`。成就庫先開 `BEGIN IMMEDIATE` 交易，在提交前執行進度庫的重設交易；進度端失敗時兩邊一起回復。重設時間 `growth_reset_at` 寫在同一交易，作為 history reconcile 與本機 token 同步的下限，所以舊歷史不會把剛清掉的資料補回來。完成後用既有廣播更新兩個視窗。整理沿用既有保留期清理（history 90 天、進度活動、本機 token 去重列），再對三個資料庫做 `PRAGMA optimize`、`VACUUM`、`wal_checkpoint(TRUNCATE)`。有交易進行、本機用量掃描中或重入時拒絕，不在啟動流程執行，並回報主檔加 `-wal` 的前後大小。 |
| Windows 跳回 | `electron/windows-window-activator.ts`、`electron/session-jump.ts`、`src/types/host-app.ts`、`SettingsDesktop.vue` | 只在 win32 延遲載入 koffi，依 Z 順序找出執行檔 basename 在白名單內的最上層可見視窗：略過隱藏、被 DWM 遮蔽、工具視窗與有擁有者的視窗。最小化的先還原，再 `SetForegroundWindow`；被前景鎖定擋下時做一次 `AttachThreadInput` 備援並立刻解除。不啟動程序、不經過 shell，事件只能挑白名單內的 app id。設定頁的「切換到 App」開關改為在 Windows 也顯示。 |

## 範圍外修正

- Windows 路徑：`isUsableProjectPath` 只接受「磁碟機代號加絕對路徑」，拒絕單一反斜線開頭、`\??\`、`C:foo` 與替代資料流的冒號；任何一層的 `name.{CLSID}` 都拒絕。`isShellSafePath` 另外拒絕 PowerShell 彎引號、`[ ]` 與空白後的 `#`。
- 英文重置倒數的單複數錯誤（「3 hours 1 minutes」），改用 `h`／`min`／`d` 縮寫，與預測文案一致。
- 整理流程的批次大小改為明確傳入，不再依賴 `pruneStaleActivity` 的預設值。
- `project-map.md` 補上新服務、新 registrar 與 Windows 跳回邊界。

## 總控複審修正（第二輪）

| 項目 | 修正 |
|---|---|
| Windows handle 比較 | koffi 3.2.1 的 `void *` 回傳 BigInt、NULL 回 null（`node_modules/koffi/doc/migration.md`「BigInt pointers」），原本的 `===` 碰巧成立。仍在原生層用 `normalizeWindowHandle()` 統一成 `bigint \| null`，並補回歸測試：同一視窗以 number、bigint 或包裝物件交替回傳時，判定相等且不走 `AttachThreadInput`。 |
| Win32 BOOL | 活化器與既有的 `windows-fullscreen-detector.ts` 原本把 BOOL 宣告成 koffi 的 1-byte `bool`，現在都改成 `int`，並以 `!== 0` 判斷。`tests/koffi-win32-bool.test.mts` 會擋下 koffi 簽章再出現 `bool`。 |
| 更新檢查失敗 | 已知的新版和最近一次檢查結果分開存。檢查失敗不再抹掉已知新版；只有回報 up_to_date 時才清除。每次讀取都重新驗證，使用者升級後就不再顯示。 |
| 重設確認 | 改為主程序發的一次性 token（見安全檢查）。負向測試涵蓋：沒有 token、型別或長度錯誤、錯誤值、過期、重複使用、舊 token、錯誤寄件者。 |
| 整理阻塞與空間 | 每個資料庫 VACUUM 前先讓出事件迴圈，再重查掃描狀態。用 `statfs` 確認可用空間至少是該資料庫（主檔加 `-wal`）大小的兩倍；不足時回 `insufficient_space`，並附需要與可用的大小，中英文訊息都有。`statfs` 本身失敗時照常繼續，因為 VACUUM 寫滿磁碟時 SQLite 會安全回滾。 |
| release 網址 | 備用網址改由已驗證的版本組成 `v<version>`。`v1.2.3`、`1.2.3`、`V1.2.3` 三種 tag 都得到同一個網址。 |
| koffi 打包 | `package.json` 沒有 `asarUnpack`，electron-builder 預設的 smartUnpack 會自動把原生 `.node` 解出 asar。用 `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir --mac`（輸出到暫存目錄，沒有開啟 App）實測：`app.asar.unpacked/node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node` 存在，`koffi/index.js` 在 asar 內，原生模組也能以 Node 載入。Windows 版要由 Windows runner 安裝 `@koromix/koffi-win32-x64`；CI 已在同架構 runner 打包（`release.yml` 註解），Windows 產物尚未實測。 |

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | 0 error，52 個既有 warning |
| `pnpm test:unit` | 1777 項：1776 通過、0 失敗、1 跳過（既有；總控複審修正後重跑） |
| `pnpm check:design:strict`、`pnpm check:contrast` | 通過（rawColors 0、rawControls 0） |
| `pnpm bench:lag:check` | 在基準門檻內 |
| `pnpm exec vite build` 後 `pnpm check:bundle`、`pnpm check:bundle-size` | 通過 |
| `node scripts/generate-ipc-inventory.mjs --check` | 131 個 handler，與清單一致 |
| `git diff --check` | 通過 |

整合後的隔離 Electron 走查用 `--offscreen`、非預設埠，更新檢查走 `--app-update-fixture newer`。沒有連真網路，也沒有觸發 Keychain：

- 設定 → 進階：顯示目前版本與預設關閉的開關。「立即檢查」後顯示「有新版 999.0.0」。按「查看版本」後，記錄到的 `openExternal` 只有 `https://github.com/Ponpon55837/agent-pets/releases/tag/v999.0.0`。
- 設定 → 寵物（深色）：重設確認對話框（按了取消，沒有重設）；整理完成顯示「728.3 KB → 292 KB，釋放 436.3 KB」。
- 用量頁（繁中與英文、深色）：注入遞增的額度資料後顯示「照目前速度約 37 分鐘後用完」與「重置前不會用完」。注入前不顯示預測。
- 各子線另外在各自的分支截過圖：更新已是最新、自動檢查開啟、整理進行中、重設完成、額度資料不足。

截圖存在工作階段的 scratchpad，沒有進 repo。

## 安全檢查

- 新增 7 個 IPC（`app-update-get`／`-set-enabled`／`-check`／`-open-release`、`growth-reset-arm`、`growth-reset`、`db-maintenance-run`），都用 `handleTrusted` 驗證寄件者只能是面板視窗。開關只接受 boolean。重設要先在確認對話框按下確認後呼叫 `growth-reset-arm`，主程序產生 32 bytes 隨機 token（30 秒內有效、只保留最新一個）；`growth-reset` 必須帶這個 token，以 `timingSafeEqual` 比對，取出即失效。各有頻率限制：手動檢查每分鐘 3 次、arm 間隔 1 秒、重設間隔 5 秒、整理間隔 10 秒。負向測試涵蓋錯誤寄件者與錯誤 payload。
- 更新檢查的網址、主機與 release 頁前綴都是常數。`html_url` 會經過 URL 解析並檢查前綴，`../` 正規化後的網址也會被拒絕。
- Windows 活化器只比對執行檔 basename，刻意不比對目錄：安裝版、可攜版與 Store 版的安裝位置不同；就算路徑被冒用，結果也只是把使用者自己帳號下的視窗帶到前景。
- diff 中沒有個人路徑、帳號、權杖或 env 值。

## 殘餘風險與未驗證

- Windows 實機全部未驗證，待驗證項已逐條寫進 `docs/ux-overhaul/windows-todo.md`：前景鎖定、高 IL 終端機、多視窗挑選、koffi 載入失敗、更新檢查、資料庫整理、設定開關。
- 沒有連過真的 GitHub API。隔離環境的 `app.getVersion()` 回傳 Electron 版本，打包後才是 App 版本。
- 成長重設在「進度庫已提交、成就庫提交失敗」時會留下不一致，只有 mock 測試，沒有實際製造磁碟錯誤。重複執行重設可以收斂。
- 單一資料庫的 VACUUM 仍是同步的；三個資料庫之間會讓出事件迴圈，但最大的歷史資料庫在數百 MB 時會讓主程序卡住多久沒有量測。UI 說明「可能需要幾秒」並 disable 按鈕。
- 額度預測假設消耗近似線性，突增或突停會滯後一到兩次讀數。面板 renderer 重新載入後要重新累積樣本。
- 高對比與 reduced-motion 模式沒有實機截圖。新元素沒有動畫，只用既有 token。

## 建議版本增量

Patch（1.13.1 → 1.13.2），與整合輪其他線一起只升一次。理由：都是加法功能。沒有新的資料表 migration：重設時間是既有 metadata 表的一列，更新設定是新的獨立檔案。也沒有改動公開契約。
