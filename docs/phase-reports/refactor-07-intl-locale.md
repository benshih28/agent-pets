# 重構階段 7：相對時間與時長格式、本地化文字型別與語系清單

- **開始時間**：2026-11-10 12:58（Asia/Taipei）
- **完成時間**：2026-11-10 13:13（Asia/Taipei）
- **基準 commit**：`f55d2a2`（分支 `claude/refactor-07-intl-e3e338`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 14、15 項；排程見 3.1 節

## 範圍

**第 14 項（相對時間與時長格式）**：`src/utils/intl-format.ts` 的 `formatRelative()` 與 `src/utils/relative-time.ts` 的 `formatRelativeTime()` 各自快取 `Intl.RelativeTimeFormat`，取整（`trunc`／`round`）與「一週以上改顯示日期」規則不同；時長有三份：`intl-format.ts` 的 `formatDuration()`（`1h 05m`）、`src/utils/permission-view.ts` 的 `formatDuration()`（`m:ss`）、`src/utils/token-format.ts` 的 `durationParts()`（天／時／分）；`src/utils/history-axis.ts` 另有一份 `Intl.DateTimeFormat` 快取；其餘日期與數字格式每次呼叫 `toLocale*String()`，由引擎每次重建 formatter。本階段把它們集中到 `intl-format.ts`，以選項表達差異並共用一份依「語系＋選項」快取的 formatter。

**第 15 項（本地化文字型別與語系清單）**：electron 端內嵌的 `{ 'zh-TW': string; 'en-US': string }` 與 `'zh-TW' | 'en-US'` 改用 `PluginLocalizedText`／`AppLocale`；`PluginLocalizedText` 改由 `AppLocale` 推導；`plugin-event-source.ts` 等處手寫的語系清單與 `isAppLocale()` 改從 `SUPPORTED_LOCALES` 取得（`isAppLocale` 用 Set 查表）。

不在範圍：`electron/quota.ts` 的時區 `Intl.DateTimeFormat`（固定 `en-US`、用於解析時區，不是顯示格式）；`src/utils/quota-math.ts` 的 `relativeAge()`（額度「N 分鐘前」用目錄文案而非 Intl，合併會改變顯示文字）；插件契約（`docs/plugins/`）與 manifest JSON 形狀；任何顯示規則的「修正」。

## 驗收條件

1. 改前先以邊界值測試（59 秒、60 秒、1.5 小時、23.5 小時、6.9 天、7 天、未來時間、zh-TW／en-US）固定**每個呼叫點**目前的輸出；改後同一組測試不改期望值即通過。
2. 每個 `Intl.*Format` 依「語系＋選項」只建立一次；列表渲染中呼叫的格式化函式不重複建立 formatter。
3. `isAppLocale` 以 Set 查表；electron 端不再內嵌雙語系型別或手寫語系清單；插件契約不變。
4. 不新增使用者可見文案。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗，新測試在完整負載下穩定）、`git diff --check` 通過。
6. 以 DOM 文字驗證至少一處相對時間與一處時長在兩種語系下與改前相同。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`f55d2a2`）：1354 項，1322 過、9 失敗、23 skip，見「基準失敗清單」 |
| 2 | 改前以邊界值測試固定各呼叫點輸出 | 通過 | `tests/intl-format-callsites.test.mts` 7 項在改前實作上全過 |
| 3 | 第 14 項：集中格式化與 formatter 快取 | 通過 | 同一組期望值改後全過（只改 import 對應），另加 2 項快取與選項測試 |
| 4 | 第 15 項：語系型別與清單 | 通過 | Sonnet 子代理實作，總控複檢並補上 `plugin-panel-themes.ts`（見「Code review 紀錄」） |
| 5 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」。開始時記錄表沒有先改「進行中」，特此註記 |
| 6 | DOM 實機驗證 | 通過 | 50／50 相符，見「DOM 驗證」。開始時記錄表沒有先改「進行中」，特此註記 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-07-intl-e3e338` |

## 基準失敗清單（`f55d2a2`）

1354 項：1322 過、9 失敗、23 skip。失敗：「a file edit is medium only inside the project and never for execution-relevant paths」「a symlinked staging root is refused」「startup recovery restores interrupted replaces and removes only our own stale entries」「git helpers never follow gitdir or commondir outside the picked folder」「git helpers refuse a symlinked info directory or exclude file」「removing hooks from a symlinked dotfile keeps the link and its target」（symlink EPERM 類）；「a permission request still reaches the pet when the hook is stalled right after sending starts」「a status event still arrives when the hook process is stalled before it can send」「with the pet closed the hook does not wait, even if a crash left an old marker」（hook 停滯計時類）。基準在任何程式修改前執行。

## 盤點結果

| 函式（改前） | 規則 | 正式呼叫點 |
|---|---|---|
| `intl-format` `formatRelative` | 先四捨五入到整秒，再對年／月／日／時／分／秒 `trunc`；沒有「現在」區間與日期改顯示 | 無（只有測試） |
| `relative-time` `formatRelativeTime` | 毫秒差 `round` 到日／時／分；< 1 分鐘「現在」；≥ 7 天 `dateStyle: medium` 日期 | `PluginNotificationInbox.vue` |
| `intl-format` `formatDuration` | 秒 `floor`，`1h 05m`／`4m 12s`／`8s`；NaN 會印出 `NaNs` | 無（只有測試） |
| `permission-view` `formatDuration` | 秒 `ceil`，`m:ss`，分鐘不進位成小時；非有限值當 0 | `PermissionBubble.vue`、`PermissionCountdown.vue`、`InlinePermissionCard.vue` |
| `token-format` `durationParts` | 分鐘 `round`，不足一分鐘但非 0 算 1；天／時／分；非有限值當 0 | `useHistoryFormat.ts`（歷史統計卡、工作階段） |
| `history-axis` 內部 `formatter()` | `Intl.DateTimeFormat` 依語系＋選項快取 | `HistoryChart.vue` |
| `formatDateTime` 等 7 個日期函式、`formatNumber`、`formatTokens` | 每次 `toLocale*String()` | 約 20 個元件與 composable |
| `i18n.ts` `tPlural` | 每次 `new Intl.PluralRules(loc)` | 所有複數文案 |

邊界值（`tests/intl-format-callsites.test.mts`）錄到兩條相對時間規則的實際差異，例如 59.6 秒：舊 `formatRelative`「1 分鐘前」、收件匣「現在」；1.5 小時後：「1 小時後」對「2 小時後」；6.9 天前：「6 天前」對「7 天前」；7 天：「7 天前」對日期。這些差異原樣保留。

## 設計摘要

`src/utils/intl-format.ts`（分區：formatter 快取 → 日期 → 數字 → 相對時間 → 時長）：

- **共用快取**：`dateTimeFormatter(loc, options)`、`numberFormatter(loc, options)` 與內部的 `relativeTimeFormatter(loc)`，鍵為 `JSON.stringify([loc ?? null, options ?? null])`（`undefined` 語系與任何字串不撞鍵），每組只建一次。鍵只來自固定語系與呼叫點的選項，數量有上限。
- **日期**：7 個函式改用快取 formatter，選項與改前的 `toLocale*String()` 等價（`toLocaleString` 無欄位時補年月日時分秒、`toLocaleDateString` 補年月日、`toLocaleTimeString` 補時分秒；`formatDateParts` 以 `localeStringOptions()` 套用同一規則）。無效日期回傳 `Invalid Date`（`Intl` 會丟錯，`toLocale*String` 回這個字串）。
- **相對時間**：`formatRelative(value, now, loc, options)`，`RelativeTimeOptions` = `rounding: 'trunc' | 'round'`（預設 `trunc`，即舊行為）、`nowWithinMs`、`dateFromMs`。收件匣用 `FEED_RELATIVE_TIME`（`round`、1 分鐘、7 天）。
- **時長**：`durationParts(ms, options)`，`DurationPartsOptions` = `smallest`（秒／分）、`largest`（天／時／分）、`rounding`（`floor`／`ceil`／`round`）、`atLeastOne`；回傳天／時／分／秒。`formatDuration()`（`largest: 'hour'`）、新的 `formatClockDuration()`（取代 permission-view 的 `formatDuration`，`largest: 'minute'`、`ceil`）、`HISTORY_DURATION`（取代 token-format 的 `durationParts`）。
- `history-axis.ts` 改用 `dateTimeFormatter`；`token-format.ts` 改用 `formatNumber`；`i18n.ts` 的 `PluralRules` 每語系快取一份；`relative-time.ts` 剩下的 `linkHost()` 移到 `src/utils/link-host.ts`。

第 15 項：`PluginLocalizedText = Record<AppLocale, string>`；`isAppLocale` 以 `ReadonlySet` 查表；electron 端 9 處內嵌型別與 3 處語系清單改為推導。`plugin-panel-themes.ts` 必須能被目錄驗證器 vendor（測試限制它只能 import 同層模組的值），所以改用 `Object.keys({ 'zh-TW': true, 'en-US': true } satisfies Record<AppLocale, true>)`：少一個或多一個語系都會在型別檢查失敗。

## DOM 驗證（Chromium，臨時 Vite 頁面）

以只含 `@vitejs/plugin-vue` 與 `@` alias 的臨時 Vite 設定（127.0.0.1:5199，不啟動 Electron、不碰使用者視窗）在內建瀏覽器掛載**真實元件**，切換 `setLocale()` 讀 DOM 文字；期望值是基準 `f55d2a2` 程式的輸出。驗證後已刪除臨時頁面、設定與 dev server。

| 介面 | zh-TW | en-US |
|---|---|---|
| `PermissionCountdown`（權限倒數）59 s／59.999 s／83.4 s／1.5 h | 剩餘 0:59／1:00／1:24／90:00 | 0:59 left／1:00 left／1:24 left／90:00 left |
| `PluginNotificationInbox` 的 `<time>`（5 分、1.4 h、1.6 h、30 h、40 h、6.9 天、30 天前） | 5 分鐘前／1 小時前／2 小時前／昨天／前天／7 天前／2026年10月11日 | 5 minutes ago／1 hour ago／2 hours ago／yesterday／2 days ago／7 days ago／Oct 11, 2026 |
| `useHistoryFormat().duration`（20 s、1.5 h、23.5 h、6.9 天） | 1 分鐘／1 小時 30 分／23 小時 30 分／6 天 21 小時 | 1 min／1 h 30 min／23 h 30 min／6 d 21 h |
| Chromium ICU 下 `formatDateTime`／`formatTimeFull`／`formatDateTimeFull`／`formatDateDefault`／`formatDateParts`（額度選項）對照 `toLocale*String()` | 全同 | 全同 |

合計 **50／50 相符**。第一次執行有 2 筆 zh-TW 不符（1.5 h →「2 小時前」、36 h →「前天」）：收件匣在掛載時才讀 `Date.now()`，比建立資料晚幾毫秒，剛好跨過 `round` 的 .5 邊界——改前程式在同樣時序也會這樣進位，是驗證頁選值的問題。精確的 .5 邊界由 Node 測試以固定 `now` 覆蓋，DOM 驗證改用避開邊界的 1.4 h／1.6 h／30 h／40 h 後全部相符。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過（exit 0） |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit`（完整負載，連跑 2 次） | 兩次皆 1361 項：1329 過、9 失敗、23 skip；失敗清單與基準完全相同，新增與修改的測試每次都通過 |
| 目標測試（`intl-format-callsites`、`token-format`、`format-intl`、`permission-view`、`link-host`、`history-layout`） | 31／31 |
| 第 15 項相關測試（plugin-manifest、plugin-event-source、plugin-panel-themes、plugin-tray、desktop-preferences） | 67／67（子代理執行；總控改 `plugin-panel-themes.ts` 後由完整 `test:unit` 再涵蓋） |
| `pnpm.cmd check:design:strict` | 通過（無 finding） |
| `node scripts/lint-main-process.mjs` | 通過 |
| `git diff --check` | 通過 |

測試數 1354 → 1361：新增 `intl-format-callsites` 9 項，`relative-time.test.mts` 3 項改名為 `link-host.test.mts` 只留 1 項（另 2 項的相對時間案例已併入新檔）。新測試都是純函式、固定 `now`，沒有計時或 I/O，不受負載影響。

## 安全審查

- **信任邊界**：沒有新增或修改 IPC channel、preload 方法、本機 server、檔案操作、通知或 MCP 工具。
- **插件輸入驗證**：`plugin-manifest.ts` 的 `hasOnlyKeys` 與 `plugin-panel-themes.ts` 的 `assertKeys` 接受的鍵集合不變（仍是 `zh-TW`、`en-US`）；`plugin-event-source.ts` 依同樣順序逐一正規化；錯誤字串不變。`isAppLocale` 對非字串一律 false，改 Set 後語意相同。
- **相依套件**：`package.json`／`pnpm-lock.yaml` 未變，未重跑 `pnpm audit`（沒有相依變更）。
- **秘密掃描**：diff 只有格式化程式、型別與測試，沒有 token、憑證或路徑。
- **顯示內容**：沒有新增使用者可見文案；格式化結果與改前相同（見測試與 DOM 驗證）。

## Code review 紀錄

- 子代理（第 15 項）複檢：10 個檔案的 diff 逐一檢查，型別替換正確、沒有值的改變。子代理因 vendor 限制還原了 `plugin-panel-themes.ts`，總控改用 `satisfies Record<AppLocale, true>` 的鍵清單補上，同時滿足 vendor 測試與「新增語系時型別檢查會指出」。
- `SettingsLanguage.vue` 保留 `$event as AppLocale`：`Select` 的事件型別是 string，兩個選項值固定；改成 guard 會讓模板多一層判斷，行為不變，維持轉型。
- 語法：選項表以 `as const satisfies Intl.*Options`；預設參數與解構預設值取代手寫判斷；`Math[rounding]` 取代分支。
- 效能：所有 `Intl.DateTimeFormat`／`NumberFormat`／`RelativeTimeFormat`／`PluralRules` 每組只建一次（測試驗證同鍵回傳同一實例）；列表中的 `SessionRow`、收件匣、歷史圖表不再每列建 formatter。這也解決了 `docs/ux-overhaul/performance-review.md` 的 L5。
- import：`src/utils` 內的檔案互相 import 維持相對路徑加 `.ts`，因為 Node 測試直接載入這些檔案（與既有 `intl-format.ts` → `../i18n.ts` 相同）；元件與 composable 用 `@/`。

## 檔案變更狀態

| 路徑 | 狀態 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-07-intl-locale.md` | 新增 | 本階段工作記錄 |
| `src/utils/intl-format.ts` | 修改 | 共用 formatter 快取；相對時間選項；`durationParts`／`formatClockDuration`／`HISTORY_DURATION`／`FEED_RELATIVE_TIME` |
| `src/utils/relative-time.ts` → `src/utils/link-host.ts` | 改名＋修改 | 相對時間併入 intl-format，只留 `linkHost()` |
| `src/utils/permission-view.ts` | 修改 | 移除 `formatDuration`（改用 `formatClockDuration`） |
| `src/utils/token-format.ts` | 修改 | 移除 `durationParts`；數字改用快取的 `formatNumber` |
| `src/utils/history-axis.ts` | 修改 | 改用共用 `dateTimeFormatter` |
| `src/i18n.ts` | 修改 | `PluralRules` 每語系快取 |
| `src/composables/useHistoryFormat.ts` | 修改 | `durationParts(ms, HISTORY_DURATION)` |
| `src/components/permission/PermissionBubble.vue`、`PermissionCountdown.vue`、`src/components/ui/InlinePermissionCard.vue` | 修改 | 改用 `formatClockDuration` |
| `src/components/plugin-panel/PluginNotificationInbox.vue` | 修改 | `formatRelative(..., FEED_RELATIVE_TIME)`、`link-host` |
| `src/types/locale.ts` | 修改 | `isAppLocale` Set 查表 |
| `src/types/plugin.ts` | 修改 | `PluginLocalizedText = Record<AppLocale, string>` |
| `electron/main/state.ts`、`electron/ipc/plugin-feed.ts` | 修改 | 內嵌雙語系型別 → `PluginLocalizedText` |
| `electron/ipc/project-mcp.ts`、`electron/plugin-tray.ts` | 修改 | `'zh-TW' \| 'en-US'` → `AppLocale` |
| `electron/plugin-event-source.ts`、`electron/plugin-manifest.ts` | 修改 | 語系清單 → `SUPPORTED_LOCALES` |
| `electron/plugin-panel-themes.ts` | 修改 | 可 vendor 的型別檢查鍵清單 |
| `src/composables/usePluginPanelController.ts`、`src/components/status-panel/SettingsLanguage.vue` | 修改 | 型別改用 `PluginLocalizedText`／`AppLocale` |
| `tests/intl-format-callsites.test.mts` | 新增 | 改前錄下的呼叫點輸出、快取與選項測試 |
| `tests/relative-time.test.mts` → `tests/link-host.test.mts` | 改名＋修改 | 只留 `linkHost` 測試 |
| `tests/permission-view.test.mts`、`tests/token-format.test.mts` | 修改 | 改用新位置的函式，期望值不變（歷史時長多一個 `seconds: 0` 欄位） |

## 殘餘風險

- **沒有正式呼叫點的行為**：舊 `formatRelative`（trunc 模式）遇到 NaN 由丟 `RangeError` 改為回「現在」；`formatDuration` 遇到 NaN／Infinity 由 `NaNs`／`Infinityh NaNm` 改為 `0s`。兩者在 `src` 都沒有呼叫點，畫面不受影響；可在後續評估是否刪除這兩個未使用的 helper。
- **ICU 版本**：Node 測試的字面期望值（例如「5 分鐘前」）依 Node 內建 ICU；Electron 的 Chromium ICU 已在 DOM 驗證中確認日期格式等價，但未在打包版 Electron 內實測。
- **未在 Electron 實機驗證**：DOM 驗證使用內建瀏覽器的 Chromium 掛載真實元件，不是完整 Electron 面板流程；本階段沒有主行程或 IPC 行為改變。macOS／Linux 未測。
- `quota-math.ts` 的 `relativeAge()` 仍是另一套「N 分鐘前」（目錄文案），刻意不併入。

## 版本建議

本階段單獨看屬 patch（內部重構、無契約變更）；依 3.1 排程，整體重構完成後統一升 minor 版。本階段未改版本號。
