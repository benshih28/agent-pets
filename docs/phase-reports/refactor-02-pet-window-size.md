# 重構階段 2：寵物視窗尺寸契約、識別碼格式與 `clamp`

- **開始時間**：2026-11-10 10:17（Asia/Taipei）
- **完成時間**：2026-11-10 10:45（Asia/Taipei）
- **基準 commit**：`35f6cb9`（分支 `claude/refactor-02-window-size-3550f0`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 1 項、第 13 項；排程見 3.1 節

## 範圍

1. **寵物視窗尺寸（第 1 項）**：主行程 `createPetWindow()` 手寫的 `250／260／232／190`、`PET_WINDOW_TOP_HEADROOM`、`pet-drag.ts` 的 `PET_WINDOW_HEADROOM_PX = 190`、尺寸上下限 `80／1_600`（儲存 bounds 還原與 `pet-resize` IPC），以及 renderer `pet-window-height.ts`（高度）與 `agentStore.ts`（`PET_BASE_W`、`QUOTA_TOOLTIP_MIN_W`、`MULTI_PET_CELL_W` 寬度）集中到一個不依賴 Electron／Vue 的共用模組。renderer 的 DOM 量測、main 對儲存 bounds 的驗證與 work-area 限制留在原處。
2. **識別碼格式（第 13 項）**：`/^[A-Za-z0-9._:-]{1,N}$/` 在 `history.ts`（256）、`history-sessions.ts`（64）、`permission-broker.ts`（128）、`permission-adapter-server.ts`（128）、`progression-events.ts`（128）、`agent-hook.mjs`（128）各自定義，納入 `src/types/id-patterns.ts`，以具名常數區分長度。`agent-hook.mjs` 由 Node 直接執行，保留字面值並以測試確認與來源相同。
3. **`clamp`（第 13 項）**：`runtime.ts`、`pet-drag.ts`、`pet-window-mode.ts` 三份相同實作合併為共用數值工具。

不在範圍：`panel-layout.ts` 的 `clampNumber`（`min > max` 時回傳 `max`，與上面三份回傳 `min` 不同，合併會改變行為）；`RULE_ID` 等不同字元集的格式；`tokens.css` 的 `--pet-bubble-headroom: 190px`（CSS 無法匯入 TS，維持由測試對齊）。

## 驗收條件

1. 先以測試固定現有數值：冷啟動預設尺寸、單寵寬高（含 pet scale 0.3／0.5／1／2／5）、多寵寬度、tooltip 留白、儲存尺寸與 IPC 尺寸的 80／1600 上下限。抽取後同一批測試不改期望值仍通過。
2. 主行程與 renderer 從同一模組取得尺寸；`createPetWindow()` 不再有寫死的尺寸數字與「keep in sync」註解。
3. 各 ID 入口的長度上限（64／128／256）與字元集不變；正反例測試覆蓋上限與上限 +1。
4. `clamp` 只剩一份，三個入口行為不變（含 `min > max`）。
5. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗，與基準清單比對）、`git diff --check` 通過。
6. Electron 實機驗證：冷啟動無儲存尺寸、不同 pet scale、單寵／多寵、tooltip 留白、既有尺寸還原；不把視窗帶到前景。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試清單 | 通過 | 基準 `test:unit`：1297 項，1265 過、9 失敗、23 skip（8 個已知 + 偶發的「with the pet closed…」） |
| 2 | 以測試固定現有尺寸、ID 與 clamp 行為 | 通過 | 新增 `tests/pet-window-size.test.mts`（以 1.12.5 公式逐值比對）、progression petId 1–128、history adapter 篩選 1–64 邊界測試，都先在未修改的程式上執行通過（尺寸相關 7 檔 36 項；ID 邊界 2 檔 19 項，執行時以 `git diff --quiet` 確認來源未改）。IPC 80／1600 上下限已由 `ipc-window-controls` 測試固定 |
| 3 | 共用尺寸模組，main 與 renderer 改用 | 通過 | `src/utils/pet-window-size.ts`（由 `pet-window-height.ts` 改名）；尺寸相關 6 個測試檔 29 項全過 |
| 4 | ID 格式納入 `id-patterns.ts`、合併 `clamp` | 通過 | `clamp` 在步驟 3 一併合併至 `src/utils/number.ts`；ID 相關 7 個測試檔 89 項只有基準既有的 1 個失敗；`vue-tsc` 通過 |
| 5 | Code review 與 phase gates | 通過 | 見「驗證證據」「Code review 紀錄」；重新產生 `docs/security/ipc-inventory.md`（只有 `pet-resize` 的對應測試欄改變） |
| 6 | Electron 實機驗證 | 通過 | 見「Electron 實機驗證」；全程螢幕外、未取得焦點 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-02-window-size-3550f0` |

## 設計摘要

- `src/utils/pet-window-size.ts`（由 `pet-window-height.ts` 改名，`git mv`）：常數 `PET_BASE_W`（250）、`PET_BASE_H`（232）、`STATUS_LINE_EXTRA_H`（22）、`QUOTA_TOOLTIP_HEADROOM_H`（190）、`QUOTA_TOOLTIP_MIN_W`（260）、`MULTI_PET_CELL_W`（`PET_CELL_WIDTH + 12` = 204）、`MULTI_PET_ROW_PADDING_W`（16）、`PET_WINDOW_DIMENSION_LIMITS`（`{ min: 80, max: 1_600 } as const`）；函式 `petWindowWidth()`、`petWindowHeight()`、`initialPetWindowSize()`、`clampPetWindowDimension()`。只相對匯入 `pet-atlas.ts` 與 `number.ts`，Node 測試與主行程都能直接載入。
- 主行程：`createPetWindow()` 的冷啟動值改為 `initialPetWindowSize(scale)`，儲存尺寸改為 `clampPetWindowDimension()`；`computePanelBounds()` 的留白後備值與 `pet-drag.ts` 的 `PET_WINDOW_HEADROOM_PX` 都取自 `QUOTA_TOOLTIP_HEADROOM_H`；`pet-resize` IPC 用 `clampPetWindowDimension()`。`PET_SCALE` 的 0.3–5 範圍、`pet-content-height` 的 40–1600 與 work-area 限制維持原處、數值不變。
- renderer：`agentStore` 的 `scaledW` 改為 `petWindowWidth(familyLines.length, isMultiPet, petScale)`，DOM 量測與 `resizePetWindow()` 不變。
- `clamp` 移到 `src/utils/number.ts`；`window-controls` registrar 改為直接匯入，不再從 `main.ts` 注入（純函式不需要依賴注入）。`panel-layout.ts` 的 `clampNumber` 在 `min > max` 時語意不同，刻意保留並在註解說明。
- ID：`OPAQUE_ID_CHARS` 與 `OPAQUE_ID_64/128/256_PATTERN`、`isOpaqueId64/128/256`。兩個 permission 模組以 `import { isOpaqueId128 as isIdentifier }` 保留原呼叫處；history 改用型別守衛後移除兩個 `!` 非空斷言。`agent-hook.mjs` 保留字面值，`tests/id-patterns.test.mts` 比對它與 `OPAQUE_ID_128_PATTERN` 相同，並禁止 `electron/`、`src/` 再出現 `[A-Za-z0-9._:-]{1,` 字面值。

## Electron 實機驗證（Windows 11，隔離 HOME，螢幕外）

以 `scripts/e2e-isolated-electron.mjs --offscreen` 啟動隔離 app：app 看到的顯示器與實際主螢幕同尺寸（1536×816 work area、DPI 125%），但 x 移到 -20000；所有視窗以 `showInactive()` 顯示且不 focus。每次量測都記錄 `focused: false`，視窗 x 都在 -18700 左右，沒有出現在使用者螢幕上。量測腳本放在 session scratchpad，用完即刪除隔離暫存目錄。沒有碰使用者的設定、正式埠或憑證（事件埠 27393）。

| 情境 | 期望（寬×高） | 實際 `getBounds()` | 備註 |
|---|---|---|---|
| 冷啟動、無儲存尺寸（`PET_SCALE` 未設） | 建立參數 260×422 | 建立參數 260×422；載入後 260×423 | 載入後 DOM 第一個繪製元素從 y=196 開始，上方 ≥190px 留給 tooltip；狀態列在 400–423 |
| 單寵 scale 0.5 | 260×306 | 260×307 | 寬度維持 tooltip 最小寬度 |
| 單寵 scale 2 | 500×654 | 500×655 | |
| 單寵 scale 1 | 260×422 | 260×423 | |
| 單寵 scale 1、兩條狀態列（codex + claude 事件） | 260×444 | 260×444 | |
| 多寵 scale 1、兩隻 | 424×422 | 425×423 | DOM 有 `.multi-pet-row` |
| 多寵 scale 0.5、兩隻 | 212×306 | 212×307 | 儲存的 `normalBounds` 精確為 212×306 |
| 還原既有尺寸（`--reuse-root`） | 建立參數 = 儲存的 212×306 | 建立參數 212×306；載入後改為 260×307（單寵 0.5） | |
| 舊格式儲存（只有 `width:50,height:20`，無 `normalBounds`） | — | 建立參數 50×20；載入後 260×307 | 見殘餘風險 2：1.12.5 既有行為，本階段未改 |

DPI 125% 下 `getBounds()` 的寬或高會比要求值多 1px，是 Electron 的 DIP 取整；`normalBounds`（app 自己記錄的要求值）都與公式完全相同。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1307 項：1273 過、11 失敗、23 skip（基準 1297 項：1265 過、9 失敗）。與基準清單比對：9 個基準失敗都還在（8 個已知 + 偶發的「with the pet closed…」）；多出的「a starting app that never opens its port holds the hook for a bounded time only」（`agent-hook-delivery`）與「the worst-case draft … validates within a timing ceiling」（`panel-theme-diagnostics`）都是計時測試，單獨重跑兩次都通過，測試的檔案本階段沒有修改，判定為整批執行時的負載偶發。中途一次執行曾出現 `ipc-inventory` 失敗，原因是清單需要重新產生，已重新產生並通過 |
| 本階段新增與相關測試 | `pet-window-size`、`number`、`id-patterns`、`progression-events`、`history-sessions`、`pet-style-tokens`、`ipc-window-controls`、`pet-drag`、`pet-window-mode`、`ipc-pet-motion`、`claude-permission-hook`、`ipc-inventory` 全過（`claude-permission-hook` 的「a file edit is medium…」是基準既有失敗） |
| `pnpm.cmd run check:design:strict` | 通過（rawColors 0、unused 0、rawControls 0） |
| `git diff --check` | 通過 |
| `pnpm.cmd audit --prod` | No known vulnerabilities found |
| diff 機密掃描 | 無命中（只有 `tokens.css` 檔名） |

## 安全審查

- **IPC**：沒有新增或移除 channel。`pet-resize` 的 sender 檢查、`finiteNumber` 驗證與 80–1600 上下限都不變，只是上下限改由共用常數提供；`ipc-inventory` 重新產生後只有對應測試欄改變。
- **識別碼**：三個長度上限與字元集逐一以正反例測試固定（上限、上限 +1、空字串、空白、斜線、換行、非 ASCII、非字串）。唯一的行為差異：`history.ts` 原本用 `SAFE_ID.test(value ?? '')`，非字串的值會被 RegExp 轉成字串再比對；現在型別守衛直接拒絕非字串。上游 `event-normalizer` 的 `optionalText()` 與 adapter registry 已保證是字串，所以實際上不會發生；就算發生也只是改用 digest 產生的 eventId 或 `generic-http`，屬於收緊而非放寬。
- **hook**：`agent-hook.mjs` 只加註解；字面值由測試與共用常數比對。
- **e2e 啟動器**：`--offscreen` 只在測試啟動器內攔截 `require('electron')`；攔截失敗或顯示器仍在螢幕內時立即中止，不會在使用者螢幕上開窗。原有的隔離檢查（HOME、userData、fake safeStorage、agent 環境變數）不變；新增轉傳的 `PET_SCALE` 只是一個數字倍率。
- 沒有新增檔案系統、網路、憑證或權限相關程式。

## Code review 紀錄

- 新語法：`as const`（`PET_WINDOW_DIMENSION_LIMITS`）、`value is string` 型別守衛取代 `typeof … && regex.test()`，並因此移除 `event.adapterId!`、`event.eventId!` 兩個非空斷言；啟動器用 `Object.hasOwn`、`??=`。
- 效能：`OPAQUE_ID_*` 在模組載入時各建立一次 RegExp；尺寸函式是純計算，`scaledW`／`scaledH` 仍是 `computed`。熱路徑沒有新增 I/O。
- 風格：renderer 用 `@/` 匯入；被 Node 測試載入的 `pet-window-size.ts`、`number.ts`、`progression-events.ts` 只用相對路徑值匯入。新註解為繁體中文、只寫原因；英文的既有「為什麼」註解原樣搬移。沒有使用者可見文字變更，不涉及 i18n。
- 自行修正：發現 `ipc-window-controls` 測試注入的是 `clampNumber` 語意的假 `clamp`，移除注入後改用真正的共用 `clamp`；啟動器第一次用 `defineProperty` 換 `BrowserWindow` 失敗（不可重新定義，app 在開窗前就中止），改為攔截 `Module._load`，並補上 `getAllWindows()`。

## 殘餘風險

1. **macOS／Linux 未實測**：只在 Windows 11（DPI 125%、單螢幕）驗證；多螢幕與其他 DPI 沒有實機測試。尺寸公式與 1.12.5 逐值相同，風險低。
2. **既有行為（未修改）**：`createPetWindow()` 遇到沒有 `normalBounds` 的舊格式 `window-state.json` 時，`savedNormal` 直接使用未夾值的 `saved.width／height`，所以 80–1600 上下限在這條路徑實際沒有作用（實測 50×20 原樣建立，store 載入後立即改為正確尺寸）。app 自己寫的狀態一律帶 `normalBounds`，只有很舊的檔案或手改的檔案會走到這裡。為遵守「不改變各入口行為」，本階段不修，建議另案處理。
3. 本機 8 個既有失敗測試（Windows symlink 權限、hook 停滯計時等）與偶發的「with the pet closed…」不在本階段處理；整批執行時另有兩個計時測試偶發失敗（見驗證證據）。

## 版本建議

本階段單獨看屬於 **patch**：純內部重構，沒有改變任何數值、持久化格式、IPC 或公開契約。依整體排程，全部重構階段完成後統一升 **minor**，本階段不改版號。

## 檔案變更狀態

| 路徑 | 類型 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-02-pet-window-size.md` | 新增 | 本階段記錄 |
| `src/utils/pet-window-size.ts` | 新增（由 `pet-window-height.ts` 改名） | 寵物視窗尺寸唯一來源：寬、高、tooltip 留白與最小寬度、多寵格寬、冷啟動尺寸、80–1600 上下限 |
| `src/utils/pet-window-height.ts` | 刪除（改名） | 併入上一列 |
| `src/utils/number.ts` | 新增 | 共用 `clamp` |
| `src/types/id-patterns.ts` | 修改 | `OPAQUE_ID_CHARS`、`OPAQUE_ID_64/128/256_PATTERN`、`isOpaqueId64/128/256` |
| `src/stores/agentStore.ts` | 修改 | 寬度改用 `petWindowWidth()`；移除 `PET_BASE_W`、`QUOTA_TOOLTIP_MIN_W`、`MULTI_PET_CELL_W` |
| `src/utils/progression-events.ts` | 修改 | 寵物 id 改用 `isOpaqueId128` |
| `src/styles/tokens.css` | 修改 | 註解改指向共用模組（值不變） |
| `electron/main/runtime.ts` | 修改 | 冷啟動尺寸用 `initialPetWindowSize()`、儲存尺寸用 `clampPetWindowDimension()`；面板定位留白用 `QUOTA_TOOLTIP_HEADROOM_H`；移除 `PET_WINDOW_TOP_HEADROOM` 與本地 `clamp` |
| `electron/main.ts` | 修改 | 不再把 `clamp` 注入 window-controls |
| `electron/ipc/window-controls.ts` | 修改 | `pet-resize` 用 `clampPetWindowDimension()`；直接匯入 `clamp`，移除注入的依賴 |
| `electron/pet-drag.ts`、`electron/pet-window-mode.ts` | 修改 | 留白取自共用模組；移除本地 `clamp` |
| `electron/history.ts`、`electron/history-sessions.ts`、`electron/permission-broker.ts`、`electron/permission-adapter-server.ts` | 修改 | 改用 `isOpaqueId256`／`isOpaqueId64`／`isOpaqueId128`；移除 `!` 斷言 |
| `integrations/agent-hook.mjs` | 修改 | 只加註解，字面值不變（由測試比對） |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 記錄尺寸契約、`number.ts` 與不透明 ID 規則 |
| `tests/pet-window-size.test.mts` | 新增 | 以 1.12.5 公式逐值比對寬高與冷啟動尺寸、上下限、main／renderer 不再寫死數字 |
| `tests/pet-window-height.test.mts` | 刪除 | 內容併入上一列 |
| `tests/number.test.mts` | 新增 | `clamp` 行為（含 `min > max`）與只剩一份 |
| `tests/id-patterns.test.mts` | 修改 | 三種長度的正反例、禁止複製字面值、hook 字面值對齊 |
| `tests/progression-events.test.mts`、`tests/history-sessions.test.mts` | 修改 | 128／64 邊界 |
| `tests/claude-permission-hook.test.mts` | 修改 | 改用 `OPAQUE_ID_128_PATTERN` |
| `tests/pet-style-tokens.test.mts`、`tests/ipc-window-controls.test.mts` | 修改 | 跟著新模組與移除的注入依賴調整 |
| `docs/security/ipc-inventory.md` | 修改（重新產生） | `pet-resize` 的對應測試欄改為 `tests/pet-window-size.test.mts`；sender 與驗證欄不變 |
| `scripts/e2e-isolated-electron.mjs` | 修改 | 新增 `--offscreen`（顯示器移到螢幕外、`showInactive`、不 focus、記錄建立參數），轉傳 `PET_SCALE` |
