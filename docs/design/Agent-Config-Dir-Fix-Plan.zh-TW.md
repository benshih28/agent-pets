# 階段計畫：尊重 Agent 設定目錄覆寫（`CLAUDE_CONFIG_DIR`／`CODEX_HOME`）

> 狀態：已實作（重構階段 1，`35f6cb9`，隨 1.13.0 發布，見[階段記錄](../phase-reports/refactor-01-agent-config-dirs.md)） · 基準：`main` @ 404ab6f，版本 1.12.5 · 建議版號：**patch（1.12.6）**，理由是修正 adapter 的安裝與讀取位置，沒有改變公開契約、持久化 schema 或安全邊界。
>
> 來源：[共用模組抽取評估](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 10 項。

## 1. 目標

使用者以環境變數把 Claude Code 或 Codex 的設定目錄移到別處時，Agent Pets 的 hook 安裝、偵測、quota 與本機用量都要讀寫同一個目錄。沒有設定這些變數的使用者，行為必須與現在完全相同。

不在本階段範圍：

- 其他本機通訊契約（評估文件第 8、9 項）。
- 設定頁讓使用者手動指定目錄（見第 9 節，留待需求確認）。
- 專案層級的 `.claude/`、`.codex/`、`opencode.json`：它們位於專案內，不受這些變數影響。
- Claude Desktop 的 `claude_desktop_config.json`：位於系統 appData，與 `CLAUDE_CONFIG_DIR` 無關。

## 2. 已驗證事實（2026-11-10）

| 項目 | 結果 | 來源 |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | 設定後所有 `~/.claude` 路徑改到該目錄，含 `settings.json`、`.credentials.json`、`projects/` | Claude Code 官方文件（settings、claude-directory） |
| `CLAUDE_CONFIG_DIR` 格式 | 文件要求絕對路徑；專案與 local settings 不能設定它 | Claude Code 官方文件（env-vars） |
| `CODEX_HOME` | Codex state 的根目錄：config、auth、logs、sessions；目錄必須已存在 | Codex 官方文件（environment-variables） |
| Codex `hooks.json` | **跟著 `CODEX_HOME`**：`<CODEX_HOME>/hooks.json` 的 hook 實際觸發，`[features] hooks = true` 讀 `<CODEX_HOME>/config.toml`，sessions 寫到 `<CODEX_HOME>/sessions` | 第 0 步實測（codex-cli 0.163.0）；原始碼 `codex-rs/hooks/src/engine/discovery.rs` 以 config layer 資料夾 `join("hooks.json")` |
| Codex hook 信任 | 新 hook 要在 `config.toml` 的 `[hooks.state."<hooks.json 路徑>:<event>:<i>:<j>"]` 有相符的 `trusted_hash` 才會在 `exec` 執行；鍵含完整路徑，所以換 `CODEX_HOME` 後要在 Codex 互動介面重新信任一次 | 第 0 步實測；`codex-rs/config/src/fingerprint.rs` |
| OpenCode | 全域設定目錄是 `$XDG_CONFIG_HOME/opencode`（Windows 也一樣），未設定時 `~/.config/opencode`；`plugin/` 與 `plugins/` 都會載入並執行；`OPENCODE_CONFIG_DIR` 是**額外疊加**的目錄，不取代全域目錄，所以不處理（處理反而會讓插件載入兩次） | 第 0 步實測（opencode 1.19.3：`debug paths`、`debug config` 與會寫標記檔的插件） |
| Claude Code 實測 | `<CLAUDE_CONFIG_DIR>/settings.json` 的 `SessionStart`、`SessionEnd` hook 在未登入時也會觸發；`projects/` 建立在該目錄 | 第 0 步實測（Claude Code 2.1.321，暫存目錄，未複製憑證） |
| 本機可實測 | `codex-cli 0.163.0`、Claude Code `2.1.321`、`opencode 1.19.3` 皆已安裝；四個相關變數目前都未設定 | 本機檢查 |

### 第 0 步：實作前必須實測

1. **Codex `hooks.json`**：建立暫存目錄當 `CODEX_HOME`，複製 `auth.json`（不改原檔），放一個只寫標記檔的 hook，執行一次 `codex exec`，確認 hook 是否觸發。同時確認 `config.toml` 的 hooks feature 開關也要放在該目錄。
2. **Claude Code**：以暫存 `CLAUDE_CONFIG_DIR` 放一個寫標記檔的 `SessionStart` hook，執行 `claude -p`，確認從該目錄讀取。不複製憑證時預期會要求登入，只看 hook 是否觸發即可；若 hook 需登入後才觸發，改為記錄為文件依據，不在實測中處理憑證。
3. **OpenCode**：讀 OpenCode 1.19.x 原始碼的 global path 解析，確認是否使用 `XDG_CONFIG_HOME` 或 `OPENCODE_CONFIG_DIR`，以及 `plugin/` 與 `plugins/` 是否都掃描。
4. **macOS GUI 環境**：記錄為殘餘風險（本機是 Windows，無法實測）。

第 0 步若推翻任一假設，先更新本計畫再實作。OpenCode 若無法確認，本階段只處理 Claude Code 與 Codex。

## 3. 受影響入口（已盤點）

| 檔案 | 位置 | 目前 | 改為 |
|---|---|---|---|
| `electron/setup.ts` | `claudeCodeSettingsPath()` | `~/.claude/settings.json` | `<claudeDir>/settings.json` |
| `electron/setup.ts` | `codexHooksPath()`、`codexConfigPath()` | `~/.codex/…` | `<codexHome>/…`（`hooks.json` 視第 0 步） |
| `electron/setup.ts` | `agentPresence()` | 檢查 `~/.codex`、`~/.claude` | 檢查解析後的目錄 |
| `electron/setup.ts` | `openCodeCliPluginPath()` | `~/.config/opencode/plugin/` | 視第 0 步 |
| `electron/quota.ts` | `codexAuthPath()` | 自行讀 `CODEX_HOME` | 改用共用 resolver |
| `electron/quota.ts` | Claude 憑證 | `~/.claude/.credentials.json` | `<claudeDir>/.credentials.json`（macOS Keychain 路徑不變） |
| `electron/quota.ts` | `claudeBinaryCandidates()` | 含 `~/.claude/local` | 保留原路徑，另加 `<claudeDir>/local`（安裝位置與設定目錄不一定相同） |
| `electron/local-usage.ts` | 掃描來源 | `~/.codex/sessions`、`~/.claude/projects`、`~/.claude/transcripts` | 解析後的目錄 |
| `electron/project-mcp-setup.ts` | 使用者層偵測 | `homeDirectory/.codex`、`.claude`、`.config/opencode` | 解析後的目錄（專案層不變） |
| `electron/agent-adapter-operations.ts` | 安裝檢查 | 經由 `setup.ts` 路徑函式 | 自動跟著改 |
| `integrations/install.mjs` | CLI 安裝 | 經由 `setup.ts` | 自動跟著改；CLI 在 shell 中執行，看得到變數 |

`scripts/bench/phase-18.mjs` 使用自建的假 home，不需修改。

## 4. 設計

### 4.1 共用 resolver：`electron/agent-config-dirs.ts`

不依賴 Electron 的純模組，依賴以參數注入，方便測試：

```ts
interface AgentConfigDirDeps {
  env: Record<string, string | undefined>
  homeDir: string
  platform: NodeJS.Platform
}

interface ResolvedConfigDir {
  path: string
  source: 'env' | 'default'
  /** 有設定但無效而被忽略時，記錄變數名稱供診斷顯示；不記錄值。 */
  ignored?: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'
}

export function resolveClaudeConfigDir(deps: AgentConfigDirDeps): ResolvedConfigDir
export function resolveCodexHome(deps: AgentConfigDirDeps): ResolvedConfigDir
export function resolveOpenCodeConfigDir(deps: AgentConfigDirDeps): ResolvedConfigDir // 視第 0 步
```

環境變數的接受規則（任一不符就回退預設值並標記 `ignored`）：

- 去除前後空白後非空、不含 NUL、長度不超過 1024。
- `path.isAbsolute()` 為真；不展開 `~` 或相對路徑（與 Claude Code 文件一致，避免猜測）。
- 以 `path.resolve()` 正規化。
- `CODEX_HOME` 必須是已存在的目錄（Codex 本身的規則）；`CLAUDE_CONFIG_DIR` 不存在時不自行建立目錄，安裝流程回報錯誤，而不是寫到預設位置。

agent 家族與變數名稱的對照放在這個模組內，不加到 `AGENT_FAMILY_REGISTRY`：registry 是 renderer 也會載入的資料表，而設定目錄只屬於主行程的檔案系統操作（與 `docs/dev/agent-sources.md`「hook 這一側要另外改」一致）。

### 4.2 環境變數從哪裡來

| 執行方式 | 是否看得到 shell 中的變數 | 做法 |
|---|---|---|
| CLI（`integrations/install.mjs`） | 是 | 直接用 `process.env` |
| Windows GUI | 是（使用者／系統環境變數會繼承；終端機中臨時 `set` 的不會） | 直接用 `process.env` |
| macOS／Linux GUI | 通常否（只繼承 launchd／session 環境） | `process.env` 沒有時，詢問 login shell 一次 |

login shell 查詢沿用 `electron/node-resolver.ts` 的既有模式（`$SHELL -lc`，逾時 2 秒，失敗即放棄），只印出這幾個變數，以 NUL 分隔：

```sh
printf '%s\0' "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$XDG_CONFIG_HOME"
```

- 只讀這幾個變數，不讀整個環境，也不寫回 `process.env`。
- 結果快取在主行程；啟動時非同步預取，不阻塞啟動。
- 安裝、解除安裝與升級改寫 hook 前要 `await` 預取結果，避免在查詢完成前寫到預設位置。quota 與 local usage 在查詢完成前用 `process.env` 的結果，完成後下一輪掃描自然改用新路徑。
- 查詢失敗時視為未設定，行為等同現在。

### 4.3 安裝、偵測與解除安裝

- **安裝**：只寫到解析後的位置。
- **偵測**：只看解析後的位置。若預設位置也有我們的 hook，偵測結果附帶 `staleLocation`，UI 提示「舊位置仍有 Agent Pets hook，可移除」。
- **解除安裝**：解析後位置與預設位置都移除我們標記的項目（沿用既有只移除 Agent Pets 項目的邏輯），因為使用者可能在安裝後才設定變數。
- **啟動時升級改寫**（`rewriteInstalledAgentPetsHooks`）：只改解析後的位置；預設位置的殘留不自動改寫，避免在使用者沒要求時修改他們不再使用的檔案。

### 4.4 UI

在 Agent 整合設定的各家族卡片中，路徑不是預設值時顯示一行說明，例如「設定目錄：`D:\claude-work`（來自 `CLAUDE_CONFIG_DIR`）」；變數被忽略時顯示原因（例如「`CODEX_HOME` 不是存在的絕對路徑，已改用預設位置」）。

- 新增文案同時提供 zh-TW 與 en-US，透過 `src/i18n.ts`。
- 路徑以現有元件顯示並處理長文字截斷（phase-gates「Overflow in dynamic list rows」）。
- 沿用 `src/components/ui/` 既有元件，不新增視覺樣式。

## 5. 執行步驟

1. 第 0 步實測，結果寫回第 2 節。
2. 新增 `agent-config-dirs.ts` 與單元測試（先寫測試）。
3. login shell 查詢與快取，含逾時與失敗測試。
4. 改 `setup.ts` 的路徑函式、`agentPresence()`、解除安裝與 stale 偵測；補 `setup-install.test.mts`。
5. 改 `quota.ts`、`local-usage.ts`、`project-mcp-setup.ts`；補各自測試。
6. 透過 adapter inspection IPC 傳出 `source`／`ignored`／`staleLocation`，更新 preload 型別與 UI。
7. 更新 `docs/dev/agent-sources.md`、兩份 README 的安裝說明。
8. 執行 phase gates，撰寫 `docs/phase-reports/fix-agent-config-dirs.md`，停下等使用者確認版號。

## 6. 驗收條件

- 未設定任何變數：所有路徑、安裝結果與測試輸出與 1.12.5 相同（以既有測試與新的「預設路徑不變」測試證明）。
- 設定 `CLAUDE_CONFIG_DIR`：hook 寫入 `<dir>/settings.json`，Claude Code 實際觸發 hook 並讓寵物變更狀態；quota 讀到 `<dir>/.credentials.json`；用量頁讀到 `<dir>/projects`。
- 設定 `CODEX_HOME`：`config.toml` 與 `hooks.json`（依第 0 步）寫入該目錄，Codex 實際觸發 hook；用量頁讀到 `<CODEX_HOME>/sessions`。
- 無效值（相對路徑、不存在的 `CODEX_HOME`、含 NUL）回退預設值並在 UI 說明，不寫入其他位置。
- 安裝後才設定變數：偵測顯示舊位置殘留；解除安裝兩處都清除。
- 以 Electron 實機（Windows）驗證上述流程，不以 type-check 或 HTTP 204 代替。

## 7. 測試計畫

| 層級 | 內容 |
|---|---|
| 單元 | resolver：未設定、有效絕對路徑、相對路徑、`~` 開頭、空白、NUL、過長、`CODEX_HOME` 不存在、Windows 與 POSIX 路徑 |
| 單元 | login shell 輸出解析：正常、空值、逾時、非零結束、多餘輸出 |
| 整合 | `setup-install`：以假 home 與假變數安裝、偵測、解除安裝、stale 偵測、升級改寫 |
| 整合 | `quota`、`local-usage`、`project-mcp-setup`：解析後路徑 |
| 實機 | Windows 上以使用者環境變數啟動 packaged／dev app，各 agent 實際送出一次事件 |
| 回歸 | 全部既有測試、`vue-tsc --noEmit`、`vite build` |

## 8. 安全審查重點

- **寫入目標由環境變數決定**：只接受絕對路徑；寫入仍走既有 `safe-config-write.ts`（大小上限、備份、原子 rename、symlink 政策不變）。環境變數由使用者本人設定，與 agent 本身讀取的位置相同，不擴大信任範圍。
- **login shell 執行**：固定指令字串、不帶任何外部輸入、逾時 2 秒。預設只用非互動的 `-lc`；node-resolver 另有 `-ilc` 後備，是否沿用需先評估互動 shell 設定檔（例如啟動時印出訊息或執行其他程式）的副作用。
- **資訊揭露**：診斷與錯誤訊息只記錄變數名稱與 `source`，路徑經既有 `diagnostics/redact.ts` 處理；UI 顯示完整路徑僅限本機設定頁。
- **憑證**：Claude 憑證讀取位置改變但讀取方式不變；不新增寫入憑證的程式。
- **解除安裝**：只移除帶 Agent Pets 標記的項目，兩個位置都適用。

## 9. 待使用者決定

1. **macOS／Linux 是否做 login shell 查詢**（建議：做）。不做的話，從 Dock 啟動的使用者仍會遇到問題，只能靠 CLI 安裝；做的話多一個啟動時的子程序（已有 node-resolver 先例）。
2. **是否另外提供手動指定目錄的設定**（建議：本階段不做）。偵測與提示足以涵蓋大部分情況，手動設定需要新的持久化欄位與驗證，可另開階段。

## 10. 殘餘風險（預期）

- macOS／Linux 的 GUI 環境無法在本機實測，login shell 查詢的行為以單元測試與 node-resolver 既有經驗為依據。
- 使用者在 app 執行中修改環境變數，需重新啟動 app 才會生效。
- Codex 或 Claude Code 未來改變目錄規則時需要跟著調整；第 0 步的實測版本會記錄在階段報告中。
