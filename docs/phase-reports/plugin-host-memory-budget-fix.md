# Plugin Host 記憶體預算誤判修正

日期：2026-10-28
分支：`fix/plugin-host-resize-memory`（基準 `main` 871af28）
Agent Pets 版本：`1.3.1` → `1.3.2`

## 問題

啟用插件後不久，插件開關自動關閉，通知中心出現「插件執行環境無法啟動」。

## 根因

`PluginHostWindow.checkMemory()` 每 30 秒以整個 Plugin Host renderer 程序的 working set 對照預算，預算原為 `memoryMbPerPlugin × 啟用插件數`（預設 64 MB × 1）。Plugin Host 是獨立 Chromium renderer，空載就約 80–90 MB，因此單一插件時必定超標，被當成 host 崩潰；連續 3 次後標記 `disabled_crashed` 並關閉開關。與插件實作無關，任何插件都會發生。

## 修正

- `electron/plugin-preferences.ts` 新增 `PLUGIN_HOST_BASE_MEMORY_MB = 192` 與 `pluginHostMemoryBudgetMb()`：預算改為「192 MB 基本額度 + 每插件預算 × 啟用數」。
- `electron/main/runtime.ts` 的 `getMemoryBudgetMb` 改用此函式。每插件預算為 0 或無啟用插件時仍回傳 0（維持原本跳過檢查的行為）。
- 未變更 `memoryMbPerPlugin` 的儲存格式、範圍或預設值。

## 驗證證據

| 指令／流程 | 結果 |
| --- | --- |
| `pnpm test:unit` | 通過（新增預算計算測試；本分支數字見 PR 說明） |
| `pnpm exec vue-tsc --noEmit`、`pnpm exec vite build` | 通過 |
| `git diff --check` | 通過 |
| 隔離 Electron，修正前，`ok-panel` | host 空載 78–87 MB，超過 64 MB；約 30 秒被重啟，啟用後約 45 秒～2 分鐘變成 `disabled_crashed` |
| 隔離 Electron，修正後，以真實連網插件（Update Radar 開發版，含首次同步） | 約 5 分 30 秒內 host 重啟 0 次，峰值 100 MB（預算 256 MB），插件維持啟用 |

## 安全檢查

- 記憶體監控仍在運作，只是門檻加入 host 本身的基本開銷；失控插件超過「192 MB + 預算」時仍會被終止並在連續 3 次後停用。
- 未新增 IPC、preload 能力、權限或設定欄位；使用者可調整的範圍（16–512 MB／插件）不變。
- `.claude/` 未修改。

## 殘餘風險與待辦

- 已更新 `docs/plugins/limits.md` 與 `limits.zh-TW.md`，說明 192 MB host 基本額度。
- 基本額度依 macOS 實測決定；Windows／Linux 的 Chromium 基本開銷未實測，若明顯較高需再調整。
- 先前因此被停用的插件不會自動恢復，使用者需手動重新開啟開關。

## 版本建議

與 `plugin-panel-resize-fix.md` 合併為一次 Patch（`1.3.1` → `1.3.2`）。
