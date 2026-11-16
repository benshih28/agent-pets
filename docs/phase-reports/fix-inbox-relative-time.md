# 修正：插件通知收件匣的相對時間

- **開始時間**：2026-11-10 13:31（Asia/Taipei）
- **完成時間**：2026-11-10 13:47（Asia/Taipei）
- **狀態**：通過
- **基準 commit**：`67c9b84`（main，版本 1.13.0；版號由總控處理，建議 patch → 1.13.1）

## 問題

`PluginNotificationInbox.vue` 在 setup 時以 `const now = Date.now()` 捕捉一次時間，之後所有相對時間都以這個固定值計算：元件開著時新到（或晚到）的通知 `createdAt > now`，會顯示成「N 分鐘後」；舊通知的相對時間也停在掛載當下，不會隨時間更新。

## 修正

- 新增 `useRelativeTime(at, options)`：訂閱既有的共用時鐘 `useNow()`（只在有訂閱者且文件可見時每秒 tick），以 Phase 7 的 `formatRelative()` 與目前 `locale` 產生標籤。時間戳先 `Math.min(at, now)` 夾到現在：時鐘在兩次 tick 之間、文件隱藏時暫停，或來源時鐘稍微超前時，都不會出現未來時間。
- 新增 `ui/RelativeTime.vue`：每列自己的 `<time datetime title>`。標籤是 `computed`，字串不變時不會通知使用端，所以每秒 tick 只讓字串真的改變的那一列重新繪製，而不是整個收件匣列表每秒重繪。
- 收件匣改用 `<RelativeTime class="time" :at="record.item.createdAt" :options="FEED_RELATIVE_TIME" />`，移除 `now`、`when()` 與不再需要的 import。顯示格式（一分鐘內「現在」、一週以上顯示日期、`title` 完整時間、`datetime` ISO）不變，沒有視覺樣式變更。

## 同類寫法排查

以 `grep -E "(const|let) now\s*=|Date\.now\(\)"` 掃 `src/**/*.vue` 與 `src/**/*.ts`：

| 位置 | 判斷 |
|---|---|
| `PluginNotificationInbox.vue:20` `const now = Date.now()` | **本 bug，已修正** |
| `StatusPanelHistory.vue` `useQuotaFormat(() => Date.now())` | getter，每次格式化都取當下時間，不是捕捉；不同類 |
| `PermissionBubble.vue`／`InlinePermissionCard.vue` `usePermissionClock()` | 已用自己的計時 ref |
| `StatusPanel.vue` `nowTick`、`PetAnimation.vue` `urgencyTick` | 已有計時器更新 |
| `DesktopPet.vue`、`SetupWizard.vue`、`App.vue`、`stores/**` 的 `const now = Date.now()` | 都在事件處理或函式內，每次呼叫重取；不同類 |

沒有其他同類 bug。

## 檔案變更

| 檔案 | 變更類型 | 說明 |
|---|---|---|
| `src/composables/useRelativeTime.ts` | 新增 | 以 `useNow()` 驅動、夾到現在的相對時間 `computed` |
| `src/components/ui/RelativeTime.vue` | 新增 | 每列 `<time>` 元件（datetime／title／相對標籤） |
| `src/components/plugin-panel/PluginNotificationInbox.vue` | 修改 | 移除 setup 時捕捉的 `now`，改用 `RelativeTime` |
| `tests/relative-time-clock.test.mts` | 新增 | 假時鐘重現測試（4 項） |
| `docs/phase-reports/fix-inbox-relative-time.md` | 新增 | 本工作記錄 |

## 驗證證據

- **重現測試** `tests/relative-time-clock.test.mts`：在 Node 以最小 renderer 掛載真的 `useRelativeTime()`，以 `mock.timers`（`setInterval`、`Date`）推進時間。
  - 修正前（composable 改回「setup 捕捉 `Date.now()`」、收件匣用 `HEAD` 版本）：4 項全失敗（例如 `actual: 'now'` vs `'5 minutes ago'`、`actual: 'in 3 minutes'` vs `'now'`）。
  - 修正後：4 項通過——開著的收件匣會老化（現在 → 5 分鐘前）、新到通知顯示「現在」、超前時間戳不顯示未來、90 次每秒 tick 只通知一次字串變化、收件匣原始碼不再有 `Date.now()`。
- `pnpm.cmd exec vue-tsc --noEmit`：通過。
- `git diff --check`：通過。
- `pnpm.cmd run test:unit`：1555 項，1508 過、11 失敗、36 skip。單獨重跑後：`panel-theme-diagnostics` 0 失敗、`agent-hook-delivery` 剩 2 項 hook 停滯計時失敗（負載偶發 3 項）；穩定失敗正是基準 8 項——6 項 Windows symlink EPERM（`permission-adapter-server`、`pet-import` ×2、`project-mcp-setup` ×2、`hook-config`）＋ 2 項 hook 停滯計時。沒有新增失敗。
- `pnpm.cmd exec vite build`：通過，無錯誤或警告。

## 安全審查

純 renderer 顯示邏輯；沒有新的 IPC、preload、檔案或網路存取，不碰使用者資料目錄。

## 殘餘風險

- 每個收件匣列各自訂閱 `useNow()`，共用同一個 1 秒計時器；字串不變時不重繪，成本可忽略。
- 時間戳超前時一律顯示「現在」，若插件來源時鐘明顯超前，使用者看不出差異（`title` 仍顯示完整時間）。
- 沒有做 Electron 實機截圖驗證；行為由 Node 掛載測試覆蓋，顯示樣式與 DOM 結構（`<time class="time" datetime title>`）與修正前相同。
