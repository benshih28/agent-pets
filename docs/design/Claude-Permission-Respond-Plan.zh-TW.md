# 階段計畫：Claude Code 權限從寵物泡泡回覆（observe → respond）

> 狀態：已實作（見 `docs/phase-reports/phase-claude-permission-respond.md`）· 基準：`main` @ 75a574f，版本 1.10.3 · 建議版號：**minor（1.11.0）**，理由是改變 Claude adapter 的 permission capability 公開契約與 Control Plane 安全邊界。

## 1. 目標

Claude Code 跳出權限請求時，寵物泡泡可以直接按 **允許一次 / 拒絕**，決定會寫回 Claude Code。來不及回覆、寵物沒開或功能關閉時，一律退回 Claude Code 原本的權限流程，**最壞情況等同現在**。

不在本階段範圍：

- AskUserQuestion 作答（答案格式官方未記載，另開階段）。
- Codex `PermissionRequest` 回覆（Hopet 文件稱格式相同，留作下一階段，沿用本階段的 hook 實作）。
- 持久化 auto-allow、`updatedPermissions`、`updatedInput`（v2 架構第 6.3 條第 9 點：只允許 `allow_once` / `deny`）。

## 2. 已驗證事實（2026-11-07）

| 項目 | 結果 | 來源 |
|---|---|---|
| `PermissionRequest` hook 可回 allow | 實測通過：等待 3 秒後回 allow，Bash 指令執行 | Claude Code 2.1.314 `-p` 實測 |
| 回 deny + `message` | 實測通過：指令被擋，Claude 收到我們的拒絕理由 | 同上 |
| 輸出格式 | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"\|"deny","message"?}}}` | 官方 hooks 文件 + 實測 |
| stdin 欄位 | `session_id`、`prompt_id`、`permission_mode`、`hook_event_name`、`tool_name`、`tool_input`、`permission_suggestions`、`cwd`、`transcript_path`；**沒有 `tool_use_id`** | 實測 |
| deny 規則優先 | hook 回 allow 也無法蓋過使用者的 deny 規則 | 官方文件 |
| 逾時 | command hook 預設 600 秒；逾時丟棄輸出、走原流程 | 官方文件 |
| 非互動 / 背景 subagent | 仍執行 hook；沒有 hook 給決定就 deny | 官方文件 |
| 多宿主 | CLI、IDE 擴充、Desktop 觸發同樣的 hook；與 `canUseTool` 宿主並存時「先決定者生效」 | 官方文件（Desktop / VS Code 未實測） |

**第 0 步結果（已驗證）：對話框會與 hook 等待同時顯示，預設等待 90 秒。原始問題：**互動終端機中，hook 等待期間權限對話框是否同時顯示。

- **同時顯示** → 使用者兩邊都能回，先回者生效。hook 等待上限可以比較長（預設 90 秒）。
- **hook 回來才顯示** → 等待期間終端機看起來卡住。等待上限要短（預設 20 秒），並且在設定與 README 說明。

測試指令與暫存設定已備妥，見對話紀錄；結果寫進階段報告。

## 3. 設計

### 3.1 資料流

```
Claude Code ──PermissionRequest stdin──▶ agent-hook.mjs
   agent-hook.mjs ──POST /v1/events (現有, waiting-permission)──▶ event-server :17373
   agent-hook.mjs ──POST /v1/permission/request──▶ permission-adapter-server :17374 ──▶ Broker ──▶ 泡泡
   agent-hook.mjs ──輪詢 POST /v1/permission/decision (450ms)──▶ 取得 allow_once / deny
   agent-hook.mjs ──stdout decision JSON──▶ Claude Code
   agent-hook.mjs ──POST /v1/permission/result──▶ Broker 記錄 delivered
```

在終端機已處理的情況：之後同一工具的 `PostToolUse` / `PostToolUseFailure`，或同 session 的 `Stop` / `UserPromptSubmit` / `SessionEnd`，由 hook 呼叫 `/v1/permission/resolved`，Broker 撤下泡泡與熱鍵（架構 6.3 第 12 點）。

### 3.2 請求對應（沒有 `tool_use_id` 的解法）

- `instanceId = "claude-" + session_id`（符合 `IDENTIFIER_PATTERN`，必要時截斷或雜湊）。
- `permissionId = sha256(session_id + "\0" + tool_name + "\0" + canonicalJSON(tool_input))` 取前 32 hex。
- `PostToolUse` 帶相同的 `tool_name` / `tool_input`，可以重算出同一個 ID 並呼叫 resolved，不需要在磁碟存狀態。
- 同一指令在同 session 重複請求：前一筆若已終結，Broker 的 external index 會回舊的 requestId → 需要在 adapter server 讓「已終結的 key」重新建立（或在 ID 加入 `prompt_id`）。**實作時二選一並寫測試**，建議加入 `prompt_id`。
- 保底：`Stop` / `UserPromptSubmit` / `SessionEnd` 時，新增 `POST /v1/permission/resolved-session`，以 `instanceId` 撤下該 session 全部待決請求。

### 3.3 Hook 行為（`integrations/agent-hook.mjs`）

1. 只有 `source` 是 `claude` / `claude-desktop`、事件是 `PermissionRequest` 且 respond 功能開啟時，才進入回覆模式。開關由 main process 寫入 `~/.desktop-pet/claude-permission-respond`（0600，內含等待秒數），hook 讀不到就維持現行 observe 行為。
2. 讀不到 `permission-token`、連不上 17374、收到 401/429/503 → **立刻 exit 0、不輸出**（走原流程）。快速路徑目標 < 50 ms。
3. 輪詢間隔 450 ms，總等待 = 設定值（上限 120 秒，必須小於 settings.json 中的 hook `timeout`）。收到 204 繼續等，410 代表已在別處處理，直接不輸出。
4. 收到決定 → 先寫 stdout 再呼叫 `/result`。`deny` 的 `message` 使用固定字串「已在 Agent Pets 拒絕」，不帶任何 payload 內容。
5. 不使用 exit 2（官方：對此事件無效）。不輸出 `updatedInput` / `updatedPermissions` / `interrupt`。
6. subagent 請求（payload 帶 `agent_id`）掛到主 session 顯示；`-p` / 背景 subagent 照常可回覆，逾時就由 Claude deny（與現況一致）。

### 3.4 安裝設定（`electron/setup.ts`、`electron/hook-config.ts`）

- Claude 的 `PermissionRequest` hook 條目加 `"timeout": <等待秒數 + 15>`，其他事件不變。
- 舊使用者：利用 `rewriteAgentPetsHookCommands` 的同類機制，在 app 啟動時只更新 Agent Pets 自己的條目，並備份（沿用 `*.agent-pets-bak-*`，保留最新 5 份）。
- Full cleanup 要同時移除 `claude-permission-respond` 開關檔。

### 3.5 Broker / adapter server

- `SOURCES` 加入 `claude` / `claude-desktop`（只在 17374，需 permission-token；`/v1/events` 仍不能取得 respond，符合 6.3 第 2 點）。
- 依 `tool_name` 對應風險：`Bash` → high，`Write` / `Edit` / `MultiEdit` / `NotebookEdit` → medium，`WebFetch` / `WebSearch` → network，`mcp__*` → unknown，其他 → unknown。高風險維持「點擊後再確認」。
- `description` 只取 `tool_input.command` / `file_path` / `url`，經 `permission-redact` 後截斷；不顯示 `description` 以外的模型文字。
- capability：`CLAUDE_CAPABILITIES.permissions = 'respond'`，`permissionModes = ['allow_once','deny']`；**只在使用者開啟功能時**對外回報 respond，否則仍為 observe（6.x「toggle 需要真正的 off switch」）。

### 3.6 UI 與設定

- 設定 → 進階（或權限區）新增：「從寵物回覆 Claude Code 權限」開關（**預設關閉**）與「等待秒數」（依第 0 步結果決定預設值）。
- 泡泡沿用現有 OpenCode 的權限卡（Allow once / Deny、熱鍵、1/3 堆疊），文字補一行「也可以在終端機回覆」。
- 只用 `src/components/ui/` 現有元件與 tokens，遵守 Liquid Glass 規則；新增文案同時補 zh-TW 與 en。
- README 兩份：Supported agents 表格 Claude Code 的 Permission 欄改成「respond（需開啟）」，並說明退回行為與等待秒數。

## 4. 執行步驟

0. **互動終端機行為實測**（決定預設等待秒數），並在 Desktop app 與 VS Code 各測一次 allow / deny。結果寫進報告。
1. 在 worktree 開分支 `feat/claude-permission-respond`，建立 Work Intelligence 記錄（`startedAt`、`continues` 本規劃 session）。
2. adapter server：`SOURCES`、風險對應、`resolved-session` 路由、重複請求處理 + 測試。
3. hook：回覆模式、快速失敗、ID 計算、resolved 呼叫 + 測試（用假 server 驗 stdout）。
4. setup / hook-config：`timeout` 欄位、舊條目更新、開關檔、full cleanup + 測試。
5. capability 與設定 UI、i18n、泡泡文案。
6. 端對端：`claude -p` + 隔離的 `--settings` 跑 allow / deny / 逾時 / 寵物未開，並以真實 Electron 視窗驗證泡泡出現、按下後 Claude 端結果、在終端機回覆後泡泡撤下。
7. 安全審查、效能審查、README 更新、階段報告 `docs/phase-reports/phase-claude-permission-respond.md`。
8. 版號：依使用者規則（預設 patch、大改動才 minor），本階段屬安全邊界變更，以 minor 1.11.0 發布。

## 5. 驗收條件

- [ ] 開啟功能後，從泡泡按允許：Claude 執行該工具；按拒絕：Claude 收到「已在 Agent Pets 拒絕」並不執行。
- [ ] 功能關閉、寵物未開、token 缺失、server 錯誤：hook < 50 ms 結束且不輸出，Claude 行為與 1.10.3 相同。
- [ ] 等待逾時：hook 不輸出，Claude 走原流程（互動）或 deny（非互動），泡泡標示逾時。
- [ ] 在終端機回覆後，泡泡與全域熱鍵在下一個事件內撤下。
- [ ] 同一 session 多筆請求依序顯示 1/N；重複的相同指令能正確建立新請求。
- [ ] 使用者 deny 規則仍優先（hook 回 allow 也被擋）。
- [ ] 舊安裝升級後自動補上 `timeout`，非 Agent Pets 的 hook 條目完全不變，並有備份。
- [ ] zh-TW / en 文案齊全；README 兩份與 capability 測試（`doc-capabilities`、`readme-parity`）一致。

## 6. 測試計畫

| 層級 | 檔案 | 重點 |
|---|---|---|
| 單元 | `tests/permission-adapter-server.test.mts` | Claude source 接受、未授權拒絕、重複 key、`resolved-session`、速率限制 |
| 單元 | 新增 `tests/claude-permission-hook.test.mts` | 假 server：allow / deny 的 stdout JSON、204 輪詢、410、逾時不輸出、連線失敗快速退出、ID 可由 PostToolUse 重算 |
| 單元 | `tests/hook-config.test.mts`、`tests/setup-install.test.mts` | `timeout` 欄位、只改自己的條目、備份、cleanup |
| 單元 | `tests/permission-risk.test.mts`、`tests/permission-redact.test.mts` | Claude 工具風險對應、指令中 token 遮罩 |
| 單元 | `tests/agent-adapter.test.mts`、`tests/doc-capabilities.test.mts` | 開關決定 capability；文件一致 |
| 端對端 | 手動 + 腳本 | `claude -p --settings <隔離設定>`；真實 Electron 泡泡；Desktop / VS Code 各一次 |

測試不得觸發 macOS Keychain（沿用 stub safeStorage）；隔離設定只放在暫存目錄，不寫入使用者的 `~/.claude/settings.json`。

## 7. 安全審查重點（phase-gates「Permission Broker work」）

- **偽造**：本機程式要建立 Claude 請求必須持有 `permission-token`（0600）；`/v1/events` 永遠無法建立請求。
- **重播**：requestId / generation / TTL / CAS；已終結的請求不可再取得決定。
- **過期與重啟**：app 重啟後所有待決請求 expired，hook 收到 410 → 不輸出、走原流程，絕不自動允許。
- **並行決定**：泡泡與熱鍵同時按只有一個生效；終端機與泡泡同時回 → Claude 端先到者生效，我們端以 resolved 收尾。
- **資訊外洩**：泡泡、通知、audit 只存遮罩後的短指令；不存 prompt、transcript 路徑、`permission_suggestions`。
- **拒絕服務**：hook 等待有上限且小於 hook timeout；17374 的速率與數量限制沿用。
- **最小權限**：只回 `allow` / `deny`，不使用 `updatedInput` / `updatedPermissions`，不提供持久允許。

## 8. 效能

- 每次 `PermissionRequest` 多一個短命 Node 程序的輪詢（450 ms，最長 120 秒），只在功能開啟時發生。
- `PostToolUse` 等事件多一次 resolved POST（300 ms 逾時、fire-and-forget），只在該 session 有待決請求時送（hook 端以開關檔判斷，不額外讀寫磁碟以外的狀態）。
- 不在 `main.ts` 事件熱路徑新增同步 I/O。

## 9. 殘餘風險

- 互動終端機的對話框時序依賴 Claude Code 版本，未來版本可能改變 → 報告記錄測試版本，並在 Diagnose 顯示 Claude Code 版本。
- Windows（`agent-hook.cmd` 包裝、node.exe 解析）要到 2026-11-09 之後才能驗證，記錄於 `docs/ux-overhaul/windows-todo.md`。
- 同機器若還有其他工具（Hopet、vibe-notch 等）註冊 `PermissionRequest`，多個 hook 會並行，誰的決定生效由 Claude Code 決定 → README 說明。
