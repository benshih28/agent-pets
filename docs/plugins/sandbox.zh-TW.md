# 沙箱與執行環境

插件背景程式在宿主建立的受限 Web Worker 執行；插件只收到凍結的 `api.*` 物件與自己的 Host API 回覆。Worker 無 Node.js、shell、process、Electron、環境變數、其他插件的 API 或資料。插件模組只能從自己的已安裝套件載入。

以下 Web API 在 Worker 中被移除／不可用：

- `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`：使用 `api.net.fetch`，並在 manifest 宣告 HTTPS host。
- `indexedDB`、`caches`、`BroadcastChannel`：使用 `api.storage` 保存自己插件的 JSON 資料。
- 巢狀 `Worker`、`SharedWorker`：背景任務用 `api.schedule.every`。
- Worker 的原生跨執行緒 `postMessage`：只使用宿主提供的 `api.*`；插件間沒有訊息通道。

外部網路由 Host 透過 Electron `net.request` 代理。Host 只接受 HTTPS、無 URL 帳密、空或標準 443 port；解析每個網域並拒絕任何非公開 IPv4／IPv6 位址。每次 redirect（最多 3 次）都建立新請求並重做 URL、授權清單與 DNS 檢查。插件請求不會送出或儲存 Cookie；需要登入時請使用 `authorization` header 與已宣告密鑰。每個插件 Worker 每 10 秒收到 heartbeat，30 秒沒有 pong 就會終止並復原；連續 3 次崩潰後停用插件並在通知中心告知。其他 API 的資料、大小與速率限制見[限制表](limits.zh-TW.md)。
