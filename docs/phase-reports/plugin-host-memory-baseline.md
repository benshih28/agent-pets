# Plugin Host 基準記憶體監控、本機埠重試與 Windows rename 重試

日期：2026-10-29
分支：`fix/plugin-host-memory-baseline`（基準 `main` 7354cea）
Agent Pets 版本：`1.4.0` → `1.4.1`

## 1. Plugin Host 記憶體改以自身基準計算

### 問題

`1.3.2` 以「192 MB 基本額度＋每插件預算 × 啟用數」對照整個 Plugin Host 的 working set。192 MB 是 macOS 的經驗值，Windows 與 Linux 沒有實測，而且 working set 本身就不是插件用掉的量。

### Windows 實測（隔離 Electron，`ok-notify` 複本，每情境取樣 8 次、間隔 5 秒）

| 啟用插件數 | working set | private bytes | host 頁面 JS heap |
| --- | --- | --- | --- |
| 0 | host 不存在 | — | — |
| 1 | 94 MB | 28–30 MB | 1.2 MB |
| 3 | 98–99 MB | 37–40 MB | 1.2 MB |
| 5 | 102–103 MB | 46–49 MB | 1.3 MB |

- working set 與 private 相差約 65 MB，這部分是和其他 Electron 程序共用的 Chromium 程式碼頁面。寵物與面板 renderer 也是 working set 110–135 MB、private 30–46 MB。
- 每多一個插件，private 約 +4.5 MB、working set 約 +2 MB。
- 沒有啟用插件時 host 不會啟動；全部停用後 host 會關閉，沒有閒置成本。
- 舊公式（64 MB × 1）如果比對的是 private 本來不會超標。誤判是量錯指標造成的，不是預算太小。

### 修正

- 新增 `electron/plugin-host-memory.ts`：
  - `pluginHostMemoryMb()` 優先使用 `privateBytes`（Windows），沒有時退回 `workingSetSize`。
  - `PluginHostMemoryMonitor` 在 host `did-finish-load`、建立 MessagePort 之後、啟動任何 Worker 之前記錄基準，之後只比較增長量。連續 2 次（`PLUGIN_HOST_MEMORY_STRIKES`）超標才判定；任何一次正常取樣都會清除累積次數。載入時量不到基準，就以第一次檢查為基準（寬鬆，但不會誤殺）。
- `pluginHostMemoryBudgetMb()` 改回「每插件預算 × 啟用數」，移除 `PLUGIN_HOST_BASE_MEMORY_MB`。
- `memoryMbPerPlugin` 的儲存格式、範圍（16–512 MB）、預設值（64 MB）都不變。

### 實測（修正後 build）

| 情境 | 結果 |
| --- | --- |
| 啟用 1 → 3 → 5 個插件，約 2 分鐘（多次 30 秒檢查） | host 一直是同一個 PID，插件全部維持 `enabled` |
| 每插件預算調到 16 MB，安裝持有約 150 MB 的插件（private 約 180 MB） | host 約每 60 秒重啟一次（PID 14152 → 51048 → 43828），184 秒時插件變成 `disabled_crashed` |

## 2. 本機伺服器在埠被佔用時持續重試

### 問題

事件（17373）、Permission adapter（17374）、Presentation MCP（17375）伺服器遇到 `EADDRINUSE` 只會記錄一次 log，之後不再 listen。實際發生過：使用者在隔離測試 App 還開著時啟動寵物，寵物整段生命週期都收不到 Agent 狀態，必須手動重新啟動。

### 修正

- 新增 `electron/local-server-listen.ts` 的 `listenOnLocalPort()`：遇到 `EADDRINUSE` 時以 2、5、15、30 秒（之後固定 30 秒）退避重試，被佔用和重新取得各只記錄一次 log；server `close()` 之後停止重試；重試 timer 使用 `unref()`，不會讓程序無法結束；也接手 `error` handler，其他錯誤只記錄、不會讓主行程崩潰。
- 三個伺服器都改用這個函式。
- 已確認 Node 的行為：listen 失敗後不會發出 `close`；對同一個 server 可以再次呼叫 `listen`；從未 listen 成功的 server 被 `close()` 時會發出 `close`。

### 實測

使用者的寵物（PID 28052）持有 17373–17375 時啟動隔離 App：三個伺服器各記錄一次「already in use; retrying until it is free」，沒有搶走使用者的埠。整段測試期間使用者的寵物一直持有這三個埠。

## 3. Windows rename 遇到暫時性鎖定時重試

### 問題

Windows Defender 和搜尋索引會短暫握住剛寫入的檔案。以插件安裝的流程（寫入 staging 目錄後立刻 rename）實測 300 次，有 10 次（約 3%）回傳 `EPERM`。插件安裝因此會隨機出現 `install_failed`，這也是 `plugin-fixtures`／`plugin-registry` 測試在 Windows 上時好時壞的原因。

### 修正

- 新增 `electron/fs-rename.ts` 的 `renameSyncWithRetry()`：只在 `win32` 上、遇到 `EPERM`／`EACCES`／`EBUSY` 時重試，退避 10、20、40、80、160、320、640 ms（總計約 1.3 秒），之後拋出最後一次的錯誤。其他平台與其他錯誤維持立即失敗。同步等待使用 `Atomics.wait`，只有在第一次 rename 失敗時才會付出這段時間。
- 套用到所有 `fs.renameSync` 呼叫點：`plugin-registry`（安裝、備份、還原、移除，共 8 處）、`plugin-preferences`、`plugin-data-file`、`desktop-preferences`、`permission-audit`、`project-mcp-registry`、`project-mcp-setup`、`quota`。

### 實測

`plugin-registry` 與 `plugin-fixtures` 測試連跑 5 次都是 28/28 通過；修正前 3 次裡有 2 次失敗。

## 4. Windows 測試與隔離啟動器

- `tests/support/fs-capabilities.mts`：以實際探測判斷能否建立檔案 symlink，不能時略過依賴它的 7 個測試，原本只在 Windows 一律略過的 1 個也改用同一套判斷。macOS、Linux 與開了開發者模式的 Windows 都照常執行。`0600` 權限斷言只在 POSIX 平台執行。
- developer folder watcher 測試改用 junction，不需要權限，現在 Windows 上也會實際執行。
- `scripts/e2e-isolated-electron.mjs` 補上 `USERPROFILE`。Windows 的 `os.homedir()` 讀的是它；少了它，隔離檢查在 Windows 上一定中止。

## 驗證證據

| 指令／流程 | 結果 |
| --- | --- |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit`（Windows 11） | 472 個測試：464 通過、8 略過（需要 symlink 權限）、0 失敗 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無已知漏洞 |
| `git diff --check` | 通過 |
| 隔離 Electron（Windows）：記憶體、強制終止、埠重試 | 見上方各節 |

## 安全檢查

- 記憶體監控仍然有效，而且更準：超量插件仍會被終止，連續 3 次後停用。改成「連續 2 次超標」讓單一插件最多多存活一次檢查的時間（30 秒）。
- 埠重試只綁 `127.0.0.1`，token 驗證、請求大小限制、速率限制都沒有變；重試期間沒有任何程序在聽，不會接受未驗證的請求。
- rename 重試只放寬 Windows 上的暫時性鎖定錯誤；symlink 檢查、路徑驗證、`wx` 寫入旗標都沒有變。
- 未新增 IPC channel、preload 能力、權限或設定欄位。`.claude/` 未修改。

## 殘餘風險與待辦

- macOS 與 Linux 沒有 `privateBytes`，仍以 working set 計算增長；共用頁面在 Worker 啟動時被載入的部分會算進增長量，但 Windows 上量到的 working set 每插件只多約 2 MB。macOS 的數字未在本次實測。
- 埠被永久佔用（非 Agent Pets 的程式長期佔用 17373–17375）時會每 30 秒重試一次，不會通知使用者。
- 隔離啟動器在 Windows 上會記錄 `Installed integration refresh skipped Error: Failed to get 'appData' path`，因為 home 被導向暫存資料夾；整合刷新因此略過，不影響隔離性，也不影響本次驗證。

## 版本建議

Patch（`1.4.0` → `1.4.1`）：主程式內部修正，未變更公開插件合約、manifest、IPC 或儲存格式。
