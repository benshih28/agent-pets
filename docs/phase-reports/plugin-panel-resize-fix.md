# 插件面板縮放後消失修正

日期：2026-10-28
分支：`fix/plugin-host-resize-memory`（基準 `main` 871af28）
Agent Pets 版本：`1.3.1` → `1.3.2`

## 問題

開啟插件面板（例如 Update Radar）後，把面板視窗縮小（包含縮回原先尺寸）時，插件內容會被 Host 銷毀，面板回到開啟前尺寸。

## 根因

Renderer 以 `ResizeObserver` 回報插件內容區的絕對座標，Main 收到後拿「當下」視窗尺寸驗證。縮小視窗時 Main 端視窗已先變小，renderer 回報的仍是縮小前的大尺寸，`validatePluginPanelViewBounds` 判定越界，`plugin-panel-ui.ts` 隨即 `close('renderer_unavailable')`。放大時舊尺寸必然較小，所以只有縮小會觸發。

## 修正（僅 Host，插件不需修改）

改為業界常見的「Host 負責排版、renderer 只提供邊距」：

- Renderer 回報座標時一併附上量測當下的 viewport（`window.innerWidth/innerHeight`）。
- Main 以 renderer 自己的 viewport 驗證外框與內容區，換算成四邊邊距（`pluginPanelViewInsets`）。
- 實際 bounds 一律由 Main 以目前視窗 content 尺寸減去邊距計算（`layoutPluginPanelView`），並在面板視窗 `resize` 事件時重新排版（`PluginPanelViewController.relayout`）。
- 暫時算不出合法尺寸時只隱藏子 view、保留插件狀態；不合法的回報被忽略而非關閉插件。

| 檔案 | 變更 |
| --- | --- |
| `electron/plugin-panel-window.ts` | 新增 `PluginPanelInsets`、`pluginPanelViewInsets`、`layoutPluginPanelView` |
| `electron/plugin-panel-view.ts` | 新增 `setLayout`、`relayout`，控制器記住邊距 |
| `electron/ipc/plugin-panel-ui.ts` | 以 renderer viewport 驗證並改呼叫 `setLayout`；viewport 限 1–16,384 |
| `electron/main/runtime.ts` | 面板視窗 `resize` 時呼叫 `relayout` |
| `electron/preload.ts`、`src/types/electron-api.ts`、`src/composables/usePluginPanelController.ts` | `setPluginPanelViewBounds` 多傳 viewport |

## 驗證證據

| 指令／流程 | 結果 |
| --- | --- |
| `pnpm test:unit` | 通過（新增邊距換算、控制器重新排版、IPC 縮放中舊座標不關閉三組測試；本分支數字見 PR 說明） |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `git diff --check` | 通過 |
| 隔離 Electron（`scripts/e2e-isolated-electron.mjs` + `ok-panel` fixture） | 修正版：放大 → 縮回原尺寸 → 縮至 340×300 → 還原，子 view 全程存在且 bounds 隨視窗更新、未超出視窗；修正前版本（HEAD worktree）在縮小到 340×300 時子 view 被銷毀且無法恢復 |

## 安全檢查

- 信任邊界不變：仍只接受受信任面板 renderer 的 IPC（sender guard），未新增 IPC channel、preload 能力或權限。
- 子 view bounds 由 Main 以目前視窗尺寸與非負邊距計算，結構上不會超出視窗；`validatePluginPanelViewBounds` 仍確保內容區位於外框內且低於 48px 宿主標題列，關閉按鈕與插件標示不會被覆蓋（符合 `docs/security/plugin-panel-view-threat-model.md` 第 8 點與點擊劫持項）。
- 忽略不合法回報不會讓插件延長存活：從未收到合法 bounds 仍由 2 秒 ack timeout 關閉；面板隱藏仍立即關閉。
- `.claude/` 未修改。

## 殘餘風險

- 「插件開著不操作也會自己消失」若為失焦自動隱藏（點到其他 App），屬既有設計，本次未變更。
- 自動化以 `setContentSize` 分段模擬拖拉；實際滑鼠拖拉與 Windows／多螢幕 DPI 未實測。
- 極小視窗時內容區可能只剩數像素高（例如 340×300 時約 4px），屬可用性議題，可另議是否提高插件面板最小尺寸。

## 版本建議

Patch（`1.3.1` → `1.3.2`）：Host 內部排版修正，未改變公開插件合約或安全邊界。
