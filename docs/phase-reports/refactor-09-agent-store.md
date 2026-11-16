# 重構階段 9：agentStore 按領域拆分

- **開始時間**：2026-11-10 14:07（Asia/Taipei）
- **完成時間**：2026-11-10 15:14（Asia/Taipei）
- **基準 commit**：`5fdffe6`（分支 `claude/refactor-09-store-789440`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 5 項；排程見 3.1 節

## 範圍

**第 5 項（寵物 store 按領域拆分）**：`src/stores/agentStore.ts`（2,275 行）同時管理 sessions、mood、toast、MCP presentation、plugin feed、permission UI、面板導航、寵物偏好、桌面偏好、quota、成長與專案寵物。本階段以漸進方式把職責清楚、耦合低的領域抽到 `src/stores/agent/`，由 `useAgentStore()` 組裝；對元件的 state／getter／action 名稱與型別不變。

不在範圍：改變任何行為、IPC、preload 或主程序；Permission Broker 與持久化 XP 的權威（仍在 main）；元件修改。

## 驗收條件

1. `useAgentStore()` 對外的成員名稱、種類（值／函式）與型別不變，以匯出清單測試與型別探針固定；元件不需修改。
2. 改前以 characterization 測試（真的在 Node 載入 store、假計時器）固定：session 狀態與淘汰、toast 優先序／合併／TTL／暫停、presentation 佇列優先序與 TTL、mood 計算與每日重設、跨視窗同步寫入的 ref、localStorage key；改後同一組測試不變地通過。
3. 每個抽出的模組在檔頭寫明：事件輸入、計時器建立與清理、storage 讀寫、跨視窗同步。所有計時器在 store `$dispose()`（effect scope 結束）時清理，以測試證明。
4. renderer 不因拆分多做任何權限或 XP 決策。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗）、`git diff --check` 通過；隔離 Electron 與真實 hook 驗證寵物狀態切換、toast 顯示與消失、權限泡泡、跨視窗同步、重新載入後偏好保留。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`5fdffe6`）：1371 項，1336 過、12 失敗、23 skip，見「基準失敗清單」 |
| 2 | 建立 Node 載入 store 的測試支援與 characterization 測試（對原始 store 通過） | 通過 | `tests/agent-store-characterization.test.mts` 對 `5fdffe6` 的原始 store 31／31 |
| 3 | 抽出領域模組 | 通過 | 7 個模組；characterization 31／31 不變，新增的 dispose 測試 2 項在原始 store 失敗、拆分後通過；型別探針確認公開成員型別逐一相同 |
| 4 | Code review、效能調整 | 通過 | 見「Code review 紀錄」；寵物 id 查找改用快取 Set／Map，新增對應 characterization 1 項（原始 store 也通過） |
| 5 | Phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」；開始時漏改「進行中」，與步驟 4、6 交錯進行，特此註記 |
| 6 | 隔離 Electron 與真實 hook 實機驗證 | 通過 | 真實 hook 狀態 8 事件 × 5 輪、本階段腳本 28／28；開始時沒有先改「進行中」，特此註記 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-09-store-789440` |

## 基準失敗清單（`5fdffe6`）

任何程式修改前的完整 `test:unit`：1371 項，1336 過、**12 失敗**、23 skip。6 項 symlink EPERM 類（「a file edit is medium only inside the project…」「a symlinked staging root is refused」「startup recovery restores interrupted replaces…」「git helpers never follow gitdir or commondir…」「git helpers refuse a symlinked info directory…」「removing hooks from a symlinked dotfile…」）、6 項 hook 計時類（「a busy app still gets the event…」「a permission request still reaches the pet when the hook is stalled…」「a starting app that never opens its port…」「a status event still arrives when the hook process is stalled…」「an answer that is cut off or never finishes…」「with the pet closed the hook does not wait…」）。

## 盤點結果與拆分決策

`agentStore.ts` 的職責依耦合程度分成三類：

| 領域 | 依賴 | 決策 |
|---|---|---|
| toast 佇列（合併、TTL、暫停） | 只有 i18n 與格式化 | **抽出** `toast.ts` |
| Presentation 佇列（MCP／插件反應與說話） | 桌面偏好 3 個旗標、目前狀態、畫面上的寵物 id（以 getter 注入） | **抽出** `presentation.ts` |
| Plugin feed | 只有 IPC | **抽出** `plugin-feed.ts` |
| 心情 | storage；每個事件的進度計分 | **抽出** `mood.ts` |
| 寵物顯示偏好（大小、多寵物、4 個回饋開關） | storage | **抽出** `pet-display-preferences.ts` |
| 面板導航（route、blur lock、開啟計數） | 只有 IPC | **抽出** `panel-navigation.ts` |
| 權限泡泡 UI（佇列鏡像、決定、結果卡片） | 一個回呼：把被擋住的 session 改回 idle | **抽出** `permission-ui.ts` |
| Sessions、淘汰、stale sweep、snapshot 還原 | 所有領域的事件中心 | **保留**（見「未拆的領域」） |
| 等待輸入提醒、未讀結果 | sessions＋toast＋音效 sink＋桌面偏好 | 保留 |
| 桌面偏好鏡像 | presentation、未讀、音效、locale | 保留 |
| 寵物清單／家族對應／選擇、專案寵物、quota、成長與成就 | 寵物清單、XP 主程序快照 | 保留 |

### 各模組的契約（也寫在每個檔頭）

| 模組 | 事件輸入 | 計時器（建立 → 清理） | storage | 跨視窗同步 |
|---|---|---|---|---|
| `toast.ts` | `showToast()`（store 在 success／error、等待提醒到期時呼叫）、hover 暫停／恢復、關閉 | 到期＋每 100 ms 進度各一個；換新泡泡／暫停／關閉先清，`onScopeDispose` 清 | 無 | 無（兩個視窗各自從事件算） |
| `presentation.ts` | 主程序轉來的 intent（重新驗證形狀）；store 在高優先度狀態、DND、關 MCP 時清除 | 一個，指向目前 intent 到期；`onScopeDispose` 清 | 無 | 無 |
| `plugin-feed.ts` | 主程序推來的項目、未讀數、點連結／關閉 | 一個，指向 `expiresAt`；`onScopeDispose` 清 | 無 | 無 |
| `mood.ts` | 每個 agent 事件的進度計分、success／error 獎懲、session 移除、摸摸、重設 | 無（時間分以事件 timestamp 算） | `agent-pet-mood`、`-mood-date`、`-mood-version`、`-mood-visuals`、`-pat` | `mood`、`moodVisualsEnabled` 由 App.vue 直接寫入 |
| `pet-display-preferences.ts` | 設定頁 setter | 無 | `agent-pet-scale`、`-multi`、`-fx`、`-bubble`、`-ambient`、`-activity` | 6 個 ref 由 App.vue 直接寫入 |
| `panel-navigation.ts` | 面板元件的導航、主程序的 `panel-opened` | 無；`panelModalOpen` 的 watch 隨 scope 結束 | 無 | 無 |
| `permission-ui.ts` | broker 廣播的完整佇列（重新驗證形狀）、使用者的決定 | 結果卡片一個；`onScopeDispose` 清 | 無 | 無（主程序廣播給兩個視窗） |

`agentStore.ts` 本身的等待輸入提醒計時器（每個 session 一個）也加了 `onScopeDispose` 清理。

## 設計摘要

- 每個模組是 `useXxx()`，在 Pinia setup store 內呼叫，所以 `computed`／`watch`／`onScopeDispose` 都綁在 store 的 effect scope；`store.$dispose()` 時一併停止與清理。
- 對外成員：全部成員都對外的模組（顯示偏好、面板導航、plugin feed、權限 UI）以展開放進 return；toast、心情、presentation 只列出原本就對外的成員，內部用的（`showToast`、`awardTaskProgress`、`clearMcpPresentation` 等）不外露。匯出清單測試會擋任何新增或遺漏。
- Presentation 依賴的 `currentState`／`activePetId`／`familyLines` 在 store 後段才宣告，所以以 getter 注入，呼叫時才讀；computed 透過 getter 讀 ref 一樣會追蹤依賴。
- 權限 UI 只拿到一個 `settleWaitingPermission(agentId, sessionId)` 回呼（只改畫面上的 session 狀態）；broker、TTL、送達與稽核仍全部在主程序。
- 純函式另外匯出：`normalizePresentationIntent`、`isUrgentForPresentation`、`normalizePluginFeedItem`、`moodLabel`。

### 刻意的行為差異

只有一項：`store.$dispose()`（或測試結束）時清掉 toast、presentation、plugin feed、權限結果卡片與等待輸入提醒的計時器。原本 dispose 後這些計時器仍會觸發並改動已停止的 store。App 執行期間 store 從不 dispose，所以使用者看不到差異。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過（exit 0） |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit`（完整負載，兩次） | 第 1 次：1405 項，1368 過、14 失敗——基準 12 項＋`ipc-inventory`（見下）＋`panel-theme-diagnostics` 的 timing ceiling（單獨重跑 5／5 通過）。更新 IPC 清單後第 2 次：1405 項，**1370 過、12 失敗**，與基準清單完全相同 |
| `tests/agent-store-characterization.test.mts` | 34／34（兩次完整負載都通過；全部用 node:test 假計時器） |
| 對原始 store 跑同一份 characterization | 把 `5fdffe6` 的 `agentStore.ts` 暫時放回：32／34，只有新增的 2 項 dispose 測試失敗（證明測試有效、其餘行為相同） |
| 型別探針（臨時檔，已刪除） | 把 `5fdffe6` 的 store 複製成 `__baseline_agentStore.ts`，以 `Eq<Old[K], New[K]>` 逐一比對所有公開成員並比對整體型別，`vue-tsc` 通過；探針中故意的錯誤會被抓到 |
| 相關既有測試（`phase-18-renderer-characterization`、`storage-keys`、`pet-window-size`、`desktop-preferences`、`project-pets-ipc-scope`、`pet-atlas`） | 58／58 |
| `ipc-inventory` | 新測試檔提到 preload API 名稱，產生器把它列為對應測試；以 `node scripts/generate-ipc-inventory.mjs --write` 重新產生 `docs/security/ipc-inventory.md` 後 4／4 |
| `pnpm.cmd check:design:strict` | 通過 |
| `node scripts/lint-main-process.mjs` | 通過 |
| `git diff --check` | 通過 |

測試數 1371 → 1405：新增 `tests/agent-store-characterization.test.mts` 34 項（API 清單、跨視窗同步寫入、偏好與 localStorage key 2 項（15 個 key 的讀取、寫入與預設）、心情 5 項、session 7 項、寵物選擇 1 項、toast 5 項、presentation 4 項、plugin feed 1 項、權限 UI 3 項、面板導航 1 項、桌面偏好 1 項、dispose 2 項）。測試支援：`tests/support/src-alias.mts`（`module.registerHooks` 把 `@/` 解析到 `src/`）、`tests/support/agent-store-harness.mts`（假 localStorage、Proxy 假 IPC 並記錄呼叫、假計時器並追蹤未觸發的計時器）。

## 隔離 Electron 驗證

以 `scripts/e2e-isolated-electron.mjs --offscreen`（隔離 HOME／userData、事件埠 27373–27375、所有視窗 `showInactive()` 在螢幕外）啟動，以 CDP 讀 DOM 與 Pinia store。驗證腳本放在 session scratchpad，不進版本控制；隔離暫存目錄用完已刪除，app 以主程序 `app.quit()` 正常結束。

**真實 hook 的寵物狀態切換**（`scripts/e2e-real-hook.mts`）：在隔離 HOME 執行真正的安裝程式，照 Claude Code 的方式以 stdin 送 8 個事件並讀寵物 canvas。第一輪 7／8：`Stop` 畫成 `waving@3`（預期 `jumping@4`）；success 的動作是 jumping 2 輪（約 1.7 秒）後轉 waving，腳本在 hook 結束後 0.9 秒才讀，hook 本身較慢時就會讀到下一段。動作規劃與 `PetAnimation` 本階段都沒動；接著 `--rounds 4` 32／32 全部符合。

**本階段腳本**（28／28）：

| 項目 | 方法 | 結果 |
|---|---|---|
| toast 顯示與消失 | 真實 `UserPromptSubmit`＋`Stop` hook | 寵物 DOM 出現「完成 Claude CLI · p9」，面板 store 同一 session 也是 success；4.5 秒後 DOM 與 store 都清空、剩餘時間 0 |
| 失敗泡泡與暫停 | 真實 `StopFailure`；寵物 store `pauseToast()` | DOM 出現「失敗」（`.error`）；暫停後超過 7.5 秒 TTL 仍在 |
| 等待輸入提醒 | 真實 `Notification` hook | 5 秒寬限期內沒有泡泡、之後出現「在等你回覆」 |
| 權限泡泡（broker） | 以 OpenCode adapter 協定對 27374 建立請求；寵物 store `decidePermission('deny')`；adapter 輪詢 `/decision` 並回報 `/result` | 寵物 DOM 出現權限卡片、面板 store 同一份佇列；adapter 收到 `deny`，決定回傳 `{ ok: true, status: 'denied' }`，兩個視窗的佇列都清空、沒有結果卡片 |
| Claude 權限提示 | 真實 `PermissionRequest` hook | 寵物 DOM 出現「正在等你核准… 請回到終端機」；`dismissPermissionNotice()` 後消失 |
| 跨視窗同步 | 面板改大小、多寵物、泡泡、ambient、activity、心情外觀、家族對應、寵物、摸摸；寵物改反應 | 另一個視窗全部更新（心情 +1） |
| 面板導航 | 面板 `openSettings()`／`backToSessions()` | `settings` → `sessions` |
| 重新載入後偏好保留 | 兩個視窗 `location.reload()` | 兩個視窗讀回全部 9 個偏好與心情值 |
| 不打擾使用者 | 主程序 `isVisible()`／`isFocused()`、`document.hasFocus()` | 面板顯示但未取得焦點、x = −18924；兩個視窗都沒有焦點 |

腳本調整紀錄（都是腳本問題，不是產品問題）：OpenCode 的決定要等 adapter 輪詢並回報送達，第一版先 await 決定才輪詢，等到 TTL 回 `expired`；面板失焦會自動隱藏，隱藏的視窗被 Chromium 節流、事件晚到（最後都到了），改由主程序 `showInactive()` 並釘選面板；另一個 error session 的優先度高於 waiting-input，改檢查該 session 自己的狀態。

## 安全審查

- **信任邊界**：沒有新增或修改 IPC channel、preload 方法、本機 server、檔案操作、通知或 MCP 工具；`electron/` 沒有任何改動。`docs/security/ipc-inventory.md` 的差異只有「對應測試」欄多列新測試檔。
- **Permission Broker**：renderer 端仍只鏡像 broker 廣播的佇列、把使用者按的選項原樣送給主程序、並在請求離開佇列時顯示結果；形狀驗證、`decidingRequestIds` 競態處理與「只有送達／取消／過期才把 session 改回 idle」的規則逐字搬移，characterization 與實機都驗證過。
- **XP 與成長**：`progression`／`achievements` 的處理沒有移動；心情仍只是 renderer 的短期狀態，不寫主程序。
- **MCP presentation**：只決定要不要顯示反應或說話；intent 驗證（種類、id、到期、來源只能是 plugin 且只能 react、petId、訊息正規化與長度）逐字搬移，並以測試覆蓋無效形狀、未知寵物與佇列上限。
- **Plugin feed**：URL 驗證（圖示只能是本插件的 `agent-pets://plugin/<id>/`、連結只能是無帳密無 port 的 https）拆成兩個小函式，邏輯不變，測試覆蓋 http 連結被拒、https 與圖示被接受、到期時間過遠被拒。
- **測試支援**：`@/` resolver 只在 import 它的測試行程內生效，不進產品建置。
- **相依套件**：`package.json`／`pnpm-lock.yaml` 未變，未重跑 `pnpm audit`。
- **秘密掃描**：新增行只有 `icon.password`／`url.password` 兩處 URL 帳密檢查（既有邏輯）；沒有 token 或憑證。測試裡的 permission token 只在實機腳本從隔離 HOME 讀取，不進版本控制。

## Code review 紀錄

- **語法**：`TOAST_TITLE_KEYS` 以 `as const satisfies Record<ToastTone, string>` 取代巢狀三元；presentation 的 reaction 改用型別守衛 `isPresentationReaction()`，移除 `as PresentationReaction`；`WORKING_STATES`／`TASK_END_STATES` 以 `ReadonlySet` 取代 `||` 鏈；`?.`、`??` 照原樣。
- **效能**：`getPetForFamily()`（`familyLines` 每個家族呼叫一次，而 `familyLines` 在每個 agent 事件都重算）原本對 `visiblePets` 線性 `some`，改查快取的 `visiblePetIds` Set；`activePetId` 與 `getPresentationStatus()` 對 `pets` 的 `some`／`find` 改查快取的 `petsById` Map。兩者只在寵物清單改變時重建。`handleEvent` 與 `restoreSessionSnapshot` 的 `sanitizeHost()` 原本每筆呼叫兩次，改成一次。`taskStartedAt` 的用時原本在同一個事件內算兩次，改成一次。前後以 characterization 測試確認結果相同（寵物選擇測試在原始 store 也通過）。
- **保留的線性搜尋**：`decidePermission()` 的 `find`：broker 佇列最多幾筆，另建索引的同步成本高於查找，註解說明。`sessionList` 每次事件排序是面板清單本來的需求，沒有動。
- **事件熱路徑**：`handleEvent` 沒有新增深拷貝；心情進度仍是就地更新 Map 裡的物件。
- **風格**：新檔一律 `@/` 匯入；註解只寫原因；各模組檔頭寫契約；store 內以 `// ---` 區段標頭組織，模組組裝放在「自成一體的領域」區段。
- **未用子代理**：七個模組都要改同一個 `agentStore.ts`（組裝與 return），平行派發會互相覆蓋，因此由總控直接實作並逐檔複檢 diff。
- **未修改** `.claude/skills/agent-pets-conventions`（未追蹤的 `.claude/` 目錄）。它的 §1 寫「目前專案沒有」接上 `@/` 的 Node resolver；本階段新增了 `tests/support/src-alias.mts`，若要更新該 skill 需使用者同意。pet-skill 的 `project-map.md` 已補上 store 模組與測試支援的位置。

## 未拆的領域與建議

1. **Sessions 與淘汰規則**（`handleEvent`、`cleanupStale`、`restoreSessionSnapshot`、`handleSuccessTimeout`、`removeSession`、`clearOfflineSessions`、衍生的 `familyLines`／`highestPrioritySession`／`activePetId`）：`handleEvent` 是 toast、心情、presentation、未讀、等待提醒、權限提示與 quota 訊號的共同入口，回傳值又是音效決策；拆出來需要一個明確的事件派發介面（例如 session 模組回傳「狀態轉換」描述，由 store 分派給各領域），一次搬動的閉包與 Vue 響應式（`reactive(Map)`、就地改 session 物件）範圍太大，本階段不硬拆。建議下一步：先把 `AgentSessionIndex` 與 snapshot 還原的純邏輯抽成 `sessions.ts`（不含副作用），再把「狀態轉換 → 副作用」改成表驅動的分派。
2. **等待輸入提醒與未讀結果**：依賴 sessions、toast、音效 sink 與桌面偏好，等 sessions 拆好再一起移動。
3. **桌面偏好鏡像**（約 25 個 ref 與 setter）：結構單純但會清 presentation、未讀與寫音效快取；可以抽成 `desktop-preferences.ts`，以回呼注入這三個副作用。風險低，留給後續或階段 11 一起處理。
4. **寵物清單／家族對應／專案寵物、quota、成長與成就**：彼此獨立，可各自成模組；本階段以既定的 2–3 個以上領域為上限，先不動。
5. `tests/phase-18-renderer-characterization.test.mts` 等以原始碼正規表示式檢查 store 的舊測試仍有效（相關程式碼還在 `agentStore.ts`）；之後若再拆 sessions，應改用本階段的 harness 驗證行為。

## 殘餘風險

- 實機驗證只在 Windows；macOS／Linux 的視窗與 hook 行為未測（本階段沒有平台相關程式）。
- 面板在隱藏時被 Chromium 節流、事件延後處理，是既有行為；本階段沒有改變，也沒有進一步追查。
- 計時類既有測試（`agent-hook-delivery`、`panel-theme-diagnostics`）在完整負載下偶發失敗，單獨重跑通過；新增的測試全部用假計時器。

## 版本建議

本階段屬於大型結構重構但不改公開契約、持久化格式或安全邊界，單獨看是 patch；依 3.1 節排程，整體重構最後統一升 **minor**，本階段不改版本號。

## 檔案變更狀態

| 路徑 | 狀態 | 目的 |
|---|---|---|
| `src/stores/agentStore.ts` | 修改 | 2,275 → 1,527 行；改為組裝 7 個領域模組，對外 API 不變；寵物 id 查找改快取；等待提醒計時器在 dispose 清理 |
| `src/stores/agent/toast.ts` | 新增 | 結果泡泡佇列 |
| `src/stores/agent/presentation.ts` | 新增 | MCP／插件 presentation 佇列與 intent 驗證 |
| `src/stores/agent/plugin-feed.ts` | 新增 | 插件 feed 項目驗證與到期 |
| `src/stores/agent/mood.ts` | 新增 | 心情計分、每日重設、摸摸上限 |
| `src/stores/agent/pet-display-preferences.ts` | 新增 | 寵物視窗本機顯示偏好 |
| `src/stores/agent/panel-navigation.ts` | 新增 | 面板 route、blur lock、開啟計數 |
| `src/stores/agent/permission-ui.ts` | 新增 | 權限泡泡的畫面狀態（broker 鏡像） |
| `tests/agent-store-characterization.test.mts` | 新增 | 在 Node 跑真的 store 的 characterization 34 項 |
| `tests/support/agent-store-harness.mts` | 新增 | 假 storage／IPC／計時器的 store harness |
| `tests/support/src-alias.mts` | 新增 | Node 測試的 `@/` resolver |
| `docs/security/ipc-inventory.md` | 修改 | 產生器重新產生（對應測試欄） |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | store 模組與測試支援的位置 |
| `docs/phase-reports/refactor-09-agent-store.md` | 新增 | 本工作記錄 |
