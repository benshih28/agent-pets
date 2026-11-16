# App 新版檢查的網路邊界

只「檢查並提示」有沒有新版，不下載、不安裝（未簽章建置無法安全自動更新）。

## 預設與開關

- 「自動檢查新版」預設關閉，與 plugin 目錄的 `onlineCatalogEnabled` 一致：沒有使用者同意不主動連網。
- 開啟後每天（UTC 日）最多自動查詢一次，每小時喚醒排程；排程與 plugin 目錄更新共用 `electron/daily-check-schedule.ts`。
- 設定頁的「立即檢查」是使用者的明確操作，不受開關限制，但每分鐘最多 3 次。

## 網路邊界

- 請求只由主程序發出，網址是 `electron/app-update.ts` 的常數：`https://api.github.com/repos/Ponpon55837/agent-pets/releases/latest`。renderer、設定檔與 IPC payload 都不能指定網址。
- 走既有的 `PluginNetworkClient`（`pluginNetworkClient`，`plugin-network` session）：主機白名單只有 `api.github.com`、HTTPS、逾時 10 秒、回應上限 256 KB、每分鐘 3 次、DNS 解析到私有位址即拒絕、redirect 逐跳重驗。
- 失敗（離線、逾時、非 2xx、非 JSON、過大）一律靜默，只在設定頁顯示「檢查失敗」。先前確認過的新版不會因一次失敗而消失；只有成功檢查且回報已是最新時才清除，使用者升級到該版後也不再顯示。
- e2e 模式（`globalThis.__agentPetsE2E` 存在）只讀 `appUpdateFixture`，不會連網。

## 回應處理

- 只取 `tag_name`、`html_url`、`draft`、`prerelease`。`draft`、`prerelease` 與帶 prerelease 後綴的 tag 不提示。
- 版本以 semver 與 `app.getVersion()` 比對（接受單一 `v` 前綴；非法字串視為沒有新版）。
- `html_url` 必須以 `https://github.com/Ponpon55837/agent-pets/releases/` 開頭且通過 URL 解析驗證，否則由驗證、正規化後的版本組出 `releases/tag/v<version>`，不使用原始 `tag_name`。

## 持久化與開啟

- `userData/app-update.json`（0600）：開關、上次檢查時間、當日去重、最新版本與網址、已提示的版本。讀入時重新驗證版本與網址，被手改成外部網址會被丟棄。
- 「查看版本」只呼叫無參數的 `app-update-open-release`；主程序以自己存的已驗證網址呼叫 `shell.openExternal`，沒有新版或網址不合格時回 `false`。
- 自動檢查發現新版時透過通知中心提示一次，同一版本不重複提示。

## IPC

`app-update-get`、`app-update-set-enabled`（只接受 boolean）、`app-update-check`、`app-update-open-release`，皆只允許設定面板視窗；見 [ipc-inventory.md](ipc-inventory.md)。
