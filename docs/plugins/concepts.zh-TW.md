# 核心概念

五個概念說明插件如何運作，每一節都連到完整參考。

## Worker 沙箱

插件的 `entry` 檔案在受限的 Web Worker 中執行，所有 Worker 共用一個隱藏的 Plugin Host 視窗，該視窗只在至少有一個插件啟用時存在。模組必須 `export default { activate(api) { … } }`；`activate` 會收到凍結的 `api` 物件，可以是 async。Node.js、`process`、Electron、檔案系統、`fetch`、`WebSocket`、`indexedDB` 與巢狀 Worker 都不可用，插件也只能匯入自己套件內的檔案。Host 每 10 秒對每個 Worker 發出 ping，30 秒沒有回應就重啟；連續崩潰三次會停用該插件。詳見[沙箱](sandbox.zh-TW.md)與[限制](limits.zh-TW.md)。

## Host RPC

插件在 Worker 之外能做的每件事，都是透過 `api.*` 對 Host 發出的請求。每次呼叫都先在主行程依 manifest 與使用者狀態（插件是否啟用、全域開關、勿擾、速率限制）檢查，通過才會執行。成功的呼叫會 resolve 成單純的值；失敗則 reject 一個 `Error`，其 `code` 是穩定的字串，例如 `not_permitted`、`rate_limited`、`host_not_allowed`。回呼型方法（`schedule.every`、`settings.onChange`、`commands.onInvoke`、`pet.onStatusChange`、`ui.onMessage`）回傳取消訂閱函式，並在錯誤時立即擲出帶 code 的錯誤。請求是最大 256 KB 的純 JSON。參考：[API 參考](api-reference.zh-TW.md)、[TypeScript 宣告](agent-pets-plugin.d.ts)。

## Manifest

`plugin.json` 是插件的契約：身分（`id`、雙語 `name`、`version`、`author`）、`apiVersion`（只支援 `"1"`）、`entry` 檔案、需要的 `permissions`，以及提供的 `contributes`。未知欄位會讓安裝失敗，且以執行期驗證器為準，優先於 [JSON Schema](plugin.schema.json)。沒有 `entry` 的 manifest 只能提供外觀。參考：[Manifest 欄位](manifest.zh-TW.md)。

## 貢獻點

貢獻點就是使用者看得到的東西，只宣告你實際用到的。

| 貢獻點 | 呈現方式 |
|---|---|
| `feed` | 寵物氣泡與通知收件匣 |
| `reaction` | 寵物動畫 |
| `settings` | 插件詳情頁上的表單 |
| `panelView` | 面板外框內你自己的 HTML 頁面 |
| `commands`、`tray` | 詳情頁上的按鈕與 Tray 選單項目 |
| `badge` | 寵物狀態列旁的小徽章 |
| `skins` | 可選的寵物外觀 |
| `eventSource` | 獨立且有標示的工作狀態列 |

參考：[畫面貢獻點](contribution-points.zh-TW.md)、[自訂面板頁](panel-view.zh-TW.md)、[通知行為](notifications.zh-TW.md)。

## 權限與同意

能力都是明確宣告的。`permissions` 涵蓋網路主機、連結主機、密鑰、排程、儲存與 Agent 狀態；`contributes` 涵蓋會出現在介面上的東西。安裝畫面會依風險分組列出每一項（網路與連結、資料與密鑰、顯示與互動），新安裝的插件預設停用，更新若新增權限或貢獻點必須重新同意。高風險變更（新增網路、連結或密鑰權限，或簽章金鑰變更／被移除）還需要勾選確認方塊。網路存取也能在執行期透過 `api.net.requestHost` 擴充，每個主機都會詢問使用者。參考：[權限與同意畫面](permissions.zh-TW.md)。
