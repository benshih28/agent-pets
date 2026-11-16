# 1.14.1 型別與風格清理

- **基準 commit**：`79e3704`（`main`，版本 1.14.0）
- **階段順序**：G0 → A → B → C → D → E → F → F2 → F3。每階段一個 worktree 分支，都從整合分支 `claude/release-1-14-1` 切出；主 session 複驗後 squash 合併回整合分支，再刪掉該階段的 session、worktree 與分支。
- **版號**：使用者核准後升 patch 版 1.14.1（`package.json`）。升版後重跑 lint、vue-tsc、vite build 與全量單元測試。
- 本檔由各階段依序續寫，每階段一節。

## 整輪總結

### 各階段 commit

| 階段 | commit | 檔案數 | 摘要 |
|---|---|---|---|
| G0 | `aa2f783` | 8 | 目錄連結測試改用 junction，Windows 不用開發者模式也能跑；檔案 symlink 測試在無法建立時 skip；順手修正 `atomic-write-call-sites` 的偶發失敗 |
| A | `c3e0dfd` | 5 | renderer 收 agent 狀態事件的路徑改用 `AgentStatusEvent` 型別，不再是 `any` |
| B | `da302ae` | 39 | 新增 `electron/value-guards.ts`（`asRecord`／`recordOrEmpty`），取代約 30 處手寫的物件守衛；`quota.ts` 不再有 `any` |
| C | `031c09b` | 4 | `setup.ts` 產生的 Codex／Claude Code hook JSON 改用嚴格型別，characterization 測試逐位元組鎖住 dotfile 輸出 |
| D | `04162d1` | 42 | 分支鏈改成 `switch` 或 handler map（`ActionMenu` 改為泛型）；集中重複常數；`event-server` 改用 `IPC_CHANNELS`；`PermissionBubble` 的 CSS 抽成獨立檔 |
| E | `416e556` | 9 | `plugin-feed` 的 `addToCenter` 改成 O(n) 原地壓縮；`SessionSnapshotStore.get` 改成 O(1)；plugin storage 寫入改成增量計算大小，順手修正 prototype key 的問題 |
| F | `7901aa2` | 35 | 測試檔剩下的 36 個 `any` 清零，抽出 `makeAgentStatusEvent` 與 `createFakeIpcMain` 兩個共用 fixture；`no-explicit-any` 升成 error；lint 忽略 `.claude/**`、`.playwright-mcp/**` |
| F2 | `35c5dd8` | 106 | 修正「整個測試檔沒跑完」的根因（import 時 `rmSync` 遇到 Windows 檔案鎖）；7 個測試檔的計時斷言改成負載下穩定；新增 `tsconfig.tests.json`，`tests/` 的 178 個型別錯誤清零並接進 `pnpm lint` |
| F3 | `9e294c6` | 47 | `tests/` 的 114 處 `as never` 與 `electron/` 的 3 處清零，lint 以 `no-restricted-syntax` 禁止；新增 `invalid<T>()`、`fakeDisplay`、`makePermissionRequestView`；`CrashGuardProcess.off` 改成逐事件 overload |

整輪相對基準 `79e3704`：共 220 個檔案變更（各階段有重疊的檔案只算一次）。

### 前後對比

| 項目 | 基準（`79e3704`） | 本輪結束（F3） |
|---|---|---|
| `pnpm lint` | 0 error、52 warning（全是 `no-explicit-any`） | 0 error、0 warning；`no-explicit-any` 已是 error；含 tests 型別檢查 |
| `tests/` 型別檢查 | 沒有（`tsconfig.json` 不含 `tests/`） | `tsconfig.tests.json`，0 error |
| `as never` | `tests/` 114 處、`electron/` 3 處，lint 不檢查 | 0 處，lint 禁止 |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1811 tests、6 fail、37 skip | 1837 tests、0 fail、39 skip；F2 連續 5 次與 3 個全量同時跑 6 次、F3 連續 3 次都穩定 |

測試數增加 26 項：G0 拆出 1 項、B 11 項、C 2 項、D 1 項、E 11 項，都是 characterization 或回歸測試。skip 多 2 項是 G0 掛上的檔案 symlink 測試。F、F2、F3 只重構測試，沒有增減測試數。

### 殘留風險彙總

- 沒有啟動 Electron 實機確認 `PermissionBubble` 的畫面，以及頁首、插件卡片、我的主題等選單（D）。插件通知中心與 turn-end 補送 idle 也只靠單元測試與差分測試（E）。
- `pnpm bench:lag:check` 在這台 Windows 機器上，E 之前就已超出門檻：mean 約 15.4–15.5 ms，門檻 12 ms。baseline 檔是在 macOS 上量的，15.5 ms 又剛好接近 Windows 預設的計時器粒度。E 前後數值相同，與本輪無關；需要在 macOS／CI 重跑，或替 Windows 另建 baseline。
- Windows 無法建立檔案 symlink 時（沒開開發者模式），2 個測試會 skip；這兩個測試只在 macOS／Linux 或開了開發者模式的 Windows 上驗證（G0）。
- 本輪只在 Windows 上驗證；macOS／Linux 的行為（junction 型別被忽略、macOS Keychain 憑證路徑等）依文件與既有測試推定。
- `tests/` 已納入型別檢查（F2），`as never` 已清零並由 lint 禁止（F3）；但 `fakeService` 只檢查鍵名，`tests/` 仍有 62 處 `as unknown as`（多半是讀 store 私有欄位），lint 未禁止。編輯器開啟測試檔時會顯示推斷專案的假錯誤，實際以 `pnpm typecheck:tests` 為準。
- hook 計時測試的上限是兩倍 node 啟動基準加餘裕。基準超過 3.5–5.5 秒的極端負載下仍不會誤報，但抓不到對應的退化（F2）。
- F3 調整了 `CrashGuardProcess` 介面（主程序 crash guard 的型別），只靠型別檢查與單元測試驗證，沒有啟動 Electron。
- **建議版號：patch 1.14.1**。本輪是型別、風格、測試與內部演算法的調整，沒有改持久化 schema、公開契約或安全邊界。

## G0：Windows 無法建立 symlink 的測試

- **分支**：`claude/cleanup-g0-symlink-tests-8871b0`
- **開始時間**：2026-11-11 11:35（Asia/Taipei）
- **完成時間**：2026-11-11 11:45（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、盤點 6 個失敗測試與受測程式碼 | 通過 | 5 個目錄連結、2 處檔案連結（其中 1 個測試兩者都有） |
| 2 | 共用 helper 與測試調整 | 通過 | `linkDirectory`；目錄改 junction、檔案掛 skip |
| 3 | junction 判定負向對照 | 通過 | 實測 `lstat`／`Dirent`／`realpath` 對 junction 的回報與目錄 symlink 一致 |
| 4 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit` | 通過 | 第一次全量出現 `atomic-write-call-sites` 偶發失敗，修正後連續兩次全量 0 fail |
| 5 | code review（現代 TS 寫法、pet-skill 規則）與 commit | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `tests/support/fs-capabilities.mts` | 新增 `linkDirectory(target, link)`，以 `'junction'` 建立目錄連結 | 目錄連結測試共用一個免權限的建立方式，不在各測試重複寫 |
| `tests/hook-config.test.mts` | symlinked dotfile 測試掛 `SKIP_WITHOUT_FILE_SYMLINKS` | 檔案 symlink 無免權限替代品 |
| `tests/permission-adapter-server.test.mts` | `linked` 目錄改用 `linkDirectory`；建立目錄與連結移進 `try` | 讓整個測試在 Windows 執行；建立失敗時也清掉暫存目錄 |
| `tests/pet-import.test.mts` | 兩處目錄 symlink 改用 `linkDirectory`，移除未再使用的 `symlinkSync` import | 讓 recovery 與 staging root 的安全測試在 Windows 執行 |
| `tests/project-mcp-setup.test.mts` | `link.git` 改用 `linkDirectory`；info／exclude 測試拆成兩個，exclude 那個掛 skip | 目錄部分照常執行，只略過需要檔案 symlink 的斷言 |
| `tests/plugin-developer-mode.test.mts` | 自寫的 `symlinkSync(..., 'junction')` 改用 `linkDirectory` | 抽共用，避免重複 |
| `tests/atomic-write-call-sites.test.mts` | 新增 `onlyTemporaryPath()`，三處「rename 次數」斷言改為「不重複暫存路徑恰為 1」（EBUSY 重試那個改成次數 ≥ 2 且同一路徑） | 全量測試時偶發失敗（見下方「範圍內順手修正」），斷言改測真正要固定的性質 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增，建立 G0 一節 | 階段紀錄，後續階段續寫 |

### 問題

這台 Windows 機器沒開開發者模式，`fs.symlinkSync` 回 `EPERM`，`pnpm test:unit` 有 6 個測試失敗，讓之後每個階段都沒有乾淨的測試基準：

| 檔案 | 測試 | 連結種類 |
|---|---|---|
| `tests/hook-config.test.mts` | removing hooks from a symlinked dotfile keeps the link and its target | 檔案 |
| `tests/permission-adapter-server.test.mts` | a file edit is medium only inside the project and never for execution-relevant paths | 目錄 |
| `tests/pet-import.test.mts` | startup recovery restores interrupted replaces and removes only our own stale entries | 目錄 |
| `tests/pet-import.test.mts` | a symlinked staging root is refused | 目錄 |
| `tests/project-mcp-setup.test.mts` | git helpers never follow gitdir or commondir outside the picked folder | 目錄 |
| `tests/project-mcp-setup.test.mts` | git helpers refuse a symlinked info directory or exclude file | 目錄＋檔案 |

### 改了什麼（說明）

1. `tests/support/fs-capabilities.mts` 新增 `linkDirectory(target, link)`：一律以 `'junction'` 型別建立目錄連結。Windows 上 junction 不需要開發者模式；其他平台 Node 會忽略這個型別，照常建立目錄 symlink，所以 macOS／Linux 的測試行為不變。
2. 目錄連結（5 個測試）改用 `linkDirectory`，在 Windows 也真正執行，不 skip。
3. 檔案連結：
   - `hook-config` 那個測試掛 `{ skip: SKIP_WITHOUT_FILE_SYMLINKS }`。
   - `project-mcp-setup` 的「info directory or exclude file」拆成兩個測試：「refuse a symlinked info directory」（junction，照常執行）與「refuse a symlinked exclude file」（檔案 symlink，掛 skip）。原本兩段斷言完全保留，只是後一段改在自己的暫存目錄裡重建 `.git/info`，不再依賴前一段刪掉連結的步驟。
4. `permission-adapter-server` 的測試原本混了 symlink 與非 symlink 斷言；改用 junction 後整個測試都能執行，因此不需要拆。順便把建立目錄與連結移進 `try`，原本這幾行在 `try` 外，失敗時暫存目錄不會被清掉。
5. `tests/plugin-developer-mode.test.mts` 原本自己寫 `fs.symlinkSync(source, linked, 'junction')`，改用共用的 `linkDirectory`，避免兩處各寫一份。

### 為什麼目錄可以用 junction

這些測試驗證的安全性質是「受測程式碼不跟隨連結」。受測程式碼判斷連結的方式：

- `electron/pet-import.ts`：`lstat().isSymbolicLink()`／`isDirectory()`（staging root、recovery 逐項檢查）。
- `electron/git-tracking.ts`：`lstatSync().isSymbolicLink()`（`.git/info`）與 `realpathSync`（gitdir／commondir 是否在專案外）。
- `electron/permission-risk.ts`（經 `permission-adapter-server.ts`）：`realpathSync.native` 解析最近存在的祖先目錄。

在本機實測 Node 對 junction 的回報與目錄 symlink 相同：`lstat().isSymbolicLink() === true`、`isDirectory() === false`、`readdir` 的 `Dirent.isSymbolicLink() === true`、`realpathSync` 與 `realpathSync.native` 都解析到目標。因此用 junction 時測試仍在驗證同一個性質；若受測程式碼沒偵測到連結，這些測試會因為寫穿到外部目錄或風險等級錯判而失敗，不會意外通過。

檔案沒有不需權限的連結替代品（hard link 不是 reparse point，`lstat` 不會回報為連結，會改變測試語意），所以只能 skip。

### 範圍內順手修正：`atomic-write-call-sites` 的偶發失敗

第一次全量 `pnpm test:unit` 時，6 個 symlink 失敗已消失，卻多出 1 個不在清單上的失敗：`desktop-preferences writeJsonAtomic …: temporary file name format is stable`（`2 !== 1`）。單獨重跑該檔 5 次都通過，屬於偶發。

原因：測試攔截 `fs.renameSync`，每看到一次 `.tmp` 來源就記一筆，再斷言筆數為 1。但 `electron/fs-rename.ts` 的 `renameSyncWithRetry` 在 Windows 遇到暫時性 `EPERM`／`EBUSY`（全量並行時防毒或索引程式短暫鎖檔）會以同一個暫存路徑重試，同一個暫存檔就被記了兩次。這是受測程式碼刻意的正確行為，錯在斷言量的是 rename 次數。

測試想固定的是「一次寫入只用一個暫存檔，且名稱格式穩定」，所以改成比對不重複的暫存路徑數；EBUSY 注入那個測試原本要求「恰好 rename 2 次」，改成「至少 2 次且都是同一路徑」，仍證明注入的 EBUSY 之後有重試同一個暫存檔。斷言沒有放寬：若實作改成每次重試換新暫存檔或一次寫入用兩個暫存檔，仍會失敗。三處共用 `onlyTemporaryPath()`，不各寫一份。

### 驗證

| 檢查 | 基準（`79e3704`） | G0 之後 |
|---|---|---|
| `pnpm lint` | 0 error、52 warning（`no-explicit-any`） | 0 error、52 warning，未新增；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1811 項：6 fail、37 skip | 1812 項：1773 pass、0 fail、39 skip（連續兩次全量相同） |
| `git diff --check` | — | 通過 |

- 測試數 +1：`project-mcp-setup` 的 info／exclude 測試拆成兩個。
- skip +2：`hook-config` 的 symlinked dotfile、`project-mcp-setup` 的 symlinked exclude file，皆顯示 `# file symlinks need Developer Mode or elevated privileges on Windows`。
- 原本失敗的 5 個目錄連結測試以 junction 在本機實際執行並通過。
- 負向對照：本機實測 junction 的 `lstat().isSymbolicLink() === true`、`isDirectory() === false`、`Dirent.isSymbolicLink() === true`、`realpathSync`／`realpathSync.native` 解析到目標。
- code review（現代 TS 寫法、pet-skill 規則）：改動只在 `tests/` 與本報告，不觸及 renderer、IPC、hook 或任何信任邊界；沒有放寬斷言；連結建立與暫存路徑檢查各抽成一個共用函式；註解只寫原因且為繁體中文；新增函式有明確回傳型別、參數用 `readonly string[]`；`!` 只用在已斷言長度之後。無 Liquid Glass／視覺變更，不需視覺閘門。

### 殘留風險

- 兩個檔案 symlink 測試在沒有開發者模式的 Windows 上是 skip，該行為只在 macOS／Linux 或開了開發者模式的 Windows 上被驗證。
- junction 與目錄 symlink 在 Windows 上仍有差異（junction 只能指向本機絕對路徑、不能指向檔案或網路路徑）；受測程式碼目前的判斷只用到兩者一致的部分，日後若改用 `readlink` 的原始字串或依賴相對目標，需要重新檢查。
- `atomic-write-call-sites` 的偶發失敗只觀察到一次，原因是依 `renameSyncWithRetry` 的重試行為推定（單獨跑 5 次、修正後全量 2 次都通過），未直接捕捉到當次的 `EPERM`／`EBUSY`。
- 本機只在 Windows 執行；macOS／Linux 上 `'junction'` 被忽略的行為依 Node 文件推定，未在本階段實機驗證。

## A：renderer 收 agent 狀態事件路徑上的 `any`

- **分支**：`claude/cleanup-a-renderer-any-e2cedd`
- **開始時間**：2026-11-11 03:55（Asia/Taipei）
- **狀態**：通過
- **完成時間**：2026-11-11 03:57（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、追 `agent-status-event` 從 main 到 renderer 的路徑 | 通過 | 唯一送出點是 `electron/event-server.ts` 的批次 `webContents.send` |
| 2 | 型別對齊：`electron-api.ts`、`preload.ts` | 通過 | 執行期驗證仍在 main 的 `event-normalizer`，未變動 |
| 3 | 移除 `App.vue`、`useRealEventWait.ts` 的 `any`／手動斷言 | 通過 | |
| 4 | 掃 `src/**` 其他 `any` | 通過 | 只剩一處英文註解裡的 "any" 字樣，非型別 |
| 5 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit`、code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `src/types/electron-api.ts` | `onAgentStatusEvent` 的 callback 參數由 `any` 改為 `AgentStatusEvent` | main 只送正規化後的 `AgentStatusEvent`，型別應反映實際契約 |
| `electron/preload.ts` | callback 型別改為 `AgentStatusEvent`，`data` 標為 `AgentStatusEvent \| AgentStatusEvent[]`；加註說明驗證在 main | 與 `ElectronAPI` 對齊；preload 不做驗證，避免讀者誤以為型別等於檢查 |
| `src/App.vue` | `(window as any).electronAPI` 改為 `window.electronAPI`（`env.d.ts` 已宣告為 optional，保留 `?.`）；`store.handleEvent(event)` 不再 `as any` | 移除 2 個 `any`；改用全域宣告後，同一區塊其他 `electronAPI.*` 呼叫也開始受型別檢查（`vue-tsc` 0 error） |
| `src/composables/useRealEventWait.ts` | 移除 `raw: unknown` 與 `raw as {...}` 手動斷言，直接用推導出的 `AgentStatusEvent`；拿掉 `!event?.source` 檢查 | `source` 在型別上必填，且 normalizer 會拒絕缺少或不合法的 `source` |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 A 一節 | 階段紀錄 |

### 事件契約確認

- main → renderer 只有一個送出點：`electron/event-server.ts` 的 `enqueueAgentEvent` 批次回呼，送出 `AgentStatusEvent[]`。
- 進入 `sendToWindows` 的事件只有兩個來源：HTTP ingress 經 `normalizeAgentStatusEvent`（拒絕非字串或不在 `VALID_SOURCES` 的 `source` 等），以及主程序自產、以 `AgentStatusEvent` 型別傳入的 dispatcher 事件。
- preload 仍保留「陣列或單筆」的攤平邏輯，執行期行為不變；main 端驗證未因型別變更而省略。

### Code review 結論

- 只改型別與移除斷言，沒有改變執行期行為（除 `useRealEventWait` 拿掉一個依契約不會成立的 `!event?.source` 防禦）。
- 不碰 B～F 範圍：未動 `electron/quota.ts`、`value-guards.ts`、`setup.ts`，也未調整 eslint 規則層級。
- `src/**` import 仍為 `@/`；`preload.ts` 是 electron 端，沿用相對路徑。新增註解為繁體中文且只寫原因。
- `useRealEventWait.ts` 的 `AgentSource` import 仍被 `WaitableTool` 使用，無多餘 import。
- 無 Liquid Glass／視覺變更，不需視覺閘門。

### 驗證

| 檢查 | G0 之後 | A 之後 |
|---|---|---|
| `pnpm lint` | 0 error、52 warning（`no-explicit-any`） | 0 error、49 warning（皆為 `no-explicit-any`，全在 `tests/`、`electron/`；`src/` 0 個）；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1812 項：1773 pass、0 fail、39 skip | 1812 項：1773 pass、0 fail、39 skip |
| `git diff --check` | 通過 | 通過 |

### 殘留風險

- 型別現在宣稱 renderer 收到的一定是 `AgentStatusEvent`；若日後新增一條繞過 `event-normalizer` 的送出路徑，型別不會攔住，需在 main 端維持「只送正規化事件」的不變式。
- `electron/event-server.ts` 送出時寫死字串 `'agent-status-event'`，未用 `IPC_CHANNELS.agentStatusEvent`；兩者目前一致，但不在 A 的 renderer 範圍，留給 D（風格統一）處理。
- 本階段沒有 renderer 端的自動化測試覆蓋 `App.vue`／`useRealEventWait` 的事件接收；正確性依 `vue-tsc` 與既有行為推定，未啟動 app 實機驗證。

## B：主程序共用值守衛與 `quota.ts` 的 `any`

- **分支**：`claude/cleanup-b-value-guards-96b4de`
- **開始時間**：2026-11-11 12:01（Asia/Taipei）
- **狀態**：通過
- **完成時間**：2026-11-11 12:18（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範，盤點 `quota.ts` 的 10 處 `any` 與指定的手寫守衛 | 通過 | `window-controls.ts` 實際有 5 處（多了 `petContentHeight`），一併替換 |
| 2 | quota characterization 測試（改動前先在原始碼跑綠） | 通過 | `tests/quota-parsing.test.mts` 8 項 |
| 3 | `value-guards.ts` 新增 `asRecord`、`recordOrEmpty`，並補單元測試 | 通過 | `tests/value-guards.test.mts` 3 項 |
| 4 | `quota.ts` 改用 `Record<string, unknown>`，數字欄位改用 helper | 通過 | 10 處 `any` 全數移除 |
| 5 | 替換指定檔案的手寫守衛，補陣列 payload 回歸斷言 | 通過 | 見「陣列 payload 的行為差異」 |
| 6 | Haiku 掃 `electron/**`、`integrations/**`；Sonnet 替換等價守衛 | 通過 | 共 79 處，只換語意與 `isRecord` 完全一致的 29 處（23 個檔案） |
| 7 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit`、code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `electron/value-guards.ts` | 新增 `asRecord(value): Record<string, unknown> \| null` 與 `recordOrEmpty(value): Record<string, unknown>`，判斷都交給 `isRecord` | 各處不必再手寫「是物件且不是陣列」的斷言 |
| `electron/quota.ts` | 拿掉本地的 `asObject`，改用 `asRecord`；`requestJson`、`loadCodexCredential`、`codexNeedsRefresh`、`parseCodexUsage`、`parseClaudeUsage`、`readClaudeCliUsage` 改用 `Record<string, unknown>`；`limit_window_seconds`、`reset_at`、`expiresAt` 改用本地的 `coercedFiniteNumber` | 移除 10 處 `any`，數字欄位不用 `as number` 斷言 |
| `electron/local-usage.ts` | 拿掉本地的 `asObject`，10 處呼叫改用 `asRecord` | 重複邏輯抽共用 |
| `electron/ipc/window-controls.ts` | 5 個 handler 的 `payload && typeof payload === 'object' ? … : {}` 改為 `recordOrEmpty(payload)` | 同上，陣列不再被當成物件 |
| `electron/ipc/pet-motion.ts` | drag-end 改為 `asRecord(payload)?.moved === true`；shimeji walk 改用 `recordOrEmpty` | 同上 |
| `electron/history-sessions.ts` | 查詢改用 `recordOrEmpty(input)`，cursor 改用 `asRecord(raw.cursor)` | 同上；cursor 原本沒排除陣列 |
| `electron/preload.ts` | `onServerHealthChanged`、`onPanelOpened` 改用 `asRecord` | 同上（preload 由 Vite 打包，沿用該檔不帶副檔名的 import 寫法） |
| `electron/transcript-turn-end.ts` | Codex 的 `record.payload as { type?: unknown } \| null` 改為 `asRecord(record.payload)?.type`；`turnEndFromTail` 的手寫守衛改用 `asRecord` | 拿掉沒檢查就斷言的寫法 |
| `electron/agent-adapter.ts`、`event-normalizer.ts`、`history.ts`、`permission-adapter-server.ts`、`permission-broker.ts`、`plugin-badges.ts`、`plugin-catalog-updates.ts`、`plugin-data-file.ts`、`plugin-panel-validation.ts`、`plugin-secret-consent.ts`、`plugin-settings.ts`、`presentation-controller.ts`、`safe-config-write.ts`、`session-jump.ts`、`ipc/panel-theme.ts`、`ipc/permission.ts`、`ipc/plugin-panel-ui.ts`、`ipc/project-mcp.ts`、`ipc/project-pets.ts`、`ipc/session-jump.ts`、`main/plugin-runtime.ts`、`main/runtime.ts` | 掃描找到的等價寫法（`!x \|\| typeof x !== 'object' \|\| Array.isArray(x)` 與 `x && typeof x === 'object' && !Array.isArray(x) ? x as Record : {}`）改用 `isRecord`、`asRecord`、`recordOrEmpty`，並刪掉守衛之後多餘的 `as Record<string, unknown>` | 原本就排除陣列，替換後行為完全相同 |
| `scripts/generate-ipc-inventory.mjs` | 「型別」偵測也認 `isRecord`、`asRecord`、`recordOrEmpty`，`isRecord` 不另列在 helper 欄 | 不改的話，安全清單有 5 列會從「型別」退回通用描述，驗證資訊變少 |
| `docs/security/ipc-inventory.md` | 重新產生；只有 `quota-usage` 一列多了新測試檔 | `tests/ipc-inventory.test.mts` 會比對產生結果 |
| `tests/quota-parsing.test.mts` | 新增 8 項 characterization：Codex／Claude 解析（字串數字、標籤、reset、32 個上限、scoped limits），以及端到端憑證流程（Codex refresh 寫回內容、API-key 模式、壞掉的 root、Claude 憑證檔的到期與方案） | 原本只有零星的解析測試，憑證讀取完全沒有覆蓋 |
| `tests/value-guards.test.mts` | 新增：三個守衛對 null、undefined、陣列、原始型別、函式、一般物件、`Object.create(null)` 的結果；`recordOrEmpty` 每次回傳新物件 | value-guards 有改動 |
| `tests/ipc-window-controls.test.mts`、`ipc-pet-motion.test.mts`、`history-sessions.test.mts`、`transcript-turn-end.test.mts` | 補斷言：payload 不是一般物件（包括帶了同名欄位的陣列）時，不觸發任何動作 | 固定陣列 payload 的新行為 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 B 一節 | 階段紀錄 |

### `quota.ts` 行為不變的細節

- `asRecord` 的判斷（`Boolean(value) && typeof value === 'object' && !Array.isArray(value)`）和原本 `asObject` 的 `value !== null && …` 結果相同：`typeof` 為 `'object'` 的值裡，只有 `null` 是 falsy。
- `coercedFiniteNumber` 等於原本的「`Number(x)` 再加 `Number.isFinite`」，字串 `"18000"` 一樣會被認得。它刻意留在 `quota.ts` 當本地函式：不和 `main/runtime.ts` 只收 `number` 的 `finiteNumber` 合併，也不放進 value-guards，免得 IPC 驗證誤用這個會轉型的版本。`duration === 18_000` 這類比較裡，原本的 `NaN` 現在變成 `undefined`，兩者都不等於任何常數，結果相同。
- 容錯、clamp、預設值、每個 provider 32 個視窗的上限、`requestJson` 的 endpoint 白名單與回應大小上限，全都沒改。
- 憑證讀取的欄位沒變：`OPENAI_API_KEY`、`tokens.access_token/accessToken`、`refresh_token/refreshToken`、`account_id/accountId`、`last_refresh`、`claudeAiOauth.accessToken/expiresAt/subscriptionType/rateLimitTier`。refresh 寫回的欄位也沒變：`last_refresh` 與 `tokens.access_token/refresh_token/id_token`，其他欄位原樣保留。characterization 測試直接比對寫回的整份 `auth.json`、refresh request body 和 Authorization header，改動前後都通過。

### 陣列 payload 的行為差異

下列地方原本只檢查 `typeof === 'object'`，沒有排除陣列：`window-controls.ts`（5 處）、`pet-motion.ts`（2 處）、`history-sessions.ts` 的 cursor、`preload.ts`（2 處）、`transcript-turn-end.ts` 的 Codex payload。改用 `asRecord`／`recordOrEmpty` 之後，陣列一律當成 `null` 或 `{}`。

- 這些地方後面只讀具名欄位（`ignore`、`release`、`height`、`width`、`pinned`、`modal`、`moved`、`deltaX`、`lastSeenAt`、`id`、`servers`、`restore`、`type`），不讀 `length` 也不讀索引。一般陣列本來就沒有這些欄位，讀到的一直是 `undefined`，所以行為不變。
- 唯一的差異：陣列上另外掛了同名欄位時（例如 `Object.assign([], { height: 40 })`，Electron IPC 的 structured clone 可能保留這種欄位），原本會被採用，現在會被忽略。這只會讓驗證更嚴格，不會放寬；正常的 renderer 不會送這種 payload。新增的測試固定了這個行為。
- `transcript-turn-end` 讀的是 `JSON.parse` 的結果，JSON 陣列不可能有具名欄位，所以完全等價。

### 掃描結果與刻意不換的地方

Haiku 掃描 `electron/**` 與 `integrations/**`（已知清單除外），共找到 79 處：`electron/` 74 處、`integrations/` 5 處。只替換語意與 `isRecord` 完全一致的 29 處，其餘不換：

- `integrations/*.mjs`（5 處）：這些是獨立執行的 hook 腳本，不能 import electron 檔案。
- `electron/setup.ts`（2 處）：屬於 C 階段的範圍。
- `error && typeof error === 'object' && 'code' in error` 這類錯誤碼判斷（約 20 處）：用途是把型別收窄成帶 `code` 的物件，不是讀 record；換掉反而會失去 `in` 帶來的收窄。
- `isJsonValue`（`plugin-broker.ts`、`plugin-ui-messages.ts`、`plugin-panel-view.ts`）：在這裡陣列是合法值。
- 原本沒排除陣列、換掉會改變語意的地方：`agent-adapter-operations.ts`、`desktop-notifications.ts`、`diagnostics/redact.ts`、`ipc/adapters.ts`、`ipc/pet-assets.ts`、`ipc/reliability.ts`、`ipc/history.ts:118`、`ipc/plugin-panel-ui.ts` 的 viewport、`main/panel-theme-cache.ts`、`main/db-recovery.ts`、`permission-adapter-server.ts:485` 等。這些不在本階段指定的清單內，不擴大範圍。
- `permission-audit.ts:40`：子代理換成 `isRecord` 之後，`vue-tsc` 報 TS2352。後面的 `value as PermissionAuditRecord` 原本是靠收窄成 `object` 才能成立，換成 `Record<string, unknown>` 就斷言不過去。要通過只能寫 `as unknown as`，等於掩蓋問題，所以還原成原樣。真正的修法是逐欄驗證 audit 紀錄，留作後續。
- `onboarding-state.ts`、`ipc/pets.ts`、`agent-adapter-operations.ts:38`、`history.ts:1389`：都是 `JSON.parse(...) as Record` 或 SQLite row 的斷言。這些要的是「補驗證」而不是「換守衛」，不在本階段範圍。

### Code review 結論

- **安全邊界**：IPC payload 仍在 main 做執行期驗證。每一處替換若不是完全等價，就是只讓陣列改成被拒絕（見上節），沒有任何一處放寬驗證。`preload.ts` 那兩處只是 renderer 端的形狀檢查，main 端的驗證沒有變動。`quota.ts` 讀取與寫回的憑證欄位都沒變，而且有測試固定。`plugin-secret-consent.ts` 拿掉的 `'accepted' in value`，在 `isRecord` 之後和 `value.accepted === true` 等價。
- **子代理產出複驗**：Sonnet 改的 23 個檔案逐一看過，修正了兩個問題。一是 `presentation-controller.ts` 有兩行重複的 value-guards import，已合併；二是 `permission-audit.ts` 的型別錯誤，已還原（見上節）。子代理自己重產的 IPC 清單，已改用修正後的產生器再產生一次。`ipc/permission.ts`、`ipc/project-pets.ts`、`ipc/plugin-panel-ui.ts`、`permission-adapter-server.ts` 留著 `const data = payload` 這類別名，用意是不動後面一長串欄位讀取；對可讀性影響小，所以不再擴大 diff。
- **規範**：electron 端的 import 一律帶 `.ts`，因為測試用 `--experimental-strip-types` 直接執行這些檔案；`preload.ts` 沿用該檔不帶副檔名的寫法。`value-guards.ts` 沒有任何 import，不會把相依帶進 `src/` 的測試閉包（本階段沒動 `src/**`）。新增的註解都用繁體中文，只寫原因。`plugin-host-assets.ts`、`plugin-panel-themes.ts`、`integrations/**`、`.claude/` 都沒動。
- 沒有 Liquid Glass 或其他視覺變更，不需要跑視覺閘門。

### 驗證

| 檢查 | A 之後 | B 之後 |
|---|---|---|
| `pnpm lint` | 0 error、49 warning（`no-explicit-any`） | 0 error、39 warning（全是 `no-explicit-any`，沒有其他種類）；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1812 項：1773 pass、0 fail、39 skip | 1823 項：1784 pass、0 fail、39 skip（新增 11 項：quota-parsing 8、value-guards 3；另有 4 個既有測試檔補了斷言） |
| `git diff --check` | 通過 | 通過 |

- `tests/quota-parsing.test.mts` 先在未修改的 `quota.ts` 上跑過，8/8 通過；改完後再跑，仍是 8/8。
- 第一次全量測試時 `ipc-inventory` 失敗，原因是安全清單文件和原始碼不同步。修正產生器並重新產生後，0 fail。

### 殘留風險

- Claude CLI 路徑（`readClaudeCliUsage`）沒有端到端測試，因為測試刻意清空 PATH，避免執行本機的 `claude`。這段只改了型別（`result?.result`、`result?.is_error`），正確性是靠型別檢查和閱讀程式碼判斷的。
- macOS Keychain 的憑證路徑沒有覆蓋：Claude 憑證檔的測試在 macOS 上會 skip，本機只在 Windows 上跑過。
- 陣列 payload 現在會被拒絕。如果有 renderer 呼叫端真的送陣列、又依賴陣列上的具名欄位，就會失效。已 grep 確認 preload 送出的都是物件字面值，但沒有啟動 app 實機驗證。
- `permission-audit.ts` 仍然是「確認是物件後直接斷言成 `PermissionAuditRecord`」，沒有逐欄驗證。這是既有問題，留給後續處理。

## C：`electron/setup.ts` 的 hook 設定 JSON 型別

- **分支**：`claude/cleanup-c-hook-json-types-c02d99`
- **開始時間**：2026-11-11 12:20（Asia/Taipei）
- **狀態**：通過
- **完成時間**：2026-11-11 12:28（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範，盤點 `codexHooksJson`、`claudeCodeHooksJson`、`mergeAgentPetsHooksFile` | 通過 | |
| 2 | characterization 測試（改動前先在原始碼跑綠） | 通過 | 逐位元組比對兩份新安裝的輸出 |
| 3 | 在 `hook-config.ts` 定義寫出用的嚴格型別，套用到 `setup.ts` | 通過 | 3 處 `any` 全數移除，merge 呼叫不需斷言 |
| 4 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit`、code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `electron/hook-config.ts` | 新增並 export 寫出用的嚴格型別 `HookCommandHandler`（`type: 'command'`、`command`、`args?`、`timeout?`、`statusMessage?`）、`HookMatcherEntry`（`hooks`、`matcher?`）、`AgentHooks<Event>`、`AgentHooksFile<Event>`，以及共用的 `agentHooksFor(events, entry)`；`mergeAgentPetsHooksFile` 的 `desired` 從 `Record<string, unknown[]>` 收緊為 `Readonly<Record<string, readonly HookMatcherEntry[]>>` | 產生端有明確契約；讀使用者檔案用的寬鬆 `HookEntry` 保持不變、不混用。merge 的執行期行為沒變（仍只取每個事件的第一個 entry） |
| `electron/setup.ts` | `CODEX_HOOK_EVENTS`、`CLAUDE_CODE_HOOK_EVENTS` 加 `as const`，由它們推導 `CodexHookEvent`、`ClaudeCodeHookEvent`；`codexHooksJson()` 回傳 `CodexHooksFile`，`claudeCodeHooksJson()` 回傳 `AgentHooksFile<ClaudeCodeHookEvent>`；`const entry: any` 加上事後補 `matcher` 的寫法，改成一次回傳 `HookMatcherEntry`（條件展開 `matcher`，鍵順序與原本相同）；`CLAUDE_CODE_ORIGINAL_EVENTS`、`CLAUDE_CODE_TOOL_EVENTS`、`CLAUDE_CODE_HOOK_TIMEOUTS`、`CLAUDE_CODE_UPGRADE_EVENTS` 改用事件聯集型別；Codex 的 description 抽成 `CODEX_HOOKS_DESCRIPTION`，安裝與移除共用；拿掉多餘的 `newHooks` 中間變數 | 移除 3 處 `any`；事件名拼錯會在編譯期被抓到；description 原本在兩處手寫，改一處就可能讓移除時認不出自己寫的檔案 |
| `tests/setup-install.test.mts` | 新增 2 項 characterization：新安裝的 `settings.json` 與 `hooks.json` 逐位元組比對（事件順序、`matcher` 只在 4 個工具事件且排在 `hooks` 之後、`timeout: 135` 只在 PermissionRequest、Codex 的 `description` 在 `hooks` 前、`statusMessage`、Windows／POSIX 的 command）；既有的事件清單測試放寬成 `readonly string[]` 來查詢 | 原本只檢查部分欄位，鎖不住鍵順序與完整輸出；改動前先在原始碼跑綠 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 C 一節 | 階段紀錄 |

### Code review 結論

- **外部契約**：兩份 dotfile 的輸出逐位元組不變，由新的 characterization 測試固定（改動前後都通過）。`as const` 只影響型別，執行期仍是同一個陣列；`hook-literal-contract` 用 regex 讀 `const CODEX_HOOK_EVENTS … = [...]` 的寫法也不受影響。
- **安全邊界**：寫入哪些檔案、寫入順序、`withConfigConflictRetry` 的衝突重試、`ConfigRefusedError` 的拒絕條件都沒動。`CODEX_HOOKS_OWNED_TOP_LEVEL` 的值與原本完全相同，移除時仍認得自己寫的 `description`。
- **斷言**：傳給 `mergeAgentPetsHooksFile` 的 `hooks` 與 `defaults` 都不需要 `as`；`{ description: string }` 是 type alias，解構後直接符合 `JsonObject`。唯一的 `as` 在 `agentHooksFor` 裡：`Object.fromEntries` 的回傳型別會丟掉鍵的聯集，而鍵就是傳入的事件清單本身，已用註解說明。
- **範圍**：OpenCode plugin 範本字串裡的 `event.type` 分支鏈（D 階段）沒動。動到的函式附近沒有三層以上的 `if`/`else if`。升級路徑 `upgradeClaudeCodeHooksUnlocked` 與安裝路徑對 matcher／timeout 的判斷仍各寫一次；兩者產出的形狀不同（`RequiredHookEntry` 與 `HookMatcherEntry`），合併的收益小，所以不擴大 diff。
- **環境**：worktree 原本沒有 `node_modules`，先執行 `pnpm install --frozen-lockfile --prefer-offline`（沒有改動 lockfile）。本階段沒有派子代理，全部自行實作與複驗。

### 驗證

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint` | 0 error、36 warning，全部是 `no-explicit-any` 且都在 `tests/`（`setup.ts` 的 3 個已清除）；main-process lint passed |
| `pnpm test:unit` | 1825 tests、1786 pass、0 fail、39 skip（比基準多 2 項 characterization） |
| hook 相關測試（`setup-install`、`hook-literal-contract`、`hook-config`、`claude-permission-hook`、`config-write-conflict`） | 90 tests、87 pass、0 fail、3 skip |

### 殘留風險

- characterization 測試只在當前平台跑一種 command 形式（Windows 走 `.cmd` wrapper，POSIX 走 node + 腳本）；另一個平台的字串仍由既有的 `codexHookCommand` 測試覆蓋。
- `agentHooksFor` 內的斷言依賴「鍵等於傳入的事件清單」；若日後在裡面加入過濾邏輯，需同步調整型別。

## D：風格統一（分支鏈、重複常數、IPC channel、多餘別名、scoped CSS 抽檔）

- **分支**：`claude/cleanup-d-style-unify-c9c4d9`
- **開始時間**：2026-11-11 12:33（Asia/Taipei）
- **狀態**：通過（未開始 → 進行中 12:33 → 通過 12:52）
- **完成時間**：2026-11-11 12:52（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範，盤點選單、範本、常數、channel、別名、CSS | 通過 | |
| 2 | 選單 handler map 與分支鏈掃描 | 通過 | haiku 子代理掃描，sonnet 子代理改寫 10 處，每處 diff 都由我複驗 |
| 3 | OpenCode plugin 範本 `switch` 與測試 | 通過 | 先補一項執行產出 plugin 的 characterization 測試，改寫前後都通過 |
| 4 | 重複常數、IPC channel 字面值、多餘別名 | 通過 | |
| 5 | `PermissionBubble` scoped CSS 抽檔 | 通過 | 建置後的 CSS 與基準逐條相同（scope hash 除外） |
| 6 | 全套驗證與 code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `src/components/ui/ActionMenu.vue` | 改成泛型元件 `generic="Id extends string = string"`；`ActionMenuItem<Id>`、`items: readonly ActionMenuItem<Id>[]`、`select: [id: Id]` | 讓呼叫端從選單定義推導 id 聯集。預設是 `string`，其他呼叫端不受影響 |
| `src/components/StatusPanel.vue` | `onHeaderMenu` 改為 `HEADER_MENU_ACTIONS` handler map（`satisfies Record<HeaderMenuId, () => void>`），`HeaderMenuId` 由 `headerMenuItems`（`as const satisfies readonly ActionMenuItem[]`）推導；主題標籤與圖示的 3 段巢狀三元改成 `THEME_LABEL_KEY`／`THEME_ICON` 查表（`satisfies Record<ThemePreference, …>`） | §4 B／C。漏寫 handler 或選單 id 打錯都會在編譯期報錯。已實測：刪掉一個 handler，或讓 handler 只接受部分 id，`vue-tsc` 都會失敗 |
| `src/components/plugin-panel/PluginCard.vue` | `onMenu` 改為 `MENU_ACTIONS` handler map，`MenuId` 由 `menuItems` 推導 | 同上 |
| `src/components/panel-theme/MyPanelThemes.vue` | 既有的 `MENU_ACTIONS: Record<string, …>` 收窄為 `satisfies Record<MenuId, …>`，模板拿掉多餘的 `?.` | ActionMenu 改成泛型後，這裡不必另外改寫就能得到窮盡檢查 |
| `electron/setup.ts` | OpenCode plugin 範本的 `event.type` 分派改成 `switch`；`session.status` 內 3 個獨立的 `status.type` 比對改成巢狀 `switch`（`busy`／`retry` 共用一個 case） | §4 A。三個值互斥，所以原本 3 個獨立的 `if` 與 `switch` 等價 |
| `tests/opencode-plugin.test.mts` | 新增 characterization：在行程內攔截 `fs.readFileSync`（token）與 `http.request`，實際執行產出的 plugin，依序送入 12 種事件，比對送出請求的路徑、`state`、`originalEvent`、`sessionId` 與順序 | 原本只驗模組能否載入和幾段字串，沒有鎖住分派語意。改寫前先跑過一次確認通過；把 `session.error` 刻意改成 `idle` 時，測試會失敗 |
| `electron/history.ts`、`electron/plugin-catalog.ts`、`electron/pet-sprite-validation.ts`、`electron/plugin-host-window.ts`、`electron/main/runtime.ts`、`electron/plugin-panel-themes.ts`、`electron/desktop-preferences.ts`、`electron/pet-window-mode.ts`、`src/utils/plugin-panel-view.ts`、`src/components/status-panel/SettingsDesktop.vue`（2 處） | 11 處「同一個變數比對 3 個以上離散值」的 `if` 鏈改成 `switch`。fallback 都保留，寫成 `default` 或留在 switch 之後原本的 return | §4 A。這些鏈都有 fallback，或各分支有副作用，用 switch 比查表直接。key 型別是 `string` 的地方不用物件查表，避免 `constructor` 之類的繼承 key 被誤中 |
| `tests/panel-theme-runtime.test.mts` | 比對原始碼的 regex 從 `url.hostname === 'panel-theme'` 改為 `switch (url.hostname) { … case 'panel-theme':` | runtime 的 protocol handler 改成 switch。這項測試要保護的「panel-theme host 只在主視窗處理」不變 |
| `electron/permission-audit.ts`、`electron/permission-broker.ts` | `MAX_AUDIT_RECORDS` 只在 permission-audit 留一份並 export，broker 改為 import | 兩邊保留的是同一份稽核紀錄 |
| `src/utils/pet-id.ts`、`src/utils/storage-keys.ts`、`electron/{achievements,history,progression,project-routing}.ts`、`electron/main/{growth-service,runtime}.ts`、`electron/ipc/{history,progression}.ts` | `DEFAULT_PET_ID` 移到 `pet-id.ts`。主程序本來就對這個檔案做值 import，它也在測試閉包內，只用相對路徑。`storage-keys.ts` 改成 re-export。主程序裡 5 份重複定義與 6 處 `'aang-airbender'` 字面值都改用這個常數 | 名稱、值、語意都相同（永遠存在的預設寵物） |
| `electron/event-normalizer.ts`、`electron/{achievements,history,local-usage}.ts`、`electron/ipc/session-jump.ts` | `MAX_TOKEN_COUNT`（原本 4 份）、`MAX_SESSION_ID_LENGTH`（原本 3 份）改由事件入口 `event-normalizer.ts` export | 下游不該接受入口已經拒收的值 |
| `electron/progression.ts`、`electron/history.ts` | `MAX_ACTIVE_GAP_MS` 由 progression export，history 改為 import | 兩邊計算的 session 活躍時長必須一致 |
| `electron/session-jump.ts`、`electron/main/session-snapshot.ts` | `MAX_AGE_MS = 45 * 60_000` 改為 `SESSION_REMOVE_MS`（`src/utils/session-lifecycle.ts`，也就是 `AGENT_STATE_POLICY.offline.quiet.afterMs`） | 兩處註解都寫「對齊 renderer 的移除時限」，數字卻各自寫死 |
| `electron/event-server.ts`、`electron/plugin-host-window.ts` | `'agent-status-event'`、`'plugin-host-port'` 改用 `IPC_CHANNELS.agentStatusEvent`／`IPC_CHANNELS.pluginHostPort` | 全面掃描後，只找到這 2 處 channel 字面值 |
| `electron/ipc/permission.ts` | 拿掉 `const data = payload`；兩段都回傳 `invalid_decision` 的守衛合併成一段 | 多餘別名 |
| `electron/ipc/plugin-panel-ui.ts`、`electron/ipc/project-pets.ts` | 拿掉 `const bounds = payload`、`const input = payload`，直接用 `payload` | 多餘別名 |
| `electron/permission-adapter-server.ts` | `normalizeCreatePayload`、`normalizeSessionLookupPayload`、`normalizeLookupPayload` 的參數直接命名為 `data`，在守衛那一行就收窄；同檔 `normalizeResultPayload` 原本用 `!value \|\| typeof value !== 'object'` 加 `as Record`，改成用 `isRecord(data)` 收窄 | 清掉多餘別名，以及動到範圍內的斷言。陣列本來就會在 `normalizeLookupPayload` 被擋下，所以行為不變 |
| `src/components/permission/PermissionBubble.vue`、`PermissionBubble.css`（新檔） | 258 行 `<style scoped>` 原封不動搬到同目錄的 `.css`，用 `<style scoped src="@/components/permission/PermissionBubble.css">` 引入 | §9。原本的樣式已經全部使用 token，沒有硬編碼的 hex／rgba 可以替換 |
| `tests/panel-theme-pet-status.test.mts`、`tests/pet-style-tokens.test.mts` | 讀取樣式的檔案清單加上 `PermissionBubble.css`，或改讀這個檔案 | 這些測試直接讀樣式原始碼 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 D 一節 | 階段紀錄 |

### 掃描結果與刻意不改的地方

- **分支鏈**：haiku 掃描 `src/**`、`electron/**`，找到 12 處符合條件。`PluginDetail.vue` 模板裡依 `section` 切換子樹的 `v-if`／`v-else-if` 保留：這是 Vue 模板的慣用寫法，模板裡也沒有 switch 可用。依 §4，條件混合不同變數的、複合條件的、只有 2 層的都維持原樣，例如 `PluginDetail.vue`／`PluginPanel.vue` 各 2 項的選單、`install-outcome.ts`、`PetBubbleStack.vue` 的模板。`electron/plugin-host-assets.ts` 內的 `String.raw` 範本是產出用的程式碼，不在範圍內。
- **常數**：以下不合併。`DAY_MS` 是單位換算，值不會漂移，共用只會增加耦合；`DWMWA_CLOAKED` 是 Win32 API 常數；`MAX_BODY_BYTES` 各處的值不同；`MAX_CONFIG_BYTES`、`RATE_WINDOW_MS`，以及 session-snapshot 與 session-jump 的 `MAX_ENTRIES` 屬於各自獨立的上限或快取，值相同只是巧合。
- **IPC inventory**：重新執行 `scripts/generate-ipc-inventory.mjs` 後，`docs/security/ipc-inventory.md` 沒有差異。它只解析 `IPC_CHANNELS.*` 的用法，而這兩處改動前後的 channel 名稱相同。
- **其他 `as Record<string, unknown>` 斷言**（`event-normalizer.ts`、`host-app.ts`、`src/stores/agent/*.ts` 等）：不在本階段動到的範圍內，B 階段已經評估過，這次不擴大 diff。

### Code review 結論

- **語意等價**：子代理的 switch 改寫逐處複驗過。每個 case 的提前 return、fallback、例外訊息與副作用順序都和原本相同。`runtime.ts` 的 protocol handler 只是把 `if` 換成 `case` 並重新縮排，已用 `git diff -w` 確認；`return await` 仍在 `try` 內，所以 catch 的行為不變。`desktop-preferences.ts` 把 `continue` 換成 `break`，布林 key 的檢查移到 `default`，驗證順序不變。lint 的 `no-fallthrough` 通過，沒有意外的 fallthrough。
- **寫到使用者機器上的檔案**：OpenCode plugin 範本只改了 `event` hook 內部的分派寫法，其他字元都沒動。新的 characterization 測試會實際執行產出的 plugin，鎖住 12 種事件各自送出的請求。`hook-literal-contract` 用 regex 收集的 `setState(..., '<state>'` 仍然是字面值，所以「每個 registry 狀態都有路徑可達」的檢查照常運作。
- **型別**：`ActionMenu` 的泛型推導在模板裡也有效：`@select` handler 的參數型別不對時，`vue-tsc` 會報錯，已實測。新的查表都加了 `satisfies Record<…>`，多一項或少一項都會編譯失敗。
- **安全邊界**：IPC sender 驗證、payload 守衛的條件與回傳的錯誤碼都沒變。`permission.ts` 合併的兩段守衛原本就回傳同一個錯誤。合併常數只是換了定義的位置，值沒有變。
- **測試閉包**：`pet-id.ts`、`session-lifecycle.ts` 都會被 Node 測試直接載入，新增的 import 都用相對路徑。`pnpm test:unit` 沒有出現 `ERR_MODULE_NOT_FOUND`。
- **範圍內順手修正**：`normalizeResultPayload` 原本手寫物件判斷再加 `as Record` 斷言，改成用 `isRecord` 收窄；`MyPanelThemes.vue` 的 handler map 也一併收窄。
- **流程事故**：為了比對 CSS，我在 scratchpad 用 HEAD 建了一個暫時的 worktree，並用 junction 連到本 worktree 的 `node_modules`。移除暫時 worktree 時，本 worktree 的 `node_modules` 被刪掉一部分。已用 `pnpm install --frozen-lockfile --prefer-offline` 重建，lockfile 與 package.json 都沒有變更。重建後全套檢查重跑，全部通過。原始碼與 git 狀態不受影響。

### 驗證

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint` | 0 error、36 warning，全部是 `tests/` 內的 `no-explicit-any`，與基準相同，沒有其他 warning；main-process lint passed |
| `pnpm test:unit` | 1826 tests、1787 pass、0 fail、39 skip（比基準多 1 項：OpenCode 事件分派 characterization） |
| `pnpm check:design` | `rawColors: 0`、`rawSpacing: 61`、`rawMotion: 24`、`rawControls: 0`，與 HEAD 基準完全相同 |
| `pnpm check:contrast` | 通過，輸出與 HEAD 基準逐字相同 |
| `pnpm exec vite build` | 成功。把建置出的所有 CSS 規則排序後比對，除了 scoped hash 以外，與 HEAD 的建置結果完全相同 |
| `node scripts/generate-ipc-inventory.mjs` + `tests/ipc-inventory.test.mts` | inventory 沒有差異；5 pass、0 fail |
| `tests/opencode-plugin`、`hook-literal-contract`、`local-wire-contract`、`setup-install` | 52 tests、51 pass、0 fail、1 skip |

### 殘留風險

- 沒有啟動 Electron 實機確認 `PermissionBubble` 的畫面。目前的依據是：建置後的 CSS 與基準相同，且 scoped 屬性選擇器已經套到 `.permission-request[data-v-…]`。仍建議在寵物視窗觸發一次權限請求，目視確認。
- 頁首選單（勿擾、保持開啟、主題）、插件卡片選單、我的主題選單只做了型別與建置驗證，沒有在實機上點過。
- OpenCode plugin 的 characterization 測試是在行程內攔截請求，沒有接上真的 OpenCode。與 OpenCode 事件格式的相容性仍靠既有的契約測試。
- `DEFAULT_PET_ID` 目前只在 `src/utils/pet-id.ts` 定義一次，`storage-keys.ts` 是 re-export。日後若有人在 storage-keys 又寫死一次，`tests/storage-keys.test.mts` 只驗值、不驗來源，抓不到。

## E：演算法與效能優化

- **分支**：`claude/cleanup-e-algorithm-perf-441068`
- **開始時間**：2026-11-11 12:55（Asia/Taipei）
- **狀態**：通過（未開始 → 進行中 12:55 → 通過 13:12）
- **完成時間**：2026-11-11 13:12（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範（§8）與相關檔案 | 通過 | |
| 2 | `plugin-feed` characterization 測試與 `addToCenter` 優化 | 通過 | 5 項新測試先在舊實作上跑過，改寫後也全過 |
| 3 | `SessionSnapshotStore.get` 與 turn-end watcher 改接 | 通過 | 2 項 watcher 測試先在舊實作上跑過；另加 1 項 `get` 測試 |
| 4 | 熱路徑掃描與評估 | 通過 | haiku 子代理掃描，候選項由我逐一讀原始碼複核。只改 `plugin-broker` storage 一處 |
| 5 | 全套驗證與 code review | 通過 | `bench:lag:check` 在本機超出門檻，原因與本階段無關，見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `electron/plugin-feed.ts` | `addToCenter` 拿掉 `map`+`filter` 建索引清單、迴圈內 `splice` 和索引修正，改成新增的 `trimPluginOverflow`：先數該 plugin 的筆數，超額時原地壓縮一次。總量修剪從 `while … shift()` 改成一次 `splice(0, overflow)` | 任務 1 |
| `electron/main/session-snapshot.ts` | 新增 `get(source, sessionId)`；抽出 `snapshotKey`、`cloneEntry`，讓 `record`／`list`／`get` 共用 | 任務 2 |
| `electron/main/turn-end-watcher.ts` | `TurnEndWatcherDeps` 新增 `session(source, sessionId)`；讀完檔後改用它重新取最新狀態 | 任務 2 |
| `electron/main.ts` | watcher deps 接上 `mainState.sessionSnapshot.get` | 任務 2 |
| `electron/plugin-broker.ts` | `PluginStorageState` 新增 `size`（序列化後的位元組數與筆數，第一次寫入時才算）。`storage.set`／`storage.remove` 改成只增減變動那一筆，並原地修改 `values`，不再每次 spread 複製 | 任務 3 掃描結果；同時修正 prototype key 的 bug（見下） |
| `tests/plugin-feed.test.mts` | 新增 5 項 retention characterization：單一 plugin 超額（含 read 狀態）、多 plugin 交錯、總量超額、兩種修剪同時觸發（鎖住先後順序）、clone 隔離；同時驗證 `onNotificationsChanged` 的呼叫次數 | 動手前先鎖行為 |
| `tests/turn-end-watcher.test.mts` | 新增：讀檔期間 state 改變不送 idle、讀檔期間 session 消失不送 idle、`SessionSnapshotStore.get` 的複本隔離與過期線；3 組 fake deps 補上 `session` | 同上 |
| `tests/plugin-broker.test.mts` | 新增：隨機 set／remove 序列的差分測試（3 個種子，每個 400 步，對照「寫入後整份 JSON 的 UTF-8 位元組數」參考模型，內容含多位元組字元、跳脫字元、單獨代理字元、數字 key）；剛好等於上限與多 1 byte 的邊界（含從磁碟載入的既有資料）；prototype key 回歸測試 | 同上 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 E 一節 | 階段紀錄 |

### 複雜度變化

n = center 筆數（≤ 500），k = 單一 plugin 筆數（≤ 100），S = 單一 plugin storage 序列化大小（預設 1 MiB，最大 50 MiB），v = 單次寫入的值大小（受 RPC 256 KB 上限限制）。

| 改動 | 改動前 | 改動後 |
|---|---|---|
| `PluginFeedController.addToCenter` | 時間：`map`+`filter` O(n)；超額 e 筆時，每筆要 `splice` O(n) 加索引修正 O(k)，所以是 O(n + e·(n+k))。總量修剪的 `shift` 每次 O(n)，共 O(n·g)。空間：兩個暫時陣列，O(n) | 時間：計數 O(n)，超額時一次壓縮 O(n)，總量修剪一次 `splice` O(n)，合計 O(n)，跟 e、g 無關。空間 O(1) |
| turn-end watcher 讀檔後重新取狀態 | `list()`：掃過期 O(m)、複製全部 entry O(m)、線性比對 O(m)；m ≤ 200（`MAX_ENTRIES`）。空間 O(m) | `get()`：Map 查詢 O(1)，只複製一筆。空間 O(1) |
| `PluginBroker` `storage.set`／`storage.remove` | 每次 spread 複製 O(keys)，再完整 `JSON.stringify` O(S)。空間 O(S) | 第一次寫入算一次 O(S)，之後每次 O(v + 舊值大小)。不複製物件，空間 O(v) |

說明：
- 在目前的不變式下（每次新增後都會修剪），e 與 g 最多是 1，所以 `addToCenter` 原本實際上已接近 O(n)。這次的收益是不再建立兩個暫時陣列、去掉迴圈內的 `splice`，最差情況也有界，不依賴不變式。
- **為什麼不維護 `Map<pluginId, count>`**：`center` 有 6 條修改路徑（新增、`markRead`、`markAllRead`、`clear`、依 plugin `clear`、兩種修剪），每條都要同步計數，漏一條就會刪錯紀錄，而且很難從測試看出來。n 上限只有 500，每次新增多掃一次的成本可以忽略。只在新增時線性掃描，正確性只要看一個函式就能證明，維護成本最低。
- **`get` 的過期語意**：照 `list()`。`lastSeenAt < now - MAX_AGE_MS` 的項目視為不存在，回傳 `undefined`，並同樣把它刪掉；剛好在線上的仍可見。這樣 watcher 用 `get` 和用 `list()` 看到的結果一致。介面用 `(source, sessionId)` 兩個參數，不用字串 key，讓 key 的組法只留在 store 內部。
- **storage 量測**（scratchpad 一次性腳本，不是 repo 內的 bench；以 200 KiB 一筆、改寫 1 筆量測）：1 MiB 從 1.02 降到 0.23 ms／次；10 MiB 從 11.6 降到 0.24 ms／次；50 MiB 從 58.7 降到 0.32 ms／次。`storage.set` 沒有速率限制，所以改動前，plugin 在大 storage 上連續寫入會持續卡住主程序。
- **增量計算為什麼精確**：物件的序列化結果是 `{` + 各筆 `"key":value` 用逗號分隔 + `}`，所以總長 = 2 + Σ 各筆長度 + (筆數 − 1)。key 與值的跳脫規則跟 `JSON.stringify(key)`、`JSON.stringify(value)` 單獨序列化時相同；`JSON.stringify(JSON.parse(s)) === s` 對 `JSON.stringify` 的輸出也成立。key 的順序不影響總長。差分測試把這幾點都實際跑過一次。

### 範圍內順手修正：storage 的 prototype key

原本每次寫入都用 `{ ...state.values }` 複製，結果 `loadStorage` 建立的 null-prototype 物件被換成一般物件。之後 `storage.get('toString')` 會得到 `{ found: false, value: <Object.prototype.toString> }`，而不是 `value: null`。改成原地修改後，`values` 一直保持 null-prototype。新增的回歸測試在舊實作上會失敗（已用 stash 只還原 `plugin-broker.ts` 確認），在新實作上通過。

### 評估過但決定不改

| 項目 | 不改的理由 |
|---|---|
| `PluginFeedController.clear(pluginId)` 在迴圈內反向 `splice` | 最差 O(n·k) = 500×100，只在使用者手動清除時觸發，頻率低，沒有量測依據 |
| `electron/history.ts` `getUsageBlocks`（每次最多 5 萬列） | 主要成本在 SQL 取列，排序對近乎有序的輸入接近線性。要改就得換成 SQL 聚合或快取，屬於行為層級的改動。目前沒有 bench 能量測，呼叫頻率是使用者開啟用量面板時才觸發 |
| `electron/local-usage.ts` `filesUnder` 對每個項目 `lstat` | 屬於 I/O 成本，不是演算法問題。append 不會改變目錄 mtime，不用 file watcher 就省不掉 stat。應該先用 `scripts/bench/local-usage-lag.mjs` 量測 |
| `electron/permission-broker.ts` `createRequest` 做 4 次全掃描、`expireDue` 每 400 ms 一次 | 每個 session 最多 20 筆進行中、200 筆終態紀錄，建立速率限制每分鐘 60 次，實際 n 很小 |
| `broadcast-coalescer`、`event-server`／`event-rate-limit`、`src/stores/agent/*`、`usePetStatusLines` | 已經是 amortized O(1)、有上限（≤ 200 sessions、≤ 8 佇列、≤ 2 providers），或已經有索引與快取 |
| 固定小白名單的 `includes`／`Set`、有上限陣列上的 `shift`（200、500、8） | conventions §8：沒有量測依據不做 |

### Code review 結論

- **`addToCenter` 淘汰順序**：先做單一 plugin 修剪，再做總量修剪，順序不變，並以註解說明原因。原地壓縮只會寫入已經走過的位置，所以邊迭代邊寫入是安全的。read 狀態跟著紀錄物件走，不會重建；`cloneFeedItem` 仍只在 push 時呼叫一次；`notifyNotificationsChanged` 每次新增仍只呼叫一次，測試驗證了呼叫次數與最後的 unread 值。
- **watcher**：「讀檔期間有新 hook 事件進來時以新事件為準」的判斷條件（`!current || lastSeenAt 不同 || state 不同`）原封不動，只是換了資料來源。開頭的 `deps.sessions()` 仍用 `list()`，因為需要整份清單來找候選項並清掉 `tracked`。
- **storage**：唯一的接受／拒絕條件仍是「寫入後的序列化位元組數 ≤ 上限」，差分測試涵蓋 1200 步、兩種結果都有。失敗的寫入（`too_large`、`invalid_request`）不會修改 `values` 或 `size`。`flushStorage` 寫檔前仍會完整 stringify 再檢查一次，即使計數出錯，也不會寫出超過上限的檔案。`size` 綁在 state 上，`removePlugin` 刪掉 state 時一併清掉；重新載入時是 `null`，會重新計算。`storage.get` 不受影響。
- **安全邊界**：RPC 驗證、key 白名單（`__proto__`／`prototype`／`constructor` 仍被拒絕）、容量上限的語意都沒變。prototype key 修正讓 plugin 拿不到宿主端的函式參考。
- **測試閉包**：沒有新增 src 執行期 import；新測試 import 的 `src/utils/session-lifecycle.ts` 本來就在閉包內。
- **流程備註**：本機的 `python` 是 Windows Store 空殼，一開始用它做的兩段編輯其實沒有生效。發現後改用 Edit 重做，並重新確認 characterization 測試確實先在舊實作上跑過，才套用實作改動。

### 驗證

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint` | 0 error、36 warning，全部是 `tests/` 內的 `no-explicit-any`，與基準相同；main-process lint passed |
| `pnpm test:unit` | 1837 tests、1798 pass、0 fail、39 skip（比基準多 11 項：plugin-feed 5、turn-end-watcher 3、plugin-broker 3） |
| `node --test tests/plugin-feed.test.mts tests/ipc-plugin-feed.test.mts` | 27 pass、0 fail |
| `node --test tests/turn-end-watcher.test.mts` | 12 pass、0 fail |
| `node --test tests/plugin-broker.test.mts` | 13 pass、0 fail、1 skip（既有的 file symlink skip） |
| `git diff --check` | 通過 |
| `pnpm bench:lag:check` | **超出門檻**：3 次都是 mean 15.5 ms（門檻 12 ms），p99 約 18 ms，max 20–24 ms。這個 bench 只量 `HistoryStore.recordEvent`。我用 module resolve hook 列出它載入的 20 個 repo 內模組，其中沒有本階段改過的檔案，所以結果與改動前相同。15.5 ms 和 Windows 預設 15.6 ms 的計時器粒度一致；baseline 是在 macOS 上量的（mean 5.43 ms，解析度 5 ms）。本機無法用這個 bench 判斷回歸，需要在 macOS 或 CI 上重跑，或另外替 Windows 建立 baseline |

### 殘留風險

- `bench:lag:check` 在 Windows 上一定會失敗。它目前無法作為這台機器的回歸門檻，建議之後替 Windows 另建 baseline，或改用高解析度計時。
- storage 的增量計數是新的不變式：日後若新增其他修改 `state.values` 的路徑，卻沒有同步更新 `size`（或把它設回 `null`），容量判斷就會偏掉。目前的防線是 `flushStorage` 寫檔前的完整檢查，以及差分測試。已在 `size` 欄位的註解說明。
- 沒有啟動 Electron 實機確認插件通知中心與 turn-end 補送 idle 的行為。依據是單元測試與差分測試。

## F：測試檔的 `any` 清零、`no-explicit-any` 升成 error

- **分支**：`claude/cleanup-f-tests-lint-7bf76c`
- **狀態**：通過

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範與 `pnpm lint` 現況 | 通過 | 36 個 warning，全在 `tests/` |
| 2 | 抽 `makeAgentStatusEvent` 並替換 | 通過 | 只有 `notification-policy`、`agent-state-registry` 語意相同，其他各自的 builder 維持原樣 |
| 3 | 比對假 ipcMain，抽 `createFakeIpcMain` | 通過 | 21 個測試檔改用；6 個寫法不同的維持原樣 |
| 4 | 清掉其餘測試檔的 `any` | 通過 | |
| 5 | `eslint.config.mjs` | 通過 | |
| 6 | 文件 | 通過 | 本節、檔案開頭的整輪總結、`phase-packaging-ci-lint-backlog.md` |
| 7 | 全套驗證與 code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 |
|---|---|
| `tests/support/agent-status-event.mts` | 新增 `makeAgentStatusEvent(state: AgentState, overrides?: Partial<AgentStatusEvent>): AgentStatusEvent`，預設值沿用 `notification-policy` 原本的 builder（codex、`session-1`、`agent-pets`、`Date.now()`） |
| `tests/support/fake-ipc.mts` | 新增 `createFakeIpcMain()`，回傳 `ipcMain`（型別為 `Pick<IpcMain, 'handle' \| 'on'>`）、`handlers`（`handle` 註冊）、`listeners`（`on` 註冊），handler 型別是 `(...args: unknown[]) => unknown` |
| `tests/notification-policy.test.mts` | 改用共用 fixture，14 處 `as any` 全部移除；state 參數現在是 `AgentState` |
| `tests/agent-state-registry.test.mts` | 通知表改用共用 fixture；故意餵入的非法狀態（`bogus`、`constructor`、`toString`）改用 `as AgentState`；permission notice 那個物件字面值直接傳入，不用斷言 |
| `tests/ipc-reliability.test.mts` | 改用 `createFakeIpcMain`；reports 用 `Parameters<ReliabilityIpcDependencies['reportRendererError']>[0]`；`stack` 是選填欄位，改成 `stack?.length`（斷言值不變，缺欄位時一樣會失敗） |
| `tests/ipc-*.test.mts`（18 個）、`tests/growth-maintenance.test.mts`、`tests/onboarding.test.mts` | 手寫的 `handlers = new Map…` 加上 inline `ipcMain` 改用 `createFakeIpcMain()`；5 個 plugin IPC 測試順便移除 `ipcMain` 上的型別斷言 |
| `tests/progression-broadcast-gate.test.mts` | `snap(over: Partial<ProgressionSnapshot>): ProgressionSnapshot`；`createVisibleSender<DeferrableWindow>()`；空陣列斷言改成 `[] as number[]` |
| `tests/presentation-mcp.test.mts` | `call<T = unknown>()`，status 與 intent 回應分別收窄成 `PresentationStatusSnapshot & { queueDepth }`、`PresentationIntentResult` |
| `tests/presentation-stdio.test.mts` | 新增 `JsonRpcResponse<T>`；`waitForId<T>()` 依各呼叫收窄成 `serverInfo`、`tools`、`PresentationStatusSnapshot`、`PresentationIntentResult` |
| `tests/panel-theme-user-ipc.test.mts` | `invoke` 回傳 `unknown`；新增 `validate`／`user`／`userAsync`／`theme`，各自斷言成協定的 result 型別（`PanelThemeValidateIpcResult`、`UserPanelThemeIpcResult`、`PanelThemeIpcResult`）；讀 `value`／`error` 前先用 `okValue()`／`failure()` 斷言分支 |
| `tests/panel-theme-user.test.mts` | 非法定義案例改用 `Record<string, unknown>` 與 `node(definition, ...keys)` 取巢狀物件；canonical 顏色那個測試直接用 `UserPanelThemeDefinition` |
| `tests/diagnostics-logger.test.mts` | `Record<string, unknown>`，巢狀物件另外收窄 |
| `tests/sound-registry.test.mts` | `(globalThis as { window?: unknown }).window` |
| `eslint.config.mjs` | `no-explicit-any` 升成 `'error'`，刪除「先以 warn 記錄存量」的註解；全域 `ignores` 加上 `.claude/**`、`.playwright-mcp/**`；`src/env.d.ts` 的豁免不變 |
| `docs/phase-reports/phase-packaging-ci-lint-backlog.md` | 存量已清零、規則已升成 error |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 開頭的整輪總結與本節 |

### event builder 比對結果

| 測試檔 | 預設值 | 處理 |
|---|---|---|
| `notification-policy` | codex、`session-1`、`agent-pets`、`Date.now()`，`(state, overrides)` | 改用共用 fixture（fixture 就是照它寫的） |
| `agent-state-registry` | 內聯 `base`（codex、`s1`、`p`、1） | 改用共用 fixture，覆寫 sessionId／project／timestamp |
| `progression`、`achievements` | codex、無 project，timestamp 與 sessionId 是位置參數 | 不改：預設沒有 project，參數形狀也不同；硬套會在每個呼叫點補 `project: undefined` |
| `history-sessions`、`session-jump` | claude、帶 `adapterId`（session-jump 還帶 `host`），只收 overrides | 不改：預設值不同 |
| `agent-store-characterization` | claude，`(sessionId, state, extra)` | 不改：參數形狀與預設都不同 |
| `attention-tracker` | 只有 source／sessionId／state 三個欄位 | 不改：不是完整事件 |

### 假 ipcMain 比對結果

改用 `createFakeIpcMain` 的條件：`Map<string, (...args: unknown[]) => unknown>`，`ipcMain` 只把 handler 原樣存進 map。`handle` 與 `on` 分開存的（`ipc-reliability`、`ipc-plugin-panel-ui`）也符合，同樣改用。以下 6 個寫法不同，維持原樣：

| 測試檔 | 不同之處 |
|---|---|
| `ipc-panel-theme`、`panel-theme-user-ipc` | `handle` 和 `on` 存進同一個 map，測試用同一個 map 查兩種 channel |
| `ipc-window-controls` | `on` 註冊的 listener 存在名為 `handlers` 的 map，呼叫點依賴這個名字 |
| `ipc-pet-motion`、`pet-context-menu` | listener 存成 `(event, payload?) => void` 等較窄的簽名，呼叫點依賴這個型別 |
| `ipc-pets` | `handle: () => undefined`，根本不存 handler |

### Code review 結論

- **斷言沒有放寬**：替換前後每個 `assert` 的比較值相同。`panel-theme-user-ipc` 的 `okValue()`／`failure()` 只是多一個 `ok` 分支斷言，比原本嚴格。`stack?.length`、`validation?.valid`、`schemaError?.path` 遇到缺欄位時會得到 `undefined`，跟期望值不相等，一樣會失敗。
- **沒有新增 `as never`**：diff 裡新增的行沒有 `as never`，也沒有 `any`。保留的型別斷言都是把 `unknown` 收窄成協定型別，或是故意餵入非法值（`as AgentState`、`node()`）。`fake-ipc.mts` 有一處 `as unknown as Pick<IpcMain, …>`：Electron 的 `on` 回傳 `this`（完整的 `IpcMain`），假物件只實作兩個方法，已用註解說明。
- **測試閉包**：兩個新的 support 檔都只有 `import type`，不會讓 Node 測試多載入 src 執行期模組。
- **`createVisibleSender` 的型別參數**：任務原本寫 `createVisibleSender<ProgressionSnapshot>()`，但它的型別參數是視窗型別（`W extends DeferrableWindow`），`ProgressionSnapshot` 不符合約束，所以改用 `DeferrableWindow`。
- **`.claude/**` 的忽略範圍**：ignore pattern 以設定檔所在目錄為基準，所以主 checkout 會跳過 `.claude/worktrees/*`。從 worktree 內執行時，基準是 worktree 根目錄，自己的檔案照常檢查（本 worktree 的 `pnpm lint` 有掃到 tests 的變更可以佐證）。

### 測試的型別檢查（額外量測）

`tsconfig.json` 只 include `src/**` 與 `electron/**`，`vue-tsc` 不會檢查 `tests/`。為了確認 F 的型別真的正確，我用臨時 tsconfig（extends 專案設定、include `tests/**/*.mts`，量完即刪）跑 `tsc --noEmit`，並把改動前的檔案放在同層目錄跑一次做對照：

- F 動到的 30 個測試檔：改動前 74 個錯誤，改動後 52 個。沒有新增，修掉 22 個（都是手寫假 ipcMain 的型別不相容，以及 `progression-broadcast-gate` 的 `never[]` 收窄）。
- 剩下的錯誤都是既有的：假物件沒有實作完整的 `BrowserWindow`、`HistoryStore` 等型別。這些超出本階段範圍，記在殘留風險。

### 驗證

| 指令 | 結果 |
|---|---|
| `pnpm lint` | 0 error、0 warning；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm test:unit` | 1837 tests、1798 pass、0 fail、39 skip，與 E 結束時相同 |
| `pnpm test:unit`（commit 前再跑 4 次） | 第 1 次 1831 tests、2 fail、38 skip；之後 3 次都是 1837 tests、0 fail、39 skip |
| F 動到的 30 個測試檔單獨跑 3 次 | 每次 124 tests、0 fail、0 skip |
| `git diff --check` | 通過 |

### 殘留風險

- `tests/` 仍不在型別檢查範圍內，測試的型別只靠 `no-explicit-any` 與 code review 把關；既有的假物件型別錯誤還在。
- 改用共用 fixture 後，`makeAgentStatusEvent` 的預設值變成多個測試的共同依賴；日後改預設值時，要重新檢查 `notification-policy` 的 body 斷言（`agent-pets`）。
- commit 前的全量測試出現過一次偶發失敗（1831 tests、2 fail、38 skip）：有一個測試檔整個沒跑完，少了 6 項測試和 1 項 skip。F 動到的測試檔都沒有 skip，所以出錯的檔案不在本階段範圍內；但當次輸出沒有保留下來，無法指出是哪個檔案。之後 3 次全量都正常。若再出現，要保留完整輸出再追查。
- 沒有啟動 Electron。本階段只改測試與 lint 設定，產品程式碼沒有變動。

## F2：複驗發現的既有問題（不穩定測試、`tests/` 型別檢查）

- **分支**：`claude/cleanup-f2-flaky-test-types-4fd907`
- **開始時間**：2026-11-11 13:45（Asia/Taipei）
- **完成時間**：2026-11-11 15:35（Asia/Taipei）
- **狀態**：通過

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、量測現況 | 通過 | 臨時量測的 52 個錯誤只涵蓋 F 動到的檔案；全部 `tests/` 實際是 178 個 |
| 2 | 計時測試改成負載下穩定的判斷 | 通過 | 起初處理 `panel-theme-diagnostics`、`panel-theme-palette`；驗證時在高負載下又重現 6 個，逐一修正 |
| 3 | 重現「整個測試檔沒跑完」並修根因 | 通過 | 高負載壓測重現 `rmSync` 的 `EPERM` |
| 4 | 新增 `tsconfig.tests.json`，修完型別錯誤 | 通過 | 178 → 0；四個子代理分組修正，我複核並補修 |
| 5 | 接進 `pnpm lint` 與 CI | 通過 | |
| 6 | code review、連續 5 次全量驗證、文件 | 通過 | 另加 6 次 3 倍負載的全量 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `tests/support/fs-capabilities.mts` | symlink 探測的清理改用 `removeTempTree`，失敗時吞掉 | 根因：探測在 import 時執行，`rmSync` 遇到 Windows 檔案鎖拋 `EPERM` 會讓整個測試檔失敗 |
| `tests/support/temp-dir.mts`（新增） | `removeTempTree`／`removeTempTreeAsync`：`rmSync` 加 `maxRetries: 10, retryDelay: 20` | 同上，所有測試共用 |
| 59 個 `tests/*.test.mts` | 164 處 `fs.rmSync(x, { recursive: true, force: true })`（含 `pet-assets-fs` 的 async `rm`）改用 `removeTempTree` | 同一個檔案鎖問題在測試內會讓單一 test 偶發失敗；5 個檔案移除不再使用的 `rmSync` import |
| `tests/panel-theme-diagnostics.test.mts` | 絕對門檻 `best < 30 ms` 改成與逐格搜尋交錯量測的比值 `< 0.1`，並以 `t.diagnostic` 印出實測值 | 計時不穩定 |
| `tests/panel-theme-palette.test.mts` | 絕對門檻 `< 2000 ms` 改成用 `Proxy` 數讀取的像素值，斷言 `≤ IMAGE_MAX_SAMPLES × 4`，不再量時間 | 舊門檻離取樣失效時的 2469 ms 太近；改用比值後在 3 倍負載下仍失敗一次 |
| `tests/plugin-developer-mode.test.mts` | 合併測試的 debounce 200 ms 改 1 秒，等待依它推算 | 高負載驗證時重現失敗 |
| `tests/presentation-stdio.test.mts` | 2 秒逾時改成 `BRIDGE_TIMEOUT_MS = 15_000` | 高負載驗證時重現逾時 |
| `tests/support/node-startup.mts`（新增） | `nodeStartupBaselineMs`、`withStartupBaseline`（hook 前後各量一次基準取較大值），從 `agent-hook-delivery` 移出，兩個 hook 測試共用 | |
| `tests/claude-permission-hook.test.mts` | 「沒有標記不重試」改成權限埠整段關著、以相對基準的耗時判斷；抽出 `hookEnv` | 高負載驗證時重現失敗 |
| `tests/quota-forecast.test.mts` | 線性時間測試改成 3 次取最快、門檻 5 秒，並在註解寫明與平方退化的差距 | 高負載驗證時重現失敗 |
| `tests/agent-hook-delivery.test.mts` | 改用 `withStartupBaseline`；busy app、cut／stall、never-opens 的上限改成兩倍基準加餘裕；app 延遲 3 秒改 8 秒（計時器 `unref`）；四個計時斷言加 `t.diagnostic` | 驗證時重現兩次失敗：stall 3229 ms（門檻 2879 ms）、never-opens 8066 ms（基準 314 ms） |
| `tsconfig.tests.json`（新增） | extends `tsconfig.json`，include `tests/**/*.mts` 與 `src/env.d.ts`，`allowJs`（讀 `scripts/*.mjs` 的推斷型別）、`noEmit`、獨立的 `tsBuildInfoFile` | `tests/` 沒有型別檢查 |
| `package.json` | 新增 `typecheck:tests`（`tsc -p tsconfig.tests.json`），接在 `lint` 最後 | CI 的 `pnpm lint` 會一起跑；`build` 不變 |
| `.github/workflows/ci.yml` | lint 步驟的註解寫明含 tests 型別檢查 | |
| `electron/dev-runtime.ts`、`vite.config.mts`、`tests/dev-runtime.test.mts` | `GPU_SAFE_DEV_MODE`、`electronDevArgv`、`electronDevEnvironment` 從 `vite.config.mts` 移到 `electron/dev-runtime.ts`，測試改從這裡 import | 測試 import `vite.config.mts` 會經由 vite 的宣告檔帶進第二份 `@types/node`（26.1.1，專案是 24.13.3），在 `electron/` 與測試產生 27 個假錯誤 |
| `tests/support/fake-electron.mts`（新增） | `fakeBrowserWindow`／`fakeWebContents`／`fakeIpcMainEvent`／`fakeIpcMainInvokeEvent`，參數是 `Partial<…>` | 原本各檔各自 `as unknown as BrowserWindow`，或用字串當事件哨兵 |
| `tests/support/fake-service.mts`（新增） | `fakeService<T>(members: Partial<Record<keyof T, unknown>>)` | 帶私有欄位的服務 class 假物件；鍵名仍受檢查。取代 5 個檔案各自複製的 `asService` 與 12 處逐點轉型 |
| 其餘約 40 個 `tests/*.test.mts` | 修正型別錯誤，見下方「型別錯誤的處理」 | |
| `.agents/skills/pet-skill/references/build-environment.md` | Lint 一節：`typecheck:tests`、`no-explicit-any` 已是 error、測試假物件與暫存目錄 helper、不要讓測試 import `vite.config.mts` | |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 本節、開頭的整輪總結與殘留風險 | |

### 根因分析

#### 1. 整個測試檔沒跑完（1831 tests、2 fail、38 skip）

- **哪個檔案**：用自訂 reporter 依檔案統計，執行期剛好「7 個 test、1 個 skip」的只有 `tests/panel-theme-store.test.mts`。Node 24 的 `node --test` 在測試檔 import 階段丟出例外時，會把整個檔案記成 1 個失敗，檔內的 test 全部不計：1837 − 7 + 1 = 1831，skip 39 − 1 = 38，完全吻合。另一個 fail 是同一次的計時測試。我用一個 import 時就丟錯的檔案重現了這個計數方式。
- **為什麼 import 會失敗**：`panel-theme-store` import 了 `tests/support/fs-capabilities.mts`，它在 import 時建一個暫存目錄探測能否建立 symlink，最後在 `finally` 裡 `fs.rmSync(directory, { recursive: true, force: true })`，沒有重試，也沒有 catch。
- **重現**：16 個行程平行、各跑 400 次同樣的探測，6400 次裡 `rmSync` 拋了 2 次 `EPERM, Permission denied`（剛建立的檔案被 Windows 的防毒或索引服務短暫鎖住）。加上 `maxRetries: 10, retryDelay: 20` 後，同樣 6400 次是 0 次。
- **為什麼當時沒有線索**：stack 只印在 stderr 的早段，結尾的失敗摘要只有一行 `'test failed'`，不會顯示原因。
- **修法**：探測的清理改用有重試的 `removeTempTree`，且吞掉錯誤（重試後仍刪不掉，只會在暫存目錄留下一個空目錄；import 不能失敗）。同樣的 `rmSync` 寫法在 59 個測試檔裡還有 164 處，失敗時會讓單一 test 偶發失敗，所以一併改用 `removeTempTree`。這是測試的問題，受測程式碼沒有 bug。
- **另一個候選**：`safe-config-write-async.test.mts` 執行期是 6 個 test、1 個 skip，跟缺少的數字對不上，排除。

#### 2. 計時斷言

| 測試 | 原本 | 實測 | 處理 |
|---|---|---|---|
| `panel-theme-diagnostics` worst-case | best-of-5 `< 30 ms` | 單獨約 4–5 ms；全量平行時曾 33.3、48.8 ms | 改成相對比值。分母是同一個測試檔裡的逐格搜尋 `exhaustiveSuggestion`（改寫前演算法的參考答案），兩邊交錯量測、各取最快一次。分子取 15 次樣本，分母取 3 次 |
| `panel-theme-palette` 大圖取樣 | 單次 `< 2000 ms` | 30–160 ms；故意讓取樣失效（stride = 1）時 2469 ms | 先改成 1024×768 和 128×128 的比值 `< 6`（正常 0.4–1.9，取樣失效 60.7），但 3 個全量同時跑時比值曾到 20.7：大圖是 3 MB 的跨步讀取，被記憶體頻寬爭用拖慢的程度遠大於放得進快取的小圖，兩邊受負載影響並不對稱。最後改成不量時間，用 `Proxy` 數讀取的像素值，斷言 `≤ IMAGE_MAX_SAMPLES × 4`。結果是確定的；取樣失效時讀了 3,145,728 次，測試失敗（已實測） |
| `agent-hook-delivery` busy app、cut／stall | `baseline + 2_000` | 驗證時重現失敗：stall 3229 ms、基準 879 ms | 原本就和 node 啟動基準比，但 hook 載入的模組比空程序多，高負載時多出的時間跟著基準放大（實測多 0.3–2.3 秒）。改成 `baseline * 2 + 2_500`，和既有的 pet-closed 測試同一個原則。busy app 的 app 延遲從 3 秒改 8 秒：基準在 5.5 秒內，若 hook 改成等 app 回答一定超過上限 |
| `agent-hook-delivery` never opens | `baseline + 6_500` | 驗證時重現失敗：基準 314 ms，hook 8066 ms | 基準在 hook 之前量，剛好量到負載空檔，hook 執行期間負載又升高。改成前後各量一次取較大值（四個計時測試都用），上限改成 `baseline * 2 + 6_500` |
| `agent-hook-delivery` pet closed | `baseline * 2 + 1_500` | 高負載下最大 3062 ms，門檻 6264 ms | 原本就是兩倍基準，只改用前後量測的基準；加 `t.diagnostic` |
| `history` v6/v7 migration | `< 10_000 ms` | 600 ms（16 倍餘裕） | 不改：沒有可當分母的舊做法，且餘裕夠大 |
| `claude-permission-hook` 沒有標記時不重試 | 權限埠 2.5 秒後才開，預期 hook 早已結束、收不到請求 | 3 個全量同時跑時失敗一次：hook 啟動得比開埠還晚，第一次請求就直接成功 | 時序假設失效。改成權限埠整段關著，用耗時判斷：誤開重試會等到 5 秒，上限 `baseline * 2 + 1_500`（基準前後各量一次） |
| `claude-permission-hook` 其餘 | `< 15_000`、`>= 4_500 && < 12_000` | 下限不受負載影響；上限是 1–5 秒等待加啟動 | 不改：上限遠大於負載造成的放大 |
| `quota-forecast` 20 萬筆樣本 | 單次 `< 500 ms` | 正常 1–2 ms；3 個全量同時跑時失敗一次 | 要擋的是退化成平方（4×10¹⁰ 次運算，至少數十秒）。比值不可行：數字在 1 ms 上下，比值被計時解析度與 GC 主導。改成 3 次取最快、`< 5_000 ms`，對平方退化仍差兩個數量級 |
| `presentation-stdio` 等 MCP 回應 | 每個回應、子行程結束各等 2 秒 | 3 個全量同時跑時，3 次中有 2 次 `Timed out waiting for MCP response 1` | 這不是效能門檻，只是防卡住的逾時，但第一個回應包含子行程的 node 啟動。改成具名常數 `BRIDGE_TIMEOUT_MS = 15_000` 並註明原因 |
| `plugin-developer-mode` 合併連續編輯 | debounce 200 ms，兩次連續寫入要合併成 1 次 reload | 3 個全量同時跑時失敗一次（`2 !== 1`）：兩次寫入的 `fs.watch` 事件送達間隔超過 200 ms | 測試用的 debounce 改成 1 秒（`COALESCE_DEBOUNCE_MS`），之後的等待依它推算；等第一次 reload 的防卡住 deadline 從 5 秒放寬到 15 秒。受測程式碼的預設 debounce（500 ms）不變 |

`panel-theme-diagnostics` 的門檻依據：我用 `git archive 76b9525^` 取出改寫前的程式碼，在同一個測試裡換成舊的 `validateUserPanelTheme`，比值是 0.23–0.45；現在單獨跑 0.009–0.028，3 個全量同時跑時 0.003–0.026。門檻 0.1 對兩邊都留兩倍以上的餘裕。

#### 3. `tests/` 的型別檢查

- 上一階段的「約 52 個」只量了 F 動到的 30 個檔案。全部 `tests/` 第一次量是 178 個。
- 其中 34 個是工具鏈造成的假錯誤。27 個來自型別衝突：`tests/dev-runtime.test.mts` import `vite.config.mts`，vite 的宣告檔帶進 `@types/node@26.1.1`，和專案的 24.13.3 衝突，連 `electron/local-server-listen.ts` 都出現 `Property 'on' does not exist on type 'Server'`。另有 7 個是 `scripts/*.mjs` 沒有宣告檔，用 `allowJs` 解決。
- 剩下 144 個真錯誤，分四組交給子代理，我複核後再補修（見下方）。

### 型別錯誤的處理

| 類型 | 處理 |
|---|---|
| 假 `BrowserWindow`／`WebContents`／事件（約 40 處） | 改用 `fake-electron.mts`；用字串當事件的哨兵（`event === 'pet'`）改成事件物件，用 `===` 比對 |
| 帶私有欄位的服務 class | `fakeService<T>()`，鍵名受檢查 |
| `assert.equal(x.ok, true)` 讓後面的 `x.error` 變成 `never` | 刪掉這行，由 `if (!x.ok) throw` 收窄（失敗時一樣會丟錯） |
| `assert.equal(store.toast, null)` 讓之後的讀取變成 `never` | `peek(() => store.toast)`，附註解 |
| 假物件回傳的資料形狀與真實型別不同 | 補成完整的型別資料（`HistorySummary`、`HistoryExport`、`PermissionRequestView`、`DesktopPreferences`、`PluginPanelPlugin` 等），斷言跟著比對完整物件 |
| hook JSON 的 `type: string` 被放寬 | 標註 `HookMatcherEntry` |
| `HistoryStore` 的私有 `database` | 檔內唯一的 `rawDatabase()` accessor（附註解），其餘 8 處各自的轉型都改用它 |

型別錯誤暴露出的語意問題（都已修正，受測程式碼沒有 bug）：

- `desktop-preferences` 的兩個假 adapter 還在用已不存在的 `getOpenAtLogin`／`setOpenAtLogin`。原本能過只是因為 store 沒呼叫它們；改成真正的 `LoginItemAdapter`。
- `ipc-permission` 的假 broker 回傳 `{ ok: true }`，真實是 `{ ok: true, status }`。
- `ipc-history`、`ipc-desktop`、`ipc-progression` 的假物件回傳不完整的資料，測試其實只比對了假資料本身。
- `ipc-quota` 原本用 `{}` 對 `{}` 的 `deepEqual` 確認 guard 收到事件，太鬆；改成確認是同一個事件物件。

### Code review 結論

我逐檔看過子代理的 diff，並自己補修了以下幾處：

- **子代理回報有誤**：`plugin-registry` 回報已修，但第 63 行的 `assert.equal(result.ok, true)` 還在，`tsc` 仍報錯（可能是四個子代理平行跑 `tsc`，共用同一個 incremental buildinfo，拿到過期結果）。我自己修正，最後再用 `--incremental false` 確認 0 個錯誤。
- `panel-theme-pet-status` 的「多一個名稱」案例會被物件字面值的多餘屬性檢查擋下；改成經由 `Record<string, string>` 變數傳入，測試意圖不變。
- 5 個檔案各自複製的 `asService` 和 12 處逐點的 `as unknown as <服務>` 收斂成 `fakeService`。
- `ipc-plugin-install` 把轉型 helper 用在資料物件上（`preferences: asService({})`），改成 `DEFAULT_PLUGIN_PREFERENCES` 和完整的 `PluginPanelPlugin`，斷言改成比對完整物件。
- `history.test.mts` 剩下的 8 處區域轉型改用 `rawDatabase()`。
- **新增的程式碼**沒有 `any`、`as never`、`@ts-ignore`、`@ts-expect-error`。diff 共移除 64 處 `as never` 與 64 處 `as unknown as`。新增的 `as unknown as` 有 5 處集中在 support helper，另外 7 處各有中文註解：`rawDatabase`、`updateDailyStat`、`ipc-adapters` 的 `asRegistry`、`ipc-pet-assets` 的 Node `fs` 多載假物件、`ipc-window-controls` 的 `DesktopPreferences`（2 處）、故意餵入的非法 `PluginErrorCode`。
- `plugin-panel-controller-characterization` 把註解塞在物件字面值同一行中間，改成獨立的註解加具名變數。
- **測試閉包**：新的 support 檔不 import 任何 src 執行期模組；`ipc-plugin-install` 對 `electron/plugin-preferences.ts` 的值 import 是 `electron/` 檔案，不受 `@/` 規則影響。
- **build 耗時**：`build` 只跑 `vue-tsc`，不受影響。`pnpm lint` 多了 `tsc -p tsconfig.tests.json`：冷快取約 20 秒，有 incremental 快取約 4 秒。
- `vite build` 通過，`vite.config.mts` 改從 `./electron/dev-runtime.ts` import 能正常打包。

### 驗證輸出摘要

| 指令 | 結果 |
|---|---|
| `pnpm lint` | 0 error、0 warning；main-process lint passed；`typecheck:tests` 0 error |
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm exec tsc -p tsconfig.tests.json --incremental false` | 0 error（開始時 178 個） |
| `pnpm exec vite build` | 通過 |
| `git diff --check` | 通過 |

`pnpm test:unit`（同一條指令，加上自訂 reporter 依檔案統計並保留失敗的 stack），最終版本：

| 次數 | 條件 | tests | fail | skip | 耗時 |
|---|---|---|---|---|---|
| 1 | 單獨 | 1837 | 0 | 39 | 50 s |
| 2 | 單獨 | 1837 | 0 | 39 | 40 s |
| 3 | 單獨 | 1837 | 0 | 39 | 38 s |
| 4 | 單獨 | 1837 | 0 | 39 | 38 s |
| 5 | 單獨 | 1837 | 0 | 39 | 37 s |
| 6–8 | 3 個全量同時跑（第一輪） | 各 1837 | 各 0 | 各 39 | 128 s |
| 9–11 | 3 個全量同時跑（第二輪） | 各 1837 | 各 0 | 各 39 | 118 s |

最終版本各計時測試的實測值：

| 測試 | 單獨 5 次 | 3 倍負載 6 次 | 門檻 |
|---|---|---|---|
| `panel-theme-diagnostics` 比值 | 0.015–0.025 | 0.006–0.018 | `< 0.1` |
| `agent-hook-delivery` stall | 667–1197 ms（上限 3312–4292） | 1838–4489 ms（上限 6134–8822） | `baseline * 2 + 2_500` |
| `history` migration | 540–748 ms | 843–2256 ms | `< 10_000 ms` |

驗證過程中，高負載下陸續重現 6 個計時問題，每修一個就重跑整套 5 次全量；上表是全部修完之後的結果。中途的失敗依序是：`agent-hook-delivery` stall（3229 ms）、never-opens（8066 ms）、`presentation-stdio` 逾時、`plugin-developer-mode` 合併（`2 !== 1`）、`quota-forecast`（`> 500 ms`）與 `claude-permission-hook` 不重試、`panel-theme-palette` 比值 20.7。另外有一次 `ipc-plugin-install` 失敗，是我在全量執行期間修改那個檔案造成的，不是不穩定。

### 殘留風險

- 3 倍負載下 node 啟動基準最高量到 3.2 秒。基準超過 5.5 秒時，busy app 測試的上限（`baseline * 2 + 2_500`）會超過 app 的 8 秒延遲；超過 3.5 秒時，pet closed 與不重試測試的上限會超過重試的 5 秒。這時測試不會誤報，但抓不到「改成等回答／誤開重試」的退化。
- 編輯器（VS Code 的 TS server）只認 `tsconfig.json`，開啟 `tests/*.mts` 時會用推斷專案，顯示找不到 `node:*` 型別等假錯誤。實際檢查以 `pnpm typecheck:tests` 為準，CI 經由 `pnpm lint` 執行。
- （F3 已處理）`tests/` 裡還有 117 處既有的 `as never`（分布在 40 個檔案，多半是假物件或故意餵入的非法值），能通過編譯，但會跳過型別檢查。全部清掉會擴大本階段範圍，所以沒動；新增的程式碼沒有 `as never`，skill 文件已寫明不要再新增。
- `fakeService<T>()` 只檢查鍵名，不檢查成員型別：假物件的回傳值若與真實型別不符，`tsc` 不會發現。改用 `Partial<T>` 會讓 5 個檔案出現假資料形狀不完整的錯誤，補齊屬於另一輪工作。
- 只在 Windows 驗證。Windows 的檔案鎖是 `EPERM` 的來源；macOS／Linux 上 `removeTempTree` 的重試通常不會觸發。
- 沒有啟動 Electron。本階段改的是測試、型別檢查設定，以及 `vite.config.mts` 的 import 位置（`vite build` 通過；`pnpm dev` 沒有實際啟動驗證）。

## F3：`as never` 清零、lint 禁止 `as never`

- **分支**：`claude/cleanup-f3-as-never-f013ae`
- **開始時間**：2026-11-11 15:38（Asia/Taipei）
- **完成時間**：2026-11-11 15:56（Asia/Taipei）
- **狀態**：通過

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、盤點 `as never` | 通過 | `tests/` 117 處文字命中，其中 3 處是註解或字串裡的英文 never，實際轉型 114 處；`electron/` 3 處；`src/` 只有 CSS 註解 |
| 2 | 新增 `invalid<T>()`、lint 規則 | 通過 | 以探針檔確認選擇器抓得到 `x as never` 與 `(x as unknown) as never`，不會誤傷 `const _exhaustive: never = v`、`never` 型別別名、參數與回傳的 `never` 註記 |
| 3 | 替換 `tests/` 的 `as never` | 通過 | 4 個子代理分組平行處理，檔案互不重疊；我逐檔複核後重做 3 處、抽出 2 個共用 fixture |
| 4 | 更新 `build-environment.md` | 通過 | |
| 5 | 逐檔 code review、連續 3 次全量驗證 | 通過 | 3 次全量都是 1837 tests、0 fail、39 skip |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `eslint.config.mjs` | 對所有檔案加 `no-restricted-syntax`：`TSAsExpression > TSNeverKeyword.typeAnnotation` 與 `TSTypeAssertion > TSNeverKeyword.typeAnnotation` | 禁止再寫 `as never`／`<never>`。選擇器只比對斷言的目標型別，不影響 `const _exhaustive: never = v` 等型別註記 |
| `electron/main/crash-guard.ts` | `CrashGuardProcess.off` 從 `(event: string, listener: (...args: never[]) => void)` 改成與 `on` 相同的逐事件 overload；`proc` 標註為 `CrashGuardProcess`，`dispose` 的 2 處 `as never` 與預設值的 `process as unknown as CrashGuardProcess` 都移除 | `never[]` 參數讓真正的 `process`／`EventEmitter` 都無法賦值，所以呼叫端與測試只能轉型。`options.proc ?? process` 推斷成聯集時，overload 無法呼叫，所以要明確標註 |
| `electron/main/renderer-recovery.ts` | `contents.off(event, listener as never)` 移除轉型 | `RecoverableWebContents` 是 `Pick<EventEmitter, 'on' \| 'off'>`，本來就能接受 |
| `tests/support/invalid.mts`（新增） | `invalid<T>(value: unknown): T` | 刻意餵給嚴格型別參數、執行期驗證應拒絕的非法值，轉型集中在這裡 |
| `tests/support/fake-electron.mts` | 新增 `fakeDisplay(id, bounds, workArea)`，回傳完整的 `Display`（純資料，不轉型） | `pet-window-mode-service`、`panel-geometry` 原本各自 `as never`；子代理各寫了一份相同的 helper，我合併成一份 |
| `tests/support/permission-request-view.mts`（新增） | `makePermissionRequestView(overrides)` | `permission-hotkeys`、`permission-view` 都需要完整的 `PermissionRequestView` |
| 39 個 `tests/*.test.mts` | 114 處 `as never` 全部移除，寫法見下方 | |
| `.agents/skills/pet-skill/references/build-environment.md` | Lint 一節：寫明 `as never` 由 lint 禁止且已清零，以及假物件、`invalid<T>()`、`as unknown as` 的使用規則 | |

### 替換方式

| 寫法 | 處數（約） | 代表檔案 |
|---|---|---|
| 原本就符合型別，直接拿掉 | 45 | `history`、`growth-maintenance`、`pet-window-mode-service`（`restore` 的輸入都是合法的 `PetWindowState`，選填欄位本來就可省略）、`progression`、`local-usage`、`renderer-recovery`、`turn-end-watcher`、`panel-theme-*` |
| 補齊成完整、有型別註記的資料（`satisfies` 或明確型別） | 35 | `tray-menu`（完整 `DesktopPreferences`）、`plugin-*`（manifest、contributes、skin、panel theme、通知紀錄）、`quota`、`permission-*`、`achievements`（`ProgressionSnapshot`）、`growth-service`、`settings-registry`（`(key: TranslationKey) => string`） |
| `fakeService<T>()` | 17 | `growth-service`、`history-runtime-service`、`plugin-catalog-runtime`、`plugin-runtime`、`app-update-runtime`、`onboarding`、`local-server-listen`（`Server`） |
| `fakeBrowserWindow`／`fakeWebContents`／`fakeDisplay` | 13 | `pet-window-mode-service`、`panel-geometry`、`growth-maintenance`、`ipc-app-update`、`ipc-reliability` |
| 把字面值聯集陣列寬化成 `readonly string[]` 再 `includes` | 3 | `hook-literal-contract`、`plugin-panel-themes` |
| `invalid()` | 2 | `permission-broker`（`permissionModes: ['always']` 不是合法決策，測的就是註冊時拒絕）、`plugin-permission-units`（manifest 型別以外的未來權限鍵） |

順手處理：`plugin-runtime`、`growth-service`、`plugin-state-sync`、`plugin-tabs`、`plugin-permission-units` 原有的 6 處 `as unknown as` 一併換掉（`tests/` 從 68 處降到 62 處，沒有新增）；`plugin-catalog-runtime` 的 `globalThis as unknown as Record` 改用 `Reflect`。

沒有受測函式需要把參數改成 `unknown`：用到 `invalid()` 的兩處，受測端本來就在執行期驗證（`registerAdapter` 拋錯、`permissionUnits` 把未知的 true 鍵列成單位），型別保持嚴格才符合正常呼叫端。

### Code review 結論

4 個子代理（Sonnet）分組處理、檔案互不重疊。我逐檔讀完 diff，以下是重做或修正的地方：

- **`main-error-boundary`**：子代理寫了 30 行的 `FakeProcess` class，裡面還有 `value as Error`。根因是 `CrashGuardProcess.off` 的 `never[]` 參數，改正介面後，測試直接用 `new EventEmitter()`。「escalates at most once」原本手寫的假 proc 也改用同一個 `fakeProcess()` 加 `emit`。
- **`achievement-order`**：子代理把 `'far'`、`'near'` 這類佔位 id 包進 `invalid()`。這些 id 不是執行期會拒絕的輸入，只是不在 `AchievementId` 聯集裡。排序與 id 無關，所以改用 7 個真實的 `AchievementId`，一對一替換，斷言順序不變。
- **`main-shutdown`**：子代理用 `fakeService` 包 timer state，但它不是服務 class。改成從 `MAIN_STATE_TIMER_KEYS` 建 `Record<TimerKey, Timeout | null>`，留一處 `Object.fromEntries` 的收斂轉型，並附中文註解。
- **`plugin-catalog-runtime`**：`network` 原本放寬成 `Record<string, unknown>`，鍵名不受檢查；改成 `fakeService<PluginNetworkClient>` 的參數型別。
- **重複 helper**：兩份 `fakeDisplay` 合併進 `fake-electron.mts`；兩份完整的 `PermissionRequestView` 抽成 `permission-request-view.mts`。
- **`permission-audit`**：4 個 `as const` 改成明確型別 `PermissionAuditRecord & { description; responseHandle }`，表達「呼叫端夾帶敏感欄位」的情境；第二個測試在 `JSON.stringify` 裡加的 `as const` 沒有作用，還原。
- **斷言沒有放寬**：39 個測試檔的 `test(` 數量與 `assert.*` 呼叫數都和 HEAD 完全相同（腳本逐檔比對）。內容有改的只有 `growth-service` 假 snapshot 的 `evolutionStage`：`0`／`1` 改成 `'egg'`／`'baby'`，期望的 `stageBefore`／`stageAfter` 同步更新。服務只是轉送這兩個值，原本的數字不是合法型別；`ipc-app-update`、`ipc-reliability` 的假視窗 id 從 `'panel'` 改成 `1`，測試只用物件身分比對。
- 選擇器以探針檔驗證：`x as never`、`(x as unknown) as never` 會報錯；`const _exhaustive: never = v`、`type N = never`、參數與回傳的 `never`、`satisfies never[]` 不會報錯。

### 驗證輸出摘要

| 項目 | 結果 |
|---|---|
| `pnpm lint`（eslint、main-process lint、`typecheck:tests`） | 0 error、0 warning |
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `git grep -n "as never" -- tests src electron` | 只剩 4 行英文 never：`src/styles/tokens.css:148` 的 CSS 註解、`local-usage.test.mts:215` 的測試名稱、`:242` 的註解、`plugin-theme-api.test.mts:125` 的斷言訊息，都不是轉型 |
| `pnpm test:unit` 第 1 次 | 1837 tests、1798 pass、0 fail、39 skip（49.2 s） |
| `pnpm test:unit` 第 2 次 | 1837 tests、1798 pass、0 fail、39 skip（51.3 s） |
| `pnpm test:unit` 第 3 次 | 1837 tests、1798 pass、0 fail、39 skip（45.2 s） |

### 殘留風險

- `fakeService<T>()` 仍然只檢查鍵名，不檢查成員型別（F2 已記錄）。本階段新增 17 處用法，都用在帶私有欄位的 class，或像 `PluginRuntimeState` 這樣的 30 多欄 `Pick<MainState>`（測試只提供 `dispose` 會碰到的成員）。
- `tests/` 仍有 62 處 `as unknown as`，多半用來讀 store 的私有欄位（`database`、`queuedEvents`）或 `assertTrustedIpcSender` 的 sender。lint 沒有禁止，本階段沒有逐一處理。
- `CrashGuardProcess` 的介面改動影響主程序：`installCrashGuard` 的預設值不再轉型，型別檢查通過、單元測試涵蓋 `on`／`off`，但沒有啟動 Electron 實機確認。
