# 重構階段 8：Renderer localStorage key registry

- **開始時間**：2026-11-10 13:17（Asia/Taipei）
- **完成時間**：2026-11-10 13:58（Asia/Taipei）
- **基準 commit**：`940a00b`（分支 `claude/refactor-08-storage-d18080`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 12 項；排程見 3.1 節

## 範圍

**第 12 項（Renderer localStorage key 清單）**：`agent-pet-*`／`agent-pets-*` key 以字面值散在 `agentStore.ts`、`i18n.ts`、`useTheme.ts`、`StatusPanel.vue`、`StatusPanelHistory.vue`、`DesktopPet.vue`、`GrowthAchievements.vue` 與 `pet-defaults.ts`；`App.vue` 與 `useTheme.ts` 各自監聽 `storage` 事件做跨視窗同步。本階段建立集中的 key registry（key、值型別、預設值、解析／序列化、是否跨視窗同步）與有 try/catch 的讀寫 helper，各處改走 registry。

不在範圍：拆分 `agentStore`（階段 9）；改變任何解析規則或同步行為；主程序的持久化（`userData` 檔案）。

## 驗收條件

1. 每個 key 字串維持原值（含 `agent-pet-mood-version` 等 migration key），測試固定完整 key 清單。
2. 每個 key 的「缺值／無效值回退」與「storage 丟例外時的回退」與改前相同，以測試逐一固定。
3. storage 被停用（getItem／setItem 丟例外）時 renderer 不丟例外，回退預設值。
4. `App.vue`、`useTheme.ts` 的跨視窗同步改由 registry 的同步旗標驅動、以 Map 依 key 分派；同步的 key、視窗與更新的狀態不變。
5. `src/` 內除 helper 以外不再直接呼叫 `localStorage`，也不再出現 key 字面值。
6. 文件：`docs/dev/storage-keys.md`，pet-skill `project-map.md` 補一行來源指引。
7. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗）、`git diff --check` 通過；隔離 Electron 驗證既有偏好讀出、跨視窗同步、storage 停用不崩潰。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`940a00b`）：1361 項，1329 過、9 失敗、23 skip，見「基準失敗清單」 |
| 2 | 改前以測試固定各 key 的解析與回退 | 通過 | 解析散在 SFC／Pinia setup 內無法在 Node 單獨載入，改以 `940a00b` 各呼叫點的運算式逐字抄成 oracle（`LEGACY_PARSE`／`LEGACY_UNAVAILABLE`），對 54 個樣本值比對 registry |
| 3 | 建立 registry 與讀寫 helper | 通過 | `tests/storage-keys.test.mts` 10／10 |
| 4 | 各檔改走 registry；同步改為 Map 分派 | 通過 | `vue-tsc` 通過；相關測試 38／38 |
| 5 | 文件 | 通過 | `docs/dev/storage-keys.md`、pet-skill `project-map.md` |
| 6 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 7 | 隔離 Electron 實機驗證 | 通過 | 42／42，見「隔離 Electron 驗證」。開始時記錄表沒有先改「進行中」，特此註記 |
| 8 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-08-storage-d18080` |

## 基準失敗清單（`940a00b`）

與階段 7 相同的 9 項：「a file edit is medium only inside the project and never for execution-relevant paths」「a symlinked staging root is refused」「startup recovery restores interrupted replaces and removes only our own stale entries」「git helpers never follow gitdir or commondir outside the picked folder」「git helpers refuse a symlinked info directory or exclude file」「removing hooks from a symlinked dotfile keeps the link and its target」（symlink EPERM 類）；「a permission request still reaches the pet when the hook is stalled right after sending starts」「a status event still arrives when the hook process is stalled before it can send」「with the pet closed the hook does not wait, even if a crash left an old marker」（hook 停滯計時類）。基準在任何程式修改前執行。

**負載下的第二次基準**：改後兩次完整執行多出 3–4 個計時失敗（`agent-hook-delivery` 的「a busy app still gets the event…」「a starting app that never opens its port…」「an answer that is cut off…」、`panel-theme-diagnostics` 的「the worst-case draft … within a timing ceiling」、`presentation-stdio` 的 MCP bridge），斷言都是耗時上限（例如「hook took 4808 ms」）。為了排除本階段造成，先把改動做成 WIP commit，在同一個 worktree checkout `940a00b` 再跑一次完整 `test:unit`：基準在同樣的機器負載下是 **13 項失敗**，正好包含上述全部。這些檔案也都單獨重跑通過（只剩原本 9 項中的 2 個 hook 停滯類）。

## 盤點結果

`src/` 內 26 個 key，分在 9 個檔案（`electron/`、`scripts/` 沒有直接用這些 key；主程序只在註解提到寵物大小存在 renderer）。

| 檔案（改前） | key | 讀取規則 | 例外處理 |
|---|---|---|---|
| `agentStore.ts` | `agent-pet-id`、`-scale`、`-hidden`、`-family-map`、`-mood`、`-mood-date`、`-mood-version`、`-mood-visuals`、`-sound`、`-multi`、`-pat`（11 個，約 36 處） | `\|\| 預設`、`parseFloat`、JSON 白名單、`=== '1'`／`!== '0'` | 只有 `agent-pet-pat` 有 try/catch；其餘讀寫丟例外時 store 初始化失敗 |
| `pet-defaults.ts` | `agent-pet-fx`、`-bubble`、`-ambient`、`-activity` | `'1'`／`'0'`，`ambient`／`activity` 缺值時看舊的 fx／bubble（migration） | `readBooleanPref` 有 catch，但 legacy 那兩次 `getItem` 沒有 |
| `i18n.ts` | `agent-pet-locale` | `isAppLocale` 否則 `zh-TW` | 有 |
| `useTheme.ts` | `agent-pet-theme`、`agent-pet-pet-theme` | guard 否則 `system`／`dark` | 有；另監聽 `storage` |
| `App.vue` | 12 個（同步） | 各 key 自己的 `newValue` 規則，`if / else if` 鏈逐一比對 | — |
| `StatusPanel.vue` | `agent-pets-dashboard-tab`、`agent-pets-settings-group` | `parseStoredDashboardTab`／`isSettingsGroupId` | 有 |
| `StatusPanelHistory.vue` | `agent-pet-history-range`、`-collapsed`、`-intro-dismissed`、`-view` | 7／30／90、JSON（不檢查形狀）、`'1'`、`'sessions'` | 有 |
| `DesktopPet.vue` | `agent-pet-coach-v1` | `'1'`；**讀不到時當作已看過** | 有 |
| `GrowthAchievements.vue` | `agent-pet-achievements-seen-at` | `Number \|\| 0` | 有 |

盤點也確認了幾個必須照原樣保留的細節：`agent-pets-` 前綴（複數）的兩個 key；`ambient`／`activity` 啟動規則（看 legacy）與同步規則（只認 `'1'`）不同；`petScale`／`petId`／`mood`／`locale` 同步時空值不更新，其他 key 移除時回到預設；同步的 `mood` 不 clamp；`historyCollapsed` 不檢查 JSON 形狀。

## 設計摘要

- **`src/utils/storage-keys.ts`**：`STORAGE_KEYS`（26 列，`as const satisfies Record<string, StorageKeyDefinition<unknown, never>>`，`deepFreeze`）。每列 `key`、`parse(raw)`、`serialize(value)`、`fallback`（預設 `parse(null)`；只有 `coachSeen` 為 `true`）、`sync`。`defineStorageKey()` 以 `const` 型別參數保留 key 與 `sync` 的字面型別。`DEFAULT_PET_ID`、`MOOD_BASELINE`、`MOOD_SYSTEM_VERSION` 從 store 搬來，store 改 import。
- **`src/utils/local-storage.ts`**：`readStored()`／`writeStored()`（`NoInfer` 讓寫入值只依 key 檢查型別）、`safeStorageReader`（給 `readPetFeedbackDefaults` 的 migration 規則）、`syncOn()`（型別上只接受 `sync: true` 的列）與 `listenStorageSync()`（一個監聽器、`Map` 依 key 分派、重複綁定丟錯、回傳 cleanup）。
- **`src/types/theme.ts`**：主題值域與 guard 從 `useTheme.ts` 搬出（沒有 import），避免 registry ↔ composable 循環；`useTheme.ts` 轉出原名稱，既有 import 不變。
- `App.vue` 的 12 個 key 與 `useTheme.ts` 的 2 個 key 改成 `syncOn` 綁定；`store.syncFamilyPetIds()` 改收 registry 解析後的值（唯一呼叫者是 `App.vue`），JSON 只在 registry 解析一次。
- `agentStore` 只換讀寫方式；心情的三個重設寫入收成 `persistMoodReset()`，`patPet()` 的「今天」只算一次。

### 刻意的行為差異（只在 storage 不可用時）

改前 `agentStore` 的讀寫沒有 try/catch：storage 被停用時 store 初始化丟例外，兩個視窗都起不來；寫入失敗也會中斷後續動作（例如 `setPet` 不再同步 XP 寵物、`setSoundEnabled` 不再送主程序）。現在讀取回退到缺值時的結果、寫入靜默失敗、後續動作照常。storage 正常時沒有任何差異。

## 隔離 Electron 驗證

以 `scripts/e2e-isolated-electron.mjs --offscreen`（隔離 HOME／userData、事件埠 27493、所有視窗 `showInactive()` 在螢幕外）啟動，以 CDP 讀 DOM 與 Pinia store。腳本放在 session scratchpad，不進版本控制；三個隔離暫存目錄用完已刪除，確認沒有殘留的 Electron 行程。

| 項目 | 方法 | 結果 |
|---|---|---|
| 既有偏好讀出 | 第一次啟動寫入 18 個舊 key 的原始字串（含無效的 family map 項目、非字串的 hidden 項目），`quitApp` 後以 `--reuse-root` 同一個 userData 冷啟動 | 寵物 id、大小 0.75、多寵物、fx=0→反應關、bubble=1→泡泡開、ambient 缺值＋legacy fx=0→關、activity 缺值＋legacy bubble=1→開、心情 55、心情外觀關、family map 只留 `claude`、寵物視窗外觀 light、今天已摸 5 次→不能再摸、面板外觀 dark、儀表板還原到「歷史」、歷史範圍「30 天」、隱藏的內建寵物不在清單 |
| 跨視窗同步（面板 → 寵物） | 面板呼叫 store setter 與寫入 pet-theme／mood | 大小、多寵物、反應、ambient、activity、心情外觀、family map、寵物、寵物外觀、心情都更新 |
| 跨視窗同步（寵物 → 面板） | 寵物視窗改泡泡與面板外觀 | 面板更新 |
| 移除 key 的舊規則 | 面板 `removeItem` mood／scale／fx，寫入不同步的 history-range | 寵物視窗心情與大小不變（空值不更新），fx 回到 `parse(null)`＝開 |
| storage 停用 | 兩個視窗以 `Page.addScriptToEvaluateOnNewDocument` 讓 `localStorage` 一取用就丟 `SecurityError` 後重新載入 | 兩個視窗都正常掛載；寵物大小回退 1、setter 照常更新狀態、摸摸可用；面板分頁回退「工作階段」、外觀回退 system；沒有任何未捕捉的 storage 例外 |
| 不打擾使用者 | `document.hasFocus()` | `false` |

合計 **42／42**。第一次執行有 3 筆失敗是驗證腳本的問題：V8 inspector 以 `returnByValue` 回傳 Vue reactive Proxy 時序列化成 `{}`，且 `hiddenBuiltinIds` 沒有從 store 匯出；改為 `JSON.stringify` 後回傳、隱藏清單改用真的內建寵物 id 並檢查 `visiblePets` 後全部通過。最後一次 `quitApp`（當時面板開著）15 秒內沒有結束，改為強制結束；第一次（只有寵物視窗）正常結束。這與 storage 無關，沒有進一步追查。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過（exit 0） |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit`（完整負載，最終狀態） | 1371 項：1336 過、12 失敗、23 skip；失敗全部在同負載的基準清單（13 項）內，無新增。新增的 `storage-keys` 10 項三次完整執行都通過 |
| 目標測試（`storage-keys`、`theme`、`pet-defaults`、`phase-18-renderer-characterization`、`agent-source-registry`） | 38／38 |
| 型別防護探針（臨時檔，已刪除） | 寫錯型別（`locale` 寫 `'fr-FR'`、`petScale` 寫字串、`dashboardTab` 寫 `null`）、`syncOn` 綁不同步的 `historyRange`、把 `string \| null` 當 `string` 用，5 處都被 `vue-tsc` 擋下 |
| `pnpm.cmd check:design:strict` | 通過（無 finding） |
| `node scripts/lint-main-process.mjs` | 通過 |
| `git diff --check` | 通過 |
| `src/` 直接呼叫 `localStorage` 或 key 字面值 | 只剩 `storage-keys.ts` 與 `local-storage.ts`（grep 確認） |

測試數 1361 → 1371：新增 `tests/storage-keys.test.mts` 10 項（完整 key 清單、同步 key 清單、凍結、54 個樣本值對舊運算式、例外回退、序列化往返、helper 例外、Map 分派、重複綁定）。`phase-18-renderer-characterization` 的一條原始碼斷言從 `localStorage.getItem(SETTINGS_GROUP_STORAGE_KEY)` 改成 `readStored(STORAGE_KEYS.settingsGroup)`。新測試都是純函式與假的 storage，沒有計時或 I/O。

## 安全審查

- **信任邊界**：沒有新增或修改 IPC channel、preload 方法、本機 server、檔案操作、通知或 MCP 工具。只動 renderer 的 localStorage 存取。
- **跨視窗輸入**：`storage` 事件只來自同源視窗（寵物與面板）。插件面板頁在獨立、非持久的 partition，插件 Worker 不能存取這份 localStorage。即使值被手改，每個 key 都經過與改前相同的 `parse`（family map 仍只收家族白名單與字串值，dashboard tab 仍以 `isPluginId` 驗證，並在還原時對照目前的插件清單）。
- **可用性**：storage 停用不再讓 renderer 起不來（見「刻意的行為差異」）；寫入失敗不再中斷後續的主程序同步。
- **相依套件**：`package.json`／`pnpm-lock.yaml` 未變，未重跑 `pnpm audit`。
- **秘密掃描**：diff 只有 key 字串、解析函式、文件與測試；grep 新增行沒有 token／secret／password／api key。localStorage 裡本來就沒有、現在也沒有憑證。
- **顯示內容**：沒有新增使用者可見文案。

## Code review 紀錄

- **語法**：registry 以 `as const satisfies` 檢查形狀；`defineStorageKey` 用 `const` 型別參數保留字面型別；`writeStored` 用 `NoInfer` 防止寫入值把型別放寬（方法參數雙變性下，不加會讓 `writeStored(STORAGE_KEYS.locale, someString)` 通過）；可為 null 的三列原本寫顯式泛型，複檢時改成標註 `parse` 回傳型別讓 TS 推導。`syncOn` 以型別限制只接受 `sync: true` 的列，取代執行期檢查。
- **保留的 `as`**：`parseHistoryCollapsed` 的 `as Record<string, boolean>` 照舊（舊實作不檢查形狀；加檢查會改變現在讀得到的收合狀態），註解說明原因。測試檔的兩處轉型只用在迭代所有 key 的泛型迴圈。
- **效能**：`storage` 事件改成一個監聽器以 `Map` 查 key（App.vue 原本最多 12 次字串比對）；family map 的 JSON 只在 registry 解析一次（原本 App 傳字串、store 再解析）；沒有在 computed／watch 熱路徑讀 storage（`patPet` 每次點擊讀一次，與改前相同）。
- **import**：`storage-keys.ts`、`local-storage.ts`、`types/theme.ts` 以及會被 Node 測試載入的 `i18n.ts`、`useTheme.ts`、`pet-defaults.ts` 對它們的值 import 用相對路徑加 `.ts`；元件與 store 用 `@/`。
- **未用子代理**：改動集中、彼此依賴（registry 型別決定每個呼叫點的寫法），由總控直接實作並逐檔複檢 diff。
- **未修改** `.claude/skills/agent-pets-conventions`（未追蹤的 `.claude/` 目錄）。它的 §1「Node 測試閉包」清單沒有列出新的 `storage-keys.ts`／`local-storage.ts`／`types/theme.ts`；清單本來就註明不是完整閉包，若要補上需使用者同意。

## 殘餘風險

- 只在 Windows 驗證；macOS 的 localStorage 行為相同（Chromium），但未實測。
- storage 停用只以「`localStorage` 取用即丟例外」模擬；配額已滿（只有 `setItem` 丟例外）由單元測試覆蓋，未在 Electron 實測。
- 啟動時被主程序偏好覆蓋的 `agent-pet-sound` 與 `agent-pet-locale`，實機只驗證同步路徑，冷啟動讀值由單元測試覆蓋。
- 最後一次 `quitApp` 在面板開著時沒有在 15 秒內結束（見「隔離 Electron 驗證」），未追查是否為既有行為。

## 版本建議

不升版。本階段是 renderer 內部重構，沒有改變持久化格式、key 或公開契約；依 3.1 節排程，整體重構完成後統一升 minor。

## 檔案變更狀態

| 路徑 | 狀態 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-08-storage-keys.md` | 新增 | 本階段工作記錄 |
| `src/utils/storage-keys.ts` | 新增 | key registry、`DEFAULT_PET_ID`／`MOOD_BASELINE`／`MOOD_SYSTEM_VERSION` |
| `src/utils/local-storage.ts` | 新增 | 不丟例外的讀寫 helper、`safeStorageReader`、`syncOn`／`listenStorageSync` |
| `src/types/theme.ts` | 新增 | 主題值域與 guard（供 registry 使用，避免循環） |
| `src/composables/useTheme.ts` | 修改 | 改走 registry；同步改 `syncOn`；轉出 `@/types/theme` |
| `src/i18n.ts` | 修改 | 語系讀寫改走 registry |
| `src/stores/agentStore.ts` | 修改 | 11 個 key 改走 registry；`syncFamilyPetIds` 收解析後的值；`persistMoodReset()` |
| `src/utils/pet-defaults.ts` | 修改 | key 字串改取自 registry |
| `src/App.vue` | 修改 | `storage` 監聽改為 `listenStorageSync` + `syncOn`（Map 分派） |
| `src/components/StatusPanel.vue` | 修改 | 分頁與設定群組改走 registry |
| `src/components/status-panel/StatusPanelHistory.vue` | 修改 | 4 個介面記憶 key 改走 registry |
| `src/components/DesktopPet.vue` | 修改 | 引導 key 改走 registry |
| `src/components/growth/GrowthAchievements.vue` | 修改 | 成就已讀時間改走 registry |
| `tests/storage-keys.test.mts` | 新增 | 固定 key 清單、同步清單、解析與回退、helper 行為 |
| `tests/phase-18-renderer-characterization.test.mts` | 修改 | 原始碼斷言改為新的讀取寫法 |
| `docs/dev/storage-keys.md` | 新增 | registry 說明、key 清單、同步表、新增 key 步驟 |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 補一行來源指引 |
