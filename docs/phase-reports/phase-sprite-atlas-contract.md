# Sprite 圖集規格單一來源與寵物包 behaviorManifest

## 範圍

- 新增 `src/types/pet-atlas.ts`：格子尺寸、欄列數、v1/v2 列數、上限、列名、固定動作表（列號與每格時長）、behaviorManifest 上下限，以及 `resolvePetMotion`。
- 主程序 `electron/pet-sprite-validation.ts`、`pet-behavior-manifest.ts`、`pet-import.ts`、`ipc/pet-assets.ts`、`ipc/pets.ts` 與畫面端 `PetAnimation.vue`、`DesktopPet.vue/.css`、`App.vue`、`agentStore.ts`、`pet-motion-plan.ts`、`pet-atlas-preview.ts`、`status-line-fit.ts` 改從這裡匯入。CSS 的格寬改用 App.vue 設定的 `--pet-cell-w`。
- `behaviorManifest` 從只認 `walk`／`sleep` 放寬為任何動作（`idle`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`、`walk`、`sleep`）。

## 安全邊界

`pet.json` 與插件外觀的 `behaviorManifest` 視為不受信任輸入：

- 只讀 `PET_MOTION_NAMES` 中的自有屬性（`Object.hasOwn`），未知鍵與繼承鍵一律忽略。
- `row` 0–63、`frames` 1–16、`frameDurations` 1–16 個有限數字並夾在 60–3000 ms；任一欄不合法就丟掉整筆，該動作用內建值。
- 已知實際圖集尺寸時（zip 匯入、插件外觀載入）再丟掉列號 ≥ 列數或格數 > 欄數的項目；zip 匯入沿用 `behavior-row-out-of-range` 警告（文案改為涵蓋列與格）。
- 自訂寵物的 `pet.json` 在載入時不讀圖檔，由畫面端 `resolvePetMotion` 在圖載入後用 `naturalWidth/Height` 再篩一次；時長陣列一定和格數等長，不會產生 `NaN` 延遲（修正原本 `frameDurations` 比 `frames` 短時的問題）。

## 驗證

- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design:strict`（`--font-xl` 未使用為既有狀態）通過。
- `pnpm run test:unit`：1228 個，1227 通過、1 略過、0 失敗（review 後重跑；`presentation-stdio` 在一次全量執行中逾時一次，單獨與再次全量執行都通過）。新增 `tests/pet-atlas.test.mts`（規格對照、正向／反向解析、繼承鍵、格線篩選、resolver 回退、窄圖集、禁止重複字面值），`tests/pet-import.test.mts` 新增覆蓋任何動作與超出圖集的案例。
- `node scripts/e2e-isolated-electron.mjs --hook-port-base 27473`（假 safeStorage、隔離 HOME，未觸發鑰匙圈）：寵物 canvas 384×416 backing／192×208 CSS；idle 6 個不同影格；thinking→review@8、tool-running→running@7、waiting-input→waiting@6、error→failed@5、success→jumping@4（0.1 s）→waving@3（1.7 s）→idle@0（3.1 s）；覆蓋 `idle: {row: 9, frames: 4}` 實際播第 9 列；`idle: {row: 40}`、`review: {row: 9, frames: 20}` 在 8×11 圖上回退內建列。

## Review 與效能

- 逐檔審查後修正：渲染端再檢查列號（整數、≥ 0）並夾時長；只讀自有鍵（`Object.hasOwn`）；共用動作表、列名、動作名稱全部凍結。
- PetAnimation 熱路徑：
  - 動作改成每次 manifest 或圖改變時用 `resolvePetMotionTable` 建一次凍結表，換動作時 O(1) 查表。沒有覆蓋值、標準 8 欄的圖共用同一張表，換圖時不會重排。
  - 逐格延遲在換步驟、節奏條件或低幀率改變時算好，每格只讀陣列。
  - `draw()` 不再每格配置 `targets` 陣列。
  - reduced-motion 改由共用的 `useReducedMotion`（整個視窗只建一個 MediaQueryList），不再每格呼叫 `matchMedia()`。
- 既有問題一併修正：播放中更換 manifest 會立即重排；三個重新載入的 watch 共用 `reloadPet()`；touched 範圍的註解改成繁中並加上區塊標頭。
- 量測：
  - 同一台機器、隔離 e2e，迷你模式 8 秒內：改動前 11 格、`matchMedia` 呼叫 11 次；改動後 12 格、0 次。
  - Node 微基準（每次操作）：逐格延遲 39.8 → 22.5 ns；繪製目標 111.8 → 12.7 ns（不配置物件）；換動作 228.4 → 111.6 ns。
  - success 的 jumping → waving 時間點和改動前一致（約 1.7 秒）。

## 真實 hook 送達與 reduced-motion

- reduced-motion 統一：DesktopPet（Shimeji）、SegmentedControl、SettingsPage、PetImportDialog 改用 `useReducedMotion`，`src` 裡只剩這個 composable 會查 `prefers-reduced-motion`（`tests/reduced-motion.test.mts` 會擋新的直接呼叫）。PetImportDialog 開著時切換系統設定也會立即生效。
- 修正：低幀率或 reduced-motion 改變時，已排好的那一格改用新延遲；之前從慢速切回正常要等完舊的延遲（最多數秒）。
- 真實 hook 路徑（`scripts/e2e-real-hook.mts`，隔離埠 27373–27375）：
  - 方法：在隔離 HOME 執行真正的 `installIntegration('claudeCode')`，產生隔離的 `.claude/settings.json` 和部署的 `agent-hook.mjs`；部署腳本只改兩個網址的埠。照 Claude Code 的方式，從那份 settings 讀出 hook 指令、用 stdin 送 payload。沒有啟動 `claude` CLI，你本機 `~/.claude/settings.json` 的雜湊與修改時間前後相同，假 safeStorage 確認生效。
  - 結果：SessionStart → idle、UserPromptSubmit → thinking、PreToolUse → tool-running、PostToolUse → thinking、Notification（waiting for your input）→ waiting-input、StopFailure → error、Stop → success、SessionEnd → offline。內建寵物與寵物包各跑過多輪，共 40 個事件全部符合預期。
- 自訂寵物包走真實的 `loadPets`（`--pet-pack`）：
  - 主程序清理結果：idle 時長夾成 `[200, 60, 3000, 150]`；waving（時長含 `"x"`）、failed（99 格）、waiting（-1 列）整筆丟掉；未知鍵忽略；running 第 40 列保留給畫面端判斷。
  - 用 hook 驅動後畫面：idle@9、review@10、running@7（第 40 列超出 11 列，回退內建）、waiting@6、failed@5、jumping@4。
- reduced-motion 實機（CDP 模擬系統設定）：thinking 狀態 4 秒內，reduce 畫 4 格，no-preference 畫 23 格（切換後 93 ms 就畫出第一格），再切回 reduce 又是 4 格。

## 殘餘風險

- 只在 macOS 驗證；Windows／Linux 未實測。
- 最早一次用 hook 驅動（還在用 27673 埠、直接呼叫腳本的版本）時，PreToolUse、StopFailure、Stop 三個事件沒有反映在畫面上。已在 1.12.4 查明並修正：hook 的 300 ms 時限在機器忙碌時，會在請求送出前就到期（見 [phase-hook-delivery.md](phase-hook-delivery.md)）。
- 使用者手動編輯 `custom/<id>/pet.json` 時，主程序只做上下限檢查，實際列數檢查在畫面端。

## 版本

公開的寵物包介面（`behaviorManifest`）放寬，原本建議 minor；使用者指定用 patch，已升到 1.12.2（`chore: release 1.12.2`）。
