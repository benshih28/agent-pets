# Lint 導入：規則集與留給各線的存量

引入 ESLint 9（flat config，`eslint.config.mjs`）。`pnpm lint` 依序執行 `eslint .` 與 `node scripts/lint-main-process.mjs`（只保留 crash guard 契約檢查）。導入時 0 error、52 warning；1.14.1 型別與風格清理後為 0 error、0 warning。

## 規則集

- 基底：`@eslint/js` recommended、`typescript-eslint` recommended（非 type-aware）、`eslint-plugin-vue` `flat/essential`。不含 stylistic 規則，也不引入 Prettier。
- `src/**`：`no-restricted-imports` 禁止 `./`、`../` 開頭的 import（`../../electron/*` 除外，沒有別名可用），一律 `@/`。
- Node 測試閉包：`tests/*.test.mts` 以 Node 直接執行、沒有 bundler。`scripts/node-test-closure.mjs` 在 lint 時從測試檔出發計算執行期（非 `import type`）會載入的 src 檔案，這些檔案反過來用 `@typescript-eslint/no-restricted-imports`（`allowTypeImports`）禁止 `@/` 的值 import，`import type` 不受限。不用維護清單。測試若載入 `tests/support/src-alias.mts`（已註冊 `@/` resolver），該測試的閉包不受限制，所以 `agentStore`、`useRelativeTime`、`panel-deps` 等可以使用 `@/`。
- `electron/**`：type-aware 的 `@typescript-eslint/no-floating-promises`，取代舊的 `loadURL` 字串比對。只對 `electron/**` 開，避免 renderer 與測試也跑型別資訊。
- 關閉：`no-control-regex`（清除終端機跳脫序列與拒絕控制字元的輸入驗證本來就要比對控制字元，共 39 處）、`vue/multi-word-component-names`（`components/ui/*` 的單字元件名是刻意命名）、`vue/require-toggle-inside-transition`（`DesktopPet.vue` 的 `<Transition v-else-if>` 以 key 切換子節點）。
- `@typescript-eslint/no-explicit-any` 為 error（導入時先以 warning 記錄存量，1.14.1 清零後升級）。只有 `src/env.d.ts` 的 `*.vue` 模組宣告豁免。
- 全域 `ignores` 含 `.claude/**`（子 session 的 worktree 放在 `.claude/worktrees/`，不忽略的話主 checkout 的 `eslint .` 會連 worktree 一起掃）與 `.playwright-mcp/**`（工具產生的暫存檔）。

## 耗時

冷快取 `eslint .` 約 70 秒 CPU（量測時機器同時跑其他工作，wall time 受干擾）；type-aware 的 `no-floating-promises` 規則本身約 4 秒，主要成本在 Vue SFC 的 scope 分析與 typescript-eslint 載入。有 `--cache`（`node_modules/.cache/eslint/`）時只重跑變動的檔案。

## 本輪順手修掉的存量（最小修正）

- 未使用的 import／變數／常數（`electron/ipc/pets.ts`、`electron/main.ts`、`electron/plugin-panel-themes.ts`、`electron/plugin-panel-window.ts`、`electron/preload.ts`、`electron/setup.ts`、`src/types/electron-api.ts`、`src/stores/agentStore.ts`、`src/components/DesktopPet.vue`、`scripts/generate-ipc-inventory.mjs`）。`electron/plugin-panel-themes.ts` 的 `gradientBackdrops()` 是沒有呼叫者的舊實作，已由 `backdropChecks` 取代，直接刪除。
- `electron/session-jump.ts` 不再需要的 `eslint-disable no-control-regex`；`electron/safe-config-write.ts` 的 BOM 字元改用 `﻿` 逸出（行為相同，避免原始碼含不可見字元）。
- 空白字元的 regex 改寫成 ` {2}` 形式（`scripts/generate-ipc-inventory.mjs`、三個 `tests/*.test.mts`）；`let` 改 `const`（`electron/plugin-net.ts`、兩個測試）。
- `src/**` 的 `./`、`../` import 轉成 `@/`（`src/composables/plugin/context.ts`、`src/types/electron-api.ts`、`src/types/pet.ts` 等）；`src/types/plugin.ts` 的型別斷言別名加底線前綴；`src/types/presentation.ts` 的空 interface 改成 type alias。

## `no-explicit-any` 存量（已清零）

導入時留給各線的 52 處，已在 1.14.1 型別與風格清理（`docs/phase-reports/phase-1-14-1-type-style-cleanup.md`）全部清掉：renderer 線在 A，主程序線（`quota.ts`）在 B，hook 線（`setup.ts`）在 C，測試在 F。規則已升成 error。以下保留導入時的清單作為紀錄：

- renderer 線：`src/App.vue`：329、332；`src/types/electron-api.ts`：61
- 主程序線：`electron/quota.ts`：120、122、214、227、255、261、284、347、485、712（共 10 處，集中在 quota 回應解析，建議改成 `unknown` 加 type guard）
- hook 線：`electron/setup.ts`：769、875、880
- 測試：`tests/agent-state-registry.test.mts`：63、68、91；`tests/diagnostics-logger.test.mts`：20；`tests/ipc-reliability.test.mts`：7、8、9、13；`tests/notification-policy.test.mts`：23–81（14 處）；`tests/panel-theme-user-ipc.test.mts`：91；`tests/panel-theme-user.test.mts`：39、60、72；`tests/presentation-mcp.test.mts`：37；`tests/presentation-stdio.test.mts`：64、77；`tests/progression-broadcast-gate.test.mts`：6、18；`tests/sound-registry.test.mts`：57

行號是導入時的位置。

## 對 `agent-pets-conventions` skill 的建議（未追蹤目錄，本輪未修改）

- §1「重要例外」：現在有 `tests/support/src-alias.mts`，載入它的測試（`agentStore`、plugin panel 等）可以使用 `@/`；只有「不載入它的測試所執行的檔案」才需要相對路徑。清單改由 `scripts/node-test-closure.mjs` 與 ESLint 自動執行，不必手動維護，並可刪除「目前專案沒有做這件事」那句。
- 新增一節說明 `pnpm lint`：ESLint 規則集、`@/` 規則與閉包機制、`no-explicit-any` 為 error。
- §1 提到「`electron/` 不會走 `@/`」：`src/**` 若要 import `electron/*`，保持相對路徑（規則已豁免）。
