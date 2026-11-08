# 效能審查（feat/ux-overhaul，唯讀靜態分析）

範圍：`git diff main..HEAD`（383 檔，+32k/-5k 行）與其呼叫的熱路徑。
方法：只讀程式碼，未啟動 App、未量測。下文所有「耗時」「次數」都是依程式碼與常數推算的**估計值**，並標明假設；上線前請用 `pnpm bench:lag`（`scripts/bench/event-loop-lag.mjs`）驗證。

## 總覽

| 嚴重度 | 數量 | 項目 |
| --- | --- | --- |
| High | 5 | H1 事件廣播扇出、H2 每事件 SQLite 寫入放大、H3 events 無執行期 prune、H4 成就 readContext 全表掃描、H5 v6 遷移全量載入 |
| Medium | 5 | M1 presentation status 每事件 IPC、M2 本機用量匯入阻塞、M3 每 60 秒全樹 stat、M4 面板視窗啟動即載入、M5 mousemove 未節流 |
| Low | 9 | L1–L9（見文末） |

事件量級基準（取自 `electron/event-server.ts`、`electron/event-rate-limit.ts`）：每 session 每 10 秒 500 筆、全域 2000 筆／10 秒，也就是上限約 200 事件／秒；實際 Claude Code／Codex 工具呼叫密集時，常見 5–30 事件／秒。下面的「每事件」成本都要乘上這個頻率。

已確認沒問題、不需要動的部分（避免重複勞動）：
- `StatementCache`（`electron/sqlite-statements.ts`）已讓固定 SQL 只 prepare 一次，有限集合，無洩漏。
- `AgentSessionIndex` 用 indexed heap 做逐出，O(log n)，上限 200。
- `useNow`（`src/composables/useNow.ts`）是共用 1 Hz 時鐘，只有可見且有訂閱者才跑；`SessionElapsed` 只重繪自己的標籤。這個設計正確。
- `local-usage` 已改成 offset 增量讀取、非同步、每 25 個項目讓出事件迴圈、依 cutoff 略過舊檔；`fileCache` 上限 2000 並以 Map 插入序做 LRU。
- `getSummary` 單次範圍掃描 + covering index，演算法正確（見 H2 對該索引的另一面）。
- 所有 `onXxx` IPC 訂閱在 `App.vue`、`StatusPanel.vue`、`StatusPanelHistory.vue`、`usePluginPanelController.ts` 的卸載路徑都有對應的取消函式，未發現監聽器洩漏。
- `permission-broker`、`attention-tracker`、`session-snapshot`、`event-rate-limit`、`project-routing.pathCache` 都有明確上限。

---

## High

### H1　每個 hook 事件都對兩個視窗廣播 progression，並觸發 History 分頁重新抓取

位置：
- `electron/main.ts:384-388`（`onEvent` 內呼叫 `broadcastProgression(progressionResult.snapshot)`）
- `electron/main/runtime.ts:2501-2509`（`broadcastProgression`）、`2594-2598`（`broadcastHistoryUpdated`）
- `electron/main.ts:411-414`（`historyStore.recordEvent` 回傳 true 就 `broadcastHistoryUpdated()`）
- `src/components/status-panel/StatusPanelHistory.vue:258-262`（`onHistoryUpdated` → `refreshHistory()`）

現況：
- `onEvent` 每個事件都執行 `broadcastProgression(snapshot)`，不論 XP 有沒有變。heartbeat（`thinking`／`tool-running`）絕大多數事件 `awards.length === 0`，快照內容與上一筆完全相同，卻仍對 pet、panel 兩個視窗各做一次 structured clone + IPC。
- `recordEvent` 對每個非重複事件都回傳 `true`，所以 `historyUpdated` 也是每事件一次、兩個視窗各一次。
- `StatusPanelHistory` 在 mounted 之後（一旦造訪過 History 分頁，元件就保持掛載，見 `StatusPanel.vue` 的 `visitedTabs`）每收到一次 `historyUpdated` 就在 `props.active` 時 `invoke('history-summary')`。唯一的節流是 `historyLoading` 旗標，等於「前一個 invoke 回來就立刻再發下一個」，最壞是每事件一次 round trip。
- 每次 `history-summary` 在主行程做：`getSummary`（範圍掃描最近 2×span 天，span=90 時 180 天 × 專案 × adapter，約數百到數千列，JS 端折疊）、`quota_snapshots` 讀取並 `parseQuotaSnapshot`、`getDiagnostics`，再 structured clone 回傳。另外 `history-summary` handler 還會呼叫 `refreshLocalUsage()`（有 10 秒節流，OK）。
- 面板視窗被隱藏時也照收照處理：`broadcast*` 都沒有檢查 `isVisible()`。

頻率與量級：5–30 事件／秒 × 2 視窗 × 2 種廣播 = 20–120 個 IPC／秒；History 分頁開著時再加上最多等量的 `history-summary` 往返，每次主行程同步工作估計 0.3–2 ms（180 天 × 多專案時偏高）。

更好的做法：
1. progression：只在 `awards.length > 0` 或 `snapshot.updatedAt`／`totalXp`／`currentStreak` 與上次已廣播值不同時才送。O(1) 比較，heartbeat 路徑降為 0 個 IPC。
2. historyUpdated 改成「尾端節流」：事件只標記 dirty，合併成每 1–2 秒最多一次（現成的 `createLatestValueCoalescer` 搭配 `setTimeout` 排程器即可，不需要 setImmediate）。
3. 主行程對隱藏的面板視窗不送 `historyUpdated`／`achievementsUpdated`，面板開啟時（`panelOpened`）renderer 再主動抓一次。
4. renderer 端 `onHistoryUpdated` 加 trailing debounce（約 500 ms）。

草稿：
```ts
// runtime.ts
let lastBroadcast = ''
export function broadcastProgressionIfChanged(s: ProgressionSnapshot) {
  const key = `${s.petId}:${s.totalXp}:${s.currentStreak}:${s.updatedAt}`
  if (key === lastBroadcast) return
  lastBroadcast = key
  broadcastProgression(s)
}
const scheduleHistoryUpdated = createLatestValueCoalescer<void>(
  () => broadcastHistoryUpdated(),
  cb => { setTimeout(cb, 1000).unref?.() },
)
```
預期：廣播數由 O(事件數) 降為 O(XP 變動數 + 秒數)，heartbeat 路徑的 IPC 成本趨近 0。

---

### H2　每個事件的 SQLite 寫入放大（兩個同步 commit、重複的 ensurePet 寫入、select-then-upsert、過寬索引）

位置：
- `electron/history.ts:231-388`（`recordEvent`）、`745-792`（`updateDailyStat`）、`1083-1103`（`transaction`）、`796-798`（PRAGMA）
- `electron/progression.ts:144-193`（`handleEvent`）、`343-353`（`ensurePet`）、`395-411`（`writeActivity`）
- `electron/history.ts:913-915`（`idx_history_events_completion_identity`）、`951-957`（`idx_daily_stats_summary_cover`）

現況（每個事件，全部在主行程、同步）：
1. `progression.handleEvent`：1 次 `BEGIN IMMEDIATE ... COMMIT`（`writeActivity` UPSERT）。另外 `getSnapshot` 被呼叫 2 次（`before`、結尾），每次都先 `ensurePet`，而 `ensurePet` 是兩個 `INSERT OR IGNORE` 寫入語句，加上交易內再一次 `ensurePet`，所以一個事件有 6 個多餘的寫入語句（autocommit 下每個都要取寫鎖並走一次空 commit）。
2. `history.recordEvent`：另一個 `BEGIN IMMEDIATE ... COMMIT`，內含：`sessions` 讀、（success 才有）`events` 查詢、`events` INSERT、`sessions` UPSERT、`updateDailyStat`（先 SELECT 再 INSERT...ON CONFLICT，共 2 個語句）。
3. 成功事件或帶 token 的事件再多一個 achievements 交易（見 H4）。
4. 整個專案沒有 `PRAGMA synchronous`；WAL 模式下預設 FULL，每次 COMMIT 都 fsync WAL。熱路徑每事件至少 2 次 fsync（估計每次 0.2–3 ms，視磁碟而定）。`scripts/bench/event-loop-lag.mjs` 只量 `HistoryStore`，沒包含 progression 與廣播。
5. 索引放大：`events` 每筆 heartbeat 要維護 5 個 B-tree（PK `event_id`、`UNIQUE(adapter_id, source_event_id)`、`idx_history_events_occurred`、`idx_history_events_completion_identity`(5 欄文字)），但 `completion_identity` 只服務 `successAlreadyRecorded`（`history.ts:264-268`，`state = 'success'`），99% 的 heartbeat 列根本不會被它查到。
6. `idx_daily_stats_summary_cover` 包含 `active_ms`、`token_*`，而 `updateDailyStat` 對每個 heartbeat 都無條件 UPSERT（`activeDeltaMs=0` 且無 token 時內容也不變），索引鍵每次都因 `active_ms` 變動而 delete+insert。

更好的做法：
1. 連線建立後加 `PRAGMA synchronous = NORMAL`（WAL 下仍可在應用崩潰時保持一致，僅斷電可能遺失最後幾筆；這是計數型資料，可接受）。fsync 次數從每 commit 1 次降到每 checkpoint。
2. progression：`ensurePet` 加 `Set<string>` 快取（已確保的 petId 不再寫入）；`handleEvent` 不要在入口與結尾各呼叫一次 `getSnapshot`，只在交易內讀一次 progress row 與結尾一次（或僅在 `awards.length > 0` 時才重讀）。
3. 合併成一個交易：把 progression 與 history 的 heartbeat 寫入各自維持，但在 `onEvent` 層用「每 100–250 ms 微批次」把同一 tick 的事件一起 `BEGIN/COMMIT`（現成的 `HistoryStore.batch()` 已可重入）。對 burst 的效益最大：N 個事件從 N 次 commit 變成 1 次。
4. `updateDailyStat` 改單一語句 upsert，不做 SELECT：
   ```sql
   INSERT INTO daily_stats(...) VALUES (...)
   ON CONFLICT(local_date, pet_id, project_id, adapter_id) DO UPDATE SET
     sessions_completed = sessions_completed + excluded.sessions_completed,
     active_ms = active_ms + excluded.active_ms, ...
     token_quality = CASE ... END
   ```
   且 `activeDeltaMs === 0 && 無 token && 無 completion` 時直接跳過。
5. 索引：`CREATE INDEX idx_history_events_success_identity ON events(agent_id, session_id, project_id, pet_id) WHERE state = 'success'`（partial index，heartbeat 列完全不維護），遷移時 DROP 舊索引；`daily_stats` 的 covering index 在此表規模下（天 × 寵物 × 專案 × adapter，數千列以內）可直接移除，改靠 `(pet_id, local_date)` 兩欄索引，避免 `active_ms` 變動造成索引重寫。

預期：每事件 commit/fsync 由 2 降為 ≤ 1（微批次後是 O(burst/批次大小)），寫入語句數由約 20 降到約 8，索引維護由 5 個 B-tree 降到 3 個（heartbeat 列）。

---

### H3　`events` 表沒有執行期 prune，且每個 heartbeat 都存一列

位置：`electron/history.ts:210`（建構時 `pruneEvents()`）、`721-723`（`prune()`）、`740-743`；全專案搜尋 `.prune(`：**沒有任何呼叫者**。`recordEvent` 每個事件（含 `thinking`／`tool-running`）寫一列含 `payload_json`（`'{"state":"..."}'`）。

現況：保留天數只在 App 啟動時套用一次。托盤型 App 常駐數週，表只增不減，直到下次重啟才縮。每筆 heartbeat 的實際用途只有兩個：累加 `active_delta_ms`（已被聚合進 `sessions`／`daily_stats`）、與 `successAlreadyRecorded`／成就回補（只需要 `state='success'` 與 token 列）。以每天 5 萬 heartbeat、保留 90 天估算，是約 450 萬列 × 5 個 B-tree，檔案數 GB 級，WAL checkpoint、`DELETE FROM events WHERE occurred_at < ?`（啟動時一次刪數十萬到數百萬列）與 H5 遷移的時間都線性放大。（5 萬／天是假設值，請以實際 `events` 列數確認。）

更好的做法：
1. 只持久化「有資訊價值」的事件：terminal 狀態（success／error／offline）、waiting-*（若要統計）、帶 token 的事件。heartbeat 只更新 `sessions.last_state/last_seen_at/active_ms` 與 `daily_stats.active_ms`（本來就是這樣算的）。events 列數降 1–2 個數量級。
2. 不論 1 是否採用，都要加定期 prune：用 `setInterval(…, 6h).unref()` 呼叫 `history.prune()`，並改成分批刪除 `DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE occurred_at < ? LIMIT 5000)`，每批之間 `setImmediate` 讓出，避免一次長交易。
3. `sessions` 表同樣只增不減（`DELETE FROM sessions` 只在 `clear()`）；一併依 `last_seen_at < cutoff` prune。

預期：events 表大小與 90 天內「有價值事件數」成正比而不是 heartbeat 數；啟動刪除成本由 O(過期列數) 的一次性長阻塞，變成每 6 小時 O(5000) 的小批次。

---

### H4　成就 `readContext` 對無索引的表做 5 次全掃描，每個 success／token 事件與每次 `getSnapshot` 都執行

位置：`electron/achievements.ts:403-440`（`readContext`）、`476-483`（`token_usage` 表）、`453-459`（`completed_sessions`）、`180-246`（`recordEvent` → `evaluateAndUnlock` 於 `296-402` 呼叫 `readContext`）、`312-354`（本分支新增的 `getSnapshot` 也呼叫 `readContext`）。

現況：
- `completed_sessions` 的 PK 是 `session_key`，`WHERE pet_id = ?` 沒有索引 → `COUNT(*)` 是 O(completed_sessions) 全表掃描。
- `token_usage` 的 PK 是 `token_event_id`，沒有 `pet_id` 索引，而且同一個函式對它**連續查兩次**（`COUNT + SUM(CASE)`、`SUM(input)+SUM(output)`）→ 2 次 O(token_usage) 掃描。`token_usage` 每個帶 `tokenUsage` 的 hook 事件新增一列，**沒有任何保留期限**，只增不減。
- `recordEvent` 對每個 `state === 'success'` 事件（即使是重複事件、`completed=false`）都會走 `evaluateAndUnlock` → `readContext`；對每個 `tokenUsage` 事件也是。
- 本分支新增的 `getSnapshot(petId, progression)` 每次也跑 `readContext`；它被 `broadcastAchievements()`（`runtime.ts:1737, 2552, 2676, 2797`）、`ipc/progression.ts:47`、`main.ts:611` 呼叫，每次解鎖、換寵物、開啟面板都會觸發。

量級：completed_sessions 數千列、token_usage 數萬到數十萬列（每天數百到上千 token 事件，累積一年）時，單次 `readContext` 是數 ms 到數十 ms 的主行程同步阻塞，且發生在事件熱路徑上；同一個事件還在 `history`／`progression` 之後再加一個交易。

更好的做法：
1. 立刻可做：合併兩次 `token_usage` 查詢成一次 `SELECT COUNT(*), SUM(quality='estimated'), COALESCE(SUM(input_tokens),0)+COALESCE(SUM(output_tokens),0)`；新增索引 `CREATE INDEX idx_token_usage_pet ON token_usage(pet_id)`、`idx_completed_sessions_pet ON completed_sessions(pet_id)`。複雜度仍是 O(該 pet 的列數)，但免全表。
2. 根本解：用 `pet_counters(pet_id PRIMARY KEY, completed INT, token_total INT, token_estimated INT, token_rows INT)` 增量計數表，在 `INSERT OR IGNORE` 成功（`changes > 0`）時 `+1`／`+tokens`，`readContext` 變成 O(1) 單列讀取（`active_days`、`adapter_usage` 的 `COUNT(*)` 因 PK 前綴是 pet_id 本來就走索引，維持）。`token_usage` 同時加保留策略（只需要總量，可只保留近 N 天明細）。
3. 重複 success 事件早退：`completed === false && !tokenRecorded` 時 `return []`（現在 `event.state !== 'success'` 條件讓重複 success 仍會往下跑 `evaluateAndUnlock`）。

預期：每事件由 5 次 O(N) 掃描降為 1 次 O(1) 主鍵讀取。

---

### H5　v6 遷移把整個 `events` 表載入記憶體，並對每列做 SELECT + UPSERT，阻塞啟動

位置：`electron/history.ts:940-966`（`hasV6` 遷移，本分支新增）、`981-1003`（`rebuildEventDailyStats`）、`1036-1049`（`rebuildSessionCompletions`）、建構子 `212-213`（`count === 0` 時再次重建）。

現況：遷移在 `startupStep('history')` 同步執行（`main.ts:364`，在寵物視窗建立之後，但會凍結主行程）。`rebuildEventDailyStats` 先 `SELECT ... FROM events ORDER BY occurred_at, event_id` 並 `.all()`——把全部列物件化到 JS 陣列；接著對每列呼叫 `updateDailyStat`（SELECT + UPSERT，兩個語句）。複雜度 O(E) 記憶體 + O(E) 次 JS↔SQLite 往返，E = events 列數。以 E=100 萬估：陣列約 200–400 MB（每列 10 欄物件）、往返約 200 萬次，粗估 20–60 秒的主行程凍結；E 受 H3 影響會繼續成長。`ORDER BY occurred_at, event_id` 在加總場景也毫無意義（加法可交換），還多一次排序。

更好的做法：讓 SQLite 聚合，JS 只拿聚合結果：
```sql
INSERT INTO daily_stats(local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
                        active_ms, token_input, token_output, token_cache_read, token_cache_write, token_quality)
SELECT local_date, pet_id, project_id, adapter_id,
       0, 0,
       SUM(active_delta_ms), SUM(COALESCE(token_input,0)), SUM(COALESCE(token_output,0)),
       SUM(token_cache_read), SUM(token_cache_write),
       CASE WHEN SUM(token_quality='exact') > 0 THEN 'exact'
            WHEN SUM(token_quality='estimated') > 0 THEN 'estimated' ELSE 'none' END
FROM events GROUP BY local_date, pet_id, project_id, adapter_id;
```
單一語句，O(E) 由 SQLite 掃描，輸出僅（天 × 寵物 × 專案 × adapter）列。`rebuildSessionCompletions` 對 `getAchievementCompletedSessions()` 也應改成分頁（keyset：`WHERE (occurred_at, event_id) > (?, ?) LIMIT 5000`）或直接 SQL 聚合。遷移前加進度日誌，並把大遷移移到 `STARTUP_DEFERRED_WORK_MS` 之後的背景步驟（前提是 UI 能容忍短暫的「歷史資料整理中」空狀態）。

預期：記憶體由 O(E) 降為 O(聚合列數)，往返由 2E 降為 1，凍結由數十秒降到約 1 秒以內（E=100 萬）。

---

## Medium

### M1　renderer 每事件把 presentation status 傳回主行程

位置：`src/App.vue:427-433`、`src/stores/agentStore.ts:1681-`（`getPresentationStatus`）、`electron/ipc/window-controls.ts:170-176`、`electron/plugin-agent-status.ts:41-`。

現況：`watch(() => store.getPresentationStatus(), cb, { deep: true, immediate: true })`。getter 每次都回傳新物件，依賴 `familyLines`（每事件重算、`since` 就是 `lastSeenAt`）、`mood`、`pets`、`progression.level`；`deep: true` 下只要依賴變動 callback 就會跑，不比較內容是否相同。結果 pet 視窗每個 heartbeat 事件都 `ipcRenderer.send('presentation-status-update', snapshot)`（最多 16 隻寵物），主行程再 `normalizePresentationStatus` 兩次（handler 與 `PluginAgentStatusController.update`）。panel 視窗雖然 callback 不送，但 getter 與 deep traverse 仍然每事件跑一次。

更好的做法：把 `lastSeenAt` 這類不影響輸出的欄位排除，用穩定字串簽章去重：
```ts
let lastKey = ''
watch(() => store.getPresentationStatus(), s => {
  if (isPanelWindow) return
  const key = JSON.stringify(s)          // ≤16 隻 × 6 欄，約 1 KB
  if (key === lastKey) return
  lastKey = key
  window.electronAPI?.publishPresentationStatus(s)
})  // 去掉 deep: true
```
並且 `isPanelWindow` 時根本不要建立此 watcher。預期：IPC 由 O(事件數) 降為 O(可見狀態變化數)。

### M2　本機用量匯入：單檔同步長阻塞、逐筆 SQL、對已刪除工作區重複同步 fs

位置：`electron/local-usage.ts:640-664`（讀取 → `parseIncrementalLocalUsageChunk` → `history.batch(importRecords)`）、`446-500`、`electron/history.ts:390-535`（`recordTokenUsage`）、`electron/project-routing.ts:100-121, 207-219`（`canonicalizeProjectPathVerbose`、快取條件）。

現況：
1. 每個檔案一次讀最多 `maxFileBytes`（16 MB），整塊同步解析（逐行 `toString('utf8')` + 預篩 + `JSON.parse`）後，在**一個**交易裡同步匯入所有紀錄，中途沒有讓出事件迴圈（讓出只發生在檔案之間）。首次匯入一個 16 MB Claude JSONL 估計有 1–3 萬筆 usage 紀錄，解析約 100–300 ms，匯入每筆約 4 個語句（`SELECT` 去重、`INSERT`/`UPDATE`、`updateDailyStat` 的 SELECT + UPSERT）約 20–40 µs/語句 → 同步阻塞約 0.5–1.5 s；一次掃描 `maxTotalBytes` 64 MB 可以連續跑 4 個這樣的檔案。
2. 每筆紀錄都 `updateDailyStat`（讀－改－寫），同一天同專案的 N 筆其實可以先在記憶體加總成 1 次寫入。
3. 去重結構是 SQLite 的 `UNIQUE(adapter_id, source_event_id)` 索引查詢，複雜度 O(log E) 沒問題，但每筆一次 round trip。
4. `trackSeen(record.cwd)` 對「無法驗證」的路徑（已刪除的 git worktree、拆掉的專案，這在舊日誌裡很常見）**刻意不快取**（`project-routing.ts:212`），每一筆紀錄都做 `lstatSync` 同步系統呼叫。一個檔案 2 萬筆 × 同一個失效 cwd = 2 萬次同步 `lstat`。

更好的做法：
- 解析與匯入都以 ~1–2 MB／~500 筆為單位切片，片與片之間 `await yieldToEventLoop()`（保持每個片段一個交易）。主行程單次阻塞由約 1 s 降到 ≤ 20 ms。
- 匯入前在記憶體用 `Map<'date|project|adapter', Delta>` 累加，批次尾端每個 key 只做一次 UPSERT：SQL 次數由 O(筆數) 降到 O(筆數去重 + 不同 key 數)。
- `importRecords` 內加一個每次掃描的 `Map<cwd, ProjectIdentity|null>`（含負向快取），或讓 `resolvePath` 對未驗證結果做短 TTL（例如 60 秒）負向快取：同步 fs 由 O(筆數) 降為 O(不同 cwd 數)。

### M3　每 60 秒對整棵日誌樹做 `lstat + realpath`

位置：`electron/local-usage.ts:307-352`（`filesUnder`）、`electron/main/runtime.ts:2733-2737`（`LOCAL_USAGE_TICK_MS = 60_000`，電池模式每 5 分鐘）、`electron/main/scan-schedule.ts`。

現況：每個 tick 對 `~/.claude/projects` 與 `~/.codex/sessions` 的每個項目做 `await lstat`，檔案若在 cutoff 之後還要再 `await realpath`（兩次非同步系統呼叫，執行緒池來回），目錄一律遞迴。mtime 篩選只對檔案生效，**目錄無法剪枝**（目錄 mtime 不反映檔案追加）。90 天保留期、重度使用者 2,000 個檔案上限內，每 tick 約 2×N 次 syscall（N≤2000+目錄數），即使完全沒有新內容。另外檔案數超過 `maxFiles`(2000) 時，`readdir` 順序決定哪些檔案被丟掉（非最近優先）。

更好的做法：
- Codex 的路徑是 `YYYY/MM/DD`，可依目錄名稱直接剪掉早於 cutoff 的日期目錄（O(保留天數) 而非 O(檔案數)）。
- 已在 `fileCache` 的 (dev, ino) 不用再 `realpath`（`isWithinRoot` 只要在首次發現時驗證一次）。
- 以 `fs.watch(root, { recursive: true })`（macOS／Windows 原生支援）標記 dirty 路徑，tick 只處理 dirty 集合，並保留一個 10–15 分鐘的低頻全掃作為保險；電池模式維持現狀。複雜度由每 tick O(全部項目) 降到 O(變動檔案數)。

### M4　面板視窗在啟動時就建立並載入完整 renderer

位置：`electron/main.ts:339`（`startupStep('panel-window', createPanelWindow)`）、`electron/main/runtime.ts:1922-1981`（`new BrowserWindow(...)`＋`loadURL`）。

現況：面板預設隱藏，卻在啟動時就啟動第二個 Chromium renderer 並載入、執行整個 Vue 應用（含 `StatusPanel`、`usePluginPanelController` 的 mounted 工作：`getPluginPanelSnapshot`、`listPluginNotifications`、`loadPetOptions`、`refreshQuota`…）。這會與寵物視窗首次繪製競爭 CPU／IO，常駐增加約 80–150 MB RSS（估計值，依 Electron 版本而異）。`docs/perf/startup-budget.md` 的 < 800 ms 目標只計到 `pet-window` 步驟結束，`panel-window` 緊接在後面同步 await。

更好的做法：延後到「寵物視窗 `did-finish-load` 之後 + idle（例如 `STARTUP_DEFERRED_WORK_MS`）」再 `createPanelWindow()`；或第一次需要面板（`showPanelWindow`）時才建立（需要把依賴 `mainState.panelWindow` 非空的廣播路徑加上 `?.`，現有程式碼大多已經有 `isDestroyed()` 判斷）。預期啟動關鍵路徑少一個 renderer 的建立與 JS 執行。

### M5　寵物視窗 `mousemove` 每次事件都做 `elementFromPoint` + `getImageData`

位置：`src/App.vue:163-167`（`handlePetMouseMove` → `evaluatePointer`）、`107-131`（`isOpaqueCanvasPoint` 的 `getImageData`）、`408`（`window.addEventListener('mousemove', ..., true)`）。

現況：滑鼠移動事件（60–125 Hz）每次同步呼叫 `document.elementFromPoint`（可能強制 layout）；游標在寵物畫布上時再做 `canvas.getContext('2d').getImageData(…)`——該 canvas 每秒重繪多次，且沒有設定 `willReadFrequently`，GPU→CPU 回讀是同步阻塞。IPC 已用 `decidePassthrough` 去重，但前面的計算沒有節流。區塊大小約 `(2r+1)²`，`r = 4 × canvas.width/rect.width`（K=4 時 r≈16，約 33×33=1089 像素）。

更好的做法：用 rAF 合併（只保留最後一個座標，每幀最多評估一次，已有 `scheduleReevaluate` 的雛形可以重用）；命中測試改成對畫布的 offscreen 2D、`willReadFrequently: true` 的 alpha mask（每次換 frame 時從 sprite 預先產生一張 192×208 的 Uint8 命中遮罩，查詢 O(1) 取代 O(半徑²) 回讀）。預期：每秒評估次數由 ≤125 降為 ≤60，單次由一次 GPU 回讀降為陣列查表。

---

## Low

- **L1　`agentStore` 衍生值鏈每事件重算**：`sessionList`（`agentStore.ts:237`）對全部 session 重新排序（n ≤ 200，比較函式含 `localeCompare`，約 1,600 次比較，估計 0.1–0.3 ms），`activeSessions`／`familyLines`（`1523`，F 個家族 × n 次 `filter`＋`includes`）／`highestPrioritySession`／`permissionNoticeItems` 都從它派生；兩個視窗各算一份。因為 computed 是惰性且每個 Vue tick 只跑一次，實際成本低。若要優化：`familyLines` 單趟 O(n) 以 `Map<familyKey, …>` 彙整；`sessionList` 在僅 `lastSeenAt` 變動且 `state` 沒變時不必重排（可用 heap 的 recency 序維持）。另外 `sessions`（`246`，`Object.fromEntries`）若無使用者應移除。
- **L2　`createOrderedBatchCoalescer` 溢出時 `findIndex + splice` 為 O(maxPending)**（`electron/ipc/broadcast-coalescer.ts:44-54`）：僅在佇列滿（1000）時每次 push 付 O(1000)；洪水情境下 200 事件／秒 × 1000 = 20 萬次比較／秒。改成「兩個佇列」（priority／normal）＋溢出時從 normal 佇列頭部 `shift`（用索引遊標避免 O(n) shift）即為 O(1)，且天然維持各自插入序。
- **L3　`markAllNotificationsRead` 對 N 筆未讀發 N 個 IPC**（`usePluginPanelController.ts:1224-1229`）：每個 invoke 都會讓主行程廣播 `pluginNotificationsChanged`，renderer 再 `listPluginNotifications` 全量抓一次（中央最多 500 筆）。主行程端 coalescer 能合併部分，但仍可能多次重抓。改成單一 `markPluginNotificationsRead(ids|pluginId)` 批次 IPC：O(N) 往返 → O(1)。
- **L4　`filteredPlugins` 在 filter 內用 `catalogItems.some(...)`、排序比較函式內重複呼叫 `pluginStatusTone`**（`usePluginPanelController.ts:155-166`）：「updates」篩選為 O(P×C)；排序為 O(P log P) 次 tone 計算。預先建 `Set<updatableId>` 與 `Map<id, tone>`，變為 O(P+C)。P 通常 < 100，影響很小。
- **L5　Intl 物件每次呼叫重建**（`src/utils/intl-format.ts:61`、`src/utils/relative-time.ts:11-13`）：`new Intl.RelativeTimeFormat` 與帶 locale 的 `toLocale*String` 每次呼叫都可能建立格式器（每次約 10–50 µs，估計）。清單（`SessionRow` 的 `lastSeen`、通知收件匣的相對時間）每列呼叫一次。用 `Map<locale+options, formatter>` 快取，一個 locale 只建一次。
- **L6　幾個只增不減的小表／Map**：`xp_session_activity`（`progression.ts:294`，每個 session 一列，永不刪除）、`sessions`（H3）、`ProjectRoutingStore.lastTrackedAt`（`project-routing.ts:161`，每個 projectId 一筆，無上限）。每天以數十列計，影響以年為單位；補一個定期依 `last_seen_at` 刪除與 Map 上限（例如 1,000）即可。
- **L7　`PetAnimation` 每幀小開銷**（`PetAnimation.vue:~470-500`、`frameDelay()`）：每幀 `prefersReducedMotion()` 呼叫 `window.matchMedia(...)`（每次建立 `MediaQueryList`）、`draw()` 每幀配置 `targets` 陣列並對最多 3 個 canvas 取 context。backing store 在 `petScale × DPR` 取整後最大 K=8 時是 1536×1664（約 255 萬像素）× 最多 3 層，每幀清除＋繪製。建議快取 `matchMedia` 結果（監聽 `change`）、context 與 `targets` 只在 aura 可見性變化時重建；K 上限若不需要 8 可降到 4。目前頻率 ≈ 4–9 fps，影響小。
- **L8　`getAchievementCompletedSessions`**（`history.ts:678-709`）：`ORDER BY occurred_at, event_id LIMIT 100000`＋每列一次 `sha256`，只在啟動後 10 秒的增量對帳與遷移時跑，成本 O(符合的 success 列)（≤ 10 萬，估計 100–300 ms 一次性）。`occurred_at` 索引不涵蓋 `event_id` 次序，會多一個排序步驟；想省可改成 `ORDER BY occurred_at`（對帳不需要 `event_id` 次序）。另外硬上限 10 萬在超過時會**靜默截斷**（正確性風險，非效能），建議改分頁。
- **L9　`appendPermissionAudit` 每筆 `mkdirSync + appendFileSync + chmodSync`**（`permission-audit.ts:12-23`）：全部同步，每個權限決定 3 個 syscall；權限請求是低頻（人工操作），僅在 burst 時才會被注意到。啟動時 `mkdir` 一次、`chmod` 只在檔案新建時做一次即可。

---

## 建議的處理順序

1. **先做 H1、H2 的 (1)(2)(4)**：改動小、風險低（廣播去重／節流、`synchronous=NORMAL`、`ensurePet` 快取、單語句 upsert），直接降低每事件的主行程負擔。
2. **H4 的索引與合併查詢、重複 success 早退**；接著 H3 的定期 prune（先不改持久化語意）。
3. **H5** 在下一個會再升 schema 的版本前處理，改成 SQL 聚合；因為遷移是一次性，風險最高的是寫錯聚合，需補一個「新舊結果一致」的測試（以現有 `rebuildEventDailyStats` 當 oracle）。
4. M1、M2 其次；M3–M5 視實測的事件迴圈延遲（`pnpm bench:lag` 擴充為包含 progression 與廣播）再決定。
5. 驗證方式：擴充 `scripts/bench/event-loop-lag.mjs`，餵入 5,000 筆 events、一個 10 萬列 `token_usage` 的成就資料庫與一個 5 萬行 JSONL，對照修改前後的 p99／max 延遲。

---

## 修正狀態

分支 `ws/fix-perf`，一個 commit 對應一個項目。量測環境為開發機（同時有其他工作線在跑，數值有雜訊，只看量級與方向）。

### 量測結果

| 指標 | 修正前 | 修正後 | 方法 |
| --- | --- | --- | --- |
| `pnpm bench:lag`（500 事件／10 秒，僅 `HistoryStore.recordEvent`）p99 | 13.09 ms | 7.08 ms | `pnpm bench:lag` |
| 同上 max 事件迴圈延遲 | 58.75 ms | 12.12 ms | 同上（mean 5.75 → 5.39，受 5 ms 取樣解析度限制） |
| v6 遷移／rebuild：50,000 events | 3,593 ms | 604 ms | `tests/history.test.mts` 〈v6 migration is set-based〉，同一份合成資料，舊程式與新程式輸出的 daily_stats 都與測試內的舊邏輯 oracle 一致 |
| 熱路徑 SQLite commit／事件 | 2 次獨立 `BEGIN IMMEDIATE`，WAL 預設 `synchronous=FULL` | history 同 tick 合併為 1 個交易；三個 DB 皆 `synchronous=NORMAL` | `getPragmaState()` 測試 |
| heartbeat 的 `events` 列 | 每個 heartbeat 1 列 | 每 session‧天 1 列 rollup | `tests/history.test.mts`（1,500 筆隨機事件，active time 與 oracle 完全一致） |
| 成就 `readContext` | 5 次無索引全表掃描 | 1 次 `pet_counters` 主鍵讀取 | `tests/achievements.test.mts`（300 筆隨機事件，計數器與全量重算一致） |

### 各項狀態

| ID | 狀態 | 做了什麼 |
| --- | --- | --- |
| PERF-01 (H1) | 完成 | progression 只在快照內容變動時廣播；`historyUpdated` 以 `createLatestValueCoalescer` 合併為 ≤1 次／秒；隱藏或已銷毀視窗不送，`show` 時補送一次；History 檢視重抓加 500 ms trailing debounce |
| PERF-02 (H2) | 完成（schema 變更：history v7） | WAL 確認後 `synchronous=NORMAL`；`ensurePet` 以 `Set` 快取；`daily_stats` 單語句 `INSERT … ON CONFLICT DO UPDATE`，無新增量的 heartbeat 直接跳過；`events` 完成識別索引改為 `WHERE state='success'` 部分索引；`daily_stats` covering index 換成 `(pet_id, local_date)`；`HistoryStore.queueEvent` 同 tick 微批次（每事件 SAVEPOINT 隔離）。progression 與 history 是不同 DB 檔案，且 progression 必須同步回傳快照，所以不能併成單一交易 |
| PERF-03 (H3) | 完成 | 逐一檢查讀取者：`successAlreadyRecorded`、成就回補只看 `state='success'`；`daily_stats` 重建只加總 `active_delta_ms`，沒有任何讀取者需要單筆 heartbeat 列。heartbeat 改為 rollup 列；6 小時一次、每批 5,000 列、批間讓出事件迴圈的 `events`／`sessions` prune；`sessions(last_seen_at)` 索引。語意差異：不比 session 最後活動更新的 heartbeat 現在直接忽略（原本靠 event id 去重，且亂序 heartbeat 可以覆寫 `last_state`） |
| PERF-04 (H4) | 完成（schema 變更：achievements v2） | `token_usage`／`completed_sessions` 的 `pet_id` 索引；`pet_counters` 增量計數，reconcile 時對受影響的 pet 全量重算；`readContext` O(1)；重複 success 事件直接 `return []`。未做：`token_usage` 明細保留期限——去重依賴明細列，裁剪會讓舊事件重放後重複計數 |
| PERF-05 (H5) | 完成 | `rebuildEventDailyStats` 單一 `INSERT … SELECT … GROUP BY`；完成度改 keyset 分頁並在記憶體彙總後每個 key 寫一次，順便移除 10 萬筆的靜默截斷（L8）；v6 不再建立馬上被 v7 刪掉的 covering index。未做：把遷移移到背景（UI 沒有「整理中」狀態，且已降到亞秒級） |
| PERF-06 | 部分完成 | 見下表 |

PERF-06 細項：

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| M1 presentation status | 完成 | 以內容簽章去重，去掉 `deep: true`，面板視窗不建立 watcher |
| M2 本機用量匯入 | 完成 | 解析以 1 MB 為單位、匯入以 500 筆為單位，片段間 `setImmediate` 讓出；`recordTokenUsageBatch` 在記憶體加總 daily 增量，每個 key 只寫一次；每次匯入每個 cwd 只 `trackSeen` 一次（含已刪除工作區的負向結果） |
| M3 全樹掃描 | 完成 | 目錄清單依目錄自身 mtime 快取（剛修改的目錄不快取、10 分鐘過期）；已驗證檔案以 (dev, ino) 快取 realpath；Codex `YYYY/MM/DD` 過期日期目錄直接剪枝。穩態每個項目 1 次 `lstat`，不再 `readdir`／`realpath`。未做 `fs.watch`（跨平台行為無法在不啟動 App 的前提下驗證） |
| M4 面板視窗 | 部分 | 不做「首次開啟才建立」：約 110 處 `mainState.panelWindow` 存取、IPC sender 驗證與外掛面板 view 掛載都依賴它，且首次開啟會看到空白等待載入，無法在不啟動 App 的條件下驗證。改為把 `panel-window` 步驟移到啟動序列最後（`ensureDesktopWindows()` 本來就會按需建立），不再與寵物首次繪製和各服務初始化搶 CPU |
| M5 mousemove | 完成（遮罩部分未做） | rAF 合併，每幀最多評估一次；同一像素的命中結果快取 100 ms。預先產生 alpha 命中遮罩需要改 `PetAnimation` 的繪製流程（`pet` 工作線所有），未做 |
| L2 coalescer 溢出 | 完成 | 溢出由 O(maxPending) 改為攤銷 O(1)；2,000 組隨機洪水與舊實作逐一比對（輸出與被丟棄項目完全相同） |
| L3 全部標示已讀 | 完成 | 新增單一 IPC `plugin-notifications-read-all`（Cross-stream：plugins 工作線的 `plugin-feed.ts`、`ipc/plugin-feed.ts`、`usePluginPanelController.ts`），N 個 invoke → 1 個，主行程只廣播一次 |
| L5 Intl | 完成 | `RelativeTimeFormat` 依 locale 快取 |
| L6 小表 | 完成 | `xp_session_activity` 90 天未活動即刪（progression v3 索引；XP 由帳本唯一鍵保證不重複發放）；`ProjectRoutingStore.lastTrackedAt` 上限 1,000；`sessions` 隨 H3 prune |
| L1、L4、L7、L9 | 未做 | 估計影響很小（見原文），且 L1 位於 `agentStore.ts`、L7 位於 `PetAnimation.vue`、L9 位於權限稽核，分屬其他工作線 |

### 測試

- `tests/progression-broadcast-gate.test.mts`：廣播去重、隱藏視窗略過與 show 補同步、history-updated 合併。
- `tests/history.test.mts`：PRAGMA 與部分索引（含查詢計畫）、daily upsert、微批次與 SAVEPOINT 隔離、heartbeat rollup 與 oracle 一致、重放與亂序 heartbeat、分批 prune、50k 事件遷移等價與時間上限。
- `tests/progression.test.mts`：`ensurePet` 快取不再寫入、heartbeat 重用快照與重新讀取一致且 XP 冪等、過期 activity prune 不影響 XP。
- `tests/achievements.test.mts`：計數器與全量重算一致、v1→v2 遷移回填與索引。
- `tests/local-usage.test.mts`：>2 MB 檔案分片後總量相同、每 cwd 一次查詢與讓出次數、`recordTokenUsageBatch` 與逐筆寫入結果相同、目錄快取仍能看到新檔與追加內容、過期 Codex 日期目錄剪枝。
- `tests/broadcast-coalescer.test.mts`、`tests/plugin-feed.test.mts`、`tests/ipc-plugin-feed.test.mts`：O(1) 溢出等價、`markAllRead`。

### schema 變更（minor）

history v7（索引）、achievements v2（`pet_counters` 與索引）、progression v3（索引）。皆為向前遷移並各有測試；`events` 新增 `type='agent.active_rollup'` 的列（舊版本程式讀取時等同一般 event 列，不影響）。
