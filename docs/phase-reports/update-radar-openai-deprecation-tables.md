# Update Radar：OpenAI 停用頁改版為總表

日期：2026-11-17  
基準 commit：`c926b69`（`feature/agent-updates-radar`）  
基準版本：`update-radar` `0.4.0`  
完成版本：`update-radar` `0.4.1`

## 問題與範圍

OpenAI 的 `https://developers.openai.com/api/docs/deprecations.md` 仍可正常取得（HTTP 200、`text/markdown`、約 63 KB），但頁面已從「每次公告一個日期標題」改成「即將停用／功能與端點停用／已停用」三張總表，欄位為 `Shutdown date | Affected … | (Status) | Recommended/Listed replacement | Notice date`，整頁沒有日期標題。

`parseDatedMarkdown` 因此解析出 0 筆，`main.js` 判定 `source_format_changed`，排程依退避間隔不斷重試仍失敗，面板顯示為重連失敗。網址沒有被棄用，也不是網路或權限問題。

本次同時修改外掛執行版本 `update-radar/plugin/dist/core.js` 和獨立 CLI `update-radar/src/normalize.mjs`，兩邊使用相同的分組與識別規則。

## 修正

- `parseDatedMarkdown` 找不到日期標題時，改走新的 `extractNoticeTableSections`；仍有日期標題的來源維持原本的行為與識別碼。
- 只採用同時有停用日、公告日和受影響項目欄位的表格；其他表格和日期無法解析的列都會略過。
- 以 `Notice date` 分組，一次公告成一筆更新，標題為 `Deprecated: <前三項> +N`，並沿用既有的 `extractRetirements` 產生 `retirements`，面板現有的停用倒數卡片可直接顯示。
- 每列只保留停用日、受影響項目、替代方案三欄來組成內容雜湊；狀態欄或欄寬改變、列從「即將停用」移到「已停用」時，識別碼不變，不會重複通知。
- 同一公告內的列先依停用日、項目名稱、替代方案固定排序，再組標題與內容雜湊；部分列跨表移動時識別碼不變（審查第 1 點）。
- `MAX_RETIREMENTS` 由 12 調為 64，並由 `main.js` 的 `isStoredUpdate` 共用；只改解析上限的話，重新啟用外掛時超過 12 列的公告會被儲存驗證丟掉（審查第 2 點）。
- 通知一律送 `priority: 'normal'`：App 的 `PluginFeedController` 只接受 `normal`／`low`，0.4.0 起送出的 `'high'` 會被 Broker 以 `invalid_request` 拒絕，通知中心收不到（審查第 3 點，0.4.0 既有問題）。測試替身的 `feed.notify` 現在照 Broker 規則拒絕其他值，原本把 `'high'` 當成正確答案的測試也已修正。
- CLI 沒有 `retirements` 欄位，所以由分組直接提供 `effectiveAt`（最早的停用日）和 `replacement`（整組只有一種替代方案時才填）；內文已能解析出這兩個值時仍以內文為準。

## 驗證

| Gate | 結果 |
|---|---|
| 真實頁面解析 | 32 筆（達 `maxItems` 上限），`changeType` 均為 `deprecated`，`effectiveAt`、替代模型和倒數列都正確；2026-04-22 公告 26 列、2023-07-06 公告 34 列完整保留；序列化約 34 KB，低於 230 KiB 狀態預算 |
| `tests/update-radar-plugin.test.mts` | 91/91 通過，新增 5 項：總表分組、識別碼穩定、日期標題優先、無關表格回傳空結果、部分列跨表移動、64 列上限與儲存重載後保留 34 列、通知優先序與跨表移動不重複通知 |
| `update-radar/tests/*.test.mjs` | 36/36 通過，新增 2 項 CLI 測試：總表分組、跨表移動 |
| CLI `collectFeed`（真實網路，只抓這個來源） | `status: ok`、32 筆，第一筆 `effectiveAt` 2027-02-10，替代方案正確 |
| 全部單元測試 | 1934/1938 通過；`pet-window-mode-service` 與 `quota-parsing` 各 1 項失敗，兩檔皆未引用 update-radar，單獨執行也一樣失敗，屬既有或本機環境問題 |
| `pnpm test:unit` | 在 worktree 中 pnpm 會先嘗試安裝並因 `node_modules` 是連結而失敗；改以相同參數直接執行 `node --test` |

## 安全檢查與殘餘風險

- 沒有新增網路主機、權限、IPC 或持久化結構；解析對象仍是允許清單內的官方 Markdown。
- 輸出有上限：每個來源最多 32 筆、每筆最多 64 列停用資料、標題 180 字、每格 120 字，摘要為空字串。
- 從 0.4.0 升級後第一次成功抓取時，這個來源的識別碼都是新的；超過 3 則新內容時 `notifyNewUpdates` 只會發一則合併通知，且因為改用 `normal` 優先序，這則通知現在才真的會送達通知中心。0.4.1 尚未上架，排序修正造成的識別碼變動只影響開發者模式的測試安裝。
- 停用與移除通知不再以較高優先序區分；App 目前沒有高於 `normal` 的等級。
- 一次公告超過 64 列時只保留前 64 列。
- 外掛和 CLI 各有一份相同的解析程式，日後修改需要兩邊一起改（程式註解已註明）。
- 本機尚未在 Electron 面板目視驗證；外部審查已在 Windows Agent Pets 1.14.4 以開發者模式驗證過修補後的行為（26／34 列展開、通知送達、跨表移動不重複通知、停用再啟用保留資料）。macOS／Linux 未測。

## 建議版本

外掛 patch 升級：`update-radar` `0.4.0` → `0.4.1`（使用者已確認）。
