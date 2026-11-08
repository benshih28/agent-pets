# Phase B：Token 用量明細（模型分布、本機 5 小時區塊、大檔串流、精確度標示、成就修正）

- 日期：2026-11-07
- 分支：`feat/token-usage-detail`（自 `origin/main` `75a574f`）
- 基準版本：`1.10.3`（本 phase 未修改版本）
- 建議版本：以 **patch 1.10.4** 發佈

## 範圍

1. **各模型明細**：解析 Claude Code `message.model` 與 Codex `turn_context`（以及部分版本 `session_meta`）的 `payload.model`，存進 History，並在歷史頁新增「模型分布」區塊。
2. **本機 5 小時區塊**：依本機紀錄算出每個 Agent 目前的 5 小時區塊（Token、已過／剩餘時間、每分鐘 Token），顯示在「用量」頁供應商額度下方，並標示「來自本機紀錄」。
3. **大型紀錄檔**：改為單一檔案代碼、1 MB 切片串流讀取；byte 預算用完時只讀該檔的一部分並記住 offset，新增時間預算，掃描回報 `pending` 後於插電時 3 秒內接續。
4. **精確度標示**：Codex、Claude Code 的 `tokenUsage` capability 改為 `exact`，兩份 README 的表格與說明同步。
5. **成就修正**：`one_million` 改為計入本機紀錄的精確用量，每則訊息只算一次，重新掃描也不會重複計算。

不在範圍內：美元成本、價格表、任何網路呼叫。

## 調查結果（與原本 survey 的差異）

- 原本描述的「16 MB 以上的檔案直接略過」**在 `main` 上已經不成立**：大檔早就以 `maxFileBytes` 為單位分次讀取。實際剩下的問題是：
  - 每次掃描的總 byte 預算用完時，整個下一個檔案會被 `filesSkipped` 延後（UI 顯示「因超出讀取預算暫未納入」）；
  - 每次讀取會把最多 16 MB 一次讀進記憶體；
  - 沒有時間預算，也沒有「預算用完就盡快接續」的排程，一般 tick 為 60 秒（電池 5 分鐘）。
- README 說所有 Agent 都是 `estimated` 並不正確：本機紀錄是逐則訊息的精確值，只有事件回報的 `tokenUsage` 是估算值。
- Codex／Claude Code 的 hook 本身不會送 `tokenUsage`；只有 OpenCode 或 Generic HTTP 會帶。成就原本只看事件上的 Token，所以這兩個 Agent 的用量完全沒有進到 `one_million`。

## 實作摘要

### 解析（`electron/local-usage.ts`）

- Claude：`message.model` → `record.model`。Codex：記錄最近一行 `turn_context.payload.model`（存在 parser state 的 `codexModel`），後續 `token_count` 沿用；跨切片、跨掃描都會保留。
- 模型 id 每段為 `[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}`，最多一個 `provider/model` 斜線，總長 ≤ 96；不得含 `..`、磁碟代號（`C:`），第一段也不能是本機路徑根目錄（`Users`、`home`、`root`、`var`、`tmp`、`private`、`mnt`、`media`、`opt`、`usr`、`etc`、`Volumes`、`Library`、`srv`）。`<synthetic>` 這類佔位值或像路徑的字串都存成空字串（顯示為「未標示模型」）。
- **時間戳**：沒有時間戳的行沿用同一個檔案裡前一筆真實時間戳；檔案裡完全沒有前一筆可沿用時，那筆紀錄就捨棄。不再使用檔案 mtime 當備援：mtime 每次附加都會變，會讓紀錄的日期往後移、跳過清除歷史的 cutoff，並在去重列被壓縮後重新計入成就。JSONL 只會附加，所以沿用的時間戳在重新掃描時是穩定的，History 與成就帳本都因此冪等。
- 每個檔案只開一次 handle（`O_NOFOLLOW` 並重新比對 dev/ino），以 1 MB 切片往前讀一次，只把尚未讀完的最後一行（上限 `maxLineBytes`=256 KB，超過就走既有的捨棄模式）帶到下一個切片。記憶體約為每個檔案 1 MB＋256 KB，不再是 16 MB。
- 預算：`maxTotalBytes`（64 MB）仍是每次掃描的上限，但剩餘預算不夠時只讀該檔的一部分；另外新增 `maxScanMs`（預設 4 秒，monotonic clock 可注入）。被延後的檔案保留原本的 cache entry，下一次掃描從存下的 parser offset 繼續。結果新增 `filesDeferred`、`pending` 與 `bytesRead`。
- **保證前進**：先走完所有 root 的目錄，再開始計算時間預算，所以走目錄的時間不會吃掉讀取預算；每次掃描無論時鐘如何都至少讀一個切片。各 root 的檔案以 round-robin 交錯處理，大量的 Codex 檔案不會餓死 Claude root。
- **延後的判定**：只有在 byte 上限或時間預算讓讀取停下時才算 deferred；檔案提早結束（被截短、讀到 0 byte）不算，避免永遠 `pending`。
- 演算法：每個 byte 只讀一次、每行只 `JSON.parse` 一次（沿用既有的子字串預篩）；接續讀取只會重讀尚未讀完的那一行。

### 排程（`electron/main/scan-schedule.ts`、`runtime.ts`）

- `localUsageCatchUpDelayMs(pending, onBattery, stalledScans)`：插電且 `pending` 時 3 秒後接續一次（略過 10 秒的面板節流）；用電池時等一般的 tick，避免第一次大量匯入讓硬碟一直醒著。連續 2 次接續掃描都讀到 0 byte 就停止接續，回到一般 tick，不會每 3 秒空轉。每次掃描本身仍每個檔案、每個切片都 yield 給 event loop。

### History（`electron/history.ts`）與遷移

**Migration v8 `history-token-model-breakdown`（純新增）**：

| 變更 | 內容 |
|---|---|
| 欄位 | `events.token_model TEXT NOT NULL DEFAULT ''` |
| 資料表 | `daily_model_stats(local_date, project_id, adapter_id, model, token_input, token_output, token_cache_read, token_cache_write)`，PK 為前四欄 |
| 索引 | `idx_history_events_token_time ON events(occurred_at) WHERE type = 'agent.token_usage'`（partial index，heartbeat 列不會維護也不會被掃到） |
| 回填 | 在同一個 transaction 裡以單一 set-based `INSERT … SELECT … GROUP BY` 從 events 重建 `daily_model_stats`；既有列的模型是空字串 |

- `ensureModelSchema()` 每次開啟都會檢查欄位、資料表與索引是否存在，所以 v8 標記遺失或只套用一半的資料庫也能自己修好；`v8` 標記則只寫一次。如果已經有 v8 標記，但 `daily_model_stats` 原本不存在（剛重建），或是空的而 events 裡有本機用量列，開啟時會重建彙總（兩個 `LIMIT 1` 的索引查詢）。
- 不會移除或改寫既有欄位，也沒有改既有 token 總量的計算方式。這次遷移只**新增一個欄位、一張彙總表與一個索引**，沒有其他變更。
- **模型回填**：`applyTokenUsage` 判斷「完全相同」時把模型也算進去，所以 App 重開後的第一次完整掃描，遇到 v8 以前匯入的列（模型為空）就會就地補上模型並修正 `daily_model_stats`；Token 總量不變。未知模型永遠不會覆蓋已知模型。
- 寫入：單筆時對 `daily_model_stats` 做一次 additive upsert；`recordTokenUsageBatch` 期間比照既有的 `dailyBatch` 在記憶體裡累加，每個 key 只寫一次。`clear()` 會一起清空，`rebuildDailyStats()` 會一起重建；保留策略與 `daily_stats` 一致（彙總長期保留、原始事件 90 天）。
- Summary 新增：
  - `models`：目前範圍（7／30／90 天）與專案篩選下，依 (adapter, model) 加總；走 PK range scan。
  - `usageBlocks`：每個 Agent 最後一個仍可能進行中的區塊；不受寵物與專案篩選影響（帳號層級）。

### 5 小時區塊規則（`src/utils/usage-blocks.ts`，純函式）

與 ccusage `blocks` 相同：

1. 依時間排序；第一筆用量開啟一個區塊，起點是該筆時間**向下取整到本地整點**，終點為起點＋5 小時。時區偏移由呼叫端明確傳入（`HistoryStore` 預設用該時刻的系統偏移，可注入），所以函式仍是純函式；+5:30、+5:45、+9:30 等時區的區塊也從本地整點開始。偏移傳 0 時就是 ccusage 原本的 UTC 整點。
2. 下一筆若距區塊起點 ≥ 5 小時，或距上一筆 ≥ 5 小時，就結束目前區塊，並用該筆（同樣取整點）開新區塊。
3. 進行中＝`now < 終點` 且距最後一筆未滿 5 小時。
4. 已過時間＝`now − 起點`（限制在區塊範圍內）；剩餘＝`終點 − now`；每分鐘 Token＝（新輸入＋輸出）÷ 從第一筆用量到 `now` 的分鐘數（不足 1 分鐘時為 0）。

Token 的計算基準與 History 主數字相同：新輸入＋輸出，快取另外記錄。只回看 24 小時，最多讀 50,000 列（新到舊，保留最新的）。

### 成就（`electron/achievements.ts`）

- **每個 Agent 只有一個資料來源**：Codex 與 Claude Code（adapter `codex`／`claude-code`，或 source `codex`、`codex-desktop`、`claude`、`claude-desktop`）一律以本機紀錄為準，live 事件上的 `tokenUsage` 不計入成就；OpenCode 與 Generic HTTP 沒有本機紀錄讀取器，維持使用事件回報的用量。這樣同一則訊息不會被兩個來源各算一次。
- **Migration v3 `achievements-local-token-ledger`（純新增）**：`local_token_usage(token_event_id PK, adapter_id, occurred_at, total_tokens)`、`occurred_at` 索引，以及 `achievement_metadata` 的 `local_token_total` 累計值。
- `syncLocalTokenUsage`：用 `digest(adapter + sourceEventId)` 作 key 做 upsert。重新掃描時值不變就是 0；Claude 串流訊息的用量變大時只加差額，因此重新掃描是冪等的。
- 壓縮：比 `now − (retentionDays + 1 天)` 更舊的去重列會分批刪除（每次 5,000 列），累計值保留。掃描器的 cutoff 至少是 `now − retentionDays`，這些紀錄不會再被送進來；比 horizon 更舊的紀錄一律忽略，所以不會重複計算。
- 本機紀錄描述的是這台電腦與帳號，不是某隻寵物，所以本機 Token 由所有寵物共用（與 History 相同）。`tokenTotal` 為寵物自己的事件 Token 加上本機累計值；只要寵物有估算列，品質就標為 `estimated`。
- 執行期：每批匯入（500 筆）只更新帳本；每次掃描結束後，如果帳本有變動，才為目前的寵物評估一次解鎖並取 progression snapshot（成就開啟時），不再每批各評估一次（第一次匯入 20 萬筆約 400 次）。進度條的廣播合併為 1 秒一次。
- 壓縮依 `occurred_at` 是安全的，因為本機紀錄的日期已經穩定（見「時間戳」）。

### UI

- 用量頁透過專用的 `history-usage-blocks` IPC（`getUsageBlocks`）讀取區塊：會檢查寄件者、不接受任何輸入、不會觸發掃描。原本借用 `getHistorySummary` 會啟動掃描，掃描的 `historyUpdated` 又觸發重新讀取，形成約 10 秒一次的循環；現在重新讀取以 1 秒 trailing debounce 合併，同時只會有一個請求。IPC 清單已重新產生。
- 用量頁：每張供應商卡片在額度下方顯示 `UsageBlockSummary`（區塊 Token、已過／剩餘、每分鐘 Token、「來自本機紀錄，逐筆精確」與開始時間，滑過可看規則說明）；沒有對應供應商卡片的 Agent 列在「本機用量」卡片。進度條使用 `ProgressTrack`，文字使用既有 token，沒有新的色彩字面值。
- 歷史頁：新的可收合區塊「模型分布」（`HistoryModelList.vue`），長模型名稱會以 `min-width: 0` 與省略號截斷；頁尾新增「仍在分批讀取」提示，`filesSkipped` 的文案改為「無法讀取」。
- 文案：`growth.*` 新增 13 個 key，`growth.scanSkipped` 改寫，繁中與英文都有。`agentDisplayName` 抽到 `src/utils/agent-label.ts` 供兩個元件共用。

## 驗證證據

| Gate | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通過，沒有新增依賴 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | main-process lint passed |
| `pnpm test:unit` | **897／897 通過**（基準 869，新增 28；第一輪 18 個，審查修正 10 個） |
| `pnpm test:coverage` | 涵蓋率 96.31% lines（門檻 85）。三次執行各有 1–2 個計時敏感測試逾時（`presentation-stdio`、`relaunch` 的 single-instance lock、MCP response），每次失敗的測試都不同；當時機器 load average 約 270（同時有其他 agent 在跑）。這些測試與相關原始碼在本分支沒有任何差異，單獨執行 5/5 通過。CI 需要重跑確認。 |
| `pnpm exec vite build` | 通過 |
| `pnpm check:bundle-size`、`check:bundle` | 通過 |
| `pnpm check:contrast`、`check:design:strict` | 通過（`byRule` 為空） |
| `git diff --check` | 通過 |

新增與調整的測試：

- `tests/usage-blocks.test.mts`（7 個）：整點取整、區塊終點後開新區塊、5 小時空檔、不同 Agent 互相獨立且與輸入順序無關、固定時鐘下的已過／剩餘／每分鐘 Token、結束後不再進行中、NaN 與空輸入。
- `tests/history.test.mts`：v7 → v8 遷移（刪掉欄位、資料表、索引與標記後重開兩次，驗證冪等、模型分組與 `EXPLAIN QUERY PLAN` 使用新索引與 PK）；模型彙總在串流更新、未知模型不覆蓋、batch、rebuild、clear 下都正確，live 事件不會進入區塊或模型。
- `tests/local-usage.test.mts`：Claude／Codex 模型解析與白名單、模型加總等於 Agent 加總、`turn_context` 與 `token_count` 跨切片、重新掃描補上模型、時間預算延後後總數不變、`onRecordsImported` 在重新掃描時送出相同 id；byte 預算測試改為驗證「部分讀取＋`pending`」。
- `tests/achievements.test.mts`：重新掃描冪等、串流增長只加差額並解鎖 `one_million`（`exact`）、跨寵物共用、未知 adapter 與太舊的紀錄被忽略、live Codex／Claude Token 被忽略、壓縮後累計值不變；既有兩個測試改用 OpenCode 事件。
- `tests/scan-schedule.test.mts`：插電接續、電池等待、連續無進度後停止接續。
- 審查修正的回歸測試：時鐘在讀取前就超過預算時每次掃描仍有進度；跨 root 交錯讓 Claude 不被 Codex 餓死；走目錄之後檔案被截短不算 deferred；沒有時間戳的行沿用前一筆、開頭沒有時間戳的行被捨棄、附加後重新掃描日期不變且不重新匯入；+5:30／+5:45／+9:30／−3:30 時區的本地整點；v8 標記存在但彙總表遺失或為空時會重建；模型 id 拒絕 `Users/name/x`、`home/…`、多段斜線、磁碟代號、`..`；帳本同步不評估、掃描結束評估一次；`history-usage-blocks` 會檢查寄件者且不觸發掃描。

所有測試都使用 `mkdtemp` 底下的假 home 與暫存 SQLite，不會讀取真正的 `~/.claude` 或 `~/.codex`，也不會呼叫 Keychain／safeStorage。

## 安全審查

- **檔案系統**：沿用既有的 root containment（lstat、realpath、symlink 一律略過、`(dev, ino)` 驗證快取）；新的讀取路徑同樣用 `O_NOFOLLOW` 開檔，並在開檔後重新比對 dev/ino，避免 stat 與 open 之間被換檔。沒有新增任何寫檔路徑。
- **記憶體上限**：每個檔案約 1 MB 切片加上最多 256 KB 的未完成行；每個檔案每次掃描的紀錄 map 受 `maxFileBytes` 限制；區塊查詢最多 50,000 列；成就帳本會壓縮到大約保留天數的範圍。
- **輸入驗證**：模型 id 有白名單與長度上限，在 main process 寫入前、讀出時都會再驗證一次；Vue 文字插值會自動跳脫。帳本只接受 `codex`／`claude-code` adapter，Token 數量沿用既有的 `safeToken` 上限。
- **隱私**：只存模型 id、雜湊後的 id 與數字。`cwd` 仍只在記憶體中用來解析專案；傳給成就帳本的物件雖然帶有 `cwd`，但帳本不會儲存。新的 log（`Local usage consumer failed`、`Achievement local token sync failed`）只輸出 error 物件，不含紀錄內容。
- **IPC**：新增一個唯讀 channel `history-usage-blocks`：只允許面板 main frame（`assertTrustedIpcSender`），不接受任何參數、不觸發掃描、不寫入任何東西，錯誤時回空陣列；preload 與 `electron-api.ts` 型別同步，`docs/security/ipc-inventory.md` 已重新產生並通過檢查。

## 效能審查

- 掃描：O(n) 單次前進讀取；接續時不重讀；總 byte 與時間都有上限，每個切片都會 yield。
- 寫入：batch 中每個 (date, project, adapter, model) 只寫一次 `daily_model_stats`；非 batch 時每筆多一次 additive upsert，只發生在本機紀錄匯入，不在 hook 熱路徑上。
- 讀取：`models` 走 PK range scan；`usageBlocks` 走 partial index，heartbeat 列不會被掃到。沒有 N+1 查詢。
- 成就：每筆紀錄 1 次 PK 查詢加最多 1 次寫入，每 500 筆一個 transaction；進度廣播已合併。

## 殘餘風險與已知缺口

- **區塊是本機推算**：起點以本地整點對齊；跨越夏令時間切換的那一個區塊，起點用的是第一筆用量當下的偏移。如果連續使用超過 24 小時都沒有 5 小時空檔，區塊起點會從回看窗口裡的第一筆重新對齊。區塊也可能與供應商實際的額度時段不同，UI 已經說明這一點。
- **清除歷史後**：區塊與模型分布只會根據清除之後的紀錄重新計算。
- **模型回填**要等 App 重開後第一次完整掃描（掃描到的檔案）才會發生；超過保留天數或在清除 cutoff 之前的列會一直顯示為「未標示模型」。
- **沒有時間戳的開頭行**：檔案裡第一筆可匯入的行如果沒有時間戳，會被捨棄（實務上 Claude Code 與 Codex 的紀錄行都有時間戳）。
- **成就帳本**：如果匯入當下成就資料庫無法使用（正在啟動重試），那批紀錄要等下次 App 重開時的完整重新掃描才會補進來。本機 Token 由所有寵物共用，用量夠時所有寵物都能解鎖 `one_million`，這是刻意的設計。舊版本已經記錄在 `token_usage` 裡的 Codex／Claude live 事件 Token 會保留，不回溯移除（實際上這兩個 hook 不會送 Token，影響應該接近 0）。
- **History 的 live 事件 Token**：History 對 live 事件 `tokenUsage` 的處理沒有改（不在本 phase 範圍）。如果有第三方整合以 Codex／Claude source 回報 Token，History 的每日總數仍可能與本機紀錄重複；成就已經不會重複計算。
- **Codex 模型格式**：沒有真實的 rollout fixture，`turn_context.payload.model` 是依已知格式實作並以合成資料測試。如果某個 Codex 版本不寫這一行，模型會顯示為「未標示模型」，Token 總量不受影響。
- **沒有手動跑 Electron**：用量頁與歷史頁的實際畫面（淺色／深色、長模型名稱、窄面板）只做了型別、建置與 design-token 檢查，需要使用者實機看一次。
- **`test:coverage` 在高負載下不穩定**：見驗證表。本機無法在低負載下跑出一次全綠的 coverage，需要以 CI 結果為準。

## 版本建議

**Patch**。遷移是純新增：一個欄位、一張彙總表、一個 partial index，加上成就資料庫的一張去重表；沒有修改或移除既有欄位，沒有新的公開契約或安全邊界（只新增一個唯讀、檢查寄件者的 IPC）。以 patch **1.10.4** 發佈。本 phase 沒有修改 `package.json`，等使用者確認後再更新版本。
