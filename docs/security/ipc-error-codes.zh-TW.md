# 插件與 IPC 錯誤碼

Host API 與 IPC 結果錯誤碼分別定義於 `src/types/plugin.ts` 和 `src/types/ipc.ts`。單元測試 `plugin contribution and error registries match their public docs` 會比對兩張表、常數清單與公開插件型別宣告。

## 插件 Host API 錯誤碼

| 錯誤碼 | 說明 |
|---|---|
| `not_permitted` | 插件權限或貢獻點不允許此方法。 |
| `rate_limited` | 已達速率限制。 |
| `invalid_request` | 請求不符合方法契約。 |
| `too_large` | 超過設定的資料或回應大小上限。 |
| `timeout` | 操作逾時。 |
| `host_not_allowed` | 網路主機不在已授權清單。 |
| `disabled` | 插件或能力已停用。 |
| `queue_full` | 有界佇列已滿。 |
| `duplicate` | 已有相同通知項目。 |
| `not_found` | 找不到要求的宿主資源。 |
| `too_many_enabled` | 已達啟用插件數量上限。 |
| `host_unavailable` | 需要的宿主服務無法使用。 |
| `too_many_redirects` | 轉址次數超過上限。 |
| `secret_unavailable` | 安全密鑰儲存無法使用。 |
| `secret_not_found` | 找不到要求的密鑰。 |
| `settings_invalid` | 設定值不符合 schema。 |
| `schedule_invalid` | 排程設定無效。 |
| `agent_status_unavailable` | 插件無法讀取 Agent 狀態。 |
| `denied` | 使用者拒絕了所要求的授權。 |

## IPC 結果錯誤碼

| 錯誤碼 | 說明 |
|---|---|
| `not_permitted` | 插件權限或貢獻點不允許此方法。 |
| `rate_limited` | 已達速率限制。 |
| `invalid_request` | 請求不符合方法契約。 |
| `too_large` | 超過設定的資料或回應大小上限。 |
| `timeout` | 操作逾時。 |
| `host_not_allowed` | 網路主機不在已授權清單。 |
| `disabled` | 插件或能力已停用。 |
| `queue_full` | 有界佇列已滿。 |
| `duplicate` | 已有相同通知項目。 |
| `not_found` | 找不到要求的宿主資源。 |
| `too_many_enabled` | 已達啟用插件數量上限。 |
| `host_unavailable` | 需要的宿主服務無法使用。 |
| `too_many_redirects` | 轉址次數超過上限。 |
| `secret_unavailable` | 安全密鑰儲存無法使用。 |
| `secret_not_found` | 找不到要求的密鑰。 |
| `settings_invalid` | 設定值不符合 schema。 |
| `schedule_invalid` | 排程設定無效。 |
| `agent_status_unavailable` | 插件無法讀取 Agent 狀態。 |
| `denied` | 使用者拒絕了所要求的授權。 |
| `archive_too_large` | 插件封裝超過大小上限。 |
| `invalid_archive` | 插件封裝格式錯誤或不安全。 |
| `invalid_manifest` | 插件 manifest 無效。 |
| `incompatible` | 插件與宿主不相容。 |
| `missing_entry` | 找不到插件進入點檔案。 |
| `missing_icon` | 找不到宣告的插件圖示。 |
| `missing_panel_entry` | 找不到宣告的面板頁。 |
| `invalid_html_location` | 面板頁不在允許的套件位置。 |
| `invalid_icon` | 宣告的圖示不是有效圖片。 |
| `registry_unavailable` | 已安裝插件登錄檔無法使用。 |
| `plan_not_found` | 安裝計畫已逾期或不存在。 |
| `permission_reconsent_required` | 更新後的權限需要重新同意。 |
| `signature_invalid` | 套件簽章無效。 |
| `signature_confirmation_required` | 簽章變更需要確認。 |
| `filesystem_unsafe` | 插件檔案路徑未通過安全檢查。 |
| `install_failed` | 插件安裝未完成。 |
| `plugin_not_found` | 找不到要求的已安裝插件。 |
| `catalog_disabled` | 線上目錄已停用。 |
| `catalog_url_invalid` | 目錄網址不允許使用。 |
| `catalog_unavailable` | 無法連線到目錄。 |
| `catalog_not_found` | 找不到要求的目錄項目。 |
| `catalog_invalid` | 目錄回應不符合 schema。 |
| `download_mismatch` | 下載大小或摘要與目錄不符。 |
| `signature_mismatch` | 目錄簽署身分與已安裝身分不符。 |
| `plugin_not_in_catalog` | 目錄沒有要求的插件版本。 |
| `panel_load_failed` | 隔離面板頁載入失敗。 |
| `panel_unavailable` | 面板宿主無法使用。 |
| `plugin_service_unavailable` | 插件服務無法使用。 |
| `preferences_unsafe` | 偏好檔未通過安全檢查。 |
| `secret_consent_required` | 尚未核准存取密鑰。 |
| `plugin_action_failed` | 插件操作未能完成。 |
| `dialog_unavailable` | 無法開啟所需對話框。 |
| `report_unavailable` | 問題回報連結無法使用。 |
| `cancelled` | 使用者取消了操作。 |
| `unavailable` | 要求的資源無法使用。 |
| `write_failed` | 寫入操作未完成。 |
| `invalid_decision` | 提供的決定無效。 |
| `conflict` | 請求與目前狀態衝突。 |
| `invalid_project` | 專案識別碼無效。 |
| `invalid_pet` | 寵物識別碼無效。 |
