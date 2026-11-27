# 全專案註解清理（1.14.6）

## 問題

程式碼裡有大量「把程式碼翻成文字」、區塊標頭、修改歷史和長篇設計說明的註解。

- 每個讀檔的 agent 都要把這些註解讀進上下文，卻不會因此更懂專案。
- 背景與設計理由已經記在 phase 報告、`docs/` 和工作記錄的知識頁裡，需要時可以查。
- 舊的慣例 skill 還要求在大檔案加區塊標頭，所以註解只會越來越多。

## 修正

- `.agents/skills/pet-skill/SKILL.md` 新增「Keep comments rare」準則：
  - 預設不寫註解。
  - 只保留拿掉後很可能讓人改壞程式的一到兩行「為什麼」，例如平台怪癖、外部契約值、排序／安全／並行 invariant、看起來像 bug 的刻意取捨。
  - 功能性標記一律保留。
  - 背景與歷史改放 phase 報告、`docs/` 或工作記錄知識頁。
- `references/ui-design-system.md`：新增 token 時改成用名稱表達用途，只有名稱說不清楚才加註解。
- 清理範圍是 `src`、`electron`、`integrations`、`scripts`、`tests` 與根目錄的設定檔：590 個程式檔有改動。
  - 不動 `.github` 的 workflow，因為鎖定 action SHA 後面的版本註解有作用。
  - 不動 `docs`。
- 留下的功能性標記：
  - shebang 13 個，`/// <reference>` 2 個。
  - `<!-- raw-control: 理由 -->` 14 個，這是設計檢查實際讀取的數量。
  - `as unknown as` 71 處及旁邊的理由。
- `electron/safe-config-write.ts` 補回一行使用者設定檔的四條寫入規則。
- `tests/status-line-fit.test.mts`：`PetStatusLine.css` 開頭的註解刪掉後，選擇器變成在第一行，測試改成也能找到第一行的選擇器。

## 驗證

- 逐檔比對：把每個改過的 `.ts`、`.mts`、`.mjs`、`.js` 用 TypeScript printer 去掉註解後重印。`.vue` 的 script 照同樣方式處理，template 與 CSS 去掉註解後比對。改動前後的輸出只有 4 處不同，都在預期內：
  - `permission-audit.ts` 與 `permission-hotkeys.ts` 的 `catch` 區塊原本只有註解，現在是 `catch {}`，語意相同。
  - `scripts/e2e-isolated-electron.mjs` 產生的 bootstrap 字串裡有一段註解被縮短。
  - `tests/status-line-fit.test.mts` 為了讀到第一行的選擇器，在讀進來的 CSS 前面加一個換行。
- 清理途中有一批刪單行註解時把換行一起刪掉，造成約 215 處兩行程式碼被接成一行。已全部還原，再用上面的逐檔比對確認，之後也重跑過所有測試。
- `eslint .`、`lint-main-process`、`tsc -p tsconfig.tests.json`、`vue-tsc --noEmit`：通過。
- `check-design-tokens --strict --raw-colors=fail`：報告與 main 相同（rawControlsAccepted 12、rawSpacing 61、rawMotion 24、rawColors 0）。
- `vite build` 與 `check-bundle-size`：通過。
- 單元測試：1859 個，1820 個通過、39 個略過、0 個失敗，與合併 #50 後的 main 相同。
- 隔離的 Electron（視窗在螢幕外，port 27373）：
  - `e2e-isolated-electron.mjs` 修改後仍能正常啟動。
  - 送出 Codex `tool-running` 事件回 204，renderer 狀態變成 `tool-running`，狀態列正常顯示。

## 安全與效能

- 沒有改任何程式邏輯、字串常數、IPC、權限或檔案路徑。
- 執行期沒有差異；原始碼淨減約 5,000 行（+1,137／−6,162），agent 讀檔時占用的上下文跟著變少。

## 殘留風險

- 判斷要不要保留是逐檔人工決定的，有些原本說明「為什麼」的段落被縮成一句。若之後發現少了重要背景，請從 git 歷史或工作記錄查回來，補成一句註解，或寫進知識頁。
- `.claude/skills/agent-pets-conventions` 的 §2、§5 仍是舊規則（還要求加區塊標頭）。這個目錄受專案規則保護，這次沒改。

## 版本建議

Patch：1.14.5 → 1.14.6。本 PR 只清註解，同版還包含已合併的「寵物跟著最近有變化的工作階段」（#50）。
