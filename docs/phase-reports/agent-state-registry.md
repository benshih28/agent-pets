# Agent 狀態 registry

## 範圍

每個 `AgentState` 的對應資料原本散在約 10 處（4 個常數表、2 個 util 表、5 個 switch、1 份重複的完整狀態清單）。現在收成兩張用 `as const satisfies Record<AgentState, …>` 檢查的表，新增狀態時任何一格沒填都會讓型別檢查失敗。

| 表 | 位置 | 欄位 | 使用者 |
|---|---|---|---|
| `AGENT_STATE_POLICY` | `src/types/agent.ts` | `priority`、`notification`（`null` 或 `{ terminal }`）、`historyOutcome` | 主程序（通知、歷史）與 renderer（優先序） |
| `AGENT_STATE_PRESENTATION` | `src/utils/agent-state-presentation.ts` | `label`、`shortLabel`、`color`、`ariaKey`、`lineWord`、`mini`、`cue` | 只有 renderer |

- `STATE_PRIORITY` 改由 policy 表推導，對外保留同名匯出。
- 移除 `STATE_LABELS`、`STATE_LABELS_SHORT`、`STATE_COLORS`、`STATE_LINE_WORDS`、`STATE_ARIA_KEYS`。呼叫端改讀 presentation 表。
- 以下的 switch 改成查表：`DesktopPet.vue` 迷你徽章、`notification-policy.ts`、`history-sessions.ts` 的 `nextFinalState`，以及以 `SoundCue` 為鍵的 `sound.ts`（音形）和 `sound-policy.ts`（開關）。
- 主程序只補自己的通知標題表 `NOTIFICATION_TITLE_KEYS`，型別是 `Record<NotifiableAgentState, TranslationKey>`，其中 `NotifiableAgentState` 由 policy 表推導。
- 帶條件的邏輯留在原處：external-only 權限標題，以及 store 依狀態轉換判斷要不要播音（例如成功太快不播）。
- `electron/history.ts` 的重複完整狀態清單和 store 的快照還原檢查，改用 `isAgentState`（`Object.hasOwn`）。
- 刪除沒有任何呼叫端的 `src/utils/state-label.ts`。`design.state.*` 語系 key 仍由 `tests/i18n-html-lang.test.mts` 檢查，所以保留。
- 不在範圍內：`pet-motion-plan.ts`、`PetAnimation.vue`、`pet-sprite-validation.ts`、`pet-atlas-preview.ts`（sprite 線負責）。

## 證據

- 先寫特性測試並 commit（`2617c68`）：在舊程式碼上鎖住每個狀態的優先序、標籤、顏色、狀態列用字、通知候選、歷史結局和音效開關，5/5 通過。重構後同一組數值依然成立。新增的測試會檢查兩張表剛好涵蓋 8 個狀態，不認得的字串（`constructor`、`toString`、`__proto__`）不會被當成狀態。
- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design`、`check:design:strict`：全部通過。design 報告和 base commit 完全相同（`unused:1, rawControls:15, rawColors:0`）。
- `pnpm run test:unit`：1216 pass / 0 fail / 1 skipped。
- 用 `node scripts/e2e-isolated-electron.mjs --hook-port-base 28473` 實測兩次（重構後一次，review 修正後再一次），`fakeSafeStorage: true`，沒有存取鑰匙圈。每個狀態都以帶 token 的 HTTP 事件送進去，再用 CDP 讀寵物視窗：
  - 狀態列用字和點的顏色，8 個狀態都正確，例如 `Working`／`var(--state-active)`、`Needs input`／`var(--state-warn)`。
  - 家族 aria-label 和寵物 aria-label 是已翻譯的說法。
  - 迷你模式透過真實 IPC `setPetWindowMode('mini')` 進入：標籤、外環色、圖示或圓點和原本的 switch 一致。
  - 通知紀錄：等待權限與等待輸入為 `shown`；成功加失敗彙整成一則 `count: 2`；其他狀態不通知。

## 安全與效能

逐檔審查 diff 的結果：

- 主程序只相對匯入純資料模組（`src/types/agent.ts`、`src/i18n.ts`），沒有匯入 `agent-state-presentation` 或 Vue。
- 沒有新增 IPC、檔案 I/O 或網路。
- hook 和事件的狀態字串、`event-normalizer` 的別名、英文標籤、通知 kind 都沒變。
- 修掉一個小漏洞：store 原本用 `in STATE_PRIORITY` 檢查快照，`'constructor'` 會被當成合法狀態還原。`isAgentState` 現在改用模組載入時建好的 `Set`。
- 兩張表、`STATE_PRIORITY`、`AGENT_STATES` 都用 `freezeRegistry` 連同巢狀物件凍結，測試確認誤改會丟 `TypeError`。

順手修的既有問題：

- touched 範圍內的英文註解改成繁中，包括 `agent.ts`、`history-sessions.ts` 全檔。
- 三個面板元件的 import 改成 stores → types → composables → components → utils 的順序。
- `HistorySessionDetail` 自己的 `TERMINAL_STATES` 和 `HISTORY_TERMINAL_STATES` 重複，改成共用後者。
- `statePresentation` 改用 `isAgentState`，不再另寫一份檢查。

熱路徑量測（Node 26，50 萬次平均）：

| 項目 | 舊版 | 新版 |
|---|---|---|
| `classifyNotification` | 約 1030 ns | 約 970 ns |
| `nextFinalState` | 19 ns | 27 ns |
| 狀態檢查 | 43 ns（`in`） | 26 ns（`Set`） |

- `nextFinalState` 改成模組載入時建好的 `Map`，一次 O(1) 查找。第一版用 `hasOwn` 加查表是 80 ns，這一版把它降下來；剩下的差距在量測雜訊範圍內。
- 挑最高優先 session（`mostUrgentSession`、`summarizeFamilies`）原本就是單次掃描 O(n)，不排序；淘汰則用索引堆積。這兩處都不需要改。
- 面板的 `sessionList` 是顯示用的完整排序（n 上限 200），只在面板視窗有人讀時才計算。同分時最後一層原本每次比較都呼叫 `localeCompare`，現在改成載入時算好的來源名次，排序結果經驗證完全相同。量測結果：
  - 一般資料，n=200：157 → 142 µs
  - 最壞情況（全部同分）：120 → 102 µs
- 沒有把 `sessionList` 改成增量維護的有序結構：n 有上限，最壞約 0.1 ms，複雜度不划算。

## 殘留風險

- 實測只在 macOS；Windows 未測。
- `src` 和 `electron` 裡還有 8 處只用部分狀態的分類 Set，各自語意不同，維持原樣：
  - `session-attention`、`session-view` 的 attention／running
  - `HistorySessionDetail`、`history.ts` 的 terminal／active
  - `event-server` 的 rate-limit 優先
  - `StatusPanelSessions` 的 live
  - `progression` 的 active
  - `pet-motion-plan` 的 waiting（sprite 線負責）
- `event-normalizer` 的 `VALID_STATES` 含有外部別名 `waiting`，屬於 hook 契約，沒有動。

## 與 sprite 圖集線的合併檢查

拿 sprite 線的 `claude/pet-atlas-contract-603e87`（`31501b6`）和這條線試合併，結果如下：

- **文字衝突**：只有 `package.json` 版本號，取 1.12.3。
- **兩邊都改到的檔案**：project-map、conventions SKILL.md、兩份 README、`DesktopPet.vue`／`.css`、`agentStore.ts`，都能自動合併。
- **程式層面**：沒有互相影響。
  - 迷你徽章查表和 `miniScale`（`PET_CELL_HEIGHT`）是兩個互不相依的 computed。
  - 徽章的 pulse 動畫由 `tokens.css` 全域的 reduced-motion 規則處理，跟 sprite 線 JS 端的 `useReducedMotion` 無關。
  - `SOURCE_LABEL_RANK` 和 `MULTI_PET_CELL_W` 是不同的常數。
- **文件層面的矛盾，已在本線修正**：
  - 本線原本寫「依狀態而定的資料都集中在兩張表」，但 sprite 線保留的 `pet-motion-plan.ts` 狀態 → 動作 switch 也是依狀態而定。README 兩版、project-map、SKILL §4 D 已補上這個例外。
  - SKILL §1 例外清單的說明原本寫「這 9 個檔案彼此之間不再 import 其他 src 檔案」，兩邊各加一條後已不成立，改成規則說明，順便修正「测試」錯字。

## 版本

Patch：內部重構，沒有改外部契約、持久化結構或安全邊界。使用者確認後升到 1.12.3（`chore: release 1.12.3`）。

最後和 sprite 線（1.12.2）、hook 線（1.12.4，見 [phase-hook-delivery.md](phase-hook-delivery.md)）一起整合進 `main`，以 1.12.4 發版；整合時 `package.json` 取 1.12.4。
