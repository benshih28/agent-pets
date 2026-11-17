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
- CLI 沒有 `retirements` 欄位，所以由分組直接提供 `effectiveAt`（最早的停用日）和 `replacement`（整組只有一種替代方案時才填）；內文已能解析出這兩個值時仍以內文為準。

## 驗證

| Gate | 結果 |
|---|---|
| 真實頁面解析 | 32 筆（達 `maxItems` 上限），`changeType` 均為 `deprecated`，`effectiveAt`、替代模型和倒數列都正確；序列化約 30 KB |
| `tests/update-radar-plugin.test.mts` | 88/88 通過，新增 2 項：總表分組、識別碼穩定、日期標題優先、無關表格回傳空結果 |
| `update-radar/tests/*.test.mjs` | 35/35 通過，新增 1 項 CLI 總表分組測試 |
| CLI `collectFeed`（真實網路，只抓這個來源） | `status: ok`、32 筆，第一筆 `effectiveAt` 2027-02-10，替代方案正確 |
| 全部單元測試 | 1931/1935 通過；`pet-window-mode-service` 與 `quota-parsing` 各 1 項失敗，兩檔皆未引用 update-radar，單獨執行也一樣失敗，屬既有或本機環境問題 |
| `pnpm test:unit` | 在 worktree 中 pnpm 會先嘗試安裝並因 `node_modules` 是連結而失敗；改以相同參數直接執行 `node --test` |

## 安全檢查與殘餘風險

- 沒有新增網路主機、權限、IPC 或持久化結構；解析對象仍是允許清單內的官方 Markdown。
- 輸出有上限：每個來源最多 32 筆、每筆最多 12 列停用資料、標題 180 字、每格 120 字，摘要為空字串。
- 修正後第一次成功抓取時，舊格式的識別碼都會換新；超過 3 則新內容時 `notifyNewUpdates` 只會發一則合併通知。
- 一次公告超過 12 列時，面板只顯示前 12 列（沿用 `MAX_RETIREMENTS`）。
- 外掛和 CLI 各有一份相同的解析程式，日後修改需要兩邊一起改（程式註解已註明）。
- 尚未在實際 Electron 面板中目視驗證卡片。

## 建議版本

外掛 patch 升級：`update-radar` `0.4.0` → `0.4.1`（使用者已確認）。
