# Agent Pets

顯示 AI 編程助手即時狀態的桌面寵物。

[English](README.md) | **繁體中文**

---

## 功能

- **即時狀態** — 一眼看出目前哪個助手正在執行、思考中還是閒置。
- **可拖曳寵物** — 拖到螢幕任意位置（重開 app 後位置會保留）。
- **多助手支援** — OpenCode、Codex、Claude Code（CLI 與 Desktop）。
- **自訂寵物** — 匯入自己的精靈圖，或是像 [codex-pets.net](https://codex-pets.net) 這類網站的 `.codex-pet.zip` 素材包。
- **桌面控制** — 系統匣選單、原生等待／完成通知、勿擾模式、音效控制，以及可選的登入時啟動。
- **Mini／Edge 模式** — Mini 可隨時切換；Edge Peek 需由使用者在 Settings 或 Tray 開啟，拖到螢幕邊緣停留片刻會顯示專用 Liquid Glass handle，不會裁切寵物本體，且會依螢幕與 DPI 變更重新定位。
- **可選 Shimeji 行為** — 在 Settings → Desktop → 桌面行為開啟後，寵物會以低頻率在閒置時走動、休息並回應游標。預設關閉；工作中、Permission、勿擾、Reduced Motion、背景或省電時會暫停，且只會在目前螢幕 work area 內移動。
- **桌面顯示控制** — 可選擇將寵物視窗排除在支援的擷取 API 外、在 macOS 其他 App 全螢幕 Space 或支援的 Windows 無框全螢幕顯示器中隱藏，或開啟右鍵隱藏。擷取保護只套用寵物；macOS 的擷取排除是最佳努力，而 Windows 偵測採保守規則，原生執行環境不可用時會停用。
- **權限控制** — OpenCode 的 permission request 可直接在 Liquid Glass 寵物氣泡選擇只允許一次或拒絕；只有符合條件且顯示中的請求才會註冊全域快捷鍵。
- **寵物成長** — 完成 session、受上限保護的觀察到的工作時間、每日首次完成與連續天數會產生持久 XP；Level 與 Evolution 由主行程 SQLite ledger 保存，重開後仍會恢復。
- **成就圖鑑** — Growth chip 會顯示每隻寵物獨立的 10 個長期里程碑；成就只在主行程解鎖一次，完成時可播放獎勵動畫與一次性原生通知，也會標示 token 成就的精確／估算資料品質。可在 Growth 中獨立關閉追蹤，不會影響 XP、Permission 或事件接收。
- **Presentation MCP** — 本機、僅展示用途的 MCP bridge 提供 `pet_status`、`pet_react`、`pet_say`；不會執行命令、開啟檔案、批准權限或修改 XP。

---

## 支援的工具

| 工具        | CLI | Desktop |
| ----------- | --- | ------- |
| OpenCode    | ✅  | ✅      |
| Codex       | ✅  | ✅      |
| Claude Code | ✅  | ✅      |

**Generic HTTP** Adapter 可供本機整合透過經驗證的 `/v1/events` 使用；它永遠是 observe-only，不具備回覆權限的能力。

---

## 快速開始

### 安裝（Windows）

從 [Releases](https://github.com/Ponpon55837/agent-pets/releases) 頁面下載並執行 `Agent Pets.exe`。不需要安裝——它是可攜式應用程式。

### 安裝（macOS）

從 [Releases](https://github.com/Ponpon55837/agent-pets/releases) 頁面下載 `AgentPets-<版本>-arm64.dmg`（Apple Silicon）或 `AgentPets-<版本>-x64.dmg`（Intel），打開後把 app 拖到「應用程式」資料夾。

### 第一次執行

1. 啟動 Agent Pets，螢幕上會出現一隻小寵物。
2. 點擊寵物，然後 **⚙ → Setup Wizard**。它會偵測你機器上安裝了哪些 AI 工具。
3. 點某個工具旁的 **Install**（或 **Install All**）來安裝對應的 hooks——精靈本身不會自動安裝，需要你手動點擊。
4. Hooks 安裝完後，重新啟動你的編程工具；寵物的外觀就會開始反映你的助手狀態。

---

## 使用方式

### 與寵物互動

| 動作             | 效果                                                             |
| ---------------- | ---------------------------------------------------------------- |
| **左鍵點擊**寵物 | 打開控制面板（面板是獨立視窗，出現在寵物旁邊——寵物本身不會移動） |
| **拖曳**寵物     | 移動到新位置（重開 app 後會保留）                                |
| **右鍵點擊**     | 在 Settings 開啟後可隱藏寵物（Permission 控制項仍可互動）        |

系統匣選單可以顯示／隱藏寵物、開啟面板或 Settings、切換 Mini／Edge Peek 模式／勿擾模式／音效／通知、在打包版本設定登入時啟動、從 **插件** 子選單執行已啟用插件的指令、以系統匣圖示標示待處理狀態，以及結束 app。關閉或隱藏寵物視窗後，hooks 與背景狀態仍會運作，直到選擇 **Quit**。

寵物下方有一個浮動狀態列，最多顯示 **3 行**，每行對應一個目前活躍的工具家族（Codex / Claude / OpenCode）。同一工具的 CLI 跟 Desktop 版本會合併成一行顯示（例如 `Claude (CLI+Desktop) · Thinking`）。當沒有任何工具在跑時，會顯示一行寵物整體的 idle/offline 狀態。

### 控制面板

點擊寵物打開控制面板——一個獨立的、永遠置頂的視窗，有兩個畫面；主畫面包含 **Sessions** 與 **Usage** 分頁：

#### Sessions 畫面（預設）

顯示所有 session（包含剛離線不久的）目前的狀態：

- **Idle** — 助手正在等待輸入
- **Thinking** — 助手正在處理中
- **Tool Running** — 助手正在執行工具
- **Waiting Permission** — 助手正在等待你核准
- **Success** — 任務完成
- **Error** — 發生錯誤
- **Offline** — Session 已結束或逾時失聯

進行中的狀態（Thinking / Tool Running / Waiting）旁邊會顯示已耗時秒數。如果有離線的 session，列表下方會出現 **Clear offline** 按鈕，一鍵清除。

#### Usage 分頁

顯示 Codex 與 Claude Code 回報的訂閱剩餘用量，包含 session／weekly 額度、重置倒數，以及依使用者本地時區顯示的重置日期時間。Codex／Claude family 活動時，既有寵物狀態 pill 底部會內嵌一條 3px 額度條，不改變視窗高度；它會優先顯示短期 session，若供應商只回傳 weekly 則自動改用 weekly。將滑鼠移到狀態列即可查看百分比與完整重置時間。**Agent Pets 沒有帳號系統，也永遠不會要求輸入 Agent 帳號、密碼或 token。** 它只沿用 Codex CLI／Claude Code 原本已建立的本機訂閱 session，由 Electron 主行程向供應商的 quota API 查詢，UI 只會收到整理過的百分比。若該 CLI session 不存在或已失效，重新驗證會在原本的 CLI 內進行，不是在 Agent Pets。結果會快取一分鐘；相關 Agent 活動期間，細條每五分鐘更新一次，按 **Refresh** 則會立即為兩個視窗取得新資料。只使用 API key 的 Codex session 無法取得訂閱額度。

點標題列的 **⚙** 圖示切換到 Settings。

#### Settings 畫面

#### 語言與文字

桌面 UI 與原生提示支援繁體中文與 English，包含設定、通知、Tray、Setup Wizard、權限提示與錯誤訊息。在 Settings 的 **語言** 分區即可切換；選擇會保存到本機，並同步寵物、面板、Tray 與原生通知。`Running`、`Thinking`、`Permission`、`Idle`、`Allow once`、`Deny`、Agent 名稱、MCP 工具名稱與 token 等技術詞會保留原文，避免和實際 API／狀態名稱不一致。

面板使用可擴充的分區導覽：**語言**、**Appearance**、**Desktop**、**Pets**、**Growth** 與 **Advanced**。

**Appearance 分區**

- **Size** — S / M / L / XL / XXL 調整寵物大小。
- **Bounce & shake** — 點擊／狀態切換時的彈跳、閒置搖擺、waiting-permission 抖動。**預設關閉。**
- **Status bubble** — 一般成功／錯誤提示約 3 秒後自動關閉，並以進度條顯示剩餘時間；權限請求絕不會自動關閉。**預設關閉。**

**Desktop 分區**

- **Mini mode** — 將寵物縮成 96px 左右的小型視圖，隨時可恢復 Normal。
- **Edge peek** — 獨立選項，**預設關閉**。開啟後拖到任一螢幕邊緣停留約 650ms，會顯示專用 42px 厚、96px 長的 Liquid Glass handle；按下或 hover 會展開回 Normal，不會留下寵物裁切區塊。待處理的權限請求會自動恢復完整可操作視圖。
- **Shimeji 行為** — 在 **Settings → Desktop → 桌面行為** 開啟自主行為。整個寵物視窗共用一個低頻排程；自訂素材沒有 Walk／Sleep manifest 時會安全回到 Idle，不會在 Mini／Edge 模式移動，也不會跨螢幕。
- **擷取排除** — 開啟後，將寵物視窗從支援的截圖／錄影 API 排除。Windows 使用系統擷取排除；macOS 使用有限的原生 sharing policy，較新的擷取工具可能忽略。控制面板不會被排除。
- **全螢幕自動隱藏** — macOS 以原生 Spaces policy 讓寵物與面板離開其他 App 的全螢幕 Space。Windows 使用原生 Win32 event detector：只有其他程式擁有可見、頂層、無框，且覆蓋完整螢幕的視窗時，才隱藏位於該螢幕的 Agent Pets 視窗；一般最大化視窗會忽略。原生執行環境不可用時會 fail closed 並停用；這不是影片內容辨識。
- **右鍵隱藏** — 開啟後，在寵物圖像或 Edge Peek handle 上按右鍵即可隱藏。Permission 卡片、狀態列、提示與其他互動控制項會排除；App 與 hooks 仍會繼續執行。
- **Do Not Disturb** — 勿擾模式會抑制原生通知、寵物音效、額外動態效果與非必要氣泡，但不會停止事件接收。**預設關閉。**
- **Notifications** — 等待核准、等待輸入、完成與錯誤的原生通知；同 session 的重複事件有冷卻時間，結束事件會批次合併。**預設開啟。**
- **Sound** — 成功/失敗/等待核准時的短音效（用 Web Audio 即時合成，不需要音檔）。**預設關閉。**
- **Launch at startup** — 登入系統時啟動 Agent Pets；此開關只在打包版本可用。
- **顯示權限泡泡** — 與一般 Bubble 分開的 Liquid Glass 權限卡片開關。關閉只會隱藏 Allow once／Deny 卡片，不會允許或拒絕請求；待處理請求仍由 Broker 保留、繼續顯示在系統匣徽章，並可由 Agent 或終端機處理。**預設開啟。**
- **Presentation MCP** — 本機 MCP 展示管道開關。開啟後 client 只能送出受限制的反應或純文字話語；勿擾模式與 waiting／error／permission 狀態優先。**預設開啟。**

**Advanced 分區**

- **Setup Wizard** — 重新偵測工具，或安裝/重新安裝 hooks。
- **Restart Pet** — 寵物或動畫卡住時，完整重新啟動 Agent Pets。
- **Quit** — 結束 Agent Pets。

**Growth 分頁**

- **Mood** — 每天從低基準 10 開始；任務成功 +4、失敗 -6。長任務每完成 2 個工具會再 +1（每個任務最多 +8），每持續工作 5 分鐘也會 +1（每個任務最多 +4），因此完成獎勵之前的進度分數最多 +12。心情成長時，會以目前寵物影格生成貼合自身輪廓的動態能量層，並在 90 以上進入完整爆氣效果。點 **Reset** 只會回到 10，不會額外加分。
- **Mood visuals** — 可關閉 mood 對寵物 aura、色彩與能量層的視覺影響；數值仍會持續追蹤，之後重新開啟即可恢復。
- **XP／Level** — Growth chip 會顯示目前選取寵物的持久 XP、Level、Evolution 階段與目前 streak。XP 使用有版本的去重 ledger：每個 canonical session 完成 +20、每日首次完成 +10、每觀察到 30 分鐘 active coding +2（每個 session 最多 +10），延續前一天 streak +5。失敗或取消不會扣永久 XP；token milestone 等待精確 token event contract。
- **Achievements／成就** — 同一個 Growth chip 內的圖鑑會顯示 10 個成就（首次完成、session／活躍日門檻、Night Owl、不同 Agent、連續天數、Level 與 token milestone）。解鎖資料寫入獨立的 `achievements.sqlite`，每隻寵物與版本各自去重；啟用成就時，App 會在啟動與重新開啟追蹤時，把 History 保留且已驗證的不重複完成 session 安全回填到成就 ledger，重播回填不會重複解鎖或通知。關閉「啟用成就」只停止新的解鎖與回填，既有成就與 XP 不會被清除。

**Pets 分頁**

- **Pet** — 選擇要顯示哪隻寵物，點名字即可切換。
- **+ Import Sprite** — 匯入自訂精靈圖（`.webp`/`.png`/`.jpg`，8 欄 × 11 列）。
- **+ Import .zip** — 一鍵匯入 `.codex-pet.zip` 素材包（例如從 codex-pets.net 下載的），不用手動解壓縮。
- **Multi-pet** — 同時有 2 個以上工具家族在跑時，改成每個家族各顯示一隻小寵物，而不是只顯示優先權最高的那隻。**預設關閉。** 開啟後，每個工具的寵物選擇也會顯示在這個分頁。

點 **‹** 回到 Sessions 畫面。

### Presentation MCP

Presentation MCP 是給支援 MCP 的 Agent 使用的本機 stdio bridge。App 啟動後會建立 bridge 與獨立 token：

```text
Windows: %USERPROFILE%\\.desktop-pet\\presentation-mcp.mjs
macOS/Linux: ~/.desktop-pet/presentation-mcp.mjs
```

請在 MCP client 中使用真正的 Node.js 執行這個 script。它只提供 `pet_status`（唯讀的整理後狀態）、`pet_react`（五種受限制的反應）與 `pet_say`（最長 240 字元、存活 1–15 秒的純文字）。每個 client 每 10 秒最多 3 次；queue 有上限，intent 會自動逾時，client disconnect 時會移除該 client 尚未顯示的 intent。Permission、error、waiting 與勿擾狀態永遠優先。這個管道不能控制工具、檔案、權限、XP、quota 或成就。

#### 一鍵安裝到本機專案

在 **Settings → Advanced** 按下 **Setup MCP for a project / 為專案設定 MCP**，於原生資料夾選擇器選擇本機專案；Agent Pets 會一次為三種支援的 project client 寫入展示 bridge：

- Codex：`.codex/config.toml`（`mcp_servers.agent-pets`）
- Claude Code：`.mcp.json`（`mcpServers.agent-pets`）
- OpenCode：`opencode.json`（`mcp.servers.agent-pets`）

這個操作可重複執行。相同設定會回報「已設定」；同名但內容不同的設定會回報衝突並完全不覆蓋。它只修改選定專案的本機設定，不執行 shell 命令，也不會重新安裝 hooks。設定完成後，請重啟對應的 Agent client，讓它重新載入 MCP 工具目錄。

這個按鈕會開啟獨立的 MCP 完整面板，不會把設定精靈或主設定頁越堆越大。面板會記住所有透過此按鈕設定的專案，重新檢查三個 client，顯示「已連接」、「部分連接」、「有衝突」或「找不到資料夾」，並列出專案路徑與最後檢查時間。**重新檢查**會立即更新清單。**移除 MCP** 只會移除仍符合 Agent Pets 原始設定的項目；如果使用者改過設定，會保留檔案並標示衝突。若專案資料夾已不存在，可以只移除清單記錄，不會碰到其他檔案。按下 **完成** 會回到設定頁。

### History HUD（歷史儀表板）

主面板的 **History** 分頁會讀取由 main process 管理的本機彙總：近七天每日工作量、不重複的完成／失敗工作階段、觀察到的工作時間、Agent 分布、最近 Quota 快照，以及精確／估算的 token 品質。同一隻寵物、來源、session 與專案身分重複送出的 success 只算一個完成 session，與成就 ledger 使用相同定義。History 也會由 main process 唯讀掃描固定的本機 session log 路徑：`%USERPROFILE%\.codex\sessions`、`%USERPROFILE%\.claude\projects` 與 `%USERPROFILE%\.claude\transcripts`。Codex 的 `token_count` 會使用累積的 `total_token_usage`，只匯入單調增加的差值；重複的 context／rate-limit 快照，以及沒有累積 counter 的紀錄會忽略。Claude assistant 的 `usage` 會以精確來源解析；cache 欄位會併入 input，只有在沒有 output 時才使用 reasoning。掃描器限制檔案／行大小、拒絕逃出根目錄的連結、只接受白名單 usage 形狀、去重串流紀錄，並只保存雜湊後的 session／檔案身分。原始事件只保存受限制的中繼資料與雜湊後的專案／session 身分；HUD 不保存 prompt、工具參數、憑證或完整專案路徑。**匯出摘要**會將清理後的彙總寫入使用者選擇的 JSON 檔案。**清除歷史**只清除歷史與 Quota 快照，並建立新的本機 log cutoff，不會重設寵物 XP、等級、進化、心情或成就。原始事件有固定保留期限，長期每日彙總則可持續保留。

History 上方的 **專案篩選**可以只查看某一個專案的近七日統計，其中的 token 用量也會依偵測到的專案（透過 Claude Code／Codex 本機紀錄的工作目錄）正確歸屬，而不是只顯示全域總量。專案寵物則在 **Settings → Pets → 專案寵物** 管理：卡片最上方的開關可以整個停用專案路由（停用後所有 session 都沿用目前選取的寵物，但已記錄的專案與綁定不會被刪除）；按下 **加入專案** 使用原生資料夾選擇器，接著選擇要綁定的寵物；選擇「使用目前選取的寵物」即可解除綁定；每個專案旁的移除鈕可以把它從清單拿掉（之後收到該專案的事件會自動重新加入）。未綁定的專案不會改變原本行為。若綁定的自訂寵物被移除，Agent Pets 會先使用永遠存在的預設寵物，並在設定頁標示「缺少的寵物」，重新加入或選擇其他寵物後即可修復。專案身份會以本機 salt 雜湊保存，資料庫與通知不保存完整專案路徑。

#### 讓目前使用中的 Agent 專案接通

1. 先啟動 Agent Pets，在 **Settings → Attention → Presentation MCP** 保持開啟（預設開啟）。App 必須保持執行，因為 stdio bridge 會連到它的本機 loopback control server。
2. 確認 `node` 是真正的 Node.js，不要使用 `Agent Pets.exe` 當 interpreter。Windows PowerShell 可先確認：

   ```powershell
   $bridge = Join-Path $env:USERPROFILE '.desktop-pet\presentation-mcp.mjs'
   node --version
   Test-Path $bridge
   ```

3. 依照使用的 Agent client 註冊同一個 bridge。這是 presentation channel，不需要重新安裝 hooks；每個 client 只需要註冊一次，之後重啟 client。

   **Codex CLI／Codex desktop／IDE extension（共用設定）：**

   ```powershell
   codex mcp add agent-pets -- node $bridge
   codex mcp list
   ```

   **Claude Code：**

   ```powershell
   claude mcp add --scope user agent-pets -- node $bridge
   claude mcp list
   ```

   **OpenCode：** 在 `opencode.json` 的 `mcp.servers` 加入（若使用專案設定，也可放在專案自己的設定檔）：

   ```json
   {
     "mcp": {
       "servers": {
         "agent-pets": {
           "type": "local",
           "command": ["node", "C:/Users/<你的帳號>/.desktop-pet/presentation-mcp.mjs"]
         }
       }
     }
   }
   ```

4. 完全重啟 Agent client，並用它的 MCP 檢視功能確認 `pet_status`、`pet_react`、`pet_say` 三個工具。若只看到 hooks 的事件而看不到這三個工具，請檢查 bridge 路徑、Node executable、Presentation MCP 開關與 Agent Pets 是否仍在執行。

關閉 Presentation MCP 只會拒絕新的展示 intent，不會移除既有 hooks，也不會影響 Permission Broker、XP 或一般 `/v1/events`。

---

## Setup Wizard（設定精靈）

Setup Wizard 會讀取 runtime Agent Adapter registry，並在你點擊按鈕時才安裝對應的 hooks——它本身不會自動安裝任何東西。每個 Adapter 會回報支援的來源、能力、健康狀態與診斷檢查：

- **OpenCode CLI / Desktop** — 寫入 plugin 到 `~/.config/opencode/plugin/`（注意：是單數 `plugin`，跟 OpenCode 實際掃描的目錄一致）以及對應平台的 OpenCode Desktop plugin 目錄
- **Codex CLI** — 建立 `~/.codex/hooks.json` 並在 `~/.codex/config.toml` 啟用 hooks
- **Claude Code CLI & Desktop** — 在 `~/.claude/settings.json` 加入 `hooks` 區塊（CLI 跟 Desktop 共用這份設定，所以裝一次兩邊都算；實際是哪一邊觸發的事件，是透過 Claude Code 的 `CLAUDE_CODE_ENTRYPOINT` 環境變數在執行當下判斷，不是安裝程式決定的）

每個 Adapter 會顯示狀態燈與 capability chips：

- 🟢 **綠燈** — 已安裝且設定完成
- 🟡 **黃燈** — 有偵測到，但還沒（完全）設定好
- 🔴 **紅燈** — 發生錯誤或不可用

點 Adapter 旁的 **Diagnose** 可以查看有上限的健康檢查。可安裝的 Adapter 點 **Install** 可以單獨（重新）安裝，或點 **Install All** 以 idempotent 方式執行全部安裝器。如果狀態看起來過期，點 **Refresh** 重新偵測。

設定完成的 Adapter 可以點 **Test**，透過目前 app 經 token 驗證的本機 HTTP 接收器送出一筆短暫事件。測試通過會同時驗證 HTTP 204、Adapter 選擇、canonical mapping 與 renderer 收到事件；它不會啟動編程工具，也不代表該工具本身已主動觸發 hook。Generic HTTP 永遠是 observe-only，不能回覆權限。

> 註：目前沒有獨立的「Codex Desktop」hook 安裝項目——只有 Codex CLI 的 hooks 有接上。

## 插件

插件可提供寵物通知、反應、面板與 Tray 指令、狀態徽章、沙箱面板頁、寵物外觀，以及清楚標示來源的唯讀狀態列。在 **Settings → Plugins** 安裝 `.agentpet-plugin` 套件，或開啟選擇加入的線上目錄檢視已簽章插件並檢查更新；問題回報會開啟只包含插件 ID 與版本的預填連結。開發者可開啟 **開發者模式** 載入本機資料夾。安裝前請檢查插件要求的權限與貢獻。插件頁面與背景程式都視為不受信任：沒有 Node.js、檔案系統或 shell 存取，網路請求只能送到核准的 HTTPS 網域。插件網路請求不會送出或儲存 Cookie。從 1.4.0 起，插件面板可以用系統瀏覽器開啟已宣告的 HTTPS 連結，但只限使用者剛按下滑鼠或 Enter／Space 之後，且每分鐘最多 5 次。密鑰由 App 的受保護儲存加密，設定快照不會回傳密鑰值。

背景插件共用一個隱藏的 Plugin Host 程序，只有在至少啟用一個插件時才會啟動。它的記憶體以「載入完成、任何插件開始執行前」的用量為基準，Chromium 本身的固定開銷不會算到插件頭上。只有增長量連續兩次（每 30 秒檢查一次）超過所有啟用插件的預算合計（預設每個插件 64 MB），才會重新啟動 host。Windows 上量的是程序獨佔的 private 記憶體，因為 working set 還包含與其他 Agent Pets 程序共用的 Chromium 程式碼頁面（實測約 65 MB）。

請參閱[插件開發索引](docs/plugins/README.zh-TW.md)、[10 分鐘入門](docs/plugins/getting-started.zh-TW.md)、[安全模型](docs/plugins/security.zh-TW.md)、[API 參考](docs/plugins/api-reference.zh-TW.md)與[範例](docs/plugins/examples.zh-TW.md)。

---

## 自訂寵物

### 精靈圖格式

自訂寵物使用跟內建寵物相同的精靈圖格式。`pet.json` 可選擇宣告受限的 `behaviorManifest`，提供 `walk` 與／或 `sleep` 的 row；缺少定義時會安全回到 Idle：

```json
{ "behaviorManifest": { "walk": { "row": 1 }, "sleep": { "row": 5 } } }
```

- **格式**：`.webp`、`.png` 或 `.jpg`（內建寵物是用 `.webp` 出貨；三種格式匯入後都是原樣複製，讀取時是看內容而不是看副檔名）
- **網格**：8 欄 × 11 列（目前只用到第 0–8 列；9、10 保留給未來的狀態用）
- **格子大小**：192 × 208 像素

每一列對應一種狀態：

| 列  | 狀態                               |
| --- | ---------------------------------- |
| 0   | Idle / Offline                     |
| 5   | Error                              |
| 6   | Waiting Permission / Waiting Input |
| 7   | Thinking / Tool Running            |
| 8   | Success                            |

### 如何匯入

**匯入單張精靈圖：**

1. 打開控制面板（點擊寵物）。
2. 點 **⚙** 進入 Settings。
3. 點 **+ Import Sprite**。
4. 選擇一張 `.webp`/`.png`/`.jpg` 精靈圖檔案。
5. 寵物會加入你的收藏並自動被選取。

**從 `.codex-pet.zip` 素材包匯入**（例如從 [codex-pets.net](https://codex-pets.net) 下載的）：

1. 打開控制面板 → **⚙** → Settings。
2. 點 **+ Import .zip**，選擇下載好的 `.zip`。
3. App 會自動讀取裡面的 `pet.json` 跟精靈圖——不用手動解壓縮。

自訂寵物存放在 `~/.desktop-pet/custom/`。

### 如何重新命名

1. 打開控制面板（點擊寵物）。
2. 點 **⚙** 進入 Settings。
3. 在清單中找到該自訂寵物。
4. 點寵物名字旁的 **✎** 鉛筆圖示。
5. 輸入新名字後按 **Enter**（或點其他地方確認）。
6. 按 **Esc** 取消。

內建寵物無法重新命名。

### 如何移除／隱藏

點清單中任一寵物旁的 **×** 即可移除（會先跳出確認提示，避免手滑誤觸）——自訂寵物會直接刪除匯入的檔案；內建寵物則只是從你自己的清單隱藏（不會動到隨 app 出貨的素材檔案本身）。預設的保底寵物（`aang-airbender`）沒有 **×**，無法被移除或隱藏，確保清單裡永遠至少有一隻寵物可用。

---

## 事件伺服器

Agent Pets 會在本機啟動一個 HTTP 伺服器 `http://127.0.0.1:17373/v1/events`，接收來自各 hooks 的狀態更新。請求必須包含每次安裝專用的 `X-Agent-Pets-Token` header；受管理的 hooks 會自動從目前使用者專用、權限受限的 `~/.desktop-pet/event-token` 讀取。

### POST /v1/events

```json
{
  "source": "codex",
  "sessionId": "sess_abc123",
  "state": "thinking",
  "timestamp": 1735689600000,
  "originalEvent": "UserPromptSubmit",
  "project": "/Users/you/my-project",
  "toolName": "Edit"
}
```

`source`、`sessionId`、`state`、`timestamp` 這四個欄位是必填的——缺任何一個都會被伺服器回 `400` 拒絕；缺少或使用錯誤的 hook 驗證資訊則回 `401`。

**欄位說明：**

| 欄位            | 型別   | 必填 | 說明                                                                                                                                                              |
| --------------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`        | string | 是   | `opencode-cli`、`opencode-desktop`、`codex`、`codex-desktop`、`claude`、`claude-desktop`（也接受 `opencode`，會自動正規化成 `opencode-cli`）                      |
| `sessionId`     | string | 是   | 唯一的 session 識別碼（最長 256 字元）                                                                                                                            |
| `state`         | string | 是   | `idle`、`thinking`、`tool-running`、`waiting-permission`、`waiting-input`、`success`、`error`、`offline`（也接受 `waiting`，會自動正規化成 `waiting-permission`） |
| `timestamp`     | number | 是   | 事件發生時間的 Unix 毫秒時間戳                                                                                                                                    |
| `project`       | string | 否   | 專案路徑（UI 只會顯示 basename）                                                                                                                                  |
| `originalEvent` | string | 否   | 觸發這筆事件的原始 hook/事件名稱，方便除錯                                                                                                                        |
| `toolName`      | string | 否   | 工具名稱，`tool-running` 時會顯示在活動氣泡裡                                                                                                                     |

---

## 安全性

- **Renderer 隔離** — Renderer 啟用 Chromium sandbox 與 context isolation、停用 Node.js integration，使用安全的自訂 `agent-pets://` protocol 取代高權限 `file://` 頁面，並以嚴格 CSP、禁止彈窗／外部導頁、拒絕權限請求及 IPC 主 frame 來源驗證縮小攻擊面。
- **本機事件伺服器** — 只監聽 `127.0.0.1`，每個 hook 請求都必須通過每次安裝專用 secret 驗證；同時拒絕瀏覽器來源與非 JSON 請求、限制事件速率，且只接受長度受限的白名單欄位。
- **用量查詢** — Quota 功能只允許連線到指定的 Codex 與 Anthropic HTTPS quota／驗證端點，拒絕轉址、過大回應、過多 window 與格式錯誤的 renderer IPC payload。OAuth 憑證只存在 Electron 主行程，不會傳給 renderer 或出現在命令列參數。
- **本機用量讀取器** — Token 歷史由 main process 唯讀管理，只掃描固定的 Codex／Claude JSONL 路徑，限制檔案與行大小，拒絕逃出根目錄的 symlink／reparse path，解析白名單欄位並雜湊來源身分；不保存原始 log、prompt 或工具內容。每行先以子字串預篩再 `JSON.parse`、每行最多解析一次，且每個檔案以單一 SQLite transaction 匯入（2 萬筆測試資料約快 10 倍）。
- **憑證更新** — OAuth token 過期時會更新，並安全合併回原本的 Codex auth 檔或 Claude 憑證儲存區，避免 CLI 登入失效；檔案寫入會做帳號／變更檢查、限制檔案權限，並盡可能採原子替換。
- **寵物匯入** — 寫入前會驗證 ZIP 項目數、壓縮／解壓縮大小、JSON 大小，以及圖片大小與實際格式。
- **記憶體上限** — Agent session 數量有上限，會以單次線性掃描（O(n)）優先淘汰離線／最舊項目，避免 renderer 記憶體無限成長。
- **本機伺服器** — 事件轉送會略過已銷毀的視窗，避免面板關閉時通知／XP／歷史處理被整個跳過；並設定較短的 header／request 逾時，限制慢速 loopback 連線佔用。啟動時如果埠（17373–17375）還被其他程序佔用（例如尚未完全結束的舊實例），事件、Presentation MCP 與 Permission adapter 伺服器會以 2 秒到 30 秒的退避持續重試，不會一直離線到下次重新啟動。
- **Windows 檔案取代** — 原子寫入與插件安裝在 Windows Defender 或搜尋索引短暫鎖住剛寫入的檔案時（`EPERM`／`EACCES`／`EBUSY`，實測剛寫入的目錄約 3% 會遇到），會重試 rename 約 1.3 秒。其他平台與其他錯誤維持原本的立即失敗。
- **SQLite 效能** — History、Progression、成就與專案路由 store 共用 prepared statement 快取，不再於每個 hook 事件重新編譯 SQL；專案路徑快取改為真正的 LRU。
- **路徑清理** — 專案路徑只保留 basename，檔案寫入目的地也會限制在預期根目錄內。
- **專案寵物路由** — main process 只保存每次安裝 salt 產生的 project hash、basename 與 pet binding；symlink／junction 會先 canonicalize，renderer、通知與 MCP status 都不會收到完整路徑。缺少綁定寵物時只回退到預設寵物，不會自動允許或改變權限。
- **桌面通知** — 通知只會使用正規化後的 Agent 名稱與長度受限的專案 basename，不會顯示或記錄 prompt、工具參數、session identifier 或憑證；診斷紀錄有固定上限，而且只保存事件類別與結果。
- **桌面顯示與偏好 IPC** — 擷取保護、全螢幕 capability 投影、Windows Win32 event detector、右鍵隱藏授權與桌面偏好都由 main process 擁有。Renderer 只能從已驗證的第一方 frame 傳送白名單 boolean 欄位；右鍵隱藏會再次檢查可信任的 pet sender 與持久化開關。設定檔採長度受限讀取與原子替換。Windows detector 只使用前景 HWND、DWM frame bounds、螢幕 bounds、可見性／style 檢查與 event hook，不使用焦點／標題猜測、PowerShell、WMI 或無上限輪詢；原生失效時 fail closed。
- **Presentation MCP** — MCP bridge 只監聽 loopback，使用獨立的每次安裝 token，拒絕瀏覽器來源，限制 JSON body／請求速率，固定三個工具，清理控制字元與 markup，限制訊息長度／TTL／queue，並在 client disconnect 時移除 pending intent；它沒有命令、檔案、權限、XP、quota 或成就權限。
- **Permission Broker** — 權限回覆使用獨立 loopback port 與專用的每次安裝 token，不會經過一般事件端點。Main process 強制 TTL、一次性狀態轉換、anti-replay、資料上限、Adapter-owned opaque handle、限時快捷鍵、Agent 端解決對帳，以及內容去識別且有上限的本機 audit；只提供 `allow_once` 與 `deny`，刻意不提供永久允許。
- **Progression 儲存** — XP 只在 Electron 主行程發放。SQLite migration、同一 transaction 的 `pet_progress`／`xp_ledger` 更新、唯一 idempotency key、受上限保護的 session active-time 與 sanitized snapshot，避免 renderer 或重送事件灌高 XP。資料庫只留在本機，不會上傳。
- **打包執行環境** — Electron fuses 會停用 RunAsNode、Node options／inspect 參數與 `file://` 額外權限，並強制只從 ASAR 載入及驗證內嵌 ASAR 完整性。
- **發行簽章** — 正式發布 macOS／Windows 產物時必須配置平台簽章憑證；未簽章的本機建置只供開發測試。

---

## 開發

### 前置需求

- Node.js 22.12+
- pnpm 11+

### 環境設置

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
```

### 開發模式執行

```bash
pnpm dev
```

若特定 Windows 電腦在開發模式遇到 Chromium GPU process 崩潰，請直接使用內建安全模式，不需要建立本機環境檔案：

```bash
pnpm dev:safe
```

安全模式仍會啟用 Chromium sandbox，並只在該次 Windows Vite 開發執行改用軟體繪製；一般開發、正式打包版本、macOS 與 Linux 仍保留硬體加速。

### 建置

```bash
pnpm build
```

輸出會在 `release/` 目錄下。

### 發版

發版由 `.github/workflows/release.yml` 自動處理。當修改 `package.json` 中 `version` 的 commit 進到 `main`，且尚未存在 `v<版本>` tag 時，GitHub Actions 會先跑型別檢查與單元測試，再打包 macOS（arm64 + x64 `.dmg`）與 Windows（可攜式 `.exe`），最後建立 `v<版本>` tag 與附上兩個平台安裝檔、自動產生說明的 GitHub Release。不需要手動打 tag 或在本機打包。也可以在 Actions 頁面按 **Run workflow** 重新執行；已有 tag 的版本會自動略過。目前產出的安裝檔尚未簽章。

### 單元測試

```bash
pnpm test:unit
```

Windows 沒有開啟開發者模式時，一般使用者無法建立檔案 symlink，所以需要建立 symlink 的測試會自動略過；檔案權限（`0600`）的斷言只在 macOS／Linux 執行。其他測試在所有平台都會跑。

想在真正的 Electron 中驗證修改、又不碰到自己的資料時，先 build，再啟動隔離啟動器。它使用暫存的 home 與 userData，以及假的 `safeStorage`。它會綁定和已安裝的 Agent Pets 相同的本機埠，所以請先結束平常使用的 App，或等測試 App 結束後讓它自動重新連上：

```bash
pnpm exec vite build
```

```bash
node scripts/e2e-isolated-electron.mjs
```

### 安裝 Hooks（開發用）

```bash
node integrations/install.mjs
```

這會幫所有偵測到的工具安裝 hooks，安裝位置為：

- `~/.codex/hooks.json`（Codex）
- `~/.claude/settings.json`（Claude Code CLI & Desktop）
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd`（上述所有工具共用的 hook script）
- `~/.desktop-pet/event-token`（每次安裝專用的事件驗證 secret；macOS／Linux 權限為 `0600`）
- `~/.desktop-pet/presentation-token`（獨立的 Presentation MCP secret；macOS／Linux 權限為 `0600`）
- `~/.desktop-pet/presentation-mcp.mjs`（MCP client 使用的 stdio bridge）

既有安裝升級後，Agent Pets 會自動更新受管理的 hooks。已經在執行中的 OpenCode 需要重新啟動一次，讓已載入的 plugin 套用事件驗證。

用 `--claude-code` 可以只安裝/移除 Claude Code 的 hook：

```bash
node integrations/install.mjs --claude-code
node integrations/install.mjs --uninstall --claude-code
```

桌面 App 也會在啟動時更新 presentation bridge。MCP client 應把 stdio server 指向 `~/.desktop-pet/presentation-mcp.mjs`（Windows 為 `%USERPROFILE%\\.desktop-pet\\presentation-mcp.mjs`），並使用真正的 Node.js；不可把打包後的 Agent Pets exe 當成 Node interpreter。

> **語言與建置提醒：** 目前設定、Tray、通知、Setup Wizard、權限、錯誤與 onboarding 文字已集中使用繁體中文；技術狀態與工具名稱保留原文。執行 `pnpm build` 或 `pnpm electron:build` 時，建置會先只關閉本專案可辨識的 Agent Pets 程序，避免 `win-unpacked` 檔案鎖定，不會終止其他 Electron 應用程式。

---

## 專案結構

```
agent-pets/
├── electron/
│   ├── main.ts              # Electron 主行程
│   ├── agent-adapter.ts     # AgentAdapter 契約與 runtime registry
│   ├── agent-adapter-operations.ts # 跨平台 Adapter 偵測／安裝橋接
│   ├── preload.ts           # IPC 橋接
│   ├── event-server.ts      # HTTP 事件伺服器
│   ├── event-normalizer.ts  # 一般事件 allowlist 與 projection
│   ├── permission-broker.ts # 權限狀態機與 anti-replay
│   ├── permission-adapter-server.ts # 獨立的 OpenCode 回覆通道
│   ├── permission-audit.ts  # 有上限且去敏感內容的本機 audit
│   ├── progression.ts       # SQLite XP ledger 與 Level projection
│   ├── presentation-controller.ts # TTL／rate／queue 展示控制邊界
│   ├── presentation-mcp.ts  # Loopback MCP 展示端點
│   ├── project-mcp-setup.ts # 安全的專案本機 MCP 設定安裝器
│   ├── project-mcp-registry.ts # 本機已連接專案清單與狀態檢查
│   ├── pet-window-mode.ts   # Mini／Edge 幾何與 dwell 常數
│   ├── desktop-visibility.ts # 平台 capability 投影
│   ├── windows-fullscreen-detector.ts # Windows 原生全螢幕 event detector
│   ├── desktop-preferences.ts # Main 擁有的桌面偏好
│   ├── desktop-notifications.ts # 原生通知與有上限的診斷紀錄
│   ├── desktop-tray.ts      # 系統匣生命週期與選單
│   ├── notification-policy.ts # 純通知分類／冷卻規則
│   ├── quota.ts             # Codex／Claude 剩餘用量讀取
│   ├── local-usage.ts       # 受限制的 Codex／Claude session log token 讀取
│   ├── sqlite-statements.ts # SQLite store 共用的 prepared statement 快取
│   └── setup.ts             # 跨平台路徑與安裝邏輯
├── integrations/
│   ├── install.mjs          # 獨立的 CLI hook 安裝程式
│   ├── agent-hook.mjs       # 共用的 hook script（透過 extraResources 打包進 app）
│   ├── agent-hook.cmd       # agent-hook.mjs 的 Windows 包裝腳本
│   └── presentation-mcp.mjs # 獨立 stdio MCP 展示 bridge
├── scripts/
│   └── stop-agent-pets.mjs  # 建置前清理本專案 Agent Pets 程序
├── src/
│   ├── components/
│   │   ├── DesktopPet.vue   # 寵物視窗（拖曳＋點擊）
│   │   ├── PetAnimation.vue # Canvas 精靈圖渲染
│   │   ├── StatusPanel.vue  # 統一控制面板
│   │   └── SetupWizard.vue  # 工具偵測＋安裝精靈
│   ├── stores/
│   │   └── agentStore.ts    # Pinia store（sessions、寵物、UI 狀態）
│   ├── types/
│   │   ├── agent.ts         # Agent 事件型別
│   │   ├── agent-adapter.ts  # Adapter capability／status 契約
│   │   ├── desktop.ts       # 桌面偏好 IPC 型別
│   │   ├── desktop-visibility.ts # 顯示 capability 型別
│   │   └── presentation.ts  # Presentation intent／status 契約
│   └── utils/
│       ├── format.ts        # 共用格式化函式
│       └── sound.ts         # 即時合成音效（Web Audio API）
├── public/
│   └── pets/
│       ├── pets.json        # 內建寵物清單（id/displayName/folder）
│       └── <pet-id>/        # 每隻內建寵物的 spritesheet.webp + pet.json
├── tests/                   # Node 內建單元測試
├── package.json
└── README.md
```

App 本身的安裝/解除安裝邏輯（Setup Wizard 按鈕在用的那套）在 `electron/setup.ts` 裡、直接在 app 行程內執行；`integrations/install.mjs` 是給終端機執行的獨立對應版本（見上方〈安裝 Hooks（開發用）〉），兩邊產生的 hook script 跟 plugin 內容是一樣的，但需要手動同步維護。

---

## 授權條款

MIT — 詳見 [LICENSE](LICENSE)。用量整合以 MIT 授權的 [TokenBar](https://github.com/Nanako0129/TokenBar) 為基礎，詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
