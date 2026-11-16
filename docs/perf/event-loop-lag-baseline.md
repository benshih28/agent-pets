# Event loop lag 基準與門檻

`scripts/bench/event-loop-lag.mjs` 在 10 秒內對暫存 HistoryStore 寫入 500 個 hook 事件（事件伺服器每個視窗的上限），用 `monitorEventLoopDelay`（解析度 5ms）量主執行緒延遲。

## 指令

- `pnpm bench:lag`：只印出 mean／p99／max（毫秒），行為不變。
- `pnpm bench:lag:check`：同樣量測後與 `scripts/bench/event-loop-lag.baseline.json` 的 `thresholds` 比對；任一項超過就印出差異並 exit 1。

## 基準與門檻

基準檔記錄量測條件（Node 版本、機器、事件數）、5 次原始結果與中位數：mean 5.43、p99 7.29、max 14.18（ms）。

| 指標 | 中位數 | 門檻 | 理由 |
| --- | --- | --- | --- |
| mean | 5.43 | 12 | histogram 解析度 5ms，下限約 5ms；門檻約中位數 2 倍多 |
| p99 | 7.29 | 25 | 約中位數 3.5 倍，留給 CI 機器抖動 |
| max | 14.18 | 300 | 單次尖峰最容易受 CI 抖動影響（5 次中出現過 110ms），取固定上限，只攔截真正的長時間阻塞 |

## 更新基準

1. 在安靜的機器上連跑至少 5 次 `pnpm bench:lag`，記錄每次結果。
2. 更新 `event-loop-lag.baseline.json` 的 `conditions`、`runs`、`medians`。
3. 門檻維持「p99 約 3 倍以上中位數、max 固定上限」原則；只有在刻意接受延遲增加時才調高，並在 PR 說明原因。

## CI 建議用法

在 CI 的 Node 步驟中加一行 `pnpm bench:lag:check`（約 10 秒，不需要建置或 Electron）。它是粗粒度的回歸護欄，不要設成必須通過的阻擋條件前先觀察幾次 runner 的實際數字。實際 workflow 接線由 CI 工作線負責。

本機用量掃描的另一組量測見 [local-usage-worker.md](local-usage-worker.md)。
