# Agent Pets 設計系統 / 視覺一致性 / 無障礙 / i18n 稽核

範圍：renderer（`src/styles/tokens.css`、`src/components/**`、`src/i18n.ts`、`src/locales/*`）與 electron 原生選單／通知／對話框字串。唯讀稽核，未修改任何 repo 檔案。

## 全域數字（grep 實測）

| 指標 | 數值 |
| --- | --- |
| `src/**/*.vue,css`（排除 tokens.css）裸 hex | 23 行（DesktopPet.css 21、PluginPanel.css 2） |
| 裸 `rgba()` | 62 行（DesktopPet.css 58、App.vue 2、PetAnimation.vue 2） |
| `font-size` < 11px | 2 處（PluginPanel.css:91 `10px`、DesktopPet.css:330 `10px`） |
| 非 token 的 `font-size: Npx` | 5 處 |
| 繞過 `ui/` 的原生 `<button>`（DesktopPet.vue） | 5 處（654/664/750/764/774） |
| 原生 `<input>` / `<select>`（ui/ 之外） | input 11、select 2 |
| `backdrop-filter` 宣告（含 none 還原） | 36 行；其中啟用的 blur 值 11 處、全為 literal，僅 1 處用 `--surface-blur` |
| `:focus-visible` 規則 | 全 repo 僅 8 個檔案各 1–7 次；`outline: none` 3 處 |
| `prefers-reduced-transparency` | 4 個檔案；`prefers-contrast: more` 5 個；`forced-colors` 僅 PluginPanel.css |
| 淺色主題 (`prefers-color-scheme: light`) | 0；`color-scheme` 僅出現 1 次 |
| 未定義但被使用的 CSS 變數 | 非 runtime 變數 6 個：`--accent-primary`、`--font-2xs`、`--surface-secondary`、`--text-danger/-success/-warning`、`--status-error` |
| 已定義卻未使用的 token | 10 個（`--accent-wash`、`--border-claude`、`--font-xl`、`--radius-lg`、`--space-5`、`--state-idle`、`--state-warn`、`--surface-claude`、`--surface-sunken`、`--transition-base`） |
| 原生 `title=` tooltip | 45 處 |
| 已寫死中文的 electron 字串 | ~65 行（project-mcp-setup 29、adapter-operations 17、adapter 6、ipc 5） |
| 翻譯 key | en-US 534 / zh-TW 534，key 與 `{placeholder}` 完全對齊（parity OK） |
| `.vue` 內 `aria-*`/`role` 數量 | 0 處 `aria-describedby`、`aria-busy`、`aria-expanded`、`aria-controls` 僅 tab 使用 |

---

## DS-01 兩套並行 token 系統：`--organic-*` 與基礎 token 互相覆蓋
- 嚴重度：高
- 證據：tokens.css:123–213 定義 ~75 個 `--organic-*`（含另一組 `--organic-space-*` 4.4px 小數間距、`--organic-font-*` 11.5/12.5/13.5px 小數字級、`--organic-radius-*`）；全 repo `var(--organic` 551 次，而 `StatusPanel.css:5` 以 `--surface-panel: var(--organic-bg)` 覆寫基礎 token。同一 UI 內 `Select.vue:65-70` 用基礎 `--font-sm`，StatusPanel 用 `--organic-font-body-sm`。ui-design-system.md 宣稱「5 級字級、4px 基準」，與 4.4px 間距矛盾。
- 使用者影響：同一畫面按鈕／下拉／卡片尺寸與字級差 0.5px，造成視覺「接近但不一致」；主題切換或 fallback（`var(--organic-x, var(--text-muted))`）時回退到完全不同的色盤。
- 子任務
  - [ ] 決定單一真相：將 `--organic-*` 重命名為語意 token（`--color-bg`、`--color-surface`…），基礎 token 為其別名或反之。
  - [ ] 將 4.4px 小數間距與 11.5/12.5/13.5/14.5px 字級收斂到 4px 格線與 5 級字級。
  - [ ] 移除 `StatusPanel.css:5` 這類在元件內覆寫全域 token 的做法，改以 `[data-theme]` / scope class 提供整組值。
  - [ ] 刪除 PluginPanel.css 內 `var(--organic-x, var(--text-y))` 雙層 fallback（至少 20 處），改單一 token。
  - [ ] 補文件：哪些畫面（pet 層 vs panel 層）使用哪一組，寫入 ui-design-system.md。
  - [ ] 新增 unit test 掃描 `src/**/*.css`，禁止新增 `--organic-` 以外的字面值。
  - [ ] 移除 10 個死 token 並加 CI 檢查「已定義未使用」。
  - [ ] 補定義 6 個未定義變數（見 DS-02）。
- 修改檔案：`src/styles/tokens.css`、`StatusPanel.css`、`PluginPanel.css`、`ui/*.vue`、`.agents/skills/pet-skill/references/ui-design-system.md`

## DS-02 未定義 token 被使用，靜默失效
- 嚴重度：高
- 證據：`PluginPanel.css:58 var(--accent-primary)`、`:69 var(--font-2xs)`/`var(--surface-secondary)`、`:93 var(--text-danger, #c33)`（還帶裸 hex fallback）、`:43/:72 --text-success/--text-warning`；`DesktopPet.css:137 var(--status-error)` 無定義，背景會變 transparent。
- 使用者影響：外掛面板錯誤等級顏色回退成 `#c33`（深紅在深色底對比差）；狀態點可能透明而看不見。
- 子任務
  - [ ] 定義 `--text-danger/-success/-warning`（對應 `--state-*` 並確認對比 ≥ 4.5:1）。
  - [ ] 以 `--state-error` 取代 `--status-error`；改 `--accent-primary` → `--accent`。
  - [ ] 定義或移除 `--font-2xs`（若保留需明定下限 ≥ 11px，否則直接用 `--font-xs`）。
  - [ ] 以 `--organic-surface-2` 取代 `--surface-secondary`。
  - [ ] 移除 `#c33` fallback。
  - [ ] 加 build 前腳本：解析所有 `var(--x)`，找不到定義即失敗（`scripts/check-tokens.mjs`）。
  - [ ] 把腳本加入 `pnpm build` 的 prebuild。
- 修改檔案：`PluginPanel.css`、`DesktopPet.css`、`tokens.css`、`package.json`、新增 `scripts/check-tokens.mjs`

## DS-03 DesktopPet.css 大量裸 hex／rgba，違反自己的規則
- 嚴重度：高
- 證據：DesktopPet.css 21 處 hex（752 `#f8f7fb`、781 `#ffe6a0`、789 `#ffc0ba`、834、855、864、905、932、952、969、1076、1128、1133、1220–1264 `#17171d/#1d1b24/#1e1f2b`）與 58 處 rgba；`App.vue:384/389`、`PetAnimation.vue` 另有 4 處。文件稱此規則「違反＝bug」。
- 使用者影響：無法主題化；reduced-transparency 的不透明底色 4 種近似但不同的深色（`#17171d/#1d1b24/#1e1f2b/#14141b`），不同氣泡在高對比模式下色階不一。
- 子任務
  - [ ] 建立 `--pet-bubble-*` token 組（surface、surface-opaque、text、text-warn、text-error、text-success、border）。
  - [ ] 把 4 種不透明 fallback 底色合併為 `--surface-bubble-opaque`。
  - [ ] 將 `box-shadow: 0 0 0 2px #14141b, …`（DesktopPet.css:880）改用 `--focus-ring-*` token。
  - [ ] 將 `rgba(255,255,255,.42/.16)` hover 狀態改為 `--surface-raised-hover` / `--border-strong`。
  - [ ] App.vue 的 scrollbar thumb 色改為 `--scrollbar-thumb(-hover)`。
  - [ ] PetAnimation.vue 的 rgba 改為 `color-mix(in srgb, var(--accent) N%, transparent)`。
  - [ ] 將 `DesktopPet.css`（1268 行）依氣泡／狀態列／權限卡片拆檔，降低 review 成本。
  - [ ] 加上 stylelint `color-no-hex` / `function-disallowed-list: [rgba]`（豁免 tokens.css）。
- 修改檔案：`DesktopPet.css`、`App.vue`、`PetAnimation.vue`、`tokens.css`、新增 `.stylelintrc`

## DS-04 低於 11px 的字級與非 token 字級
- 嚴重度：中
- 證據：`PluginPanel.css:91` `font-size: 10px`、`DesktopPet.css:330` `font-size: 10px`（status-line 徽章，CJK 在 Windows 筆畫糊）；另 3 處非 token `px`（SetupWizard.css、ProjectMcpPanel.css、PluginPanel.css 各 1，及 DesktopPet.css 1）。`--font-xl` 已定義卻 0 使用。
- 使用者影響：時間戳、插件徽章在 1x 縮放下難讀；與文件承諾「地板 11px」不符。
- 子任務
  - [ ] 兩處 10px 改 `--font-xs`，若放不下則加寬容器或截斷。
  - [ ] 其餘 3 處 px 改用 token。
  - [ ] 決定 `--font-xl` 是否用於面板標題；否則刪除。
  - [ ] 建立 `--leading-tight/normal`，替換 `line-height: 1 / 1.25` 的散落值。
  - [ ] 支援 pet 縮放時字級的下限（`calc(11px * var(--pet-scale))` 縮小後 <11px 的情況）驗證。
  - [ ] 加 stylelint `declaration-property-value-allowed-list` for font-size。
- 修改檔案：`PluginPanel.css`、`DesktopPet.css`、`SetupWizard.css`、`ProjectMcpPanel.css`、`tokens.css`

## DS-05 ui/ 原語被繞過：DesktopPet 與 PluginPanel 手刻 button / input / select / checkbox
- 嚴重度：高
- 證據：`DesktopPet.vue:654,664`（`.permission-button`）、`750 .plugin-feed-open-panel`、`764 .plugin-feed-close`（內容為 `×` 字元）、`774`；`PluginPanel.vue:108,138,167,262,345,360,377` 共 7 個 `<input>`，`:275,:368` 兩個原生 `<select>`（`Select.vue` 的存在理由正是禁止此事）；`PluginPanelDialogs.vue:83` 原生 checkbox；`SettingsPets.vue:111` 原生 input。`ui/` 沒有 `Input.vue`、`Checkbox.vue`。
- 使用者影響：外掛頁的下拉在 Windows 顯示 OS 箭頭，與其他頁不同；輸入框的 focus、disabled、error 樣式各自一套（PluginPanel.css:57–76 一行式 CSS 重新實作）。
- 子任務
  - [ ] 新增 `ui/Input.vue`（text/url/search/number，含 label、help、error、`aria-invalid`、`aria-describedby`）。
  - [ ] 新增 `ui/Checkbox.vue`（或讓 `ToggleRow` 支援 `variant="checkbox"`）。
  - [ ] PluginPanel 兩個 `<select>` 換成 `Select.vue`。
  - [ ] DesktopPet 的 permission 按鈕：在 pet 層建立 `ui/BubbleButton` 變體（或 Button `variant="bubble"`），移除 `.permission-button` 手刻樣式。
  - [ ] `plugin-feed-close` 改 `Button icon-only` + `<Icon name="close">`。
  - [ ] SettingsPets rename input 換成 `Input` 並加 `aria-label`。
  - [ ] 在 AGENTS/pet-skill 加 lint：`ui/` 之外出現 `<select|button|input>` 即 CI 失敗（白名單 DesktopPet 的 hit-target 元素）。
  - [ ] 對應補 Button/Input/Select 的 unit/visual 測試。
- 修改檔案：`DesktopPet.vue`、`PluginPanel.vue`、`PluginPanel.css`、`PluginPanelDialogs.vue`、`SettingsPets.vue`、新增 `ui/Input.vue`、`ui/Checkbox.vue`

## DS-06 文字符號當圖示（`×`、`✦`、`◇`、`🔧`、`!`）
- 嚴重度：中
- 證據：`DesktopPet.vue:781 ×`（關閉）、`:702 ✦`、`:730 🔧`（emoji，Windows/macOS 渲染不同）、`:~690 !`（permission-notice-icon）、`PluginPanel.vue:44,230 ◇`。`Icon.vue` 僅 13 個 path。
- 使用者影響：Windows 上 emoji 彩色、macOS 單色；`×` 熱區小且與 Icon 的 1.4 stroke 不一致。
- 子任務
  - [ ] `Icon.vue` 新增 `close`、`sparkle`、`wrench`、`alert`、`plugin`、`external-link`、`check`、`info`。
  - [ ] 取代以上 5 個位置，保留 `aria-hidden="true"`。
  - [ ] 給 `Icon` 加 `size` prop（12/14/16/20）與 `currentColor` 預設。
  - [ ] 將 `Icon` 的 path 資料抽成 `icons.ts` 以便測試覆蓋。
  - [ ] 加測試：全 repo `.vue` template 不得含 U+2190–27BF／emoji 字元（白名單 Icon.vue 註解）。
  - [ ] 為 `×` 關閉鈕補 32×32 最小熱區。
- 修改檔案：`ui/Icon.vue`、`DesktopPet.vue`、`PluginPanel.vue`、`DesktopPet.css`

## DS-07 嵌套／寫死的 backdrop-filter 與 glass-on-glass 風險
- 嚴重度：中
- 證據：`DesktopPet.css` 啟用 blur 共 7 處且每處 literal：65（`--surface-blur`）、263（14px）、424（16px）、746（18px）、903（6px，無 `-webkit-` 前綴）、927（14px）、947（12px）；`SetupWizard.css:71`、`ProjectMcpPanel.css:71` 的 scrim `blur(4px)`、`ConfirmDialog.vue:111` `blur(2px)`，三種 scrim 模糊度不同。`.pet-toast`(903) 與其子變體 `.permission-notice`(927)、`.presentation-say`(947) 是同一元素的 class 疊加，會對同一元素宣告兩次 blur（後者覆蓋，但 903 未回退時有層疊疑慮）。`.permission-request`(746) 內含 `.permission-button`，按鈕 hover 用半透明白底（非 backdrop）— 目前尚未嵌套，但無保護。
- 使用者影響：GPU 成本（pet 視窗為透明大窗）、`dev:safe` gpu-safe 模式下行為不一致；blur 強度視覺不一。
- 子任務
  - [ ] 建立 `--blur-bubble`、`--blur-scrim`、`--blur-chip` token（3 個值即可），取代 11 處 literal。
  - [ ] 統一 scrim：ConfirmDialog/SetupWizard/ProjectMcp 共用 `ui/Scrim.vue` 或 `.scrim` mixin。
  - [ ] `.pet-toast` 基底只宣告一次 blur，變體僅改 tint。
  - [ ] 加上缺少的 `-webkit-backdrop-filter`（903 與 scrim 三處）。
  - [ ] 補 StatusPanel.css 的 reduced-transparency 後仍保留不透明底（目前僅 1280 一處）。
  - [ ] 新增測試掃描：同一 selector chain 不得有兩層 backdrop-filter。
  - [ ] 對 `gpu-safe` 模式（`vite --mode gpu-safe`）加 `html[data-gpu-safe]` 一次關閉所有 blur。
- 修改檔案：`DesktopPet.css`、`SetupWizard.css`、`ProjectMcpPanel.css`、`ui/ConfirmDialog.vue`、`tokens.css`

## DS-08 `:focus-visible` 覆蓋不足與 `outline: none` 取代焦點環
- 嚴重度：高
- 證據：`:focus-visible` 全 repo 僅 8 檔；`outline: none` 位於 `Select.vue:61`（僅靠 `--accent-glow` 14% alpha box-shadow，對比約 1.1:1，遠低於 WCAG 2.2 的 3:1）、`StatusPanel.css:1217`（pet-rename-input 只換 border 色，1px）、`DesktopPet.css:875`（permission-button，這個有補 box-shadow）。`.pet-option`（SettingsPets.vue:123，`role="button" tabindex="0"`）、`.plugin-badge-anchor`（DesktopPet.vue:818/896）、`.quota-*` 的 `tabindex="0"` 元素需逐一確認 focus 樣式。PluginPanel 的 7 個原生 input 僅一行共用規則。
- 使用者影響：鍵盤使用者無法判斷目前焦點，尤其下拉與外掛設定輸入。
- 子任務
  - [ ] 全域規則 `:where(a,button,input,select,textarea,[tabindex]):focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset) }` 放入 tokens.css／base.css。
  - [ ] `Select.vue` 用實線 outline 取代 14% 光暈；保留 glow 作為輔助。
  - [ ] `pet-rename-input` 補完整焦點環與 `aria-label`。
  - [ ] 為 `role="button"` 的 `.pet-option`、`.plugin-badge-anchor` 補 `:focus-visible`。
  - [ ] 焦點環顏色於淺色 organic 面板上驗證（`--state-info #9dd8ff` 在 `#f9f4ed` 上約 1.5:1，不合格）→ 新增 `--focus-ring-color-on-light`。
  - [ ] `forced-colors` 下 outline 改 `Highlight`。
  - [ ] 加 Playwright/unit 測試：Tab 走訪每個 view 並截圖 or 斷言 `getComputedStyle(outlineStyle) !== 'none'`。
- 修改檔案：`tokens.css`、`ui/Select.vue`、`ui/Button.vue`、`StatusPanel.css`、`DesktopPet.css`、`PluginPanel.css`

## DS-09 淺色／系統主題缺席，且 reduced-transparency／contrast 不完整
- 嚴重度：中
- 證據：`prefers-color-scheme` 只在 `PluginPanel.css:13`（且是把 organic 色全改成 `Canvas/CanvasText` 的權宜）；StatusPanel 固定暖米色 organic、桌面寵物層固定深色。`prefers-reduced-transparency` 僅 SetupWizard/ProjectMcp/StatusPanel/DesktopPet（4 檔）；`PluginPanel.css`、`ConfirmDialog.vue`（`blur(2px)` 無對應 fallback）、`PetAnimation.css` 沒有。`prefers-contrast: more` 在 ui/ 原語（Button、Card、Select、ToggleRow）全無。`forced-colors` 只有 PluginPanel。
- 使用者影響：在系統深色模式下面板仍是亮米色（刺眼且與 Liquid Glass 文件「adaptive dark/light tint」不符）；高對比使用者在設定頁無 border 強化。
- 子任務
  - [ ] 定義 `[data-theme="light|dark"]` + `prefers-color-scheme` 預設，語意 token 兩套值（見 §視覺語言 v2）。
  - [ ] Settings → Appearance 增加「跟隨系統／淺色／深色」。
  - [ ] ui/ 原語統一加 `@media (prefers-contrast: more)`（border 2px、移除 opacity 降階）。
  - [ ] ConfirmDialog scrim 與 ui/ 其他 overlay 加 `prefers-reduced-transparency`。
  - [ ] 補 `forced-colors: active`（Button、Select、ToggleRow、ProgressTrack 的 fill 需 `forced-color-adjust`/`Highlight`）。
  - [ ] 將 PluginPanel 的 `Canvas` hack 移除，改吃新主題 token。
  - [ ] 對 inactive-window 狀態加 `:root[data-window-blurred]` 淡化（liquid-glass.md 要求驗證）。
  - [ ] 補視覺驗收清單（亮／暗桌布 × 4 種 fallback）進 docs/design。
- 修改檔案：`tokens.css`、`StatusPanel.css`、`PluginPanel.css`、`ui/*.vue`、`App.vue`、`SettingsAppearance.vue`、`src/locales/*.json`

## DS-10 對比度不足（實算 WCAG）
- 嚴重度：高
- 證據（計算值）：深色 `--text-muted #858b9b` on `#12121a` = 5.47（OK）；`--state-idle #666` = 3.24、`--state-offline #555` = 2.50（文字用途則不合格，StatusPanel.css:321 作為狀態點可接受但若有文字標籤則否）；淺色 organic：`--organic-text-muted #82796a` on `#f5ead8` = 3.61、on `#f9f4ed` = 3.92（小字 <4.5）；`--organic-text-faint #a19786` on `#f9f4ed` = 2.63（不合格）；`--organic-accent #c67139` 作文字 on surface = 3.30、按鈕 `#fff2eb` on `#c67139` = 3.29（主要按鈕文字不合格，需 ≥ 4.5，或大字 ≥ 3）。
- 使用者影響：次要說明、時間戳、主要按鈕文字在亮背景難讀，尤其 12–13px。
- 子任務
  - [ ] 調暗 `--organic-text-muted` 至 ≥ 4.5:1（約 `#6b6354`）。
  - [ ] `--organic-text-faint` 僅限裝飾，或調到 ≥ 3:1 並禁止用於文字。
  - [ ] Primary Button：背景改 `--organic-accent-hover #b2622d` 或文字改深色 `#201e1d`，驗證 ≥ 4.5:1。
  - [ ] accent 當文字時一律用 `--organic-accent-text #8c491a`（6.22）。
  - [ ] `--state-idle/offline` 若顯示文字則改 ≥ 4.5 版本；狀態一律搭配文字／形狀（liquid-glass.md 規則「不得只用顏色」）。
  - [ ] 新增 `scripts/check-contrast.mjs`：對 token 配對表計算並在 CI 斷言。
  - [ ] 在 ui-design-system.md 記錄「允許的前景／背景配對表」。
- 修改檔案：`tokens.css`、`ui/Button.vue`、`StatusPanel.css`、新增 `scripts/check-contrast.mjs`

## DS-11 Modal／Dialog 無障礙不一致：只有 ConfirmDialog 有 Esc／focus trap
- 嚴重度：高
- 證據：`ConfirmDialog.vue:33–49` 有 Esc 與 Tab trap（但 selector 只抓 `button`，且無 `aria-describedby`、不還原焦點）；`SetupWizard.vue:164` 與 `ProjectMcpPanel.vue:168` 都是 `role="dialog" aria-modal="true"` 卻**沒有** Esc、focus trap、初始焦點、焦點還原（`grep Escape` 無結果）；`DesktopPet.vue:630` 的 `alertdialog` 權限卡片無 trap（刻意，因為是氣泡，但缺 `aria-describedby` 指向 `#permission-request-description` 可確認）。
- 使用者影響：鍵盤／螢幕閱讀器使用者開啟 Setup 後 Tab 會跑到被遮住的背景；無法按 Esc 離開。
- 子任務
  - [ ] 抽出 `useDialogA11y()` composable：Esc、trap（`button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])`）、初始焦點、關閉後還原觸發元素。
  - [ ] `ConfirmDialog` 改用 composable，補 `aria-describedby` 與 `inert` 背景。
  - [ ] `SetupWizard`、`ProjectMcpPanel` 套用，並改用共用 `ui/Dialog.vue`（含 scrim、動畫、reduced-motion）。
  - [ ] 背景容器於 modal 開啟時加 `inert`／`aria-hidden`。
  - [ ] `PluginPanelDialogs.vue` 檢視是否套用。
  - [ ] 加 unit/e2e：開啟→Tab 循環→Esc→焦點回到觸發鈕。
  - [ ] 關閉鈕 `aria-label` 已存在，補 `title` 一致化（見 DS-14）。
- 修改檔案：`ui/ConfirmDialog.vue`、`SetupWizard.vue`、`ProjectMcpPanel.vue`、`PluginPanelDialogs.vue`、新增 `composables/useDialogA11y.ts`、`ui/Dialog.vue`

## DS-12 Tabs 實作半套：缺 Home/End、僅 `Button` 手動拼 ARIA
- 嚴重度：中
- 證據：`StatusPanel.vue:195–213`（dashboard tabs）與 `:221–237`（settings nav）手寫 `role="tablist/tab"`、roving tabindex、`onTabKeydown`（:83）／`onSettingsKeydown`（:93），兩份重複；settings 的 tab 沒有 `aria-controls`，content 無 `role="tabpanel"`（僅 dashboard 的 3 個 panel 有）；settings-nav 使用 `<nav role="tablist">` 語意衝突（nav landmark 被覆寫）；dashboard 面板用 `v-show`，隱藏 panel 的 tabindex 內容不會被 `hidden` 屬性保護。
- 使用者影響：螢幕閱讀器對設定頁念不出「第 N/共 M 個分頁」對應內容；重複邏輯容易產生行為飄移。
- 子任務
  - [ ] 新增 `ui/Tabs.vue`（含 `TabList/Tab/TabPanel` 或 props 版本），內建方向鍵、Home、End、roving tabindex、`aria-controls/labelledby`、`orientation`。
  - [ ] Settings 側欄改 `orientation="vertical"`（用 ↑↓）。
  - [ ] 移除 `<nav role="tablist">`，改 `<div>`；需要 landmark 時外包 `<nav>`。
  - [ ] settings 內容加 `role="tabpanel"` 與 id。
  - [ ] 隱藏 panel 加 `hidden` 屬性（保留 v-show 效果）。
  - [ ] 補測試：方向鍵、Home/End、焦點跟隨。
  - [ ] 把「active 指示」樣式（底線 or pill）統一為單一 token，目前 `.dashboard-tab.active` 與 `.settings-nav-item.active` 分開寫。
- 修改檔案：`StatusPanel.vue`、`StatusPanel.css`、新增 `ui/Tabs.vue`

## DS-13 英文 UI 字串寫死（含非預期的語言混用）
- 嚴重度：高
- 證據：`DesktopPet.vue:661 "Deny"`、`:671 "Allow once"`（en-US 已有 `permissionAllowOnce` key 302 行卻未使用；`permissionBubbleHelp` 在 zh-TW 也混用 "Allow once / Deny"）；`DesktopPet.vue:662/672 <kbd>Ctrl Shift N/Y</kbd>`（macOS 應為 ⌘/⌃ 且 hotkey 實為全域快捷鍵，字串寫死、無平台判斷）；`desktop-tray.ts:122` 與 `runtime.ts:2423` 標籤 `'Presentation MCP'`、`runtime.ts:2575 'Permission adapter'`（用於 UI？需確認，若顯示給使用者就需 i18n）；`index.html:2 <html lang="en">` 從不隨 locale 更新（zh-TW 時螢幕閱讀器會用英文發音、字型選擇錯誤）。另 `STATE_LABELS` 刻意不翻譯（有文件說明，列為已知決策，不是 bug，但應提供至少 `aria-label` 翻譯）。
- 使用者影響：繁中使用者在最敏感的權限提示上看到英文與平台錯誤的快捷鍵。
- 子任務
  - [ ] `Deny`／`Allow once` 改用 `t('permissionDeny')`（新增）與既有 `permissionAllowOnce`。
  - [ ] `<kbd>` 內容改由 `formatAccelerator()` 依 `navigator.platform`／主行程回傳（mac：`⌃⇧N`，win：`Ctrl+Shift+N`）；數據來自實際註冊的 accelerator 而非寫死。
  - [ ] `watch(locale)` 同步 `document.documentElement.lang`（`zh-TW`/`en`）。
  - [ ] `'Presentation MCP'` 等 tray 標籤加入 locales（品牌詞可保留英文，但要集中在 key 中）。
  - [ ] `permissionBubbleHelp` 兩語系都改成引用翻譯詞而非英文按鈕名。
  - [ ] 新增 unit test：掃描 `.vue` template 文字節點，禁止未經 `t()` 的 `[A-Za-z]{4,}` 字面（白名單：品牌詞）。
  - [ ] 補 `STATE_LABELS` 的 `aria-label` 翻譯（視覺保持英文，閱讀器讀本地化）。
- 修改檔案：`DesktopPet.vue`、`desktop-tray.ts`、`runtime.ts`、`App.vue`、`src/locales/*.json`、`index.html`

## DS-14 Electron 主行程字串寫死繁中，en-US 使用者看到中文
- 嚴重度：高
- 證據：`electron/project-mcp-setup.ts` 29 行（167–494）訊息為中文；`agent-adapter-operations.ts` 17 行（68–130）、`agent-adapter.ts` 6 行（40–125）診斷 check 訊息皆中文；原生對話框 `ipc/history.ts:54 '匯出 History'`、`ipc/pet-assets.ts:124 '選擇寵物素材包…'`、`:228 '選擇 spritesheet…'`、`ipc/project-mcp.ts:36-37`；`i18n.ts:55 '操作失敗'` 寫死。同時 `translateBackendError()`（i18n.ts:49–70）卻預期後端訊息為**英文**再轉中文 → 兩套互相矛盾的約定，`errors.zh-TW.json` 以英文原文為 key。
- 使用者影響：en-US 使用者在 Setup 結果、診斷、檔案選擇對話框看到中文；zh-TW 使用者若走 `translateBackendError` 則看英文→中文，邏輯分裂，也易遺漏。
- 子任務
  - [ ] 決策：後端回傳「訊息代碼＋參數」（`{code:'mcp.codex.installed'}`），renderer 以 `t()` 呈現；停止在主行程寫自然語言。
  - [ ] 為 ~65 行訊息建立 key（`setup.*`、`adapter.check.*`）並補 en-US／zh-TW。
  - [ ] 原生 `dialog.show*` 的 title/message 改走 `tForLocale(getLocale(), …)`（主行程 locale 來源已存在於 tray）。
  - [ ] `errors.zh-TW.json` 逐步淘汰，保留未知錯誤的 fallback。
  - [ ] `i18n.ts:55` `'操作失敗'` 改 `t('operationFailed')`。
  - [ ] 新增 test：electron/**/*.ts 內出現 CJK 字面（非註解、非 locale 檔）即失敗。
  - [ ] Notification（`desktop-notifications.ts`）title/body 確認均走 `t()`（目前 `runtime.ts:1021/1241` 已走，補測試鎖定）。
- 修改檔案：`electron/project-mcp-setup.ts`、`agent-adapter-operations.ts`、`agent-adapter.ts`、`ipc/history.ts`、`ipc/pet-assets.ts`、`ipc/project-mcp.ts`、`src/i18n.ts`、`src/locales/*`

## DS-15 ARIA／螢幕閱讀器缺口
- 嚴重度：中
- 證據：`DesktopPet.vue` 有 4 個 `role="status" aria-live="polite"` 氣泡（682/698/713/741），但 permission 的 `alertdialog` 缺 `aria-describedby`；`SettingsPets.vue:175 role="status"` 用於錯誤（應 `role="alert"`）；全 repo 無 `aria-busy`、`aria-describedby`、`aria-invalid`、`aria-expanded`（折疊區？）；`ProgressTrack` 有 progressbar 但無 `aria-valuetext`（%+重置時間）；`SettingsPets` rename input 無 label；`<img alt="">` 3 處皆為裝飾（OK）；45 個 `title=` 作為唯一名稱來源的情形需確認（部分已搭 aria-label）；`ToggleRow` 的 `help` 是否以 `aria-describedby` 關聯待確認；多個氣泡同時 `aria-live` 可能重複朗讀。
- 使用者影響：使用 VoiceOver／NVDA 的使用者收不到權限描述、錯誤不即時、表單錯誤無法關聯。
- 子任務
  - [ ] permission `alertdialog` 加 `aria-describedby="permission-request-description"`（id 已存在）。
  - [ ] 錯誤訊息容器統一 `role="alert"`，成功／進度 `role="status"`。
  - [ ] `ToggleRow` 的 help 文字以 `aria-describedby` 連結 switch。
  - [ ] `ProgressTrack` 新增 `valueText` prop。
  - [ ] 載入中區塊加 `aria-busy`；列表加 `aria-live` 摘要而非逐項。
  - [ ] 新 `Input` 元件必帶 `aria-invalid`／`aria-describedby`。
  - [ ] 對 4 個 live region 建立單一 `LiveRegion` 佇列，避免重複朗讀。
  - [ ] 以 axe-core 對 Panel／Settings／Plugin 頁跑一次基準掃描並記錄。
- 修改檔案：`DesktopPet.vue`、`SettingsPets.vue`、`ui/ToggleRow.vue`、`ui/ProgressTrack.vue`、`PluginPanel.vue`

## DS-16 缺失的 UI 原語：Tabs／Toast／EmptyState／Skeleton／Badge／Tooltip／Input
- 嚴重度：中
- 證據：Toast 以 `.pet-toast` 在 DesktopPet.css 手刻 4 個變體（permission-notice、presentation-say、timed-toast、plugin-feed-toast）；EmptyState 散落於 `.growth-unavailable`（SettingsGrowth.vue:66/90）、history 空狀態、plugin 空清單，各自樣式；徽章有 `.plugin-badge-anchor`、`.plugin-development-badge`（PluginPanel.css:69）、`.status-line` 徽章（DesktopPet.css:322–336）、`.quota-*`，無共用 `Badge`；Tooltip 靠原生 `title=`（45 處，延遲長、無法觸控、無法樣式化）與 `.quota-tooltip` 自製；Loading 無 Skeleton（`ui/` 只有 8 個元件）。
- 使用者影響：同類元件在不同頁面外觀與行為不一，新功能持續複製貼上。
- 子任務
  - [ ] 新增 `ui/Tabs.vue`（見 DS-12）。
  - [ ] 新增 `ui/Toast.vue` + `useToast()` 佇列（取代 4 個 pet-toast 變體；含 `tone`、`action`、倒數）。
  - [ ] 新增 `ui/EmptyState.vue`（icon、title、description、action）。
  - [ ] 新增 `ui/Skeleton.vue`（line／block／circle，reduced-motion 時靜態）。
  - [ ] 新增 `ui/Badge.vue`（tone: neutral/accent/success/warn/danger；dot／count 變體）。
  - [ ] 新增 `ui/Tooltip.vue`（hover+focus 顯示、`aria-describedby`、Esc 關閉、不超出視窗），取代 45 個 `title=` 的純文字提示。
  - [ ] 新增 `ui/Input.vue`、`ui/Checkbox.vue`（見 DS-05）。
  - [ ] 新增 `ui/Dialog.vue`（見 DS-11）。
  - [ ] 更新 ui-design-system.md 原語表。
- 修改檔案：`src/components/ui/*`、`DesktopPet.vue`、`SettingsGrowth.vue`、`StatusPanelHistory.vue`、`PluginPanel.vue`

## DS-17 `ui/` 內部 CSS 與觸控／熱區不一致，原語本身有缺陷
- 嚴重度：低–中
- 證據：`Button.vue:79-80` icon-only 38×38；`ToggleRow.vue:82` 軌道 28×… `:92` thumb 22；`DesktopPet.css:94 28px`、`:776 24px`、`:1085 22px`；`StatusPanel.css:1054 26px`；`PluginPanel.css:9` 控制鈕 32×32；`ProjectMcpPanel.css:140 30px`。互動熱區在 22–38px 間浮動（WCAG 2.5.8 最小 24×24，建議 32+）。`Button` 使用 `font-family: var(--font-heading, var(--font-ui))` 但 `--font-heading` 未在 tokens.css 定義（僅 `--organic-font-heading`，字體 `Caprasimo`/`Figtree` 全 repo 無 `@font-face`／載入，等於永遠 fallback 到 Georgia／系統字）。`Button` 缺 `loading` 狀態與 `aria-busy`；`Card` 的 tone 有 5 種，文件已警告過度使用。
- 使用者影響：觸控／高 DPI 精準度差；字體設計意圖與實際渲染不符（Caprasimo 並未載入）。
- 子任務
  - [ ] 定義 `--hit-min: 32px`，所有可點擊元素 `min-height/width` 取用。
  - [ ] 22/24/26px 的互動元素擴大熱區（偽元素 `::after` inset -4px）。
  - [ ] 決定字體策略：打包 Caprasimo/Figtree（woff2，注意授權與 THIRD_PARTY_NOTICES）或移除引用，改 system stack。
  - [ ] 補定義 `--font-heading`／`--font-body` token，Button 去除 fallback 鏈。
  - [ ] `Button` 新增 `loading` prop（spinner＋`aria-busy`＋禁用重複點擊）。
  - [ ] `Card` tone 精簡：保留 neutral/accent/danger，其餘用 Badge 表達。
  - [ ] 統一 `transition` 寫法，46 處未用 `var(--transition-*)` 者逐一替換。
  - [ ] 建立 `z-index` scale token（目前 17 處 z-index；PluginPanel.css:3 有 `10000`）。
- 修改檔案：`ui/Button.vue`、`ui/ToggleRow.vue`、`ui/Card.vue`、`tokens.css`、`DesktopPet.css`、`StatusPanel.css`、`PluginPanel.css`、`index.html`

## DS-18 本地化細節：術語、複數、日期格式與 key 治理
- 嚴重度：低–中
- 證據：en-US／zh-TW 皆 534 key、placeholder 全數一致（良好）；但 20 個 key 兩語系值相同（`appName`、`edgePeek`、`presentationMcp`、`achievement*` 等）— 需確認 `achievement*` 是否漏翻（`achievementHelloWorld/GettingSerious/NightOwl/…` 共 9 個值相同）；`TranslationKey` 以 zh-TW 為基準，新增 key 若只加 zh-TW 會在 en 端編譯期報錯（良好），但 key 命名不分 domain（534 個扁平 key）；`toLocaleString(locale.value, …)` 散落 6+ 處（DesktopPet.vue:319、StatusPanelUsage.vue:34/40、SetupWizard.vue:242、usePluginPanelController.ts:897/901）格式選項各自寫；無複數處理（`{count} items` 用字串拼接）；`Intl.RelativeTimeFormat` 未使用。
- 使用者影響：日期格式與相對時間在不同頁面不一致；英文複數錯誤（"1 sessions"）。
- 子任務
  - [ ] 檢視 9 個 `achievement*` 同值 key：若為成就名（梗）可保留，加註解說明；否則翻譯。
  - [ ] 建立 `utils/format.ts`：`formatDateTime/formatTime/formatRelative/formatNumber/formatDuration`，全站取代 `toLocaleString`。
  - [ ] 引入簡單複數 helper（`tPlural(key, count)`，en 用 `_one/_other`，zh 單一形）。
  - [ ] key 命名加 domain 前綴規範（`panel.*`, `plugin.*`, `tray.*`, `error.*`）並寫 codemod 或至少新增 key 遵守。
  - [ ] 詞彙表（Glossary）：Pet／寵物、Session／工作階段、Adapter、Plugin／外掛、Permission／權限，確認 zh-TW 全站一致（目前同時出現「插件」「外掛」需 grep 統一）。
  - [ ] `tests/i18n.test.mts` 增加：未使用 key 偵測、zh-TW 標點全形檢查、key 排序。
  - [ ] 檢查 `trayTooltip` key（en-US:323）是否被使用（desktop-tray.ts 用 `appName`＋`dnd` 拼接，疑似死 key）。
- 修改檔案：`src/i18n.ts`、`src/locales/*.json`、`tests/i18n.test.mts`、新增 `src/utils/format.ts`

## DS-19 無自動化守門：規範靠文件而非 CI
- 嚴重度：高（為上述多數問題的根因）
- 證據：`package.json` scripts 只有 `vue-tsc`＋`vite build`＋`node --test`；無 stylelint／ESLint／axe；`tests/` 僅 `i18n.test.mts`、`plugin-host-token.test.mts` 觸及 UI 規範；文件 ui-design-system.md 要求「手動 grep 裸 hex」。結果：DesktopPet.css 21 hex／58 rgba、未定義變數 6 個、10px 字級皆已溜進主幹。
- 使用者影響：每次改版都可能回歸；審查成本高。
- 子任務
  - [ ] 新增 stylelint（`color-no-hex`、`declaration-property-value-disallowed-list`、`property-no-unknown`、自訂 `no-undefined-var`）。
  - [ ] `scripts/check-tokens.mjs`（未定義／未使用 token）。
  - [ ] `scripts/check-contrast.mjs`（token 配對）。
  - [ ] `scripts/check-i18n-literals.mjs`（.vue、electron CJK/English 字面）。
  - [ ] 引入 `@axe-core/playwright` 或 `vitest-axe` 對主要視圖基準掃描。
  - [ ] 建立 `pnpm check:design` 並接入 `prebuild`。
  - [ ] 視覺回歸：以 Electron `capturePage` 對 Panel 各 tab × 亮／暗 × 4 fallback 產出快照。
  - [ ] 更新 `phase-gates.md`，把以上列為每階段 gate。
- 修改檔案：`package.json`、新增 `.stylelintrc.cjs`、`scripts/check-*.mjs`、`tests/`、`.agents/skills/pet-skill/references/phase-gates.md`

---

# 刷新後視覺語言規格（Visual Language v2）

## 1. Token 變更

```css
/* ── 語意層（唯一被元件引用的一層）── */
:root {
  --color-bg:            /* panel 背景 */;
  --color-surface:       /* 卡片 */;
  --color-surface-2:     /* hover / sunken */;
  --color-text:          --color-text-2 (>=7:1)  --color-text-3 (>=4.5:1)  /* 取消 faint 用於文字 */;
  --color-accent / --color-accent-text (>=4.5:1) / --color-on-accent (>=4.5:1);
  --color-success|warn|danger|info  (+ -bg 淡底, -text 文字版)
  --color-border / --color-border-strong
  --color-focus  /* 依主題：暗 #9dd8ff，亮 #1b5fb0；對比 >=3:1 */
}
/* 主題以 [data-theme="light|dark"] 提供整組值；預設跟隨 prefers-color-scheme */
/* 基礎值層（--palette-*）僅 tokens.css 內部使用；刪除 --organic-* 命名，保留值 */

/* 尺度 */
--space: 4 / 8 / 12 / 16 / 24 / 32       (移除 4.4 小數)
--font:  11 / 12 / 13 / 15 / 18 / 22     (移除 11.5/12.5/13.5/14.5/16/17/19/26)
--leading: 1.2 / 1.4 / 1.55
--radius: 6 / 10 / 16 / pill
--hit-min: 32px
--z: base 0 / sticky 10 / popover 100 / modal 1000 / toast 1100 / system 10000
--blur: chip 8px / bubble 14px / scrim 4px   (+ --blur-none 供 fallback)
--motion: fast 120ms / base 200ms / slow 320ms + --ease-standard: cubic-bezier(.2,0,0,1)
```

規則：
- 元件不得引用 `--palette-*` 或 literal；stylelint 強制。
- `prefers-reduced-transparency`／`contrast: more`／`forced-colors` 由 tokens.css 以「覆寫語意 token」一處處理（`--color-bg` 改不透明、`--blur-*: none`），元件不再各自寫 media。
- 字體：決定是否打包 Caprasimo／Figtree；未打包前 `--font-heading` = `--font-ui`。

## 2. 新增原語（優先序）

| 優先 | 元件 | 取代 |
| --- | --- | --- |
| P0 | `Dialog`（含 `useDialogA11y`） | ConfirmDialog 外殼、SetupWizard/ProjectMcp overlay |
| P0 | `Input` / `Checkbox` | 11 個原生 input、1 個 checkbox |
| P0 | `Tabs` | StatusPanel 兩份手寫 tablist |
| P1 | `Toast` + `useToast` | 4 個 `.pet-toast` 變體 |
| P1 | `Badge` | plugin/dev/status/quota 徽章 |
| P1 | `Tooltip` | 45 個 `title=`、`.quota-tooltip` |
| P2 | `EmptyState` | growth/history/plugin 空狀態 |
| P2 | `Skeleton` | 載入閃爍 |
| P2 | `Button loading`、`ProgressTrack valueText` | — |

## 3. ASCII 元件表

```
Button   [ Primary ]  [ Secondary ]  [ Danger ]  ( ⟲ ghost icon 32x32 )  [ ◌ Loading… ]
         focus ring: 2px solid --color-focus, offset 2px (所有主題 >=3:1)

Input    Label
         ┌─────────────────────────────┐
         │ value                       │   error: border danger + "! 說明" (aria-describedby)
         └─────────────────────────────┘
         help / error text (12px, >=4.5:1)

Select   ┌──────────────────────┬───┐   (native <select>, appearance:none, 2px focus ring)
         │ Option               │ ⌄ │
         └──────────────────────┴───┘

Tabs     ┌ Sessions ┐ Usage   History     ← ←/→ Home End, roving tabindex
         └──────────┘▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔     aria-controls ↔ tabpanel

Badge    ( ● Idle )  ( 3 )  ( DEV )  ( ⚠ Quota 90% )   形狀/文字 + 色，不只靠色

Toast    ┌───────────────────────────────────┐
         │ [icon] Title                  [×] │   role=status|alert, 倒數條 (reduced-motion: 靜態)
         │        Body            [Action]   │
         └───────────────────────────────────┘

EmptyState      [  icon 24  ]
                尚無資料
                說明文字（>=4.5:1）
                [ Primary action ]

Skeleton  ▒▒▒▒▒▒▒▒▒▒▒░░░     (shimmer; reduced-motion → 靜態 50% 不透明)

Tooltip   hover/focus 300ms → ┌───────────┐  aria-describedby; Esc 關閉
                              │ 說明       │  不使用 title=
                              └───────────┘

Dialog    ░░░ scrim (blur 4px, reduced-transparency → 不透明) ░░░
          ┌ Title ─────────────────────[×]┐  role=dialog|alertdialog
          │ body (aria-describedby)       │  Esc / Tab trap / 還原焦點 / inert 背景
          │          [ Cancel ] [ Confirm ]│
          └───────────────────────────────┘
```

## 4. 建議實作順序（階段 gate 對齊 AGENTS.md「一次一個階段」）
1. DS-19 + DS-02（先建守門與修未定義 token）
2. DS-11 + DS-12 + DS-15（無障礙互動層）
3. DS-01 + DS-03 + DS-10（token 統一與對比）
4. DS-13 + DS-14 + DS-18（i18n）
5. DS-05 + DS-06 + DS-16 + DS-17（原語補齊與替換）
6. DS-07 + DS-08 + DS-09 + DS-04（材質、焦點、主題、字級）
