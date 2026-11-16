# 重構階段 12：原子寫檔的底層機制

- **開始時間**：2026-11-10 18:52（Asia/Taipei）
- **完成時間**：2026-11-10 19:30（Asia/Taipei）
- **基準 commit**：`7a30439`（分支 `claude/refactor-12-atomic-write-c23d34`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 7 項；排程見 3.1 節（最後一個階段）

## 範圍

把各 store 重複的「同目錄暫存檔 → 以指定 mode 寫入 →（可選 fsync）→ `renameSyncWithRetry` →（可選 POSIX chmod）→ 失敗時清除暫存檔」抽成一個不做任何政策決策的底層 helper。各領域的大小限制、目錄驗證、備份策略、symlink 政策與暫存檔名稱格式留在各自模組。

不在範圍：寫入流程不等價的呼叫點（見「未套用 helper 的呼叫點」）、版本號。

## 驗收條件

1. 改前先以測試固定每個呼叫點的成功內容、暫存檔名稱格式、rename 失敗（含 Windows EPERM／EBUSY 重試）、寫入途中失敗、暫存檔清理、POSIX 檔案權限、symlink 行為與備份；改後同一組測試不修改仍通過。
2. 共用 helper 不做 symlink 決策；`safe-config-write.ts` 追隨 dotfile symlink、私有資料儲存拒絕 symlink 的差異維持不變。
3. 暫存檔名稱格式不變（`panel-theme-user-store.ts` 的 `TEMPORARY_FILE` 啟動清理、`BACKUP_MARKER` 備份清單依賴它們）。
4. 熱路徑不新增同步 I/O；可移除的重複 `stat` 移除。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（與基準比對不新增失敗）、`git diff --check` 通過。
6. 隔離 Electron 驗證：hook 安裝（寫入 agent 設定檔與備份）、面板尺寸與桌面偏好儲存後重啟仍在、插件資料檔寫入。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點呼叫點、建立記錄、基準測試 | 通過 | 基準 `test:unit`（`7a30439`）：1485 項，1452 過、10 失敗、23 skip，見「基準失敗清單」 |
| 2 | 特性測試固定現有行為（對基準原始碼） | 通過 | `tests/atomic-write-call-sites.test.mts` 對 `7a30439` 原始碼：58 項，47 過、0 失敗、11 skip（9 個 symlink、2 個 POSIX 權限；本機沒有 symlink 權限、不是 POSIX） |
| 3 | 共用 helper 與單元測試 | 通過 | `electron/atomic-file-write.ts`；`tests/atomic-file-write.test.mts` 8 項，6 過、2 skip |
| 4 | 呼叫點改用 helper | 通過 | 10 個寫入函式改用 helper；特性測試未修改仍 47／0／11；`vue-tsc` 通過 |
| 5 | Code review、phase gates、安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 6 | 隔離 Electron 實機驗證 | 通過 | 見「隔離 Electron 驗證」 |
| 7 | 更新重構評估文件、收尾記錄、commit | 通過 | 3.1 節排程表加上完成 commit、第 4 節補實作說明 |

## 盤點結果

以 `grep -E "renameSync|renameSyncWithRetry|writeTextAtomic|\.tmp"` 掃過 `electron/`、`scripts/`、`src/`，所有「暫存檔 → rename」的寫入如下。

### 套用 helper 的呼叫點

| 呼叫點 | 暫存檔名稱（不變） | mode | rename 後 chmod | fsync | 呼叫端保留的政策 |
|---|---|---|---|---|---|
| `safe-config-write.ts` `writeTextAtomic`（hook 設定、`onboarding-state.ts`、`git-tracking.ts`、`setup.ts` 的 opt-in 檔） | `.<名>.<pid>.<ms>.tmp` | 參數或沿用既有檔案 | 有 mode 時 | 否 | **追隨 dotfile symlink**（`resolveWriteTarget`）、`mkdir -p`、備份（`writeConfigSafely`）、大小上限（讀取端） |
| `desktop-preferences.ts` `writeJsonAtomic`（桌面偏好、面板尺寸、插件偏好、通知紀錄等） | `.<名>.<pid>.<ms>.tmp` | 0o600 | 是 | 否 | `mkdir -p`；**不檢查 symlink（rename 取代連結本身）** |
| `plugin-data-file.ts` `writePluginDataJson`（插件設定、secret） | `.<名>.<pid>.<ms>.tmp` | 0o600 | 是 | 否 | 目錄由 `ensurePluginDataDirectory` 驗證；**目標是 symlink／非一般檔就拒絕** |
| `project-mcp-registry.ts` `writeStoredEntries` | `.<名>.<pid>.<ms>.tmp` | 0o600 | 是 | 否 | `mkdir -p`；**拒絕 symlink**；讀取端大小上限 |
| `project-mcp-setup.ts` `writeTextAtomic`（專案 `.mcp.json` 等） | `.<名>.<pid>.<ms>.tmp` | 沿用既有檔案，新檔 0o644 | 是 | 否 | `ensureSafeDirectory`；**拒絕 symlink** |
| `quota.ts` `atomicWriteJson`（Codex `auth.json` 更新 token） | `.<名>.agent-pets-<pid>-<序號>.tmp` | 0o600 | 否 | **是** | 無（路徑來自 agent 設定目錄） |
| `plugin-registry.ts` `atomicWriteJson`（`plugins/registry.json`） | `.<名>.<pid>.<uuid>.tmp` | 0o600 | 否 | 否 | `ensureDirectory`；讀取端拒絕 symlink 與大小上限 |
| `panel-theme-user-store.ts` `write`（使用者主題） | `.<id>.<uuid>.tmp`（符合 `TEMPORARY_FILE`，載入時清掉殘留） | 0o600 | 是 | 否 | 16 KiB 上限、目錄驗證、**拒絕 symlink** |
| `panel-theme-user-store.ts` `writeUserPanelThemeExportFile` | `.<名>.<uuid>.tmp` | 0o600 | 否 | 否 | 絕對路徑、大小上限；**取代 symlink，不寫穿** |
| `panel-theme-images.ts` `storeUserImage` | `.<sha256>.<uuid>.tmp` | 0o600 | 否 | 否 | 內容定址（已存在就不寫）、私有目錄、**拒絕 symlink** |

### helper 契約（`electron/atomic-file-write.ts`）

- `writeFileAtomicSync(targetPath, data, { temporaryPath, mode?, enforceMode?, fsync? })`：以 `wx` 與 `mode` 開啟暫存檔 → 寫入 →（`fsync`）→ 關閉 → `renameSyncWithRetry` →（`enforceMode` 且非 Windows 時 best-effort `chmod`）。任何一步失敗都刪掉自己建立的暫存檔後重新丟出原錯誤。
- 暫存檔必須和目標同目錄，否則在碰磁碟前丟 `TypeError`。
- 不做 symlink、目錄、大小、備份判斷；呼叫端傳入的 `targetPath` 就是要被 rename 取代的實際路徑（`safe-config-write.ts` 傳入已解析的 symlink 目標）。
- 名稱由呼叫端決定；`pidTimestampTemporaryPath()` 產生五個呼叫點共用的 `.<名>.<pid>.<ms>.tmp`。

### 未套用 helper 的呼叫點

| 呼叫點 | 原因 |
|---|---|
| `permission-audit.ts` `trimPermissionAudit` | 固定名稱 `<檔>.<pid>.tmp`、沒有 `wx`（會覆寫上次留下的同名暫存檔）、失敗時不清理。套用 helper 會改變行為：殘留的同名暫存檔會讓 `wx` 失敗而每次都修剪失敗。維持原樣，列入殘餘風險。 |
| `pet-import.ts` 匯入 commit 的 `pet.json` | 非同步（`fs/promises`），並在 rename 後 fsync 目錄；流程不等價。 |
| `setup.ts` `ensureToken` | 直接寫入 token 檔（`'w'`＋fsync），不是暫存檔 rename；改成原子寫入屬行為變更。 |
| `plugin-registry.ts` 版本目錄交換、移除與還原 | 目錄 rename，不是檔案寫入。 |
| `panel-theme-store.ts`、`plugin-preferences.ts`、`panel-theme-user-store.ts` 的損毀備份、`main/db-recovery.ts`、`diagnostics/logger.ts` 輪替 | 只有 rename（改名保留），沒有暫存檔寫入。 |
| `panel-size-store.ts`、`plugin-preferences.ts` 等 | 透過 `desktop-preferences.ts` 的 `writeJsonAtomic`，已間接套用。 |

## 刻意的行為差異

1. **暫存檔名稱已存在（`EEXIST`）時不刪除那個檔案**：改前除了 `quota.ts`，其他呼叫點的 `catch` 會 `rmSync` 暫存檔路徑，所以 `wx` 因同名檔案失敗時會把那個不是自己建立的檔案刪掉；helper 統一採用 `quota.ts` 原本的做法，只刪除自己建立的暫存檔。名稱含 pid＋毫秒或 UUID，同一程序內寫入是同步的，只有前一個同 pid 程序在同一毫秒留下殘檔才會碰到；錯誤一樣丟出、目標檔不變。（`tests/atomic-file-write.test.mts`「an existing file with the temporary name is neither overwritten nor removed」）
2. **`project-mcp-setup.ts` 少一次 `stat`**：已用 `lstat` 確認是一般檔案時直接取它的 mode，不再 `statSync`。一般檔案（非 symlink）的 `lstat` 與 `stat` 相同；檔案不存在（含懸空 symlink，`existsSync` 為 false）時兩者都得到 0o644，結果等價。

暫存檔名稱、mode、chmod、fsync、symlink 與備份行為皆不變（特性測試固定）。

## 驗證證據

| 項目 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過（`dist-electron/main.js` 含 helper） |
| `git diff --check` | 通過 |
| 特性測試 `tests/atomic-write-call-sites.test.mts` | 基準原始碼 47 過／0 失敗／11 skip；改後未修改測試仍 47／0／11 |
| helper 測試 `tests/atomic-file-write.test.mts` | 6 過／0 失敗／2 skip（POSIX 權限、symlink） |
| `pnpm.cmd run test:unit` | 見「與基準比對」 |
| `pnpm.cmd audit --prod` | No known vulnerabilities found |
| secret 掃描（diff 與新檔，`api_key|secret|token|password = '…'`） | 無命中 |
| `docs/security/ipc-inventory.md` | 新測試檔引用 `project-mcp-setup`，以 `node scripts/generate-ipc-inventory.mjs --write` 重新產生（只改對應測試欄一列），`tests/ipc-inventory.test.mts` 通過 |

特性測試的手法：以 `syncBuiltinESMExports()` 暫時替換 `node:fs` 的 `renameSync`／`writeFileSync`，對每個呼叫點注入：rename 丟 `EXDEV`（不可重試）、丟一次 `EBUSY`（Windows 應重試同一個暫存檔後成功，其他平台應失敗並清理）、寫到一半丟 `ENOSPC`（先真的寫入 1 個位元組再丟錯）。每種失敗都斷言目標內容不變、目錄列表與失敗前相同（沒有殘留暫存檔）；成功時斷言暫存檔名稱格式與同目錄。symlink 案例以能力偵測（`SKIP_WITHOUT_FILE_SYMLINKS`）略過，POSIX 權限以 `POSIX_FILE_MODES` 略過。

### 與基準比對

| 執行 | 項數 | 過 | 失敗 | skip |
|---|---|---|---|---|
| 基準 `7a30439` | 1485 | 1452 | 10 | 23 |
| 本階段（收尾前最後一次完整執行） | 1551（＋58 特性、＋8 helper） | 1504 | 11 | 36 |

失敗清單與基準相同，只多 `a starting app that never opens its port holds the hook for a bounded time only`（`tests/agent-hook-delivery.test.mts` 的計時測試，這次改動沒有碰到 hook 腳本或它載入的模組）。單獨重跑該檔兩次，兩次都只剩基準就有的 2 個停滯計時失敗，這個測試通過；較早一次完整執行則多出同檔的另一個計時測試與 `ipc-inventory`（後者是新測試檔讓產生的清單改變，已重新產生並通過）。新增的 66 個測試在 2 次完整執行（負載下）都沒有失敗。

### 隔離 Electron 驗證

以 `vite build` 後的 repo 用 `scripts/e2e-isolated-electron.mjs --offscreen --hook-port-base 29173 --debug-port 9598 --inspect-port 9599` 啟動（隔離 HOME／userData、螢幕外、`showInactive()`、假 safeStorage，沒有點擊畫面）。驅動腳本放在 session scratchpad，經 CDP 呼叫 preload API、經主程序 inspector 模擬面板拖曳與注入對話框回應。流程：第一次啟動寫入 → `app.quit()` 正常結束 → 在隔離 HOME 放一份使用者原有的 `~/.claude/settings.json` → `--reuse-root` 重啟 → 真實 hook 安裝與事件 → 讀回資料 → 正常結束。

| 項目 | 證據 | 結果 |
|---|---|---|
| 桌面偏好 | `setDesktopPreferences({ achievementsEnabled: false, notificationsEnabled: false })`；重啟後 `initializeDesktopPreferences` | 重啟後兩者仍為 false；`desktop-preferences.json` 內容一致 |
| 面板尺寸 | 主程序對面板 `emit('will-resize')` 後 `setSize(503, 751)`（等同使用者拖曳） | `panel-size.json` 為 504×752（Windows DPI 取整）；重啟後面板 `getSize()` 為 504×752 |
| onboarding | `updateOnboardingState('completed')` | 重啟後 `completedAt` 相同 |
| 插件資料檔 | 開發者模式下以對話框佇列安裝帶 settings／secret 的測試插件，`setPluginSettings`、`setPluginSecret` | 安裝成功、`registry.json` 有該插件；`plugins/e2e-settings/data/` 有 `settings.json` 與 `secrets.json`；重啟後設定值 `atomic`、secret 已設定 |
| hook 安裝與備份 | `scripts/e2e-real-hook.mts --home <隔離 HOME> --hook-port-base 29173 --debug-port 9598`（`USERPROFILE` 設為不存在路徑） | `all 8 hook events rendered as expected`；`settings.json` 有 hooks 且保留使用者原有的 `theme`；產生 1 份 `settings.json.agent-pets-bak-<時間>`，內容是安裝前原檔 |
| 暫存檔殘留 | 遞迴列出隔離 userData 與 HOME 中的 `*.tmp` | 0 個 |
| 結束清理 | 結束後查 `electron.exe` 程序與 29173–29175、9598、9599 埠 | 無殘留；暫時 root 已刪除 |

## 安全審查（filesystem gate）

| 檢查項 | 結果 |
|---|---|
| canonical path | 不變：`plugin-registry.ts` 仍以 realpath 後的 userData 組路徑；`safe-config-write.ts` 仍先 `realpathSync` symlink 目標。helper 不解析或改寫路徑。 |
| traversal | helper 拒絕不在目標同目錄的暫存檔（`TypeError`，碰磁碟前）；各呼叫點的 id／檔名驗證（`isPluginId`、`PANEL_THEME_USER_IMAGE_FILE`、主題 id）不變。 |
| symlink／reparse point | 政策全部留在呼叫端，特性測試固定三種政策：追隨（`safe-config-write`、onboarding）、拒絕（plugin data、project MCP registry／setup、使用者主題、主題圖片、plugin registry）、取代連結本身（`writeJsonAtomic`、主題匯出）。helper 本身以 rename 取代連結、不寫穿（helper 測試固定）。本機無 symlink 權限，這些案例在 Windows 上 skip，需在 macOS／Linux 或開發者模式下執行。 |
| 大小上限 | 不變，仍在各模組（`MAX_CONFIG_BYTES`、`USER_PANEL_THEME_MAX_BYTES`、`REGISTRY_MAX_BYTES`、`MAX_REGISTRY_BYTES`、圖片上限）。 |
| 原子寫入 | `wx` 建立 → 寫入 →（fsync）→ 同目錄 rename；Windows 暫時鎖定重試沿用 `renameSyncWithRetry`。失敗時清除自己的暫存檔，不刪除別人的同名檔（刻意差異 1）。 |
| 權限 | 建立時的 mode 與 rename 後的 chmod 與改前逐一相同（見套用表）；`quota.ts` 的 Codex `auth.json` 仍是 0o600＋fsync。 |
| 熱路徑同步 I/O | 未新增。helper 的系統呼叫序列與改前相同（open／write／close／rename，加上原本就有的 fsync、chmod）；`project-mcp-setup.ts` 少一次 `stat`。hook 事件與 quota 刷新路徑沒有新增檔案操作（quota 只在 token 更新時寫檔）。 |

## Code review 紀錄

- 新語法：helper 用解構、`??` 不需要；`using`／`Symbol.dispose` 不採用（fd 只在 try／finally 內一處，且 tsconfig 未開 `esnext.disposable` lib）。以 `fs.writeFileSync(fd, data)` 的預設 utf8 取代多餘的 encoding 三元運算。
- 效能：見安全審查「熱路徑同步 I/O」。`safe-config-write.ts` 的 `writeConfigSafely` 對 symlink 解析兩次（讀既有內容、寫入各一次），只在 hook 安裝這類使用者動作時發生，維持原樣以免更動已固定的 symlink 流程。
- 風格：`electron/` 同層相對匯入；新增註解只寫「為什麼」（暫存檔名稱被啟動清理依賴、只刪自己建立的暫存檔、umask 與 chmod）。

## 殘餘風險

- symlink 與 POSIX 權限案例在這台 Windows 上 skip；macOS／Linux 未實測，依專案規則列為殘餘風險。
- `onboarding-state.ts` 是 app 私有資料，卻用追隨 symlink 的 `safe-config-write.ts` `writeTextAtomic`；`desktop-preferences.ts` 的 `writeJsonAtomic` 遇到 symlink 會取代連結而不是拒絕。兩者都是既有政策，本階段依限制不改，只以測試固定；若要統一成拒絕 symlink，建議另開缺陷修正。
- `permission-audit.ts` 修剪時的暫存檔沒有 `wx` 與失敗清理（見未套用表）。
- e2e 的插件資料檔驗證走開發者模式資料夾安裝，沒有走簽章 catalog 安裝。

## 版本建議

本階段是內部重構，行為不變（兩項刻意差異都不影響使用者可見結果），單獨看屬 patch。依 3.1 節排程，整體 12 個階段完成後統一升 minor 版；本階段不改版本號。

## 檔案變更狀態

| 路徑 | 類型 | 目的 | 狀態 |
|---|---|---|---|
| `docs/phase-reports/refactor-12-atomic-write.md` | 新增 | 本階段工作記錄 | 完成 |
| `electron/atomic-file-write.ts` | 新增 | 底層 helper `writeFileAtomicSync`、共用暫存檔名稱 `pidTimestampTemporaryPath` | 完成 |
| `tests/atomic-file-write.test.mts` | 新增 | helper 單元測試 | 完成 |
| `tests/atomic-write-call-sites.test.mts` | 新增 | 呼叫點特性測試（改前先寫） | 完成 |
| `electron/safe-config-write.ts` | 修改 | `writeTextAtomic` 改用 helper；symlink 追隨與 mode 沿用留在本模組 | 完成 |
| `electron/desktop-preferences.ts` | 修改 | `writeJsonAtomic`（桌面偏好、面板尺寸）改用 helper | 完成 |
| `electron/plugin-data-file.ts` | 修改 | `writePluginDataJson` 改用 helper；symlink 拒絕留在本模組 | 完成 |
| `electron/project-mcp-registry.ts` | 修改 | `writeStoredEntries` 改用 helper | 完成 |
| `electron/project-mcp-setup.ts` | 修改 | `writeTextAtomic` 改用 helper；mode 沿用改由已做的 `lstat` 取得（少一次 `stat`） | 完成 |
| `electron/quota.ts` | 修改 | `atomicWriteJson`（Codex `auth.json` 更新）改用 helper（`fsync: true`） | 完成 |
| `electron/plugin-registry.ts` | 修改 | `atomicWriteJson`（`registry.json`）改用 helper | 完成 |
| `electron/panel-theme-user-store.ts` | 修改 | 主題記錄寫入與匯出檔改用 helper | 完成 |
| `electron/panel-theme-images.ts` | 修改 | `storeUserImage` 改用 helper | 完成 |
| `docs/security/ipc-inventory.md` | 修改 | 重新產生：`project-mcp-setup` 的對應測試多列新測試檔 | 完成 |
| `docs/architecture/refactor-opportunities-2026-11-10.zh-TW.md` | 修改 | 3.1 節排程表加上完成 commit；第 4 節補充已依排程完成與記錄位置 | 完成 |

## 基準失敗清單

`7a30439` 上 `pnpm.cmd run test:unit`（1485 項）的 10 個失敗，皆與本階段無關（symlink 需要開發者模式而 EPERM、hook 停滯計時）：

- a busy app still gets the event, and the hook does not wait for its answer
- a file edit is medium only inside the project and never for execution-relevant paths
- a permission request still reaches the pet when the hook is stalled right after sending starts
- a status event still arrives when the hook process is stalled before it can send
- a symlinked staging root is refused
- git helpers never follow gitdir or commondir outside the picked folder
- git helpers refuse a symlinked info directory or exclude file
- removing hooks from a symlinked dotfile keeps the link and its target
- startup recovery restores interrupted replaces and removes only our own stale entries
- with the pet closed the hook does not wait, even if a crash left an old marker
