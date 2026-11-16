# 修正：agent 已經停下，寵物仍顯示進行中

日期：2026-11-11

## 現象

Codex Desktop 的對話已經結束，寵物與面板卻還有一個 session 停在 thinking，要等 15 分鐘才變成離線。

## 原因

agent 不保證會送結束事件，而原本的設計只靠結束事件離開「進行中」。本機查到的情況：

| 情況 | 證據 |
| --- | --- |
| Codex Desktop 的背景記憶整理執行緒（工作目錄 `<CODEX_HOME>/memories_v2`）會觸發 hook，結束時直接關閉，不送 `Stop`／`SessionEnd` | `~/.codex/logs_2.sqlite`：最後訊息後 1 秒 `op=Shutdown`；`history.sqlite` 的最後一筆是 thinking |
| 使用者按 Esc 中斷、或拒絕工具，Claude Code 與 Codex 都不送 `Stop` | Claude 紀錄檔有 62 筆 `[Request interrupted by user…]`；Codex rollout 有 19 筆 `turn_aborted` |
| session 被關閉或當機 | Claude 有 session 最後一筆是工具結果，之後沒有任何紀錄 |

過去 7 天真正「結束時還停在進行中」的 session：Claude 3／87、Codex 9／44（已扣掉測試探針與記憶執行緒）。

這是同類工具普遍遇到的問題（[openai/codex#22858](https://github.com/openai/codex/issues/22858)、[tether#310](https://github.com/maxthomas95/tether/pull/310)、[houston#149](https://github.com/theogmiguel/houston/issues/149)、[wmux#2673](https://github.com/openwong2kim/wmux/issues/2673)、[catnotch#36](https://github.com/thecharydev/catnotch/issues/36)）。它們的做法分三類：讀終端機畫面、讀對話紀錄檔結尾、純逾時。我們不是終端機，所以採用後兩類，並沿用 tether 的原則：補上的狀態是「待命」不是「完成」，真實事件進來直接蓋過，不重複通知。

## 修正

不分 agent、不分狀態，共用一條事件流程。

### 1. 每個狀態的期限收進狀態 registry

`AGENT_STATE_POLICY` 每一列多了 `quiet`：安靜多久後變成什麼。`src/utils/session-lifecycle.ts` 只負責照表套用，原本兩個寫死的計時邏輯（success 4 秒回 idle、其他 15 分鐘轉離線）合併成 `sessions.ts` 的一個清理。

| 狀態 | 期限 | 變成 | 與原本的差異 |
| --- | --- | --- | --- |
| success | 4 秒 | idle | 相同 |
| thinking | 5 分鐘 | idle | 原本 15 分鐘後直接離線 |
| tool-running、waiting-input、error、idle | 15 分鐘 | offline | 相同 |
| waiting-permission | 15 分鐘（還有未回覆的請求時不到期） | offline | 相同 |
| offline | 45 分鐘 | 移除 | 相同 |

期限一律從最後一個真實事件算起。降級只改顯示：不發通知、不播音效、不改 `lastSeenAt`；之後若有真實事件，工作計時沿用原本的起點。

thinking 的 5 分鐘來自本機歷史資料：Claude 6418 筆「之後還有後續事件」的 thinking 中，99.9% 短於 2.3 分鐘，超過 5 分鐘的只有 3 筆。tool-running 不縮短：長時間的 build 是合法的，中斷改由下一項依事實判斷。

### 2. 從對話紀錄檔補上結束事件

- `electron/transcript-turn-end.ts`：找到 session 的紀錄檔，只讀結尾 64 KB，判斷回合是否已結束。Claude 看最後一則訊息是不是中斷訊息；Codex 看最後一個回合事件是 `turn_aborted`／`task_complete` 還是 `task_started`。每個家族必須在 `TRANSCRIPT_FORMATS` 明確填格式或 `null`。
- `electron/main/turn-end-watcher.ts`：每 5 秒看一次主程序的 session 鏡像。狀態是進行中（狀態 registry 的 `historyOutcome === 'open'`）、最後一個事件已過 8 秒、紀錄檔有變動時才讀檔；結束紀錄的時間不早於最後一個事件（容許 2 秒）才採信。
- 採信後送出一個正規的 `idle` 事件（`originalEvent: 'AgentPetsTurnEnded'`），經由 `event-server.ts` 新增的內部入口走跟 hook 事件相同的流程，寵物、面板、歷史、通知都收到同一個事件。

安全邊界：檔案位置由主程序從 agent 設定目錄與 session id 自己組出來，不接受事件帶來的路徑；session id 先過白名單才用來比對檔名；不跟隨最後一層符號連結；對話內容只在判讀函式內使用，不保存、不記錄。主程序原本就為了統計 token 讀取同一批檔案。

### 3. Codex 記憶執行緒的過濾（上午的修改，保留）

`integrations/agent-hook.mjs`：Codex 事件的 `cwd` 在 `<CODEX_HOME>/memories` 或 `memories_v<數字>` 底下時不送事件。這是針對單一 agent 的規則，保留的理由是它處理的是另一件事：內部執行緒不該顯示成使用者的 session。它不再是「卡住」的唯一防線，第 1 項已涵蓋。

## 驗證

| 項目 | 結果 |
| --- | --- |
| `vue-tsc --noEmit` | 通過 |
| `pnpm lint` | 0 個錯誤（52 個既有警告） |
| `pnpm test:unit` | 1811 個測試：1768 通過、37 略過、6 失敗 |
| 新增測試 | `session-lifecycle`（7）、`transcript-turn-end`（9）、`turn-end-watcher`（9）、store 特性測試 2 個、hook 對應 3 個 |
| 真實紀錄檔（唯讀） | Claude 300 個、Codex 73 個：只讀檔尾的判讀與整檔讀取 0 筆不符；每次讀取平均約 2 毫秒 |
| 隔離的 app 端到端 | 10 項全過（見下） |
| 打包的可攜版＋真實的 agent | Claude Desktop 與 Codex 各中斷一次，都回到 idle（見下） |

6 個失敗全部是 `EPERM: operation not permitted, symlink`：這台 Windows 沒有建立符號連結的權限，失敗的是既有的符號連結測試（hook-config、pet-import、project-mcp、edit-risk），與這次改動無關。

端到端用 `scripts/e2e-isolated-electron.mjs --offscreen` 啟動（暫時 HOME、自己的埠 27473–27475、視窗在螢幕外且不取得焦點；實測視窗 x≈-18754、`document.hasFocus()` 為 false），送事件後在暫時 HOME 寫入紀錄檔，再讀主程序鏡像與兩個視窗的 store：

- Claude 思考中中斷、Claude Desktop 拒絕工具後中斷、Codex `turn_aborted`、Codex Desktop `task_complete` 但沒送 Stop：都在 20 秒內回到 idle。
- 對照組三項維持原狀：紀錄檔沒有結束紀錄的長時間工具、只有上一回合中斷紀錄的新回合、沒有紀錄檔的 session。
- 補上 idle 之後再送真實事件，狀態照常被蓋過。

### 打包版實測（2026-11-11）

`pnpm build` 產生的可攜版 `AgentPets-1.13.2.exe`，使用者在真實的 Claude Desktop 與 Codex 對話各按一次中斷：

| agent | 最後一個 hook 事件 | 紀錄檔的中斷時間 | 補上 idle 的時間 | 中斷到 idle |
| --- | --- | --- | --- | --- |
| Claude Desktop | 10:48:06.491（thinking） | 10:48:08.661 | 10:48:19.484 | 10.8 秒 |
| Codex | 10:48:28.387（thinking） | 未取得 | 10:48:39.345 | 距最後事件 11.0 秒 |

Codex 那筆沒有對到 rollout 裡的 `turn_aborted` 時間：Windows 對仍被開啟的檔案不會即時更新修改時間，查核腳本用修改時間篩選檔案而漏掉它；補上的事件本身有記錄在歷史資料庫。

這次實測抓到一個問題並已修正：補送的事件沒有帶 `adapterId`，歷史資料庫把它記成備用 adapter（`generic-http`）底下的另一筆 session，原本那筆仍停在 thinking。寵物與面板的顯示不受影響（它們用來源＋session id 辨識）。修正後主程序的 session 鏡像會保留 `adapterId` 並帶進補送的事件，`turn-end-watcher` 測試新增一項用真的 `HistoryStore` 確認兩者落在同一筆。使用者的歷史資料庫因此留有兩筆 `generic-http` 的 idle 紀錄；經使用者同意後已手動刪除（2 筆 session、2 筆事件、2 筆時間軸、2 筆搜尋索引，`PRAGMA quick_check` 為 ok）。

修正後重新打包並重測（同一天 11:01 起）：

| agent | 最後一個 hook 事件 | 紀錄檔的中斷時間 | 補上 idle 的時間 | 歷史紀錄 |
| --- | --- | --- | --- | --- |
| Codex | 11:01:54.641（thinking） | 未取得 | 11:02:06.439 | 記在原本那筆（`codex`），結局維持 success |
| Claude Desktop | 11:02:20.035（thinking） | 11:02:23.947 | 11:02:31.662（中斷後 7.7 秒） | 記在原本那筆（`claude-code`） |

重測期間沒有新增 `generic-http` 的紀錄。Claude 那個 session 在 idle 之後 1.7 秒使用者送出新的提問，狀態照常回到 thinking，之後的工具事件也正常。

## 未驗證與殘留風險

- 真實 agent 只測了「思考中中斷」各一次；工具執行中中斷、拒絕權限、Claude Code CLI 與 Codex CLI 沒有用真實 agent 測（隔離的端到端有涵蓋對應的紀錄形狀）。
- 紀錄檔格式不是公開契約。格式改變時判讀會回到「還在進行」，行為退回只有狀態期限；不會誤判成結束。
- `transcript_path` 為空是否能用來辨識 Codex 的內部執行緒，還沒驗證（需要在真實的 Codex Desktop 執行時記錄 hook payload）。成立的話可以取代第 3 項的目錄名稱規則，並涵蓋另一個背景執行緒（工作目錄是使用者專案、會正常結束，目前仍會短暫顯示成一個 session）。
- 工具執行中 agent 程序被強制結束：紀錄檔沒有結束紀錄，仍要 15 分鐘才轉離線。
- 找 Claude 紀錄檔要逐一檢查 `projects` 底下的專案資料夾，本機冷啟動量到約 0.6 秒（非同步、每個 session 只找一次）。專案資料夾非常多時會更久。
- macOS／Linux 沒有實測。
- 沒有處理 Codex 的 `Interrupt` hook 事件（官方文件有列，版本依據只有第三方文章）。第 2 項已涵蓋中斷，之後可以再加來縮短那幾秒延遲。
- 另外發現歷史資料庫會因為 `cwd` 改變把同一個 session 拆成多筆（240 筆紀錄實際是 87 個 session），與本次無關，另案處理。

## 版本

使用者確認後升為 1.14.0（minor）：主程序新增一類讀取（agent 對話紀錄檔的結尾內容），屬於安全邊界的變動；另外新增了主程序內部送事件的入口，thinking 的期限行為也改了。
