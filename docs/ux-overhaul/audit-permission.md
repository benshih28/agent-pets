# Agent Pets 稽核報告：Permission 流程 / 通知 / Tray / DND / 桌面可見性

範圍：`InlinePermissionCard.vue`、`DesktopPet.vue` 的 permission 泡泡、`electron/permission-*.ts`、`desktop-tray.ts`、`tray-icon.ts`、`desktop-notifications.ts`、`notification-policy.ts`、`desktop-preferences.ts`、`desktop-visibility.ts`、`windows-fullscreen-detector.ts`、`SettingsDesktop.vue`、`ipc/{permission,desktop}.ts`、`plugin-tray.ts`，以及 `electron/main/runtime.ts`、`agentStore.ts` 的連動邏輯。
方式：唯讀稽核。所有提案皆不放寬 security boundary（loopback + token、broker 唯一決策權、`hotkeyEligible` 排除 high risk / truncated、TTL 上下限、`allow_once`/`deny` 兩值）。

共 **15 個大問題**，各含 6–9 個子任務。最後附新的 permission 泡泡與 Tray 選單 ASCII 設計。

嚴重度：P0 = 可能造成使用者誤判或功能實質失效；P1 = 明顯影響日常體驗；P2 = 打磨 / 一致性。

---

## PM-01　Permission 泡泡沒有倒數與過期回饋，TTL 預設 60 秒卻靜默消失（P0）

**證據**
- `electron/permission-broker.ts:11-13` TTL 預設 60s、下限 15s、上限 300s；`:284` 設定 `expiresAt`，`:517-527` 到期後 `finish(..., 'expired')`。
- `src/components/DesktopPet.vue:625-679` 泡泡完全沒有使用 `expiresAt`，沒有倒數、沒有進度條。
- `src/stores/agentStore.ts:1393-1420` `setPermissionRequests` 只保留 `pending/deciding` 且 `expiresAt > now` 的請求，過期的直接從陣列消失，沒有「已過期」狀態傳給 UI。
- `src/components/StatusPanel.vue:184` 面板卡片只顯示「已等待 N.Ns」（`toFixed(1)s`，例如 `83.4s`），是已過時間而不是剩餘時間。
- `src/locales/zh-TW.json:290` 的 `permissionCountdown` 只被引用 1 次（定義處），實際無 UI 使用。

**使用者影響**：使用者離開 60 秒後，泡泡無聲消失，無法知道是「被誰處理了」「過期了」還是「出錯了」；agent 端則已因 TTL 收到取消。使用者會以為自己漏按。

**子任務**
- [ ] 在 `PermissionRequestView` 已有的 `expiresAt` 基礎上，泡泡加一條剩餘時間進度條（可沿用 `toast-countdown-track` 樣式）與 `mm:ss` 文字；不新增 IPC。
- [ ] 剩餘 <15s 時進度條轉警示色並附文字（不能只靠顏色），`prefers-reduced-motion` 下改為步進。
- [ ] store 保留「剛結束」請求 3–5 秒：`setPermissionRequests` 將消失的請求以 `lastOutcome`（expired / cancelled / allowed / denied / delivery_failed）暫存，供泡泡顯示結果。
- [ ] 泡泡結果態：過期顯示「已逾時，Agent 已收到取消」，並提供「重新檢視（開啟面板）」按鈕。
- [ ] 面板卡片 `elapsedLabel` 改為剩餘時間與已等待時間並列，數字格式改為 `1:23`，不要 `83.4s`。
- [ ] 啟用 `permissionCountdown` key 或刪除；補上 en-US / zh-TW 結果態文案。
- [ ] 增加 renderer 單元測試：到期、被外部取消、delivery_failed 三種結果各自顯示正確訊息。
- [ ] 在 `PermissionRequestView` 加 `terminalReason?`（只含 `ttl / agent_resolved / adapter_disconnected / system_lock / system_suspend` 等既有列舉）供 UI 區分原因，不含任何請求內容。

**修改檔案**：`DesktopPet.vue`、`DesktopPet.css`、`InlinePermissionCard.vue`、`StatusPanel.vue`、`agentStore.ts`、`src/types/permission.ts`、`permission-broker.ts`（toView）、locales。

---

## PM-02　`decidePermission` 先樂觀設為 idle，且完全忽略 broker 回傳結果（P0）

**證據**
- `src/stores/agentStore.ts:1430-1442`：先呼叫 `settleWaitingPermission`（把 session 改成 `idle`，`:1379-1391`），再 `await window.electronAPI?.decidePermission(...)` 並丟棄回傳值；`catch {}` 吞掉例外。
- `electron/ipc/permission.ts:32` 回傳 `{ok:true,status:'delivery_failed'|'cancelled'|...}` 或 `{ok:false,error:'conflict'}`，renderer 不處理。
- `electron/permission-broker.ts:370-392`：delivery 失敗 / `already_resolved` / `rejected` 都是 `ok:true`，只是 status 不同。

**使用者影響**：按下 Allow 後若 relay 投遞失敗（OpenCode plugin 已斷線），寵物顯示 idle、泡泡消失，使用者以為已允許，但 agent 其實還卡在等待，直到逾時。這是「UI 說謊」。

**子任務**
- [ ] `decidePermission` 回傳結果給 caller；只有 `status === 'allowed' | 'denied'` 才 `settleWaitingPermission`；`delivery_failed` / `conflict` 保持原狀並顯示錯誤。
- [ ] `deciding` 狀態期間不要提前改 session 狀態（僅按鈕顯示「傳送中…」）。
- [ ] 泡泡與面板卡片新增錯誤列：「傳送失敗，請回到 OpenCode 處理」+「重試」（重試仍走 broker.decide，因 broker 狀態為 terminal 時會回 conflict，需顯示為「請於 OpenCode 處理」而非重試）。
- [ ] 區分 `cancelled`（`already_resolved`：agent 端已先處理）與 `allowed`：顯示「已在 OpenCode 處理」。
- [ ] `catch {}` 改為記錄 diagnostic（renderer console + 簡短 toast），不可靜默。
- [ ] IPC `permissionDecide` 回傳型別補進 `electron-api.ts` 與測試（目前 `tests/ipc-permission.test.mts` 只測 main 端）。
- [ ] 新增 e2e：mock relay 回傳 `rejected`，驗證寵物不進 idle、泡泡顯示失敗。

**修改檔案**：`agentStore.ts`、`DesktopPet.vue`、`InlinePermissionCard.vue`、`src/types/electron-api.ts`、tests。

---

## PM-03　泡泡缺少「是哪個 Agent / 專案 / 工作階段」與實際參數，無法做出知情決定（P0）

**證據**
- `DesktopPet.vue:640-641` 標題只顯示 `request.action`（例如 `bash`），副標只有風險等級；沒有 agent 來源、專案名。`agentId` / `projectId` / `sessionId` 在 `PermissionRequestView` 都有但泡泡不用。
- `permission-adapter-server.ts:350-354` `describePermission`：有 `title` 時完全丟棄 `patterns`（實際指令 / 路徑 glob），沒有 title 才用 patterns；兩者不會並陳。
- `permission-adapter-server.ts:284` patterns 取前 5 個、每個 120 字；`permission-broker.ts:15,268` description 上限 280 字；`DesktopPet.css:819-831` 顯示最多 3 行（`-webkit-line-clamp: 3`），寬度僅 248px，且沒有 `title` tooltip 或展開。
- `InlinePermissionCard.vue:55` 有 `:title` 但泡泡沒有。
- 面板卡片也不顯示 risk 與 queue（`StatusPanel.vue:179-190` 未傳入）。

**使用者影響**：只看到「bash — 高風險」，卻看不到要執行的指令、工作目錄、哪個專案。使用者被迫回終端確認，等於泡泡失去價值，或是盲按。

**子任務**
- [ ] 適配器同時傳 `title` 與 `patterns`：description 結構化為 `{summary, details[]}`，broker 端仍各自限長 + sanitizeText（保持既有 sanitize 與 280 字限制，改成「欄位化」而非拼接字串）。
- [ ] 泡泡標題列加入來源 chip（`OpenCode CLI` / `OpenCode Desktop`）與 `projectId`（沒有時顯示 `projectUnknown`）。
- [ ] 命令 / 路徑以 monospace 區塊顯示，支援「展開全部」（點擊展開後泡泡上限高度 + 內部捲動），未展開時維持 3 行並加 `…`。
- [ ] 提供「複製完整內容」按鈕（僅複製已 sanitize 的顯示文字）。
- [ ] 面板卡片補上 risk badge、queue 位置、來源 icon。
- [ ] 在 `truncated` 時顯示被截斷的字元數而非只是一句警示。
- [ ] 警示文字 `permissionWarning`（`zh-TW.json:288`）寫死「OpenCode」，改為帶 `{source}` 參數。
- [ ] 單元測試：有 title + patterns 時兩者都出現在 view。

**修改檔案**：`DesktopPet.vue/.css`、`InlinePermissionCard.vue`、`StatusPanel.vue`、`permission-adapter-server.ts`、`permission-broker.ts`、`src/types/permission.ts`、locales、tests。

---

## PM-04　風險分級用 substring 比對，`unknown` 仍被視為可用熱鍵（P0）

**證據**
- `permission-adapter-server.ts:356-362` `classifyRisk`：`normalized.includes('bash'|'edit'|'write'|'external'|'task')` → high；`read`/`web` → medium；其餘 → `unknown`。
- `permission-broker.ts:452-455` `hotkeyEligible = pending && risk !== 'high' && !truncated`，因此 `unknown` 與 `medium` 都可用全域熱鍵一鍵允許。
- `DesktopPet.vue:374-382` 風險標籤只有文字「未知風險」，視覺上 `risk-unknown` 沒有獨立樣式（CSS 只有 `.risk-high`，`DesktopPet.css:758`）。
- 例：`webfetch`（含 `web` → medium）可對外連線卻可熱鍵；`multiedit` 含 `edit` 才 high，但 `patch`、`apply_patch`、`notebook` 之類名稱落入 unknown。

**使用者影響**：新的 / 改名的高風險工具會落入 `unknown`，被允許以全域熱鍵一鍵放行，風險標記與實際不符。（此項建議收緊，不是放寬。）

**子任務**
- [ ] 改用明確的允許清單（exact match 的已知唯讀工具 `read`、`glob`、`grep`、`list`）才是 low；未知名稱一律 high。`unknown` 保留給「適配器未提供分類」的情況且不可熱鍵。
- [ ] 將 `hotkeyEligible` 改為 `risk === 'low' || risk === 'medium'` 明確條件，避免未來新增 risk 等級時預設可熱鍵（fail-closed）。
- [ ] 為 `webfetch` / `external_directory` 等「對外」工具提供專屬標籤（例如「會連線到網路」）而不只是 medium。
- [ ] 泡泡為 4 種 risk 設計不同的 icon + 文字 + 邊框（不只靠顏色），補 `risk-medium`、`risk-low`、`risk-unknown` 樣式。
- [ ] 風險分類表搬到獨立檔案 `permission-risk.ts` 並單元測試（含大小寫、複合名稱 `mcp__server__bash`）。
- [ ] 於設定頁說明風險分級規則（一段簡短說明 + 連結文件）。
- [ ] 測試：未知工具名稱不得 hotkeyEligible。

**修改檔案**：`permission-adapter-server.ts`、新 `permission-risk.ts`、`permission-broker.ts`、`DesktopPet.vue/.css`、tests、locales。

---

## PM-05　鍵盤操作：全域熱鍵靜默失敗、平台標示錯誤、泡泡本身無鍵盤路徑（P1）

**證據**
- `electron/main/runtime.ts:102-103` 熱鍵為 `CommandOrControl+Shift+Y/N`；`:2318-2326` `globalShortcut.register` 的回傳值（成功與否）未檢查，被其他 app 佔用時靜默失敗，但泡泡仍顯示 `kbd`。
- `DesktopPet.vue:662,672` 寫死 `Ctrl Shift N` / `Ctrl Shift Y`，在 macOS 應為 `⌘⇧N` / `⌘⇧Y`。
- `runtime.ts:2303-2311` 熱鍵只在 permission 泡泡啟用、寵物視窗可見且 top 請求 `hotkeyEligible` 時註冊；高風險請求完全沒有鍵盤快速路徑。
- 熱鍵每次 `broadcastPermissionRequests` 都 unregister 再 register（`:2303`），期間有短暫空窗；多數 app 內 `⌘⇧N` 為「新增隱身視窗」之類，全域攔截會干擾。
- `role="alertdialog"`（`DesktopPet.vue:630`）沒有焦點管理、沒有 Esc；按鈕 `font: 700 9.5px`，`kbd` 為 `7px`（`DesktopPet.css:853,891`）。
- 熱鍵在 `permissionBubbleEnabled` 關閉時完全不註冊（`:2307`），此時沒有任何鍵盤方式。

**使用者影響**：熱鍵失敗時使用者按了沒反應也不知原因；mac 使用者看到錯的修飾鍵；高風險請求只能滑鼠點擊。

**子任務**
- [ ] 檢查 `globalShortcut.register()` 回傳值與 `isRegistered`，失敗時透過 view 欄位（例如 `hotkeyStatus: 'active'|'unavailable'`）通知 renderer 隱藏 `kbd` 並顯示「快捷鍵被其他程式佔用」。
- [ ] 依 `process.platform` 顯示正確符號（`⌘⇧Y` / `Ctrl+Shift+Y`），由 main 傳 `hotkeyLabels`，不在 renderer 猜測。
- [ ] 熱鍵改為可在設定頁自訂（需通過 accelerator 驗證與衝突檢查），預設值維持原樣。
- [ ] 避免每次 broadcast 都 unregister/register：僅在 top requestId 或可用狀態改變時才變更註冊。
- [ ] 泡泡獲得焦點時（使用者點擊後）支援 `Enter`=允許一次 不可作為預設——改為 `Tab` 先落在「拒絕」，`Y`/`N` 為視窗內快捷鍵，`Esc` = 拒絕（僅在泡泡焦點內，非全域，不放寬安全邊界）。
- [ ] 高風險請求：維持不可全域熱鍵；改提供視窗內焦點快捷鍵並要求明確點擊或二次確認（例如按住 600ms），不降低保護。
- [ ] 按鈕與 `kbd` 字級提升到 ≥12px（遵守 ui-design-system 的最小字級），並確保 44px 以內的點擊區域不縮小。
- [ ] 增加 e2e：註冊失敗時 `kbd` 不顯示。

**修改檔案**：`runtime.ts`、`DesktopPet.vue/.css`、`permission-broker.ts`（view）、`src/types/permission.ts`、`SettingsDesktop.vue`、`desktop-preferences.ts`（若做可設定熱鍵）、locales、tests。

---

## PM-06　多個並行請求只顯示最前一個，沒有佇列總覽、也沒有批次處理（P1）

**證據**
- `agentStore.ts:1372` `permissionRequest = permissionRequests[0]`；`DesktopPet.vue:643-645` 只顯示 `queuePosition/queueSize`（如 `1/4`），不可點、不可切換。
- `permission-broker.ts:506-512` FIFO 佇列；`permission-adapter-server.ts:15` 每分鐘 60 次建立上限，`:129` 以 IP 為單位（loopback 全部共用同一個 key），沒有「每 session 上限」或同類請求合併。
- 熱鍵只作用於 top（`runtime.ts:2309`），其餘需先處理 top。
- `broadcastPermissionRequests` 的 attention 數為 `requests.length`（`:2295`），tray 會與通知計數相加（見 PM-10）。

**使用者影響**：agent 連續請求 5 個 `read`，使用者只能一個個點；看不到後面還有什麼，也無法優先處理高風險。

**子任務**
- [ ] 泡泡 queue 標記改為可點開的清單 popover：列出每個請求的來源 / 動作 / 剩餘時間 / 風險。
- [ ] 同一 session 的連續「相同 action + 相同 pattern」請求折疊為「x3」並提供「全部拒絕」（仍是對每個 requestId 逐一呼叫 `broker.decide`，不引入「永遠允許」）。
- [ ] 提供「全部拒絕」按鈕（需二次確認），不提供「全部允許」（避免放寬）。
- [ ] 清單中高風險置頂提示（不改變 FIFO 的決策順序，僅提示）。
- [ ] 用 `queuePosition` 做動畫切換，下一個請求出現時給 300ms 緩衝，避免使用者手指正好落在新請求的「允許」按鈕上誤點（點擊保護）。
- [ ] 在 broker 增加每 `sessionId` 的待處理上限（例如 20），超出回 `capacity_exceeded`，避免單一 agent 洪水。
- [ ] 速率限制 key 從 `remoteAddress` 改為 `source+instanceId`，避免一個 plugin 實例耗盡其他實例預算。
- [ ] 測試：連續 3 個請求時新請求出現後 300ms 內按鈕不可點。

**修改檔案**：`DesktopPet.vue/.css`、`agentStore.ts`、`permission-broker.ts`、`permission-adapter-server.ts`、tests。

---

## PM-07　Codex / Claude（external-only）流程缺乏說明，通知和泡泡都在誤導（P0）

**證據**
- `electron/event-normalizer.ts:5-7` 所有 `waiting-permission` 事件都標為 `responseMode: 'external_only'`；`permission-adapter-server.ts:17` 只有 `opencode-cli/desktop` 可 respond。
- `agentStore.ts:1333-1341`：notice 只有「需要 Permission」+「請回到終端機處理」，未指出哪個 agent、哪個專案、哪個工作階段；多個 session 時只對 `highestPrioritySession` 顯示。
- `DesktopPet.vue:714-728`（notice 泡泡）沒有關閉按鈕、沒有「為什麼不能在這裡按」的說明、沒有「前往終端機 / 聚焦」動作。
- 通知 `notification-policy.ts:40-47`：Codex/Claude 的 `waiting-permission` 也發原生通知「Claude 需要 Permission」，body 僅專案名，使用者可能點通知期待能在 Agent Pets 內允許，卻開到 sessions 面板（`runtime.ts:2623`）。
- zh-TW 文案 `returnToTerminal`「請回到終端機處理」對桌面版 Codex / Claude Desktop 不適用。
- `settleWaitingPermission`（`agentStore.ts:1379`）在 request 消失後把 session 強制設 idle，註解提到 Codex/Claude 可能不會有後續事件，這是 workaround 而非正確狀態。

**使用者影響**：使用者看到「需要 Permission」會預期能在寵物上允許，結果沒有按鈕，也沒有解釋。這是 Codex / Claude 使用者最常見的困惑點。

**子任務**
- [ ] notice 泡泡改為：`Claude · my-project 正在等你在終端機核准`，加副標「此 Agent 的權限請求只能在原本的工具中回應」。
- [ ] 增加 `?` 說明按鈕，連到設定頁「各 Agent 能力」說明（`capabilities.ts` 已有 `external_only` 概念可直接引用）。
- [ ] 區分 CLI / Desktop：Desktop 版文案用「請回到 Claude Desktop」，CLI 用「請回到終端機」。
- [x] 若可取得，加「聚焦該終端機視窗」動作的**提案**（需評估可行性與安全邊界，預設不做，僅文案）；至少提供「複製專案路徑」。→ Phase E（`docs/phase-reports/phase-session-jump.md`）：macOS「切換到 App」以 `open -b` 啟用已知清單中的 App（不指定視窗、不需系統權限），另提供「顯示專案資料夾」（只在 Finder 中選取）與「複製專案路徑」。
- [ ] 通知標題對 external-only 改為「Claude 等你核准（請回終端機）」，並避免讓點擊通知被誤解為可在此核准。
- [ ] 多個 external-only 待處理時，notice 顯示總數與來源列表，而非只顯示最高優先 session。
- [ ] notice 增加「知道了」暫時隱藏（僅 UI，直到該 session 狀態改變），避免永遠佔住泡泡。
- [ ] 設定頁在 Permission 泡泡設定旁新增一段「哪些 Agent 可以在這裡核准」的對照表（OpenCode：可；Codex/Claude：僅提醒）。

**修改檔案**：`agentStore.ts`、`DesktopPet.vue/.css`、`notification-policy.ts`、`SettingsDesktop.vue`、`capabilities.ts`（讀取）、locales、tests。

---

## PM-08　通知：無法點擊直達、不分組、聚焦即靜音、`silent:true`（P1）

**證據**
- `desktop-notifications.ts:143` `new Notification({ title, body, silent: true })`；沒有 `actions`、`urgency`、`timeoutType`、`tag`/去重，通知 body 只有專案名（`notification-policy.ts:36`）。
- `:144-148` 任何通知點擊只做 `showPanelWindow('sessions')`（`runtime.ts:2623`），不帶 sessionId / requestId，無法直達該 session 或 permission 卡片。
- `:133-136` 任一視窗聚焦就抑制通知（`isAppFocused`），但使用者可能在別的 app 上，而寵物視窗只是殘留焦點；反之 mac 上寵物視窗經常保持 alwaysOnTop 且被點過就一直「focused」。
- `:59-62` 冷卻以 `source:sessionId:state` 為鍵 60 秒；waiting-permission / waiting-input 不批次（`:67-75`），每個 session 各發一則。
- `notification-policy.ts:108-115`：聚合通知標題固定為 `notificationAggregate`「N 個 Agent 工作已完成」，即使 body 含失敗項目，標題仍寫「已完成」（`failed > 0` 時文案矛盾）。`candidates[0].kind` 也被用於 log（`:115`）。
- `:156-175` 每次事件同步讀取並重寫整個 log 檔（最多 200 筆），在事件高頻時阻塞主執行緒。
- `classifyNotification` 的 `SOURCE_NAMES`（`:14-21`）未命中時顯示 `Agent`，且 `body` 是專案名可能為完整路徑片段（`displayText` 只截 96 字）。

**使用者影響**：通知看不出是哪個動作、點了也不能直達；混合成功 / 失敗的聚合標題誤導；log 同步 I/O。

**子任務**
- [ ] 通知 click 帶 `{sessionId, requestId?}`，開啟面板後自動捲動 / 高亮該 session；permission 通知開啟後聚焦 permission 卡片。
- [ ] 修正聚合標題：全成功→「N 個工作完成」；有失敗→「N 個工作結束（x 失敗）」，並新增對應 i18n。
- [ ] 通知 body 加上「動作摘要」（`toolName` 或 permission `action`，經 sanitize，不含參數內容），例如「my-project · bash」。
- [ ] 使用 `tag`/`id` 取代同一 session 重複通知（Electron `Notification` 不支援 tag 時以自管 map 關閉舊通知 `notification.close()`）。
- [ ] 聚焦判斷改為「面板視窗聚焦，或寵物視窗聚焦且最近 N 秒有使用者互動」，避免寵物殘留焦點吃掉通知。
- [ ] 通知 log 改為記憶體緩衝 + debounce 寫入（例如 2s），或移到非同步 `fs.promises`。
- [ ] 評估 macOS `actions`（Allow/Deny 以外只提供「查看」）— **不**在通知上提供 Allow，保持決策只在 broker 受信 UI。
- [ ] `silent` 與設定的音效偏好連動：使用者啟用 sound 時採系統音效，而非恆為 silent（目前 sound 僅 renderer Web Audio，見 PM-12）。
- [ ] 測試：混合成功 / 失敗聚合標題。

**修改檔案**：`desktop-notifications.ts`、`notification-policy.ts`、`runtime.ts`、`StatusPanel.vue`、`agentStore.ts`、locales、tests。

---

## PM-09　DND 只有布林開關：無排程、無計時、與 permission 的關係不明（P1）

**證據**
- `desktop-preferences.ts:75-88` `dndEnabled` 僅為布林；`DesktopPreferences`（`src/types/desktop.ts:5`）沒有排程 / 到期欄位。
- `desktop-notifications.ts:129-132` DND 下所有通知（含 `waiting-permission`）一律抑制並只記 log。
- `src/App.vue:163-170` DND 下音效不播；`permissionBubbleActive`（`agentStore.ts:387-389`）**不**受 DND 影響，因此 DND 時泡泡仍出現但無任何聲音 / 通知提示。
- `zh-TW.json:97` `dndHelp`「靜音通知、音效與額外動態。」沒有說明 permission 泡泡與 tray 計數仍會出現。
- Tray 提示 `desktop-tray.ts:72` 僅追加字串「勿擾模式」。

**使用者影響**：忘了關 DND，隔天所有通知都沒有，也沒有提示；DND 開啟時 agent 在等 permission，使用者毫無感知，60 秒後逾時。

**子任務**
- [ ] 新增 DND 模式：`off` / `until-time` / `schedule`（週間時段）/ `focus-on-fullscreen`；偏好欄位 `dndUntil?: number`、`dndSchedule?`，並更新 `parseDesktopPreferencesPatch` 的驗證（僅接受有界的數字與固定格式）。
- [ ] Tray 增加「勿擾 → 30 分鐘 / 1 小時 / 今天 / 持續」子選單與剩餘時間顯示。
- [ ] DND 時 permission 請求的行為做成明確選項：預設「仍顯示泡泡並於 tray 圖示標記，但不發原生通知與音效」，並提供選項「permission 例外通知」（預設關閉）。
- [ ] DND 到期自動恢復，並於恢復時彙整「DND 期間錯過 N 則」發一則摘要通知。
- [ ] 狀態列 / 寵物上顯示 DND 圖示（避免遺忘），尊重 `prefers-reduced-motion`。
- [ ] 說明文字更新：`dndHelp` 明確列出受影響項目與不受影響項目。
- [ ] 排程邏輯放在 main process（`desktop-preferences` 外的獨立 `dnd-schedule.ts`），並有純函式單元測試（跨午夜、時區、DST）。
- [ ] 「Presentation MCP」在 DND 清除（`runtime.ts:2275` 附近）的行為需列入說明。

**修改檔案**：`desktop-preferences.ts`、`src/types/desktop.ts`、新 `dnd-schedule.ts`、`desktop-tray.ts`、`desktop-notifications.ts`、`runtime.ts`、`SettingsDesktop.vue`、`StatusPanel.vue`、locales、tests。

---

## PM-10　Tray 圖示的注意力標記：計數重複、不可存取、macOS 外觀不對（P1）

**證據**
- `desktop-notifications.ts:64-65` `attentionCount += 1` 在判斷通知是否被抑制**之前**；DND / 通知關閉 / 聚焦時仍累計。
- `runtime.ts:2287` tray 計數 = `notificationAttentionCount + permissionAttentionCount`；OpenCode permission 同時產生 `waiting-permission` 事件（通知計數 +1）與 broker 請求（permission 計數 +1），同一件事算兩次。
- `clearAttention` 只在開啟面板或點通知時呼叫（`runtime.ts:2062`、`desktop-notifications.ts:146`），不會在 session 回到 idle / 使用者處理後自動減少；永遠「累加直到點擊」。
- `tray-icon.ts:27-32` 注意力標記為固定洋紅小點（註解稱為了抗 R/B 交換），純顏色、無數字；`desktop-tray.ts:41-42` 圖示 18px（mac）/16px（win），沒有 `@2x`、沒有 mac template image，深色 / 淺色選單列可能看不清。
- `desktop-tray.ts:49-51` 建立 attention icon 失敗時 `catch {}` 靜默，使用者再也看不到標記。
- `desktop-tray.ts:158-161` 每次計數變化重建整個 `Menu`。
- `desktop-tray.ts:53` tray 單擊只執行 `showPet`（隱藏時顯示，已顯示時無反應），不是切換。

**使用者影響**：數字會膨脹、不可靠；色盲或深色選單列看不出標記；不知道有多少 / 是什麼。

**子任務**
- [ ] 計數改為「目前仍需要處理的項目集合」（permission requestId + waiting-input sessionKey 的 Set），由狀態解除自動移除，而非累加。
- [ ] 通知抑制（DND / disabled）不影響 tray 計數規則的一致性：以 Set 計算，與通知是否送出無關。
- [ ] 去重 permission：OpenCode 的 waiting-permission 事件若已有對應 broker 請求（同 agentId+sessionId）就不重複計。
- [ ] macOS：使用 template image 並以 `tray.setTitle(String(count))` 顯示數字；Windows：`tray.setImage` 疊加數字徽章（≥ 10 顯示 `9+`）；不只靠洋紅點。
- [ ] 提供 `@2x` 資源（或 `nativeImage.createFromBuffer` 指定 scaleFactor），遵守深色選單列。
- [ ] attention icon 建立失敗要 `console.warn` 並退回以 tooltip / title 呈現，而不是靜默。
- [ ] tooltip 加上摘要（「2 個 Permission、1 個等待輸入」），使用已存在但未使用的 `trayTooltip` key 或移除該 key。
- [ ] `setAttentionCount` 數值未變時不重建 Menu。
- [ ] tray 單擊（Windows）改為切換顯示 / 隱藏或開啟面板，與選單第一項一致。

**修改檔案**：`desktop-notifications.ts`、`runtime.ts`、`desktop-tray.ts`、`tray-icon.ts`、`build/` 圖示資源、locales、tests。

---

## PM-11　Tray 選單結構扁平、命名混亂、含永久停用佔位項（P1）

**證據**
- `desktop-tray.ts:76-138` 單層 14 項，混合動作（開啟面板）、狀態（Mini、Edge Peek）、偏好（DND、Sound、Notifications、Permission bubble、Presentation MCP、開機啟動）與資訊（需要注意）。
- `:122` `'Presentation MCP'` 寫死英文，未走 i18n。
- `:135` `checkUpdates` 永遠 `enabled: false`（`zh-TW.json` 文案「檢查更新（目前無法使用）」），是死項目。
- `:95` 「需要注意（N）」為 disabled，無法點擊前往處理。
- `:147-150` 外掛選單以比對 `template[index+1]?.label === t('quit')` 找插入位置，文案 / 語系改變時脆弱。
- 沒有 accelerators、沒有 icon、沒有分組標題；Mini 與「隱藏寵物」並列語意重疊。
- `plugin-tray.ts:15-21,33-47`：外掛超過 30 項時只寫入外掛診斷（`runtime.ts` 的 `onPluginCommandsOmitted`），使用者在 tray 看不到「還有 N 項被省略」；標籤截到 32 字元後可能重複。

**使用者影響**：選單長、難掃讀；常用的 DND 要在中段找；死項目降低信任。

**子任務**
- [ ] 重新分組：頂部「狀態 / 待處理」→「寵物」→「通知與勿擾」→「進階（子選單）」→「插件」→「結束」（見下方設計）。
- [ ] 「需要注意」改為可點擊，開啟面板並定位到第一個待處理項；有 permission 時標題含 `⚠`。
- [ ] 移除死項目 `checkUpdates`，或在更新機制完成前隱藏。
- [ ] `Presentation MCP`、`Edge Peek` 等進階偏好移到「進階設定」子選單，並全數走 i18n。
- [ ] DND 改為子選單（見 PM-09）。
- [ ] 插件選單改用顯式插入點（結構化建構 template 時留 slot），不用 label 比對。
- [ ] 外掛超過上限時加入一行 disabled「還有 N 個指令未顯示，請於面板使用」。
- [ ] 外掛標籤重複時附加外掛名稱（`truncateLabel` 後比對重複）。
- [ ] 為 macOS 提供 `accelerator` 提示（顯示用，若不註冊全域熱鍵則使用 `registerAccelerator: false`）。

**修改檔案**：`desktop-tray.ts`、`plugin-tray.ts`、`runtime.ts`、locales、tests（`__agentPetsE2E.trayMenuTemplate` 相關 e2e）。

---

## PM-12　音效：僅有三個合成嗶聲，無音量、無逐類型開關、雙來源狀態（P2）

**證據**
- `src/utils/sound.ts:42-58` 三個固定 cue（success / error / waiting-permission），增益寫死 0.1–0.12，無音量設定。
- cue 只由 agent 狀態事件觸發（`App.vue:157-171`）；broker 建立 permission 請求本身（OpenCode 經 relay）不觸發音效，只靠事件時序。
- 只在 pet window 播放（`!isPanelWindow`）；寵物視窗被隱藏 / Mini 模式 / 右鍵隱藏時音效是否播放取決於 renderer 是否存活，且完全不考慮 fullscreen 隱藏（使用者全螢幕時仍可能出聲）。
- `agentStore.ts:326,682-707`：聲音設定同時存於 `localStorage('agent-pet-sound')` 與 desktop-preferences（`soundEnabled`），透過 `storage` 事件同步（`App.vue:137-138`），雙來源。
- `desktop-notifications.ts:143` 原生通知永遠 `silent:true`，所以通知與寵物 cue 是兩套不連動的聲音。
- 設定頁 `SettingsDesktop.vue` 沒有 sound 區塊（只有面板快速開關 `StatusPanel.vue:252`），`soundHelp` 的說明不易被找到。
- 沒有「測試音效」。

**使用者影響**：想只聽 permission 提示音而不聽 success 無法設定；音量無法調整；全螢幕時被打擾。

**子任務**
- [ ] 設定頁新增「音效」卡片：總開關、音量滑桿、逐事件勾選（permission / 失敗 / 完成）、試聽按鈕。
- [ ] 偏好欄位寫入 desktop-preferences，並移除 `localStorage` 作為真實來源（僅保留一次性 migration，已有 `initializeLegacySound`）。
- [ ] 音效播放受 `fullscreenAutoHide` 與寵物實際可見性約束（寵物被自動隱藏時不出聲，除非是 permission 且設定允許）。
- [ ] broker 新請求（非事件）也觸發 permission cue，避免 relay 時序造成漏聲。
- [ ] cue 加入 `prefers-reduced-motion`/無障礙考量不適用，但需考慮「重複請求連續出聲」的節流（例如 3 秒內只播一次）。
- [ ] 評估為 permission 使用較顯著的雙音調並與 success 明顯區隔（目前 permission 為 520Hz 雙嗶，與 success 的上行音區分度有限）。
- [ ] 測試：DND、fullscreen 隱藏時不播放。

**修改檔案**：`sound.ts`、`App.vue`、`agentStore.ts`、`SettingsDesktop.vue`、`desktop-preferences.ts`、`src/types/desktop.ts`、locales、tests。

---

## PM-13　全螢幕偵測：macOS 為靜態策略、無法讓 permission 穿透；Windows 僅前景視窗（P1）

**證據**
- `desktop-visibility.ts:23-27`：macOS 一律回報 `macos-native`，實際實作只是 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !fullscreenAutoHideEnabled })`（`runtime.ts:1594-1612`），沒有偵測，也沒有因 permission 請求而暫時顯示的路徑。
- Windows 路徑在有 active permission 時會 `restoreWindowsHiddenByFullscreen`（`runtime.ts:2212-2218`），mac 沒有對應邏輯，兩平台行為不一致。
- 因此 macOS 開啟「全螢幕自動隱藏」時，使用者在全螢幕 app（Space）內，agent 要求 permission：泡泡不可見、DND 抑制通知、tray 圖示在全螢幕選單列也隱藏，60 秒後逾時，沒有任何出口。
- Windows `windows-fullscreen-detector.ts:341-440`：只檢查前景視窗；`isExternalFullscreenWindow`（`:172-187`）排除有 `WS_CAPTION`/`WS_THICKFRAME` 的視窗，專屬全螢幕遊戲可能漏判；副螢幕上非前景的全螢幕影片不會被偵測。
- 偵測器初始化失敗時（`runtime.ts:2263-2266` 附近 `console.warn`）設定被停用，UI 文案 `fullscreenAutoHideUnavailable` 只說「沒有可用的偵測器」，不提原因。
- `zh-TW.json:86` 說明含「原生 Space 行為」「Win32 event detector」等工程術語。

**使用者影響**：想「全螢幕時別打擾我」的人，同時也失去「但 permission 要讓我知道」的可能；兩平台行為不同卻沒解釋。

**子任務**
- [ ] macOS：新增「permission 到達時暫時以 `visibleOnFullScreen: true` 顯示」邏輯（有 active 請求時覆寫策略，結束後還原），與 Windows 行為對齊；這是讓請求可見，不改變決策邊界。
- [ ] 設定項提供子選項「全螢幕時仍顯示 Permission 請求」（預設開），並寫入說明。
- [ ] 全螢幕被隱藏期間，若有 permission 請求：發原生通知（即使 DND 時亦可選擇例外，見 PM-09）。
- [ ] Windows：加入對「全螢幕 + 有 caption 的 D3D/borderless-fullscreen」的偵測補強或明確文件說明限制（維持保守策略，避免誤藏）。
- [ ] 偵測器失敗原因寫入診斷並於設定頁顯示（例如「Windows 原生模組載入失敗」）。
- [ ] 重寫 zh-TW 說明為使用者語言：「在其他程式全螢幕時暫時隱藏寵物」，工程細節移至展開說明。
- [ ] 增加 macOS / Windows 行為差異對照表於設定頁。
- [ ] 測試：mac 有 active 請求時 `visibleOnFullScreen` 被強制為 true（可 mock window）。

**修改檔案**：`runtime.ts`、`desktop-visibility.ts`、`windows-fullscreen-detector.ts`、`SettingsDesktop.vue`、`desktop-preferences.ts`（若新增子選項）、locales、tests。

---

## PM-14　zh-TW 文案與 i18n：硬編碼英文、術語不一致、過時說明（P1）

**證據**
- `DesktopPet.vue:656-672` 的「Deny」「Allow once」直接寫在模板，未走 `t()`，zh-TW 使用者看到英文按鈕，儘管 `permissionDeny`/`permissionAllowOnce` key 已存在（`zh-TW.json:302-303`）。
- `desktop-tray.ts:122` `'Presentation MCP'` 寫死。
- zh-TW 混用「Permission」未翻譯（`permissionNeeded`「需要 Permission」、`permissionBubble`「Permission 泡泡」、`notificationNeedsPermission`）；同一頁還有「允許一次」「拒絕」，術語不統一（建議統一為「權限」）。
- `permissionBubbleHelp`（`zh-TW.json:101`）「隱藏後請求仍會保留待處理」誤導：請求仍受 TTL，約 60 秒後過期。
- `permissionWarning`「請先回到 OpenCode 檢查」寫死產品名（見 PM-03）；`permissionInlineHint`、`permissionCountdown`、`trayTooltip` 為孤兒 key（grep 僅在 locales 內出現）。
- `StatusPanel.vue:184` 的經過時間 `${...}s` 沒有本地化（無單位翻譯）。
- `captureExclusionHelp` / `fullscreenAutoHideHelp` 過長、技術性強。
- `checkUpdates`「檢查更新（目前無法使用）」為常駐死項目文案。

**使用者影響**：中文介面出現英文按鈕；說明與實際行為不符，降低信任。

**子任務**
- [ ] 泡泡按鈕與 tray 的所有字串改走 `t()`；在 `tests/i18n.test.mts` 加規則：`DesktopPet.vue` 與 `desktop-tray.ts` 不得含未翻譯的使用者可見英文字串。
- [ ] 術語表：統一「Permission」→「權限」，「Allow once」→「允許一次」，「Deny」→「拒絕」，保留 Agent 名稱英文。
- [ ] 修正 `permissionBubbleHelp` 兩語言：說明「請求最多保留 N 秒；關閉泡泡時可從面板處理」，N 由 TTL 常數（共用型別）提供。
- [ ] 刪除孤兒 key 或接上 UI。
- [ ] 時間格式化統一使用 `Intl.RelativeTimeFormat` / 自訂 `formatDuration`。
- [ ] 縮短並重寫桌面行為說明，工程細節放入「了解更多」。
- [ ] 通知標題改為較自然中文：「Claude 需要你的權限確認」「Claude 已完成工作」。
- [ ] i18n 測試覆蓋 en-US / zh-TW 的 key 對稱（已有 `tests/i18n.test.mts`，補孤兒 key 檢查）。

**修改檔案**：`DesktopPet.vue`、`desktop-tray.ts`、`StatusPanel.vue`、locales、`tests/i18n.test.mts`。

---

## PM-15　無障礙：alertdialog 無焦點管理、字級過小、僅 UI 無歷史（P2）

**證據**
- `DesktopPet.vue:630` `role="alertdialog"` 但未在出現時移動焦點、無焦點陷阱、無 `Esc`、無 `aria-modal`，也沒有 `aria-live` 通知螢幕閱讀器（alertdialog 本身不保證播報透明視窗內容）。
- `DesktopPet.css:853` 按鈕 `9.5px`，`:891` `kbd` `7px`，`:819-831` 描述使用 `--font-xs`，皆低於一般可讀性門檻；`.permission-request-icon` 為「!」文字符號。
- 風險等級只用邊框色差異（`.risk-high`），`low/medium/unknown` 沒有樣式；雖有文字標籤，但標籤字級同樣偏小。
- 已有的優點：`prefers-contrast`、`prefers-reduced-transparency`、`prefers-reduced-motion` 皆已處理（`DesktopPet.css:1195-1260`），可沿用。
- `electron/permission-audit.ts:39-52` 稽核只存 id / status / reason，沒有 action / risk / project；而且沒有任何 UI 讀取它，使用者無法回頭查「我昨天允許了什麼」。
- `permission-audit.ts:10-22` 每筆記錄同步讀整檔 → 解析 → 寫整檔 + fsync，在請求爆量時阻塞主執行緒。
- `ipc/permission.ts:32` 所有決策來源記為 `'bubble'`（含面板卡片），稽核無法區分泡泡 / 面板。
- `permission-broker.ts:169-170` `requests` Map 永不刪除終態項目，上限 5,000（`:17,251`）後所有新請求回 `capacity_exceeded`，直到 app 重啟（長時間執行的常駐程式會中招）。

**使用者影響**：螢幕閱讀器 / 低視力使用者難以操作；無法審視歷史；長時間運行後 permission 功能突然失效。

**子任務**
- [ ] 泡泡出現時（使用者啟用「鍵盤焦點」偏好或使用輔助技術時）將焦點移到「拒絕」按鈕；`Esc` = 拒絕（視窗內）。
- [ ] 按鈕、`kbd`、描述字級提高到 ≥12–13px，並維持 min-height 36px。
- [ ] 以 `aria-live="assertive"` 的隱藏區塊播報「OpenCode 要求 bash 權限，高風險」。
- [ ] 風險等級加入 icon + 文字 + 圖樣（不只顏色），4 種都有明確樣式。
- [ ] broker 將終態請求超過保留數（例如最近 200 筆或 10 分鐘）後從 `requests` 刪除；`capacity_exceeded` 只針對 active 請求計算；補測試：發送 6,000 個序列請求仍可建立新請求。
- [ ] 稽核記錄加入 `decidedVia: 'bubble' | 'panel' | 'hotkey'`（擴充 `PermissionDecisionSource`），並加入 `action` 與 `risk`（不含 description / 參數，避免洩漏）；寫入改為 append-only JSONL 或批次 debounce。
- [ ] 設定頁新增「最近 Permission 記錄」檢視（讀取稽核檔，僅顯示 action/risk/結果/時間），並提供「清除」。
- [ ] `permission-adapter-server.ts:129` 的 `records` Map 同樣需對終態項目做清理（避免外部索引無限成長）。

**修改檔案**：`DesktopPet.vue/.css`、`permission-broker.ts`、`permission-audit.ts`、`permission-adapter-server.ts`、`ipc/permission.ts`、`src/types/permission.ts`、`SettingsDesktop.vue` 或新 `SettingsPermissions.vue`、locales、tests。

---

# 新設計提案

## A. Permission 泡泡（248px 寬，維持 Liquid Glass 玻璃樣式與既有 token）

```
┌──────────────────────────────────────────┐
│ [OC] OpenCode · my-project        1 / 3 ▾│  ← 來源 chip + 專案；點 ▾ 展開佇列
│ ─────────────────────────────────────────│
│ ⚠ 執行指令              [高風險 ▲]       │  ← icon + 文字 + 邊框（非僅顏色）
│ ┌──────────────────────────────────────┐ │
│ │ rm -rf ./dist && npm run build       │ │  ← monospace，3 行，可展開 / 複製
│ └──────────────────────────────────────┘ │
│ 內容已縮短（已省略 142 字）  [展開] [複製]│
│                                          │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░  剩餘 0:42              │  ← 倒數；<15s 轉警示 + 文字
│                                          │
│ [ 拒絕  ⌘⇧N ]        [ 允許一次  ⌘⇧Y ]  │  ← 高風險：無熱鍵，改為按住 0.6s 確認
└──────────────────────────────────────────┘
   佇列展開（點 ▾）：
   ┌──────────────────────────────────────┐
   │ 1 bash   OpenCode · my-project  0:42 │
   │ 2 read   OpenCode · docs        0:58 │
   │ 3 read   OpenCode · docs  ×2    0:58 │
   │ [全部拒絕]（需確認）                 │
   └──────────────────────────────────────┘
   結果態（顯示 4 秒後淡出）：
   ┌──────────────────────────────────────┐
   │ ⏱ 已逾時：OpenCode 已收到取消        │
   │ [在面板檢視]                         │
   └──────────────────────────────────────┘
   Codex / Claude（external-only，唯讀提醒）：
   ┌──────────────────────────────────────┐
   │ [CL] Claude · my-project             │
   │ 正在等你在終端機核准                 │
   │ 此 Agent 的權限只能在原工具中回應 [?]│
   │ [複製專案路徑]            [知道了]   │
   └──────────────────────────────────────┘
```

設計要點：
- 新請求出現後 300ms 內按鈕禁用，避免誤點；`Esc` 為視窗內「拒絕」。
- 不新增「永遠允許」；`allow_once` / `deny` 兩值不變。
- 熱鍵標示依平台與註冊成功與否動態顯示；失敗時顯示「快捷鍵被佔用」。
- 最小字級 12px；風險使用 icon + 文字 + 邊框三重提示。

## B. Tray 選單（分組 + 子選單 + 可操作的待處理區）

```
Agent Pets
─────────────────────────────
⚠ 2 個待處理（1 Permission · 1 等待輸入）   ← 可點，開啟面板並定位
─────────────────────────────
 顯示 / 隱藏寵物              ⌘⌥P
 開啟控制面板
 迷你模式                      ☐
─────────────────────────────
 勿擾模式                      ▸  ┌ 關閉
   （剩餘 42 分）                 │ 30 分鐘
                                  │ 1 小時
                                  │ 到明天 09:00
                                  │ 依排程…
                                  └ 持續
 通知                          ☑
 音效                          ☑
 Permission 泡泡               ☑
─────────────────────────────
 進階                          ▸  ┌ Edge Peek 模式
                                  │ Presentation MCP
                                  │ 開機時啟動
                                  └ 全螢幕時自動隱藏
 插件                          ▸  （外掛指令；超過上限顯示「還有 N 項…」）
 設定…
─────────────────────────────
 結束 Agent Pets
```

設計要點：
- 頂部的待處理項可點擊（目前為 disabled 文字）。
- 移除常駐停用的「檢查更新」。
- 所有字串走 i18n（含 `Presentation MCP`）；插件插入點以結構化方式處理。
- macOS 圖示用 template image + `setTitle` 顯示數字，Windows 用數字徽章；tooltip 顯示摘要。

---

## 優先順序建議

1. P0（先做）：PM-01、PM-02、PM-03、PM-04、PM-07，其中 PM-15 的「broker `requests` 永不清除、5,000 後 `capacity_exceeded`」亦屬功能性風險，建議一併先修。
2. P1：PM-05、PM-06、PM-08、PM-09、PM-10、PM-11、PM-13、PM-14。
3. P2：PM-12、PM-15 其餘項目。

依專案 AGENTS.md，請一次做一個 roadmap phase；涉及 `PermissionRequestView`（公開契約）與 `desktop-preferences` 持久化 schema 的變更（PM-01、PM-03、PM-09、PM-12）屬於 minor 版本候選，其餘為 patch。
