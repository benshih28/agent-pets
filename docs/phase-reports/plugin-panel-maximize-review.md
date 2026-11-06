# 插件面板放大 PR #23 複檢

日期：2026-11-06。原 PR head：`be420f89bb4d5d58e3bfeeeea16516850e5a1d5b`。

## 問題與修正

原版在 Windows 隔離 Electron 可重現：460×720 開啟插件 → 放大至 960×800 → 從寵物端 `openPluginPanelFromPet` 再次開啟。放大標記清除，但視窗仍為 960×800；關閉再一般開啟也沿用該尺寸。

`panelResize` 原本直接呼叫 `BrowserWindow.setBounds`，其 resize 事件會把放大尺寸記成手動尺寸。改為注入既有 `setPluginPanelWindowBounds`，讓程式化調整使用主程序既有的排除記錄機制。沒有新增 IPC、插件 API 或權限。

125% DPI 下，原生尺寸換算可能相差 1 DIP。程式化尺寸比對容許這個誤差，避免重新開啟時誤寫手動尺寸並逐次累積；超過 1 DIP 的調整仍視為手動操作。

## 驗證

- `vue-tsc --noEmit`、`vite build`、`check:bundle`、`git diff --check` 通過。
- 最終完整單元測試以 `--test-concurrency=2` 執行：479 個案例，471 通過、8 個平台條件跳過、0 失敗。原始預設併行曾有無關的 presentation stdio 逾時，單獨重跑及限制併行的完整測試均通過。
- `pnpm build` 完成 Windows portable 打包；其後新增的 DPI 容差修正另經型別、Vite 建置與最終完整測試驗證。
- 真實 Windows Electron，原生顯示縮放 125%，使用既有隔離啟動器與 Update Radar 0.3.0。原版已驗證滑鼠放大／還原、host Esc、焦點保留及關閉重開；修正版驗證通知／寵物正式 IPC 重開與一般重開均回到 460×720。
- 手動設為 640×540，再連續三次放大及透過寵物重新開啟，原生尺寸穩定為 640×541；首次 1 DIP 換算差異沒有繼續累積。修正前同樣流程會由 541 增至 542。
- 隔離驗收的 safeStorage 三項呼叫計數始終為 0；使用者資料未參與驗收。

## 安全複檢

- 主程序仍驗證面板 IPC sender、有限數值及尺寸上下限。插件頁仍由主程序限制在宿主標題列下方，未修改 48px 標題列防護。
- 未變更依賴。`pnpm audit --prod --json`：0 漏洞。完整 audit 的既有開發／打包依賴警示為 low 10、moderate 31、high 47、critical 0，未在本次擴大處理。
- 原始碼高可信度憑證樣式掃描無命中，排除依賴、產物、本機設定與 `.claude/`；此為樣式掃描，非完整秘密鑑識。
- `.claude/`、使用者設定及正式資料未修改。

## 範圍與版本

本機實機範圍為 Windows 125%；100%／150% 原生 DPI、多螢幕及 macOS 未在本次重驗。插件獨立驗收涵蓋 278／423／940 CSS px 的淺深色頁籤版面，未見水平溢出，不能取代原生 DPI 驗收。

建議 patch：1.4.4 → 1.4.5。使用者已明確授權修正後合併、升 patch 並打 tag；依既有 Release workflow 在升版進入 main 後建置並建立 tag／Release。
