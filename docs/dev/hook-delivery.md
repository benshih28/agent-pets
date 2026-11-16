# Hook 送到 app 的時限與冷啟動重試

`integrations/agent-hook.mjs` 每次執行都會把一個狀態事件 POST 到 `http://127.0.0.1:17373/v1/events`；開啟「從寵物回覆 Claude Code 權限」時，還會呼叫 `http://127.0.0.1:17374/v1/permission/*`。兩者共用同一個 `node:http` helper（`postLocal`）。這份文件記錄各個值是怎麼定出來的，改動前請先重新量測。

| 常數 | 值 | 涵蓋範圍 |
|---|---|---|
| `SEND_DEADLINE_MS` | 1500 | 從發出請求到請求內容交給作業系統（狀態與權限共用） |
| `STATUS_ANSWER_GRACE_MS` | 250 | 狀態事件交出去之後等 app 回 204 的時間 |
| `PERMISSION_ANSWER_DEADLINE_MS` | 1000 | 權限請求交出去之後，等回應並讀完內容的時間 |
| `STARTUP_WAIT_MS` / `STARTUP_RETRY_INTERVAL_MS` | 5000 / 100 | app 正在啟動時，狀態事件被拒後的重試總時間與間隔 |
| `STARTUP_MARKER_MAX_AGE_MS` | 20000 | 比這更舊的啟動標記視為當機留下的，不重試 |

app 沒開時連線會立刻被拒，hook 只多做一次 `lstat` 就結束，不受這些值影響。

## 為什麼分成兩段

請求一旦交給作業系統，app 晚點才讀也收得到，即使 hook 已經結束。實驗：讓伺服器在監聽後把主執行緒卡住 1.2 秒，hook 發出的 3 個事件全部收到。所以：

- 長的時限只需要涵蓋 hook 自己把請求送出去的時間。機器很忙時，這段可能接近 1 秒。
- 送出去之後不必等 app 回應。app 正在啟動時，回應可能要好幾秒；hook 等 250 ms 就離開，agent 不會被拖住。

## 1.12.3 以前的問題

舊版用 `fetch` 加 `AbortSignal.timeout(300)`。300 ms 從呼叫 `fetch` 之前就開始算，包含 Node 第一次呼叫 `fetch` 的初始化。CPU 被其他工作佔滿，或多個 hook 同時執行時，請求還沒送出就被中止；`catch {}` 又把錯誤吞掉，所以事件就這樣不見了。app 端的 event-server、rate limit、coalescer 和 renderer 都沒有掉事件。

在隔離 app（埠 27373）上分層計數的結果：

| 情境 | 舊版遺失 | 新版遺失 |
|---|---|---|
| 循序 100 個，一般負載 | 0 | 0 |
| 循序 100 個，12 核全滿 | 28 | 0 |
| 同時 10／20／40 個，各 5 輪 | 5／99／200 | 0／0／0 |
| app 剛啟動，每 40 ms 一個，共 150 個 | 148 | 0（port 監聽前送出的 6 個連線被拒） |

所有遺失都對應到 hook 端的 `TimeoutError`。主程序收到幾個就接受幾個（沒有被限流，也沒有格式錯誤），renderer 也全部收到。

## 量測數據

量測方式：用 `--import` 注入探針，記錄請求送出與收到回應的時間，hook 本身不改。量測時把時限拉到 60 秒，看實際需要多久。當時機器的 load average 在 14–80 之間（12 核）。

| 情境 | `fetch` 收到回應 | `node:http` 收到回應 | `node:http` 送出 |
|---|---|---|---|
| 循序，12 核全滿 | p99 945 ms | p99 297 ms | p99 189 ms |
| 同時 20 個 | 最長 1011 ms | 最長 437 ms | 最長 353 ms |
| 同時 40 個 | 最長 2321 ms | 最長 620 ms | 最長 535 ms |

`node:http` 不需要 `fetch` 的初始化，hook 的工作量少很多。對零延遲的假伺服器，單一請求 37 ms 對 165 ms；同時 20 個時，p50 是 115 ms 對 1099 ms。

1500 ms 大約是量到的最長送出時間（535 ms）的 2.8 倍。hook 的總耗時最多約 1.75 秒加上 Node 啟動時間，遠低於 Claude Code 和 Codex 的 hook 時限。

## 回歸測試

`tests/agent-hook-delivery.test.mts` 會在 hook 讀完 payload 後，把它的 event loop 卡住 400 ms，模擬 CPU 被搶走的情況。舊版每次都失敗（事件沒送到），新版每次都通過。另外兩個測試檢查：app 很慢時事件仍然送達，而且 hook 不會等它；請求的方法、路徑、標頭和內容維持不變（外部契約）。

## app 冷啟動：埠還沒開時送出的事件（1.12.5）

### 問題

app 啟動後要先建好寵物視窗、插件、權限等服務，最後才綁定 17373。這段時間送出的狀態事件連線被拒，1.12.4 的 hook 直接放棄。如果遺失的是 `Stop` 或 `StopFailure`，寵物要等下一個事件才會更新。

### 比較過的做法

| 做法 | 結果 |
|---|---|
| (a) app 啟動時寫標記，hook 被拒時只在標記存在才重試 | 採用。app 開著時完全不多讀檔；寵物沒開時只多一次 `lstat`；同一個 hook 程序內依序重試（不同 hook 程序之間的順序見下方「限制」） |
| (b) app 綁定後從 hook 寫的檔案或 transcript 補讀各 session 狀態 | 不採用。hook 每次都要多寫一個檔（熱路徑多一次 I/O），transcript 只有 Claude Code 有，格式也不是公開契約 |
| (c) 提早綁定埠、先暫存請求 | 不採用。寵物視窗與服務還沒準備好就得自己排隊，要改動 event-server 的資料流；而且 Electron 本身啟動、載入 main.js 之前的那段一樣蓋不到 |

### 做法

- `electron/main/hook-startup-marker.ts`：`electron/main.ts` 的第一個 import（`electron/main/early-hook-startup-marker.ts`，1.13.2 起）就寫 `~/.desktop-pet/event-port-<事件埠>.starting`，內容是 pid。事件埠開始監聽 2 秒後移除，多留 2 秒是為了蓋過「hook 剛被拒、還沒來得及看標記」的空檔。埠一直綁不上、啟動失敗、第二個實例或 app 結束時立刻移除。移除前會核對 pid，所以 `--relaunch` 的新實例寫的標記不會被舊實例刪掉。寫入發生在單一實例鎖之前，所以若已有「比 20 秒新、擁有者 pid 還活著」的標記就不覆寫（`process.kill(pid, 0)`，ESRCH 才算已結束），否則第二個啟動的程序會蓋掉第一個實例的標記、再因拿不到鎖而清掉它。`--relaunch` 時舊實例可能還沒結束，新實例因此沒寫標記；`main.ts` 在取得單一實例鎖之後呼叫 `claim()`，此時只剩本程序，直接接手標記（埠已在監聽則不寫）。
- 先刪再用 `wx` 建立，被換成 symlink 的路徑不會被跟著寫入。
- 檔名帶埠，開發版或 e2e 改用 27373 時不影響送往 17373 的 hook。
- hook 只有在連線被拒時才看標記：標記存在且不到 20 秒，就每 100 ms 重試，最多 5 秒。權限呼叫只有建立請求（`request`）會重試，見下方「權限請求的啟動期重試」。

### 限制

- 每個 hook 事件是獨立的程序，重試計時器各自獨立。啟動期間如果同一個 session 有兩個事件都在重試（例如 PreToolUse 後馬上 PostToolUse），埠一開啟時哪一個先連上不一定，較舊的狀態可能蓋掉較新的狀態，直到下一個事件。`agent-hook.mjs` 裡 `postStatus` 註解寫「同一個 session 的事件順序不會亂」只在單一 hook 程序內成立。event server 以收到的時間為準（`event-normalizer.ts` 用 `receivedAt` 取代 hook 送的 `timestamp`），因為事件來源也包含插件，不能拿對方給的時間決定先後。只影響埠開啟前那幾百毫秒內送出的事件。
- 權限呼叫只有 `request` 在啟動期間重試；`decision`、`result`、`resolved`、`resolved-session` 與任何非「連線被拒」的結果都不重試。

### 權限請求的啟動期重試

- 只在 `request` 被拒（ECONNREFUSED，請求完全沒送出，不可能重複）且啟動標記還新時，每 `STARTUP_RETRY_INTERVAL_MS` 重試，最多 `PERMISSION_STARTUP_WAIT_MS`（5000）。重試沿用同一個 nonce。逾時、4xx/5xx、409 都不重試。
- 標記是事件埠的，但 `electron/main.ts` 在事件伺服器之前就建立權限伺服器（權限埠先監聽），標記存活到事件埠監聽後 2 秒，所以涵蓋權限埠的啟動；萬一權限埠更晚才開，重試停止後照舊退回終端機（安全）。
- 時限預算：hook 時限 135 秒（`CLAUDE_PERMISSION_HOOK_TIMEOUT_SECONDS`），最壞情況 2.5 + 122 + 2.5 + 2.5 = 129.5 秒（waitSeconds = 120）。已花在重試的秒數（進位）從送給 broker 的 `ttlSeconds` 扣掉，輪詢期限由實際送出的 ttl 算出，所以重試時間加上 ttl 不超過 waitSeconds，最壞情況不變。

### 量測

冷啟動 e2e：`scripts/e2e-real-hook.mts --cold-start 150 --interval 40`。隔離 app 用同一個 HOME 重新啟動，從啟動那一刻起每 40 ms 對一個新 session 送一個真實 hook 的 `Stop`，同時用主程序的 session 鏡像與寵物的 store 分開計數。各輪主程序收到的數量與寵物畫面一致，renderer 沒有掉事件。

同一台機器、同一個 HOME，修正後與修正前（換回 `f8965ae` 的 hook 與 main.ts 重新 build）接著各跑 3 輪：

| | 遺失（各 150 個） | 最後一個遺失事件的送出時間 | 寫入標記 | 事件埠開始監聽 |
|---|---|---|---|---|
| 修正前 | 23／23／36 | 0.88／0.88／1.40 s | — | 1.06／1.09／1.72 s |
| 修正後 | 13／12／12 | 0.48／0.44／0.44 s | 0.63／0.61／0.61 s | 1.08／1.03／1.08 s |

時間都從啟動器開始算。修正前，連線早於監聽的事件全部遺失（hook 本身啟動要 0.2–0.5 s，所以送出時間比監聽早一點）。修正後只剩連線早於標記的事件遺失：Electron 程序約在 0.1 s 建立，約 0.5 s 才開始載入 main.js，標記在 0.6 s 寫入。main.js 執行前這段，app 沒有任何程式能通知 hook，所以留為殘餘風險。所有輪次的 hook 都以 exit 0 結束，主程序收到的數量與寵物畫面一致。

寵物沒開時的 hook 耗時（指向關閉的埠，修正前後交錯各 100 次，單位 ms）：

| 事件 | 修正前 p50／平均±95% CI | 修正後 p50／平均±95% CI |
|---|---|---|
| PreToolUse | 128.7／129.0±0.9 | 129.2／128.6±1.1 |
| PreToolUse，第二輪 | 117.7／118.3±1.1 | 117.9／119.2±1.2 |

差異都在量測誤差內。

## 冷啟動空窗再縮小（1.13.2）

### 做法

1.12.5 的標記寫在 `main.ts` 的頂層程式碼，也就是整個靜態 import 圖（runtime、SQLite、插件服務等）都執行完之後。1.13.2 改成由 `main.ts` 的第一個 import `electron/main/early-hook-startup-marker.ts` 寫入：ES 模組依 import 順序執行，這個模組只依賴 `electron` 的 `app`、`hook-startup-location.ts`（埠與資料夾的純函式，`tests/hook-startup-marker.test.mts` 比對它與 `localPorts()`、`hookScriptDeployPath()` 相同）與標記模組本身。建置後的 `dist-electron/main.js`（約 1.75 MB）裡，寫標記的程式碼在前 3 KB 內，早於所有大型模組的頂層程式碼。

### 量測

`scripts/e2e-real-hook.mts --cold-start 150 --interval 40`，同一個 HOME，舊版（HEAD `38a75fa` 的建置）與新版交錯各 3 輪。量測時其他工作線同時在跑測試，load average 250–386（12 核），各階段都比 1.12.5 量測時慢一個數量級，遺失數主要受負載波動影響，不能拿來比較：

| | main.js 開始載入 → 寫入標記 | Electron 建立 → main.js 開始載入 | 遺失（各 150 個） |
|---|---|---|---|
| 舊版 | 1159／857／2090 ms | 8.2／11.7／7.2 s | 78／149／85 |
| 新版 | 635／759／816 ms | 10.2／6.3／8.9 s | 126／54／110 |

複審修正後（含標記擁有者檢查），負載降到 16–224 時再交錯量 3 輪：

| | main.js 開始載入 → 寫入標記 | 遺失（各 150 個） | 最後一個遺失事件的送出時間 |
|---|---|---|---|
| 舊版 | 510／996／828 ms | 25／75／31 | 0.96／3.32／1.28 s |
| 新版 | 412／702／379 ms | 24／73／27 | 1.04／3.31／1.28 s |

新版縮短的是第一欄：第一輪中位數 1159 → 759 ms，這一輪 828 → 412 ms。遺失數每輪少 1–4 個，在負載波動範圍內。剩下的遺失主要發生在 main.js 開始載入之前（Electron 本身的啟動）。1.12.5 在一般負載量到這段約 0.1 s，所以平常的改善在 0.1 s 以內。新版第 3 輪主程序收到 57 個、寵物畫面在量測時刻只畫到 40 個，是極高負載下 renderer 還沒處理完；這次沒有改動 renderer 與 event server。

### 評估過但不做

- hook 在「連線被拒且沒有標記」時也短暫等待：寵物沒開時每個 hook（每次工具呼叫）都會被拖慢，違反「寵物沒開時不拖慢 agent」。
- 另開一個只寫標記的小 entry，再載入 main.js：可以再省掉 V8 編譯 1.75 MB bundle 的時間，但要改建置設定與 `package.json` 的 `main`，平常負載下可省的時間不到 0.1 s，不划算。
- Electron 程序建立到 main.js 開始執行之間（一般負載約 0.4 s），app 還沒有任何程式碼能執行，hook 也無從得知 app 正在啟動，仍是殘餘風險。
- 依 hook 送的 `timestamp` 排序：事件來源也包含插件，不能信任對方給的時間（見上方「限制」）。

## 權限回覆流程（1.12.5）

1.12.4 的 `permissionPost` 仍用 `fetch` 加 `AbortSignal.timeout(1000)`，1000 ms 也是從呼叫 `fetch` 前開始算。量測方式：假的事件與權限伺服器（立刻回 201 與 deny），同時跑 N 個 `PermissionRequest` hook，另外用 24 個程序把 12 核 CPU 佔滿（load average 約 90），計算 hook 實際輸出 deny 的數量。

| 同時 | 修正前退回終端機 | 修正後退回終端機 | 修正前 p50 | 修正後 p50 |
|---|---|---|---|---|
| 80 個（2 輪 × 2 次） | 0／320 | 0／320 | 3.17 s | 2.28 s |
| 120 個（2 輪 × 2 次） | 19／480 | 0／480 | 4.50 s | 3.01 s |

用 `--import` 探針量 `fetch` 本身：同時 80 個時，`request` 的 p99 是 1016 ms、最長 1082 ms，伺服器都收到了，但 hook 在讀到回應前就放棄。所以改成與狀態事件相同的兩段時限：1500 ms 內送出，之後最多再等 1000 ms 讀回應。回應內容上限 16 KiB，超過或格式錯誤時視同沒有回應。回覆的 JSON 格式、`DENY_MESSAGE`、失敗時什麼都不輸出（Claude Code 改用終端機詢問）都沒變。

最壞情況下，每次權限呼叫最多 2.5 秒。等待 120 秒時，hook 總耗時上限約為 2.5（建立）+ 122（輪詢）+ 2.5（最後一次輪詢）+ 2.5（回報結果），即 129.5 秒，仍低於 `PermissionRequest` hook 的 135 秒時限。

熱路徑：權限回覆模式開啟時，每個 PreToolUse／PostToolUse 都會多送一次 `resolved*`。改用 `node:http` 後，hook 耗時（假伺服器，交錯各 100 次）：

| 事件 | 修正前 p50 | 修正後 p50 |
|---|---|---|
| PreToolUse | 138.5 ms | 124.0 ms |
| PostToolUse | 138.7 ms | 123.0 ms |
| PreToolUse，未開啟權限回覆 | 118.9 ms | 118.6 ms |

## 回歸測試（1.12.5）

`tests/agent-hook-delivery.test.mts` 新增的測試：

- app 還在啟動時送出的事件：埠在 hook 啟動 0.7 秒後才開，修正前事件遺失，修正後送達。
- 寵物沒開（沒有標記，或標記是 5 分鐘前留下的）時，hook 不等待。
- 標記存在但埠一直沒開時，hook 最多等約 5 秒。
- 權限請求送出時 hook 被卡住 1.1 秒：修正前退回終端機，修正後照常輸出 deny，而且回覆內容逐字相同。

`tests/hook-startup-marker.test.mts` 檢查標記的檔名、權限、pid 核對、延遲移除與 symlink，以及擁有權：新鮮且擁有者還活著的標記不被第二個程序覆寫或清掉、過期或擁有者已結束的標記會被取代、`claim()` 接手後舊實例的 `clear()` 不會刪掉新標記。`tests/agent-hook-delivery.test.mts` 的耗時判斷都相對於「空 node 程序的啟動時間」，機器忙時不會誤判。
