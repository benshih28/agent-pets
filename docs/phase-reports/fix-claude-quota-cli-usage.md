# Claude Quota 改由 Claude Code `/usage` 讀取

日期：2026-10-23  
開始時間：2026-10-23 10:00（Asia/Taipei）  
基準分支：`main`  
基準 commit：`cd8bfcf`  
基準應用程式版本：`1.2.2`

## 問題

Claude Quota 只讀 Keychain `Claude Code-credentials`（或 `~/.claude/.credentials.json`）裡的 OAuth token，自己呼叫 `api.anthropic.com/api/oauth/usage`。token 過期時，Agent Pets 會自己 refresh 並寫回 Keychain。這有兩個問題：

- 只用 Claude Desktop、很少開 CLI 時，CLI 的 token 會過期，Quota 就顯示 Claude Code 工作階段已逾時。但 Desktop 其實仍在登入狀態。
- 自己 refresh 會輪替 refresh token。若 Agent Pets 與 Claude Code 同時 refresh，或寫回失敗，可能讓 Claude Code 手上的 refresh token 失效，CLI 登入就壞掉。

## 參考做法

- [Magpie](https://github.com/yetone/magpie)（`internal/provider/claude_usage_cli.go`、`internal/gateway/claude_warmup.go`）：執行 `claude -p /usage --output-format json`，用乾淨的環境與暫存工作目錄，不帶工具、設定或 MCP。由 Claude Code 自己處理登入與 refresh，Magpie 本身不 refresh 也不寫回憑證。
- TokenBar 系列（hrithik73、Nanako0129）只讀 CLI 憑證，或自行 refresh。兩者都不讀 Claude Desktop 的登入，所以不採用。

## 範圍與變更

- `electron/quota.ts`：Claude Quota 優先執行 Claude Code 的 `/usage` 並解析輸出。
  - 每個時間窗都對應到既有 id：`session` 與 `weekly`。
  - 依模型分開的週限制：Sonnet、Opus 沿用既有 id，其他模型為 `week-scope-*`，標籤為「X only」。
  - 解析帶時區的重置時間。
- `/usage` 回報登入失效時直接顯示「請在 Claude Code 重新驗證」。CLI 不存在或無法回答時，才退回原本用已存 token 呼叫 API 的路徑。
- 移除 Agent Pets 自己 refresh Claude token 及寫回 Keychain／檔案的程式碼。退回的 API 路徑遇到過期 token 時，直接提示重新驗證。
- 尋找 CLI 時只接受絕對路徑：`PATH` 中的絕對路徑項目，加上 `~/.local/bin`、`~/.claude/local`、Homebrew、`/usr/local/bin` 等安裝位置。GUI 啟動時不會繼承 shell 的 PATH，所以需要後者。
- 移除 6 條已不再使用的 refresh 與 Keychain 寫入錯誤訊息翻譯。
- 新增 `tests/quota.test.mts`。

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm test:unit` | 通過，121/121（含新增 3 項 quota 測試） |
| `vue-tsc --noEmit`（含 `electron/**/*.ts`） | 通過 |
| 實際執行 `getQuotaUsage(true)` | 通過，Claude 回傳 Session 20% 與 Weekly 52%，含正確的重置時間；Codex 不受影響 |
| 以 `PATH=/usr/bin:/bin` 模擬 GUI 啟動 | 通過，從 `~/.local/bin/claude` 找到 CLI 並取得用量 |
| 實際 Electron 畫面 | 未執行；資料契約（id、label、percent、resetsAt）與既有渲染路徑相同 |

## 安全檢查與殘餘風險

- 縮小信任邊界：Agent Pets 不再寫入 Claude Keychain 或憑證檔，也不再呼叫 Claude 的 OAuth token endpoint。
- 子程序以 `execFile` 執行，不經過 shell，參數固定，有 30 秒逾時及 1 MB 輸出上限。
- 子程序環境會移除 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 等端點與工作階段變數，避免把請求導向其他端點。工作目錄為用後即刪的暫存資料夾。
- 只執行絕對路徑上的 `claude`，避免相對 PATH 劫持。
- 殘餘風險：
  - `/usage` 的文字格式不是公開契約。格式改變時解析結果為空，會退回 API 路徑。
  - 每次輪詢會啟動一次 CLI（本機約 2–6 秒）。
  - CLI 的 refresh token 若已被 Anthropic 拒絕，仍需使用者在 Claude Code 重新登入。
  - 未讀取 Claude Desktop 的加密登入，這是刻意的安全邊界。
  - Windows 只尋找 `claude.exe`，不執行 npm 的 `claude.cmd`。
  - 未在 Windows 與 Linux 實測。

## 版本與發布

- 使用者於 2026-10-23 確認本 phase，應用程式版本 patch 升版 `1.2.2` → `1.2.3`（`pnpm-lock.yaml` 不含根套件版本，無需變更）；升版後重新執行單元測試與型別檢查皆通過。
- 不建立 Git tag 或發布套件。

## 後續修正（1.2.4）：CLI 未登入訂閱時的提示

日期：2026-10-23

安裝 1.2.3 後，面板顯示「找不到既有的 Claude Code 訂閱工作階段」，但使用者的 Claude Desktop 是登入狀態。調查結果：

- 這台 Mac 的 Claude Code CLI 本身沒有登入訂閱帳號。
- 1.2.3 先前的本機驗證是在 Claude Desktop 啟動的 session 內執行，Desktop 會把自己的登入交給它啟動的程序，所以 `/usage` 才能讀到用量。
- 以乾淨環境（`env -i`，等同從 Finder 開啟 App）執行 `claude -p /usage`，只得到 `Total cost: $0.0000` 這類花費摘要，沒有 Session／Weekly 用量。

修正：

- `/usage` 只回花費摘要時，視為 CLI 未登入訂閱，顯示「Claude Code CLI 尚未登入訂閱帳號。請在終端機執行 `claude`，並以 /login 登入。」，不再顯示含糊的錯誤。
- CLI 輸出 `Invalid API key` 或 `run /login` 時，視為登入失效。
- 仍不讀取 Claude Desktop 的加密登入，維持既有安全邊界。

驗證：

| 檢查 | 結果 |
|---|---|
| `pnpm test:unit` | 通過，122/122（新增未登入訂閱與 zh-TW 翻譯測試） |
| `vue-tsc --noEmit` | 通過 |
| 以 `env -i HOME USER PATH=/usr/bin:/bin` 執行 `getQuotaUsage(true)` | 通過，Claude 顯示上述 zh-TW 提示，Codex 不受影響 |

使用者要求 patch 發布，版本 `1.2.3` → `1.2.4`。
