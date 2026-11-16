# 重構階段 1：Agent 設定目錄修正（`CLAUDE_CONFIG_DIR`／`CODEX_HOME`）

- **開始時間**：2026-11-10 09:20（Asia/Taipei）
- **完成時間**：2026-11-10 10:10（Asia/Taipei）
- **基準 commit**：`345a100`（分支 `claude/refactor-01-config-dirs-0ede82`，版本 1.12.5）
- **計畫**：[Agent-Config-Dir-Fix-Plan.zh-TW.md](../design/Agent-Config-Dir-Fix-Plan.zh-TW.md)
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 10 項
- **使用者決定**：macOS／Linux GUI 啟動時向 login shell 查詢環境變數（計畫 4.2）；手動指定目錄本階段不做。

## 範圍

使用者以 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`（以及 OpenCode 依第 0 步結果）改變 agent 設定目錄時，hook 安裝、偵測、解除安裝、quota、本機用量與專案 MCP 偵測都改讀寫解析後的目錄。未設定變數時行為與 1.12.5 相同。

不在範圍：其他本機通訊契約、手動指定目錄、專案層 `.claude/`／`.codex/`／`opencode.json`、Claude Desktop `claude_desktop_config.json`。

## 驗收條件

1. 未設定任何變數：既有測試全過，新增「預設路徑不變」測試。
2. `CLAUDE_CONFIG_DIR`：hook 寫入 `<dir>/settings.json`；quota 讀 `<dir>/.credentials.json`；用量讀 `<dir>/projects`、`<dir>/transcripts`。
3. `CODEX_HOME`：`config.toml` 與 `hooks.json`（依第 0 步）寫入該目錄；用量讀 `<CODEX_HOME>/sessions`；quota 讀 `<CODEX_HOME>/auth.json`。
4. 無效值（相對路徑、`~`、不存在的 `CODEX_HOME`、NUL、過長）回退預設並在 UI 說明，不寫入其他位置。
5. 安裝後才設定變數：偵測顯示舊位置殘留；解除安裝兩處都清除。
6. macOS／Linux：`process.env` 未設定時以 login shell 查詢一次（逾時 2 秒、失敗即放棄、不寫回 `process.env`）；安裝前 `await` 結果。
7. `vue-tsc --noEmit`、`vite build`、相關單元測試、`git diff --check` 通過；Windows 上以 Electron 驗證可行部分。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 0 | 第 0 步實測（Codex `hooks.json`、Claude Code、OpenCode 原始碼） | 通過 | 三者皆以暫存目錄實測，見「第 0 步實測結果」 |
| 1 | 共用 resolver `electron/agent-config-dirs.ts` 與單元測試 | 通過 | `tests/agent-config-dirs.test.mts` 11 項 |
| 2 | login shell 查詢與快取（含逾時、失敗測試） | 通過 | 單元測試 + 以 Git Bash 實際執行查詢指令，正確取回含空白的值 |
| 3 | `setup.ts` 路徑、`agentPresence()`、解除安裝、stale 偵測 | 通過 | `tests/setup-install.test.mts` 新增 7 項，共 19 過 1 skip（原本就 skip） |
| 4 | `quota.ts`、`local-usage.ts`、`project-mcp-setup.ts` | 通過 | local-usage、project-mcp-setup 各新增 1 項測試；quota 路徑函式未匯出，以 code review 確認 |
| 5 | adapter inspection 傳出 `source`／`ignored`／`staleLocation`，UI 與 i18n | 通過 | 隔離 Electron 實機驗證，見「Electron 實機驗證」 |
| 6 | 文件（`docs/dev/agent-sources.md`、兩份 README、計畫第 2 節） | 通過 | |
| 7 | Phase gates（型別、建置、測試、diff、Electron 實機、安全審查） | 通過 | 見「驗證證據」「安全審查」 |
| 8 | Code review 與收尾記錄、commit | 通過 | 見「Code review 紀錄」；commit 於分支 `claude/refactor-01-config-dirs-0ede82` |

## 第 0 步實測結果（2026-11-10）

全部只用 scratchpad 下的暫存目錄，未修改 `~/.claude`、`~/.codex`、`~/.config/opencode`；測完已刪除暫存目錄（含 Codex 測試用的 `auth.json` 副本）。

| 項目 | 方法 | 結果 |
|---|---|---|
| Codex `hooks.json` 跟隨 `CODEX_HOME` | 暫存 `CODEX_HOME` 放 `config.toml`（`[features] hooks = true`）、`hooks.json`（`SessionStart`／`UserPromptSubmit`／`Stop` 寫標記檔）、`auth.json` 副本，執行 `codex exec` | 未信任時三個 hook 都不執行；在暫存 `config.toml` 寫入依 Codex 原始碼算法計算的 `trusted_hash` 後，三個 hook 都顯示 `Completed` 並寫入標記檔。sessions 寫到 `<CODEX_HOME>/sessions`。 |
| Codex hook 信任 | 以使用者既有、已信任的項目（唯讀）驗證 `trusted_hash` 算法：對 `{event_name, hooks:[{async:false, command, statusMessage, timeout:600, type}]}` 排序鍵後的緊湊 JSON 取 SHA-256 | 算法吻合。信任鍵含 `hooks.json` 完整路徑，所以改 `CODEX_HOME` 後要在 Codex 重新信任；本階段不代替使用者寫入信任狀態（那等同替使用者核准執行指令）。 |
| Claude Code `CLAUDE_CONFIG_DIR` | 暫存目錄放 `settings.json`（`SessionStart`、`SessionEnd` 寫標記檔），執行 `claude -p`，不複製憑證 | 輸出「Not logged in」，但兩個 hook 都觸發並寫入標記檔；`projects/`、`sessions/` 建立在暫存目錄。 |
| OpenCode | `XDG_CONFIG_HOME`、`OPENCODE_CONFIG_DIR` 各指向暫存目錄，`plugin/`、`plugins/` 各放一個載入時寫標記檔的插件，執行 `opencode debug paths`、`opencode debug config` | `XDG_CONFIG_HOME` 使 config 變成 `<XDG>/opencode`（Windows 亦然）；`OPENCODE_CONFIG_DIR` 不改 config 路徑，而是額外載入；四個插件都被列入 `plugin` 並實際執行。 |
| macOS／Linux GUI 環境 | 無法在本機（Windows）實測 | 列為殘餘風險。 |

結論：計畫第 3 節的假設成立。OpenCode CLI 插件改用 `$XDG_CONFIG_HOME/opencode/plugin/`；`OPENCODE_CONFIG_DIR` 不處理。

## 設計摘要

- `electron/agent-config-dirs.ts`（新增，不依賴 Electron）：`AGENT_CONFIG_DIR_SPECS` 一張表定義三個家族的變數、預設位置與規則；`resolveAgentConfigDir()` 是純函式。值必須是絕對路徑（Windows 要有磁碟機代號或 UNC，`\foo`、`D:foo` 不算），不含 NUL、不超過 1024 字元、前後沒有空白；`CODEX_HOME` 另外必須是已存在的資料夾。空字串視同未設定。無效值回退預設位置並帶 `ignored` 原因（只描述形狀，不帶值）。
- 主行程的解析結果 `currentAgentConfigDirs()` 以 home 與三個變數值為鍵快取 2 秒，避免檢查畫面一次呼叫多個路徑函式時重複 `stat`。
- login shell 查詢 `createAgentConfigEnvironment()`：只在非 Windows 且三個變數有缺時執行一次 `$SHELL -lc`（固定指令、2 秒逾時、64 KB 輸出上限、stdin 關閉），以哨兵加 NUL 分隔解析，設定檔多印的內容不會被當成值；`process.env` 優先，不寫回 `process.env`；失敗即視為未設定。不用 `-ilc` 後備。
- 安裝前以 `writableAgentConfigDir()` 檢查：變數有設定卻不能用、或 `CLAUDE_CONFIG_DIR` 不存在時丟 `AgentConfigDirError`，在寫入任何檔案（含 token 與 hook 腳本）之前就拒絕；安裝結果的錯誤碼是 `config_dir_unusable`，只回報變數名稱。
- 解除安裝清除解析後與預設兩個位置的 Agent Pets 項目；Codex 舊位置只移除 hook，不動 `config.toml`（標記檔無法分辨是在哪個資料夾加的 `hooks = true`）。啟動時的升級與修復只改解析後位置，並延到 login shell 查詢完成後才執行，不阻塞啟動。
- 偵測：`AdapterDetection.configDir`（`variable`、`path`、`source`、`ignored`、`staleLocation`）經既有 adapter IPC 傳到設定精靈；卡片只在變數生效、被忽略或舊位置有殘留時多顯示一行，長路徑以 `overflow-wrap: anywhere` 換行。
- Claude quota：憑證檔與 `/usage` CLI 都跟著 `CLAUDE_CONFIG_DIR`；只從 login shell 取得的值會明確帶給 CLI 子程序。macOS Keychain 讀法不變。
- 本機用量：`LocalUsageReader` 新增 `configDirs` 選項，每輪掃描開始時讀一次。

## Electron 實機驗證（Windows 11，隔離 HOME）

以 `scripts/e2e-isolated-electron.mjs --agent-config-dirs` 啟動隔離 app（三個變數指向隔離 HOME 內的 `moved/`），沒有碰使用者的設定目錄、正式埠或憑證。

| 驗證 | 方法 | 結果 |
|---|---|---|
| 真實 Claude Code hook 送達寵物 | `scripts/e2e-real-hook.mts --agent-config-dirs`：安裝後從 `<HOME>\moved\claude\settings.json` 讀出 hook 指令並執行 | `all 8 hook events rendered as expected`（SessionStart 到 SessionEnd 的狀態與動畫列都正確） |
| app 回報的設定目錄 | 面板 CDP 呼叫 `checkIntegration()` | 三個 adapter 的 `configDir.source` 都是 `env`，路徑正確；預設位置事先放一份舊的 Claude 安裝，回報了 `staleLocation` |
| 設定精靈畫面 | 開啟設定精靈並擷取 Claude Code 卡片 | 顯示「設定目錄：…（來自 CLAUDE_CONFIG_DIR）」與舊位置警告；長路徑正常換行，警告沿用 `--organic-accent-text` 與 warning icon |
| 經 app IPC 安裝與移除 | `installAdapter('claude-code')`、`uninstallAdapter('claude-code')` | 安裝只寫入 `moved\claude\settings.json`；移除後兩個位置的 settings.json 都清除（保留既有備份檔） |
| Codex、OpenCode 安裝位置 | `installAdapter('codex')`、`installAdapter('opencode')` | Codex 寫入 `moved\codex\hooks.json` 與 `config.toml`；OpenCode CLI 插件寫入 `moved\xdg\opencode\plugin\desktop-pet.js` |

為了讓驗證能在 Windows 執行，順帶修正兩支 e2e 腳本原有的 Windows 問題：`e2e-real-hook.mts` 改用 `pathToFileURL` 動態載入模組，並給 hook 子程序 `USERPROFILE`（原本只給 `HOME`，Windows 上 hook 會去讀真實家目錄的 token）；`e2e-isolated-electron.mjs` 以 `app.setPath('appData', …)` 指到隔離 root（原本在隔離 USERPROFILE 下，`integration-status` 會因取不到 appData 而失敗）。

使用者回饋：驗證過程中把面板視窗顯示到前景，打擾到使用者工作。之後的截圖改為螢幕外加 `showInactive()`，能用 DOM 文字驗證就不截圖。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1297 項：1266 過、8 失敗、23 skip。8 個失敗在基準 `345a100` 也一樣（以 HEAD 的暫存 worktree 對照），都是本機環境問題：Windows 建立 symlink 的 EPERM（pet-import、hook-config、project-mcp-setup 的 git helper），以及 permission-adapter-server 1 項、agent-hook-delivery 2 項；與本階段無關 |
| 本階段新增與相關測試 | agent-config-dirs、setup-install、local-usage、agent-adapter、agent-adapter-operations、ipc-integrations、onboarding-i18n 共 63 項全過；project-mcp-setup 新增的測試通過 |
| `pnpm.cmd run check:design:strict` | 通過（rawColors 0、unused 0、rawControls 0） |
| `pnpm.cmd run check:contrast` | 通過 |
| `git diff --check` | 通過 |
| `pnpm.cmd audit --prod` | No known vulnerabilities found |
| diff 機密掃描 | 無命中（金鑰、token、私鑰樣式） |

## 安全審查

- **寫入目標由環境變數決定**：只接受絕對路徑，不展開 `~`，不接受相對路徑或 Windows 磁碟機相對路徑；無效值不寫入任何位置。寫入仍走 `safe-config-write.ts`（大小上限、備份、原子 rename、symlink 政策不變）。變數由使用者本人設定，也正是 agent 自己讀取的位置，沒有擴大信任範圍。
- **login shell**：固定指令字串、沒有任何外部輸入、非互動 `-lc`、2 秒逾時、64 KB 輸出上限、stdin 關閉、不寫回 `process.env`；`SHELL` 不是絕對路徑時改用 `/bin/zsh`（macOS）或 `/bin/sh`。Windows 不執行。
- **IPC**：沒有新增 channel。`installIntegrations` 與 `uninstallIntegrations` 改為 async，先等目錄解析；sender 檢查與 payload 驗證不變。新增的 `configDir` 只是主行程給 renderer 的唯讀輸出。
- **資訊揭露**：錯誤碼與錯誤訊息只帶變數名稱，不帶值；完整路徑只顯示在本機設定精靈。
- **憑證**：讀取位置跟著變數，讀取方式不變；沒有新增寫入憑證的程式。Codex token 更新仍寫回 Codex 自己使用的 `auth.json`。第 0 步實測複製的 `auth.json` 只放在 scratchpad 暫存目錄，測完已刪除。
- **解除安裝**：兩個位置都只移除帶 Agent Pets 標記的項目。
- **Codex hook 信任**：本階段不替使用者寫入 `[hooks.state]` 信任雜湊；那等同替使用者核准執行指令，仍由 Codex 自己的介面詢問。
- **e2e 隔離**：`--agent-config-dirs` 只放行與隔離 root 內完全相同的變數值；其他 `CLAUDE*`、`CODEX*` 等變數仍會讓隔離檢查中止。

## Code review 紀錄

- 新語法：`as const satisfies Record<…>`（`AGENT_CONFIG_DIR_SPECS`、`AGENT_PETS_INSTALL_FILE`、`CONFIG_DIR_IGNORED_KEYS`）、具名 tuple 回傳型別、`Object.hasOwn`、`??=`、optional chaining；沒有新增 `!` 非空斷言或 `as` 轉型。
- 效能：解析結果短暫快取，避免重複 `stat`；本機用量每輪掃描只解析一次；設定精靈以 `computed` Map 一次算好每張卡片的說明，模板不重複呼叫；事件熱路徑沒有新增同步 I/O。
- 風格：新註解用繁體中文、只寫「為什麼」；renderer 文案放在 `src/locales/onboarding/*.json` 與 `errors.zh-TW.json`；沿用 `Icon` 與既有 token，沒有新視覺元件；家族與變數的對照只放在主行程的 `AGENT_CONFIG_DIR_SPECS`，沒有加進 renderer 也會載入的來源 registry。
- 自行修正：初始快照改為凍結，與查詢後的快照一致，並移除多餘的中間狀態。

## 殘餘風險

1. **macOS／Linux GUI 未實測**：login shell 查詢只以單元測試，以及用 Git Bash 實際執行同一段指令驗證；fish 等非 POSIX shell 的 `printf` 行為未實測（失敗時視為未設定，行為等同 1.12.5）。
2. **macOS Keychain**：設定 `CLAUDE_CONFIG_DIR` 時，Claude Code 可能使用不同的 Keychain 項目名稱；本階段依計畫維持原讀法，quota 可能讀到預設目錄的登入。`/usage` CLI 後備會帶正確的 `CLAUDE_CONFIG_DIR`。
3. **Codex 重新信任**：換 `CODEX_HOME` 後，Codex 會要求重新信任 hook；信任前 `codex exec` 不會執行 hook。README 已說明。
4. 執行中修改環境變數，要重新啟動 app 才生效。
5. Linux 上 OpenCode Desktop 插件路徑沿用 Electron 的 appData；若 `XDG_CONFIG_HOME` 只存在於 login shell，Desktop 與 CLI 插件可能落在不同位置（Desktop 位置與 1.12.5 相同）。
6. quota 讀 `CODEX_HOME` 的行為小幅改變：以前會照用相對路徑或不存在的值，現在回退預設位置並在卡片說明（Codex 本身也拒絕這些值）。
7. 本機 8 個既有的失敗測試（Windows symlink 權限等）不在本階段處理。

## 版本建議

本階段單獨看屬於 **patch**：修正 adapter 的安裝與讀取位置，沒有改變持久化 schema；新增的 `configDir` 是選填欄位，`config_dir_unusable` 是新的錯誤碼，都向後相容。依整體排程，全部重構階段完成後統一升 **minor**，本階段不改版號。

## 檔案變更狀態

| 路徑 | 類型 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-01-agent-config-dirs.md` | 新增 | 本階段記錄 |
| `docs/design/Agent-Config-Dir-Fix-Plan.zh-TW.md` | 修改 | 寫回第 0 步實測結果與狀態 |
| `electron/agent-config-dirs.ts` | 新增 | 共用 resolver、login shell 查詢、主行程快取、安裝前檢查 |
| `electron/setup-environment.ts` | 修改 | seam 新增 `agentConfigEnv`、`agentConfigEnvReady` |
| `electron/setup.ts` | 修改 | 路徑函式改用解析後目錄；安裝前檢查；兩處解除安裝；`agentConfigDirStatus()`；啟動刷新拆出 `refreshAgentConfigIntegrations()` |
| `electron/agent-adapter.ts` | 修改 | inspection 與 detection 帶 `configDir`；install、uninstall 先等 `ready()` |
| `electron/agent-adapter-operations.ts` | 修改 | 三個家族回報 `configDir`，接上 `ready` |
| `electron/install-outcome.ts` | 修改 | `AgentConfigDirError` 對應 `config_dir_unusable` |
| `electron/ipc/integrations.ts` | 修改 | 舊版安裝與移除 IPC 先等目錄解析 |
| `electron/main.ts` | 修改 | 建立環境查詢並預取；延後刷新 agent 設定目錄內的檔案 |
| `electron/main/runtime.ts` | 修改 | 本機用量讀解析後目錄 |
| `electron/local-usage.ts` | 修改 | `configDirs` 選項 |
| `electron/quota.ts` | 修改 | Codex `auth.json`、Claude 憑證、CLI 候選路徑與 CLI 環境跟著變數 |
| `electron/project-mcp-setup.ts` | 修改 | 使用者層偵測跟著變數 |
| `src/types/agent-adapter.ts` | 修改 | `AdapterConfigDirStatus`、變數與原因型別、`config_dir_unusable` |
| `src/components/SetupWizard.vue`、`src/components/SetupWizard.css` | 修改 | 卡片顯示設定目錄、被忽略的原因、舊位置殘留 |
| `src/locales/onboarding/zh-TW.json`、`src/locales/onboarding/en-US.json` | 修改 | 新文案（繁中、英文） |
| `src/locales/errors.zh-TW.json` | 修改 | 舊版 IPC 錯誤訊息的繁中翻譯 |
| `tests/agent-config-dirs.test.mts` | 新增 | resolver 與 login shell 查詢，共 11 項 |
| `tests/setup-install.test.mts` | 修改 | 預設不變、變數生效、拒絕無效值、舊位置與兩處移除等 7 項；測試不再受本機變數影響 |
| `tests/local-usage.test.mts`、`tests/project-mcp-setup.test.mts` | 修改 | 各 1 項 |
| `scripts/e2e-isolated-electron.mjs` | 修改 | `--agent-config-dirs`；隔離 appData |
| `scripts/e2e-real-hook.mts` | 修改 | `--agent-config-dirs`；Windows 動態載入與 `USERPROFILE` |
| `README.md`、`README.zh-TW.md` | 修改 | 搬移設定目錄的說明與疑難排解 |
| `docs/dev/agent-sources.md` | 修改 | 指向 `AGENT_CONFIG_DIR_SPECS` |
