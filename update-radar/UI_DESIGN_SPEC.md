# Update Radar UI 設計規格：頁籤、總覽與收合

狀態：已確認，交由 Luna 依 Phase 逐一實作（一次只做一個 Phase）
適用範圍：`update-radar/plugin/ui/`（`index.html`、`panel.css`、`panel.js`）與 `tests/update-radar-plugin.test.mts`
基準：分支 `radar/copy-polish` 的 `c6135bc`。先前未提交的修改已分類 commit：`686424b`（文案精簡）、`c6135bc`（設計稿樣式）。插件目前版本是 `0.2.4`。

### 使用者決策（2026-11-04）

| 項目 | 決策 |
|---|---|
| Codex 歷史紀錄 | 暫不實作，不修改 worker 或資料格式 |
| 視覺風格 | 同意減少漸層、發光與彩色統計卡，但**留到 Phase 5**。Phase 1–4 只做資訊架構，沿用現有樣式；新增元素用中性、克制的樣式，不加新裝飾 |
| 預設頁籤 | 每次重新開啟面板都落在總覽；同一次開啟期間切換頁籤，保留搜尋與捲動狀態 |
| 需留意篩選 | 新增。總覽的需留意數字與警示列可以直接導向更新動態並啟用這個篩選 |
| 版本 | 全部 Phase 完成後再依版本規範評估（見 §7） |
| 渲染 | 不得為了保留頁籤狀態讓所有頁面持續渲染（見 §2.0） |
| 資料快取 | 與頁籤生命週期分離，切換頁籤不重複抓資料（見 §2.0） |
| 警示 | 重要警示與資料來源錯誤在未展開狀態下必須可見 |
| 423×535 | 總覽不捲動即可看到核心摘要（硬性驗收，見 V1） |
| 重用 | 優先重用現有函式與 class，不引入新的 UI 依賴（見 §2.4） |
| 節奏 | 每個 Phase 完成都要驗證，再由使用者確認下一個 Phase |

> 分析方法：本機沒有安裝 Impeccable skill，這份規格依它的做法人工執行：先盤點介面與資料，再找出 AI dashboard 常見問題，接著處理資訊層級，最後定出可驗收的規格。資料與行為都已對照程式碼確認，行號以撰寫當下為準。

---

## 0. 前提與限制（實作前必讀）

### 0.1 技術前提

- Update Radar 面板是**沙箱內的 vanilla JS／CSS 頁面**，不是 Vue 元件。主程式（Vue／Electron）只提供外框與 `window.agentPetsPlugin` API。所以本規格的「元件」指 `panel.js` 內的 render 函式與 `panel.css` class，不新增框架。
- 唯一捲動容器是 `document`。插件區尺寸：
  - 一般：約 408–423 × 535 px。
  - 放大：約 925–940 × 728 px。
  - 最窄：278 px。
- 資料只有一個來源：worker 透過 `radar:state` 推送的 `state.radar`，面板啟動時另讀 `storage.get('radar-state')`。面板不會自己抓資料，所以**切換頁籤不得觸發 `postMessage`**。
- 訊息上限 256 KB，資料欄位不可增加。

### 0.2 資料事實（影響規格的部分）

| 項目 | 實際可用資料 | 對規格的影響 |
|---|---|---|
| Codex 重設 | `latestReset { id, resetType, announcedAt, text(≤280), sourceUrl? }`、`scheduledReset { at } \| null`、`stats { total, lastResetAt }` | **沒有歷史紀錄**。需求中的「歷史紀錄」無法在不改資料來源的前提下實作，本規格不做，也不顯示空區塊。`latestReset.text`（公告內文）目前沒有顯示，可作為「公告」收合內容。 |
| 更新 | `updates[]`：`id, sourceId, provider, category, changeType, title, summary, version, previousVersion, publishedAt(Time), subjects, retirements, postKind…` | 「重要程度」沿用既有 `unitNeedsAttention()`／`attentionSignal()`，不新增分級演算法。 |
| 來源 | `sources[]`：7 個，`status ∈ idle/loading/ok/stale/error`、`itemCount`、`fetchedAt`、`nextAttemptAt` | 錯誤與重試按鈕必須保留。 |
| 卡片單位 | `updateUnits()`：同一個 Claude Code 版本或同一天的 Platform 合併為一張 | 總覽的數字與「重要更新」都以卡片單位計算。 |

### 0.3 不可改動

- worker（`dist/`）、`plugin.json`、權限、版本號、storage key `radar-state`／`panel-theme`、訊息格式。
- `groupUpdates`、`matchesFilters`、`updateUnits`、`unitNeedsAttention` 的判斷邏輯。可以新增**純函式**組合它們，但不能改它們的結果。
- 外部連結一律走 `links.openExternal()`，保留真實點擊驗證與狀態回饋（開啟中、已在瀏覽器開啟、錯誤）。

---

## 1. 現有資訊架構問題

| # | 問題 | 證據 | 嚴重度 |
|---|---|---|---|
| P1 | **所有功能堆在同一頁**：開啟後先看到 Codex 重設、三張統計、26 週熱度圖、來源狀態，第一張更新卡在 423×900 的 y≈966 才出現。一般面板高度只有 535 px，要捲兩屏以上才看到更新。 | `measure.mjs`：narrow `firstCardTop` 966 | 高 |
| P2 | **總覽與明細混在一起**：Codex 重設的完整明細（三列事實、公告按鈕、資料來源）放在首屏，它其實只需要一行狀態。 | `renderSpotlight()` | 高 |
| P3 | **熱度圖位置錯誤**：它的實際功能是「依日期篩選更新」（`selectDay` → `scrollToUpdates`），卻放在側欄，點了以後要跳捲到下方。 | `panel.js` 的 `selectDay` | 中 |
| P4 | **同一張卡內有多層收合**：官方卡同時有「展開重點」（details）和「展開全文」（button），版本卡則有「展開全部 N 項」加上詳情頁。使用者分不清哪個按鈕展開什麼。 | `appendQuickRead`、`appendExpandToggle`、`renderChangeGroup` | 中 |
| P5 | **收合語意不一致**：有的用 `<details>`，有的用 button 加 `aria-expanded`，來源狀態用 details，篩選面板用 hidden 加 aria-expanded。 | 共 4 種寫法 | 中 |
| P6 | **重要警示可能被藏起來**：來源讀取失敗只在收合的「來源狀態」內顯示（摘要列只有 `6/7 正常` 這個數字），需留意的更新散在長列表中，沒有集中入口。 | `details.status-panel` | 高 |
| P7 | **裝飾過多，屬於典型 AI dashboard**：漸層頁首、光暈、彩色底統計卡、卡片陰影、卡中卡（Tibo 串）、每張卡都有膠囊標籤和「使用系統瀏覽器開啟」提示。資訊權重被裝飾稀釋。 | `c6135bc` 的設計稿樣式 | 中 |
| P8 | **雙欄 sticky 側欄邏輯複雜**：`sidebarStickyTop`、`applySidebarLayout` 和 ResizeObserver 只是為了讓長側欄跟著捲動。改成頁籤後這段邏輯不再需要。 | `panel.js` 第 30–120 行 | 低（維護成本） |

---

## 2. 新資訊架構

```
頁首（sticky）： AI 更新雷達              [主題] [重新整理]
頁籤（sticky）： 總覽 | 更新動態 · 116 | Codex 重設
全域狀態列：     （只在有訊息時出現，例如「正在重新整理所有來源…」、錯誤）
────────────────────────────────────────────────
<頁籤內容：同一時間只顯示一個 tabpanel>
```

- 三個 tabpanel 的容器都在 DOM 中，用 `hidden` 切換。**只有目前的頁籤會渲染**，規則見 §2.0。
- 頁首移除 eyebrow、說明句與漸層。說明句移到總覽頁尾的一行 muted 文字，或直接刪除，因為來源清單已在「來源狀態」內。
- 詳情頁（`#change-detail`）**不是頁籤**，是「更新動態」的子畫面：開啟時隱藏頁籤列與 tabpanel，按返回或 Esc 回到「更新動態」，並還原捲動位置（沿用現行行為）。

### 2.0 資料快取與頁籤生命週期

資料層與畫面層分開，頁籤只是「讀快取、畫畫面」的檢視：

```
worker ──radar:state──▶ receiveState(radar)          ← 唯一寫入點
storage.get('radar-state') ─▶ receiveState(radar)     ← 啟動時一次
                              │
                              ├─ state.radar = radar（唯一快取）
                              ├─ state.dataVersion += 1
                              ├─ 更新永遠可見的部分：頁籤上的數字與圓點、全域狀態列、重新整理按鈕
                              └─ renderTab(activeTab)   ← 只渲染目前頁籤

activateTab(id) ─▶ 若 tabRenderedVersion[id] !== state.dataVersion 才 renderTab(id)
                   否則只切換 hidden 並還原捲動，不碰 DOM
```

規則：

1. 現有的 `render(radar)` 拆成 `receiveState(radar)` 與三個 `renderOverview()`、`renderUpdatesTab()`、`renderResetTab()`。每個 render 結束時寫入 `tabRenderedVersion[id] = state.dataVersion`。
2. **切換頁籤不得呼叫 `api.ui.postMessage`、`api.storage.get` 或任何 worker 訊息**。資料只在 worker 推送、使用者按「重新整理」或「立即重試」時更新。
3. 非目前頁籤在背景收到新資料時**不渲染**，只標記為過期（版本號不同），切換到它時才渲染一次。
4. 搜尋、篩選、時間模式等**檢視狀態**存在 `state`（記憶體），不存在 DOM 或 storage。工具列的 `<input>`／`<select>` 是靜態 HTML，不會被重建，值自然保留。重新渲染列表時從 `state` 與這些控制讀值。
5. 頁籤重新渲染（因為資料過期）時要保留檢視狀態：展開集合 `state.expanded`、收合開關 `state.disclosures`、捲動位置。捲動在渲染後的下一個 frame 還原；如果內容變短，就捲到最大值。
6. **計時器跟著頁籤走**：Codex 倒數的 `setTimeout` 只在總覽或 Codex 重設頁是目前頁籤時執行，離開時清除、回來時重建。詳情頁的 `ResizeObserver` 或 preview 量測只在更新動態可見時運作。
7. 詳情頁（`#change-detail`）沿用現行 `renderChangeDetail()`：只在它開著時就地重繪。

### 2.1 總覽（Overview）：3 秒看懂

目標：在 423×535 不捲動的情況下，看得到下列 1–4 項；第 5 項至少露出開頭。

| 順序 | 區塊 | 內容 | 互動 |
|---|---|---|---|
| 1 | **警示列**（條件出現） | 只在有狀況時顯示，例如：「2 個來源讀取失敗」、「3 則需留意更新（含移除或棄用）」。每列：語意色圖示、文字、右側箭頭。 | 來源失敗：展開下方「來源狀態」並把焦點移到第一個失敗來源。需留意：切到更新動態，並開啟「只看需留意」篩選。 |
| 2 | **數字列** | 三個數字在一列：`116 更新`、`72 需留意`、`7/7 來源正常`。沒有卡片底色，數字用 tabular、semibold，標籤用 muted。 | 每個數字都是按鈕：更新 → 更新動態（清除篩選）；需留意 → 更新動態加「只看需留意」；來源 → 展開來源狀態。 |
| 3 | **Codex 狀態列** | 一列：`Codex 重設 · 距上次 28 小時 · 共 71 次`。已排定時改為 `Codex 重設 · 2 天 3 時後`，語意色強調。 | 整列按鈕 → Codex 重設頁。 |
| 4 | **重要更新**（最多 3 則） | 選取規則見 §2.1.1。每則一列：來源、標題或版本（單行截斷）、需留意標記、時間（靠右）。 | 點擊 → 切到更新動態，捲到該卡並展開它，焦點移到卡片標題。底部「查看全部更新 →」。 |
| 5 | **Tibo 今日** | `今天 Tibo 貼文 2 則（貼文 1、續文 1）`，沒有貼文時顯示「今天 Tibo 尚無新貼文」。 | 有貼文時 → 更新動態，套用來源 = Tibo。 |
| 6 | **來源狀態**（收合） | 標題列：`來源狀態 · 7/7 正常 · 上次檢查 11/4 10:20`。展開後是 7 列來源，保留狀態膠囊與「立即重試」。 | 收合控制見 §3。有來源 `error/stale` 時，標題列顯示 danger 色文字「1 個失敗」，**收合狀態也看得到**。 |

總覽**不顯示**：完整更新列表、熱度圖、公告內文、Codex 三列事實、頁尾說明。

#### 2.1.1 「重要更新」選取規則（新增純函式 `overviewHighlights(units, now)`）

1. 候選：所有卡片單位，排除 Tibo（Tibo 在第 5 項）。
2. 排序鍵依序：
   1. `unitNeedsAttention(unit)` 為 true 的優先。
   2. 停用卡中 30 天內生效的優先（`retirements` 最早日期）。
   3. 單位內最新的 `updateTimestamp` 由新到舊。
   4. `byPosition`。
3. 取前 3 則。沒有官方更新時顯示「目前沒有官方更新」，不顯示空清單。
4. 這個函式要能用 `panelFunctionSource` 單獨測試。

### 2.2 更新動態（Updates）

**需留意的時效（2026-11-04 使用者決策）**：只有近期的卡片算需留意。卡片內最新一則的發布時間在 14 天內（`ATTENTION_WINDOW_DAYS = 14`），或停用／生效日在未來 14 天內（含今天），才算需留意；更舊的卡片不顯示需留意標記、不計入總覽數字與警示、不出現在「只看需留意」。注意事項（quick read）的內容判讀不受影響。

「只看需留意」篩選：存成 `state.attentionOnly`，套用條件是 `unitNeedsAttention(unit)`（以卡片單位判斷），計入 `appliedFilterCount`，「清除篩選」會清除它，篩選鈕上的數字也會反映它。它和其他篩選是 AND 關係；如果與日期篩選或 Tibo 來源同時生效導致沒有結果，沿用空狀態。從總覽導向時，只設定 `attentionOnly = true`，**不清除**使用者在本次開啟中已設的其他篩選；但會在工具列下方顯示「只看需留意 ×」，讓使用者一眼看出列表被篩過。


由上到下：

1. **工具列**（sticky，在頁籤下方）：搜尋、篩選、時間切換、結果數（`113 組 · 198 則`）。篩選面板新增一個開關「只看需留意」（純前端檢視篩選，套用 `unitNeedsAttention`，計入篩選數，「清除篩選」會一併清除）。
2. **日期篩選列**（條件出現，沿用 `#day-filter`）。
3. **每日熱度**（收合，預設收合）：標題列 `每日更新熱度 · 近 26 週`，展開後是現有熱度圖；點日期沿用 `selectDay()`。日期篩選生效時，標題列顯示 `已選 11/2`。
4. **更新列表**。
5. **頁尾**：`內容為官方原文，未經 AI 摘要；連結會在系統瀏覽器開啟。`

#### 2.2.1 更新項目的預設與展開

每張卡**只有一個收合控制**（P4）。預設狀態：

| 欄位 | 呈現 |
|---|---|
| 來源 | 一般文字色、medium 字重（`Claude Code`、`OpenAI`、`Tibo / X`），不用膠囊 |
| 版本或標題 | 版本卡：`v2.1.316`，等寬或 tabular、semibold，後面接 muted 的「上一版 v2.1.315」；其他卡：官方標題，最多 2 行 |
| 發布時間 | 靠右、muted、tabular，跟隨相對／絕對時間切換 |
| 重要程度 | 只有需留意時顯示：danger／warning 色小圓點加文字（`需留意 · 含移除或棄用`、`120 天後停用`），**收合時也要顯示** |
| 類型 | 單一低飽和小標籤（4–6 px 圓角）：`版本更新`、`新模型`、`貼文`、`續文` |
| 摘要 | 1–2 行（`-webkit-line-clamp: 2`）。版本卡改顯示類型統計列 `新增 10 · 改善 10 · 修正 34 · 棄用 1`，色彩依類型 |

展開後（同一張卡往下延伸，不開新頁）：

| 卡片類型 | 展開內容 |
|---|---|
| 官方單則 | 「重點」三格（變更、影響範圍、注意事項，即現在的 quick read）、全文、版本差異、`查看官方來源` |
| 版本卡／日期卡（≤ 20 項） | 類型 chip 列加上依類型分組的完整清單、`查看官方來源` |
| 版本卡／日期卡（> 20 項） | **不建立收合**（2026-11-05 使用者決策：「查看全部」取代展開）：收合狀態的類型統計列下方只放「查看全部 N 項變更」→ 開詳情頁（文案不可改，截圖腳本依此定位）。詳情頁已有完整清單與官方來源，卡片上不再有 5 項預覽 |
| 停用卡 | 收合時顯示停用倒數加前 2 個「舊型號 → 替代」；展開後顯示其餘型號與說明 |
| Tibo 單則 | 內文本身就短：不收合，直接顯示全文加 `查看 X 原文` |
| Tibo 對話串 | 收合時顯示原貼全文加「N 則續文」；展開後顯示續文時間軸（不使用卡中卡，見 §4） |

規則：

- 收合控制放在卡片右下或標題列尾端，文字「展開」或「收合」，`aria-expanded`、`aria-controls` 指向展開區。整張卡**不可**做成點擊目標，因為卡內還有外部連結按鈕。
- 「使用系統瀏覽器開啟」不再每張卡顯示，改放在按鈕 `title`，頁尾已說明一次。開啟中、已開啟、錯誤的回饋文字仍顯示在按鈕旁（`source-note`）。
- 展開狀態存在記憶體 `state.expanded: Set<unitKey>`。重繪（背景同步）時保留；卡片消失時自動丟棄；不寫入 storage。
- 卡片根元素加 `data-unit-key`，總覽導航用它定位。

### 2.3 Codex 重設（Reset）

預設顯示（不收合）：

```
最新狀態                                   （或「已排定重設」，語意色文字＋圓點）
距上次重設 28 小時                          （主值：24px、semibold；數字用 accent）
───────────────────────────
上次重設時間      2026年11月2日 上午07:27
重設類型          重設
累計次數          71 次
預定時間          2026年11月6日 上午09:00   （僅在已排定時）
```

收合區（同層的兩個收合，不巢狀）：

1. **公告**：`latestReset.text`（純文字，`white-space: pre-wrap`，最多 280 字），下方放 `查看公告` 按鈕（有 `sourceUrl` 才顯示）。沒有內文也沒有連結時不顯示這個區塊。
2. **資料來源**：`codex-resets.com` 連結、此來源的狀態與上次讀取時間（取自 `sources` 中 `id === 'codex-resets'`），以及失敗時的「立即重試」。標題列在失敗時顯示 danger 文字「讀取失敗」，收合時也看得到。

#### 2.3.1 Codex 重設與 Tibo 貼文綁定（2026-11-04 使用者決策：「codex重設是跟tibo貼文綁定的不是分開的」）

資料事實：`latestReset.id` 就是 Tibo 貼文的 X status id（worker 只接受 `x.com/thsottiaux/status/<id>` 作為 `sourceUrl`），更新列表中的對應卡片 id 為 `x-<id>`。codex-resets.com 只負責偵測與統計；重設本身是 Tibo 的貼文。來源類型為 `observed`（沒有貼文）時沒有對應卡片。純前端以 `findResetPost(updates, latestReset)` 關聯（id 相符，或 `sourceUrl` 相符），不改 worker 與資料格式。

- **Codex 重設頁**：原「公告」收合改成不收合的「Tibo 重設貼文」：用 Tibo 卡片的呈現（頭像、`Tibo / X`、時間、全文、`查看 X 原文`），內文優先取對應 Tibo 卡，沒有對應卡時用 `latestReset.text`。沒有貼文（observed、沒有 text 也沒有 sourceUrl）時顯示一行 muted「這次重設沒有對應的 Tibo 貼文」。「資料來源」收合列 meta 與內容說明「由 codex-resets.com 偵測 Tibo 貼文」，兩個連結都列出。
- **更新動態**：對應的 Tibo 卡片類型標籤改成「Codex 重設」（加重設類型，例如 `Codex 重設 · 存入`），卡片加一個「查看 Codex 重設」按鈕切到 Codex 重設頁。其他 Tibo 卡不變。
- **總覽**：「Tibo 今日」緊接在 Codex 狀態列下方，成為同一組（標題「Codex 重設 · Tibo」或 Codex 列與 Tibo 列放在同一個框內）；今天的 Tibo 貼文若就是重設貼文，標示「Codex 重設」。V1 不得退步。

**歷史紀錄**：依使用者決策暫不實作，不修改 worker 或資料格式，也不留空殼或「即將推出」文字。

### 2.4 重用清單（不新增 UI 依賴）

| 需要 | 重用 |
|---|---|
| 建立文字節點 | `appendText()` |
| 圖示 | `createIcon()` 與 `ICON_PATHS`（只在缺少時新增 path 常數，例如 chevron） |
| 載入中 | `createPixelLoader()`、`setBusy()`、現有 skeleton class |
| 外部連結 | `bindExternalButton()`、`bindExternalLink()`、`safeSourceUrl()` |
| 卡片 | `renderTiboUpdate`、`renderThread`、`renderOfficialUpdate`、`renderChangeGroup`、`renderRetirement`（只調整收合方式，不重寫內容） |
| 來源列 | `renderSources()`（總覽與 Codex 資料來源收合共用，後者只傳入 `codex-resets`） |
| Codex | `formatTimeSinceReset`、`formatScheduledCountdown`、`formatAbsoluteResetTime`、`resetTypeLabel`、`appendAnnouncementAction`、`appendCodexSourceAttribution` |
| 篩選 | `matchesFilters`（只新增 `attentionOnly` 判斷）、`renderFilterControls`、`selectDay` |
| 同步 | `syncTracker`、`dispatchSyncRequest` |

新增的函式只有：`receiveState`、`activateTab`、`nextTabIndex`、`renderOverview`、`renderUpdatesTab`、`renderResetTab`、`overviewHighlights`、`createDisclosure`。超出這份清單需要在結論中說明理由。

---

## 3. 互動規則

### 3.1 頁籤

- 採用 WAI-ARIA Tabs pattern：
  - `role="tablist"`（`aria-label="更新雷達功能"`）、`role="tab"`（`aria-selected`、`aria-controls`、`id`）、`role="tabpanel"`（`aria-labelledby`、`tabindex="0"`）。
- 鍵盤：Left／Right 循環、Home／End 跳到頭尾，採**自動啟用**，因為切換不會抓資料、沒有成本。只有選中的 tab `tabindex=0`，其餘為 -1（roving tabindex）。
- 頁籤標籤：`總覽`、`更新動態`（後面接 muted 的單位數）、`Codex 重設`（排定中時加一個語意色小圓點，並在 `aria-label` 補「已排定重設」）。
- 每次開啟面板一律落在**總覽**，不記憶上次頁籤，以符合 3 秒目標。
- 切換時：
  1. 記錄目前頁籤的 `window.scrollY`。
  2. 隱藏舊 panel、顯示新 panel。
  3. 在下一個 frame 還原新頁籤上次的 scrollY，第一次造訪則捲到 0。
  4. **不移動焦點**，焦點留在 tab 上，符合 APG。
  5. 不呼叫 `postMessage`、不重繪資料。
- 從總覽「導向」更新動態時（例如點重要更新），在切換後套用篩選，捲到目標卡（`scrollIntoView({ block: 'start' })`，配合 `scroll-margin-top` = 頁首、頁籤與工具列的高度），並把焦點移到該卡標題。這是使用者明確要求的跳轉，所以移動焦點。
- 保留的狀態（記憶體內，面板關閉即重置）：搜尋字、篩選值、選定日期、只看需留意、時間模式、卡片展開集合、各頁籤捲動位置、收合區開關。
- 目前頁籤不寫入 storage，所以重新開啟面板一定回到總覽，上述狀態也全部重置。

### 3.2 收合

- 全插件只用**一種**收合實作：新增 helper `createDisclosure({ id, title, meta, open })`，回傳 `{ root, button, region }`：
  - 按鈕是 `<button type="button" aria-expanded aria-controls>`，內含標題、meta 和 chevron（`aria-hidden`）。
  - 展開區是 `<div id role="region" aria-labelledby>`，收合時加 `hidden`。
  - Enter／Space 由 button 原生支援；chevron 只做 0° ↔ 180° 旋轉，`prefers-reduced-motion` 時不做 transition。
- 現有 `<details>`（來源狀態、quick read、change details、retirement details）全部改用這個 helper（P5）。
- **不巢狀**：收合區內不再放收合。若某內容本身需要「更多」，例如版本卡超過 20 項，改用跳轉到詳情頁。
- 警示外露（硬性規則）：收合標題列的 `meta` 必須反映展開區內最嚴重的狀態（失敗、需留意、即將停用），用語意色文字加圖示，不能只靠顏色。資料來源錯誤另外要在**總覽警示列**出現，不論來源狀態收合與否。這是驗收項目 V6。
- 收合狀態存在記憶體 `state.disclosures: Map<id, boolean>`，重繪時保留。

### 3.3 預設狀態與例外情境

| 情境 | 總覽 | 更新動態 | Codex 重設 |
|---|---|---|---|
| 首次載入、尚無快取 | 數字與 Codex 列顯示 skeleton（沿用 pixel loader 與 skeleton class），重要更新顯示 3 列 skeleton | 沿用 `renderUpdateListSkeleton()` | skeleton 主值加三列 |
| 有快取、背景同步中 | 正常顯示，全域狀態列顯示「正在檢查公開來源…」，各區 `aria-busy` | 同上，列表 `aria-busy=true` 但不清空 | 同上 |
| 全部來源失敗、有快取 | 警示列：「7 個來源讀取失敗，顯示上次的資料」 | 正常列表加上方 warning 文字一列 | 「讀取失敗，顯示上次的資料。」 |
| 全部失敗、無快取 | 警示列加上空狀態「目前無法讀取更新，請稍後重新整理。」 | 空狀態相同文案加「重新整理」按鈕 | 「無法讀取 Codex 重設資料，請稍後再試。」 |
| 篩選後無結果 | — | 沿用 `#empty`：「目前沒有符合條件的更新」加「清除篩選」 | — |
| 沒有官方更新但有 Tibo | 重要更新顯示「目前沒有官方更新」 | 正常 | — |
| 無排定重設 | Codex 列顯示「距上次 N 小時」 | — | 不顯示預定時間列 |
| 排定時間已過、等待狀態更新 | Codex 列顯示「預定時間已到，等待狀態更新」 | — | 同左，主值同文案 |
| 插件 worker 無回應 | 全域狀態列：「插件沒有回應，請確認已啟用。」 | 同 | 同 |
| 詳情頁開啟中收到新資料 | — | 沿用 `renderChangeDetail()` 就地重繪；版本消失時回到列表 | — |

---

## 4. 視覺設計

方向：成熟、克制、高密度的桌面開發工具。用字體、間距、對齊與細邊框建立層級，色彩只負責語意。

> Phase 1–4 不做本節的移除；新增的頁籤、總覽列、收合控制直接使用 §4.2 的克制樣式，不加漸層、光暈或陰影。

### 4.1 移除（Phase 5，相對於 `c6135bc` 的設計稿樣式）

- 頁首漸層、光暈、eyebrow 膠囊、Codex 卡的時鐘光暈圖示、統計卡的彩色底與圖示圓、所有內容卡的 `box-shadow`。
- 卡中卡：Tibo 串內每則的邊框氣泡，改成時間軸加 1px 分隔線。
- 除了類型標籤以外的膠囊（時間、來源、需留意的 999px 膠囊）。
- 每張卡重複的「使用系統瀏覽器開啟」可見文字。

保留：品牌與語意 token（`--radar-accent`、`--radar-warning`、`--radar-danger`、供應商色、change type 色）、深淺色兩組 token、`forced-colors`／`prefers-contrast`／`prefers-reduced-transparency`／`prefers-reduced-motion` 處理、36 px 觸控高度、focus-visible 外框。按鈕內的功能圖示可以保留（重新整理、外部連結、X），區塊標題前的裝飾圖示移除。

### 4.2 規則

| 項目 | 規格 |
|---|---|
| 字級 | 只用 4 級：12（meta）、13（次要）、14（正文）、16（區塊標題、頁籤）；Codex 主值 24 |
| 字重 | 400 正文、500 來源與標籤、600 標題與數字 |
| 數字 | 全部 `font-variant-numeric: tabular-nums` |
| 間距 | 4／8／12／16 四個值；卡片內距 12px 14px；列表項目間距 8px；區塊間距 16px |
| 邊框 | 1px `--radar-border-soft`；圓角：卡片 8px、標籤 4px、按鈕膠囊形（`999px`，2026-11-04 使用者決策：6px 太方正）；搜尋框與時間切換跟按鈕一致 |
| 陰影 | 內容區 0。只允許浮層（篩選面板若為浮層）使用一層淡陰影 |
| 背景 | 頁面 `--radar-bg`，卡片 `--radar-surface`，不使用漸層、不使用 glass（Liquid Glass 規則：內容區不用 glass，避免 glass-on-glass） |
| 色彩 | accent 只用在選中頁籤底線、主要數值、連結；warning／danger 只用在需留意、失敗、停用倒數；新增、改善、修正、移除沿用既有類型色 |
| 頁籤 | 文字頁籤，選中為 2px accent 底線加 600 字重，未選為 muted；高度 40px；寬度不足時可水平捲動，但 278px 寬時三個頁籤必須放得下（必要時把「更新動態」數字隱藏） |
| 頁首 | 單列，總高 ≤ 48px（含 padding），title 16px／600 |
| 雙欄（≥ 900px） | 總覽改為兩欄：左欄放警示、數字、Codex、Tibo、來源狀態；右欄放重要更新（可放到 5 則）。更新動態與 Codex 重設是單欄，最大寬 760px 置中。原 sticky 側欄邏輯（`sidebarStickyTop`、`applySidebarLayout`、`--radar-sidebar-top`）移除 |

---

## 5. 分階段實作順序

每個 Phase 完成後：Luna 跑完測試 → Claude 截圖與量測驗收（只看該 Phase 的項目加上 V2 無溢出、V5 不抓資料兩個回歸）→ 使用者確認 → 才進下一個 Phase。每個 Phase 各自 commit，版本號全部完成後才評估（§7）。

每個 Phase 的範圍上限：只改 §0.1 列出的檔案；不得順手做下一個 Phase 的內容；若發現必須提前處理的問題，寫在結論中，不自行擴大範圍。

### Phase 1：頁籤與功能分工

- 實作 §2.0：`receiveState`、`dataVersion`、只渲染目前頁籤、過期頁籤在啟用時才渲染、計時器跟著頁籤。
- 頁首改為單列，加上 tablist 和三個 tabpanel，把既有區塊**原樣搬入**：
  - 總覽：Codex 卡、統計、Tibo 今日、來源狀態。
  - 更新動態：工具列、日期列、熱度圖、列表、頁尾。
  - Codex 重設：暫時與總覽共用同一張 Codex 卡（clone 渲染或以函式產生兩份）。
- 實作 §3.1 全部互動（鍵盤、捲動保存、不抓資料、開啟落在總覽）。
- 熱度圖點日期、Tibo 摘要按鈕改為「切到更新動態加篩選」，取代 `scrollToUpdates()`。
- 移除雙欄 sticky 側欄邏輯與對應測試，改為測試新行為。
- 詳情頁開關時隱藏和還原 tablist。

### Phase 2：總覽摘要，移除跨頁重複

- 依 §2.1 改寫總覽：警示列、數字列、Codex 狀態列、重要更新（`overviewHighlights`）、Tibo 今日、來源狀態收合。
- Codex 完整卡只留在 Codex 重設頁。
- 加入「只看需留意」篩選與總覽導航（捲到並聚焦卡片）。
- 新增 `createDisclosure` helper，先用在來源狀態。

### Phase 3：更新動態的摘要與展開

- 依 §2.2.1 統一每種卡片的預設與展開內容，每卡只留一個收合控制。
- 熱度圖改為收合區。
- `state.expanded`、`data-unit-key`，重繪時保留展開狀態。
- 移除卡片上可見的「使用系統瀏覽器開啟」。
- quick read、change details、retirement details 的 `<details>` 改用 `createDisclosure`。

### Phase 4：Codex 重設頁

- 依 §2.3 改寫：預設事實、公告收合（`latestReset.text`）、資料來源收合（含來源狀態與重試）。
- 不做歷史紀錄。

### Phase 5：視覺統一與驗證

- 依 §4 移除裝飾、統一字級、間距、邊框、頁籤樣式；深淺色、forced-colors、reduced motion 檢查。
- 清除死碼（不再使用的 class、icon 常數、CSS 規則）。
- 更新截圖 manifest（Claude 負責，在 repo 外）。

---

## 6. 驗收標準

### 6.1 自動化（Luna 在 `tests/update-radar-plugin.test.mts` 補齊，每個 Phase 都要全綠）

- `node --experimental-strip-types --test tests/update-radar-plugin.test.mts`
- `cd update-radar && pnpm test`
- `pnpm run test:unit`
- `git diff --check`

各 Phase 新增的斷言：

| Phase | 斷言 |
|---|---|
| 1 | 用 stub 驗證：啟動後切換頁籤 10 次，`ui.postMessage` 與 `storage.get` 的呼叫次數不變；在非目前頁籤時送入新 state，該頁籤的 render 函式不被呼叫，切換過去時恰好呼叫一次；連續切換而沒有新資料時 render 呼叫次數為 0。`index.html` 有 1 個 `role="tablist"`、3 個 `role="tab"`、3 個 `role="tabpanel"`，且 `aria-controls`／`aria-labelledby` 互相對應；預設選中「總覽」；純函式 `nextTabIndex(key, current, count)` 涵蓋 Left／Right／Home／End 與循環；切換頁籤的 handler 原始碼不含 `postMessage`；`sidebarStickyTop` 與 `--radar-sidebar-top` 已移除。 |
| 2 | `overviewHighlights` 的排序（需留意優先、30 天內停用、時間、position；排除 Tibo；最多 3 則；空清單）；「只看需留意」計入 `appliedFilterCount` 並會被清除；總覽不含 `#updates`、熱度圖、`codex-reset-facts`。 |
| 3 | 每張卡最多一個 `[aria-expanded]` 收合按鈕；`panel.js` 不再建立 `details` 元素；收合按鈕都有 `aria-controls` 指向存在的 id；需留意標記位於收合區之外；卡片有 `data-unit-key`。 |
| 4 | Codex 頁預設不含 `latestReset.text`，展開「公告」後才出現；沒有 text 與 sourceUrl 時不建立公告區；資料來源失敗時標題列有「讀取失敗」；不含「歷史」字樣。 |
| 5 | 內容區 class（卡片、統計、Codex、工具列）沒有 `box-shadow`；CSS 沒有 `gradient(`；`font-size` 只出現 §4.2 的值（12、13、14、16、24 px 或對應 token）；hex 只出現在 token 定義（既有測試）。 |

### 6.2 截圖與量測（Claude 驗收，`~/Desktop/agent-pets-screenshots`）

| # | 條件 | 標準 |
|---|---|---|
| V1 | 423×535，總覽，淺色和深色（硬性） | 不捲動即可**完整**看到核心摘要：警示列（有的話）、數字列、Codex 狀態列、至少 1 則重要更新。用量測腳本檢查各元素 `getBoundingClientRect().bottom ≤ 535`。fixture 同時有 1 個失敗來源與需留意更新時也要成立 |
| V2 | 278、423、940 寬，三個頁籤，淺色和深色 | `scrollWidth − clientWidth = 0` |
| V3 | 鍵盤 | Tab 進入頁籤後，用 ←／→／Home／End 切換；Tab 進入 panel；Enter／Space 開關收合，`aria-expanded` 同步 |
| V4 | 狀態保留 | 在更新動態輸入搜尋並捲到 y=1200，切到 Codex 再切回：搜尋字仍在、scrollY 誤差 ≤ 2 px、列表未重建（第一張卡的 DOM 節點相同） |
| V5 | 不重新抓資料、不全頁渲染 | 用 stub 計數 `ui.postMessage` 與 `storage.get`：連續切換頁籤 10 次，呼叫次數不變。在總覽時推送新 state：更新動態的 `#updates` 子節點不變；切到更新動態後才更新 |
| V6 | 警示外露 | fixture 設 1 個來源 `error`：總覽警示列、來源狀態標題列（收合時）都顯示失敗；fixture 有停用卡時，收合狀態也看得到倒數 |
| V7 | 3 秒辨識 | 423×535 總覽截圖中，重要更新、需留意數、Codex 狀態三者都在首屏，且字級與色彩層級高於其他文字（目視檢查） |
| V8 | 詳情頁 | 從更新動態開「查看全部 N 項變更」→ 頁籤列隱藏；返回後回到更新動態，捲動位置還原 |
| V9 | 視覺 | 沒有漸層、光暈、卡中卡、內容陰影；頁籤、標題、正文、meta 四級層級清楚；深色模式對比正常；forced-colors 下頁籤選中狀態可辨識（不只靠顏色） |

---

## 7. 版本評估（全部 Phase 完成後）

- 目前版本：`update-radar/plugin/plugin.json` 是 `0.2.4`。`686424b`（文案）與 `c6135bc`（設計稿樣式）都尚未發布，會併入下一版。
- 規範（`AGENTS.md` 與 `.agents/skills/pet-skill/references/phase-gates.md`）：
  - **Patch**：範圍明確的新增功能、UI refinement、文件或流程。
  - **Minor**：大型新子系統、persistent schema 或 migration、公開 contract、安全邊界，或大範圍的行為引擎重構。
- 本次的性質：
  - 不改 worker、資料格式、權限、manifest 或訊息 contract，這些都不構成 minor。
  - 但面板的資訊架構、導覽模型與渲染生命週期全面改寫（頁籤、只渲染目前頁籤、統一收合），可視為「大範圍的 UI 架構重構」。
- 結論：完成後依實際 diff 判斷。如果只停留在 UI 重排，依規範用 patch `0.2.5`；如果渲染與狀態管理的改寫幅度符合「大型架構變更」，用 minor `0.3.0`。這個判斷在 Phase 5 結束時寫進 phase report，再由使用者確認。
