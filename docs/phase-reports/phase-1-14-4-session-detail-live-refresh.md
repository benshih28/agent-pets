# 1.14.4 工作階段詳情彈窗即時更新

- **基準 commit**：`975f6b3`（`main`，版本 1.14.3）
- **分支**：`fix/session-detail-live-refresh`
- **版號**：使用者已指示完成後升 patch，版本 1.14.4。

## 問題

History → Sessions 點開的工作階段詳情彈窗只在打開時讀一次資料，之後不再更新，也沒有重整按鈕；想看到最新進度只能關閉彈窗再點一次。背後的清單在彈窗開著時刻意不刷新，關閉後也不會補刷，同樣停在舊資料。

## 修正

- `src/components/growth/HistorySessionDetail.vue`：彈窗開著時訂閱既有的 `onHistoryUpdated`（主程序每寫入一批事件就廣播，最多約每秒一次），去抖 500 ms 後以 silent 模式重讀 `getHistorySessionDetail`。silent 讀取沿用畫面上的資料、不清空、不顯示骨架，失敗時保留上一份結果；以既有的 `requestSeq` 丟棄過期回應。關閉或卸載時取消計時器與訂閱。
- `src/components/growth/HistorySessions.vue`：彈窗開著時清單仍不刷新（避免跳動），但記下期間收到過更新；關閉彈窗時若有錯過的更新且仍在第一頁，補刷一次。
- 不加重整按鈕：即時更新已涵蓋需求，避免多一個控制項。

## 驗證

| 項目 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint`（含 `typecheck:tests`） | 通過 |
| `git diff --check` | 通過 |
| `pnpm test:unit` | 1847 tests、1808 pass、0 fail、39 skip |
| `pnpm exec vite build` | 通過 |

### Electron 實機驗證

以 `scripts/e2e-isolated-electron.mjs --offscreen`（隔離 HOME／userData、獨立連接埠、視窗在螢幕外且不搶焦點）啟動建置後的 app，經事件埠 POST 工作階段事件，透過 CDP 操作控制面板，彈窗全程不關閉。連續三輪皆通過：

- **面板可見**：送出 `Stop` 後約 2.4–2.7 秒，時間軸多出 `Success` 列，結果由「進行中」變為「完成」。
- **面板被收起**：收起期間送出的 `PreToolUse(Read)` 不會更新（主程序對不可見視窗延後廣播，屬預期）；重新開啟面板後約 1–1.8 秒，`attachBroadcastResync` 補送的更新讓彈窗補上該列。
- 面板 renderer 共收到 2 次 `history-updated`，與兩次寫入相符。

## 安全審查

- 沒有新增 IPC、HTTP 端點、檔案寫入、權限路徑或持久化 schema；只在 renderer 端多訂閱既有的唯讀廣播並重呼叫既有的唯讀 IPC。
- 重讀頻率受主程序約每秒一次的合併與 500 ms 去抖限制，不會形成迴圈（`getHistorySessionDetail` 不觸發掃描或廣播）。
- 沒有新增 UI 文字或視覺樣式。

## 殘留風險

- 只在 Windows 上驗證；macOS／Linux 未測。
- 長時間開著一個非常長的時間軸（上限 `HISTORY_SESSION_TIMELINE_MAX`）時，每次更新都會重讀整份詳情；資料量有上限，實測無明顯成本。

**建議版號：patch 1.14.4**。UI 行為修正，沒有改持久化 schema、公開契約或安全邊界。
