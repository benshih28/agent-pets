# 單一寵物跟著最近有變化的工作階段（1.14.6）

## 問題

單一寵物模式下，寵物本體由 `mostUrgentSession` 決定，原本跟家族狀態列共用 `compareAttention`：依 `STATE_PRIORITY` 排序，同優先序再比 `firstSeenAt`。

- Claude 在 `tool-running`（優先序較高）時，Codex 從 `idle` 進到 `thinking`，寵物仍停在 Claude，看不出 Codex 剛開始工作。
- 同為工作中的兩個工作階段，永遠是先出現的那個勝出，後面才動起來的工具幾乎不會被寵物顯示。

## 修正

寵物的焦點分三層，寫進狀態 registry：

- `src/types/agent.ts`：`AgentStatePolicy` 新增 `petFocus: 'attention' | 'recent' | 'background'`。
  - `attention`：`waiting-permission`、`waiting-input`、`error`。等使用者處理的狀態一律優先。
  - `recent`：`thinking`、`tool-running`、`success`。這一層內，狀態最近改變的工作階段勝出。
  - `background`：`idle`、`offline`。不會搶走工作中的工作階段。
- `AgentSession` 新增 `stateChangedAt`，只在狀態真的改變時更新：
  - `src/stores/agent/sessions.ts`：事件的狀態和前一個不同時才寫入；新工作階段用事件時間；快照還原時沒有這個欄位就用 `lastSeenAt`。閒置清掃不會改它。
  - `electron/main/session-snapshot.ts`：主程序快照用同樣規則保存，重開視窗後焦點不會跳回舊的工作階段。
- `src/utils/session-attention.ts`：
  - `mostUrgentSession` 改用 `comparePetFocus`：先比層級，`recent` 層比 `stateChangedAt`，其他情況交給原本的 `compareAttention`。仍是一次走訪、不排序，O(n)。
  - `ATTENTION_STATES` 改由 registry 推導，不再手寫清單。
  - 用 `stateChangedAt` 而不是 `lastSeenAt`：同狀態的心跳事件很頻繁，若用 `lastSeenAt`，兩個忙碌的工作階段會讓寵物每次事件都換人。
- 家族狀態列（`summarizeFamilies`）維持 `compareAttention` 順序，不受影響。

### 行尾設定

這輪有幾個檔案被工具寫成 CRLF，`git diff` 出現警告。為了之後的檔案不再發生：

- 新增 `.editorconfig`：`end_of_line = lf`、`charset = utf-8`、`insert_final_newline = true`。
- 新增 `scripts/check-line-endings.mjs`：用 `git ls-files --eol` 檢查工作目錄，有 `w/crlf` 或 `w/mixed` 就失敗。已接進 `pnpm lint`，CI 也會跑。
- 本機 repo 設定 `core.autocrlf=input`（只影響這個 clone，不會提交）。原本 `.gitattributes` 的 `* text=auto eol=lf` 保留。

## 驗證

- 單元測試新增 9 個：
  - `tests/session-attention.test.mts` 5 個：後變化的工作中階段勝出、等待中的狀態勝過最近變化、`idle` 不搶焦點（剛完成的 `success` 短暫勝過較早的工作中）、缺 `stateChangedAt` 時退回 `lastSeenAt`、每個狀態都有宣告焦點層級。
  - `tests/agent-store-characterization.test.mts` 3 個：`stateChangedAt` 只在狀態真的改變時更新（同狀態重複與閒置清掃都不動）、跨家族時寵物跟著最近變化再交回、快照還原。
  - `tests/turn-end-watcher.test.mts` 1 個：主程序快照保存 `stateChangedAt`，同狀態事件不覆寫。
- `pnpm test:unit`：1859 個測試，1820 個通過、39 個略過、0 個失敗。main 分支基準是 1850 個、1811 個通過、39 個略過；略過的是平台相關測試，兩邊一致。
- `pnpm lint`（含行尾檢查、main-process lint、tests 型別檢查）、`vue-tsc --noEmit`、`git diff --check`：通過。
- 行尾檢查兩個方向都測過：正常情況通過，放一個 CRLF 檔案時失敗。
- 實機（隔離的 Electron，視窗在螢幕外、`showInactive`，hook port 27373、獨立 home 與 userData）：送真實 HTTP 事件到 `/v1/events`，從 renderer 的 Pinia store 讀 `highestPrioritySession`，7 項全部符合：
  1. Claude `tool-running` → 寵物是 Claude。
  2. Codex 之後進入 `thinking` → 換成 Codex。
  3. Claude 再送同狀態的 `tool-running`（心跳）→ 仍是 Codex。
  4. Claude 改成 `thinking` → 換成 Claude。
  5. Codex 變成 `idle` → 仍是 Claude。
  6. Codex `waiting-permission` → 換成 Codex。
  7. Claude 之後改成 `tool-running` → 仍是等待權限的 Codex。

## 安全與效能

- 沒有新增 IPC、網路、權限或檔案路徑。快照多一個數字欄位，舊快照沒有這個欄位時有退路。
- `mostUrgentSession` 仍是一次走訪、不排序，比較時只多一次 registry 查表。

## 殘留風險

- 兩個工作中的工作階段若對應到不同的寵物外觀，每次狀態切換寵物圖都會跟著換。這是「跟著最近變化」的預期行為，但切換頻率會比以前高。
- `DesktopPet`、`StatusPanel`、`PetEdgePeekHandle` 傳給計時顯示的 `:since` 仍是 `highestPrioritySession?.lastSeenAt`，顯示的是最後一次事件時間，不是狀態開始時間。這次沒有改。
- `docs/phase-reports/phase-session-jump.md` 描述的是舊的排序方式，屬於歷史紀錄，沒有改寫。
- 升級前保存的快照沒有 `stateChangedAt`，還原後先用 `lastSeenAt` 排序，下一次狀態改變後就正確。

## 版本建議

Patch：1.14.5 → 1.14.6。行為調整，快照新增選用欄位且向下相容，沒有變更公開契約。

`release.yml` 在 main 的 `package.json` 版本改變時自動發版。1.14.6 還包含全專案註解清理（第二個 PR），所以版本號放在註解清理那個 PR，這個 PR 先合併、不改版本。
