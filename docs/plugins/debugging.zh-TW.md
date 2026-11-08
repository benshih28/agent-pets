# 測試與除錯

## 上線前先測試

- **驗證 manifest**：用正式的解析器，與儲存庫測試完全相同——`electron/plugin-manifest.ts` 的 `parsePluginManifest(JSON.parse(text))` 會回傳 `{ ok: true }` 或錯誤代碼（`invalid_id`、`invalid_permissions`、`invalid_host`、`invalid_settings`、`invalid_contributions` 等）。編輯器也可對照 [`plugin.schema.json`](plugin.schema.json)，但以解析器為準。
- **安裝要發布的套件**，而不只是資料夾：資料夾與套件使用相同驗證，但只有套件能證明檔案清單、大小限制與簽章。
- **使用 fixture**：`tests/fixtures/plugins/` 內有正常（`ok-*`）與惡意（`evil-*`）插件，可作為依據。`node scripts/pack-test-plugin.mjs <fixture-id> <output.agentpet-plugin>` 能把其中一個打包，讓你安裝後比較行為。儲存庫的測試（`pnpm test:unit`）也會驗證 `docs/plugins/examples` 下的每個範例。
- 測試不順利的情況：插件被停用、勿擾開啟、寵物被隱藏、達到速率限制、網路主機未授權、呼叫 `api.ui.postMessage` 時面板已關閉。

## 開發者模式

1. 開啟**插件 → 進階 → 開發者模式**，再用「從資料夾載入…」。該插件列會標示「開發資料夾 · 簽章未驗證」。
2. 檔案修改會 debounce 500 毫秒後重新驗證並重載。manifest 無效或新增權限時不會替換已安裝版本，新增權限必須重新同意。App 重新啟動或資料夾被刪除後就不再監看，需要重新載入。
3. 不開發時請關閉開發者模式，因為它允許載入未簽章的資料夾。

## 診斷

開啟插件詳情頁 → **診斷**。

- **最近紀錄**是插件用 `api.log.info/warn/error` 寫的內容（最多 200 筆，每筆最多 1000 字元）。可依層級篩選，並用**複製**整批貼進問題回報。
- **被拒絕的呼叫**列出 Host 拒絕的呼叫的錯誤代碼與方法，並附白話原因（沒有權限、請求太多、插件已停用）。
- 到**通知**分頁確認：是勿擾、靜音、寵物被隱藏或速率限制，把通知送進收件匣而不是氣泡。

診斷不會顯示你的原始碼資料夾路徑或密鑰。也請你自己絕對不要記錄密鑰或使用者的私人資料。

## 紀錄檔與匯出診斷

插件的紀錄行也會經過遮蔽後寫入 App 的 `logs/main.log`（位於 userData 資料夾，超過 1 MB 輪替，保留三個檔案），頻道為 `plugin:<plugin-id>`。Host 崩潰則記在頻道 `plugin-host`，附崩潰原因與連續次數。**設定 → 整合與進階 → 匯出診斷資訊**會存出包含 `pluginHost` 區段（需要的與執行中的插件、近期崩潰）與近期紀錄的報告，回報問題時請一併附上。權杖、提示詞與個人路徑都已移除，也不會上傳。

## 常見錯誤

- `host_not_allowed`：主機未宣告或未授權、不是 HTTPS、是 IP 或 localhost，或解析到非公開位址。請修正 manifest 的主機，或透過 `requestHost` 詢問。
- `rate_limited`：達到每分鐘網路額度、每 10 分鐘通知額度、每秒徽章或指令限制。請減少輪詢，或請使用者在插件設定中調整限制。
- `not_permitted`：manifest 缺少該 API 需要的權限或貢獻點、缺少 `network.userGranted`，或在停用狀態下呼叫。
- `schedule_invalid`：間隔不是範圍內的正數，或插件已持有 16 個有效排程。請取消不再需要的排程。
- `host_unavailable`：插件 Worker 尚未就緒（例如剛崩潰或重啟後）。
- `invalid_request`：檢查參數型別、欄位名稱、文字長度與 manifest。
- 崩潰後插件被停用：Host 每 10 秒 ping 每個 Worker，30 秒沒有 pong 就終止它。連續三次失敗會停用插件並發出通知。Host 視窗啟動最多重試三次，間隔 250 毫秒、1 秒、5 秒。

失敗的 API 呼叫會 reject 一個帶 `code` 的 `Error`；成功則直接回傳值。詳見 [API 參考](api-reference.zh-TW.md)與[常見問題](faq.zh-TW.md)。
