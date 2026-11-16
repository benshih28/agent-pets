# 線 1：hook 事件補齊與送達可靠性（1.13.2 整合輪）

基準：`claude/hooks-reliability-73650e`，從 `38a75fa`（1.13.1）開始。不在本線升版，由整合線統一升 1.13.2（patch）。

## 範圍與結論

| 項目 | 結論 |
|---|---|
| 1. Claude Code hook 事件補齊 | 新增 `PreCompact`、`PostCompact`；`Notification` 改用結構化的 `notification_type`；修正 `StopFailure` 從未補給舊安裝 |
| 2. 冷啟動事件遺失 | 標記改由 `main.ts` 的第一個 import 寫入；Electron 載入 main.js 之前的空窗無法再縮小（見下方量測） |
| 3. 啟動期間的權限呼叫 | 實作：只重試 `request`、只在連線被拒且標記有效時，重試時間從等待秒數扣除 |
| 4. `setup.ts` 同步檔案操作 | App 內的安裝、移除、修復與啟動升級改為非同步並排進同一條佇列；CLI 輸出逐字不變 |
| 5. hook 字面值人工同步 | 新增 `tests/hook-literal-contract.test.mts`，清單寫進 `docs/dev/agent-sources.md` |

### 1. 事件

依官方 hooks 文件（code.claude.com/docs/en/hooks）核對事件名稱與 stdin 欄位，不新增 `AgentState`：

| 事件 | 狀態 | 理由 |
|---|---|---|
| `PreCompact` | thinking | 壓縮期間 agent 在工作 |
| `PostCompact`（`trigger: manual`） | idle | 手動 `/compact` 結束回到提示字元，不會觸發 `Stop` |
| `PostCompact`（其他） | thinking | 自動壓縮發生在回合中，回合繼續 |
| `Notification` 的 `notification_type` | `permission_prompt` → waiting-permission；`idle_prompt`、`elicitation_dialog`、`elicitation_url_dialog`、`agent_needs_input` → waiting-input；`elicitation_complete`、`elicitation_response` → thinking；其餘文件記載的類型忽略 | 沒有這個欄位的舊版仍比對 `message` 文字 |

刻意不接的事件：
- `SubagentStart`／`SubagentStop`：背景 subagent 結束時主回合可能早已結束，會把閒置的 session 標成工作中。前景 subagent 的工具事件本來就帶同一個 `session_id`。
- `PermissionDenied`、`Elicitation*`：價值低，`Notification` 已涵蓋等待狀態。
- Codex 的 `PreCompact`、`PostCompact`、`Interrupt`：Codex 以 hash 記錄每個 hook 定義的信任狀態，新增的條目要使用者到 `/hooks` 重新審核才會執行。舊版 Codex 遇到不認得的事件 key 會怎樣，文件與原始碼都查不到，最壞情況是整份 `hooks.json` 失效。所以這次不加。
- OpenCode：文件列出的是 V2 plugin API，`session.compacted` 不在文件中，不改。

舊安裝會在新版本第一次啟動時補上新事件，沿用既有的每版本一次升級並留備份。升級清單改由安裝清單推導，避免再漏掉事件（`StopFailure` 就是這樣漏掉的）。

### 2. 冷啟動

做法、量測與不做的理由見 [docs/dev/hook-delivery.md](../dev/hook-delivery.md) 的「冷啟動空窗再縮小（1.13.2）」。量測期間其他工作線同時在跑測試，load average 250–386，所以遺失數不能比較。標記寫入前的那段（main.js 開始載入 → 寫入標記），中位數從 1159 ms 降到 759 ms。

### 3. 權限重試

- 只有建立請求（`request`）會重試，而且只在 ECONNREFUSED 時重試，這時請求完全沒送出。逾時、4xx、5xx、409 都不重試；`decision`、`result`、`resolved*` 也不重試，所以不會重放已回覆的請求。
- 每 100 ms 一次，最多 5 秒，nonce 不變。`electron/main.ts` 先建權限伺服器再建事件伺服器，所以事件埠的標記能涵蓋權限埠的啟動。
- 時限：重試花掉的秒數（無條件進位）從送給 broker 的 `ttlSeconds` 扣掉，輪詢期限也用這個 ttl 算。最壞情況仍是 129.5 秒，低於 135 秒的 hook 時限。第一次嘗試不扣，正常情況的 ttl 仍等於設定值。

### 4. 非同步安裝

- `safe-config-write.ts`、`atomic-file-write.ts`、`fs-rename.ts` 各加了非同步版本。不得覆寫無法解析的檔案、0600 備份、同目錄暫存檔與 rename、跟隨 symlink、大小上限，這些規則由同步與非同步版本共用同一組純函式，兩邊不會各改各的。同步版留給其他模組使用。
- `hook-config.ts` 的檔案層函式與 `setup.ts` 的 install／uninstall／repair／upgrade 只有一份非同步實作。CLI（`integrations/install.mjs`）改成 `await`，輸出與結束碼逐字相同：用暫存 HOME 比對 13 種情境，包括 `--list`、各 target、無法解析的 settings.json 與 `--uninstall --everything`。
- 所有安裝操作排進同一條佇列，兩個面板請求不會交錯寫同一個檔；前一個失敗不會擋住後面的。
- 啟動時 token 仍同步建立，事件與權限伺服器馬上要用；其餘檔案更新改到背景執行。

## 驗證

| 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | 通過 |
| `pnpm run check:design:strict` | 通過（raw-colors 0） |
| `pnpm test:unit` | 1605 個：1602 通過、1 略過、2 失敗。失敗的是 `agent-hook-delivery` 既有的時限測試（hook 1.18 s／2.46 s，上限 1／2 s）。load average 約 210–300 時，HEAD `38a75fa` 單獨跑同一檔案也一樣失敗（1.20／1.79 s），屬於負載造成，不是回歸。本線新增 `agent-hook-mapping`（20）、`hook-literal-contract`（12）、`safe-config-write-async`，並擴充 `claude-permission-hook`（+4）、`setup-install`、`hook-config`、`hook-startup-marker`（+2） |
| `tests/ipc-inventory.test.mts` | 包含在 test:unit，沒有新增 IPC 頻道 |
| `git diff --check` | 通過 |

隔離 Electron 分段驗證（`node scripts/e2e-isolated-electron.mjs`，隔離 HOME，埠 29373–29375，假 `safeStorage`）：

- 真實 hook → 事件埠 → store → 畫面：`scripts/e2e-real-hook.mts` 加入 `PreCompact`／`PostCompact`（auto、manual）與帶 `notification_type` 的 `Notification`，共 14 個事件。`--rounds 2` 的 28 個全部畫到寵物上。第一次單輪有一個 `Stop` 顯示 idle：極高負載下讀取時已超過 `SUCCESS_DISPLAY_MS`（4 秒），重跑後沒有重現。
- 啟動升級：把隔離 settings.json 刪到只剩舊事件，並放一個使用者自己的 `PreCompact` hook，再以 `--reuse-root` 重啟。app 補上 `StopFailure`、`PreCompact`、`PostCompact`，使用者的 hook 保留，留下一份 `settings.json.agent-pets-bak-*`。
- 冷啟動：舊版與新版交錯各 3 輪，數字見開發文件。

## 安全審查

- 權限重試只在請求沒有送出時發生，沿用同一個 nonce，所以不會建立重複的請求，也不會消耗別的程序的決定。重試只會縮短等待時間，不會延長 hook 的總時限。
- 啟動標記的內容與權限不變（pid、0600、先刪再 `wx`、移除前核對 pid）。提早寫入只改變寫入時間點，路徑與埠的計算有測試確認與原本相同。
- 安裝佇列消除了非同步後才會出現的「讀 → 讀 → 寫 → 寫」互相覆蓋。所有寫入仍經過備份與原子寫入。
- `Notification` 的對照表用 `Object.hasOwn` 查，`constructor` 之類的字串不會命中原型。
- 沒有新增 IPC、網路端點或檔案位置。新事件送出的欄位與既有事件相同，不帶 `compact_summary`、`custom_instructions` 或 notification 內文。

## 效能

- 熱路徑：app 開著時 hook 的 I/O 不變。新事件只在壓縮時觸發，次數很少。
- 主程序：面板的安裝、移除、修復與啟動升級不再同步讀寫磁碟。Windows rename 重試的退避改為非同步，不再用 `Atomics.wait` 凍結事件迴圈。
- 順手做的演算法調整：健康檢查改成每個 hook 設定檔只解析一次（原本兩次）；判斷共用腳本是否還被引用時，各來源平行讀取；`uninstallCodex` 少一次 `exists`；部署資料夾清理改為平行刪除。

## 順手修正（範圍外）

- `StopFailure` 不在升級清單，舊安裝從未收到這個事件。
- 權限建立的第一次嘗試會把 ttl 少算 1 秒（進位），單元測試抓到後已修正。
- 測試的假權限伺服器關閉時，一併關閉連線，避免晚開的伺服器讓測試卡住。
- `scripts/e2e-real-hook.mts`（線 4 範圍）：改成 `await` 安裝程式，並加入新事件。`docs/dev/e2e-without-keychain.md` 也跟著更新。

## 複審修正（總控複審 38a75fa..88a9676）

1. 設定檔讀改寫：`writeConfigSafelyAsync` 收呼叫端最初讀到的原文。「未變更」的判斷與備份內容都用這份原文；暫存檔寫好後、rename 前，再讀一次目標檔逐字比對，不同就丟掉暫存檔並重跑一次讀 → 合併 → 寫（`withConfigConflictRetry`）。第二次仍不同，就以 `changed_during_write` 拒絕（面板顯示 `config_changed`），檔案不動，也不留備份。`hook-config.ts` 所有讀改寫函式，以及 Codex `config.toml` 的開啟與移除，都走這個流程。比對到 rename 之間仍有極小的空窗：rename 是原子操作，但不是 compare-and-swap。
2. 啟動標記：已有夠新（20 秒內）而且擁有者 pid 還活著的標記時，不覆蓋。取得單一實例鎖之後呼叫 `claim()` 接手，處理 `--relaunch` 時舊實例還活著的情況。`clear()` 只會刪除自己的標記。
3. token 改走 `writeFileAtomic`／`writeFileAtomicSync`（0600、暫存檔＋rename、fsync），hook 不會再讀到被截斷的空 token。順手修正：token 路徑是 symlink 或不是一般檔案時，檢查的錯誤原本會被吞掉，造成寫入穿過 symlink；現在會拒絕。
4. `serializeInstaller` 改成 `then(() => task(), () => task())`，前一個結果或錯誤不會傳進下一個工作。
5. 健康檢查（`inspect*`、`hookScriptIsCurrent`、`openCodePluginIsCurrent`、`agentPresence`、`agentConfigDirStatus`）改成非同步，各自獨立的讀取平行進行。只剩測試在用的同步 `fileHasAgentPetsHooks`、`configuredHookExecutable` 已移除。
6. `agent-hook-delivery` 的時限測試改成相對判斷：同一個測試內先量空 node 程序的啟動時間當基準，再加上不足以容納被排除行為（5 秒重試、3 秒回應）的餘裕。

複審後又在負載 16–224 時交錯量了 3 輪冷啟動：標記寫入前的空窗 510／996／828 → 412／702／379 ms，遺失 25／75／31 → 24／73／27（見開發文件）。隔離 Electron 重新建置後跑真實 hook `--rounds 2`，28 個全部畫到寵物上，埠開始監聽後標記也已移除。

複審後驗證：`vue-tsc`、`lint`、`check:design:strict`、`git diff --check` 都通過。`pnpm test:unit` 共 1620 個：1619 通過、1 略過、0 失敗（load average 約 44–126）。CLI 13 種情境的輸出與基準逐字相同。跨線改動：`src/locales/onboarding/*.json` 新增一個 key `onboarding.errorConfigChanged`，`src/components/SetupWizard.vue` 加一行錯誤碼對照，`src/types/agent-adapter.ts` 加 `config_changed`。

## 殘餘風險

- Electron 程序建立到 main.js 開始執行之間（一般負載約 0.4 秒）送出的事件仍會遺失；不同 hook 程序之間的順序也可能顛倒。
- 冷啟動量測時，其他工作線一直在跑測試，負載沒有回到平常的水準（最低 16）。
- Claude Code 舊版不認得 `PostCompact` 時會怎麼處理，沒有實測（`StopFailure` 先前也是同樣情況加入）。真實 `claude` CLI 沒有在本線執行。
- Codex 的新事件沒有接，Codex 壓縮與中斷期間的寵物狀態不變。
- Windows 的非同步 repair（`rewriteInstalledAgentPetsHooks` 改用 `nodeResolver.resolve()`）與 rename 退避沒有在 Windows 實測。

## 版本

建議 patch。由整合線統一升版。
