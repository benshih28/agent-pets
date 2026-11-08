# Agent Pets 稽核：Onboarding、Setup 與整合（Integrations）

範圍：`SetupWizard.vue`、`ProjectMcpPanel.vue`、`electron/setup.ts`、`agent-adapter*.ts`、`project-mcp-*.ts`、`ipc/{adapters,integrations,project-mcp,project-pets}.ts`、`integrations/`、`project-routing.ts`、README。
方式：唯讀稽核，所有證據皆為實際程式碼行號。共 **15 個大問題**（ON-01 ~ ON-15），每個 6~8 個子任務。

嚴重度：P0 = 會損毀使用者資料 / 核心流程斷裂；P1 = 明顯影響首次體驗或可靠度；P2 = 品質 / 一致性。

## 總覽

| ID | 標題 | 嚴重度 |
|----|------|--------|
| ON-01 | 沒有真正的首次啟動流程，Setup Wizard 藏在 Settings → Advanced | P0 |
| ON-02 | Hook 安裝遇到壞掉的設定檔會直接覆寫使用者設定（無備份、非原子寫入） | P0 |
| ON-03 | 解除安裝不對稱且會誤傷（刪共用 hook script、整個 hooks.json、殘留 config） | P0 |
| ON-04 | 安裝 / 修復回饋太薄：一個錯誤字串、`Install All` 遇錯即停、結果被重新偵測洗掉 | P1 |
| ON-05 | 健康檢查不檢查真正會壞的地方（node、port、token、版本、agent 是否存在） | P1 |
| ON-06 | 「Test」按鈕只驗證 App 自己，會給出虛假的安心感 | P1 |
| ON-07 | 各 Agent 能力（Permission respond 等）說明不足，README 表格誤導 | P1 |
| ON-08 | Node 路徑解析：同步阻塞、可被 nvm/升級弄壞、失敗回退 `node` 且無提示 | P1 |
| ON-09 | Windows / macOS 跨平台路徑與 quoting 問題 | P1 |
| ON-10 | Project MCP：一次寫三個 client、把本機絕對路徑寫進專案 repo | P0 |
| ON-11 | Project MCP 的衝突 / 過期 / 部分失敗沒有修復路徑，`registry` 失敗卻已寫檔 | P1 |
| ON-12 | 「Project MCP」與「Project Pets」兩套專案概念並存，命名互相混用 | P2 |
| ON-13 | 後端訊息硬編碼 zh-TW，繞過 i18n；英文使用者看到中文，zh-TW 文案混雜英文 | P1 |
| ON-14 | README 與實際行為漂移（路徑、OpenCode MCP 格式、Wizard 位置、Gatekeeper/SmartScreen） | P1 |
| ON-15 | 雙套安裝器（`install.mjs` 與 `setup.ts`）手動同步、無測試覆蓋、無法稽核 | P2 |

---

## ON-01　沒有真正的首次啟動流程（P0）

**證據**
- 全 codebase 無 first-run / onboarding 狀態：`grep firstRun|onboarding|hasSeen|setupCompleted` 在 `src/`、`electron/` 無任何結果。
- Wizard 只有一個入口：`src/components/status-panel/SettingsAdvanced.vue:26`（Settings → Advanced → 「設定精靈」）；`src/App.vue:348` 僅在 `store.showWizard` 時渲染，`agentStore.ts:1466` 只被這個按鈕呼叫。
- README 第一次執行：`README.md:50-53` 要求「點寵物 → ⚙ → Setup Wizard」，但實際位置是 Settings → Advanced，且 README 自己寫「wizard does not do this automatically」（`README.md:52`）。
- 安裝後 Wizard 不告知「現在該做什麼」：只有一行 `adapterNote`（`SetupWizard.vue:257`）與 header 的 `setupWizardHelp`。

**使用者影響**：新使用者開啟 App 看到一隻寵物，永遠是 Offline（因為 hooks 沒裝），完全不知道要去哪裡、為什麼不動；很可能直接解除安裝。

**子任務**
- [ ] 在 settings store 加入 `onboarding.completedAt` / `onboarding.version`（持久化於 main process），首次啟動（或 hooks 全部 `needs_install`）自動開啟引導。
- [ ] 寵物 bubble 在「無任何 agent 事件」時顯示一次性提示：「還沒連到任何 AI 工具，點我完成設定」。
- [ ] Tray menu 加入「設定精靈…」，並在未完成時顯示紅點 / badge。
- [ ] 偵測到 agent 事件從未到達（`lastEventAt` 為空超過 N 分鐘）時，在 Sessions 空狀態顯示 CTA，而不是空白列表。
- [ ] 完成後提供「Replay 導覽」入口（Settings → Advanced），並記錄略過狀態，不重複打擾。
- [ ] 首次流程加入「這隻寵物會做什麼」三張說明（狀態、Permission、成長）— 參見文末新流程設計。
- [ ] 修正 README 第一次執行步驟為實際入口，並附截圖。
- [ ] 新增 e2e（stub safeStorage，避免 Keychain 提示）：全新 profile 啟動 → 引導出現 → 完成後不再出現。

**修復涉及檔案**：`src/stores/agentStore.ts`、`src/App.vue`、`src/components/SetupWizard.vue`（拆成多步）、`electron/main.ts`（onboarding 狀態、tray）、`src/components/status-panel/SettingsAdvanced.vue`、`README.md`、`README.zh-TW.md`、`src/locales/*.json`。

---

## ON-02　Hook 安裝會覆寫損壞 / 非預期格式的使用者設定（P0）

**證據**
- Claude Code：`electron/setup.ts:922-929` — `settings.json` 解析失敗時 `existing = {}`，之後 `writeFileEnsured(settingsFile, ...)`（`:941`）整檔覆寫。使用者原有的 `permissions`、`env`、`model` 等設定全部遺失，且沒有提示。
- Codex：`electron/setup.ts:830-844` — `hooks.json` 解析失敗時 catch 內直接以 `newHooks` 覆寫（`:842-844`），使用者既有 hooks 遺失。
- 非原子寫入：`setup.ts:396-399` `writeFileEnsured` 直接 `writeFileSync`；斷電 / 並行（Claude Code 同時在寫 `settings.json`）會產生半截檔。對比 `project-mcp-setup.ts:74-97` 已經有 temp + rename 的實作，卻沒有被共用。
- 沒有備份、沒有 dry-run、沒有 diff 預覽。
- `addJsonKey` / `removeJsonKey`（`setup.ts:430-444`）無 try/catch，`claude_desktop_config.json` 格式錯誤會讓整個 install 丟出未處理例外。
- JSONC：Claude/OpenCode 設定可能含註解，`JSON.parse` 失敗後走上述覆寫路徑。

**使用者影響**：點一個「Install」可能毀掉使用者多年累積的 `~/.claude/settings.json`。這是最高風險的信任問題。

**子任務**
- [ ] 解析失敗時中止安裝並回報「`<path>` 不是有效 JSON，Agent Pets 未修改它」，提供「開啟檔案位置」。
- [ ] 寫入前建立時間戳備份（`settings.json.agent-pets-bak-<ts>`，保留最近 N 份），並在結果訊息顯示備份路徑。
- [ ] 把 `writeTextAtomic`（temp + `renameSyncWithRetry`）抽成共用模組，`setup.ts` 所有 config 寫入改走它，保留原檔 mode。
- [ ] 寫入前先比對：內容無變化則回報 `unchanged`（供 ON-04 的 idempotency 回饋使用）。
- [ ] 安裝前顯示「將修改這些檔案 / 新增這些 key」預覽（Wizard 步驟「檢視變更」）。
- [ ] `addJsonKey` 等 helper 加入錯誤處理並回傳結構化結果，不再拋出例外。
- [ ] 偵測 JSONC（註解 / 尾逗號）時採用保留註解的編輯方式，或明確拒絕並說明。
- [ ] 單元測試：壞 JSON、空檔、唯讀檔、符號連結、並行寫入，確認不遺失使用者內容。

**修復涉及檔案**：`electron/setup.ts`、新增 `electron/safe-config-write.ts`、`electron/project-mcp-setup.ts`（共用）、`tests/setup-install.test.mts`（新增）。

---

## ON-03　解除安裝不對稱且會誤傷其他整合（P0）

**證據**
- `uninstallCodex`（`setup.ts:857-864`）呼叫 `removeFile(hookScriptPath())`：該 script 是 Codex 與 Claude Code **共用**（`~/.desktop-pet/agent-hook.mjs`，`setup.ts:227-229`）。移除 Codex 會讓 Claude Code hooks 全部變成指向不存在檔案。
- 同一函式 `removeFile(codexHooksPath())`（`:859`）刪除**整個** `~/.codex/hooks.json`，包含使用者自己的 hooks，而非只移除 Agent Pets 條目（對比 `uninstallClaudeCode` 只過濾 Agent Pets hook，`:944-964`，處理正確）。
- `:862` 移除 `codex_hooks = true`，但安裝時寫入的是 `hooks = true`（`:461,475,853`），所以 config.toml 永遠殘留，且 `enableCodexHooksFeature` 還會主動刪除舊 `codex_hooks`（`:452`）。
- `uninstallClaude`（Claude Desktop，`:880-886`）同樣刪共用 script。
- `~/.desktop-pet/` 下的 token（event / permission / presentation）與 `presentation-mcp.mjs` 在任何 uninstall 後都留著。
- UI 層沒有任何 uninstall 入口：`grep uninstall src` 無結果；IPC `adapterUninstall`（`ipc/adapters.ts:40-51`）與 `uninstallIntegrations`（`preload.ts:402`）存在但沒有被呼叫。README 也沒有說明如何移除。
- 專案 MCP 的移除只移除 `.mcp.json` 等條目，不處理全域 hooks。

**使用者影響**：想「暫時關掉 Codex 整合」的人會弄壞 Claude Code；想完整移除 App 的人沒有官方清理路徑，留下 hook 指向被刪除的 App。

**子任務**
- [ ] 共用 hook script 改為引用計數：只有最後一個依賴者被移除時才刪除。
- [ ] `uninstallCodex` 只過濾 Agent Pets hook 條目（沿用 `removeAgentPetsHooks`），hooks.json 空了才刪檔；保留使用者 hooks。
- [ ] 對稱處理 TOML：只移除本 App 寫入的 `hooks = true`（若是本 App 新增才移除，記錄「是否原本就存在」）。
- [ ] Wizard 每張卡片加入「移除」按鈕與確認對話框（沿用 `ConfirmDialog`），顯示將移除什麼、保留什麼。
- [ ] 新增「完整清理 / 解除安裝 Agent Pets 整合」：移除所有 hooks、plugin、token、`~/.desktop-pet`，並列出結果。
- [ ] Windows 解除安裝程式（portable exe 沒有 installer）：至少在 Advanced 提供「移除前先清理整合」提示。
- [ ] README 增加「如何完整移除」章節（含手動步驟與路徑）。
- [ ] 測試：Codex + Claude Code 都安裝後只移除 Codex，Claude Code 仍為 `ready`。

**修復涉及檔案**：`electron/setup.ts`、`electron/agent-adapter-operations.ts`、`src/components/SetupWizard.vue`、`src/preload` 型別、`README*.md`、`tests/`。

---

## ON-04　安裝 / 修復回饋太薄，部分失敗與冪等性不透明（P1）

**證據**
- 單一錯誤字串：`SetupWizard.vue:31,85,90` 僅一個 `installError`，顯示在頁面底部（`:259`），不綁定到哪個工具。
- `Install All` 遇到第一個失敗即 `break`（`:84-87`），其餘工具不嘗試，也不說明「哪些成功、哪些被跳過」。
- 安裝後立即 `detectTools()`（`:93`）會把整個列表換成 loading 畫面（`:176`），並以新物件取代 `tools`（`:59`），因此先前的 `verifiedAt`、`diagnosis`、`testError` 全部消失。
- `install()` 回傳 `status`（`ipc/adapters.ts:33-34`、`agent-adapter.ts:74-77`）但 UI 完全忽略；沒有「已安裝 / 已是最新 / 已修復 / 變更了哪些檔案」的差異。
- 沒有安裝後引導：只有頁首一句 `setupWizardHelp`「安裝 hook 後請重新啟動該工具」（`zh-TW.json:257`），安裝成功後不再出現。
- 按鈕文案：已安裝顯示「重新安裝」（`SetupWizard.vue:230`），但 degraded 時應為「修復」，且沒說明修復了什麼。
- `needs_approval` 健康狀態有翻譯 key（`:133`、`zh-TW.json:280`），但整個 codebase 沒有任何地方產生它（`grep needs_approval electron` 無結果）。

**使用者影響**：按了安裝不知道發生什麼事；失敗時不知道是哪個工具、為什麼、怎麼辦；重複按沒有任何「已經是最新」的確認。

**子任務**
- [ ] 定義結構化結果 `InstallOutcome { adapterId, action: 'installed'|'repaired'|'unchanged'|'failed', changedFiles[], backupPath?, errorCode, hint }`，由 main 回傳。
- [ ] 每張卡片內嵌結果區（成功 / 失敗 / 無變更），錯誤顯示在該卡片而不是頁尾。
- [ ] `Install All` 改為逐項獨立執行並彙總（「2 成功 · 1 失敗」），失敗不中斷其他項目。
- [ ] 重新偵測改為就地更新（保留 `diagnosis`、`verifiedAt`），並以 inline skeleton 取代整頁 loading。
- [ ] 成功後出現「下一步」區塊：「請重新啟動 Codex，然後按『測試』」，並依 agent 顯示不同指示。
- [ ] 按鈕文案依健康狀態：未安裝 → 「安裝」，degraded → 「修復」，ready → 「重新安裝」（弱化）。
- [ ] 錯誤使用 error code + 本地化 hint（權限不足、檔案被鎖、JSON 損壞、HOME 唯讀），不顯示原始 `Error.message`。
- [ ] 移除未使用的 `needs_approval` 或實作其語意（例如 macOS 需要使用者在 agent 內核准 hook）。

**修復涉及檔案**：`src/components/SetupWizard.vue`、`SetupWizard.css`、`src/types/agent-adapter.ts`、`src/types/ipc.ts`、`electron/agent-adapter.ts`、`electron/ipc/adapters.ts`、`electron/setup.ts`、`src/locales/*.json`。

---

## ON-05　健康檢查沒有檢查「真正會壞」的東西（P1）

**證據**（`electron/agent-adapter-operations.ts`）
- `isCodexHooksEnabled`（`:22-25`）：config 存在但完全沒有 `hooks` 設定時回傳 `true`（只檢查沒有 `hooks = false`），造成 false-positive `ready`；config 不存在才為 false。
- OpenCode：只要 CLI **或** Desktop 任一 plugin 存在就 `ready`（`:63-68`）；只裝一邊的使用者被告知全部正常。且完全沒有檢查 plugin 內容是否為目前版本（內嵌 token / port）。
- 不檢查 hook script 內容是否與內建版本一致（`refreshInstalledIntegrationScripts` 會刷新，但 diagnose 不報告「過期」）。
- 不檢查 `node` 是否可執行：`resolveNodeBin` 失敗回退 `'node'`（`setup.ts:63,86`），hook 命令指向不存在的 binary 卻顯示 `ready`。
- 不檢查 event token / 接收埠：hook 固定打 `127.0.0.1:17373`（`integrations/agent-hook.mjs:7`），若埠被佔用，`listenOnLocalPort` 只在 console 重試（`local-server-listen.ts:33-45`），UI 完全看不到；hook 超時 300ms 靜默吞掉（`agent-hook.mjs:140-144`）。
- 不檢查 agent 本身是否存在（`~/.codex`、`~/.claude` 目錄、CLI 在 PATH）。Wizard 頁首宣稱「偵測到執行中的 Agent」（`zh-TW.json:257`）與 README「detect which AI tools are installed」（`README.md:51`）皆不是事實，實際只檢查自己寫的檔案。
- 沒有「最後一次收到該來源事件的時間」，這才是最可信的健康訊號。
- `diagnose` 只回傳 pass / warn / fail 的字串，沒有可操作的 remediation（`SetupWizard.vue:245-252` 只顯示 message）。

**子任務**
- [ ] 修正 `isCodexHooksEnabled`：解析 `[features]` 區段，必須明確 `hooks = true`（或新版 key）。
- [ ] OpenCode 分別回報 CLI / Desktop 狀態（兩顆 chip），只裝一邊為 `degraded` 並提示另一邊。
- [ ] 新增 check：hook script hash 與內建版本比對（`outdated`）、plugin 內 token 與目前 token 一致。
- [ ] 新增 check：解析出的 node 路徑存在且可執行（`node --version`，非同步、含逾時），顯示版本。
- [ ] 新增 receiver check：17373 是否由本實例監聽；被佔用時在 Wizard 以 banner 顯示並指出佔用者。
- [ ] 新增 `lastEventAt` per source，卡片顯示「最近事件：3 分鐘前 / 從未收到」。
- [ ] 每個 check 增加 `remediation`（文字 + 可選的一鍵修復動作）。
- [ ] 將「偵測 agent 是否已安裝」與「整合是否已安裝」拆成兩個獨立欄位並更正文案。

**修復涉及檔案**：`electron/agent-adapter-operations.ts`、`electron/agent-adapter.ts`、`src/types/agent-adapter.ts`、`electron/event-server.ts`、`electron/local-server-listen.ts`、`src/components/SetupWizard.vue`、locales。

---

## ON-06　「Test」按鈕只驗證 App 自己，造成虛假安心感（P1）

**證據**
- `ipc/integrations.ts:38-48`：建立合成 session id `agent-pets-test-<source>-<ts>`，由 main 自己送 `thinking` 事件再等 renderer 收據，2.5 秒後送 `offline`。完全不經過 agent 的 hook。
- 即使 hooks 損壞、node 不存在、檔案被刪，Test 仍會成功並顯示綠色「已驗證 HH:mm」（`SetupWizard.vue:241-243`）。
- 按鈕 title「透過本機 receiver 傳送即時事件」（`zh-TW.json:262`）技術上正確，但標籤「測試」會被理解為測試 agent 整合。真正的說明埋在 `adapterNote` 底部長段文字（`:275`）。
- Test 的啟用條件是 `tool.installed`（`SetupWizard.vue:207`），degraded 時（`installed=false`）無法測試，反而最需要診斷時按鈕被停用。
- 合成事件會在 Sessions 列表短暫出現假 session，也會進入 History / XP 管線的風險（需確認是否被過濾）。
- 沒有「真實端到端驗證」：例如「請在 Codex 執行任意指令，我們等待 30 秒看是否收到事件」。

**子任務**
- [ ] 將現有按鈕改名為「測試接收器」，並把說明移到按鈕旁 tooltip / 說明列。
- [ ] 新增「等待真實事件」模式：進入 30 秒倒數，提示「請到 Codex 執行一個提示」，偵測到該 source 的真實事件即顯示成功。
- [ ] 逾時失敗時給分流建議（hook 未載入？需重啟 agent？node 路徑？埠被占？）。
- [ ] Test 在 `degraded` 狀態也可使用，並與 Diagnose 結果關聯。
- [ ] 確認合成事件不影響 XP / History / achievements / 專案路由，並加測試。
- [ ] 對 Claude Code Desktop vs CLI 分別提供驗證（`CLAUDE_CODE_ENTRYPOINT` 目前只在 hook 內分辨，見 `agent-hook.mjs:18-20`），顯示實際收到的是哪個 source。
- [ ] 測試成功後在卡片保留「最近驗證」狀態（跨重新偵測保留）。
- [ ] 卡片改為單一「驗證連線」流程，把 Test / Diagnose 合併成步驟式結果，避免兩個相似按鈕（`SetupWizard.vue:202-221`）。

**修復涉及檔案**：`electron/ipc/integrations.ts`、`electron/event-server.ts`、`src/components/SetupWizard.vue`、`src/stores/agentStore.ts`、locales、`tests/`。

---

## ON-07　各 Agent 能力說明不足，README 與實際能力不一致（P1）

**證據**
- 能力定義：只有 OpenCode `permissions: 'respond'`；Codex / Claude Code 為 `'observe'`，`permissionModes: []`（`src/types/agent-adapter.ts:15-26`）。
- README Supported Agents 表格（`README.md:28-32`）對三者都顯示 ✅ CLI/Desktop，沒有任何能力差異；Permission Control 僅在 Features 一行寫「OpenCode permission requests can be allowed once or denied」（`README.md:19`）。
- Wizard chips 直接輸出內部字串：`Token: estimated`、`Quota: provider`、`Permission: observe`（`SetupWizard.vue:148-150`）— 未經 i18n、無解釋，「observe」對一般使用者無意義。
- 沒有說明「Codex / Claude Code 在 pet 上看得到等待 Permission，但必須回終端機按核准」。
- `adapterNote` 一段長文字同時混合 Adapter registry、Test 語意、Generic HTTP（`zh-TW.json:275`），是唯一的說明來源。
- Codex Desktop：`setup.ts:106-110` 註解承認只保證 CLI，`README.md:` 的 Note 也說「no separate Codex Desktop hook install」，但 Wizard 的 `sourceLabels` 顯示 Codex Desktop chip（來源由 `SOURCE_LABELS` 產生），暗示已支援。
- Codex hook 不處理 `Notification` → `waiting-input`（`agent-hook.mjs:23-42` 對照 `:54-61`），但 capabilities `waitingInput: true`，能力宣告與實作不符。

**子任務**
- [ ] 以「能力矩陣」重做 Wizard 能力區：每個 agent 顯示 ✓/✗ 列（狀態、工具活動、Permission 回應、用量、等待輸入），用白話文案。
- [ ] 將 `Permission: observe` 改為「可看到 Permission 請求，需在 <工具> 內核准」，`respond` 為「可直接在寵物氣泡允許 / 拒絕」。
- [ ] README 表格新增能力欄位（Permission respond / observe、Quota、Token）並與 `agent-adapter.ts` 單一來源產生（腳本檢查漂移）。
- [ ] 區分 CLI 與 Desktop 的真實支援（Codex Desktop 標示「需自行驗證」或移除 chip）。
- [ ] 修正 `waitingInput` 對 Codex 的宣告，或補上 hook 事件對應。
- [ ] 為每個 agent 新增「為什麼需要重啟」「需要什麼版本」小提示（Codex hooks 需開啟 feature flag）。
- [ ] 能力 chip 與 token/quota 文案全部移入 locale，加 tooltip。
- [ ] zh-TW 校對「observe / respond / provider / estimated」用語，保持與 README「保持技術名詞」的規則一致並附說明。

**修復涉及檔案**：`src/types/agent-adapter.ts`、`src/components/SetupWizard.vue`、`integrations/agent-hook.mjs`、`README.md`、`README.zh-TW.md`、locales、新增 `scripts/check-doc-capabilities`。

---

## ON-08　Node 路徑解析：同步阻塞、易過期、失敗無提示（P1）

**證據**
- macOS/Linux：`execFileSync(shell, ['-ilc','command -v node'], { timeout: 3000 })`（`setup.ts:66-71`）在 main process 同步執行 **互動式登入 shell**，載入使用者的 `.zshrc`（nvm、conda、oh-my-zsh、有時有互動提示或輸出雜訊）；最長阻塞 3 秒，且 IPC 的 install / MCP list 都會呼叫。
- Windows：`where.exe` 同樣同步（`:49-52`）。
- 結果被模組層快取（`cachedNodeBin`，`:27`），nvm/fnm 切換版本或解除安裝該版本後，hook 命令指向已不存在的路徑，但 UI 不會變成 degraded（見 ON-05）。
- 找不到 node 時回傳裸 `'node'`（`:63,86`）並寫入 hook，與註解「GUI app 的 PATH 不含 node，bare node 會靜默失敗」（`:20-26`）自相矛盾，且沒有任何錯誤回報。
- 同一個 node 也被寫入專案 `.mcp.json` 等（见 ON-10），路徑變更後所有專案變 conflict（`project-mcp-setup.ts:148-153,250`）。
- 使用者沒有任何地方可以查看或覆寫 node 路徑。
- `resolveNodeBin` 的註解寫 Windows 不可使用 `process.execPath`（`:32-34`），但 `integrations/install.mjs:36` 在 Windows 回傳 `process.execPath`（那是真 node，沒問題，但兩份邏輯分歧，見 ON-15）。

**子任務**
- [ ] 改為非同步、並行的偵測，並在 Wizard 顯示「偵測到 Node：/path (v22.x)」。
- [ ] 找不到可用 node 時 **拒絕安裝** 並顯示「找不到 Node.js 22+，請安裝後重試」+ 下載連結，而不是寫入 `node`。
- [ ] Advanced 提供「Node 執行檔路徑」覆寫欄位（驗證存在、可執行、版本）。
- [ ] 版本檢查（`node --version` ≥ 設定最低版本），不足時 degraded。
- [ ] 快取加入有效性重驗（`fs.existsSync`）與 TTL；偵測到路徑失效時自動提示「修復」並重寫 hooks。
- [ ] 登入 shell 使用 `-lc`（非互動）優先、失敗再退 `-ilc`，並設定較短逾時與錯誤隔離。
- [ ] 設計「hook 不依賴 PATH」方案：hook 命令改指向 Agent Pets 自帶的 launcher，或用 Electron `ELECTRON_RUN_AS_NODE`（需評估 fuse `RunAsNode` 已關閉，見 `README.md:363`）。
- [ ] 版本切換後自動偵測（App 啟動時比對）並提示修復。

**修復涉及檔案**：`electron/setup.ts`（抽出 `node-resolver.ts`）、`electron/agent-adapter-operations.ts`、`electron/main.ts`、`src/components/status-panel/SettingsAdvanced.vue`、locales。

---

## ON-09　Windows / macOS 路徑、quoting 與平台差異（P1）

**證據**
- Codex 在 Windows 的 hook 命令為 `${hookWrapperPath()} codex`（`setup.ts:784`）—— **未加引號**；若使用者名稱含空白（如 `C:\Users\Jane Doe\.desktop-pet\agent-hook.cmd`），命令會被拆開而失效。macOS 分支有引號（`"${hook}"`），不一致。
- `agent-hook.cmd:6` 將 stdout / stderr 導向 `nul` 並永遠 `exit /b 0`；`node` 路徑被 `.replace('__NODE_EXECUTABLE__', ...)` 直接替換（`setup.ts:492`），路徑含 `&`、`%`、`^` 或非 ASCII（常見的中文使用者名稱）時 cmd 解析會出錯，且錯誤被吞掉。
- `String.prototype.replace` 第二參數的特殊序列：路徑含 `$&` 之類會被當作替換樣式（低機率，但無防護）。
- OpenCode Desktop 路徑 Windows 使用 `app.getPath('appData')`（`setup.ts:103`），Linux 沒有分支（落到 appData）；OpenCode CLI 固定 `~/.config/opencode/plugin`（`:94-96`），Windows 的 `~/.config` 是否為 OpenCode 的實際位置沒有驗證。
- `claudeDesktopConfigPath`（`:120-125`）Linux 與 Windows 共用 appData 路徑；且寫入的 `agent` key 不是 Claude Desktop 設定的已知欄位（`:877`），疑為無效 / 遺留寫入，卻在 `Install All` 預設路徑執行（`:1061-1066`，經由 `installIntegration()` 無 target，其呼叫者為 `integrations.ts:60`）。
- 路徑大小寫：Windows 專案路徑以 `toLowerCase()` 儲存（`project-routing.ts:128`、`project-mcp-registry.ts:35-36`），顯示名稱 basename 因此可能變成全小寫（`Foo` → `foo`）。
- 路徑中 `~` 與 `%USERPROFILE%` 在文件中混用（`README.md:150`、`:244` 與 `:451`）。
- 沒有 Windows ARM / macOS x64 vs arm64 的 node 架構差異檢查（Rosetta 下的 node）。

**子任務**
- [ ] Codex Windows hook 命令改為加引號形式，並加單元測試涵蓋：空白、中文、`&`、`%`、`^`、`'`。
- [ ] `.cmd` wrapper 改在安裝時以 JSON 轉義 / `^` 轉義注入 node 路徑，或改用 `.mjs` 直呼；避免 `.replace` 特殊序列（改函式型 replacer）。
- [ ] 啟用 `.cmd` 的錯誤記錄（寫到 `~/.desktop-pet/hook.log`，限制大小），Wizard 顯示「最近 hook 錯誤」。
- [ ] 驗證 OpenCode CLI 與 Desktop 在 Win / mac / Linux 的實際設定目錄，並在 diagnose 顯示實際解析路徑。
- [ ] 移除或確認 `claude_desktop_config.json` 的 `agent` key；若無效則刪除 `installClaude` 並從預設 `installIntegration()` 拿掉。
- [ ] Windows 顯示名稱保留原始大小寫（只在比對時小寫）。
- [ ] 平台差異矩陣文件（路徑、shell、引號、權限位元）放入 `docs/`，並在 diagnose 的詳細資訊顯示每個實際路徑（可複製）。
- [ ] 在 CI 增加 windows-latest 的 setup 安裝 / 驗證 smoke 測試（含含空白的 HOME）。

**修復涉及檔案**：`electron/setup.ts`、`integrations/agent-hook.cmd`、`integrations/install.mjs`、`electron/project-routing.ts`、`electron/project-mcp-registry.ts`、`tests/`、`.github/workflows/`。

---

## ON-10　Project MCP：一次寫三個 client，並把本機絕對路徑寫進專案 repo（P0）

**證據**
- 無選擇：`installProjectMcp` 對 `PROJECT_MCP_CLIENTS` 全部執行（`project-mcp-setup.ts:536-549`）；UI 沒有任何 client 勾選（`ProjectMcpPanel.vue:186-189` 單一按鈕「選擇專案資料夾」）。只用 Claude Code 的使用者也會得到 `.codex/config.toml` 與 `opencode.json` 新增在專案根目錄。
- 寫入內容含本機絕對路徑：`command = "<nodeExecutable>"`、`args = ["<home>/.desktop-pet/presentation-mcp.mjs"]`（`:115-122`、`:344-358`）。這些設定位於 **專案** 內（`.mcp.json` 常被 commit），會洩漏使用者家目錄 / 使用者名稱，且對隊友無效（路徑不存在）。這也違反專案的「不上傳個人資訊與本機路徑」原則（memory: no-personal-data-upload）。
- UI 完全沒有警告「這些檔案可能被 commit」，也沒有 `.gitignore` 建議。`projectMcpSafetyNote` 只談移除（`zh-TW.json:168`）。
- 新增檔案沒有事先預覽（會建立哪幾個檔、路徑為何）；結果卡片只顯示 client 與狀態，**不顯示 config 路徑**（`ProjectMcpPanel.vue:198-214`，資料裡有 `configPath` 但未呈現）。
- `readJsonRoot` 遇到 `opencode.json` 含註解（JSONC）會丟「不是有效 JSON」（`project-mcp-setup.ts:206-209`），OpenCode 預設設定檔常為 JSONC。
- `MAX_CONFIG_BYTES = 128KB`（`:13`）超過即錯誤，無法解釋。
- 重新寫出 JSON 會重排整份檔案（`JSON.stringify(root, null, 2)`，`:294`），產生大量 diff 且丟失註解 / 格式。
- 前置條件未說明：Claude Code 對專案 `.mcp.json` 首次使用需手動核准；Codex 專案 `.codex/config.toml` 需專案被 trust。README 只寫「Restart the affected agent client」（`README.md:` One-click project setup 段）。

**子任務**
- [ ] 在選擇資料夾後顯示確認步驟：勾選 client（預設依偵測到的 agent 預選）並預覽將建立 / 修改的檔案與內容。
- [ ] 改為寫入使用者層級設定（`~/.claude.json`、`~/.codex/config.toml`）或使用 `${HOME}` / 相對 / launcher 形式，避免專案內出現本機絕對路徑；至少提供選項「僅本機（不 commit）」並寫入 `.git/info/exclude` 或建議 `.gitignore`。
- [ ] 偵測專案為 git repo 且目標檔已追蹤時顯示警告「此檔案已被 Git 追蹤，包含你的本機路徑」。
- [ ] 結果卡片顯示 config 路徑（可複製 / 開啟所在資料夾）與實際寫入的內容摘要。
- [ ] 支援 JSONC（保留註解的最小編輯）或對 JSONC 檔案明確顯示可操作的錯誤。
- [ ] 提高並說明大小上限，或改為串流檢查；錯誤訊息包含大小與上限。
- [ ] 結果頁加入前置條件提示：Claude Code 需在 `/mcp` 核准、Codex 需 trust 專案，並附一鍵複製的驗證指令。
- [ ] 單元測試：路徑含空白 / 中文、已存在其他 MCP server、JSONC、CRLF、唯讀目錄。

**修復涉及檔案**：`electron/project-mcp-setup.ts`、`electron/ipc/project-mcp.ts`、`src/components/ProjectMcpPanel.vue`/`.css`、`src/types/project-mcp.ts`、locales、`README*.md`、`tests/project-mcp-setup.test.mts`。

---

## ON-11　Project MCP 的衝突 / 過期 / 部分失敗沒有修復路徑（P1）

**證據**
- 只要節點路徑或 bridge 路徑改變（App 搬移、升級、nvm 切換），既有條目就與預期不同，被標成 `conflict`（`project-mcp-setup.ts:148-153`、`:250-258`、`:333-341`），而 UI 的唯一動作是「移除 MCP」；且移除也因「內容已變更」而回 `conflict`（`:439-441`、`:489-491`）—— **使用者陷入無法修復也無法移除的死路**（需手動編輯檔案）。
- 結果訊息「專案已有不同的 agent-pets server，因此未修改」（`:257` 等）沒有說明差異（哪個欄位不同）、沒有「更新為目前路徑」選項。
- 部分失敗：安裝完 `.codex/config.toml` 成功、`opencode.json` 失敗時，整體 `ok:false`，UI 只顯示一行「部分設定需要注意」（`zh-TW.json:236`），無重試單一 client 的按鈕。
- 登錄失敗卻已寫檔：`ipc/project-mcp.ts:48-62` 先寫入三個專案檔，之後 `registry.register` 失敗才回 `ok:false` + 錯誤，專案設定已生效但不在清單中（無法管理 / 移除）。
- 專案狀態 `error` 時 `results: []`（`project-mcp-registry.ts:186-195`）且 catch 沒有保留錯誤訊息，UI 顯示「檢查失敗」卻無原因（`ProjectMcpPanel.vue:90-92`）。
- `list()` 每次開啟面板都重寫 registry（`changed = true` 無條件，`:194,205,208-214`），純讀取操作造成磁碟寫入，且對唯讀 / 同步資料夾造成噪音。
- Registry 損壞（`JSON.parse` 丟例外，`:77`）→ 整個列表失敗（`listError`），沒有「重置清單」復原。上限 128 專案時 `register` 丟英文例外（`:149`）。
- `partial` 狀態語意模糊：包含從未安裝過的 client（`not_configured`）。

**子任務**
- [ ] 區分 `stale`（路徑過期，內容結構相同）與真正 `conflict`；為 `stale` 提供「更新路徑」一鍵修復。
- [ ] 衝突卡片顯示 diff（預期 vs 現有 command/args），並提供「保留 / 覆寫（需確認）/ 開啟檔案」。
- [ ] 每個 client 一列，含個別「重試」「移除」「開啟檔案」操作。
- [ ] 先註冊 registry（或兩者交易式處理）；registry 失敗時回報「已寫入但未登錄」並提供補登錄。
- [ ] `error` 狀態保存並顯示錯誤訊息；registry 損壞時提供「重建清單（重新掃描）」。
- [ ] `list()` 僅在內容真的改變時寫入 `lastCheckedAt`，或改記憶體不落地。
- [ ] 清楚定義 `partial`：改為「n/3 已連接」並顯示未設定的 client 是否為使用者選擇。
- [ ] 達到專案上限時顯示本地化訊息與清理建議。

**修復涉及檔案**：`electron/project-mcp-setup.ts`、`electron/project-mcp-registry.ts`、`electron/ipc/project-mcp.ts`、`src/components/ProjectMcpPanel.vue`、`src/types/project-mcp.ts`、locales、tests。

---

## ON-12　「Project MCP」與「Project Pets」兩套專案概念並存且命名混用（P2）

**證據**
- 兩條獨立流程都叫使用者「選擇專案資料夾」：Settings → Advanced 的 MCP 面板（`SettingsAdvanced.vue:21`），與 Settings → Pets → Project pets 的 Add project（`ipc/project-pets.ts:52-80`）。
- MCP 面板的主按鈕使用 Project Pets 的翻譯 key：`ProjectMcpPanel.vue:188` `t('chooseProjectPet')`（字串「選擇專案資料夾」，Help 文案為「選擇要加入 Agent Pets 的專案資料夾」`zh-TW.json:224-225`），語意是「專案寵物」卻用在 MCP 設定。
- 兩個資料來源不同：MCP registry（明文絕對路徑 JSON，`project-mcp-registry.ts`）與 routing SQLite（加鹽雜湊，`project-routing.ts:141-146`）；使用者在一邊新增的專案不會出現在另一邊。專案事件到達時 routing 會自動新增（README 描述 re-added automatically），但 MCP 清單不會。
- Dialog title 來源不一致：Project Pets 使用 `deps.chooseProjectPetTitle()`（i18n），MCP 的 IPC 硬編碼 zh-TW（`ipc/project-mcp.ts:36-37`，ON-13）。
- 沒有地方告訴使用者「連接專案」的整體心智模型：hooks 是全域（不需要連接專案），專案連接只用於 (a) Presentation MCP、(b) 專案專屬寵物。README 的 `Connect an agent project that is already in use`（`README.md:176-216`）又提出第三種手動方法。
- 「Connected」一詞既指 hooks 又指 MCP（`zh-TW.json` `connected`），Wizard 的綠點也叫 connected（`SetupWizard.vue:194`）。

**子任務**
- [ ] 統一資訊架構：新增「專案」頁，一個專案列上同時顯示：自動偵測 / 手動加入、綁定寵物、MCP 狀態（可展開）。
- [ ] 提供共用的「加入專案」入口，並可勾選「同時為此專案設定 Presentation MCP」。
- [ ] MCP 面板使用專屬 key（`projectMcpChooseFolder`）。
- [ ] 專案 registry 對齊：事件偵測到的專案可在 MCP 清單中被提示「尚未連接 MCP」。
- [ ] 在 Wizard 或專案頁增加 3 行說明：「hooks 讓寵物知道狀態（全域）；Project pets 讓每個專案有自己的寵物；MCP 讓 agent 能讓寵物說話」。
- [ ] 避免同詞多義：Wizard 狀態用「已整合」，MCP 用「已連接」，並建立詞彙表（terminology）寫入 ui-design-system。
- [ ] 顯示專案名稱時處理同名 basename（`project-routing.ts:144`），加入父資料夾提示。
- [ ] 隱私一致性：MCP registry 目前存明文路徑，與 routing「不持久化完整路徑」的承諾不一致（`README.md` project pets 段），需在文件說明或改為相同策略。

**修復涉及檔案**：`src/components/ProjectMcpPanel.vue`、新增 `ProjectsPanel.vue`、`src/components/status-panel/SettingsAdvanced.vue`、`SettingsPets*`、`electron/ipc/project-mcp.ts`、`electron/ipc/project-pets.ts`、locales、`ui-design-system.md`。

---

## ON-13　後端訊息硬編碼 zh-TW，繞過 i18n；zh-TW 文案品質不一致（P1）

**證據**
- main process 大量硬編碼繁中：`agent-adapter-operations.ts:68-72,87-92,106-111,126-131`、`agent-adapter.ts:40-44,122-125`、`project-mcp-setup.ts:167,177,197,246,255-257,264,271-276,299,321-340,434-494`、`ipc/project-mcp.ts:36-37`。
- 前端用 `translateBackendError`（`src/i18n.ts:49-72`）處理：`locale === 'en-US'` 時直接回傳 `raw`（`:55`）—— 英文使用者會看到 **中文** 的診斷訊息與健康訊息；zh-TW 時則只對少數英文字串做 exact map，其餘原樣回傳。
- `check.message`（Diagnose 列表，`SetupWizard.vue:251`）與 `tool.message`（`:234`）完全沒有經過 `translateBackendError`，也沒有 i18n key — 純硬編碼。
- 英文 IPC 錯誤（`'Adapter is not installable'` 等）靠 `errors.zh-TW.json` 精確比對；新增錯誤很容易漏。`raw` fallback 回傳英文原文給 zh-TW 使用者。
- 兩個 locale 之間混雜：Wizard 能力 chips（`Token:` / `Quota:` / `Permission:`）完全英文；Wizard note 夾雜 `Adapter registry`、`observe-only`、`Generic HTTP`；`healthDegraded` 為「需要修復」但按鈕為「重新安裝」，用詞不一致。
- 預設 `translateBackendError` 空值回傳硬編碼 `'操作失敗'`（`i18n.ts:53`）。
- `statusMessage: 'Updating Agent Pets status'`（`setup.ts:790`）會顯示在 Codex 終端機，僅英文。

**子任務**
- [ ] 後端改回傳 `{ code, params }`（例如 `codex.hooksFile.missing`），前端以 locale key 呈現；移除 main 內的自然語言字串。
- [ ] Diagnose 檢查項目全部 i18n 化（`checks[].messageKey`），Wizard 以 `t()` 呈現。
- [ ] `translateBackendError` 對 en-US 不再回傳中文；對未知 code 顯示通用訊息 + code，避免洩漏原始英文例外。
- [ ] 加入 locale 完整性測試：所有後端 error code 在兩個 locale 皆有 key。
- [ ] 能力 chip、狀態、說明全部移入 locale；zh-TW 統一詞彙（修復 / 重新安裝、整合 / 連接）。
- [ ] 原生對話框標題（`showOpenDialog`）統一走 `deps` 的 i18n 提供者。
- [ ] Codex 終端顯示的 `statusMessage` 依 App locale 輸出。
- [ ] 校對 zh-TW 用詞（符合 ui-design-system 的保留術語規則）並以 lint 掃描 `electron/**` 中的 CJK 字串。

**修復涉及檔案**：`electron/agent-adapter*.ts`、`electron/project-mcp-setup.ts`、`electron/ipc/*.ts`、`src/i18n.ts`、`src/locales/*.json`、`src/components/SetupWizard.vue`、`tests/`（新增 locale 完整性 / CJK lint）。

---

## ON-14　README 與實際行為漂移（P1）

**證據**
- 第一次執行入口：README「⚙ → Setup Wizard」（`README.md:51`）vs. 實際 Settings → Advanced（`SettingsAdvanced.vue:26`）。同一份 README 後段又寫 Advanced section（`README.md:` Advanced section），自相矛盾。
- README 聲稱 Wizard「detect which AI tools are installed」（`:51`），實際只檢查 Agent Pets 自己寫入的檔案（見 ON-05）。
- OpenCode 專案 MCP 格式：README 說 `opencode.json` 的 `mcp.servers.agent-pets`（One-click project setup 與手動範例），但程式碼寫入 `mcp["agent-pets"]` 並 **遷移 / 判定 `mcp.servers` 為舊格式**（`project-mcp-setup.ts:229-233,262-291,312-324`，訊息「使用舊格式，請重新設定」）。照 README 手動設定的使用者會得到「conflict / 舊格式」狀態。
- README 手動 MCP 範例使用裸 `node`，而 App 本身為避免 PATH 問題一律使用絕對路徑（`project-mcp-setup.ts:396`）；README 又要求「use a real Node.js executable」，但未提供 macOS/Linux 範例（只有 PowerShell）。
- README 沒有 **macOS Gatekeeper / Windows SmartScreen** 說明，雖然明說 builds 目前未簽署（`README.md:407`）；新使用者第一個動作（開啟 App）就會被擋，`grep Gatekeeper|SmartScreen|xattr` 無結果。
- 沒有疑難排解章節：hooks 不生效、埠 17373 被占、node 找不到、Codex hooks 未啟用、Claude Code 需重開。
- 沒有解除安裝說明（見 ON-03）。
- 「Presentation MCP … **Settings → Attention**」（`README.md:` Connect an agent project）與設定段落 sections（Language / Appearance / Desktop / Pets / Growth / Advanced）不一致（`README.md:101`）。
- README 把 Test 描述為「For a configured adapter」，實際條件為 `installed`；Wizard 說明與 README 兩處各自維護。
- `README.md:520` 承認 `install.mjs` 與 `setup.ts` 「kept in sync by hand」。
- README 長度與主題混雜（成長、外掛、安全、開發），First Run 被埋在前 60 行之後的大量功能說明；對 zh-TW 版本需逐項確認是否同步。

**子任務**
- [ ] 重寫 First Run（含截圖）：下載 → 開啟（含 Gatekeeper / SmartScreen 步驟）→ 設定精靈 → 驗證。
- [ ] 新增 Troubleshooting 章節（每個 Diagnose 失敗項對應一節，且與 App 內 hint 共用文案來源）。
- [ ] 新增 Uninstall / 清理章節。
- [ ] 修正 OpenCode MCP 範例為 `mcp.agent-pets`，並說明舊格式遷移；所有路徑改為每平台一份並標示 `~` vs `%USERPROFILE%`。
- [ ] 修正「⚙ → Setup Wizard」「Settings → Attention」等導覽文字，並以腳本檢查 README 中引用的 UI 字串是否存在於 locale。
- [ ] 能力矩陣由 `AGENT_ADAPTER_REGISTRY` 自動產生（見 ON-07）。
- [ ] 把 First Run / 整合 / 疑難排解拆到 `docs/getting-started.md`，README 只留摘要；同步更新 `README.zh-TW.md` 並建立 parity checklist。
- [ ] 在 release workflow 加入文件漂移檢查（README 引用的路徑 / key 是否仍存在）。

**修復涉及檔案**：`README.md`、`README.zh-TW.md`、新增 `docs/getting-started.md`、`docs/troubleshooting.md`、`.github/workflows/release.yml`、`scripts/`。

---

## ON-15　雙套安裝器、無測試、難以稽核（P2）

**證據**
- `integrations/install.mjs`（641 行）與 `electron/setup.ts`（1116 行）重複實作相同的安裝 / 解除安裝邏輯（hooks JSON、TOML、OpenCode plugin 內容），README 承認「kept in sync by hand」（`README.md:520`）；已有分歧：node 解析（`install.mjs:36` vs `setup.ts:31-64`）、常數 / 事件清單各自一份（`install.mjs:61-80` vs `setup.ts:771-899`）。
- `install.mjs` 的 uninstall 與 `setup.ts` 同樣存在 ON-03 的問題（`install.mjs:571` 移除 `codex_hooks = true`）。
- tests 目錄沒有對 `setup.ts` 安裝 / 解除安裝行為的測試（`tests/` 僅 `agent-adapter`、`ipc-adapters`、`ipc-project-mcp`、`project-mcp-*`、`presentation-mcp`）；`agent-adapter.test` 使用 operations stub，無法覆蓋實際檔案修改。
- `setup.ts` 是 god file：視窗狀態、token、plugin 內容字串（約 250 行 template literal）、hooks、TOML 修補全在一起。
- `refreshInstalledIntegrationScripts` 在每次啟動悄悄改寫使用者 home 內的檔案（`setup.ts:1026-1051`），失敗僅 `console.error`，使用者不會知道自動修復有沒有成功。
- 沒有 HOME 隔離的測試輔助（`os.homedir()` 直接使用，`setup.ts:12-14`），難以在測試中模擬。
- `README` 的 Presentation MCP 說明與 `presentation-mcp.mjs` 的 token / 路徑生成分散在多處。

**子任務**
- [ ] 抽出無 Electron 依賴的 `integrations-core`（路徑、hooks 產生、TOML 修補），`setup.ts` 與 `install.mjs` 共用同一份（打包或以 build step 產生）。
- [ ] `homeDir` / `appDataDir` 改為可注入，建立使用 tmp HOME 的整合測試（macOS + Windows 路徑矩陣）。
- [ ] 補測試：全新安裝、重複安裝（冪等）、含使用者既有 hooks、壞 JSON、解除安裝、舊版（Electron execPath）Windows 修復。
- [ ] 將 OpenCode plugin 內容移到獨立模板檔（`integrations/opencode-plugin.js.tpl`），避免巨大字串。
- [ ] 啟動時自動修復結果記錄並可在 Wizard 顯示（「已自動修復 2 項」），失敗時提示。
- [ ] 以 `AGENT_ADAPTER_REGISTRY` 為單一真相，產生 CLI `install.mjs --list` 與文件。
- [ ] CI 增加 `install.mjs` 與 `setup.ts` 輸出一致性測試（相同輸入 → 相同 hooks.json）。
- [ ] 評估淘汰 `install.mjs` 或改為只轉呼叫 App 內建邏輯的薄包裝。

**修復涉及檔案**：`electron/setup.ts`、`integrations/install.mjs`、新增 `electron/integrations-core.ts`、`tests/`、`README.md`。

---

# 新 Onboarding 流程設計

設計原則（沿用 `ui-design-system.md` 的 Liquid Glass）：一次一個決定；永遠可跳過、可重來；先說明、後變更；每個寫入使用者設定的動作都先預覽並可還原；不要求任何憑證；全程中英文同步。

流程共 6 步，約 90 秒。進度點置於頂部。

## 步驟 0：寵物首次氣泡（取代空白寵物）

```
   ┌──────────────────────────────┐
   │ 嗨！我是你的 Agent Pet 🐾    │
   │ 我還沒連到任何 AI 工具。     │
   │  [ 開始設定 ]   [ 稍後 ]     │
   └──────────────┬───────────────┘
                  ▼
               (寵物)
```
- 僅首次、且未完成 onboarding 時顯示；「稍後」會在 Tray 留下提示點。

## 步驟 1：歡迎與它能做什麼

```
┌───────────────────────────────────────────────┐
│ ● ○ ○ ○ ○ ○                         ✕ 略過   │
│                                               │
│   Agent Pets 會看著你的 AI 工具，             │
│   用寵物告訴你它在做什麼。                    │
│                                               │
│   ┌ 狀態 ──────┐ ┌ 通知 ──────┐ ┌ 成長 ─────┐ │
│   │ 思考中/    │ │ 需要你核准 │ │ 完成任務   │ │
│   │ 執行工具/  │ │ 或完成時   │ │ 獲得 XP    │ │
│   │ 閒置       │ │ 提醒你     │ │ 與進化     │ │
│   └────────────┘ └────────────┘ └────────────┘ │
│                                               │
│   🔒 不需要帳號或密碼。只在本機運作。          │
│                                               │
│                              [ 下一步 → ]     │
└───────────────────────────────────────────────┘
```

## 步驟 2：偵測（唯讀，不修改任何檔案）

```
┌───────────────────────────────────────────────┐
│ ● ● ○ ○ ○ ○                                   │
│ 我們找到了這些工具                            │
│                                               │
│  ☑ Claude Code    已安裝 · v2.x  ~/.claude    │
│  ☑ Codex          已安裝 · v0.x  ~/.codex     │
│  ☐ OpenCode       找不到（可略過）            │
│                                               │
│  Node.js  ✓ v22.12  /opt/homebrew/bin/node    │
│           (找不到時：[安裝說明] 並停用下一步) │
│                                               │
│  這一步只讀取，尚未修改任何檔案。             │
│                      [ ← 上一步 ] [ 下一步 → ]│
└───────────────────────────────────────────────┘
```
- 偵測「工具本身是否存在」與「整合是否已安裝」分開顯示（ON-05）。

## 步驟 3：能力說明 + 變更預覽

```
┌───────────────────────────────────────────────┐
│ ● ● ● ○ ○ ○                                   │
│ 每個工具能做到什麼                            │
│                                               │
│              狀態  工具活動  Permission  用量 │
│  Claude Code  ✓      ✓      看得到*      ✓   │
│  Codex        ✓      ✓      看得到*      ✓   │
│  OpenCode     ✓      ✓      可在寵物回應  –   │
│  * 需回到該工具按允許 / 拒絕                  │
│                                               │
│ 將會修改（先備份，可隨時還原）：              │
│  ~/.claude/settings.json   + hooks (8 項)     │
│  ~/.codex/hooks.json       + hooks (7 項)     │
│  ~/.codex/config.toml      hooks = true       │
│  ~/.desktop-pet/           + hook script      │
│                      [ 檢視差異 ]             │
│                      [ ← 上一步 ] [ 安裝 → ]  │
└───────────────────────────────────────────────┘
```

## 步驟 4：安裝（逐項結果，不遇錯即停）

```
┌───────────────────────────────────────────────┐
│ ● ● ● ● ○ ○                                   │
│  Claude Code   ✓ 已安裝                       │
│  Codex         ✓ 已安裝（備份：hooks.json.bak)│
│  OpenCode      ⊘ 已略過                       │
│  Node 路徑     ✓ /opt/homebrew/bin/node       │
│                                               │
│  失敗範例：                                   │
│  Codex  ✕ ~/.codex/hooks.json 不是有效 JSON   │
│         我們沒有修改它。 [開啟檔案] [重試]    │
│                              [ 下一步 → ]     │
└───────────────────────────────────────────────┘
```

## 步驟 5：驗證（真實事件，非合成）

```
┌───────────────────────────────────────────────┐
│ ● ● ● ● ● ○                                   │
│  請重新啟動 Claude Code 與 Codex，            │
│  然後在其中任意送出一個提示。                 │
│                                               │
│  Claude Code   ⏳ 等待事件… 24s               │
│  Codex         ✓ 收到事件（剛剛）             │
│                                               │
│  沒收到？ [ 診斷 ]  ← 顯示：hook 載入、node、 │
│                       埠 17373、token 狀態    │
│  （僅測試接收器：[ 傳送測試事件 ]）           │
│                      [ 略過，稍後驗證 ]       │
└───────────────────────────────────────────────┘
```

## 步驟 6：完成與下一步（選用）

```
┌───────────────────────────────────────────────┐
│ ● ● ● ● ● ●                                   │
│  完成！你的寵物現在會回應 Claude Code 與 Codex│
│                                               │
│  選用：                                       │
│  [ 連接專案 ]  為專案設定專屬寵物 / MCP       │
│                (先預覽檔案，預設不 commit)    │
│  [ 挑選寵物 ]  匯入自訂 spritesheet           │
│                                               │
│  之後可到 設定 → 進階 → 設定精靈 重新執行。   │
│                              [ 開始使用 ]     │
└───────────────────────────────────────────────┘
```

## 常態維護入口（Onboarding 之後）

```
設定 → 整合
┌───────────────────────────────────────────────┐
│ Claude Code  🟢 已連線 · 最近事件 2 分鐘前    │
│   [驗證] [修復] [移除]  ▸ 詳細 (路徑/版本)    │
│ Codex        🟡 需要修復 · node 路徑失效      │
│   [一鍵修復] [移除]                           │
│ OpenCode     ⚪ 未安裝   [安裝]               │
│ ───────────────────────────────────────────── │
│ 專案 (3)                                      │
│  my-app   寵物: Fox   MCP: 3/3  [管理]        │
│  api      寵物: 預設  MCP: 已過期 [更新路徑]  │
│ [ + 加入專案 ]        [ 完整解除安裝整合… ]   │
└───────────────────────────────────────────────┘
```

## 對應關係

| 新流程環節 | 解決問題 |
|-----------|---------|
| 步驟 0、狀態化啟動 | ON-01 |
| 步驟 3 預覽與備份 | ON-02、ON-10 |
| 整合頁「移除」「完整解除安裝」 | ON-03 |
| 步驟 4 逐項結果 | ON-04 |
| 步驟 2、診斷、最近事件 | ON-05、ON-08 |
| 步驟 5 真實事件驗證 | ON-06 |
| 步驟 3 能力矩陣 | ON-07 |
| 跨平台路徑顯示與驗證 | ON-09 |
| 步驟 6 專案選用與統一專案頁 | ON-10、ON-11、ON-12 |
| 全程 i18n code 化 | ON-13 |
| 文件與 App 共用文案來源 | ON-14、ON-15 |

建議實作順序：ON-02 → ON-03 → ON-10 → ON-01 / ON-04 / ON-05 / ON-06（核心體驗）→ ON-07 / ON-08 / ON-09 / ON-11 → ON-12 / ON-13 / ON-14 / ON-15。每階段依專案規範完成功能驗證與安全審查後，停下等待使用者確認再變更版本（涉及 hooks 寫入與專案檔案寫入屬 security-boundary，建議 minor 版本）。
