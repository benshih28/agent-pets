# UX Overhaul 安全審查（Security gate）

- 審查範圍：`git diff main..feat/ux-overhaul`（383 個檔案，其中 `electron/`、`integrations/`、`scripts/`、`.github/` 為重點；`tests/`、`docs/`、`src/locales` 僅抽查）
- 依據：`.agents/skills/pet-skill/references/phase-gates.md`（Security gate）與 `project-map.md`「Existing security controls to preserve」
- 方法：唯讀靜態審查。未執行 App、未修改任何原始碼、未觸碰 `.claude/`。
- 日期：2026-11-07

## 結論摘要

| 嚴重度 | 數量 |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 10 |
| Info | 7 |

沒有發現可直接造成遠端或跨信任邊界攻擊的 Critical/High 問題。既有的核心控制（sender 驗證、loopback + token、外部導覽封鎖、外掛同意流程、設定檔不覆寫不可解析檔案等）都保留下來，部分還被收緊（見最後一節「verified OK」）。Medium 項目集中在：風險分級的 fail-open 解析、`.git` 指標未限制範圍、DB 自動復原會悄悄放棄歷史、以及版本號與自動發版流程。

依賴稽核：`pnpm audit --prod` 已連線執行，結果 `No known vulnerabilities found`。`package.json` 只有 scripts 與版本變更，`pnpm-lock.yaml` 沒有變動，沒有新增相依套件。

Secret 掃描：對 diff 新增行（排除 lockfile 與 tests）以常見金鑰格式（AWS/GitHub/OpenAI/Slack/Google/JWT/PEM）及 `/Users/<name>` 絕對路徑掃描，無命中。測試檔中的 `ghp_abcdef...`、`AKIAABCDEFGHIJKLMNOP`、`sk-abcdef...` 皆為 redaction 單元測試用的假值。`tsconfig.node.tsbuildinfo` 在 diff 內被改動（main 上本來就有追蹤），內容只有相對路徑，無 home 路徑；見 I-6。

---

## Medium

### M-1 風險分級對 MCP 前綴與分隔字元 fail-open，與註解宣告相反

- 位置：`electron/permission-risk.ts:24-38`（`toolBaseName`、`classifyPermissionRisk`），影響 `electron/permission-broker.ts`（`isHotkeyRisk`、`hotkeyEligible`）與 `electron/permission-hotkeys.ts`
- 問題：檔頭註解說「renamed tools、new tools、MCP-wrapped tools 都是 `high`」，但 `toolBaseName` 把名稱用 `__`、`:`、`.`、`/`、`\`、空白切開後只取**最後一段**。因此 `mcp__anyserver__read`、`foo:list`、`rm -rf x list`（含空白）都會被判為 `low`，並取得全域快捷鍵 `Ctrl/Cmd+Shift+Y` 核准資格。
- 攻擊情境：持有 permission token 的本機程序（或名稱不受控的 OpenCode 工具）送出 `permission = "mcp__evil__read"`，description 看起來無害；使用者在別的 App 內按下全域快捷鍵就核准了實際上會寫檔或連網的動作。因為快捷鍵設計就是不看 UI 即可核准，分類錯誤的代價比 UI 按鈕高。
- 備註：舊版 `classifyRisk` 對含 `read` 的名稱給 `medium`，同樣可熱鍵核准，所以不算新退步；但新版註解與實作不一致，且新版把 `unknown` 排除出熱鍵資格是正向收緊。
- 建議：
  1. `READ_ONLY_TOOLS` 改為與**完整**小寫名稱精確比對（`read`/`glob`/`grep`/`list`），不做前綴剝離；含 `__`、`:`、`/`、空白的名稱一律 `high`。
  2. 若要支援已知 MCP 伺服器，改用明確 allowlist（`server+tool` 組合）。
  3. 補測試：`mcp__x__read`、`a b list`、`x/read` 必須為 `high`。

### M-2 `.git` 檔案的 `gitdir`／`commondir` 未限制範圍，可使 `info/exclude` 寫到任意目錄

- 位置：`electron/git-tracking.ts:17-34`（`findGitLocation`）、`:74-93`（`addLocalExcludes`）；呼叫端 `electron/project-mcp-setup.ts` `installProjectMcp` 的 `localOnly` 區塊
- 問題：專案根目錄的 `.git` 若是檔案，內容 `gitdir: <path>` 直接 `path.resolve(projectPath, …)`，只要求目錄存在；再讀該目錄下的 `commondir` 檔並 `path.resolve`。沒有驗證結果位於專案內、是否為真正的 git 目錄（有 `HEAD`）、或 `gitdir` 回指是否一致。`addLocalExcludes` 接著 `mkdirSync(<commonDir>/info, {recursive:true})` 並寫入 `<commonDir>/info/exclude`。只有 `exclude` 檔本身有 lstat 檢查，`info` 目錄若是 symlink 會被跟隨；寫入也不是 atomic。
- 攻擊情境：使用者在 Project MCP 面板選了一個不受信任的 repo（例如剛 clone 的專案）並勾選「僅本機（localOnly）」。repo 內的 `.git` 檔指向其自帶的偽 gitdir，偽 gitdir 內的 `commondir` 指向 `~/任意目錄`。Apply 之後 Agent Pets 會在該任意目錄建立 `info/exclude` 並附加 `# Agent Pets local MCP config…` 與 `/.mcp.json` 等行。內容受限，但這打破了「apply 只寫入使用者在對話框選的資料夾」這個不變條件，是任意目錄的建檔／附加原語。`readTrackedPaths` 也會去讀該目錄的 `index`（有 64MB 上限，僅用於比對路徑，不外洩）。
- 建議：
  1. 解析後 `realpath`，要求 `gitDir` 與 `commonDir` 包含 `HEAD` 檔，並且 `<gitDir>/gitdir` 回指目前專案的 `.git`（git 自己 worktree/submodule 的雙向約定）；`commonDir` 必須是 `gitDir` 本身、或 `gitDir` 底下 `commondir` 解析後仍含 `objects/`。
  2. 寫入前 `lstat` 檢查 `info` 目錄不是 symlink；改用 `writeTextAtomic`。
  3. 讀 `.git` 檔使用 `O_NOFOLLOW`／regular file 檢查（已有 size ≤ 4096）。

### M-3 `openWithCorruptionRecovery` 對任何開啟失敗都把整個 history DB 搬走重建

- 位置：`electron/main/db-recovery.ts:12-40`，呼叫處 `electron/main/runtime.ts:2720`（`createHistoryServices`）；與 `electron/history.ts` v6 遷移互動
- 問題：`open()` 只要丟出任何例外（SQLITE_BUSY/鎖、磁碟暫時滿、權限、**v6 遷移中途失敗**、甚至使用者降版後遇到較新 schema）就會把 `history.sqlite`、`-wal`、`-shm` 改名為 `.corrupt-<ts>` 並建立全新空 DB。使用者看到的是「歷史、成就回溯基準全部歸零」，且沒有任何提示；舊資料留在 `.corrupt-*` 檔但沒有回復入口，也不會被「Clear History」清除（隱私留存問題）。
- 攻擊／風險情境：非惡意，但屬於資料完整性與可用性風險；若有人能讓 DB 暫時無法開啟（例如另一個程序持有鎖），Agent Pets 會主動放棄歷史。v6 遷移包含 `DELETE FROM daily_stats` 與重建，失敗時不應走到「搬走整個 DB」。
- 建議：
  1. 只對可判定為損毀的錯誤（`SQLITE_CORRUPT`、`SQLITE_NOTADB`）才搬移；`SQLITE_BUSY`/`EBUSY`/`EACCES`/`ENOSPC` 應重試或回報而不是重建。
  2. 遷移前先複製一份 `history.sqlite.pre-v6`（保留 1 份）。
  3. 重建後以 Notification／面板提示一次；`.corrupt-*` 設保留上限（例如 3 份）並納入 Clear History/完整清理。

### M-4 版本號被改為 1.7.36，違反 phase gate，且合併到 main 會自動發版

- 位置：`package.json:3`（`1.4.6` → `1.7.36`）、`.github/workflows/release.yml`
- 問題：`AGENTS.md` 與 `phase-gates.md`「Confirmation and version gate」要求在使用者確認前不得更動版本；patch 為預設、minor 需有明確理由。此分支直接跳到 `1.7.36`（minor 三級＋ patch 多級），且 release workflow 偵測 `package.json` 版本與遠端 tag 不同就會建 tag 與 GitHub Release（未簽章的 macOS/Windows 產物）。
- 風險情境：PR 合併到 main 的瞬間就會對外發佈，繞過「使用者確認後才變更版本」的人工關卡。
- 建議：從本分支還原版本號到 `1.4.6`，待 phase 報告取得使用者確認後再在獨立 commit 內升版（依 gate 決定 minor/patch）。release workflow 可考慮加上 `environment:` 保護或需要 `workflow_dispatch`。

---

## Low

### L-1 Windows 節點解析使用 `where.exe`（會先搜尋目前工作目錄），且每次啟動會靜默改寫使用者的 Claude 設定

- 位置：`electron/node-resolver.ts:101-117`（`shellInvocations`、`pickFromOutput`）；`electron/setup.ts:794-829`（`rewriteInstalledAgentPetsHooks`、`repairWindowsInstalledHooks`），啟動時由 `refreshInstalledIntegrationScripts`（`electron/setup.ts`、`electron/main.ts:319`）呼叫
- 問題：`where.exe node.exe` 的搜尋順序是**目前目錄優先**，再 PATH。`pickFromOutput` 取第一個「絕對路徑且存在」的結果。若 App 從攻擊者可寫入的資料夾（例如 Downloads 解壓的可攜版）啟動，旁邊的 `node.exe` 會被選中並被寫入 `~/.claude/settings.json` 的 hook `command`。Windows 的修復流程在每次啟動都會 `resolveSync()` 並在路徑不同時覆寫 hook（有備份，但沒有使用者同意）。macOS/Linux 無此問題（`SHELL -lc 'command -v node'`）。
- 建議：以 `cwd` 設為系統目錄呼叫 `where.exe`，或改用解析 `PATH` 自行比對；拒絕位於 `process.cwd()`、App 目錄、下載資料夾內的候選。啟動時的 hook 改寫僅在偵測到「舊版 Electron execPath 遞迴啟動」這個已知壞狀態時才做，不因 node 路徑變動而覆寫。

### L-2 hook 命令的 shell 引用不足（POSIX `$`、反引號；Windows `%`）

- 位置：`electron/hook-config.ts:298-308`（`codexHookCommand`、`escapeCmdQuotedPath`）
- 問題：註解宣稱雙引號可避免「cmd/sh metacharacters 改變命令」，但 POSIX 的雙引號內 `$()`、反引號、`\`、`"` 仍會被 shell 解釋，Codex 的命令是 shell 形式字串；Windows 的 `codexHookCommand` 回傳 `"<wrapper>" codex`，wrapper 路徑中的 `%` 沒有跳脫（`.cmd` 內容已用 `escapeCmdQuotedPath` 處理，但 JSON 內的命令未處理）。Claude Code 用 exec 形式 `{command,args}`，不受影響。
- 攻擊情境：使用者名稱或 home 路徑含 `$`、反引號（macOS 允許）時命令被截斷或展開；惡意情境需要攻擊者能控制使用者 home 路徑，現實風險低。
- 建議：POSIX 改用單引號並將 `'` 轉為 `'\''`；路徑含無法安全引用的字元（`"`、換行、NUL）時拒絕安裝並回報 `config_unsafe`。Windows 命令字串遇 `%` 時拒絕或改用 8.3 短路徑。

### L-3 匯入 spritesheet 沒有最大尺寸上限

- 位置：`electron/pet-sprite-validation.ts:75-83`（`validateSpriteSheet`）；呼叫於 `electron/ipc/pet-assets.ts:198、248`
- 問題：只檢查寬高是 192×208 的整數倍且至少 9 列，沒有上限。一個高壓縮比的 PNG/WebP（幾 KB，宣告為 192×N 的極大尺寸）會通過檔案大小檢查，載入時由 renderer 解碼，造成記憶體耗盡（自我 DoS，需使用者匯入惡意寵物包）。
- 建議：加上像素上限（例如寬 ≤ 192×32、高 ≤ 208×64，且總像素 ≤ 16M）；WebP VP8L/VP8X、PNG 都能在標頭讀到尺寸，無需解碼。

### L-4 permission audit JSONL：trim 計數只存在記憶體、無啟動時修剪

- 位置：`electron/permission-audit.ts:11-20、52-57`
- 問題：`appendsSinceTrim` 是行程內變數，每次重啟歸零；若 App 每次運行少於 100 筆就結束，檔案會跨啟動無上限成長，且 `readPermissionAudit` 一次讀入整檔。`trimPermissionAudit` 用 `renameSync`（沒有 `renameSyncWithRetry`），Windows 上被防毒鎖住時會丟出例外並被上層 `console.error` 吞掉；暫存檔沒有 `fsync`。舊的 `permission-audit.json` 不會被遷移或刪除（殘留一份舊的審計資料）。內容本身已限制為 action（≤80 字、已 redact）與 risk，沒有 description 或參數。
- 建議：啟動時（或第一次寫入前）以檔案大小為條件修剪；`readPermissionAudit` 對檔案設上限（例如 512KB）；改用 `renameSyncWithRetry`；啟動時一次性刪除或遷移舊 `permission-audit.json`。

### L-5 事件速率限制器在追蹤表滿載時放行，且每個 session 預算可被輪換 sessionId 繞過

- 位置：`electron/event-rate-limit.ts:45-62`（約 `:50` 的 `if (counters.size >= maxTracked) return true`）、`electron/event-server.ts`
- 問題：先通過 token 驗證才會到這裡（需持有 event token），所以僅限已授權呼叫者。追蹤表滿 500 個 session 之後，新 session 的事件全部放行（只剩全域 2000/10s 的 `allowRequest`）；攻擊者也可輪換 `sessionId` 讓每個 session 都有新的 500/60 預算。與舊版全域 500/10s 相比，單一失控 hook 現在可以送更多事件，但後端有 `MAX_QUEUED_EVENTS=1000` 與優先權丟棄保護。
- 建議：表滿時改成對「overflow」共用一個桶子限速（而非直接 `true`）；另外保留一個不依賴 sessionId 的全域事件預算（不只是請求預算）。

### L-6 `project-mcp-remove` 不限制於已追蹤／本次選過的資料夾；`looksLikeOurs` 放寬到任何指向 `presentation-mcp.mjs` 的條目

- 位置：`electron/ipc/project-mcp.ts:~160-175`（`projectMcpRemove`）、`electron/project-mcp-setup.ts:353-368、637`
- 問題：`projectMcpApply` 正確限制為本次對話框選過或已在 registry 的資料夾，但 `projectMcpRemove` 對 renderer 提供的任意絕對路徑都會執行（只限面板 sender）。移除只刪除名為 `agent-pets` 且形狀像我們寫的條目，破壞力有限；但 `looksLikeOurs` 只要求 `args[0]` 以 `presentation-mcp.mjs` 結尾，指令（`command`）可為任意字串，會被視為「我們的」而刪除。
- 建議：remove 也要求路徑在 registry 內（`registry.has`）；`looksLikeOurs` 另外要求 `command` 為絕對路徑且 basename 為 `node`/`node.exe`。

### L-7 redaction 覆蓋缺口

- 位置：`electron/diagnostics/redact.ts:15-31`、`electron/permission-redact.ts:9-46`
- 問題（皆為「漏遮」而非新增洩漏）：
  - `diagnostics/redact.ts` 的 `/Users/[^/\s"'`:]+` 在使用者名稱含空白時只遮一半（`/Users/Jane Doe/x` → `~ Doe/x`，若不是目前使用者就不會被 `homedir()` 精確取代命中）；Windows 的正斜線寫法 `C:/Users/x` 沒有被涵蓋（`permission-redact.ts` 有）。
  - `permission-redact.ts` 的 KEY_VALUE 需要 `=`/`:` 或 `--password x` 旗標；`-p secret`、`mysql -psecret`、`curl -u user:pass`（無 scheme）、`export FOO_TOKEN abc` 不會被遮。
  - 兩處都沒有遮 email 與一般 prompt 文字（`renderer-error-report` 的 message/stack 與外掛 `log` 文字原樣進入 `main.log`，只過 `redactText`）。
- 建議：補齊上述樣式與測試；`renderer-error-report` 與外掛 log 可再截短（例如 200 字）並標示來源；診斷匯出前向使用者提示內容包含最近 300 行日誌。

### L-8 外掛與 renderer 可以灌滿主日誌，擠掉真正的當機證據

- 位置：`electron/main/runtime.ts:1035`（`onLog` → `logMain`）、`electron/ipc/reliability.ts:34-52`、`electron/diagnostics/logger.ts`
- 問題：外掛 `log.*` 與 renderer 錯誤回報（20/分鐘）都寫入同一個 3×1MB 的輪替日誌，等級為 info 以上；外掛可在輪替之間洗掉啟動／當機紀錄。內容經 redact，不構成洩漏。
- 建議：外掛日誌單獨計速（例如每外掛 30 行/分鐘）或寫入獨立檔案；`main.log` 維持給主行程使用。

### L-9 額度錯誤時 10 秒重試，可能對 OAuth 用量端點造成持續打擊

- 位置：`electron/quota.ts:26、854`（`ERROR_CACHE_TTL_MS = 10_000`）
- 問題：失敗結果快取縮短到 10 秒，而 Provider 失敗的常見原因是「token 過期／未登入／被限流」，持續以使用者的 OAuth token 重送請求，可能觸發更嚴格的限流或帳號風控。沒有新增主機或新增 token 讀取路徑。
- 建議：依 `errorKind` 區分：`rate-limited`/`expired`/`not-signed-in` 使用指數退避（≥60 秒），只有網路逾時才用短 TTL。

### L-10 `isAgentPetsHook` 判斷過於寬鬆，且空殼檔刪除與 symlink 處理不一致

- 位置：`electron/hook-config.ts:17-23、112-117`
- 問題：只要命令字串同時包含 `agent-hook` 與 `desktop-pet` 就視為我們的 hook；使用者自己的 hook（例如 `~/desktop-pet-project/agent-hook.sh`）會被移除。`removeAgentPetsHooksFile` 在整份檔案只剩我們寫的內容時，`writeConfigSafely` 寫入的是 symlink 的**真實目標**，但隨後的 `fs.rmSync(filePath)` 刪的是**連結本身**，結果變成「目標被改成 `{}`、連結被刪」。皆有備份，影響有限。
- 建議：比對精確路徑（`hookScriptPath()`）而非子字串；刪除時使用 `resolveWriteTarget` 的結果。

---

## Info

- **I-1 `uninstall-integrations` 接受 `'all'`**（`electron/ipc/integrations.ts:67-76`、`electron/setup.ts` `cleanupDeployDirectory`）：只限面板 sender、型別為白名單，會刪除 event/permission/presentation token 與 bridge script，之後 hook 全部失效直到重新安裝；舊的 project MCP 條目仍指向被刪除的 `presentation-mcp.mjs`。屬刻意設計，UI 應在確認對話框中說明。
- **I-2 Hook 設定備份保留最多 5 份**（`electron/safe-config-write.ts:96-114`）：備份是原檔副本（權限 `0600`），`~/.claude/settings.json` 可能含 `env` 內的金鑰，備份會延長其在磁碟上的存在時間。複製後才 `chmod`（極短視窗）。建議文件中提示，或複製時直接以 `0600` 建立。
- **I-3 `crash-guard` 註冊 `uncaughtException`/`unhandledRejection` 後行程會繼續運行**（`electron/main/crash-guard.ts`）：可用性提升，但意外狀態下的 Broker/伺服器可能處於不一致。目前所有安全決策都 fail-closed（逾時、拒絕），可接受；建議遇到連續同簽名例外時自動重啟。
- **I-4 `rendererReload`、`server-health-get`、`session-snapshot-get`、`onboarding-*` 對寵物視窗開放**：皆為無破壞性或有界狀態；寵物視窗被入侵時最多造成重新載入。符合最小權限的合理範圍。
- **I-5 開發用連接埠覆寫**：`AGENT_PETS_*_PORT` 只在 `!app.isPackaged` 時生效（見 verified OK）。`console.log` 仍輸出固定預設埠（`electron/main/runtime.ts` 的 `PRESENTATION_MCP_PORT`／`PERMISSION_ADAPTER_PORT` 訊息），只是開發時的誤導文字。
- **I-6 `tsconfig.node.tsbuildinfo` 出現在 diff**：main 已追蹤此生成檔，內容只有相對路徑；建議移出版本控制（`.gitignore`）以免日後混入本機絕對路徑。
- **I-7 外掛「回報問題」預覽僅為 UI 預覽**：`confirmReport → reportInstalledPluginIssue(pluginId)` 的實際內容與 URL 由主行程 `electron/plugin-report.ts` 決定（該檔未被改動，仍僅允許 `https://github.com/…`），預覽文字與實際送出內容若日後分歧，使用者看到的會與實際不同。建議預覽內容由主行程回傳而非 renderer 自行組字。

---

## Verified OK（已逐項確認的控制）

**IPC**
- 所有新增頻道皆在 `electron/ipc/channels.ts`、`electron/preload.ts`、`docs/security/ipc-inventory.md` 同步，且每個 `handle`／`on` 都先呼叫 `assertTrustedIpcSender`／`isTrustedIpcSender`。`isTrustedIpcSender`（`electron/main/runtime.ts:303-311`）要求 `senderFrame === sender.mainFrame`、URL 受信任，並且只接受寵物視窗或面板視窗的 webContents（外掛 `WebContentsView` 不在其中）。
- preload 沒有暴露 `ipcRenderer`，每個 API 只送出固定頻道；與 `ElectronAPI` 型別一致。
- 僅面板可用：`history-export`、`history-reveal-export`、`history-clear`、`permission-audit-list/clear`、`diagnostics-export`、`server-health-retry`、`project-mcp-*`、`panel-blur-lock`。寵物專用：`pet-context-menu`（選單內容與動作完全由主行程決定，renderer 只發出請求）。
- 輸入驗證：`history-summary`／`history-export` 的 `rangeDays` 只接受 7/30/90、`projectId` 必須符合 `^[a-f0-9]{32}$`；`server-health-retry` 的 id 走白名單；`rendererErrorReport` 有長度（500/2000）、種類白名單與 20/分鐘限速；`panel-blur-lock` 僅接受 boolean；`onboarding-update` 用 `isOnboardingAction`；`parseApplyRequest` 檢查長度、clients 白名單與型別。
- `history-reveal-export` 不接受 renderer 路徑，只 reveal 本次工作階段內剛匯出的檔案。
- 匯出（JSON/CSV）：CSV 欄位全為數字與日期，無注入；JSON 只含彙總、`growth`（XP 與解鎖成就 id），沒有路徑或 prompt。檔案由使用者在 Save 對話框選定，CSV 寫入使用 `0600`。

**`permissionDecide`**
- `electron/ipc/permission.ts`：`fromPanel`／`fromPet` 由 `event.sender === window.webContents` 判定，兩者皆不成立就丟 `Unauthorized IPC sender`；決策來源 `'panel' | 'bubble'` 完全由 sender 決定，payload 內的任何欄位都不會成為來源。payload 仍限定為物件、`requestId` 與 `decision` 做型別檢查，沒有「全部允許」或 TTL 繞過的入口（TTL 仍由 Broker 以 15–300 秒鉗制）。
- Broker 的 `isDecisionSource` 新增 `'panel'`，審計紀錄只新增 `action`（≤80 字，已 redact）與 `risk`，**不含 description 或參數**。熱鍵資格由 `low|medium` 白名單決定（`unknown` 與 `high` 皆排除），截斷內容（含 `details` 超過 5 項）不具熱鍵資格。
- 外部（Codex/Claude）通知只用固定的 `external_only` 標題，不含參數。

**Permission 脫敏與通知**
- `PermissionBroker.sanitizeText` 在截斷**之前**先 `redactSensitiveText`（避免秘密被切半漏遮），`action`、`description`、`details` 都經過；Bearer/JWT/`sk-`/`ghp_`/`AKIA`/PEM/URL 內憑證/家目錄皆處理。
- 通知內容僅用 `event.project`（事件正規化器已取 basename）與固定文案；通知記錄檔只存 kind/outcome/count。`notification-policy.ts` 沒有帶入 prompt、工具參數或路徑。
- 每個 session 最多 20 個進行中請求、已完成紀錄 10 分鐘/200 筆後清除，記憶體有界。

**診斷與日誌**
- `diagnostics/logger.ts`：寫入前 redact，單行 ≤2000 字、換行轉義，檔案 `0600`，輪替 3×1MB，位置為 `userData/logs`；不上傳任何資料。`teeConsoleToLog` 只複製 console.error/warn，物件參數經 `redactValue`（敏感鍵直接遮蔽）。
- `buildDiagnosticsReport` 對整份文件再做一次 `redactText`；各 section 只含計數與狀態。匯出僅限面板、由使用者選擇儲存位置，檔案 `0600`。
- `acquireRunMarker` 的 `running.lock` 只存時間戳。

**Project MCP**
- Apply 僅接受「本次對話框選過（最多記 16 筆）」或「registry 已追蹤」的路徑（`electron/ipc/project-mcp.ts`），且 plan 回傳的 canonical path 才會被記住。
- `canonicalProjectPath`：絕對路徑、`lstat` 拒絕 symlink、`realpath` 正規化、拒絕檔案系統根；設定檔讀取有 1MB 上限與 `isFile && !isSymbolicLink` 檢查；`.codex` 等目錄 symlink 會被拒絕；寫入用 `wx` 暫存檔 + rename，保留既有權限。JSONC／無法解析的檔案不覆寫並提供手動片段。衝突條目不改動。
- registry 先登錄再寫入，寫入失敗會回滾；registry 損毀時搬開並提示，不會寫回（`list()` 不再寫碟）。
- 例外見 M-2（`.git` 指標）與 L-6。

**Hook 安裝器**
- `safe-config-write.ts`：不可解析／非物件／過大／非一般檔案一律 `ConfigRefusedError` 且不寫入；寫前備份（保留 5 份，`0600`，`COPYFILE_EXCL`）；暫存檔 `wx` + rename；內容相同回報 `unchanged`；symlink 型 dotfile 跟隨至真實目標。
- 反安裝只移除 Agent Pets 的條目（見 L-10 的比對寬鬆問題）；Codex `[features].hooks` 只在標記檔存在時還原；共用 hook script 只在沒有其他設定引用時才刪。
- `.cmd` wrapper：`__NODE_EXECUTABLE__` 用函式式 replace 避免 `$&` 展開，`escapeCmdQuotedPath` 拒絕 `"`、換行、NUL，並將 `%` 轉為 `%%`；`setlocal` 未啟用 delayed expansion，所以 `!`、`^`、`&` 在雙引號內無害；新增 `chcp 65001` 處理非 ASCII 使用者名稱。Claude Code 使用 exec 形式 `command + args`，沒有 shell。
- Node 解析：非 Windows 以登入 shell 取得絕對路徑，逾時 2 秒，結果每次使用前驗證存在；找不到或版本 < 18 會在寫入任何檔案前失敗（`prepare` → `NodeNotFoundError`/`NodeUnsupportedError`）；Project MCP 的 `assertOptions` 拒絕非絕對路徑，所以裸 `node` 後備值不會被寫進專案設定。
- Token 檔案：`~/.desktop-pet` 以 `0700`、token `0600`，拒絕 symlink/非一般檔案。

**外掛區**
- 安裝／更新同意流程未被削弱：`confirmInstall` 仍把 `plan.token`、`requiresReconsent`、`requiresSignatureConfirmation` 傳給主行程（`installPluginPlan`），主行程相關檔案（`electron/ipc/plugin-install.ts`、`plugin-registry.ts`、簽章與網路模組）在此 diff 中**沒有變動**；新增的 `installAcknowledgementReasons` 只會讓 UI 更嚴格（簽章金鑰變更、簽章移除、新增網路／連結／secrets 權限需勾選確認，預設焦點在取消）。未知權限單位一律視為高風險。
- 「全部更新」佇列每一項仍各自進入同意畫面（`installCatalogPlugin` → `pendingPlan`），不會自動確認。
- 外部連結仍由主行程依 id 開啟（`openPluginFeedLink(itemId)`），renderer 只顯示 hostname；外掛圖示 URL 以 `PLUGIN_ID`/`ICON_PATH` 白名單與 `encodeURIComponent` 組成 `agent-pets://plugin/...`；回報問題主行程仍限制 `https://github.com`。
- 外掛 host 腳本的變更（`callSafely`、排程上限 16、未處理 rejection 轉為外掛日誌、非重入排程）只增加隔離；CSP 與 worker 限制未變。
- （已移除）`plugin-panel-sizes.json`：每個外掛各自的面板尺寸已不存在，面板改用單一共用尺寸 `panel-size.json`。

**本機伺服器**
- 事件伺服器：仍綁定 `127.0.0.1`、64KB 本文上限、POST `/v1/events` 白名單、token（`timingSafeEqual`）在速率限制前檢查、`headersTimeout`/`requestTimeout` 保留；新的限速器為全域請求 2000/10s 加上每 session 一般 500 與終端事件 60；佇列上限 1000 且優先保留終端事件。
- 權限轉接伺服器：loopback 檢查、拒絕帶 `Origin` 的瀏覽器請求、token、`application/json`、16KB 本文上限都在；新增「每主機 240/分鐘」與「每外掛實例 60/分鐘」預算，預算表有清理。Presentation MCP 的變更僅為預設 TTL 計算（`defaultSayTtlMs`，上限由 `PRESENTATION_MAX_TTL_MS` 鉗制）。
- 開發用連接埠覆寫：`resolveLocalPorts(env, isPackaged)` 在打包版直接回傳預設值並忽略環境變數；數值需為 4–5 位數字且 1024–65535。`VITE_DEV_SERVER_URL` 載入同樣加上 `!app.isPackaged`。
- 連接埠占用探測 `probePortOccupant` 只送無 token 的 GET，僅看自訂標頭；`X-Agent-Pets-Server` 標頭只標示類型，不洩漏資訊。非 `EADDRINUSE` 錯誤不再無限重試，只回報並等使用者手動重試。

**持久化檔案**
- `onboarding.json`：僅 `version`、`completedAt`、`skippedAt`；讀取經 `readConfigText`（1MB 上限、一般檔案）並逐欄驗證；寫入 `writeTextAtomic` + `0600`。
- 權限審計 JSONL：每行讀取時重新 `sanitizeAuditRecord`、壞行跳過、`0600`、500 筆上限（缺口見 L-4）。
- History v6 遷移：欄位以 `PRAGMA table_info` 檢查後 `ALTER TABLE … ADD COLUMN`（表名／欄名為常數，無注入面）；遷移與重建包在 transaction 內；token quality 降級為 `estimated` 直到下次掃描重新匯入；`recordQuotaSnapshot` 刪除 30 天前資料並限制 500 筆。風險在 M-3。
- 本機用量掃描 `local-usage.ts` 改為非同步後仍保留 `lstat` 拒絕 symlink、`realpath` 包含檢查、`O_NOFOLLOW`、單檔／總量位元組上限與分塊讀取。

**Renderer**
- 在 `src/` 的 diff 內搜尋 `v-html`、`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`eval`、`new Function`、`window.open`、`target="_blank"`、`openExternal`、動態 `href` 皆無命中；僅有 `window.location.reload()`（錯誤兜底重載）與 `<img :src>`（見上，白名單組字）。
- `webPreferences`（sandbox、contextIsolation、nodeIntegration=false）、`setWindowOpenHandler`、`will-navigate` 封鎖、`session` 權限請求一律拒絕，在此 diff 中未被放寬；`shell.openExternal` 的三個呼叫點（`runtime.ts:1265/1294/1375`）為既有且走主行程驗證。

**其他**
- 修正了先前稽核文件指出的「Windows Codex hook 路徑未加引號」問題（改為 `codexHookCommand` 雙引號）。
- CI：新增的 workflow 權限維持 `contents: read`（release 的 `contents: write` 僅限 release job），未新增 secrets 使用；`pnpm install --frozen-lockfile` 保留。

## 建議的處理順序

1. M-4（還原版本號，避免自動發版）— 與安全無關但會繞過人工關卡，應最先處理。
2. M-1、M-2、M-3 — 修改小、測試容易，建議在本 phase 內處理。
3. L-1、L-2、L-3、L-4、L-6 — 建議同一輪處理（均為局部修改）。
4. 其餘 Low／Info 可列入 follow-up。

---

## 修正狀態

分支 `ws/fix-sec`。M-4（版本號）不屬於本 stream，維持原判斷，待使用者確認後處理。

| 項目 | 狀態 | Commit | 修正內容 |
|---|---|---|---|
| M-1 | 已修正 | `41b7de9` (SEC-01) | `classifyPermissionRisk` 改為整串（trim、小寫）精確比對 `read/glob/grep/list`；`mcp__*`、含 `__ : . / \`、空白或參數的名稱、未知工具一律 `high`。`toolBaseName` 只保留給網路旗標顯示，不參與風險判斷。測試涵蓋報告中的繞過範例。 |
| M-2 | 已修正 | `b91e804` (SEC-02) | `findGitLocation` 對 `gitdir`/`commondir` 做 realpath 與包含檢查；指向選取資料夾外者標記 `outside`，不讀不寫，`localOnly` 回報 warning 並略過。`info` 目錄或 `exclude` 為 symlink 一律拒絕，寫入改用 `writeTextAtomic`。已知取捨：資料夾外的合法 linked worktree 不再自動寫入 exclude。 |
| M-3 | 已修正 | `bc605dc` (SEC-03) | 只有 SQLITE_CORRUPT/NOTADB 或 `quick_check` 失敗才搬移資料庫；鎖定、忙碌、磁碟滿、權限、遷移錯誤保留原檔並交給既有重試計時器。遷移原本就在 transaction 內回滾（有測試驗證原檔與 `schema_migrations` 不變）。`.corrupt-*` 最多保留 3 份，Clear History 會一併刪除，重建後以桌面通知提示（`reliability.history.*`）。未做 `pre-v6` 備份副本（回滾已保證原檔完整）。 |
| M-4 | 未處理（不在本 stream） | - | 版本號與發版流程需使用者確認。 |
| L-1 | 已修正 | `d41078d` | `where.exe` 由 System32 執行並拒絕 cwd／Downloads／Temp 內的候選；啟動修復只針對「hook 指向非 Node 的 exe（舊版 Electron 遞迴）」，Node 路徑變動不再改寫使用者設定。 |
| L-2 | 已修正 | `d41078d` | POSIX 改單引號（`'` → `'\''`）；含換行／NUL（POSIX）或 `"`、`%`、換行（Windows）的路徑丟 `ConfigRefusedError('unsafe')`。 |
| L-3 | 已修正 | `53f7aa6` | 由檔頭讀出尺寸，寬 ≤ 6144、高 ≤ 13312、總像素 ≤ 16M，否則 `E_SIZE`。 |
| L-4 | 已修正 | `53f7aa6` | 啟動時修剪過大的 audit 檔並刪除舊 `permission-audit.json`；讀取只讀尾端 512KB；trim 改 `renameSyncWithRetry`。 |
| L-5 | 已修正 | `53f7aa6` | 追蹤表滿時改用共用 overflow 桶；新增不依賴 sessionId 的全域事件預算（一般 2000、終端 300／10 秒）。 |
| L-6 | 已修正 | `53f7aa6` | `project-mcp-remove` 要求路徑在 registry；`looksLikeOurs` 另需 `command` 為絕對路徑且 basename 為 `node`/`node.exe`（含 Codex TOML）。 |
| L-7 | 已修正 | `cf471c9` | 兩份 redaction 補上含空白使用者名稱、`C:/Users/x`、email、`curl -u`、`mysql -p`、`export X_TOKEN v`。plugin log 訊息截至 300 字。未做：診斷匯出前的使用者提示（UI）。 |
| L-8 | 已修正 | `cf471c9` | logger 對 `plugin:*`（30/分）、`renderer*`（20/分）設配額並記錄丟棄數；error 與 startup 行另寫入有上限的 `main-evidence.log`，輪替不會洗掉，`readRecent` 會合併。 |
| L-9 | 已修正 | `cf471c9` | 失敗後 TTL 指數退避：timeout 10 秒起、其餘（expired／rate-limited／not-signed-in／unavailable）60 秒起，上限 15 分鐘，成功即重置。 |
| L-10 | 已修正 | `d41078d` | `isAgentPetsHook` 只認 token 完全等於 `*/.desktop-pet/agent-hook.(mjs\|cmd)`；空殼檔若為 symlink 則保留連結（已被寫成 `{}`），不再刪連結。 |
| I-1 | 不處理 | - | 屬刻意設計，由確認對話框文案處理（UI）。 |
| I-2 | 已修正 | `d41078d` | 備份直接以 `0600` 建立，不再先複製後 chmod。 |
| I-3 | 不處理 | - | 需設計決策（自動重啟）。 |
| I-4 | 不處理 | - | 報告已判定為合理範圍。 |
| I-5 | 已修正 | `cf471c9` | 開發用 log 改印實際解析後的連接埠。 |
| I-6 | 不處理 | - | 變更追蹤狀態易與其他 stream 的 merge 衝突，留待整合後處理。 |
| I-7 | 不處理 | - | 預覽內容改由主行程回傳屬 UI／IPC 契約變更，留作 follow-up。 |
