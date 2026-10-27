# Agent Pets 插件系統規劃（Plugin System v1）

> 狀態：已實作（Phase 12–17；交接：`docs/handoff/plugin-host-codex-handoff.zh-TW.md`、`docs/handoff/plugin-distribution-codex-handoff.zh-TW.md`）。Phase 12–16 發布於 `1.3.0`；Phase 17 與 Phase 18 重構發布於 `1.3.1`。
> 範圍：把寵物做成 **插件宿主（Plugin Host）**，讓第三方以「安裝插件」的方式，把資訊與行為插入寵物的各個介面（狀態泡泡、反應、狀態列、設定頁、Tray…），同時不破壞既有的 Permission／XP／History 安全邊界。
>
> **本專案只做宿主端，不開發任何插件。** 我們負責：插入點、Host API、安裝／權限／沙箱、泡泡仲裁，以及公開給第三方的對接規格。插件本身（例如下面的推文提醒）由其他人開發。

---

## 0. 一句話決策

**插件 = 不受信任的第三方程式碼。** 它只能透過一組「有宣告、有權限、有配額」的 Host API，把東西 *交給* 寵物去呈現；它永遠拿不到 Node、檔案系統、shell、Permission 回應、XP、成就或 quota 真相。

這其實是把現有的 **Presentation MCP**（`pet_say` / `pet_react`，見 `electron/presentation-controller.ts`）的設計理念推廣成一個正式的擴充平台：

```text
Hooks / Adapters   = 寵物觀察 Agent 的可信事件來源（不變）
Presentation MCP   = Agent 主動請寵物說話（不變）
Plugins（新）       = 第三方資料來源 + 第三方呈現內容，一律 presentation_untrusted
```

---

## 1. 假設情境：第三方做了一個「Tibo 推文提醒」插件

這個情境用來檢驗宿主端是否「接得住」這類插件；插件的程式碼是第三方寫的，不在本專案範圍。

1. 第三方作者依我們公開的規格寫插件，`plugin.json` 宣告：
   - `permissions.network: ["api.x.com"]`
   - `permissions.secrets: ["xBearerToken"]`（使用者自己的 API token）
   - `permissions.schedule: { minIntervalSec: 300 }`
   - `contributes.feed`（要用狀態泡泡顯示通知）
   - `contributes.settings`（讓使用者填要追蹤的帳號、token）
2. 打包成 `tibo-watch-1.0.0.agentpet-plugin`（就是一個 zip）。
3. 使用者在「插件」面板點「安裝插件…」→ 選檔 → 主程序驗證 → 跳出 **權限同意對話框**：
   「此插件要求：連線至 api.x.com、儲存 1 個密鑰、每 5 分鐘執行一次、在狀態泡泡顯示通知」。
4. 同意後安裝到 `userData/plugins/tibo-watch/1.0.0/`，預設 **停用**；使用者開啟並填好設定。
5. 插件程式碼（第三方寫的，以下僅示意它會怎麼呼叫我們的 Host API）在沙箱 Worker 裡跑：
   ```ts
   export default definePlugin({
     async activate(api) {
       api.schedule.every(300, async () => {
         const token = await api.secrets.get('xBearerToken')
         const res = await api.net.fetch(`https://api.x.com/2/users/${id}/tweets`, {
           headers: { Authorization: `Bearer ${token}` },
         })
         for (const tweet of newTweets(await res.json())) {
           api.feed.notify({
             title: 'Tibo 發了新推文',
             body: tweet.text,
             link: `https://x.com/i/status/${tweet.id}`,
             dedupeKey: tweet.id,
           })
         }
       })
     },
   })
   ```
6. 寵物在 **沒有** 更高優先級狀態（權限請求、Agent 通知）時，用泡泡顯示，並帶上 **插件來源標籤**（例如小圖示 + 「Tibo Watch」），使用者點擊才會以外部瀏覽器開啟連結。

> 宿主端從這個情境得到的需求：**網路白名單 + 密鑰保管 + 排程 + 有來源標籤的通知泡泡**。資料從哪裡抓（例如 X API 需要付費或使用者自己的 token）是插件作者的事，宿主端不處理。

---

## 2. 要開放哪些「插入點」（Contribution Points）

把寵物的「方方面面」拆成明確的插入點，每個都有自己的資料契約、權限與優先級。依風險與價值分批開放：

| 插入點 | 插件能做什麼 | 對應現有程式 | 風險 | 批次 |
|---|---|---|---|---|
| `feed`（通知泡泡） | 推送標題／內文／連結／圖示 | `DesktopPet.vue` toast 與 `presentationSay` | 中（洗版、冒充） | **v1** |
| `panelView`（自訂面板頁） | 在設定面板「插件」分頁中顯示插件自己的 HTML 頁面（見 §3.5） | `StatusPanel.vue` | 高 | **v1**（使用者決定） |
| `agentStatus`（Agent 狀態） | 讀取淨化後的寵物狀態並訂閱狀態變化事件 | `PresentationStatusSnapshot` | 中（隱私） | **v1** |
| `reaction` | 觸發既有 5 種反應動畫 | `PRESENTATION_REACTIONS` | 低 | **v1** |
| `settings`（設定頁） | 以 JSON Schema 宣告表單，由我們渲染 | `StatusPanel.vue` | 低 | **v1** |
| `badge`（狀態列小徽章） | 在 status line 旁顯示短字串／數字 | multi-pet status line | 低 | v2 |
| `tray`（Tray 選單項） | 新增「插件名 ▸ 指令」項目，點擊回呼插件 | `desktop-tray.ts` | 中 | v2 |
| `commands` | 註冊可被 Tray／面板觸發的指令 | — | 中 | v2 |
| `skins`（寵物外觀） | 提供 spritesheet + behavior manifest | 既有 pet zip 匯入 | 低（已有驗證） | v2（整併現有匯入） |
| `sounds` | 提供事件音效 | `src/utils/sound.ts` | 低 | v3 |
| `eventSource`（新 Agent 來源） | 把其他 Agent（如 Cursor、Aider）事件轉成 canonical event | `agent-adapter.ts` 的 `generic-http` | 高 | v3，**僅 observe** |

**永遠不開放**（寫進契約，與架構文件 §11.3 一致）：
- 回應 Permission、改 XP／等級／成就／quota／history
- 讀寫任意檔案、執行指令、開新視窗、直接操作視窗位置
- 在泡泡中注入 HTML／腳本（只收純文字，與 `normalizePresentationMessage` 同規則）
- 冒充 Codex／Claude／OpenCode 的狀態（插件內容一律帶來源標籤，不能進入 Agent 狀態機）

---

## 3. 整體架構

```text
┌──────────────────────── Main process ────────────────────────┐
│ PluginRegistry   安裝/解除/啟停/版本/完整性 (userData/plugins) │
│ PluginPolicy     manifest 權限 → 能力表；配額與速率限制        │
│ PluginBroker     Host API 的唯一實作（net/secrets/storage/...）│
│ FeedController   通知佇列、優先級仲裁、去重、TTL、DND          │
│        ▲  MessagePort（每個插件一條、結構化訊息、逐筆驗證）    │
└────────┼─────────────────────────────────────────────────────┘
         │
┌────────┴──── Plugin Host（隱藏、sandbox 的 BrowserWindow）────┐
│  Worker(tibo-watch)   Worker(rss)   Worker(...)                │
│  - CSP: connect-src 'none'，不能自己 fetch                     │
│  - 只能呼叫注入的 api.*（RPC 轉給 Main）                       │
│  - 逾時／當機可單獨 terminate                                  │
└────────────────────────────────────────────────────────────────┘
         │ 已仲裁、已淨化的 view model
┌────────┴──── Pet / Panel renderer（現有）─────────────────────┐
│ 泡泡、反應、徽章、設定表單（由 schema 渲染，插件不碰 DOM）     │
└────────────────────────────────────────────────────────────────┘
```

### 3.1 為什麼選「隱藏 sandbox 視窗 + 每插件一個 Worker」

| 方案 | 優點 | 缺點 | 結論 |
|---|---|---|---|
| `utilityProcess` / Node 子程序 | 簡單 | 有完整 Node 權限，等於把電腦交給插件 | ✗ |
| 每插件一個隱藏 BrowserWindow | 隔離強、可每插件獨立 session | 每個 30–60MB 記憶體 | 備案 |
| **單一 Host 視窗 + 每插件 Worker** | 記憶體省、可個別終止；CSP 禁止直連網路，所有網路經 Main 白名單 | 需要自己做 RPC | **採用** |
| QuickJS/WASM 直譯器 | 最嚴格 | 生態差、async/fetch 都要自己接 | 未來若需更嚴格再評估 |

重點：**網路白名單不能靠插件自律**。Worker 的 CSP 設 `connect-src 'none'`（由 `agent-pets://plugin/...` protocol handler 回應標頭強制），插件唯一的出口是 `api.net.fetch`，由 Main 用 Electron `net` 發出，並檢查：https only、host 在 manifest 白名單、禁止 loopback／私有 IP（防止打我們自己的 17373/17374 埠）、回應大小與逾時上限。

### 3.2 Host API v1（插件看得到的全部）

```ts
interface PluginApi {
  readonly plugin: { id: string; version: string; locale: 'zh-TW' | 'en-US' }
  feed: { notify(n: FeedItemInput): Promise<FeedResult> }       // contributes.feed
  pet: {
    react(r: PresentationReaction, opts?: { ttlMs?: number }): Promise<FeedResult>
    status(): Promise<PresentationStatusSnapshot>                 // permissions.agentStatus；唯讀、已淨化
    onStatusChange(cb: (e: PetStatusChange) => void): Disposable  // permissions.agentStatus；見下方說明
  }
  net: {
    fetch(url: string, init?: SafeRequestInit): Promise<SafeResponse>         // permissions.network
    requestHost(host: string, reason: string): Promise<'granted' | 'denied'>  // permissions.network.userGranted
  }
  secrets: { get(key: string): Promise<string | null> }          // 只能讀 manifest 宣告的 key；寫入只由設定頁
  storage: { get(k), set(k, v), delete(k) }                       // 每插件 KV，預設 1MB（§3.4）
  settings: { get(): Promise<Record<string, unknown>>; onChange(cb) }
  schedule: { every(sec: number, fn): Disposable }                // 受 minIntervalSec 與最短間隔（預設 60s，§3.4）約束
  log: { info(...), warn(...), error(...) }                       // 進插件專屬診斷面板，有長度限制
  ui: {                                                           // contributes.panelView；只在同一插件的 Worker 與面板頁之間
    postMessage(data: JsonValue): Promise<{ delivered: boolean }>
    onMessage(cb: (data: JsonValue) => void): Disposable
  }
}
```

`FeedItemInput`：`{ title ≤ 60, body ≤ 240, link?: https URL（host 必須在白名單）, icon?: 插件包內圖片, priority?: 'low' | 'normal', dedupeKey?, ttlMs? }`。插件 **不能** 宣告 `high` 優先級，也 **不能** 指定由哪隻寵物顯示（見 §3.3）。

**執行時網域申請**（給 RSS 閱讀器這類網址由使用者決定的插件）：

- 插件需在 manifest 宣告 `permissions.network.userGranted: true`，安裝同意框會寫明「此插件可能在使用時請求連線到其他網站」。
- 呼叫 `api.net.requestHost('example.com', '讀取你訂閱的 RSS')` 時，宿主跳出確認框，顯示插件名稱、網域與理由；使用者同意後才加入該插件的白名單。
- 只允許單一主機名稱：不收萬用字元、IP、`localhost`、私有網段；連線一律 https。萬用子網域（`*.x.com`）只能寫在 manifest 的靜態清單中。
- 同一網域被拒後 24 小時內不再詢問；申請本身也受速率限制（每 10 分鐘最多 3 次），避免轟炸確認框。
- 使用者可在該插件設定中檢視、撤銷已授權網域。

`PetStatusChange`：`{ petId, name, agentFamily, previousState, visibleState, dnd, at }`，內容與 `pet_status` 相同等級的淨化資料：

- `agentFamily` 為 `'codex' | 'claude-code' | 'opencode' | null`（`null` 表示這隻寵物目前沒有對應的 Agent），只到 Agent 種類為止。

- 只在 `visibleState`（例如 working → idle、→ waiting）或 DND 改變時送出，同一隻寵物至少間隔 1 秒合併一次。
- **不含** session id、專案名稱或路徑、工具名稱、指令內容、token 用量、permission 細節。
- 需在 manifest 宣告 `permissions.agentStatus: true`，安裝時的同意對話框會寫明「此插件可得知 Agent 何時忙碌／閒置／等待」。

### 3.3 泡泡仲裁（把現有泡泡升級成 Feed）

現在 `DesktopPet.vue` 是用 `v-if / v-else-if` 鏈決定顯示誰。插件進來後拆成兩層：

- **仲裁規則**：純函式 `src/utils/feed-arbiter.ts`，輸入目前所有候選（permission、Agent toast、MCP say、插件通知、activity），輸出要顯示的那一則；renderer 使用它取代 `v-if` 鏈。Agent toast 與 activity 本來就在 renderer 產生，搬到 Main 會牽動整個 store，不值得。
- **插件通知的佇列、速率、去重、TTL、看不到時進通知中心**：由 Main 的 `PluginFeedController`（`electron/plugin-feed.ts`）負責，只把已淨化、已放行的插件通知送進 renderer 當候選之一。

```text
優先級（高 → 低）
1. Permission request / notice          （不可被插件覆蓋，與 §11.3 相同）
2. Presentation MCP pet_say             （維持 Phase 12 前的既有順序）
3. Agent 完成／錯誤 toast（現有 timed toast）
4. Plugin feed（normal）
5. Agent activity 文字 / Plugin feed（low）
```

規則：
- 每插件速率 **由使用者設定**：在該插件的設定中調整「每 10 分鐘最多幾則」，預設 5 則，可調範圍 1–30；插件無法自行修改。另有全域上限（所有插件合計每 10 分鐘 60 則）防止多個插件疊加洗版。
- 佇列深度 ≤ 8；以 `dedupeKey` 去重。插件安裝後預設停用，需使用者手動開啟。
- 顯示的寵物：預設主寵物；使用者可在該插件設定中改成指定的某一隻。插件本身不能指定。**主寵物** = 目前選定的寵物；多寵物模式下為最左邊那一隻。
- 開關：插件通知只受「插件總開關 + 該插件啟用 + 該插件未靜音」控制，**與現有泡泡開關 `bubbleEnabled` 分開**（後者只管 Agent 完成提示與活動文字）。
- DND、全螢幕偵測（`windows-fullscreen-detector.ts`）、使用者對單一插件靜音，一律生效。
- 被擋下的通知進「插件通知中心」（面板中的列表），不會遺失。
- 寵物看不到時（Mini／Edge 模式、被桌面隱藏、全螢幕）：不彈泡泡，通知直接進通知中心；Edge 把手顯示未讀數字。恢復 Normal 模式後只補顯示 **最新一則**，其餘留在通知中心。
- 插件 **不能** 發送 macOS／Windows 系統通知（v1），只能透過寵物泡泡與通知中心。
- 泡泡互動（v1）：點擊本體開啟連結（有 `link` 時）、關閉按鈕，以及插件有 `panelView` 時的固定按鈕「開啟插件面板」。按鈕由宿主繪製，插件不能自訂文字或新增按鈕（自訂按鈕留到 v2 與 `commands` 一起評估）。
- 每則泡泡帶來源標籤；連結只在使用者點擊後由 Main `shell.openExternal` 開啟，且再次檢查白名單。

### 3.4 資源上限（使用者可調整）

所有上限都有預設值，使用者可在「插件 ▸ 進階」中自由調整；另設 **硬上限** 只用來保護 App 本身不被拖垮（超過時設定欄位不接受）。單一插件的速率與 storage 也可在該插件設定中個別覆寫。

| 項目 | 預設 | 可調範圍（硬上限） |
|---|---|---|
| 同時啟用的插件數 | 10 | 1–50 |
| 每個插件記憶體預算 | 64MB | 16–512MB |
| `net.fetch` 單次回應大小 | 2MB | 64KB–20MB |
| `net.fetch` 逾時 | 15 秒 | 5–60 秒 |
| `net.fetch` 每分鐘次數（每插件） | 30 | 1–300 |
| `storage`（每插件） | 1MB | 64KB–50MB |
| 通知速率（每插件，見 §3.3） | 5 則／10 分鐘 | 1–30 |
| 全域通知上限 | 60 則／10 分鐘 | 10–300 |
| `schedule` 最短間隔 | 60 秒 | 30 秒–1 小時 |

超過上限的處理：fetch 回錯誤碼、storage 寫入失敗、Worker 心跳逾時則終止；連續崩潰 3 次自動停用並在通知中心告知。

> 記憶體限制的實作修正：同一個 Plugin Host 程序內的 Web Worker 無法個別量測或限制記憶體。v1 以「Plugin Host 程序總記憶體 ≤ 啟用中插件的預算總和」做監控（`app.getAppMetrics()`），超過時重啟整個 Host、所有執行中插件各記一次崩潰，並在診斷頁顯示原因。單一插件的精確記憶體隔離需要改成「每插件一個隱藏視窗」，列為殘餘風險。

### 3.5 插件自訂面板頁（panelView）

使用者決定第一版就開放插件自己的畫面，因此它必須和 Worker 一樣嚴格隔離，而且 **只出現在設定面板，不會出現在寵物視窗上**（寵物視窗是透明、可點穿的，放第三方畫面會破壞點擊判斷，也容易被拿來偽裝）。

做法：

- 在面板視窗中以 **獨立的 `WebContentsView`** 載入 `agent-pets://plugin-ui/<id>/<entry>.html`，而不是在面板裡放 iframe。iframe 和面板共用同一個高權限 renderer，隔離不夠；`WebContentsView` 是另一個沙箱程序。
- 每個插件用自己的 session partition（`plugin-ui-<id>`），`sandbox: true`、`contextIsolation: true`、無 Node；preload 只透過 `contextBridge` 暴露與 Worker 相同的 `api.*` 子集（不含 `secrets.get`，避免頁面直接拿到密鑰）。
- 該 session 用 `webRequest` 擋掉所有外部請求，只允許載入自己插件包內的檔案；CSP `default-src 'self'; connect-src 'none'; frame-src 'none'`。網路一律走 `api.net.fetch`。
- 禁止 `window.open`、導覽到其他網址、下載、權限請求（相機／麥克風等）、拖放檔案。
- 頁面外框由我們繪製：固定顯示插件名稱與圖示、「插件內容」標記，避免偽裝成 Agent Pets 本身的設定或權限對話框。
- 提供可選的 `agent-pets://plugin-ui/_shared/tokens.css`（唯讀複製自 `src/styles/tokens.css`），讓插件作者能貼近 Liquid Glass 風格；但插件頁面內部的外觀不在我們的視覺驗收範圍，只驗收外框。
- 頁面關閉時銷毀 `WebContentsView`；不能在背景常駐（背景工作交給 Worker）。
- **與 Worker 通訊**：`api.ui.postMessage` / `onMessage`，由 Main 轉送，只限同一插件的 Worker ↔ 面板頁。每則 ≤ 256KB、只收可 JSON 序列化的資料、每秒最多 20 則；面板頁未開啟時 Worker 送出的訊息直接丟棄（不排隊），需要持久資料請用 `storage`。
- **尺寸**：manifest 可宣告偏好尺寸 `contributes.panelView.preferredSize: { width, height }`（寬 320–960、高 240–800 px，超出範圍會被夾到界限內）。面板開啟該插件頁時盡量調整到偏好尺寸，但不超過目前螢幕工作區；使用者手動調整的面板大小優先，且只對該插件頁生效，切回其他分頁時恢復原本面板大小。插件不能在執行中改變尺寸或位置。

---

## 4. 插件套件格式

```text
tibo-watch-1.0.0.agentpet-plugin   (zip)
├── plugin.json
├── dist/main.js          單一 ES module bundle（背景 Worker 進入點）
├── ui/index.html         選用：自訂面板頁（panelView），與其 .js/.css
├── assets/icon.png       ≤ 256KB，PNG/WebP，簽章檢查沿用 isSupportedRasterImage
└── locales/zh-TW.json, en-US.json
```

```jsonc
// plugin.json
{
  "id": "tibo-watch",                 // ^[a-z0-9-]{3,48}$，全域唯一
  "name": { "zh-TW": "Tibo 推文提醒", "en-US": "Tibo Watch" },
  "version": "1.0.0",
  "apiVersion": "1",                  // Host API 主版本；不相容就拒絕安裝
  "author": "someone",
  "entry": "dist/main.js",
  "icon": "assets/icon.png",
  "permissions": {
    "network": ["api.x.com"],
    "secrets": ["xBearerToken"],
    "schedule": { "minIntervalSec": 300 },
    "storage": true,
    "agentStatus": false
  },
  "contributes": {
    "feed": true,
    "panelView": {
      "entry": "ui/index.html",
      "title": { "zh-TW": "推文列表", "en-US": "Tweets" },
      "preferredSize": { "width": 480, "height": 600 }
    },
    "reaction": false,
    "settings": {
      "type": "object",
      "properties": {
        "username": { "type": "string", "title": "追蹤帳號", "maxLength": 32 },
        "xBearerToken": { "type": "string", "title": "X API Token", "format": "secret" }
      }
    }
  }
}
```

安裝驗證沿用並抽出現有寵物 zip 匯入（`electron/main.ts` 中以 fflate 解壓、`safeJoin`、大小上限、圖片簽章）的邏輯為共用的 `archive-guard`：總大小 ≤ 5MB、檔案數 ≤ 64、禁止絕對路徑／`..`／symlink、只允許副檔名白名單（`.js .json .png .webp .html .css`；SVG v1 不收）。`.html` 只能出現在 `contributes.panelView.entry` 所在目錄。

### 4.1 更新、降版與 API 相容

- **更新**：安裝同 id、較新版本的套件即為更新；權限有增加時需重新同意（見 §5），否則沿用設定與資料。
- **降版**：允許，但跳出「你正在安裝較舊的版本」確認框；舊版權限與目前不同時一併列出。
- **API 主版本升級**（`apiVersion` 1 → 2）：舊主版本至少再支援一個 App minor 版本；過渡期間面板在該插件上顯示「即將不相容」並說明原因。過渡期結束後，舊版插件自動停用並在通知中心告知，資料保留。
- **啟動效能**：插件在寵物視窗顯示之後才載入，依序啟動，不阻擋 App 啟動；Plugin Host 視窗在沒有任何啟用插件時不建立。

---

## 5. 安全模型（重點摘要，實作時另寫 threat model）

| 威脅 | 控制 |
|---|---|
| 插件偷資料外傳 | CSP `connect-src 'none'` + Main 端網域白名單 + 禁止私有 IP / loopback |
| 插件打本機 event server 偽造 Agent 狀態 | 同上；且插件拿不到 `x-agent-pets-token` |
| 泡泡冒充 Codex/Claude 或釣魚連結 | 固定來源標籤、純文字、連結白名單 + 使用者點擊才開 |
| 洗版／吵 | 使用者設定的單插件速率、全域上限、佇列、優先級、DND、單插件靜音 |
| 自訂面板頁偽裝成系統設定或權限對話框 | 獨立 `WebContentsView` + 我們繪製的固定外框與「插件內容」標記；只在設定面板出現 |
| 自訂面板頁逃出沙箱或連外 | 獨立 partition、`webRequest` 只放行插件包內檔案、CSP、禁止導覽／彈窗／下載／權限請求 |
| 透過 Agent 狀態推敲使用者在做什麼 | 只給 `visibleState` 與 DND，不給專案／session／工具內容；需宣告權限並在同意框寫明 |
| CPU/記憶體失控 | Worker 心跳逾時 terminate；連續崩潰 3 次自動停用並通知 |
| 密鑰外洩 | `safeStorage` 加密存在 `userData/plugins/<id>/secrets`；插件只讀自己宣告的 key；不進 log、不進 export |
| 升級後偷偷擴權 | 新版本 manifest 權限有增加 → 需重新同意，否則維持舊版 |
| 惡意套件散佈 | v1 僅「本機檔案安裝」+ 明確警示；Phase 17 才評估 registry 與簽章 |

---

## 6. 給第三方的對接面（宿主端要提供，但不開發插件）

別人要能做出插件，宿主端至少要對外提供這些東西；這些都屬於宿主的一部分：

- **插件規格文件**：`plugin.json` 欄位、權限清單、插入點、Host API、限制與錯誤碼（中英文）。
- **契約檔**：`plugin.json` 的 JSON Schema 與 Host API 的 TypeScript 型別定義（`.d.ts`），讓作者能自行檢查。不另做 SDK 或 CLI。
- **App 內「開發者模式」**：從資料夾載入未打包的插件、顯示插件 log 與被拒原因，讓第三方能對著宿主測試。預設關閉。
- **測試用插件**：只放在 `tests/fixtures/plugins/`，用來驗證宿主行為（正常通知、越權連網、無限迴圈、洗版、XSS 文字…），**不隨 App 發佈，也不是產品功能**。

---

## 7. 分階段路線（延續現有 Phase 1–11）

每個 Phase 都照 `phase-gates.md` 做功能驗證、安全審查、phase report，再停下等確認版本。整體屬於 **security-boundary + public-contract 變更**，完成 Phase 12 時建議 minor bump（`1.3.0`）。

### Phase 12 — Plugin Core（不跑任何第三方程式碼）
- `src/types/plugin.ts`：manifest、權限、Host API、FeedItem 契約。
- `electron/plugin-manifest.ts`：manifest 執行期驗證（純函式，可單元測試）。
- `electron/feed-controller.ts`：把現有 toast／presentationSay／activity 改由統一仲裁（先只有內建來源），行為與現在一致。
- 抽出共用 `archive-guard`，寵物 zip 匯入改用它（回歸測試）。
- 驗收：既有泡泡行為零差異；manifest 正負向測試。

### Phase 13 — Sandbox Host + 本機安裝
- 隱藏 sandbox Plugin Host 視窗、Worker 生命週期、MessagePort RPC、逐筆 payload 驗證。
- `agent-pets://plugin/<id>/...` protocol 與強制 CSP 標頭。
- `feed` / `reaction` / `storage` / `log` API。
- 面板新增「插件」分頁：插件總開關、安裝（檔案選取）、權限同意 `ConfirmDialog`、啟停、靜音、移除、診斷、通知中心。Liquid Glass 規則與繁中文案。
- 移除流程：確認框提供「保留設定與資料（storage、設定、通知中心紀錄、已授權網域）」勾選，預設不勾；保留時重裝同 id 插件可沿用。**密鑰一律刪除**，不提供保留。停用不刪任何資料。插件資料不進 History 匯出。
- 更新與降版流程（§4.1）、`apiVersion` 相容檢查與「即將不相容」提示、插件延後載入。
- 寵物看不到時的通知處理：進通知中心、Edge 把手未讀數、恢復 Normal 時補顯示最新一則。
- 驗收：惡意測試插件（嘗試 fetch、無限迴圈、超量通知、XSS 文字）全部被擋。

### Phase 14 — 網路、密鑰、設定、排程、Agent 狀態
- `net.fetch`（白名單、私有 IP 拒絕、大小/逾時）、`secrets`（safeStorage）、schema 驅動設定表單、`schedule`。
- `pet.status()` / `pet.onStatusChange()`（`agentStatus` 權限、淨化欄位、1 秒合併）。
- `net.requestHost()` 執行時網域申請、確認框、撤銷與速率限制。
- `agentFamily` 欄位。
- 每插件設定：通知速率（1–30 則／10 分鐘，預設 5）、顯示的寵物（預設主寵物）、靜音、已授權網域。
- 「插件 ▸ 進階」資源上限設定（§3.4 的預設值與硬上限）。
- 權限升級重新同意流程。
- 開發者模式（資料夾載入）、公開插件規格文件與契約檔。
- 驗收：用 `tests/fixtures/plugins/` 的測試插件，在真實 Electron 流程中端到端跑出泡泡（不只元件測試）；`onStatusChange` 收到的資料不含 session／專案／工具欄位。

### Phase 15 — 自訂面板頁（panelView）
- 面板「插件」分頁中以獨立 `WebContentsView` 顯示插件頁面（§3.5）：獨立 partition、sandbox、`webRequest` 只放行插件包內檔案、CSP、禁止導覽／彈窗／下載／權限請求。
- 我們繪製的固定外框（插件名稱、圖示、「插件內容」標記），開啟／關閉時建立與銷毀。
- 提供唯讀 `tokens.css` 給插件頁使用。
- 泡泡上的固定按鈕「開啟插件面板」：開啟設定面板並切到該插件的頁面。
- `api.ui.postMessage` / `onMessage` 訊息通道（大小、頻率、只限同插件）。
- `preferredSize` 偏好尺寸與面板大小切換、還原。
- 先補 panelView 專屬 threat model（`docs/security/`）再實作。
- 驗收：測試插件頁嘗試連外、`window.open`、導覽、讀取父視窗、偽裝權限對話框，全部失敗；面板視窗縮放、深淺色、高對比下外框正確。

### Phase 16 — 更多插入點（納入本次範圍）
- `badge`、`tray`、`commands`、`skins`。`skins` 與既有寵物匯入共用驗證邏輯，既有匯入功能保留；只有 `skins` 的插件可以沒有 `entry`。

### Phase 12–17 實作差異

- 本機安裝、更新、降版、開發者資料夾載入、線上目錄、作者簽章、手動更新檢查與問題回報連結已實作。
- `eventSource` 已以獨立 IPC、記憶體 store 和狀態清單實作 observe-only 顯示；它不進入 Generic HTTP、內建 Agent event pipeline 或 Permission／XP／成就／History／quota／通知路徑。
- 插件 Worker 記憶體以啟用插件總預算監控，沒有精確的單一 Worker 記憶體隔離。
- 插件外觀與既有寵物選擇共用外觀顯示與驗證，但舊有 zip／單張圖匯入功能保留。
- 公開範例只供開發者參考，不會隨 App 打包；本次沒有開發或隨附第三方插件。

### Phase 17 — 散佈、簽章、更新與 eventSource（已實作）
- 插件目錄由使用者維護的 GitHub repo JSON 提供，預設關閉；載入與下載均走 Main 的 host allowlist、redirect 與內容大小防護。
- 插件套件使用 Node `node:crypto` 驗證 Ed25519 簽章，首次安裝採 TOFU；金鑰變更及簽章狀態轉換需明確確認。更新只檢查並提示，由使用者逐項安裝；不做背景自動安裝。
- 插件詳情提供固定 GitHub issue 回報連結，不收集評分或附帶使用者資料。
- `eventSource` 僅在獨立插件狀態清單呈現受限狀態，固定標示插件來源，具有限流、容量和 TTL；停用、移除、崩潰、重新載入時清除。其狀態不代表宿主驗證過外部 Agent 的真實狀態。
- 發布者簽章與目錄發布方式見 `docs/plugins/signing.zh-TW.md`、`docs/plugins/publishing.zh-TW.md`；實作細節與驗收結果見 `docs/phase-reports/phase-17-plugin-distribution.md`。

---

## 8. 已確認的決策（2026-10-23）

| 問題 | 決定 | 對規劃的影響 |
|---|---|---|
| 散佈方式 | 第一版只做本機檔案安裝 | 線上目錄與簽章移到 Phase 17，之後再評估 |
| 插件自訂畫面 | **第一版就開放** | `panelView` 提前到 v1，新增 §3.5 與 Phase 15；只在設定面板、以獨立 `WebContentsView` 隔離 |
| 通知量 | 由使用者自己設定 | 每插件 1–30 則／10 分鐘，預設 5；另有全域上限；安裝後預設停用 |
| 多寵物 | 預設主寵物，使用者可改 | 插件不能指定寵物；在每插件設定中選擇 |
| Agent 狀態 | 淨化後狀態 **加上事件通知** | 新增 `pet.onStatusChange()` 與 `agentStatus` 權限；仍不給 session／專案／工具內容 |
| 泡泡開關 | 與現有 `bubbleEnabled` 分開控制 | 插件通知只看插件總開關＋該插件啟用／未靜音 |
| 寵物看不到時 | 進通知中心＋未讀數 | Edge 把手顯示未讀數；恢復 Normal 只補顯示最新一則 |
| 系統通知 | v1 不開放 | 插件只能用寵物泡泡與通知中心 |
| 泡泡互動 | 開連結＋關閉＋「開啟插件面板」 | 按鈕由宿主繪製，插件不能自訂；自訂按鈕留到 v2 |
| 主寵物定義 | 目前選定的寵物 | 多寵物模式下為最左邊那一隻 |
| 使用者自填網址 | 執行時向使用者申請 | 新增 `net.requestHost()`；只收單一主機名稱、https；可撤銷 |
| Agent 種類 | 帶 `agentFamily` | `PetStatusChange` 加上 `codex`／`claude-code`／`opencode`，不含 session／專案 |
| 資源上限 | 預設同時啟用 10 個，所有數值使用者可自由調整 | 新增 §3.4 預設值表；另設硬上限只為保護 App 穩定 |
| 移除插件資料 | 移除時讓使用者選 | 可勾選保留設定與資料；密鑰一律刪除 |
| 面板頁 ↔ Worker 通訊 | 訊息通道 | 新增 `api.ui.postMessage` / `onMessage`，只限同一插件 |
| 面板頁尺寸 | 插件宣告偏好尺寸 | `preferredSize`（寬 320–960、高 240–800），使用者手動調整優先 |
| 降版 | 允許，但再確認一次 | 確認框列出權限差異 |
| API 主版本升級 | 過渡期一個 minor 版 | 期間顯示「即將不相容」，之後自動停用並告知 |
