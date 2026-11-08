# 啟動時間預算

寵物視窗要在 plugin、歷史、成就服務之前建立，這樣磁碟慢或 plugin 很多時，寵物也不會晚出現。

| 階段 | 目標 |
| --- | --- |
| 行程啟動到寵物視窗建立（`pet-window` 步驟結束） | < 800 ms（一般 SSD、冷啟動） |
| 其餘服務（plugins、permission、history 等） | 在寵物出現之後非阻塞初始化 |
| 歷史對帳與首次本機用量掃描 | 歷史服務啟動後延後 10 秒才執行 |

## 如何量測

- 每個啟動步驟都會寫入 `performance.mark('agent-pets:startup:<step>')`。
- 設定 > 進階 > 匯出診斷資訊，內容的 `startup` 區段會列出每一步的開始時間與耗時。
- 事件迴圈延遲可用 `pnpm bench:lag` 在 500 events / 10s 的負載下量測。

## 已知取捨

任一步驟丟出例外只會被記錄並跳過，不會阻止視窗顯示（見 `electron/main/crash-guard.ts`）。
