# Hook 狀態事件遺失：根因與修正（1.12.4）

## 現象

sprite 線第一次用 hook 驅動寵物時（隔離埠 27673），PreToolUse、StopFailure、Stop 三個事件的 hook 都以 exit 0 結束，畫面卻沒有變化。之後 40 個事件沒有重現。

## 根因

`integrations/agent-hook.mjs` 用 `fetch(…, { signal: AbortSignal.timeout(300) })` 送狀態事件。300 ms 從呼叫 `fetch` 之前就開始算，包含 Node 第一次呼叫 `fetch` 的初始化與連線。機器忙碌、多個 hook 同時執行，或 app 剛啟動時，請求還沒送出就被中止，`catch {}` 又把錯誤吞掉。

證據：

- 分層計數：在 event-server 暫時加計數（已移除，未進 commit），renderer 用 CDP 掛 preload 監聽，hook 用 `--import` 探針量時間，hook 本身不改。所有情境裡，主程序收到幾個就接受、送出幾個，renderer 也全部收到，rate limit 與格式錯誤都是 0。遺失的事件全部對應到 hook 端的 `TimeoutError`。
- 逾時就等於遺失：對假伺服器同時跑 40 個 hook，28 個逾時，其中 27 個伺服器完全沒收到。
- app 忙不會掉事件：伺服器監聽後把主執行緒卡住 1.2 秒，舊 hook 的 3 個事件全部收到。只要請求已經交給作業系統，app 晚點讀也收得到，所以問題出在 hook 端。
- 排除的可疑點：
  - 埠與 token：27673 是 sprite 線用 `--hook-port-base 27673` 啟動的隔離埠。app 日誌顯示在該埠監聽，hook 副本的 diff 只改了兩個網址。
  - renderer 尚未訂閱：冷啟動時，port 監聽後送出的事件全部進到 store。
  - 同一毫秒的 StopFailure → Stop：連續 20 組，renderer 全部依序收到。
  - store 去重：`handleEvent` 會套用每一個事件，沒有去重或依時間排序。

各情境的數字見 [docs/dev/hook-delivery.md](../dev/hook-delivery.md)。主要結果：12 核全滿時循序送 100 個，遺失 28 個；同時 20／40 個時，幾乎全部遺失；app 剛啟動時每 40 ms 送一個，150 個遺失 148 個。

## 修正

範圍只在 `integrations/agent-hook.mjs` 的狀態 POST。沒有改 `install.mjs`、`hook-config.ts`、`setup.ts`，也沒有改指令產生方式；事件格式與狀態字串都不變。

- 改用 `node:http`，不用 `fetch`。hook 的工作量少很多：同時 40 個時，收到回應最長 620 ms，`fetch` 是 2321 ms。
- 時限分成兩段：
  - 1500 ms：把請求交給作業系統。量到最長 535 ms，大約有 2.8 倍餘裕。
  - 250 ms：交出去之後等 204。app 回應慢時事件照樣送達，hook 不會等 app。
- 寵物沒開時連線立刻被拒，hook 馬上結束。hook 總耗時上限約 1.75 秒加上 Node 啟動時間，遠低於 Claude Code 與 Codex 的 hook 時限。
- 沒有加重試。連線被拒代表 app 還沒在監聽；如果加重試，每次寵物沒開時都會拖慢 agent。

## 驗證

- 回歸測試 `tests/agent-hook-delivery.test.mts`：
  - hook 讀完 payload 後卡住 400 ms：修正前 3/3 次失敗（事件沒有送到），修正後每次都通過。
  - app 晚 3 秒才回應：事件仍送達，hook 在 2 秒內結束。
  - 回應中途斷線，或送出標頭後卡住：hook 不崩潰、不寫 stderr、2 秒內結束。
  - 請求的方法、路徑、標頭與內容維持不變，而且不帶 Origin。修正前後都通過。
- `tests/claude-permission-hook.test.mts` 的時限 patch 改成對應新常數。常數改名時，測試會直接失敗。
- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design:strict` 通過。`pnpm run test:unit`：1232 個，1231 通過、1 略過、0 失敗。
- 真實 hook e2e（`scripts/e2e-real-hook.mts`，隔離 HOME 與埠 27373–27375）：
  - 修正前後對照（CPU 滿載，各 5 輪 40 個）：修正前 28 個不符，修正後每個事件的 session 狀態都正確。修正後那輪有 15 個畫面不符，原因是修正前那輪遺失 Stop 後，有 session 卡在 thinking。換新 app 後重跑，全部正確。
  - 最終程式：冷啟動 5 次共 80 個、CPU 滿載 80 個、一般負載 320 個，全部畫到寵物上。另外，回應處理強化之前跑過的 488 個也全部正確。
- 冷啟動（`cold.mjs`，port 一開放就送）：port 監聽後送出的事件，修正前 0/148 送達，修正後 171/171 送達。

## 資安與效能審查

- token 只送到寫死的 loopback 網址，不使用 keep-alive，不帶 Origin，也沒有新增檔案讀寫或輸出。所有錯誤都會結束等待，不會 reject；`error` 用 `on` 監聽，避免銷毀請求時第二次 error 沒有監聽者。
- 熱路徑：每次 tool 呼叫都會執行 hook。改用 `node:http` 後，hook 自己的工作量降到大約四分之一（同時 20 個時，p50 115 ms，`fetch` 是 1099 ms），正常情況收到 204 就結束。
- 1.12.1（`d45ca8d`）的 Windows 指令規則沒有動到：指令不加引號，空白或非 ASCII 路徑改走 `cmd /d /c`，含 `$` 或反引號的路徑拒絕。相關測試都在 test:unit 內，全部通過。

## 殘餘風險

- app 綁定 port 之前送出的事件（冷啟動實測 3/30、6/150）會被拒絕，下一個事件才會讓畫面跟上。1.12.5 已改為 app 啟動期間短暫重試，見 [phase-hook-hardening.md](phase-hook-hardening.md)。
- Windows 與 Linux 未實測。程式只用 `node:http` 和 loopback，與平台無關。
- 權限回覆流程（`permissionPost`）仍用 `fetch`，每次呼叫 1 秒時限，不在這次範圍內。1.12.5 已改用相同的 `node:http` helper，見 [phase-hook-hardening.md](phase-hook-hardening.md)。

## 版本

patch：1.12.4。
