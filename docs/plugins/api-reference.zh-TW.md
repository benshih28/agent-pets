# Host API 參考（apiVersion 1）

每個成功呼叫直接回傳下表的值；失敗會 reject 一個 `Error`，其 `code` 為下列錯誤字串。不要依賴錯誤訊息以外的內部資料。完整 TypeScript 宣告見 [`agent-pets-plugin.d.ts`](agent-pets-plugin.d.ts)，完整錯誤碼表見[這裡](../security/ipc-error-codes.zh-TW.md)。

| 方法 | 權限／回傳 | 失敗與可複製範例 |
|---|---|---|
| `feed.notify(item)` | `contributes.feed`；`{itemId, delivery}` | `invalid_request`, `host_not_allowed`, `rate_limited`, `queue_full`, `duplicate`, `disabled`, `not_permitted`。`await api.feed.notify({title:'Done',body:'Build passed.'})` |
| `pet.react(reaction, options?)` | `contributes.reaction`；`{accepted:true}` | `invalid_request`, `rate_limited`, `queue_full`, `not_found`, `disabled`, `not_permitted`。`await api.pet.react('happy')` |
| `pet.status()` | `permissions.agentStatus`；`PetStatusChange[]` | `not_permitted`, `agent_status_unavailable`, `disabled`。`const pets = await api.pet.status()` |
| `pet.onStatusChange(fn)` | `permissions.agentStatus`；解除訂閱函式 | 同步拋 `not_permitted` 或 `invalid_request`。`const off = api.pet.onStatusChange(s => api.log.info(s.visibleState))` |
| `net.fetch(url, options?)` | `permissions.network`；`{status,headers,body,isBase64Encoded?}` | `invalid_request`, `host_not_allowed`, `too_many_redirects`, `timeout`, `too_large`, `rate_limited`, `disabled`, `not_permitted`。`const r = await api.net.fetch('https://api.example.com/status')` |
| `net.requestHost(host, reason)` | `network.userGranted`；`{granted:true,host}` | `invalid_request`, `rate_limited`, `denied`, `host_not_allowed`, `disabled`, `not_permitted`。`await api.net.requestHost('api.example.com','Read release notes')` |
| `links.openExternal(url)`（僅面板頁） | `permissions.links`；`{opened:true}` | `invalid_request`, `host_not_allowed`, `denied`, `rate_limited`, `host_unavailable`, `disabled`, `not_permitted`。需直接在點擊或 Enter／Space handler 呼叫：`await api.links.openExternal('https://docs.example.com/release')` |
| `secrets.get(key)` | manifest `permissions.secrets`；`string` | `not_permitted`, `secret_unavailable`, `secret_not_found`, `disabled`。`const token = await api.secrets.get('githubToken')` |
| `settings.get()` | `contributes.settings`；非密鑰設定物件 | `not_permitted`, `settings_invalid`, `disabled`。`const options = await api.settings.get()` |
| `settings.onChange(fn)` | 回傳解除訂閱函式 | 立即同步拋 `invalid_request`。一般設定變更，以及密鑰新增、更新或清除都會觸發 callback；傳入值只含非密鑰設定。請在 callback 中呼叫 `api.secrets.get(key)` 讀取已授權密鑰。`api.settings.onChange(v => api.log.info(v.repository))` |
| `schedule.every(seconds, fn)` | manifest `permissions.schedule`；取消函式 | 同步拋 `not_permitted`、`schedule_invalid`。`const cancel = api.schedule.every(300, refresh)` |
| `storage.get(key)` | `permissions.storage`；`{found,value}` | `invalid_request`, `too_large`, `disabled`, `not_permitted`。`const saved = await api.storage.get('etag')` |
| `storage.set(key,value)` | `permissions.storage`；`{stored:true}` | 同上。`await api.storage.set('etag','abc')` |
| `storage.remove(key)` | `permissions.storage`；`{removed:boolean}` | `invalid_request`, `disabled`, `not_permitted`。`await api.storage.remove('etag')` |
| `log.info/warn/error(...values)` | 插件面板診斷記錄；`{logged:true}` | `invalid_request`, `too_large`, `disabled`。`await api.log.warn('Retrying', code)` |
| `commands.onInvoke(fn)` | `contributes.commands`；解除訂閱函式 | callback 不是函式時立即同步拋 `invalid_request`。插件不能自行觸發指令。`const off = api.commands.onInvoke(id => api.log.info('Command', id))` |
| `badge.set(badge|null)` | `contributes.badge`；`{set:boolean}` | `invalid_request`, `rate_limited`, `disabled`, `not_permitted`。`await api.badge.set({text:'OK',tone:'info'})`；`await api.badge.set(null)` 清除。 |
| `agent.emit(event)` | `contributes.eventSource`；`{accepted:true}` | `invalid_request`, `rate_limited`, `not_permitted`, `disabled`。`await api.agent.emit({sessionId:'build-1',state:'thinking'})` |
| `ui.postMessage(data)` | `contributes.panelView`；`{delivered:boolean}` | `invalid_request`, `too_large`, `rate_limited`, `disabled`。`const result = await api.ui.postMessage({type:'refresh'})` |
| `ui.onMessage(fn)` | `contributes.panelView`；解除訂閱函式 | 立即同步拋 `invalid_request`。`const off = api.ui.onMessage(message => api.log.info(message.type))` |

`net.fetch` 的 method 為 `GET`、`POST`、`PUT`、`DELETE`、`PATCH`；可送出的 header 僅 `accept`、`authorization`、`content-type`、`if-modified-since`、`if-none-match`、`x-api-key`。Request body 最多 256 KB。回應只保留 `content-type`、`etag`、`last-modified`、`retry-after`；二進位 body 以 base64 字串回傳並設 `isBase64Encoded: true`。`requestHost` 的 reason 為 1–120 字。

`PetStatusChange` 僅含 `petId`、`name`、`agentFamily`、`previousState`、`visibleState`、`dnd`、`at`。`net.fetch` 僅允許 HTTPS 公開 DNS 網域；最多 3 次 redirect，每一跳都重新驗證網域與 DNS。插件網路請求不會送出或儲存 Cookie；需要登入時，請使用 `authorization` header 與已宣告的密鑰。Host API 成功直接回傳，不包 `{ok,value}`。

`agent.emit` 僅接受 `{sessionId, state}`。狀態為 `thinking`、`tool-running`、`idle`、`done`、`error`；`done` 與 `error` 是終態，要開始新工作階段必須用新 id。接收時間由宿主指定，並在獨立清單固定標示「來自插件：<插件名稱>」。這些狀態是未驗證的插件聲明，不會成為內建 Agent 事件，也不會觸發 Permission、XP、成就、History、quota 或通知。

`ui.postMessage` 與 `ui.onMessage` 在插件 Worker 和已開啟的面板頁之間交換 JSON 資料。每則訊息最多 256 KB；每個插件、每個方向每秒最多 20 則。面板關閉時 Worker 訊息會以 `{delivered:false}` 成功回傳且不排隊。面板頁 API 子集與瀏覽器限制見[自訂面板頁](panel-view.zh-TW.md)。

指令需先在 manifest 宣告，只能由使用者在該插件的面板頁或 Tray 觸發。`commands.onInvoke` 會收到已宣告的指令 id。使用者觸發後可能得到 `invalid_request`（指令格式錯誤）、`disabled`（插件或總開關關閉）、`not_permitted`（指令未宣告）、`rate_limited`（同一指令一秒內重複觸發）或 `host_unavailable`（插件 Worker 尚未就緒）；面板會對不可用、未授權或速率限制顯示本地化狀態，其他錯誤顯示一般操作失敗。Tray 項目與寵物外觀是 manifest 貢獻，沒有額外 Host API。

插件停用、移除或崩潰時會清除徽章。格式錯誤的徽章（包括文字超過 6 個 Unicode 字元）會以 `invalid_request` 失敗且不消耗速率；有效更新每秒超過一次則以 `rate_limited` 失敗。寵物可見時，狀態列最多顯示 2 個插件徽章，其餘合併為 `+N`。
