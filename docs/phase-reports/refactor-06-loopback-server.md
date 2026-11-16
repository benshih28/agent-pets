# 重構階段 6：Loopback HTTP server 的共用骨架

- **開始時間**：2026-11-10 12:20（Asia/Taipei）
- **完成時間**：2026-11-10 12:50（Asia/Taipei；首次收尾 12:41，總控退回後修正）
- **基準 commit**：`b3a6f25`（分支 `claude/refactor-06-loopback-e825b4`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 9 項；排程見 3.1 節

## 範圍

`electron/event-server.ts`、`electron/presentation-mcp.ts`、`electron/permission-adapter-server.ts` 各自實作 token 的 `timingSafeEqual` 比對、限制大小的 body 讀取與 JSON 解析、JSON 錯誤回應。本階段把這些底層步驟集中成一個純粹的模組並集中受測；各 server 保留自己的路由、大小上限（64 KB／16 KB／16 KB）、rate limit、method allowlist 與授權政策。header 與路徑沿用 `src/types/local-wire.ts`（階段 5）。

不在範圍：讓 event／presentation server 也檢查 `remoteAddress`（安全決策，只評估與建議，見「Loopback 位址檢查評估」）；`server-health.ts` 的探測請求（client 端，不讀 body，無需改）；token 比對改成不洩漏長度的雜湊比對（沿用既有作法）。

## 驗收條件

1. 既有 client（`integrations/agent-hook.mjs`、`integrations/presentation-mcp.mjs`、`setup.ts` 產生的 OpenCode plugin）讀得到的狀態碼與錯誤 body 不變；先以測試或改前實測固定。
2. 413 錯誤字串：若有 client 解析就保留各自字串，不硬統一。
3. 共用 helper 有單元測試：超過上限的 body（宣告長度與實際串流兩種）、分段 chunk、空 body、錯誤 JSON、token 缺少／長度不同／內容錯誤。
4. body 讀取不新增同步 I/O，超過上限立即停止累積，組合時一次 `Buffer.concat(chunks, total)`。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗）、`git diff --check` 通過；local server 安全檢查項逐一確認。
6. 隔離 Electron 加真實 hook（`scripts/e2e-real-hook.mts`）驗證 event、permission、presentation 三條通道仍能送達，並以同一支探測腳本比對改前與改後的負向回應。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試清單 | 通過 | 基準 `test:unit`（`b3a6f25`）：1341 項，1309 過、9 失敗、23 skip，見「基準失敗清單」；盤點見「盤點結果」 |
| 2 | 改前以隔離 Electron 錄下三個 server 的負向回應 | 通過 | 43 個案例（狀態碼、header、body）存成改前快照，見「改前／改後回應比對」 |
| 3 | 抽出共用 helper 與單元測試 | 通過 | `tests/loopback-http.test.mts` 11 項連跑 3 次全過 |
| 4 | 三個 server 改用 helper，補 server 層測試 | 通過 | 新增的 permission／presentation 錯誤回應測試在改前與改後的 server 上都通過。本步驟緊接步驟 3 進行，開始時記錄表沒有先改「進行中」，特此註記 |
| 5 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 6 | 隔離 Electron 真實 hook 驗證與改後回應比對 | 通過 | 三條通道送達；43 個案例狀態碼與 body 全同，見「Electron 實機驗證」 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-06-loopback-e825b4`。本步驟開始時記錄表沒有先改「進行中」，與完成一併更新，特此註記 |
| 8 | 總控退回：修正超過上限測試的競態與格式 | 通過 | 見「總控退回與修正」；完整 `test:unit` 連跑 3 次，三個超過上限的測試每次都通過 |

## 基準失敗清單（`b3a6f25`）

1341 項：1309 過、9 失敗、23 skip。失敗：「a file edit is medium only inside the project and never for execution-relevant paths」「a symlinked staging root is refused」「startup recovery restores interrupted replaces and removes only our own stale entries」「git helpers never follow gitdir or commondir outside the picked folder」「git helpers refuse a symlinked info directory or exclude file」「removing hooks from a symlinked dotfile keeps the link and its target」（symlink EPERM 類）；「a permission request still reaches the pet when the hook is stalled right after sending starts」「a status event still arrives when the hook process is stalled before it can send」「with the pet closed the hook does not wait, even if a crash left an old marker」（hook 停滯計時類）。基準在任何程式修改前執行。

## 盤點結果

| 項目 | event（64 KB） | permission（16 KB） | presentation（16 KB） |
|---|---|---|---|
| token 比對 | 每次請求 `Buffer.from(eventToken)`；缺少 → 空 Buffer；長度不同提早返回 | 非字串 → false；每次請求轉 expected Buffer | expected 預先轉好；缺少 → 空字串 |
| content-type | 三處相同的 `split(';')[0].trim().toLowerCase() === 'application/json'` | 同左 | 同左 |
| body 讀取 | `on('data')`／`on('end')`，`Buffer.concat(chunks)`（未帶總長） | `for await`，先檢查宣告的 content-length，超過或任何錯誤回 `null` | `on('data')`／`on('end')`，`Buffer.concat(chunks)` |
| 超過上限 | 413 `request too large`（串流中立即回） | 400 `invalid_request`（沒有 413） | 413 `request_too_large` |
| 空 body | 400 `invalid JSON` | 400 `invalid_request` | 視為 `{}` |
| 錯誤 JSON | 400 `invalid JSON` | 400 `invalid_request` | 400 `invalid_json` |
| JSON 回應 header | 無（`writeHead(status)` 後 `end(str)`，chunked） | 先 `setHeader` 三個安全 header，再 `statusCode` + `end` | `writeJson`：三個安全 header + content-length |
| `remoteAddress` | 不檢查 | 只接受 `127.0.0.1`／`::1`／`::ffff:127.0.0.1` | 不檢查 |

**client 是否解析錯誤字串**：`agent-hook.mjs` 的 `postLocal` 只讀狀態碼（只有 200/201 才讀 body）；OpenCode plugin（`setup.ts` 模板）只讀狀態碼與成功時的 `decisionId`；**`presentation-mcp.mjs` 會把錯誤 body 的 `error` 字串當成 MCP 工具的錯誤訊息**（`new Error(parsed.error)`）。因此 presentation 的 `request_too_large`／`invalid_json` 是 client 可見的契約；event 的 `request too large` 雖然目前沒有 client 解析，但第三方 generic-http 整合可能讀它。結論：**不統一 413 字串**，各 server 保留自己的錯誤字串與 permission 的「全部 400 `invalid_request`」政策。

## 設計摘要

新增 `electron/loopback-http.ts`（不 import electron，Node 測試可直接載入）：

- `tokenMatches(supplied, expected: Buffer)`：非字串（缺少或重複 header 成陣列）→ false；長度不同提早返回（沿用三個 server 的既有作法）；否則 `timingSafeEqual`。expected 由各 server 建立時轉好一次，熱路徑不再每次配置。
- `hasJsonContentType(request)`：三處相同的 media type 判斷。
- `readBoundedJson(request, maxBytes)` → `{ ok: true, value } | { ok: false, reason: 'too_large' | 'empty' | 'invalid_json' | 'aborted' }`：宣告的 content-length 超過上限時不讀 body 直接回 `too_large`；串流中一超過上限就清空已累積的 chunk、回 `too_large`，並 `resume()` 讓剩餘資料被丟棄、回應送得出去；單一 chunk 直接使用，多個 chunk 以已知總長 `Buffer.concat(chunks, total)` 一次配置；只用非同步串流事件，沒有同步 I/O。
- `sendJson(response, status, value, headers?)` 與 `JSON_RESPONSE_HEADERS`（`as const satisfies OutgoingHttpHeaders`）：安全 header + 精確 content-length，`retry-after`／`allow` 以參數補上。

各 server 以 `switch (reason)` 對應自己的錯誤政策：event 把 `empty`／`invalid_json` 都回 `invalid JSON`；presentation 把 `empty` 當 `{}`；permission 保留 `readJsonBody()` 薄包裝，任何失敗回 `null`。`aborted` 時不回應（連線已斷，與改前相同）。event／presentation 的 handler 改為 `async`（permission 原本就是）；拋錯時由既有的 `crash-guard.ts`（同時處理 `uncaughtException` 與 `unhandledRejection`）接手，與改前在 `'end'` callback 內拋錯的處理等級相同。

## 改前／改後回應比對

同一支探測腳本（session scratchpad，不在版本控制內）對三個 server 送 43 個請求：GET／未知路徑、帶 Origin、缺 token、短 token、同長度錯 token、缺 content-type、空 body（無 content-length 與 `content-length: 0`）、錯誤 JSON、JSON 陣列、不合格事件、宣告長度超過上限、chunked 串流超過上限、正好 64 KB 的錯誤 JSON、permission 各路由與未知紀錄、presentation 的 405／415／空 body／disconnect／分段送出的不合格 intent。

| 比對 | 結果 |
|---|---|
| 狀態碼與 body | **43／43 相同** |
| header | permission 與 presentation 全部相同；event 的 13 個 JSON 錯誤回應（403／401／415／400／413）新增 `content-type: application/json; charset=utf-8`、`cache-control: no-store`、`x-content-type-options: nosniff`，並由 chunked 改成精確 `content-length`。`x-agent-pets-server: event` 仍在；404 與 204 仍沒有 body、header 不變 |

event 的 header 變化是「一致的錯誤回應 helper」刻意帶來的加法：三個既有 client 都不讀這些 header（`agent-hook.mjs` 只讀狀態碼；`server-health.ts` 的探測只看 `x-agent-pets-server`，它出現在 404 回應上），沒有 client 可見的行為改變，並讓 event 的錯誤 body 不會被瀏覽器當成 HTML 猜型別。

另外兩個不改變 client 結果的時序差異：(1) 宣告的 content-length 超過上限時，event／presentation 現在不讀 body 直接回 413（改前讀到超過才回），狀態碼與 body 相同；(2) permission 在 chunked 串流超過上限時，改前由 `for await` 的 `return` 摧毀請求串流、改後讀掉丟棄，兩者 client 都收到 400 `invalid_request`（改前實測即如此）。我方的 client 一律帶 content-length，只會走 (1) 的宣告長度路徑。

## Electron 實機驗證（Windows 11，隔離 HOME，螢幕外）

改前與改後各以 `vite build` 後的 repo 啟動 `scripts/e2e-isolated-electron.mjs --offscreen --hook-port-base 28873 --debug-port 9478 --inspect-port 9479`；三個 server 聽在 `127.0.0.1:28873/v1/events`、`28874`、`28875`。沒有點擊任何畫面元素。

| 通道 | 做法 | 結果 |
|---|---|---|
| event（真實 Claude Code hook） | `scripts/e2e-real-hook.mts --home <隔離 HOME> --hook-port-base 28873 --debug-port 9478` | `all 8 hook events rendered as expected` |
| permission（setup.ts 產生的 OpenCode plugin） | `openCodePluginContent('opencode-cli')` 只把 `17373`／`17374` 換成隔離埠（斷言只改兩行）並以 data URL 載入；送 `permission.asked`，經 CDP 呼叫寵物 store 的 `decidePermission(…, 'deny')` | 寵物 store 出現一筆 `pending`（來源 `opencode-cli`、描述為 title）；決定 `{ ok: true, status: 'denied' }`；plugin 經 decision 路由取得決定並回覆 OpenCode `{ requestID, reply: 'reject', directory }`，經 result 路由回報後 store 清空——request、decision、result 三個路由都走過 |
| presentation（隔離 HOME 內實際部署的 `presentation-mcp.mjs`） | 以 `AGENT_PETS_PRESENTATION_PORT=28875` 啟動，stdio 送 `initialize`、`pet_status`、`pet_say` | `pet_status` 回傳真實寵物資料與 `queueDepth`；`pet_say` `accepted: true`；寵物畫面出現該句 |
| 負向（改前／改後） | 見上一節 | 43／43 狀態碼與 body 相同 |

結束時寵物視窗 `document.hasFocus()` 為 `false`、`screenX = -18752`。之後結束 app、刪除兩次的隔離暫存目錄，確認 28873–28875、9478、9479 已無監聽。依階段 1／5 的做法，執行 `e2e-real-hook.mts` 的程序把 `USERPROFILE` 設為不存在的路徑（腳本仍斷言所有寫入都在隔離 HOME 內）。

偏差：helper 的單元測試第一次執行時，「串流超過上限」的兩項以連續 `setImmediate` 狂寫，client 收到 ECONNRESET。以獨立實驗確認這是 Node 的既有行為（回應結束後關閉仍在上傳的連線；改前的 event 寫法同樣 30／30 重設），不是回歸；測試改為與探測腳本相同、段與段之間間隔 5 ms，並在測試內註明。

## 總控退回與修正

總控在完整 `test:unit` 負載下看到「a streamed body over the limit is rejected as soon as it crosses, and the rest is drained」失敗（`read ECONNRESET`），單獨執行則通過。原因是測試本身的競態：server 回應並結束後 Node 會關閉仍在上傳的連線，負載下 client 可能在讀到回應之前就收到重設。前面以「段與段間隔 5 ms」降低機率，但沒有消除競態。產品行為不變，只改測試：

- 新增 `postOversize()`：收到回應標頭就停止寫入，連線錯誤只記錄不 reject；只接受 `ECONNRESET`／`EPIPE` 兩種重設，其他錯誤仍讓測試失敗。
- 三個超過上限的測試（多 1 byte、串流超過、宣告長度超過）改以 **server 端 `readBoundedJson` 的結果**判定（`waitForResults()` 等待結果），每個請求只結算一次 `too_large`。若 client 有收到回應，它也必須正是 `too_large`。
- `electron/loopback-http.ts` 補上 `chunks[0] : Buffer.concat` 少掉的空格。

驗證：`tests/loopback-http.test.mts` 單獨跑 3 次都是 11／11。完整 `pnpm.cmd run test:unit` 連跑 3 次，都是 1354 項，三個超過上限的測試每次都通過。第 2、3 次的失敗清單與基準逐項相同（9 個）；第 1 次多了「a starting app that never opens its port holds the hook for a bounded time only」（`tests/agent-hook-delivery.test.mts`，階段 5 的基準也列有這個計時偶發測試），單獨重跑通過。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| 新增測試 | `tests/loopback-http.test.mts` 11 項：任意位元組切段（含切在 UTF-8 字元中間）、單一 chunk、正好上限與多 1 byte、串流超過上限後剩餘資料被丟棄且回應送達、宣告長度超過、空 body（有無 `content-length: 0`）、錯誤 JSON 與純空白、中途斷線為 `aborted`、`tokenMatches`（正確、同長錯值、最後一位不同、較短、較長、空、缺少、重複 header 陣列、多位元組字元）、`hasJsonContentType`、`sendJson` header 與 content-length |
| server 層固定測試 | permission：五個路由的空 body／錯誤 JSON／超過上限都是 400 `invalid_request`、401／415／404 字串、204 也帶安全 header；presentation：413 `request_too_large`、400 `invalid_json`、415、短 token 與錯 token 401、405 與 `allow: POST`、空 body 視為 `{}`。**兩個新測試在改前的 server 上也通過**（暫時換回 `b3a6f25` 的兩個檔案執行後還原），證明固定的是既有行為 |
| event server | `event-server.ts` 匯入 `electron` 的 `app`，Node 測試無法載入；以改前／改後黑箱探測與真實 hook 實測固定 |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1354 項：1322 過、9 失敗、23 skip（基準 1341 項 + 新增 13 項）。失敗清單與基準**逐項相同** |
| `git diff --check` | 通過 |
| 祕密掃描 | 對 diff 新增行掃 `ghp_`／`sk-`／私鑰／password／secret 樣式，無命中 |
| 相依套件 | 沒有新增或更新相依套件，`pnpm-lock.yaml` 未變，本階段不重跑 audit |

## 安全審查（`phase-gates.md` local server 檢查項）

| 檢查項 | 結果 |
|---|---|
| loopback 綁定 | 不變：event 經 `listenOnLocalPort` 綁 `127.0.0.1`；permission／presentation 由 `electron/main/runtime.ts` 同樣經 `listenOnLocalPort` 綁 `127.0.0.1`，未改 |
| 認證 | 三個 server 的 token 比對集中到 `tokenMatches`，仍是 `timingSafeEqual`、不同長度提早返回；缺少、短、同長錯值、重複 header 都是 401（測試與實測）。比對順序不變：event 與 presentation 在 Origin 檢查之後、permission 在 Origin 與 `remoteAddress` 之後 |
| body 上限 | 64 KB／16 KB／16 KB 不變；宣告長度超過直接拒絕、串流超過立即停止累積並清空已收 chunk，記憶體上限仍是 maxBytes |
| rate limit | 未改：event 的 `allowRequest`／`allowEvent`、permission 的 per-host／per-instance 預算、presentation 的 60 次／10 秒 |
| method allowlist | 未改：event 只收 `POST /v1/events`；presentation `GET status`、其餘 `POST`，405 帶 `allow`；permission 以 `METHOD path` 路由 key，GET 仍 404 |
| 授權政策與 Origin | 未改；錯誤字串保留 |
| 安全關閉 | 未改：server 的關閉、`headersTimeout`／`requestTimeout` 與 relay shutdown 都不在本階段範圍 |
| 同步 I/O | helper 只用串流事件；沒有新增檔案或資料庫操作 |

## Loopback 位址檢查評估（安全決策，本階段未改）

現況：只有 permission server 拒絕非 loopback 的 `remoteAddress`。三個 server 都只綁 `127.0.0.1`，所以正常情況下這個檢查是縱深防禦：綁定位址出錯（例如日後誤改成 `0.0.0.0` 或 `::`）時，permission 仍會拒絕區網來源，event／presentation 則只剩 token 擋。

評估：event 與 presentation 加上同一個檢查的成本極低（一次字串比對，不影響熱路徑），對既有 client 無影響（全都連 `127.0.0.1`）；風險是若有使用者透過自建的轉送（例如容器、WSL2 的 port proxy、SSH 反向通道）從非 loopback 位址送事件，會開始被拒。WSL2 的預設 NAT 模式下，Linux 端連 Windows 的 `127.0.0.1` 是無法到達的，需要使用者另外設 port proxy，這種情況下來源位址就不會是 loopback。

建議：**為 event 與 presentation 也加上 loopback 位址檢查**，改用 `loopback-http.ts` 共用的 `isLoopbackAddress()` 並把 permission 的實作移過去；回應字串沿用各 server 的 403 風格。同時在 README 註明 WSL／容器轉送不受支援。這是安全邊界變更，應由使用者決定後另開一個小階段處理，並在變更時加測試（假 socket 位址）與記錄。

## Code review 紀錄

- 語法：`JSON_RESPONSE_HEADERS` 用 `as const satisfies OutgoingHttpHeaders`；失敗原因是可辨識聯集，各 server 以 `switch` 窮舉，型別收斂取代 `as`；`?.` 判斷 content-type；`!(Number(declared) <= max)` 一併處理 NaN。
- 效能：event 每次請求不再配置 expected token Buffer；body 組合以已知總長一次 `Buffer.concat`，單一 chunk 零複製；超過上限立即停止累積並釋放已收的 chunk。沒有新增同步 I/O。
- 簡化：presentation 刪除 `writeJson`／`readToken`／`isAuthorized`，405 分支中永遠為 `'POST'` 的三元運算（狀態路徑已在上方處理）改成字面值；permission 刪除自己的 `hasValidToken`／`sendJson` 與 `for await` 讀取，`setSecurityHeaders` 改由共用 header 表產生。
- 風格：符合 `agent-pets-conventions`：`electron/` 內同層 `./` 相對匯入、新增註解為繁體中文並只寫「為什麼」、模組開頭以 `// ---` 區塊標頭說明。
- 本階段的工作量小、全部由總控直接實作與複檢，沒有派發子代理。

## 檔案變更狀態

| 路徑 | 變更 | 目的 |
|---|---|---|
| `electron/loopback-http.ts` | 新增 | 共用的 token 比對、content-type 判斷、限制大小的 JSON body 讀取與 JSON 回應 |
| `electron/event-server.ts` | 修改 | 改用共用模組；錯誤字串與流程不變；JSON 錯誤回應改帶安全 header |
| `electron/presentation-mcp.ts` | 修改 | 改用共用模組；錯誤字串、method allowlist 與空 body 政策不變 |
| `electron/permission-adapter-server.ts` | 修改 | 改用共用模組；`readJsonBody` 保留為薄包裝（任何失敗回 null）；`remoteAddress` 檢查不變 |
| `tests/loopback-http.test.mts` | 新增 | helper 單元測試 11 項；退回後超過上限的三項改以 server 端結果判定，消除連線重設競態 |
| `tests/permission-adapter-server.test.mts` | 修改 | 固定 body／認證失敗的狀態碼、錯誤字串與安全 header；測試 context 加 `raw` |
| `tests/presentation-mcp.test.mts` | 修改 | 固定 413／400／415／401／405 與空 body 行為 |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 記錄 loopback 共用模組與各 server 保留的政策、錯誤字串契約 |
| `docs/phase-reports/refactor-06-loopback-server.md` | 新增 | 本階段工作記錄 |

## 殘餘風險

- event server 無法在 Node 單元測試中載入（匯入 `electron`），它的錯誤對應只由黑箱探測與真實 hook 實測固定；日後若要納入單元測試，需把 request handler 拆到不匯入 electron 的模組。
- 超過上限後仍讀掉丟棄剩餘資料（改前 event／presentation 也是），惡意的本機 token 持有者可讓一條連線持續上傳到 `requestTimeout`；permission 與 presentation 沒有設定較短的 `requestTimeout`（沿用 Node 預設 300 秒）。記憶體不受影響。建議日後評估為這兩個 server 比照 event 設定 10／15 秒逾時。
- `tokenMatches` 在長度不同時提早返回，會洩漏 token 長度；token 長度固定且由格式公開（64 個十六進位字元），沿用既有作法。
- macOS／Linux 未實測；本階段沒有平台相關程式。

## 版本建議

本階段只是內部機制集中，client 可見的狀態碼與錯誤 body 不變，單獨評估為 patch；依整體重構計畫，不在本階段改版本，全部階段完成後統一升 minor。
