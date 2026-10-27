# Phase 18 效能基準

量測日期：2026-10-26。這是改動演算法前的基準，使用 `pnpm bench` 與 Node 內建計時、SQLite、WebSocket。每個 Node 微基準先暖機 3 次，再量 30 次；表格列出中位數與 p95。測試資料固定亂數種子，所有檔案與資料庫都建立在暫存目錄，報告只記錄相對路徑。

## 基準結果

| 項目 | 固定資料量 | 中位數 | p95 | 改前時間複雜度與觀察 |
| --- | --- | ---: | ---: | --- |
| 本機用量首次掃描 | 50 個 JSONL、200 MiB；現行 64 MiB 掃描上限 | 114.655 ms | 123.033 ms | O(可掃描位元組數 + 檔案數)；每次掃描都重新讀取符合上限的整檔 |
| 本機用量追加 1 MiB 後掃描 | 同一組資料，追加至已掃描檔案 | 110.095 ms | 115.372 ms | O(原有檔案位元組數 + 追加位元組數)；沒有 byte offset 快取 |
| Agent 狀態事件 | 1,000 個 session、10,000 筆事件 | 84.608 ms | 102.619 ms | 新 session 會建立 `Object.values` 清單；新增階段最壞 O(n²)，事件查找 O(1) |
| 泡泡仲裁 | 10,000 組候選 | 0.202 ms | 0.331 ms | O(1)，候選類別數固定；量測後不需優化 |
| 插件 feed enqueue/dequeue | 10,000 筆，逐筆完成 | 80.165 ms | 92.878 ms | queue 深度固定上限 8，queue 操作為 O(1)；中心保留上限 500 |
| Plugin net 限流 | 每秒 10,000 次呼叫 | 17.540 ms | 20.825 ms | O(r)，r 為目前視窗時間戳數；正式上限 30 |
| Feed 限流 | 每秒 10,000 次呼叫 | 10.613 ms | 10.925 ms | O(r)，正式每插件上限 30、全域上限 300 |
| Badge 限流 | 每秒 10,000 次呼叫 | 6.524 ms | 6.825 ms | O(1)，每插件只記錄最近一次時間 |
| eventSource 限流 | 每秒 10,000 次呼叫 | 46.230 ms | 47.664 ms | O(r + s)，時間戳與 session 數均有固定上限 |
| Command 限流 | 每秒 10,000 次呼叫 | 3.289 ms | 3.771 ms | O(1)，每指令只記錄最近一次呼叫時間 |
| History 七日統計 | 100,000 筆事件與統計列 | 430.839 ms | 470.834 ms | O(符合日期與 pet 條件的統計列數)；現行查詢以主鍵索引搜尋日期與 pet 後讀取所有符合列 |
| History 專案篩選 | 同上，指定一個專案 | 0.167 ms | 0.328 ms | O(log n + m)；主鍵索引可直接定位日期、pet 與 project |

冷啟動在隔離 Electron 中量 5 次，從 launcher 啟動到 `AGENT_PETS_E2E_READY` 並且第一個 app 頁面的 `document.readyState` 為 `complete`。樣本為 2143.121、2411.462、2341.864、2011.239、2345.656 ms，中位數 2341.864 ms。五次 `safeStorage` 的 `isEncryptionAvailable`、`encryptString`、`decryptString` 起訖計數皆為 0；各次 `blockedExecs` 起訖為 0→3、0→3、0→3、0→0、0→3。

| 輸出目錄 | 檔案數 | 大小 |
| --- | ---: | ---: |
| `dist/` | 13 | 9,797,984 bytes |
| `dist-electron/` | 4 | 1,335,111 bytes |

History 的 `EXPLAIN QUERY PLAN`：

- 七日統計：`SEARCH daily_stats USING INDEX sqlite_autoindex_daily_stats_1 (local_date=? AND pet_id=?)`
- 專案篩選：`SEARCH daily_stats USING INDEX sqlite_autoindex_daily_stats_1 (local_date=? AND pet_id=? AND project_id=?)`

## 量測方法

- `pnpm bench` 以固定種子建立合成 JSONL、Agent session、插件事件與 SQLite 資料，輸出每項 30 次的中位數及 p95；冷啟動按規格量 5 次。
- 限流項目各執行 10,000 次呼叫。Plugin net 使用注入的本機測試傳輸與文件保留的測試地址，不會發出網路請求；其餘使用各 controller 的固定狀態與時鐘。
- 冷啟動只呼叫 `node scripts/e2e-isolated-electron.mjs`，並等待 READY 與 app 頁面載入完成。啟動器會先確認假的可逆 `safeStorage`，正式鑰匙圈與系統權限 API 都未觸發。
- 微基準的時間會受硬體及其他程序影響；P18.3、P18.4 會在相同工作負載與工具下做前後比較，並以固定亂數種子執行至少 1,000 組等價測試。
