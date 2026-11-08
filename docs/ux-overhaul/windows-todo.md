# Windows 待驗證與待辦

UX 翻修（PR #25）和之後的 PR 5（跨平台實測與打包）中，需要 Windows 實機才能確認的項目。macOS 的部分會在 PR 5 先處理，這份清單只放 Windows 專屬的項目。

## 需要實機驗證（程式已修，未在 Windows 執行過）

- [ ] **UI-09 重新啟動**：可攜版 `AgentPets-<version>.exe` 從「設定 → 進階 → 重新啟動」、系統匣的重新載入寵物，以及啟動失敗對話框的「重試」都能成功重新開啟，且只會有一個實例。
- [ ] **UI-09 開機啟動**：勾選後登出再登入會自動啟動；開關顯示的狀態與實際一致。
- [ ] **PET-06 點擊穿透**：寵物透明區域可以點到後面的視窗，寵物本體、氣泡、權限卡仍可點擊。
- [ ] **PET-07 拖曳與多螢幕／DPI**：在 100%、125%、150% 縮放與雙螢幕之間拖曳寵物，位置不跑掉、不會被拖出畫面。
- [ ] **UI-08 面板縮放**：面板邊緣顯示一般的縮放游標，可以拉到接近全螢幕，換螢幕後仍在可視範圍內。
- [ ] **ON-09 hook 指令**：使用者名稱含空白或非英文字元時，Codex／Claude Code／OpenCode 的 hook 能正常送出事件。
- [ ] **SEC-04 L-1 Node 解析**：`where.exe` 從 System32 執行，找不到 Node 時顯示在地化錯誤，不會寫入裸 `node`。
- [ ] **PM-05 權限快捷鍵**：`Ctrl+Shift+Y` / `Ctrl+Shift+N` 只對非高風險請求生效；快捷鍵被其他程式佔用時有提示。
- [ ] **Claude Code 權限回覆**：開啟「從寵物回覆 Claude Code 權限」後，`node.exe` 直接執行的 `PermissionRequest` hook 能把允許／拒絕寫回 Claude Code；`%USERPROFILE%\.desktop-pet\claude-permission-respond` 的建立與移除正常；舊安裝啟動後補上 `PermissionRequest`（`timeout` 135）與 `PostToolUseFailure` 條目並留下備份。
- [ ] **PM-10 系統匣**：注意力標記、勿擾與「（需核准）」等狀態在 Windows 系統匣上正確顯示。
- [ ] **設計**：深色與淺色主題、寵物淺色氣泡、`⋮` 選單在 Windows 字型（微軟正黑體／Segoe UI）下沒有跑版或文字截斷。

## 待實作（Windows 專屬）

- [ ] **PM-13 全螢幕偵測**：目前只看前景視窗，補上多螢幕與無邊框全螢幕遊戲／影片的判斷，並在偵測失敗時顯示原因。
- [ ] **PM-10 系統匣圖示**：Windows 數字徽章與高 DPI 圖示素材。
- [ ] **簽章**：Windows 程式碼簽章，消除 SmartScreen 警告。
- [ ] **回到工作階段：切換到 App**：macOS 以 `open -b`（LaunchServices）把終端機／IDE 帶到最前面；Windows 目前隱藏這個動作。需要找出不需額外權限、不會被前景鎖定（`SetForegroundWindow` 限制）擋下的方式，並驗證 Windows Terminal（`WT_SESSION`）與 VS Code 的辨識。「顯示專案資料夾」（`shell.showItemInFolder`；拒絕 UNC 與 `name.{CLSID}` 路徑）與「複製專案路徑」也需在 Windows 實機確認。
- [ ] **CI**：在 Windows runner 跑 Electron 冒煙測試（目前 `ci-platforms.yml` 每週只跑型別檢查與單元測試）。

驗證完成後，請把對應項目打勾，並更新該問題的工作記錄狀態。
