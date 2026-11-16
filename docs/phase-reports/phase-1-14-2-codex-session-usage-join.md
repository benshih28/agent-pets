# 1.14.2 Codex 工作階段對上本機紀錄 token

- **基準 commit**：`f95a51f`（`main`，版本 1.14.1）
- **分支**：`claude/codex-session-usage-join`
- **版號**：使用者已指示完成後升 patch，版本 1.14.2。

## 問題

History → Sessions 裡的 Codex 工作階段，token 與模型幾乎都顯示「—」；但 History 的總計、每日圖表與 agent 分布都有 Codex 的 token。

## 根因

- 工作階段列表靠 `digest(adapter:agent:rawSessionId)` 把本機紀錄的用量對到 hook 回報的工作階段（`localUsageKeySource`）。
- Codex rollout 的 `event_msg`／`token_count` 行沒有 `session_id`，`codexUsage` 退回用 `fileKey`（`digest("codex:<檔案路徑>")`），所以永遠對不上 hook 的 Codex thread id。
- Codex hook 也不帶 token，`tokenSource` 因此是 `none`，介面顯示 `growth.sessionUnknown`（「—」）。
- 總計與每日統計按日期與 adapter 累加，不需要對上工作階段，所以看得到數字。

## 修正

- `electron/local-usage.ts`：從 rollout 第一行 `session_meta.payload` 讀 thread id（新版的 `session_id`，舊版退回 `id`），存進 parser state（`codexSessionId`），整檔解析與增量解析都會帶給後面的 `token_count`。分塊續讀時同樣保留這個值。行內若已有 `session_id` 仍優先；兩者都沒有時才用 `fileKey`。
- `electron/history.ts`：重讀同一筆用量時，「無變更」的判斷加上 `session_id`。這樣，修正前用 `fileKey` 匯入的舊資料，在下一次啟動 App 重新掃描時（掃描快取只存在記憶體），會從舊 key 的 `session_model_usage` 扣掉、加到正確的工作階段。總計與每日統計是先扣後加，數字不變。
- 沒有改持久化 schema，也不需要 migration。

## 驗證

| 項目 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint`（含 `typecheck:tests`） | 通過 |
| `git diff --check` | 通過 |
| 新增測試 3 項 | 套用修正前 3 項都失敗，套用後通過 |
| `pnpm test:unit` | 1840 tests、0 fail、39 skip（1.14.1 為 1837／0／39，多出的 3 項是本次新增） |
| `pnpm exec vite build` | 通過（升版後） |

新增的測試：

- `Codex usage joins the hook session through the session_meta thread id`：hook 事件與 rollout 同一個 thread id，掃描後工作階段的 `tokenSource` 是 `local`，fresh input、cache read、output 與模型都正確。
- `the Codex thread id survives a chunk boundary and falls back to the older id field`：`session_meta` 與 `token_count` 分在兩個 chunk、只有舊版 `id` 欄位時仍能取到 id。
- `a rescan that learns the real session id moves the usage onto that session`：舊 key 的用量在重讀後搬到正確的工作階段，總計不重複計算，再重讀一次是 no-op。

另外核對了本機實際的 Codex rollout：第一行 `session_meta.payload` 同時有 `session_id` 與 `id`，兩者與檔名中的 UUID 相同。

## 安全審查

- 沒有新增 IPC、HTTP 端點、檔案寫入或權限路徑。
- 讀到的 thread id 和既有的 `session_id` 一樣，經 `text()` 截斷到 256 字元，寫入資料庫前再做 `digest`，不存原始 id。
- 沒有新的 UI 文字，不涉及 prompt、路徑或憑證外洩。

## 殘留風險

- 舊資料要等下一次啟動 App、完整重新掃描後才會補上明細。超過保留天數、已不再掃描的舊紀錄不會補。
- 很舊的 Codex 版本若 rollout 沒有 `session_meta` 行，仍會退回用 `fileKey`，維持原本只有總計的行為。
- 只在 Windows 上驗證；macOS／Linux 的 rollout 格式相同，依既有測試推定。
- 沒有啟動 Electron 實機看 Sessions 畫面，只靠單元測試。

**建議版號：patch 1.14.2**。修正資料對應，沒有改持久化 schema、公開契約或安全邊界。
