# 本機用量掃描：worker thread 評估

結論：**不採用 worker**，保留主執行緒掃描；另把 History 寫入批次從 500 筆縮為 100 筆（可由 `importBatchRecords` 調整）。

## 方法

- 腳本：`scripts/bench/local-usage-lag.mjs`（原型 worker：`scripts/bench/local-usage-worker-prototype.mjs`，只供量測，非 production）。
  指令：`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/bench/local-usage-lag.mjs --rounds=7`
- Fixture 只在暫存目錄產生，不讀取真實的 `~/.codex`、`~/.claude`：100 個 Claude transcript（各 300 行，三分之一為 assistant usage，其餘為約 1KB 的 user 行）加 60 個 Codex rollout（各 400 行，`session_meta` + 累計 `token_count`），約 4 萬行、約 32MB，匯入 16,000 筆 usage。
- 每個組合在獨立子行程中執行（乾淨的 JIT 與暫存資料庫），每一輪依序跑完所有組合，因此是交錯量測。
- 事件迴圈延遲用 `monitorEventLoopDelay({ resolution: 1 })`，涵蓋從開始掃描到匯入完成。
- 組合：`main500`＝改前（主執行緒掃描、500 筆一批寫入）；`main100`＝只改批次大小；`worker100`＝worker 做走訪與解析、主執行緒以 100 筆一批寫入 sqlite（`node:sqlite` 必須留在主執行緒）。
- 環境：macOS x64、Intel i7-9750H（12 邏輯核心）、Node v26.13.0。

## 數字

**量測期間機器負載極高**（load average 50～350，其他 Electron 與測試行程同時在跑），事件迴圈延遲主要反映排程競爭，不是乾淨的實驗室數字。9 輪的中位數（毫秒）：

| 組合 | mean | p99 | max | 總耗時 |
| --- | --- | --- | --- | --- |
| main500（改前） | 12.17 | 147.59 | 273.15 | 7198 |
| main100 | 10.73 | 116.06 | 184.16 | 7566 |
| worker100 | 9.03 | 143.65 | 257.82 | 6757 |

各輪之間的離散遠大於組合之間的差異（同一組合的 p99 從 61 到 247）。9 輪中負載最低的一輪（三個組合同輪、互相可比）：

| 組合 | mean | p99 | max | 總耗時 |
| --- | --- | --- | --- | --- |
| main500 | — | 64.7 | 75 | 3796 |
| main100 | — | 61.3 | 71 | 3831 |
| worker100 | — | 62.1 | 76 | 3370 |

另一組不受計時器影響的確定性量測（單一行程，32 批各 N 筆 `recordTokenUsageBatch` 的同步耗時中位數）：500 筆 31.5ms、100 筆 7.1ms、50 筆 4.7ms。主執行緒被 sqlite 同步寫入佔住的時間與批次大小成正比。

## 決策與理由

決策規則是「worker 版 p99 降低 ≥30% 或絕對值降低 ≥5ms，且打包風險可確認」。worker100 相對 main100 的 p99 沒有可辨識的改善（中位數反而較高，最低負載輪僅差 0.8ms），不符合規則，所以不做。原因：

1. 現行掃描已經以 1MB 為單位切片並在切片之間 `setImmediate` 讓出，解析本身不長時間佔住事件迴圈；真正同步的大塊工作是 `node:sqlite` 寫入，必須留在主執行緒，worker 動不了它。
2. worker 只省下解析與檔案 I/O 的 CPU，卻新增了 vite-plugin-electron 多入口、asar 內 worker 路徑、崩潰／逾時回退、`shutdown` 時 terminate、增量快取狀態歸屬等複雜度與風險（`package.json` 的 `build.files` 屬於其他工作線，未確認）。
3. 可確認有效的是縮小寫入批次：同步阻塞由約 31ms 降到約 7ms，且總耗時沒有惡化。這部分以 `importBatchRecords`（預設 100）實作，並有單元測試。

熱路徑檢查：`filesUnder`、`interleaveByRoot`、`parseIncrementalLocalUsageChunk`、`importRecords` 都是單趟或 Map／Set 去重，沒有 O(n²) 或重複排序，不需改動。

## 殘餘風險

- 量測在高負載機器上進行，p99／max 的絕對值不可當作使用者機器的預期值；批次縮小對 p99 的好處在本次量測中沒有統計上可分辨的證據，主要依據是確定性的單批同步耗時。
- 若日後出現單檔超大、解析成為瓶頸的情境，再用同一支 bench 重新評估 worker；屆時需先處理上述打包與回退問題。
- 批次縮小使每批的 `onRecordsImported` 呼叫次數增加（下游本來就是冪等 upsert）。
