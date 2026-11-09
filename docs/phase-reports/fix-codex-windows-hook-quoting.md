# 修正：Windows 上 Codex hook 指令在 PowerShell 無法執行（1.12.1）

## 問題

在 Windows 上，Codex 有執行 Agent Pets 的 hook，寵物狀態卻完全不會更新。

- 1.12.0 寫進 `~/.codex/hooks.json` 的指令是 `"C:\Users\<user>\.desktop-pet\agent-hook.cmd" codex`。這個格式來自 ON-09，`15ab6fd`。
- Codex 在 Windows 上用 PowerShell 執行 hook 指令。
- PowerShell 把開頭用引號包住的路徑當成字串運算式，後面的 `codex` 就成了多餘的 token，回報 `Unexpected token 'codex' in expression or statement`。
- 結果 wrapper 和 node 都沒有被啟動。Codex 只記錄 `hook/started`／`hook/completed`，不會顯示錯誤，所以寵物端看起來就是收不到事件。

### 實機證據

- Codex 的 `logs_2.sqlite` 有 Agent Pets hook 的 `hook/started` 與 `hook/completed`，每次約 1〜1.6 秒。
- 在 `agent-hook.mjs` 加入暫時的診斷記錄後，Codex 觸發的 hook 沒有留下任何記錄，也就是腳本從未執行。
- 用 `hooks.json` 裡的原始字串實測：
  - cmd.exe：成功。
  - PowerShell：出現上述 ParserError。
  - 不加引號，或在前面加 `&`：成功。

## 修正

### `electron/hook-config.ts` 的 `codexHookCommand`（Windows）

- 路徑只含 `[A-Za-z0-9_.:\-]` 時，輸出不加引號的 `<wrapper> codex`。
  - 這個格式在 cmd 與 PowerShell 都能執行。
  - 它和 ON-09 之前的安裝格式相同，舊安裝不會因此讓 Codex 的 hook 信任失效。
- 路徑含空白或非 ASCII 字元時，輸出 `cmd /d /c "<wrapper>" codex`。開頭不是引號，PowerShell 與 cmd 都會把引號內的內容視為單一路徑。
- 拒絕的字元多了 `$` 與反引號，因為 PowerShell 會在雙引號字串內展開它們。
- `leadingExecutable` 會略過 `cmd /d /c` 啟動器，讓 Node 健康檢查繼續檢查實際的 wrapper。

### 順手修正：Windows 上的 `URL.pathname` 路徑錯誤

在 Windows 上，`new URL(..., import.meta.url).pathname` 會得到 `/C:/...`，再被 `join` 成 `C:\C:\...`。三處改用 `fileURLToPath`：

- `scripts/lint-main-process.mjs`：`pnpm lint` 在 Windows 上原本直接 ENOENT。
- `scripts/check-bundle-size.mjs`
- `tests/i18n.test.mts`：「every permission-domain key is referenced by the app」在 Windows 上原本必定失敗。

## 驗證

- 單元測試 `tests/hook-config.test.mts`：
  - Windows 一般路徑輸出不加引號的格式；含空白、中文、`&`、`^`、`'`、`()` 的路徑輸出 `cmd /d /c` 格式。
  - 兩種格式開頭都不是引號，並且都能被 `isAgentPetsHook` 和 `leadingExecutable` 正確辨識。
  - `$`、反引號、`"`、`%` 一律拒絕。
- 新增 Windows 限定的實際 shell 測試：建立假的 `agent-hook.cmd`，分別以 `powershell.exe -Command` 與 `cmd.exe /d /s /c` 執行產生的指令。一般路徑和含空白的路徑都確認 wrapper 有執行，並收到 `codex` 參數。
- `vue-tsc --noEmit`：通過。
- `pnpm lint`：通過，修正前在 Windows 上會 ENOENT。
- `vite build` 與 `check:bundle-size`：通過。
- `pnpm test:unit`：1211 個測試，修正前基準有 8 個失敗。修正後 i18n 那一個已修好，其餘 7 個都和本次修改無關，未修改的 main 上一樣會失敗：
  - Windows 未開開發人員模式時不能建立 symlink 的 4 個：symlinked dotfile、symlinked staging root、兩個 git helpers。
  - 另外 3 個：v9 migration、startup recovery、file edit risk。
  - 「worst-case draft timing ceiling」是計時門檻，偶爾會失敗，重跑後通過。
- 本機修正：使用者的 `~/.codex/hooks.json` 已改成新格式，備份為 `hooks.json.agent-pets-bak-quotefix-*`。

## 安全

- 新的不加引號格式只允許固定字元集，不含任何 shell 中介字元，沒有注入面。
- `cmd /d /c "..."` 格式拒絕 `"`、`%`、`$`、反引號、換行與 NUL，引號內不會被 cmd 或 PowerShell 展開。`/d` 會停用 cmd AutoRun。
- 沒有新增 IPC、網路面或權限面；只改變寫進使用者設定檔的指令字串。

## 殘留風險

- Codex 是否一律以 PowerShell 執行 hook，是由實機行為推得，不是官方文件。新格式在 cmd 與 PowerShell 都能執行，兩種情況都已涵蓋。
- 已安裝 1.12.0 的使用者，要等 App 下次重寫 hook（重新安裝或修復）才會換成新格式；換格式後需要在 Codex 重新審核 hook。這版沒有加入自動遷移。
- macOS／Linux 的 POSIX 格式沒有變更，也沒有在本機重新驗證。

## 版本建議

Patch：1.12.0 → 1.12.1。修的是 adapter 錯誤，沒有變更公開契約。
