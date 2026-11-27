# 修正：重寫 hook 時移動 Agent Pets 的位置，Codex 停跑所有 hook（1.14.5）

## 問題

Codex 的 hook 有在跑，但 Agent Pets 一重寫 `~/.codex/hooks.json`，寵物就不再依 Codex 更新狀態，直到使用者在 Codex 重新審核 hook。

- Codex 依位置記錄信任：`config.toml` 的 `[hooks.state."<hooks.json 路徑>:<event>:<group>:<handler>"]` 要有相符的 `trusted_hash`，hook 才會執行（見 [Agent-Config-Dir-Fix-Plan](../design/Agent-Config-Dir-Fix-Plan.zh-TW.md)）。
- `mergeAgentPetsHooksFile` 每次都先移除 Agent Pets 的 group，再接到事件清單最後面。
- 同一個事件裡有其他工具的 hook 時（例如 Work Intelligence 的提醒），只要 Agent Pets 原本不在最後，重寫就會把每個 group 的位置換掉。內容即使完全沒變，檔案還是被改寫，Codex 也因此把這個事件的所有 hook 當成被修改過，連其他工具的 hook 一起停跑。

### 實機證據（2026-11-26）

- 21:51 Work Intelligence 加入自己的 hook，Agent Pets 留在每個事件的第 0 組。21:52 的 Codex 對話裡兩組 hook 都有執行，`history.sqlite` 收到 `session.started`／`completed`。
- 22:27 Agent Pets 重新啟動後重寫 `hooks.json`。備份 `hooks.json.agent-pets-bak-2026-11-26T14-27-39-009Z` 裡 Agent Pets 在第 0 組，重寫後變成第 1 組，指令內容與重寫前完全相同。
- 22:28 Codex 寫入 `config.toml`，`trusted_hash` 依新順序對調，也就是使用者重新審核了一次。

## 修正

`electron/hook-config.ts`：

- 新增 `stripAgentPetsHooks`。它移除 Agent Pets 的 handler，並記下第一個含 Agent Pets handler 的 group 應放回的位置。`removeAgentPetsHooks` 改用這個函式，行為不變。
- `mergeAgentPetsHooksFile` 把 Agent Pets 的 group 放回原位，只有原本沒有時才接在最後。內容相同時，序列化結果和原檔一樣，`writeConfigSafelyAsync` 回報 `unchanged`，不寫檔也不留備份。
- 使用者自己的 group 裡混有 Agent Pets handler 時，Agent Pets 的 group 會放在該 group 之後，讓使用者的 group 維持原本的位置。

Claude Code 的 `settings.json` 也走同一個合併函式，一樣不會再被無謂地重排。

## 驗證

- `tests/hook-config.test.mts` 新增 3 個測試。修正前 3 個都失敗，修正後都通過：
  - Agent Pets 在第 0 組與第 1 組時，更新舊指令後位置都不變，第二次合併回報 `unchanged`。
  - 已是最新內容時，不論 group 順序，檔案都一字不差，也沒有備份。
  - 混合 group 的情況：Agent Pets 的 group 放在使用者 group 之後，後面的 group 不受影響。
- 用使用者 `~/.codex/hooks.json` 的兩個副本實測（在 repo 外的暫存目錄，未改動原檔）：現行版（Work Intelligence 在前）和 22:27 重寫前的版本（Agent Pets 在前），合併結果都是 `unchanged`，檔案內容沒有變動。
- `pnpm test:unit`：1850 個測試，1848 個通過、2 個略過、0 個失敗。
- `pnpm lint`（含 main-process lint 與 tests 型別檢查）：通過。
- `vue-tsc --noEmit`：通過。
- `git diff --check`：通過。

## 安全與效能

- 寫檔仍走原本的 `writeConfigSafelyAsync`（atomic rename、寫入前比對內容、衝突重試、備份上限）。沒有新增 IPC、網路、權限或檔案路徑。
- 每個事件的處理仍然是掃一次 group 清單，O(n)。比起修正前，少了內容相同時的寫檔與備份。

## 殘留風險

- 這次修正之前已經被移到後面的 hook，順序不會自動還原。現行順序已經過使用者重新審核，維持原狀就是正確的。
- 先移除 Agent Pets 再重新安裝時，Agent Pets 仍會接在最後，Codex 也仍會要求重新審核。這是新增 hook 的必然結果。
- 22:27 那次重寫的觸發點（啟動時自動修復或手動安裝）沒有直接記錄，是從檔案時間推斷的。
- 修正後還沒在真實的 Codex 對話裡觀察寵物狀態，Windows 也沒有驗證。

## 版本建議

Patch：1.14.4 → 1.14.5。修的是安裝程式的錯誤，沒有變更公開契約或設定格式。
