# 安全須知

請把每個插件都視為不受信任程式。只宣告實際需要的 host、secret 和 API 權限，並以必要的最小資料量處理使用者資訊。

- 不要把密鑰放在原始碼、`plugin.json`、log、通知、錯誤訊息或範例套件。請讓使用者在插件面板儲存密鑰，再用 `api.secrets.get` 讀取。密鑰以作業系統安全儲存機制加密；一般 settings 不含密鑰值。
- 不要記錄 Authorization header、API token、使用者私密資訊。Log 會留在本機診斷面板。
- 網路只能經 `api.net.fetch`。不可用 Web API 直連；每次 redirect（最多 3 次）都重新檢查 HTTPS、授權 host 與公開 DNS 位址。`requestHost` 必須由使用者同意，且可在面板撤銷。
- 插件網路請求不會送出或儲存 Cookie。需要登入的 API 請使用 `authorization` header 與已宣告的密鑰。`settings.onChange` 不會包含密鑰值；需要時請在 callback 中呼叫 `api.secrets.get`。
- 每一跳連線前都會檢查 DNS；HTTPS-only、443 port 與 TLS 憑證驗證可降低 DNS rebinding 時間差風險，但無法完全消除，仍列為已知殘餘風險。
- 插件不能讀取其他插件的儲存、密鑰或執行狀態。使用者可停用插件、撤銷動態 host 或移除插件；移除會刪除密鑰。
- Manifest 權限更新會要求重新同意。開發者模式預設關閉；開啟期間只載入你明確選取的資料夾，檔案變更會重新驗證。不要執行來源不明的開發資料夾。

App 的沙箱不是插件程式碼可信的保證。處理插件錯誤時，提供錯誤碼即可，不要暴露路徑或憑證。
