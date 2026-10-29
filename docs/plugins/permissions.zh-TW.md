# 權限與使用者同意

只宣告功能需要的權限。安裝確認框會列出已要求的權限；插件預設停用，使用者還要自行啟用插件與全域開關。以下文字是確認框顯示的原文（網域、密鑰名稱依 manifest 代入）：

| Manifest 權限／貢獻 | 確認框文字 |
|---|---|
| `network.hosts: ["api.example.com"]` | `連線至 api.example.com` |
| `links.hosts: ["docs.example.com"]` | `在瀏覽器開啟 docs.example.com` |
| `secrets: ["githubToken"]` | `讀取密鑰設定「githubToken」` |
| `schedule` | `依排程執行` |
| `storage: true` | `在本機儲存插件資料` |
| `agentStatus: true` | `得知 Agent 忙碌、閒置或等待的狀態` |
| `contributes.feed: true` | `在寵物狀態泡泡顯示通知` |
| `contributes.reaction: true` | `要求寵物做出反應` |
| `contributes.commands` | `在插件面板提供指令按鈕` |
| `contributes.tray` | `在 Tray 選單新增項目` |
| `contributes.badge: true` | `在寵物狀態列顯示徽章` |
| `contributes.skins` | `提供 N 個寵物外觀`（依 manifest 數量代入） |
| `contributes.eventSource` | `在獨立狀態列顯示插件回報的工作狀態` |

`network.hosts` 是預先同意清單。若也設 `userGranted: true`，插件可呼叫 `api.net.requestHost(host, reason)`；host 是不含萬用字元的 DNS 名稱，reason 為 1–120 字。每次申請都會先檢查公開 DNS，再顯示原生確認框。使用者拒絕同一網域後 24 小時內不會再提示；每插件最多每 10 分鐘申請 3 次。通過的動態網域會出現在設定面板，可撤銷。即使已同意，HTTP、IP literal、localhost、私有／保留 IP 或 DNS 解析到非公開位址的請求仍會被拒絕。

`links.hosts` 是供面板頁呼叫 `links.openExternal()` 的獨立精確網域白名單，不會賦予網路存取能力。只有目前這次可信任的點擊或 Enter／Space 鍵盤操作才能開啟；網址必須是 HTTPS、不得含帳密或自訂 port，每插件每分鐘最多嘗試 5 次，且不接受萬用字元。

更新若新增任何權限或貢獻項目會要求重新同意。拒絕時保留已安裝版本。`contributes.settings` 讓插件讀取使用者在面板填入的非密鑰設定；`format: "secret"` 欄位只能用 `api.secrets.get` 讀取，從不回傳給一般 settings API。
