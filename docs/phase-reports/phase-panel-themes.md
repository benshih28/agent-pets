# 階段報告：插件面板主題（`panelThemes`）

分支 `feat/panel-themes`，基準 1.11.5（`f16676e`，第 2 步前重定基底）。前三步：第 1 步面板主題與插件讀取 API，第 2 步全介面統一主題與主機不變量，第 3 步 manifest 擴充顏色鍵、共用驗證、快取與最終驗證。規格：`docs/design/Plugin-Panel-Theme-Spec.md`（§0 記錄實作時的決定）。分四步完成後經獨立審查與複審，發布為 1.12.0（minor：新的插件公開契約與安全邊界）。

## 範圍與結果

| 規格章節 | 內容 | 狀態 |
| --- | --- | --- |
| §2 | manifest 驗證（執行期驗證為準、只拒絕不夾值）、免 Worker 規則（`skins`／`panelThemes`）、`invalid_panel_theme` 錯誤碼、開發者模式診斷 | 完成 |
| §3 | 封閉顏色語法與 `rgb(R G B / A)` 重新輸出、選填色推導、字型清單與尺寸、`tokens.css` 凍結內建值（`--builtin-organic-*`）；第 1 步的 `.host-protected` 已由第 2 步的不變量取代（R14） | 完成 |
| §3.7 | 寵物狀態列顏色 `petStatus`（新增，見規格 §3.7） | 完成 |
| §4 | 背景（純色／漸層／圖片＋遮罩）、woff2 字型、使用者匯入背景圖（原生對話框、記憶體內驗證、`userData/panel-theme-images`、0o700／0o600、temp＋rename、清除、孤兒清理） | 完成 |
| §5、§6 | 素材檢查、對比規則（各模式分開、最小遮罩、0.50 下限） | 完成 |
| §7 | `panel-theme.json`、同步與廣播、`agent-pets://panel-theme/<token>`、生命週期 | 完成 |
| §8 | 設定介面：依使用者決定移到「設定 → 插件 → 該插件 → 面板主題」；「通用 → 外觀」只留狀態卡與恢復內建 | 完成 |
| §10 | 授權單位、套件規則、目錄 `minAppVersion` 與探索頁「需要 Agent Pets X」 | 完成 |
| §16.4 | 插件讀取主題 API：`--ap-*` token、`theme.get()`／`theme.onDidChange`（規格 R13） | 完成 |
| §16.1、§16.3、§16.5 | 全介面統一主題：兩個視窗的每個介面（按鈕、輸入、分頁、卡片、對話框、選單、提示、通知、精靈、Project MCP、插件安裝與內容框、權限與風險介面、寵物泡泡、狀態列、狀態點）都讀同一組由色盤衍生的語意層；以主機強制的不變量取代保護區域（規格 R14、R15） | 完成；`src/**` 寫死的顏色為 0，`check:design:strict` 以 `--raw-colors=fail` 把關 |
| §16.2 | manifest 擴充顏色鍵 `infoText`、`shadow`、`highlight`；`borderOnAccent` 停用（接受但忽略）；`accentOnHover` 成為語意層的懸停底 `--color-hover`（規格 R16） | 完成 |

## 與規格的差異

見規格 §0 R1–R18。重點：

- R1：`accentHover` 改為「往 text 混合到 onAccent 達 4.5:1 的第一個比例」，只給 10 個必填內建淺色值時原公式只有 4.43:1。
- R2／R3／R4：遮罩色必須不透明；圖片背景合成不取整；最小遮罩採「之後所有比例都通過」的定義。
- R6：設定位置改到插件詳情頁。
- R7：新增 `petStatus`（寵物狀態列）。
- R8：`agent-pets` scheme 加上 `corsEnabled`。字型一定是 CORS 請求，實測沒有它會被 Chromium 擋下；只有 `panel-theme` 路由會回 `Access-Control-Allow-Origin`，且只給面板來源。
- R13–R15：插件讀取主題 API、單一語意層與主機不變量、寵物視窗套用主題（第 1、2 步）。
- R16（第 3 步）：manifest 新增選填的 `infoText`、`shadow`、`highlight`（不透明，省略時取該模式內建值）。`infoText` 加入色相（200–290°）、色度與色差規則及文字矩陣；`shadow` 相對亮度 ≤ 0.05、`highlight` ≥ 0.7。`borderOnAccent` 停用：照樣檢查文法與 alpha、但不輸出，舊 manifest 不會失效。`accentOnHover` 保留，成為精靈與 Project MCP 的懸停底。不變量矩陣補上元件實際畫出的組合（由 `background`／`color` 規則逐一盤點）：sage 文字、懸停底、12% 狀態晶片、`textFaint` 在 `bg` 上。`--ap-info` 改為主題的 `infoText`，新增 `--ap-shadow`、`--ap-highlight`（共 26 個）。
- R17（第 3 步）：「驗證以主題雜湊快取」原本沒有做到（以 `id@version` 快取，開發者資料夾改了顏色但版本沒變時會沿用舊主題）；改為以宣告內容的 SHA-256 為鍵、上限 32 項的 LRU，sync 時丟掉沒有插件使用的項目。
- R18（第 3 步）：陰影與高光強度依模式（與 1.11.5 相同），主題預覽依「被預覽的模式」解析，不再沿用面板目前的模式；深色寵物文字陰影恢復。

## 安全

- 插件字串不會進入 CSS：主程式以封閉語法解析並重新輸出；渲染端用白名單與逐屬性正規式再檢查，只用 `style.setProperty`，不使用 `cssText`、`<style>` 或 `innerHTML`（有測試把關）。
- 沒有遠端網址；圖片與字型只能從 `agent-pets://panel-theme/<token>` 取得，token 為每次啟動不同的 HMAC，插件分區沒有這個 host。提供前會對讀到的位元組重跑檔頭檢查。
- 圖片只讀檔頭判斷尺寸、像素數、動畫與方向，不解碼；使用者圖片只讀一次（lstat、`O_NOFOLLOW`、fstat 比對 dev/ino/size）。
- 新 IPC：6 個面板頻道（只允許設定面板 main frame，含單向的 `panel-theme-appearance-set`）、1 個寵物頻道（只允許寵物視窗 main frame）、3 個由主程式送出的廣播（含送給插件面板頁的 `plugin-panel-theme-changed`）；`docs/security/ipc-inventory.md` 已重新產生，產生器也修正為依實際 sender guard 與 `_event` 參數判斷。
- 插件主題 API（`theme.get`、`theme.onDidChange`、面板頁 `--ap-*`）不需要權限：快照只含畫面上已可見的顏色、圓角、字族與字級倍率，每個插件相同，不含插件或主題 id、字型別名、圖片或路徑；變更以 100 ms 合併並在送出時去重。
- 沒有保護區域（R14）：主題也套用到權限／風險介面、安裝確認、插件內容框、確認對話框、伺服器狀態橫幅、主題設定與寵物視窗。驗證器在接受主題前證明每個文字 token 在它可能出現的每個表面上 ≥ 4.5:1（寵物泡泡與狀態列以疊在全黑與全白桌面上計算）、焦點環 ≥ 3:1、主要按鈕懸停的標籤 ≥ 4.5:1、狀態色（含第 3 步起可設定的資訊色）維持色相與色差；版面、文字標籤、風險徽章文字與「按住才允許」由主機程式碼決定。
- 寵物視窗只收到它用得到的 21 個色盤屬性與選填的狀態列顏色（測試由 `tokens.css` 反推這個集合），在同一個 frame 內寫入 `<html>`；不收字型、圓角、圖片或模糊。

## 規格以外一併修正的問題

- 第 2 步：設計檢查逐行掃描，漏掉多行的顏色宣告（4 筆）；內嵌權限卡把次要文字、倒數與 `onAccent` 文字放在強調色填色上（淺色約 1.9:1／3.29:1）；寵物泡泡的次要文字是 64–84% 半透明；精靈與 Project MCP 面板使用藍色玻璃層的元件、也讀不到 `--font-body-sm`／`--font-label`；寵物外觀會重畫面板的捲軸；工作階段列的狀態點用寫死的亮色（綠點在米白上約 2:1）；主要按鈕懸停混黑色，深色模式下降低標籤對比；淺色寵物外觀的焦點框在泡泡上只有 1.4:1；`DesktopPet.vue` 的 `:data-pet-mode` 縮排錯誤。

- 淺色寵物外觀下權限泡泡的指令、細節、連結與「允許一次」幾乎是白字配米色（沿用深色層的 `--text-bright` 等 token）。已在淺色寵物範圍補上對應值，並把這些配對加入 `check-contrast`。
- `rgb()` 百分比換算有浮點誤差（50% 變成 127）。
- `pack-test-plugin.mjs` 不支援免 Worker 的測試插件。
- 隔離測試執行器無法驅動原生檔案對話框、也無法改埠：新增僅供測試的對話框佇列，並轉傳開發版的埠設定。
- 已解析主題的快取改為只保留已安裝版本；多個元件同時掛載時共用同一個狀態請求。

## 驗證

- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run test:unit`（第 2 步後 1125 項全過）、`pnpm exec vite build`、`pnpm run check:bundle-size`、`pnpm run check:bundle`、`pnpm run check:contrast`、`pnpm run check:design:strict`（第 2 步起含 `--raw-colors=fail`）、`pnpm audit --prod`（無已知弱點）、`git diff --check`。
- 新增測試：顏色語法與注入字串、驗證器與對比、儲存、使用者圖片、IPC 寄件者、協定路由、渲染端白名單、寵物狀態列、插件整合（manifest、套件、授權、目錄、設定搜尋、語系）。
- 隔離 Electron（暫時 HOME／userData、假 safeStorage、未觸發鑰匙圈）：以開發者模式安裝測試主題插件，套用淺色與深色、匯入背景圖、切換插件停用／移除（檔案與設定一併清除）、權限卡在高彩度主題下維持內建外觀（第 1 步當時的設計；第 2 步起權限卡跟著主題，由不變量保證可讀）、forced-colors／prefers-contrast／reduced-transparency、寵物狀態列淺色與深色。
- 插件主題 API（隔離 Electron，hook 埠 37373–37375）：以開發者模式安裝 `ok-panel-theme` 與 `ok-theme-reader`（無權限的面板頁插件），面板淺色→深色時 panelView `<html>` 上的 24 個 `--ap-*` 立即更新，一次切換只收到一個 `onDidChange` 事件；恢復內建後回到內建深色色盤；Worker 的 `theme.get()`／`onDidChange` 記錄與面板一致。

- 第 2 步（隔離 Electron，hook 埠 37373–37375、假 safeStorage）：內建與 `ok-panel-theme` 的 aurora 主題下，面板（工作階段、設定精靈）與寵物視窗（狀態列、狀態點）的淺色與深色截圖；寵物外觀與面板外觀分開切換時，寵物視窗 `<html data-theme>` 跟著寵物外觀、只收到 19 個色盤屬性與狀態列顏色（29 個 inline 屬性）。

## 第 3 步（manifest 擴充鍵、共用驗證、快取、最終驗證）

| 項目 | 結果 |
| --- | --- |
| 擴充顏色鍵 | `infoText`、`shadow`、`highlight`（R16）；schema、d.ts、EN／zh-TW 文件與驗證器測試同步；schema 與 d.ts 的鍵集合由測試對照執行期清單 |
| 共用驗證 | `src/types/id-patterns.ts` 統一插件 id、命令 id、項目 id、金鑰指紋、專案 id、`x.y.z` 版本與 v4 UUID（原本約 40 處複製的 regex，含 Worker 宿主字串）；`electron/value-guards.ts` 取代 20 份相同的 `isRecord`；測試防止複製品回來。`_host`／`_shared` 的負向前瞻是死碼（底線不在字元集內），已移除 |
| 範例 | `docs/plugins/examples` 的兩個面板頁只用 `--ap-*` 取得顏色、圓角與字族，依 `api.theme` 設定 `color-scheme`（原本寫死 `dark`）；測試把關 |
| 快取 | R17；命中、未命中、同版本改內容、移除、上限皆有測試 |
| 預覽與寵物陰影 | R18 |
| 插件作者版本說明 | `docs/plugins/whats-new-1.12.md`（EN／zh-TW），兩份手冊索引與 README 都有連結 |

第 3 步一併修正的問題：

- 使用者回報：主題插件在儀表板有自己的分頁，但分頁內容是空的通知中心（主題插件根本不能發通知）。分頁改為只顯示插件真的有的區塊（`pluginTabSections`）：主題插件的分頁主體是主題清單（`PluginThemeTab` 包住與詳情頁共用的 `PluginPanelThemes`，之後的主題編輯器可作為下一個區塊掛入）；通知區只給有 `contributes.feed` 的插件，設定連結只給有設定欄位的插件；什麼都沒有的插件（只提供寵物造型）不再有分頁。外觀狀態卡的「開啟插件設定」與設定搜尋改為先前往分頁，沒有分頁才開詳情頁（規格 R19）。

- 寵物的權限泡泡放在精靈上方 190 px 的預留空間，但標題加兩個 pattern 的高風險請求高 241 px，視窗把頂端裁掉：來源列與「高風險」徽章看不到（1.11.5 就是如此）。泡泡改為不超過預留高度，只有指令細節縮短後捲動，來源、風險徽章、倒數與按鈕一定看得到。
- 元件畫在未驗證組合上的文字：主動分頁上的數字徽章（`accent` 字在 `onAccent` 上，只有 3:1）、成就「新」徽章（`text` 在 `accent` 上）、精靈與 Project MCP 的待處理晶片（`accentText` 在 `onAccent` 上）改用已驗證的組合；Project MCP 已連線卡片改用 `sageDark`。
- 主題設定說明、插件卡提示與高彩度測試主題的說明仍寫著「權限與風險提示永遠維持內建外觀」（R14 後已不成立），已改寫；`docs/plugins/security.md`、`contribution-points.md`（EN／zh-TW）同樣的過時敘述也已更正。
- 主題讀取測試插件把 `onAccent` 文字放在 `accent` 上（只保證 3:1），改用 `accentHover`。
- `ipc/plugin-install.ts` 未使用的匯出、`plugin-settings.ts` 與其他守衛同名但語意不同的 `isRecord`（改名 `isPlainRecord`）。

- 第 3 步最終驗證（隔離 Electron，hook 埠 37373–37375、假 safeStorage：`encryptString`／`decryptString` 呼叫 0 次，`security` 與 `claude` 執行檔被攔下，未觸發鑰匙圈；`vite build` 而非完整打包）：內建與 `ok-panel-theme` 的 aurora 主題 × 淺色／深色，共 92 張截圖加 12 張媒體查詢抽查（減少透明度、增加對比、forced-colors，面板與寵物視窗）：工作階段、額度、歷史、ActionMenu、通用設定、外觀狀態卡、插件詳情的面板主題與預覽、ConfirmDialog、安裝確認、伺服器狀態橫幅、高風險的內嵌權限卡與寵物權限泡泡（經權限轉接器 `POST /v1/permission/request`）、寵物狀態列（單一／多寵物）與額度提示、通知（toast）、設定精靈、Project MCP、使用 `--ap-*` 的插件面板頁、主題插件自己的分頁。抽查發現並修正：forced-colors 下狀態點消失（已改用 CanvasText）。
- 第 3 步閘門：`vue-tsc --noEmit`、`lint`、`test:unit`（1143 項全過）、`vite build`、`check:bundle-size`、`check:bundle`、`check:contrast`（104 組全過）、`check:design:strict`（寫死顏色 0）、`pnpm audit --prod`（無已知弱點）、`git diff --check`。

## 剩餘風險

- 字型：測試用 `.woff2` 只有檔頭，實際被 OTS 拒絕而改用備援字型；真正字型的渲染結果尚未驗證。
- 只在 macOS 驗證；Windows（分層視窗裁切、真正的高對比模式、字型、路徑）與 125%／150% 縮放未測；forced-colors 只以 Chromium 媒體模擬檢查。
- 與 1.11.5 的陰影與高光比對是以 `f16676e` 的 token 數值對照，沒有並排截圖。
- 寵物權限泡泡在指令很長時，指令細節區只留約兩行並在區內捲動；完整內容仍可用「展開」「複製」或面板的內嵌權限卡查看。

## 版本建議

Minor（1.12.0）：新的公開 manifest 契約、新的 IPC 與協定安全邊界、新的持久化檔案。依 `AGENTS.md`，待使用者確認後再變更版本。

## 第 4 步（主機繪製的主題編輯器與「我的主題」）

使用者需求：主題插件的分頁裡要能自己調參數，不只能選預設主題；要有調色盤可以逐一定義顏色，也要能匯入背景圖。規格新增 R20–R24。

| 項目 | 結果 |
| --- | --- |
| 驗證 IPC | `panel-theme-validate`（只限面板 main frame、payload ≤ 16 KiB、不接受多餘參數）：結構錯誤回報第一個；語意問題全部列出 `{ mode, path, kind, problem, foreground, background, measured, required, suggested }`（≤ 64 項）與各模式最小遮罩。驗證器的檢查是一張依序的檢查表 `panelThemeModeIssues`（每個檢查列出它讀到的鍵，並依鍵建立索引），`parsePanelThemes` 取第一個且診斷文字不變，所以編輯器與安裝時的判斷永遠一致。建議值：在 OKLCH 明度上離原值最近、讓該鍵的問題全部消失且不產生新問題的值（狀態色先移到典型色相）；每個候選色只重跑讀到該鍵的檢查，對比／亮度問題先二分搜尋邊界；遮罩建議最小值；每個模式最多評估 1,600 個候選色。只有結構解析成功的定義才以內容雜湊快取（R17 的 LRU 泛化為 `ContentHashCache`）。 |
| 儲存與 CRUD | `userData/panel-themes-user/<id>.json`（0o700／0o600、暫存檔 + rename、schemaVersion 1、≤ 16 KiB、≤ 50 個）；損毀檔改名備份後略過；頻道 `panel-theme-user-list/create/update/rename/duplicate/delete/export/import`，套用沿用 `panel-theme-slot-set`（擁有者 `_user`）。每次寫入都先經過驗證器；目錄中顯示為「我的主題：<名稱>」，插件全部關閉也可用。刪除正在使用的主題：該模式回到內建，背景圖一併刪除（修剪流程與插件更新相同）；孤兒清掃保留 `_user` 目錄。背景圖沿用既有的主機匯入（原生對話框、記憶體驗證、`panel-theme-images/_user/`）。 |
| 色盤產生器 | `src/utils/panel-theme-palette.ts`：種子色 → 兩個模式（OKLCH 固定明度階層，狀態色固定色相）＋最多 4 輪驗證器建議值修正；背景圖 → canvas ≤ 128 px → OKLab k-means（確定性最遠點初始、8 次迭代、k = 6，O(n·k)）→ 種子。1,000 多個種子（灰、黑白、每 10° 色相、色度到色域邊界）全部通過所有不變量。 |
| 編輯器 | `PanelThemeEditor.vue`（獨立延後載入的 chunk 與 `themeEditor` 文案領域）：起點（空白、內建、插件主題、我的主題）、淺色／深色分開、31 個顏色鍵分組加寵物狀態列，每個鍵有原生取色器、文字欄位（任何 manifest 顏色文法）、OKLCH 微調與「用在哪裡」的提示（`Tooltip.vue`）；由顏色或背景圖產生色盤；背景純色／線性／放射漸層（2–5 色標）／自己的圖片；系統字型組合、文字大小、圓角；兩個模式的即時預覽（卡片、按鈕各狀態、選單、通知、對話框、內嵌權限卡與高風險徽章、寵物狀態列）；150 ms debounce 驗證、逐鍵逐組合的問題與「使用建議值」、未通過時不能儲存或使用、復原（50 步）、重設、未儲存提醒、JSON 匯出／匯入。入口：通用 → 外觀「自訂…」與「我的主題」卡片、主題插件分頁的 `#after-list`。 |
| 匯入／匯出 | 只有 `format`／`schemaVersion`／`name`／`definition`，沒有圖片位元組、檔名或路徑；匯入嚴格解析並驗證，永遠建立新主題。 |

程式碼審查後的修正（同一版 1.12.0）：

- 修剪不再刪掉看不到的「我的主題」：目錄不安全或掃描被截斷時全部保留；讀不到、較新 `schemaVersion`、超過上限的檔案算存在；仍存在的記錄即使驗證規則變嚴格也保留插槽與背景圖。掃描改用 `opendir`，上限只算主題檔與暫存檔；損毀備份只留最新 5 份；較新版本的檔案原封不動。
- 驗證效能：最壞情況（所有鍵中灰）中位數 48 ms → 6 ms（冷啟動 79 ms → 約 20 ms）；6,000 個隨機模式的問題清單與 `parsePanelThemes` 結果與改動前完全相同，600 份隨機草稿的建議值與改動前相同（另有 68 個原本因共用上限用完而沒有的建議）。
- 任意深的巢狀草稿不再讓雜湊遞迴耗盡堆疊：先結構解析，只雜湊解析後的定義。
- 插件面板頁的 `--ap-*` 在第一個腳本前就生效（同步取得快照、經 CSSOM 寫入 adopted stylesheet 與 `<html>`；CSP 不變）。
- 驗證器新增寵物視窗對話框（`surface` 0.98）上的文字與危險按鈕懸停底的檢查。
- 名稱在正規化前限制長度；存檔可一併改名（一次原子寫入）；匯出預設檔名保留中文；對話框篩選器名稱依語系。
- 面板內的對話框遮罩改掛到面板根元素（`Teleport`，`StatusPanel` 提供掛載點）：原本遮罩是 `position: absolute`，包含區塊是所在的卡片或設定捲動框，又被捲動區裁切，所以標題列、搜尋與分頁沒有變暗、也沒有 `inert`（我的主題刪除、歷史清除、權限記錄清除、寵物與插件的確認框都受影響）。巢狀對話框（編輯器內的確認框）維持原位。
- 建議值的二分搜尋另以「改寫前的逐格完整搜尋」比對隨機草稿（測試）；背景圖遮罩的檢查也列入它讀到的路徑。

第 4 步一併修正的問題：

- 使用者圖片的協定回應沒有 CORS，渲染端無法在 canvas 上取色：改為只對受信任的面板來源回 `Access-Control-Allow-Origin`（字型原本就有，套件內的圖片仍然沒有）。
- 孤兒清掃與 store 解析只接受插件 id，會把 `_user` 目錄與項目當成無效刪掉：改為接受保留擁有者 id。
- `Tooltip.vue` 有文件但沒有任何使用者：現在用於編輯器的說明提示；它與 `ActionMenu.vue` 的 id 改用 `useId()`（原本是 `Math.random`）。
- 外觀設定的寵物外觀標籤是巢狀三元，改為查表。
- 設定頁主題預覽的次要文字重複顯示淡化文字的字串。
- `panelThemeSettingsTarget` 與外觀卡的「開啟插件設定」不再把「我的主題」當成插件。
- 插件主題清單與我的主題共用 `PanelThemeCard`；預覽樣式與背景計算抽成共用函式（`panelThemePreviewStyle`、`panelThemePreviewBackdrop`），寵物狀態列預覽抽成 `PanelThemePreviewPill`。
- 隔離執行器新增僅供測試的儲存對話框佇列（匯出用）。

驗證（隔離 Electron，hook 埠 37373–37375、假 safeStorage：`encryptString`／`decryptString` 0 次，`security`／`claude` 被攔下；`vite build`，未完整打包）：由外觀「自訂…」開啟編輯器 → 種子色 #2f7f8a 產生色盤 → 改強調色與淡化文字 → 淺色模式出現 9 個問題（儲存與使用停用）→「使用建議值」後全部通過 → 背景改為自己的圖片，預設遮罩低於最小值 → 使用建議值 → 選圖（存檔後匯入）→ 由背景圖產生色盤 → 儲存 → 兩種模式都使用 → 匯出 → 未儲存提醒 → 套用結果在面板（內嵌權限卡與高風險徽章、圖片背景）、對話框、寵物權限泡泡與狀態列的淺色與深色截圖 → 匯入匯出檔 → 刪除正在使用的主題後兩個模式回到內建、圖片檔被刪除。共 21 張截圖。

驗證時發現另一個來源在同一個測試視窗上點擊 `<select>`（`isTrusted` 的 pointer 事件），曾讓草稿被改動或編輯器被關閉；改為每個步驟在單一指令內完成並在截圖前確認狀態。

剩餘風險：

- 主題插件分頁中的「我的主題」區塊只由程式碼與元件結構確認（這次沒有在執行器中安裝主題插件截圖）。
- 編輯器在窄面板（360 px）與 125%／150% 縮放下的版面未截圖檢查；Windows 未測。
- 原生 `<input type="color">` 的取色面板外觀由作業系統決定。
