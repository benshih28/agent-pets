# Agent Pets

桌面寵物，即時顯示你的 AI 程式助理正在做什麼：思考中、執行工具、等你處理、完成或失敗。

[English](README.md) | **繁體中文**

---

## 安裝

到 [Releases](https://github.com/Ponpon55837/agent-pets/releases) 頁面下載最新版本。

- **macOS** — `AgentPets-<version>-arm64.dmg`（Apple Silicon）或 `AgentPets-<version>-x64.dmg`（Intel）。開啟後把 App 拖進「應用程式」。
- **Windows** — `AgentPets-<version>.exe`，免安裝的可攜版。

每個 Release 都附 `SHA256SUMS.txt`；在下載資料夾執行 `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` 即可比對檔案。

目前的版本沒有開發者憑證，也沒有公證（macOS 版只有 ad-hoc 簽章，用來密封 bundle），第一次開啟時系統會跳出警告：

- **macOS（Gatekeeper）** — 在「應用程式」中對 App 按右鍵，選擇**打開**並確認；或到**系統設定 → 隱私權與安全性**按**強制打開**。最後手段：`xattr -dr com.apple.quarantine "/Applications/Agent Pets.app"`。
- **Windows（SmartScreen）** — 選擇**其他資訊 → 仍要執行**。

## 第一次使用

第一次啟動時會出現寵物，並自動開啟面板，先顯示簡短介紹（寵物會顯示什麼、何時需要你、如何成長），接著進入**設定精靈**：

1. 在工具旁按**安裝**，或按**全部安裝**，寫入該工具的 hook。沒有你的點擊不會安裝任何東西；既有設定檔會先備份（`*.agent-pets-bak-*`，保留最近 5 份），而且只加入 Agent Pets 自己的項目。無法解析的檔案絕不覆寫。
2. 重新啟動該工具。按**等待真實事件**（執行任何提示詞，最多等 30 秒，等工具自己送出事件）即可確認端對端連線。**測試接收器**只證明本 App 能收到本機事件，**診斷**則逐項列出檢查結果與修復提示。
3. 之後啟動時，精靈只會在你尚未完成、也沒按**稍後再說**之前再次出現。隨時可從**設定 → 進階 → 設定精靈**重新開啟。

要移除整合，可在精靈中對單一工具按**移除**（只移除該工具的項目），或在刪除 App 前按**完整清除…**（移除所有 hook、連線權杖，以及 `~/.desktop-pet` 底下的檔案；Windows 為 `%USERPROFILE%\.desktop-pet`）。

## 支援的 Agent

| Agent | CLI | Desktop | Permission | Quota | Token usage |
|-------|-----|---------|------------|-------|-------------|
| OpenCode | 支援 | 支援 | respond | — | estimated |
| Codex | 支援 | 部分 | observe | provider | exact |
| Claude Code | 支援 | 支援 | observe（開啟後 respond） | provider | exact |

- **respond** — 權限請求可直接在寵物氣泡上「允許一次」或「拒絕」。OpenCode 一律支援；Claude Code 需開啟**從寵物回覆 Claude Code 權限**（見[權限氣泡](#權限氣泡)）。
- **observe** — 寵物會顯示「等待權限」，但必須回到工具本身核准（Codex 只會回報正在等待，沒有管道把決定送回去）。
- Codex 不會回報「等待輸入」狀態。Codex Desktop 與 CLI 共用 `~/.codex`，且沒有獨立的安裝 API，所以只有在該版本執行相同 hook 時才有作用，請用**等待真實事件**確認。
- **Token usage：exact** 表示逐則訊息讀取 Agent 自己的本機工作階段紀錄（`~/.codex/sessions`、`~/.claude/projects`）。**estimated** 表示數字來自 Agent 送來的事件，例如 OpenCode 與 Generic HTTP 整合；Codex 與 Claude Code 事件上的用量不計入，讓本機紀錄維持唯一來源。
- **Generic HTTP** adapter 供本機整合透過需驗證的 `/v1/events` 端點使用（見[事件伺服器](#事件伺服器)），僅能觀察。

## 寵物

| 操作 | 效果 |
|------|------|
| 點擊（或聚焦後按 Enter / Space） | 在寵物旁開啟控制面板 |
| 連按兩下 | 摸摸寵物：小動作並增加 1 點心情（每天最多 5 次） |
| 拖曳 | 移動寵物，位置重啟後會記住 |
| 右鍵 | 選單：開啟面板、開啟設定、勿擾模式、Mini 模式、隱藏、離開（若開啟**右鍵隱藏**則直接隱藏） |

- **狀態列** — 寵物下方最多 3 行，每個工具家族（Codex / Claude / OpenCode）一行，CLI 與 Desktop 合併成同一行。每行都是一條細的單行：工具名稱與簡短狀態（狀態詞不論介面語言都以英文顯示），有額度資料時再加上百分比與額度條，另有插件徽章時也在同一行，例如 `Claude · Working 71%`。狀態詞一律完整：寬度不夠時（多寵物小尺寸、徽章較多）依序拿掉徽章的 `+N`、徽章（由後往前），接著名稱以省略號縮短、再拿掉名稱，最後才是百分比（額度條保留）。被拿掉的徽章仍會出現在提示與螢幕閱讀器標籤中。同一家族有多個工作階段時，這一行會跟著最需要你處理的那一個（狀態優先度最高，其次是最近的）。完整名稱、CLI/Desktop、專案與介面語言的完整狀態放在滑過時的提示（有額度條時併入額度提示）與螢幕閱讀器的標籤中。沒有進行中的工作階段時只顯示一行 `Idle` 或 `Offline`，提示與螢幕閱讀器標籤也是同一個字。
- **完成標記** — 超過 45 秒沒碰寵物時完成的結果，會在寵物旁累計成 `✓ N`（有失敗時為 `⚠ N`）；Mini 模式與邊緣收合也會顯示數量。點寵物或標記即清除。可在**設定 → 桌面 → 完成標記**關閉，關閉期間不會累計。
- **氣泡** — 成功、失敗與等待提示會出現在寵物上方（**狀態泡泡**，預設開啟，數秒後自動關閉，點擊可開啟面板）。可另外開啟**工作中提示**，顯示目前使用的工具（預設關閉）。權限提示不會自動消失。氣泡有優先順序：權限最優先，其次是 Agent 提示、Presentation MCP 發言、工作中提示與插件通知。
- **反應** — 狀態變化時的彈跳與等待權限時的晃動（**彈跳與晃動**，預設開啟），另有裝飾性的**待機小動作**（預設關閉）。使用 Presentation MCP 的 Agent 與插件也能觸發 `happy`、`curious`、`thinking`、`surprised`、`encouraging` 五種反應。
- **心情與成長** — 見[成長](#成長)。
- **Mini 模式** — 縮成 96 px 的精簡寵物並顯示狀態圖示。**邊緣收合**（獨立設定，預設關閉）：把寵物拖到螢幕左、右或上緣並停留約 650 毫秒，會收成液態玻璃把手；點擊或滑過即可展開。有待處理的權限請求時一律回到完整寵物。位置會在顯示器與 DPI 變更後還原。
- **Shimeji 行為**（預設關閉）— 低頻率的閒置走動、睡覺與游標反應，限制在目前螢幕內。工作中、權限提示、勿擾、減少動態、背景與省電時會暫停。
- **多寵物**（預設關閉）— 當有 2 個以上工具家族同時作用，每個家族顯示一隻小寵物，並可各自選擇寵物。
- **專案寵物** — 在**設定 → 寵物**把專案資料夾綁定到專屬寵物。專案識別使用加鹽的本機雜湊，不儲存完整路徑。
- **自訂寵物** — 見下方。

### 自訂寵物

在**設定 → 寵物**使用 **+ 匯入素材**（`.webp`、`.png` 或 `.jpg` 精靈圖）或 **+ 匯入 .zip**（`.codex-pet.zip` 套件，例如來自 [codex-pets.net](https://codex-pets.net)，直接讀取，不必先解壓縮）。匯入 .zip 時會先顯示預覽（待命動畫、每列第一格、圖集版本、單格尺寸與注意事項），確認後才安裝。圖集版本依圖片判定：9 列為 v1、11 列為 v2；v2 素材不需 `behaviorManifest` 就會以第 1 列（running-right）走路，第 9–10 列是視線方向列，所以除非素材另有宣告，睡覺仍沿用待命動畫。寵物 ID 已存在時可選擇**取代**或**保留兩者**（另存為 `<id>-2`），不會在未告知下覆蓋；安裝中斷也不會留下寫到一半的資料夾。寵物可重新命名（鉛筆圖示）與移除（內建寵物只會被隱藏；預設的 `aang-airbender` 無法移除）。匯入的寵物存放在 `~/.desktop-pet/custom/`。

精靈圖規格（匯入時檢查）：

- 單格 **192 × 208 px**；圖片寬高必須是該尺寸的整數倍，且**至少 9 列**（第 0–8 列）。格子尺寸、列號與預設節奏只定義在 [`src/types/pet-atlas.ts`](src/types/pet-atlas.ts)，匯入驗證與畫面端共用。
- 預設列：0 idle（閒置／離線）、3 waving、4 jumping（成功）、5 failed（錯誤）、6 waiting（等待權限／等待輸入）、7 running 與 8 review（思考／執行工具）。
- `pet.json`（或插件外觀）可宣告 `behaviorManifest` 覆蓋任何動作——`idle`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`——並加上 Shimeji 用的 `walk` 與 `sleep`，例如 `{"behaviorManifest":{"idle":{"row":9,"frames":4},"walk":{"row":1},"sleep":{"row":5}}}`。每一項是 `row`（0–63）、可選的 `frames`（1–16）與 `frameDurations`（1–16 個值，夾在 60–3000 毫秒）。格式不合法、列號超過圖的列數或格數超過欄數的項目會被丟掉，該動作改用內建值；沒宣告的 `walk`／`sleep` 會回到閒置。

## 控制面板

點擊寵物或從系統匣開啟。標題列顯示寵物、等級與執行中／需處理的工作階段數，並由左至右提供 **⋮ 選單**（勿擾模式、保持開啟，以及可在跟隨系統／淺色／深色間循環的外觀快速切換；勿擾開啟時按鈕上會有小圓點）、設定（`Cmd/Ctrl+,`）與關閉。**Esc** 會一層層返回，最後隱藏面板。拖曳任一邊緣即可調整面板大小（最小 360×420，最大可到全螢幕），所有畫面共用同一個大小並會被記住；**設定 → 通用 → 重設面板大小**可回到預設。

- **Sessions** — 分成**需要處理**、**進行中**與**閒置與已完成**三組。可依全部／需要處理／進行中與工具篩選，並依緊急程度或最近時間排序。進行中的狀態會顯示經過時間；展開一列可看到路徑、工具、最後出現時間與 Session ID，以及「回到工作階段」動作：**顯示專案資料夾**（在 Finder／檔案總管中選取，不會開啟）、**複製專案路徑**，macOS 另有**切換到**該工作階段所在的終端機或 IDE（只會把 App 帶到最前面，不會指定視窗或分頁）。**清除離線項目**會把已結束的工作階段從畫面移除；超過 15 分鐘沒有訊號的工作階段會被視為過期。本機埠被占用時會顯示橫幅與**立即重試**。
- **額度** — Codex 與 Claude Code 訂閱的剩餘額度（工作階段與每週視窗，重置時間以本地時間顯示）。Agent Pets 沒有帳號系統，也不會要求 Agent 的帳密：它沿用 CLI 在本機的登入狀態，由主行程向供應商查詢，只把百分比傳給介面。若 CLI 登入遺失或過期，請在該 CLI 重新登入。面板開啟時每 2 分鐘更新一次（**立即更新**有頻率限制）；更新失敗時仍保留最後一次成功的數值。該工具作用中時，寵物的狀態膠囊也會嵌入一條細額度條。供應商額度下方的**目前 5 小時區塊**是依本機紀錄算出的區塊（從休息滿 5 小時後的第一筆用量開始、向下取整到整點，持續 5 小時）：顯示目前 Token、已過與剩餘時間，以及每分鐘 Token。這是本機推算的時段，不是供應商自己的額度。
- **歷史** — 顯示 **7、30 或 90 天**的完成／失敗工作階段、作業時間、Token 用量（新輸入加輸出，快取另列）、Agent 分布與各模型明細，可依專案篩選。**匯出 JSON** 或**匯出 CSV** 會把已去識別的每日摘要寫到你選擇的檔案。**清除歷史**只清除歷史與額度快照，不會動到 XP、等級或成就。歷史資料來自 hook 事件，加上對本機 Codex／Claude Code 工作階段紀錄的唯讀掃描；不儲存提示詞、工具參數與完整路徑。很長的紀錄會分幾次掃描讀完，不會因為檔案太大而略過。原始事件保留 90 天，每日彙總則長期保留。
- **歷史 → 工作階段** — 依最後活動時間由新到舊列出過去的工作階段（按**載入更多**看更早的）：結果（完成、失敗、已取消、進行中、未完成）、Agent、專案、時長、工具執行次數、權限等待、Token 與主要模型。沿用上方的天數與專案篩選，另可依 Agent、結果、自訂日期篩選，或搜尋專案與 Agent 名稱。點選工作階段可看時間軸：每次狀態變化的時間與工具名稱（最近 500 筆）。只保存中繼資料：不含提示詞、對話內容或工具參數，專案也只記資料夾名稱。此功能加入前記錄的工作階段沒有工具統計與時間軸。JSON 匯出會附上這份清單，但不含專案名稱。

- **插件分頁** — 每個有內容可顯示的已啟用插件會在「歷史」之後多一個分頁（僅在插件功能開啟，且該插件已安裝、已啟用、沒有當機時才出現；只提供寵物造型的插件沒有分頁）。分頁顯示插件名稱、圖示與未讀徽章；插件很多時分頁列可左右捲動（滾輪、觸控板、‹ › 按鈕、方向鍵）。有面板頁的插件會把面板嵌在分頁內；其餘插件只顯示它提供的內容：面板主題（選擇用於淺色、深色或兩種模式，含預覽與自訂背景圖，下方接著「我的主題」與主題編輯器）、指令、最近通知（只有能發通知的插件才有），以及到設定與詳情的連結。下次開啟會記住上次使用的分頁。

### 成長

位於**設定 → 寵物 → 成長**：XP、等級、進化階段與連續天數、近期 XP 與成就。

- XP 只在主行程發放且具冪等性：每完成一個工作階段 +20、每個本地日的第一次完成 +10、每 30 分鐘的作業時間 +2（每個工作階段最多 +10）、連續使用每多一天 +5。失敗或取消的工作不給 XP。
- **心情**每天從 10 開始：成功 +4、錯誤 −6，另有工具數與長時間工作的上限加成。**重設今日心情**會回到 10；**心情視覺效果**可關閉光環而不停止計算。
- 共 14 個成就（其中一個隱藏），可依全部／進行中／已解鎖篩選。每個寵物的解鎖只記錄一次，並以系統通知提示。Token 成就計入 Codex 與 Claude Code 本機紀錄的精確用量（每則訊息只算一次，與歷史一樣由所有寵物共用），以及其他 Agent 事件回報的用量。關閉成就只會停止新的解鎖。

## 設定

從面板標題列或寵物右鍵選單開啟。設定分成五組，頂端有**搜尋**，可直接跳到對應設定：

| 群組 | 內容 |
|------|------|
| 通用 | 語言（繁體中文／English）、**外觀主題**（面板：跟隨系統／淺色／深色；寵物：預設深色、淺色或跟隨面板，可分開設定，例如深色系統搭配淺色寵物）、**面板主題**（各模式使用的主題、**自訂…**、**恢復內建外觀**）、**我的主題**、寵物大小、重設面板大小、彈跳與晃動、狀態泡泡、待機小動作、工作中提示 |
| 寵物 | 寵物庫與匯入、多寵物、專案寵物、成長（心情、XP、成就） |
| 桌面 | 通知、勿擾、音效；Mini 模式、邊緣收合、Shimeji、擷取排除、全螢幕自動隱藏、完成標記、右鍵隱藏、回到工作階段、權限氣泡、從寵物回覆 Claude Code 權限、Presentation MCP、開機啟動（打包版）、權限紀錄 |
| 進階 | 設定精靈、專案 MCP、診斷、重新啟動、離開 |
| 插件 | 安裝、啟用、權限、更新與插件通知（日常使用在主畫面的插件分頁） |

- **勿擾**會靜音系統通知、音效、額外動態與非必要氣泡，但不會停止事件接收。限時選項在系統匣選單：30 分鐘、1 小時、到明天 9:00，或直到手動關閉（限時勿擾最長 7 天）。結束時會有摘要通知，告知期間靜音了幾則提醒。
- **通知**（預設開啟）涵蓋等待權限、等待輸入、完成與錯誤，每個工作階段有冷卻時間，結束類事件會合併。在 macOS 上，點擊只關於一個工作階段的等待權限或等待輸入通知，會切換到該工作階段的 App；其他通知則開啟 Sessions。**音效**（預設關閉）播放簡短的合成提示音，可分別開關各事件並調整音量。
- **回到工作階段**（預設開啟）控制上述動作；**切換到 App**（macOS，預設開啟）有獨立開關。切換使用 `open -b`（LaunchServices），不需要「自動化」或「輔助使用」權限。只能啟用固定清單中的終端機、IDE 與 Claude App，而且一定要你點擊；Windows 暫不提供。
- **擷取排除**只讓寵物視窗不出現在支援的截圖與錄影中（Windows 使用系統 API；macOS 為盡力而為）。**全螢幕自動隱藏**讓寵物避開其他 App 的 macOS 全螢幕 Space 或 Windows 無邊框全螢幕視窗；原生執行環境無法使用時會安全地停用。

## 權限氣泡

Agent 要求權限時，寵物上會出現液態玻璃氣泡，面板內也會顯示同一張卡片。卡片會顯示發出請求的工具與專案、將執行的內容（已遮蔽，可展開與複製）與倒數計時。請求會在短暫的 TTL（最長 5 分鐘）後逾時，並通知 Agent 已取消。

- **風險** — 只有唯讀工具（`read`、`glob`、`grep`、`list`）屬於低風險；OpenCode 的其他所有工具，包含未知與 MCP 包裝的工具，一律視為高風險。Claude Code 的 `Write`／`Edit`／`MultiEdit`／`NotebookEdit` 只有在檔案位於專案資料夾內（解析符號連結後也是），且不在 `.git`、`.claude`、`.husky`、`.vscode`、`.idea`、`.devcontainer`、`node_modules/.bin` 之下，也不是 `.zshrc`、`.envrc`、`.npmrc` 這類 shell 啟動檔或工具設定檔時才是中風險，並顯示相對於專案的路徑；其他編輯、`Bash`、`WebFetch`、`WebSearch` 為高風險，MCP 與其他工具為未知。網路類工具會標示會連到網路。高風險或未知且內容被截斷的請求，在這裡只能拒絕，要允許請回到 Agent 本身。
- **遮蔽** — API 金鑰與權杖、`Authorization` 值、`password=` 這類參數、URL 內的帳密與私鑰都會變成 `[redacted]`，家目錄則改寫成 `~`。
- **快捷鍵** — 只有在最上層請求符合條件（低或中風險）時才註冊全域快捷鍵：macOS 為 **Cmd+Shift+Y** 允許一次、**Cmd+Shift+N** 拒絕；Windows 為 **Ctrl+Shift+Y**、**Ctrl+Shift+N**。若按鍵被其他 App 占用，氣泡會說明，按鈕仍可使用。氣泡本身：**N** 或 **Esc** 拒絕；低風險按 **Y** 即允許一次，其他風險需按住 **Y** 0.6 秒。
- **佇列** — 多個待處理請求會以可展開的清單顯示；**全部拒絕**需要再按一次確認。
- 對無法在此回覆的 Agent（Codex，以及未開啟下列選項時的 Claude Code），氣泡只是提醒，請回到該工具處理。只提供「允許一次」與「拒絕」，刻意不提供永久核准。
- **Claude Code**（預設關閉）— 在**設定 → 桌面 → 權限請求**開啟**從寵物回覆 Claude Code 權限**。之後 Claude Code 的 `PermissionRequest` hook 會在**等待秒數**內（預設 90 秒，可設 15–120 秒）等你回覆，終端機裡 Claude Code 自己的權限對話框同時保留，先回覆的一方生效，寵物卡片也會提示可在終端機回覆。一次點擊只回覆一個工具呼叫：若另一個工具呼叫正在等待完全相同的請求（例如兩個 subagent 執行同一個指令），第二個只能在終端機回覆。泡泡會在該工具執行完、Claude 開始下一個工具呼叫或權限詢問、回合結束或送出新提示，或等待逾時時撤下。由於終端機可能先回覆，權限紀錄會把 Claude Code 的決定標示為「終端機可能已先回覆」。寵物沒開、選項關閉、等待逾時或發生任何錯誤時，hook 不輸出任何內容，Claude Code 照原本流程進行（非互動的 `-p` 執行則照常拒絕）。你自己的 deny 規則仍優先於寵物的允許。拒絕時 Claude 只會收到固定文字 `Denied in Agent Pets. (已在 Agent Pets 拒絕)`。若其他工具也註冊了 `PermissionRequest` hook，會與我們並行執行，以哪一方的回覆為準由 Claude Code 決定。
- **權限氣泡**可在設定中關閉；關閉後待處理請求仍由 broker 保管並顯示在系統匣標記上。**設定 → 桌面**也會列出最近的決定紀錄（只含時間、工具、來源與結果）。

## 插件

插件可以新增寵物通知與反應、面板頁面、系統匣指令、徽章、寵物造型、面板主題（淺色與深色的顏色、字型、背景，以及寵物狀態列）與狀態列。它們在沙盒中執行，沒有 Node.js、檔案系統或 shell 權限，網路只限於你核准的 HTTPS 主機。

**設定 → 插件**有四個分頁：**已安裝**（啟用、更新、設定、詳情）、**探索**（選擇啟用的線上目錄，含簽章檢查與更新）、**通知**（插件訊息收件匣，可個別靜音）與**進階**（開發者模式、資源限制、診斷）。安裝時會顯示依風險分組的權限清單；新增的高風險權限或變更的簽章金鑰必須明確確認。插件安裝後預設停用，需要由你自己開啟。插件的面板主題在該插件的儀表板分頁選用（詳情頁的**面板主題**也可以）；**設定 → 通用 → 外觀**會顯示各模式目前的主題，**開啟插件設定**會跳到該分頁，並永遠提供**恢復內建外觀**。主題會套用到整個 App，包含對話框、權限提示，以及寵物的泡泡與狀態列；每個主題都會先檢查，確保文字在每個表面上（也包含疊在全黑與全白桌面上時）都清楚可讀，危險、成功、警告與資訊色也維持原本的意義。插件頁面與 Worker 可透過 `--ap-*` token 與 `api.theme` 跟著目前主題與淺色／深色模式變化，不需要權限。插件作者請見 [1.12 新功能](docs/plugins/whats-new-1.12.zh-TW.md)。

**我的主題**（不需要插件）：**設定 → 通用 → 外觀 → 自訂…**、「我的主題」的**新增主題…**，或主題插件分頁中的同一份清單，都會開啟主題編輯器。可以從內建外觀、中性灰的空白、任何已安裝的插件主題或自己的其他主題開始，淺色與深色分開編輯：每個顏色（文字、表面、強調色、邊框、危險／成功／警告／資訊、遮罩／陰影／高光，以及寵物狀態列）都有取色器、可輸入 `#hex`、`rgb()`、`hsl()` 或 `oklch()` 的欄位、OKLCH 微調，以及說明用在哪裡的提示。**由顏色產生**會用一個種子色產生完整的淺色與深色色盤；**由背景圖產生**會用圖片的主要顏色。背景可以是純色、線性或放射漸層，或自己的圖片（遮罩、填滿方式、位置、模糊）；字型從系統字型組合中選，另外可調文字大小與圓角。即時預覽同時顯示兩個模式（卡片、按鈕、選單、通知、對話框、含風險徽章的權限卡、寵物狀態列）。編輯時會跑與插件主題相同的檢查：問題直接標在該顏色上，列出不夠清楚的組合、實測與需要的對比，並提供**使用建議值**；全部通過前不能儲存或使用。另有復原、重設、未儲存提醒，以及 JSON 匯出／匯入（只有顏色與設定，不含圖片）。最多保存 50 個主題，位置在 `userData/panel-themes-user/`；刪除正在使用的主題時，該模式會回到內建外觀。

要開發插件，請閱讀[插件開發者手冊](docs/plugins/README.zh-TW.md)。

## 專案 MCP 與 Presentation MCP

**Presentation MCP** 是本機 stdio 橋接程式 `~/.desktop-pet/presentation-mcp.mjs`，讓支援 MCP 的 Agent 讓寵物說話或做出反應。它只提供三個工具：`pet_status`（唯讀）、`pet_react`（五種有界反應）與 `pet_say`（最多 240 字元，顯示 1–15 秒）。每個用戶端每 10 秒最多 3 次請求。它不能執行指令、存取檔案、回覆權限或改變 XP，勿擾與權限／錯誤狀態永遠優先。可在設定 → 桌面關閉。

**為專案設定 MCP**（設定 → 進階）分兩步把橋接程式註冊到專案，所以在你檢視前不會寫入任何東西：

1. 選擇專案資料夾。檢視畫面會列出每個工具、將建立或修改的確切檔案、Git 是否已追蹤，以及項目預覽。只會寫入已勾選的工具：Codex `.codex/config.toml`、Claude Code `.mcp.json`、OpenCode `opencode.json`。
2. **僅限本機**（在 Git 儲存庫中預設開啟）會把新檔案加入 `.git/info/exclude`，因為項目內含你這台電腦上的 Node.js 與橋接程式絕對路徑，對同事沒有意義。含註解（JSONC）、JSON 無效，或已有不同 `agent-pets` 項目的檔案絕不改寫，結果頁會改給可複製的片段。

面板會保留已設定的專案清單，狀態為已連接、部分連接、有衝突、路徑已過期或找不到資料夾；**更新路徑**可在 App 搬移或 Node 升級後修復項目，**移除 MCP** 只移除相符的項目。設定後，Claude Code 請在 `/mcp` 核准 `agent-pets`，Codex 需先信任該專案，OpenCode 請重新啟動。橋接程式需要真正的 Node.js 執行檔，且 Agent Pets 必須在執行中；若要全域註冊，可用 `codex mcp add agent-pets -- node ~/.desktop-pet/presentation-mcp.mjs` 或 `claude mcp add --scope user agent-pets -- node ~/.desktop-pet/presentation-mcp.mjs`。

## 事件伺服器

Hook 會附上每次安裝專屬的 `X-Agent-Pets-Token` 標頭（讀自 `~/.desktop-pet/event-token`），把狀態送到 `http://127.0.0.1:17373/v1/events`。每個 hook 最多花 1.5 秒把事件送出、再等 0.25 秒回應；寵物沒開時會立刻結束，不會拖慢 agent。寵物還在啟動時（開始收事件前會留著 `~/.desktop-pet/event-port-17373.starting`），被拒絕的事件會重試最多 5 秒，不會遺失（見 [docs/dev/hook-delivery.md](docs/dev/hook-delivery.md)）。

```json
{ "source": "codex", "sessionId": "sess_abc123", "state": "thinking", "timestamp": 1735689600000 }
```

`source`、`sessionId`、`state`、`timestamp` 為必填（缺欄位回 `400`，權杖錯誤回 `401`）。選填：`project`、`originalEvent`、`toolName`。

- `source`：`opencode-cli`、`opencode-desktop`、`codex`、`codex-desktop`、`claude`、`claude-desktop`（`opencode` 會正規化為 `opencode-cli`）
- `state`：`idle`、`thinking`、`tool-running`、`waiting-permission`、`waiting-input`、`success`、`error`、`offline`（`waiting` 會正規化為 `waiting-permission`）

## 診斷與紀錄

**設定 → 進階 → 匯出診斷資訊**會把 JSON 報告存到你指定的位置，內容包含版本、系統資訊、本機伺服器與插件主機狀態、計數器與近期紀錄。權杖、提示詞與個人路徑都已移除，也不會上傳。若上一次執行不正常結束，App 會建議你匯出。

主行程紀錄是 App userData 資料夾內的 `logs/main.log`（macOS 為 `~/Library/Application Support/Agent Pets/`，Windows 為 `%APPDATA%\Agent Pets\`），超過 1 MB 即輪替、保留 3 個檔案，寫入時就已遮蔽敏感內容。插件診斷在各插件的**診斷**分頁。

## 隱私與安全

- 所有資料都留在你的電腦：歷史、XP、成就、紀錄與權杖都不會上傳。
- Renderer 以沙盒、context isolation、無 Node.js、嚴格 CSP 與驗證過的 IPC 來源執行；Electron fuses 停用 RunAsNode 並強制只從 ASAR 載入。
- 事件、權限與 Presentation MCP 伺服器只監聽 `127.0.0.1`（埠 17373–17375），使用各自獨立的安裝權杖，拒絕瀏覽器發起的請求並限制輸入速率；埠被占用時會退避重試。
- 權限回應走獨立的埠與權杖，具備 TTL、一次性決定、防重放與已遮蔽的稽核紀錄。
- 通知文字只包含 Agent 名稱與專案資料夾名稱，絕不含提示詞、工具參數或工作階段 ID。
- Hook 只從少數環境變數判斷所在 App（`TERM_PROGRAM`、macOS bundle id、Claude Code 的 entrypoint，以及 Windows Terminal／VS Code／Cursor 標記）。完整專案路徑與 bundle id 只留在主行程。**顯示專案資料夾**只會在檔案管理員中選取既有的資料夾（不是檔案，也不會開啟它，因此不會啟動任何 App 或文件套件）；**複製專案路徑**會拒絕含 shell 特殊字元的路徑。
- 額度請求只由主行程連到確切的 Codex 與 Anthropic HTTPS 端點；OAuth 憑證不會進入 renderer。
- 紀錄讀取器為唯讀、有大小上限，且只限已知的 Codex／Claude 工作階段目錄；匯入寵物 Zip 時會先掃描封存（項目數、總大小、壓縮比、重疊項目、符號連結、不安全或非 UTF-8 檔名、重複路徑），解碼前依檔頭限制圖片尺寸，移除 `pet.json` 的原型鍵，並經由私有暫存資料夾以原子性 rename 安裝。
- 插件在沙盒中執行並受權限控管；機密資料以系統安全儲存區加密保存，絕不回傳給介面。

## 疑難排解

| 症狀 | 檢查項目 |
|------|----------|
| 寵物一直顯示離線 | 按**等待真實事件**並執行一個提示詞。沒有事件：重新啟動工具（hook 在啟動時載入），再按**診斷**。 |
| 診斷：找不到 Node.js 執行檔 | 安裝 Node.js 18 以上，然後按**修復**；它會寫入絕對路徑（從 Finder 或 Dock 啟動的 App 找不到單純的 `node`）。切換 nvm 版本後也需要**修復**。 |
| Codex hooks 未啟用 | **修復**會在 `~/.codex/config.toml` 的 `[features]` 加入 `hooks = true`。 |
| 安裝被拒：不是有效的 JSON | `settings.json`／`hooks.json` 含註解或語法錯誤。Agent Pets 不會動它；請修正或移開該檔案後再安裝。 |
| 橫幅：事件接收器離線 | 本機埠（17373–17375）被其他程式或舊的 Agent Pets 占用。關閉它；App 會自動重試，也可按**立即重試**。 |
| Hook 腳本過期 | **修復**會重新部署。 |
| Claude Code 看不到專案 MCP | 在 `/mcp` 核准 `agent-pets`。Codex 需要先信任該專案。 |
| 寵物凍結或空白 | 使用系統匣（進階）的**重新載入寵物**，或設定 → 進階的**重新啟動寵物**。 |
| macOS：**開機時啟動**一直顯示需核准 | 到「系統設定 → 一般 → 登入項目」核准 Agent Pets（設定頁有按鈕可直接開啟）。請先把 App 移到「應用程式」資料夾；從磁碟映像或下載資料夾執行時無法註冊登入項目。 |
| Windows：按**重新啟動**後程式關閉卻沒有再開 | 免安裝版已修正，會重新啟動原本的 `.exe`，而不是暫時解壓縮的資料夾。若仍失敗，請手動再開啟 `.exe`。 |
| 回報問題 | 匯出診斷並附上檔案。 |

## 開發

需要 Node.js 22.12+ 與 pnpm 12（由 `packageManager` 鎖定）。

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
pnpm dev
```

| 指令 | 用途 |
|------|------|
| `pnpm dev` / `pnpm dev:safe` | Vite + Electron 開發模式；Windows GPU 程序當機時，`dev:safe` 改用軟體算圖 |
| `pnpm test:unit` / `pnpm test:unit:watch` | `tests/` 內的 Node 內建測試（不會啟動 Electron） |
| `pnpm test:coverage` | 單元測試，並對主行程模組設定 85% 行覆蓋率下限 |
| `pnpm lint` | 主行程守門（未處理的 `loadURL`、全域錯誤處理） |
| `pnpm exec vue-tsc --noEmit` | 型別檢查 |
| `pnpm check:bundle-size` | 任一 renderer chunk 超過 250 KB 即失敗（需先 `vite build`） |
| `pnpm check:bundle` | 驗證插件面板 tokens 的 bundle |
| `pnpm check:contrast` | 設計 token 對比度檢查（違規即失敗） |
| `pnpm check:design` / `check:design:strict` | 回報寫死的顏色、尺寸、間距、transition 時長與 easing；`--strict` 會直接失敗（見 [docs/dev/design-tokens.md](docs/dev/design-tokens.md)） |
| `pnpm build` / `pnpm build:fast` | 型別檢查、Vite 建置，再由 electron-builder 輸出到 `release/`（`build:fast` 不壓縮） |
| `pnpm bench`、`pnpm bench:lag` | 效能基準測試 |

兩個建置指令都會先關閉本專案的 Agent Pets 程序。若想在真實 Electron App 中驗證修改又不動到你的資料，先執行 `pnpm exec vite build`，再執行 `node scripts/e2e-isolated-electron.mjs`（暫時的 home 與 userData、假的 `safeStorage`，所以不會碰到 macOS 鑰匙圈；本機埠預設為 27373–27375，已安裝的版本可保有 17373–17375，`--hook-port-base` 可改用另一組，`--real-hook-ports` 才用預設埠，`--reuse-root` 沿用上一次的 home 重新啟動，供冷啟動測試使用；見 [docs/dev/e2e-without-keychain.md](docs/dev/e2e-without-keychain.md)）。

**開發埠覆寫** — 未打包的執行可設定 `AGENT_PETS_EVENT_PORT`、`AGENT_PETS_PERMISSION_PORT`、`AGENT_PETS_PRESENTATION_PORT`（1024–65535；預設 17373、17374、17375），避免和已安裝的版本搶埠。打包版會忽略這些變數。

**Agent 狀態** — 依狀態而定的資料都集中在兩張以 `satisfies Record<AgentState, …>` 檢查的表：`src/types/agent.ts` 的 `AGENT_STATE_POLICY`（優先度、桌面通知、歷史結局，主行程共用）與 `src/utils/agent-state-presentation.ts` 的 `AGENT_STATE_PRESENTATION`（標籤、顏色、螢幕閱讀器文字、狀態列用字、迷你徽章、音效）。新增狀態時兩張表沒填齊，型別檢查就會失敗。唯一的例外是每個狀態對應的寵物動作：它要看前一個狀態與時間，所以留在 `src/utils/pet-motion-plan.ts` 用邏輯判斷。

**Agent 來源** — 6 個事件來源（`claude`、`codex-desktop` 等）與 3 個工具家族（Codex、Claude、OpenCode）只在 `src/types/agent.ts` 列一次：`AGENT_SOURCE_REGISTRY`（名稱、家族、CLI 或 Desktop）與 `AGENT_FAMILY_REGISTRY`（家族名稱、adapter id、有沒有訂閱額度、本機 token 紀錄）。來源名稱、狀態列的家族順序、每家族的寵物、quota 條、通知上的名稱、adapter 的來源清單，以及主行程的白名單（事件來源、權限來源、插件不能用的名稱）都由這兩張表推導。hook 腳本與安裝程式（`integrations/`、`electron/setup.ts`、`electron/hook-config.ts`）仍各自寫著來源字串。新增來源前先看 [docs/dev/agent-sources.md](docs/dev/agent-sources.md)。

**音效** — 哪個狀態播哪個 cue，由 `AGENT_STATE_PRESENTATION` 的 `cue` 欄位決定。其餘跟音效有關的資料都在 `src/types/sound.ts`，以 `satisfies Record<SoundCue, …>` 檢查並深層凍結。表裡有每個 cue 的音形（頻率、時間、增益、波形）、對應的開關和試聽按鈕，也有共用的包絡、同一個 cue 3 秒內只播一次的節流、任務至少跑 15 秒完成時才出聲的門檻、0–100 的音量範圍，以及主行程也會用到的持久化預設值。`src/utils/sound.ts` 只負責排程 Web Audio 節點；`src/utils/sound-policy.ts` 只判斷能不能播，條件是音效開著、沒開勿擾、寵物看得到，而且這個 cue 自己的開關也開著。`tests/sound-registry.test.mts` 會比對每個狀態排程出去的聲音，確認跟改成 registry 之前完全相同；見 [docs/dev/sound-registry.md](docs/dev/sound-registry.md)。

在原始碼目錄執行 `node integrations/install.mjs` 可用與精靈相同的保護機制安裝 hook（`--claude-code` 只處理 Claude Code，`--uninstall` 則移除）。

**CI** — `ci.yml` 在 pull request 與 `main` 推送涉及文件以外的變更時執行：型別檢查、`pnpm lint`、`pnpm test:coverage`、`vite build`、bundle 大小、插件面板 bundle 與對比度檢查、設計 token 報告，以及不阻擋合併的相依套件稽核。`ci-platforms.yml` 每週與手動觸發時，在 macOS 與 Windows 上執行型別檢查與單元測試。

## 版本與發佈

在 `package.json` 提高 `version`（預設升 patch；永久資料結構、公開契約或安全邊界的變更才升 minor）。該 commit 進入 `main` 且尚無 `v<version>` tag 時，`.github/workflows/release.yml` 會執行型別檢查與單元測試，建置 macOS arm64 與 x64 的 `.dmg` 及 Windows 可攜版 `.exe`，再建立 tag 與附自動產生說明的 GitHub Release。也可從 Actions 頁面重新執行，已有 tag 的版本會被略過。兩個 macOS job 各在同架構的 runner 上建置（x64 用 Intel），原生模組才會是對的架構；electron-builder 在寫入 fuses 之後對整個 bundle 做 ad-hoc 簽章（`mac.identity: "-"`，沒有憑證、沒有公證）。接著 `scripts/check-mac-bundle.mjs` 掛載 dmg 檢查：`codesign --verify --deep --strict` 要通過、fuses 要等於 `build.electronFuses`、每個 Mach-O 與 `*.node` 都要是目標架構，任何一項不符就讓發版失敗。release job 會把 `SHA256SUMS.txt` 跟安裝檔一起上傳。electron-builder 從 GitHub releases 下載 Electron 或工具失敗時，會改經 `scripts/release-asset-mirror.mjs` 再試兩次：它只聽 127.0.0.1，經 GitHub API 下載同一個 release 檔案，checksum 仍由 electron-builder 驗證。

## 授權

MIT，見 [LICENSE](LICENSE)。額度整合參考 MIT 授權的 [TokenBar](https://github.com/Nanako0129/TokenBar)，見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
