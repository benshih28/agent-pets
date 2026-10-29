# Phase 15 Plugin Panel View 威脅模型

> 適用範圍：Phase 15「自訂面板頁（panelView）」
> 基準版本：`1.2.4`（只記錄，不變更）
> 安全原則：插件頁一律視為不受信任內容；宿主只在使用者開啟設定面板中的插件頁時建立隔離的 `WebContentsView`，並以宿主端控制的權杖、資源白名單、窄化 preload 與固定外框限制其能力。

## 1. 安全目標

- 插件頁不能取得 Node、Electron IPC、父面板 renderer、其他插件資料或宿主權限。
- 插件頁只能讀取同一插件安裝版本中的一般檔案，以及宿主提供的唯讀 `_shared/tokens.css`；不能藉 URL、路徑或 symlink 讀取其他位置。
- 插件頁不能直接或間接連網、讓自身導覽到外部來源、任意開新視窗、下載檔案或取得瀏覽器權限。唯一外部開啟能力是經 manifest 精確網域、可信任使用者操作與速率限制約束的 `links.openExternal`，且只交給系統瀏覽器。
- 使用者可在所有頁面尺寸與外觀模式下辨認目前內容屬於插件；插件頁不能覆蓋宿主繪製的外框、關閉控制或原生確認介面。
- 面板頁不取得 `secrets.get`、`net.requestHost` 或任意 IPC；Host API 成功直接回傳值，失敗以帶 `code` 的 `Error` 拒絕。
- Worker 與面板頁只能透過 Main 轉送同一插件的有限 JSON 訊息；面板關閉時不緩存或補送訊息。
- 關閉面板頁、離開插件分頁、插件停用／更新／移除或宿主視窗關閉時，權杖與面板 WebContents 必須撤銷或銷毀。

## 2. 信任邊界

| 元件 | 信任等級 | 允許 | 禁止 |
|---|---|---|---|
| 插件包與面板 HTML／JS／CSS | 完全不受信任 | 在自己的隔離 WebContents 中呈現內容 | 決定插件身分、選擇根路徑、呼叫原生 API、載入任意來源 |
| panelView `WebContentsView` | 不受信任的獨立 renderer | 載入主程序指定的插件頁面，使用核准的 API 子集 | Node、`require`、`ipcRenderer`、父 renderer 存取、`secrets.get`、`net.requestHost` |
| plugin-ui preload | 最小能力橋接 | 暴露經 Main 驗證的固定 Host API 子集與同插件 UI 訊息 | 暴露通用 IPC、權杖、檔案路徑或未列入白名單的方法 |
| 設定面板 renderer／外框 | 受信任 UI，但其訊息仍須在 Main 驗證 | 選取插件、繪製插件名稱／圖示／「插件內容」標記與宿主控制 | 把插件頁資料視為可信、允許子視圖覆蓋宿主控制或原生確認 UI |
| Main 與 plugin-ui session | 安全決策中心 | 建立／銷毀 view、選擇插件根目錄、驗證來源與訊息、套用資源政策 | 信任 renderer 傳入的 pluginId、token、路徑、尺寸或訊息內容 |
| Plugin Worker | 不受信任的背景程式 | 透過既有 Host API 執行已核准功能 | 直接讀取面板頁或其他插件；把訊息路由到任意插件 |

## 3. 安全不變條件

1. 只有 Main 可建立插件身分與隨機權杖的綁定；每個開啟中的面板 view 使用不可由插件猜測或指定的短期權杖，銷毀時立即撤銷。
2. 面板 URL 僅由 Main 根據已安裝 manifest 的 `panelView.entry` 組成，採用 Phase 13 的 `agent-pets://plugin/<隨機權杖>/<相對路徑>` 形式。不可從 Renderer 或插件訊息接受任意 URL、根目錄或 pluginId。
3. 權杖只映射到該插件目前安裝版本的根目錄；路徑必須經相對路徑、realpath、一般檔案、大小上限與 symlink 檢查。`_shared` 只允許讀取單一唯讀 `tokens.css`，不開放其他共享資源。
4. 每插件使用不含 `persist:` 的 `plugin-ui-<id>` session partition，與主面板、Plugin Host 及其他插件隔離。Session 的 webRequest 白名單只允許目前權杖路徑及 `_shared/tokens.css`，其他 scheme、origin、redirect 與請求一律拒絕。
5. `WebContentsView` 必須設定 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`，並使用專用 preload。CSP 預設拒絕所有資源；只按需求允許插件頁的 script／style／image，`connect-src 'none'`、`frame-src 'none'`，且不允許外部載入。
6. session 權限請求一律拒絕；`window.open`、導覽／轉址、巢狀 webview 與下載一律拒絕。拖放事件不得把檔案交給插件頁，並阻止拖放造成導覽。
7. preload 只暴露 `feed.notify`、`pet.status`、`storage.*`、`settings.get`、`log.*`、`net.fetch`（若 Host API 權限允許）、`links.openExternal` 及 `ui.postMessage/onMessage`。外部連結呼叫只能由 preload 附上一次性可信任使用者啟用，再由 Main 驗證 `permissions.links.hosts` 與速率。不得暴露 `secrets.get`、`net.requestHost`、任意 IPC、面板父視窗控制、權杖或 Electron `shell`。
8. 子 view 的 bounds 由 Main 依宿主面板 DOM 提供的候選矩形計算並夾限在插件內容區；插件宣告的 `preferredSize` 只能影響宿主允許的面板偏好，不能直接變更視窗或子 view 座標。固定外框、插件來源標記、關閉按鈕與宿主確認 UI 必須在子 view bounds 之外或以宿主／原生層顯示，不能被插件繪製覆蓋。
9. 訊息只在 Main 已綁定的同一插件 Worker ↔ panel view 通道轉送；每則須可 JSON 序列化且不超過 256 KB，每秒每方向最多 20 則。Main 以通道綁定身分，不採信訊息自稱的 pluginId。無面板接收者時直接丟棄，不排隊。
10. 關閉或失去可見性時銷毀 WebContentsView 並撤銷 token；重新開啟必須重新由 Main 授權。插件不可在背景保留 panel view。

## 4. 主要攻擊與控制

| 攻擊 | 控制與驗證證據 |
|---|---|
| 逃出 renderer 沙箱、Node 或 Electron API | 獨立 `WebContentsView`、Chromium sandbox、context isolation、Node integration 關閉、webview 關閉、專用最小 preload；evil fixture 檢查不可存取 Node／父視窗或未授權 Host API。 |
| 以 `fetch`、XHR、WebSocket、圖片、CSS、表單或重新導向連外 | CSP 的 `connect-src 'none'`／資源來源限制、session webRequest 僅放行本插件權杖路徑及唯讀 tokens.css；對多種資源載入與外部 redirect 做 Electron 實測。 |
| 以 `window.open` 開出高權限或外部視窗 | `setWindowOpenHandler` 一律 deny，並在 evil fixture 實測開窗失敗且沒有新 WebContents。 |
| 以 `location`、連結、表單或重新導向離開插件 origin | Main 端 `will-navigate`、`will-redirect` 拒絕，webRequest 再做來源限制；實測頁面仍留在原插件資源。 |
| 透過 `window.parent`、`top`、`opener` 讀取或操作宿主 | 獨立 WebContents 沒有父頁 DOM；沒有 opener；preload 不回傳 parent handle；evil fixture 驗證跨上下文讀取失敗。 |
| 偽裝 Agent Pets 設定、Permission 或 Keychain 確認框 | 宿主外框由受信任 renderer／原生視窗繪製，插件內容區固定標示「插件內容」並顯示插件名稱；WebContentsView bounds 不覆蓋標籤、關閉按鈕與宿主確認 UI。以 evil fixture 畫仿冒確認框並確認宿主標記仍可見。 |
| 點擊劫持宿主控制 | 宿主控制區不落在 WebContentsView bounds 內；子 view 的位置與尺寸只由 Main 夾限，插件不能透過訊息改座標；調整尺寸後驗證 hit target 仍屬宿主。 |
| 拖放本機檔案或以拖放導覽 | 在子 view 的 session／preload 與宿主內容區拒絕 drag/drop，並拒絕拖入造成的導覽；evil fixture 測試拖入文字、URL 與檔案時沒有檔案內容或路徑可讀。 |
| 觸發下載 | session `will-download` 取消下載；驗證沒有下載項目、檔案或下載事件交付給插件。 |
| 請求相機、麥克風、通知或其他權限 | `setPermissionRequestHandler` 與 `setPermissionCheckHandler` 一律拒絕；測試 `getUserMedia` 等 API 失敗且沒有系統權限提示。 |
| 讀取其他插件、宿主檔案或 symlink 目標 | token 只映射單一插件安裝根目錄，protocol handler 執行相對路徑與 realpath／一般檔案／symlink 檢查；其他 token、`..`、編碼路徑與越界檔案均回 404。 |
| 用偽造 pluginId 或訊息濫用跨插件通道 | Main 綁定 view、Worker、插件 ID；JSON、大小與速率在 Main 驗證；超限拒絕且不影響其他插件；關閉面板時不緩存訊息。 |
| 以大型 DOM、無限迴圈或大量訊息耗盡資源 | 訊息每則 256 KB、每秒 20 則；頁面 view 可被銷毀，renderer crash／掛起須由宿主記錄並終止。Chromium WebContentsView 沒有可由本功能保證的單頁硬記憶體配額；即使有監控，短時間 CPU／記憶體耗盡仍是殘餘風險。 |

## 5. 假設、限制與安全驗證

- 插件安裝時已由 PluginRegistry 驗證 manifest、包內 HTML 位置與一般檔案；本功能仍須在載入時重新套用 token、路徑與 session 白名單，不把安裝驗證當成 renderer 權限。
- 所有外部網路存取只可由 Main 的 `net.fetch` 白名單代理提供，且面板 preload 不含 `net.requestHost`；頁面本身不取得網路權限。`links.openExternal` 只請系統瀏覽器開啟已宣告 HTTPS 網址，不把回應或瀏覽器能力交回插件。
- 面板頁可能嘗試繪製仿冒介面；宿主無法阻止插件在其內容區顯示任意圖像與文字，因此安全訊號必須是內容區外、始終可見的宿主外框與「插件內容」標記。
- WebContentsView 的程序隔離不等於每插件硬體資源隔離。若沒有可靠的單 view 配額，不能宣稱 memory／CPU DoS 已被完全阻止；關閉 view 只能限制持續影響。
- 以隔離 Electron、全新 userData 與測試插件驗證網路、導覽、視窗、父頁、權限、下載、拖放、訊息與仿冒 UI 攻擊。任何實機測試若會執行 secrets 路徑，須在 Main 啟動 secrets 前確認已替換為假的可逆 `safeStorage`；本 Phase 測試不觸碰真實 macOS Keychain。
- Electron 測試完成前，不得將安全驗收標記為通過；跨平台差異、正式打包簽章與單頁硬資源配額皆須明確記錄未驗證或殘餘風險。
