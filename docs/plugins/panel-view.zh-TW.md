# 自訂面板頁

插件可在 Agent Pets 設定面板加入一個 HTML 頁面。頁面會在獨立沙箱 `WebContentsView` 與每插件專屬、非持久化 session 中執行，和 App renderer 隔離；不要使用 iframe。

## Manifest 與套件檔案

面板頁及其資源放在插件套件中的同一個目錄。entry 相對於套件根目錄，副檔名必須是 `.html`。

```json
{
  "contributes": {
    "panelView": {
      "entry": "ui/index.html",
      "title": { "zh-TW": "專案狀態", "en-US": "Project status" },
      "preferredSize": { "width": 520, "height": 440 }
    }
  }
}
```

`preferredSize` 可省略，仍會被驗證（寬 320–960 px、高 240–800 px），但不再改變視窗大小。控制面板所有畫面共用一個大小，由使用者拖曳邊緣決定（最小 360×420，最大到目前螢幕工作區扣掉少量間距），並存在 App userData 資料夾的 `panel-size.json`（檔案損毀時會被忽略），所以開啟你的頁面不會移動或縮放視窗。請讓頁面能自適應。面板標題列也提供重新載入、前往該插件的權限與設定，以及放大（連按兩下標題列，Esc 還原）。插件不能直接移動或縮放視窗。

面板外框由宿主繪製，包含插件圖示與名稱、「插件內容」標記及關閉按鈕，並位於插件頁範圍之外。頁面控制項應放在自己的內容區。插件頁可以在內容區任意繪圖；使用者判斷提示是否可信時，應以宿主繪製的身分標記與控制項為準。

## 檔案與樣式

頁面只能載入同一插件套件中的檔案，以及唯讀共用樣式；不能載入其他插件檔案或任意網址。

```html
<link rel="stylesheet" href="agent-pets://plugin/_shared/tokens.css">
<link rel="stylesheet" href="./panel.css">
<script type="module" src="./panel.js"></script>
```

你的第一個腳本執行前，`--ap-*` 主題 token 就已經設定在頁面的根元素上（`<html>` 建立後也會以 inline 方式寫一份），並在使用者的面板主題或淺色／深色模式變更時更新；顏色、圓角與字型請用它們（見[面板主題](panel-themes.zh-TW.md#在插件中讀取主題--ap-host-api-theme)）。共用樣式是 App 自己的 `tokens.css`。從 1.12 起，它的顏色 token（包括 `--surface-raised`、`--text-primary` 等舊名稱）在有對應 `--ap-*` 時由 `--ap-*` 推導（否則是內建值），所以也會跟著主題變化；顏色請優先用 `--ap-*`，`tokens.css` 用在間距、字級與互動 token。內容繪製前頁面檢視是透明的。請為 token 提供 fallback 以便在瀏覽器預覽，完整清單與玻璃規則見 [UX 指南](ux-guidelines.zh-TW.md)。使用者關閉面板頁或切換離開時，宿主會銷毀該頁；要保留狀態請用 `api.storage`，背景工作交給插件 Worker。

## 面板 API

面板頁透過 `window.agentPetsPlugin` 取得 API。可用方法為 `feed.notify`、`pet.status`、`storage.get/set/remove`、`settings.get`、`log.info/warn/error`、`net.fetch`、`links.openExternal`、`ui.postMessage/onMessage`、`theme.get/onDidChange`。面板頁沒有 `secrets.get` 或 `net.requestHost`。`links.openExternal` 需要宣告精確 HTTPS 網域，且必須有目前這次可信任的點擊或 Enter／Space 操作；它只把網址交給系統瀏覽器，不會給面板導覽權。直接網路 API（例如 `fetch`、`XMLHttpRequest`、`WebSocket`）會被封鎖；`net.fetch` 仍受插件宣告或使用者核准的 HTTPS 網域限制。

呼叫成功時直接回傳值。失敗時會 reject 一個帶有 `code` 的 `Error`，例如 `not_permitted`、`host_not_allowed`、`rate_limited`、`too_large` 或 `disabled`。

### 與 Worker 互傳訊息

使用 `ui` 在此面板頁與同一插件的背景 Worker 間傳送 JSON 資料。每則訊息都必須能序列化為 JSON，大小最多 256 KB；每個插件、每個方向每秒最多 20 則。

```js
const api = window.agentPetsPlugin

api.ui.onMessage(message => {
  if (message.type === 'saved') {
    document.querySelector('#status').textContent = '已儲存'
  }
})

const result = await api.ui.postMessage({ type: 'save', value: 'draft' })
if (!result.delivered) document.querySelector('#status').textContent = 'Worker 無法使用'
```

Worker 可用對應的 `api.ui.onMessage` 與 `api.ui.postMessage` 方法。面板關閉時 Worker 送出的訊息會直接丟棄、不排隊，呼叫會成功回傳 `{ delivered: false }`。Worker 無法使用時，面板傳送訊息會以 `disabled` 失敗。若資料必須在面板關閉或 App 重啟後保留，請用 `storage`。JSON 格式不合法會以 `invalid_request` 失敗；超過大小上限會以 `too_large` 失敗；超過速率上限會以 `rate_limited` 失敗。

## 瀏覽器限制

面板不能直接連網、自行開啟新視窗、導覽到其他網址、下載檔案、請求權限或接收檔案拖放。唯一外部開啟路徑是上述受限的 `links.openExternal` Host API。宿主會在 session 與面板 renderer 阻擋其他行為。面板也不能存取 App 的父 renderer：`window.parent` 與 `window.top` 都指向面板頁本身。

完整的 manifest、Worker 與面板頁範例請看 [panel-demo](examples/panel-demo/)。[TypeScript 宣告](agent-pets-plugin.d.ts)包含 Worker 與面板 API 型別。
