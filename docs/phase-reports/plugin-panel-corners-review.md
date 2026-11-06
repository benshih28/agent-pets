# 插件面板圓角 PR #24／插件目錄 PR #14 複檢

日期：2026-11-06。

審查基準：Agent Pets `e2281b6ce74105f815c136af483828af55885f87`；插件目錄 `952dd8a9369b2a14bd5960f2c98b59a219c6bedc`。

## 範圍與修正

- PR #24 讓原生 `WebContentsView` 底色透明；插件以自己的 CSS 繪製底部圓角。宿主的內容底色仍是不透明的，不會把插件內容背景直接透到桌面。
- Update Radar 0.3.1 的 `dist/core.js`、`dist/main.js`、`ui/index.html`、`ui/panel.js` 與 0.3.0 完全相同；差異只有 CSS、manifest 版本與簽章。
- 隔離驗收碰到載入取消後的清理例外：Electron 已清掉被銷毀 view 的 `webContents`，但 `open()` 的 catch 區塊仍呼叫 `isDestroyed()`。補上可選取值與清理例外保護，維持既有 token 撤銷及 `disabled` 回傳。
- 新增回歸測試先在原版重現相同 TypeError，再確認修正後通過；沒有新增 IPC、插件 API、權限或依賴。

## 驗證證據

- 修正後完整單元測試：481 個案例，473 通過、8 個 Windows 平台條件跳過、0 失敗（`--test-concurrency=2`）。
- 型別檢查、Vite 正式建置、插件共用 tokens bundle 檢查與 `git diff --check` 通過。
- 本機 Windows 打包完成。原 `build:fast` 卡在既有 `AgentPets-1.4.5.exe` 被鎖定；只停止本次已核對的 builder，改用 `AgentPets-pr24-review.exe` 獨立檔名成功完成，未刪除舊檔。
- Windows Electron 43.3.0、原生 125% 顯示縮放，使用既有隔離啟動器、暫存 HOME/userData 及假 safeStorage。
- 一般／放大 × 淺色／深色／forced-colors × 頂端／中段／底部，共 18 組原生視圖截圖取樣：左右底角 alpha 均為 0，底部中央 alpha 均為 255。另目視檢查一般淺色、放大深色截圖。
- 完全不畫背景的最小插件：原生內容中央 alpha 為 0，文字可載入，宿主內容底色為 `rgb(18, 18, 18)`。宿主 frame 上緣約 193.1 DIP，插件內容約 245.9 DIP，仍保留至少 48 DIP 標題列。
- Update Radar 0.3.0 → 0.3.1 的實際安裝計畫為 `update`，新增權限 0、不需重新同意；簽章有效、金鑰指紋維持 `ffb643e57400dee3`。
- 用僅含已追蹤檔案的乾淨封存副本執行 catalog validator：0 錯誤、0 警告。套件大小 57,596 bytes，SHA-256 為 `18ff0ee5517ba0ddf332746e29e806896da0ef1089f8782cdfed945afae1c289`。

## 安全與限制

- 原生實測仍為 sandbox/contextIsolation/webSecurity 開啟，Node integration 與 webviewTag 關閉。沒有更動宿主標題列、sender guard、資源 URL 範圍或插件權限。
- safeStorage 三項呼叫計數始終為 0；沒有使用真實使用者資料、帳號憑證或 `.claude/`。
- 正式執行依賴 audit 為 0 漏洞。完整 audit 仍有既有開發／打包工具警示：low 10、moderate 31、high 47、critical 0；本次沒有更動依賴。
- 排除依賴、生成物及本機設定後的高可信度憑證樣式掃描無命中；這不等於完整秘密鑑識。
- macOS、Linux、Windows 100%／150% 原生 DPI 與多螢幕未在本次實機重驗。

## 交付

依同一聊天既有的 patch／tag 授權升為 1.4.6。升版後驗證 frozen lockfile、型別、Vite 建置與 bundle；鎖檔不儲存根套件版本，預期不需內容差異。原 PR 的新 head CI 通過後合併，待既有跨平台 Release workflow 發布 1.4.6，再合併插件目錄 PR #14。
