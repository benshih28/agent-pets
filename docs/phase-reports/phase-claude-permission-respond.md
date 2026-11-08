# 階段報告：Claude Code 權限從寵物泡泡回覆（observe → respond）

> 分支 `feat/claude-permission-respond`，基準 `main` @ 75a574f（1.10.3）。規劃見 [Claude-Permission-Respond-Plan.zh-TW.md](../design/Claude-Permission-Respond-Plan.zh-TW.md)。版號尚未變更。

## 範圍

- Claude Code 的 `PermissionRequest` 可以在寵物泡泡與面板卡片上「允許一次／拒絕」，決定寫回 Claude Code。
- 新設定「從寵物回覆 Claude Code 權限」（**預設關閉**）與「等待秒數」（預設 90 秒，15–120 秒），位於設定 → 桌面 → 權限請求，可搜尋。
- 寵物沒開、功能關閉、token 缺失、伺服器拒絕、逾時或任何錯誤：hook 不輸出、exit 0，Claude Code 走原本流程。
- 在終端機回覆後，`PostToolUse`／`PostToolUseFailure` 以重算的 ID 撤下泡泡；同一 agent 範圍的 `PreToolUse`、新的 `PermissionRequest` 與 `Stop` 撤下較早的請求；`UserPromptSubmit`／`SessionEnd` 撤下該 session 全部待決請求。
- 不在範圍：AskUserQuestion 作答、Codex 回覆、`updatedInput`／`updatedPermissions`／持久允許。

## 實作摘要

| 區塊 | 檔案 | 內容 |
|---|---|---|
| Hook | `integrations/agent-hook.mjs` | 回覆模式只在 `claude`／`claude-desktop` + `PermissionRequest` + 開關檔存在時啟用；每次執行產生隨機 nonce，建立請求後才送觀察事件，每 450 ms 輪詢、先寫 stdout 再回報 `/result`；固定拒絕訊息；顯示內容依序取 `command`／`file_path`／`notebook_path`／`url`／`pattern`／`query`，否則為去掉 `description` 的排序鍵 JSON（≤1000 字）；resolved／resolved-session（含 agent 範圍）呼叫。 |
| 對應 ID | 同上 | `instanceId = "claude-" + session_id`（不符 `IDENTIFIER_PATTERN` 時改用雜湊）；`permissionId = sha256(session_id, prompt_id, tool_name, 排序鍵 JSON(tool_input))` 前 32 hex。 |
| Adapter server | `electron/permission-adapter-server.ts` | 接受 `claude`／`claude-desktop`；Claude 必須帶 nonce，decision／result 需相同 nonce，進行中的相同 key 由不同 nonce 建立時回 409；Claude 專用欄位 `detail`、`filePath`、`scope`、`ttlSeconds`（夾在 15–120）；新請求撤下同範圍較早的請求；主行程關閉時回 503；已終結的相同 key 重新建立；新增 `POST /v1/permission/resolved-session`（可指定範圍）。驗證、loopback、origin、body 與速率限制不變。 |
| 風險 | `electron/permission-risk.ts`、`electron/permission-broker.ts` | `Bash` high；`Write`／`Edit`／`MultiEdit`／`NotebookEdit` 只在檔案位於 cwd 內（字面與 realpath 皆是）、且不在 `.git`／`.claude`／`.husky`／`.vscode`／`.idea`／`.devcontainer`／`node_modules/.bin`、不是 shell 啟動檔或工具設定檔時為 medium（顯示專案相對路徑），否則 high；`WebFetch`／`WebSearch` high + network；`mcp__*` 與其他 unknown。high／unknown 且內容被截斷時 broker 移除 `allow_once`（所有 agent 適用）。 |
| 安裝 | `electron/setup.ts`、`electron/hook-config.ts` | Claude Code 安裝新增 `PermissionRequest`（`timeout` 135）與 `PostToolUseFailure`；啟動時每個 app 版本只執行一次升級（`~/.desktop-pet/claude-hooks-upgraded` 記錄版本），只補這兩個事件並修正我們自己的 timeout，沿用使用者既有的 command/args，有備份，沒有 Agent Pets 條目時不動；Full cleanup 移除開關檔與標記檔。 |
| 開關 | `electron/desktop-preferences.ts`、`electron/main/runtime.ts`、`electron/claude-permission-notice.ts` | 偏好存在 userData；主行程快取布林值給 adapter server，變更時同步 `~/.desktop-pet/claude-permission-respond`（0600），關閉時撤下待決的 Claude 請求。功能開啟且該 session 有進行中或 10 秒內結束的 broker 請求時，Claude 的 `waiting-permission` 事件不再標為 external-only，系統通知與面板不會叫使用者回終端機。 |
| Capability | `electron/agent-adapter.ts`、`electron/agent-adapter-operations.ts` | 開啟時 Claude Code 回報 `respond` + `['allow_once','deny']`，否則 `observe`；登錄表靜態值（README 對照來源）不變。 |
| UI | `SettingsDesktop.vue`、`PermissionBubble.vue`、`InlinePermissionCard.vue`、`settingsRegistry.ts`、`src/locales/permission/*` | 共用 `ToggleRow`／`NumberField`；泡泡與卡片加一行「也可以在終端機回覆」（Desktop 為「也可以在 {source} 回覆」）；不能允許時停用允許鍵並提示回原工具確認；權限紀錄中 Claude Code 的允許／拒絕標示「終端機可能已先回覆」；可核准／只提醒清單依開關變化；風險說明與「為什麼不能在這裡核准」文案更新。zh-TW、en 齊全。 |
| 文件 | `README.md`、`README.zh-TW.md`、`project-map.md`、`windows-todo.md` | Supported agents 表格、respond／observe 說明、權限氣泡章節（風險、快捷鍵條件、Claude Code 行為與退回）。 |

### 與規劃不同之處

- **hook `timeout` 固定 135 秒**（最大等待 120 + 15），不是「等待秒數 + 15」。理由：改等待秒數不必重寫使用者的 `settings.json`；寫入失敗時也不會出現 timeout 小於等待的情況。互動模式下對話框與 hook 同時顯示（見第 0 步），較長的 timeout 不會卡住使用者。
- **ID 同時加入 `prompt_id`，且已終結的相同 key 會重新建立**（規劃為二選一）。只加 `prompt_id` 不足以處理同一個 prompt 內重複的相同指令。
- 拒絕訊息為固定雙語字串 `Denied in Agent Pets. (已在 Agent Pets 拒絕)`，不帶任何 payload 內容。
- `Stop` 帶有非空的 `background_tasks` 時不送 resolved-session，避免撤下背景任務仍在等待的請求。
- 獨立安全審查後補上（第二輪）：每次執行的 nonce（一次點擊只回覆一個工具呼叫）、依 cwd 分類檔案編輯風險、external-only 提醒的抑制、`PreToolUse`／新請求撤下舊請求、通用參數顯示、截斷的高風險請求不能允許、升級每版只跑一次、README 拒絕文字與撤下時機。

## 第 0 步：互動終端機時序（已驗證）

方法：`python3 -I` pty 腳本（位於 repo 外的暫存目錄）啟動 `claude --setting-sources project --settings <隔離設定> --model haiku --permission-mode default`，工作目錄為暫存資料夾，處理資料夾信任提示後要求以 Bash 執行 `node -e "require('fs').writeFileSync('out.txt','x')"`。隔離設定的 `PermissionRequest` hook 記錄 stdin 後等待再回覆。未寫入 `~/.claude/settings.json`。Claude Code 2.1.314。

| 實驗 | 結果 |
|---|---|
| hook 等 10 秒後回 allow | 權限對話框（Yes／Yes, and don't ask again／No）在工具呼叫出現時就顯示在畫面上，比「Allowed by PermissionRequest hook」早約 10.6 秒，也就是 hook 還在等待時已可在終端機操作；hook 回覆後工具執行。 |
| hook 等 20 秒，第 6 秒在終端機選 Yes | 工具立即執行；hook 程序**沒有被終止**，跑完 20 秒後輸出的 deny 被忽略（檔案已建立）。 |
| 欄位 | `PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop` 都帶 `prompt_id`；`PostToolUse*` 的 `tool_input` 與 `PermissionRequest` 相同（含 `description`），另有 `tool_use_id`。 |
| 注意 | `touch` 這類被 Claude Code 視為安全的指令在互動模式不會觸發 `PermissionRequest`；未指定 `--permission-mode default` 時本機設定讓工具自動通過。 |

結論：**對話框與 hook 同時顯示**，先回覆者生效，預設等待採 **90 秒**。因為 hook 不會因終端機回覆而被終止，`PostToolUse` 的 resolved 呼叫是撤下泡泡、讓 hook 收到 410 提早結束的主要途徑。

## 驗證證據

所有指令在 worktree 執行，`pnpm install --frozen-lockfile` 成功。

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | `main-process lint passed` |
| `pnpm test:unit` | 904／904 通過（第二輪修正後；第一輪為 891／891） |
| `pnpm test:coverage`（CI 步驟） | 第二輪：904／904 通過，覆蓋門檻通過（all files 行覆蓋 96.27%）。第一輪曾有一次 890／891：既有的 `presentation-stdio` 在機器負載極高（load average 50–300，來自其他程序）時 2 秒內等不到 MCP 回應，單獨執行通過；新的 hook 測試會啟動多個 Node 程序，可能增加平行競爭，CI 上需再觀察。 |
| `pnpm exec vite build` | 通過 |
| `pnpm check:bundle-size`／`check:bundle`／`check:contrast`／`check:design:strict` | 全部通過（design strict 無新發現） |
| `pnpm audit --prod --audit-level=high` | No known vulnerabilities found |
| `git diff --check` | 無輸出 |

測試數：基準 869 → 第一輪 891 → 第二輪 904（共新增 35）。新增或擴充：

- `tests/claude-permission-hook.test.mts`（新增 8 個）：以假伺服器執行真正的 `agent-hook.mjs`（複本只替換連接埠、最短等待與逾時預算）。allow／deny 的 stdout JSON、固定拒絕訊息、`/result` 回報、204 輪詢、410 靜默結束、逾時不輸出、連線拒絕／503／401／429／缺 token 快速且靜默、沒有開關檔時維持 observe、`PostToolUse`／`PostToolUseFailure` 重算出相同 ID、`Stop`／`UserPromptSubmit`／`SessionEnd` 送 resolved-session、背景任務時不送、異常 session id 仍產生合法識別碼；並確認 hook 不送出模型寫的 description、`permission_suggestions`、transcript 路徑與 `prompt_id` 原文。
- `tests/permission-adapter-server.test.mts`（+6）：Claude 風險表、遮蔽、TTL 夾值、OpenCode 不能借用 Claude 欄位、關閉時 503、仍需 token、終結後重建、resolved-session 只影響該 session、broker 關閉時不會自動允許。
- `tests/permission-risk.test.mts`（+1）、`tests/hook-config.test.mts`（+2）、`tests/setup-install.test.mts`（+3）、`tests/agent-adapter.test.mts`（+1）、`tests/desktop-preferences.test.mts`（+1）。
- 第二輪：`tests/permission-adapter-server.test.mts`（+4：nonce 唯一交付與 409、缺少或無效 nonce、同範圍撤下、檔案編輯風險含符號連結與過長 cwd）、`tests/permission-risk.test.mts`（+2：POSIX／Windows 路徑分類）、`tests/permission-broker.test.mts`（+2：截斷的高風險不能允許、`hasRecentRequestForSession`）、新增 `tests/claude-permission-notice.test.mts`（2）、`tests/claude-permission-hook.test.mts`（+1：參數後備顯示；並擴充 nonce、409、範圍、先建立請求再送事件）、`tests/setup-install.test.mts`（+2：每版只升級一次、沒有 Agent Pets 條目時不動）。
- 測試全部使用暫存 HOME，不讀寫真實家目錄，不觸發 macOS Keychain。

### 端對端（真實 Claude Code + 真實 broker／adapter server）

隔離 Electron（`scripts/e2e-isolated-electron.mjs`）會綁定與已安裝 Agent Pets 相同的 17373–17375，本機正在執行的 app 佔用這些埠，因此**沒有跑真實 Electron 視窗**。改以 repo 外的暫存腳本載入 worktree 的 `PermissionBroker` 與 `createPermissionAdapterServer`（臨時埠），broker 出現請求後 1.5 秒自動決定，hook 為只替換連接埠的複本，以隔離的 `--settings` 執行 Claude Code 2.1.314（haiku）：

| 情境 | 結果 |
|---|---|
| `-p`，泡泡允許 | 檔案建立；audit `allowed / delivered` |
| `-p`，泡泡拒絕 | 檔案未建立；Claude 回報收到 `Denied in Agent Pets. (已在 Agent Pets 拒絕)` |
| `-p`，不回覆（等待 15 秒） | hook 不輸出；audit `expired / ttl`；Claude 回報 "This command requires approval."（非互動模式照常拒絕） |
| 互動 pty，在終端機回覆 Yes | 工具執行；`PostToolUse` 後請求在 TTL 前以 `cancelled / agent_resolved` 撤下 |

第二輪修正後重跑 `-p` 允許與拒絕，結果相同（nonce 流程正常）。泡泡畫面本身未在真實 Electron 視窗中目視確認。

## 安全審查（phase-gates「Permission Broker work」）

| 項目 | 結果 |
|---|---|
| 偽造 | 建立 Claude 請求必須持有 `permission-token`（0600），且只在 17374；`/v1/events` 仍無法建立請求。開關檔只決定 hook 是否嘗試，主行程偏好關閉時 server 一律回 503（真正的 off switch）。 |
| 重播 | requestId／decisionId CAS 沿用；已終結的請求輪詢得到 410，不會再交出決定。終結後重建的請求是新的 pending，需要使用者重新點擊。 |
| 過期與重啟 | broker 只在記憶體中；app 重啟或關閉後 hook 得到 404／410／連線失敗 → 不輸出，絕不自動允許（有測試）。 |
| 並行決定 | 每個 Claude 請求屬於建立它的那次 hook 執行（隨機 nonce）；decision／result 必須帶相同 nonce，否則 409。兩個同時進行的相同請求（例如兩個 subagent 跑同一個指令）中，第二個建立時就得到 409、不輸出而由終端機處理，因此**一次「允許一次」只會讓一個工具呼叫執行**（第一輪審查發現的 Medium，已修正並有測試）。relay 每個請求只允許一個 pending delivery。終端機與泡泡同時回覆時 Claude Code 先到者生效，我們端由 resolved 收尾，權限紀錄標示「終端機可能已先回覆」。 |
| 外部解決 | resolved（重算 ID）、同 agent 範圍的 `PreToolUse`／新請求／`Stop`，以及整個 session 的 `UserPromptSubmit`／`SessionEnd`；關閉功能時撤下所有待決 Claude 請求。 |
| 資訊外洩 | hook 只送工具名稱、一段顯示內容（≤1000 字；已知欄位或去掉 `description` 的參數 JSON）、被編輯的檔案路徑、cwd 與 session id；不送 description、prompt、transcript 路徑或 `permission_suggestions`。cwd 與檔案路徑只用於主行程內的風險判斷，泡泡顯示資料夾名與專案相對路徑，專案外的路徑經遮蔽（家目錄變 `~`）。broker 遮蔽後截斷到 280 字；audit 只存工具名稱與風險。拒絕訊息為固定字串。主行程 log 只記錯誤代碼，不含路徑。 |
| 拒絕服務 | hook 等待上限 120 + 2 秒，每次呼叫 1 秒逾時，小於 hook timeout 135 秒；resolved-session 最多掃描 400 筆索引；速率與 body 限制沿用。 |
| 最小權限 | 只輸出 `allow`／`deny`，不使用 `updatedInput`／`updatedPermissions`／`interrupt`，不使用 exit 2。 |
| 風險分級 | 寫入 `~/.zshrc`、`.git/hooks/*`、`.claude/settings.json`、`.husky/*` 等會導致之後執行程式碼的位置一律 high，不能用全域快捷鍵允許（第一輪審查 Medium，已修正）；路徑比較不分大小寫並同時檢查 realpath，符號連結指出專案或指進 `.git` 也是 high。cwd 超過 4096 字時不信任，視為 high。high／unknown 且內容被截斷時不能從寵物允許。 |
| 檔案 | 開關檔以 `lstat` 檢查為一般小檔案才讀；寫入為原子寫入 0600。`settings.json` 只改 Agent Pets 自己的條目，其餘條目內容不變（重新序列化為 2 空白縮排，與安裝相同），寫入前備份（保留 5 份）。 |

第一輪自我審查修正：resolved 呼叫逾時由 300 ms 提高到 1 秒（負載高時 300 ms 會掉，泡泡要等到 TTL 才撤下）；啟動升級只補新事件；`Stop` 帶背景任務時不撤下請求。

第二輪（獨立安全審查）全部 8 項已修正並加上回歸測試：

| # | 等級 | 問題 | 修正 |
|---|---|---|---|
| 1 | Medium | 一次點擊可允許多個相同的工具呼叫 | 每次執行的 nonce；不同 nonce 重用進行中的請求回 409；decision／result 需要相同 nonce |
| 2 | Medium | Write／Edit 一律 medium，可用快捷鍵允許寫入 `.zshrc`、`.git/hooks` 等 | 依 cwd 判斷（字面 + realpath），排除會導致執行的位置；只顯示專案相對路徑 |
| 3 | Medium（UX） | 功能開啟時仍顯示「回到工具」的通知與提醒 | 有進行中或剛結束的 broker 請求時去掉 external-only；hook 先建立請求再送事件，避免競態 |
| 4 | Low | 在終端機回覆後泡泡仍可操作，拒絕並 Esc 時要等 90 秒 | `PreToolUse`、新請求、`Stop` 撤下同範圍的舊請求；權限紀錄標示「終端機可能已先回覆」 |
| 5 | Low | WebSearch、MCP、Task 沒有顯示參數 | 加入 `notebook_path`／`query`，其餘以去掉 `description` 的排序鍵 JSON 顯示 |
| 6 | Low | 截斷的高風險請求仍能一鍵允許 | broker 對 high／unknown 且截斷的請求移除 `allow_once`；泡泡與卡片停用允許鍵並提示 |
| 7 | Low | 升級每次啟動都跑，會加回使用者刪掉的條目 | 每個 app 版本只跑一次（標記檔），沒有 Agent Pets 條目時不動 |
| 8 | Low | README 拒絕文字與撤下時機不正確 | 兩份 README 改為實際字串與實際撤下時機 |

## 效能

- `main.ts` 事件熱路徑沒有新增 I/O。adapter server 的開關檢查讀取快取布林值，不讀偏好檔或系統登入項。external-only 抑制只對功能開啟時的 Claude `waiting-permission` 事件掃描記憶體中的 broker 請求。
- 檔案編輯的 realpath 檢查（同步）只在建立 Claude 編輯請求時執行，該路徑有速率限制，不在事件路徑上；最多往上找 64 層。
- 每個 app 版本第一次啟動時讀一次 `settings.json` 檢查是否需要升級，內容相同時不寫入。
- hook：只有 Claude 的相關事件才讀開關檔（一次 `lstat` + 小檔讀取）。輪詢有上限。功能開啟時，每次工具使用多一次本機 POST。
- 快速失敗實測（各 15 次取中位數，機器負載 50–140）：連線拒絕時 hook 總時間比 observe 模式多 25–94 ms（763 對 738 ms、613 對 519 ms），總時間主要是 Node 啟動與排程延遲。負載太高、雜訊大，未能證明一般負載下的 50 ms 目標，列為待確認。

## 殘餘風險

- **Windows**：要到 2026-11-09 之後才能實機驗證，已加入 `docs/ux-overhaul/windows-todo.md`。Claude Code 的 hook 直接以 `node.exe` 執行（不經會丟棄 stdout 的 `agent-hook.cmd`），理論上可用，但未驗證。
- **Claude Desktop／VS Code 擴充**：未實測；官方文件稱會觸發同樣的 hook。
- **真實 Electron 泡泡**：未在真實視窗目視確認（埠被已安裝的 app 佔用）。
- **終端機已回覆但工具還在執行**：該工具的 `PostToolUse` 之前泡泡仍會顯示；此時在泡泡回覆不會生效（Claude 已忽略 hook 輸出），權限紀錄會標示「終端機可能已先回覆」。在終端機拒絕並按 Esc 時，泡泡會在下一個工具呼叫、新提示或逾時時撤下。
- **同一 agent 平行的權限詢問**：若 Claude Code 對同一 agent 同時發出兩個不同的 `PermissionRequest`，較早的會被較新的撤下並交回終端機（安全的退回，但少了一次從寵物回覆的機會）。2.1.314 的互動模式一次只顯示一個權限對話框。
- hook 建立請求失敗（例如 409、逾時）時，系統通知與面板仍會正確提示回到終端機。
- `Write`／`Edit` 屬中風險，可用全域快捷鍵允許（依規劃）。
- 時序依賴 Claude Code 版本（本次 2.1.314），未來版本可能改變。
- 若其他工具也註冊 `PermissionRequest`，多個 hook 並行，由 Claude Code 決定誰的回覆生效（README 已說明）。

## 版號建議

**minor：1.11.0**。本階段改變 Claude adapter 的 permission capability 公開契約（observe → 可 respond），並擴大 Permission Control Plane 的安全邊界（新來源、新路由、hook 回寫決定）。版號等使用者確認後再改。
