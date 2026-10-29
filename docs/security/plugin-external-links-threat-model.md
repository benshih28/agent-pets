# Phase 20 插件外部連結威脅模型

> 適用範圍：面板頁 `links.openExternal(url)`
> 適用版本：`1.4.0` 起

## 安全目標

- 插件面板不能取得 Electron `shell`、通用 IPC、任意導覽、彈窗或瀏覽器回應內容。
- 外部網址必須是 manifest `permissions.links.hosts` 已明確揭露並由使用者在安裝／更新時同意的精確 DNS host。
- 每次開啟都必須緊接目前這次可信任的點擊或 Enter／Space 操作；程式化事件與背景 Worker 不能開啟網址。
- Main 必須重新驗證 URL 與目前插件狀態，不信任面板傳入的 plugin id、啟用狀態或網域判斷。
- 濫用開啟行為需有固定速率上限，且插件停用或全域插件關閉後立即拒絕。

## 控制

1. manifest 只接受 1–20 個精確公開 DNS 名稱；拒絕 wildcard、IP、localhost、內部 suffix、scheme、path 與 port。
2. preload 只暴露 `links.openExternal(url)`。它在 capture phase 觀察 `isTrusted` 的 click 或 Enter／Space keydown，保存最多一秒並只消耗一次；鍵盤後續產生的 click 不會再核發第二次，插件頁也不能自行傳入 activation 旗標。
3. IPC 沿用既有 `plugin-panel-api`，只接受目前 active panel 的主 frame 與 WebContents；方法及 JSON 大小仍由 `PluginPanelViewController` allowlist 驗證。
4. Main 只接受 HTTPS、無帳密、無自訂 port、非 IP，且 hostname 必須精確落在目前 manifest allowlist。面板仍不能自行導覽，系統瀏覽器的內容不回傳插件。
5. 每插件每 60 秒最多 5 次有效開啟嘗試。無效網址與缺少可信任操作在計次前拒絕；交給系統瀏覽器後即使開啟失敗仍計次，避免反覆呼叫。
6. `shell.openExternal` 失敗回傳穩定 `host_unavailable`；其他拒絕使用既有 `denied`、`host_not_allowed`、`rate_limited`、`disabled`、`not_permitted`。

## 驗證與殘餘風險

- 單元測試涵蓋缺少使用者操作、未宣告權限、停用、HTTP、帳密 URL、自訂 port、子網域、IP、未列網域、速率與 shell 失敗。
- 面板 bridge 測試確認 activation 旗標由 transport 產生並只使用一次；插件公開 API 不接受第二個參數。
- 使用者在插件內容區的任何可信任操作，都可能被該不受信任插件用來開啟已事先同意的網域。一次性與一秒有效期可縮小範圍，但不能證明使用者點擊的是哪一個插件 DOM 元素；因此安裝同意文字、精確 host 與速率限制仍是必要控制。
- 系統瀏覽器後續 redirect、登入狀態與網站內容不由 Agent Pets 控制；宿主只保證交出的初始 URL 通過上述驗證。
