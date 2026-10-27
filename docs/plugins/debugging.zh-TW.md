# 除錯

1. 在插件面板開啟「進階 ▸ 開發者模式」，從資料夾載入後看插件列的「開發中」標記。檔案修改會 debounce 500ms 後重載；manifest 無效或新增權限時不會替換已安裝版本，新增權限必須重新同意。
2. 在插件面板選取插件，檢查「診斷」中的 log 與拒絕原因。Log 最多 200 筆，每筆最多 1000 字；不要輸出密鑰或使用者私密資料。
3. 查看 notification center，確認通知是否因 DND、靜音、寵物隱藏或速率限制而轉入中心。

常見錯誤：

- `host_not_allowed`：host 未宣告／未獲同意、不是 HTTPS、是 IP／localhost，或 DNS 含非公開位址；修正 manifest host 或走 `requestHost` 同意流程。
- `rate_limited`：網路每分鐘或通知每 10 分鐘配額已用完；降低輪詢頻率或請使用者調整面板配額。
- `not_permitted`：manifest 沒宣告所需權限、缺少 `network.userGranted`，或 API 在 DND／停用狀態下不可用。
- 插件因崩潰停用：Host 每 10 秒 ping，30 秒未收到 pong 即終止 Worker；連續 3 次失敗後停用插件並建立通知。Host 視窗重試最多三次，間隔 250ms、1s、5s。
- `invalid_request`：檢查 API 參數型別、欄位名稱、文字長度與 manifest。API 失敗時 reject 帶 `code` 的 Error；成功直接回傳值。

診斷不顯示來源資料夾完整路徑或密鑰。刪除資料夾、重新開啟 App 後，需重新從資料夾載入以啟動監看。
