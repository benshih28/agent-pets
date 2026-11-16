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
- [ ] **應用程式更新檢查**：設定 → 進階的「立即檢查」能連到 `api.github.com`（公司 Proxy／防火牆下失敗時只顯示「檢查失敗」）；「查看版本」用預設瀏覽器開啟 GitHub release 頁；自動檢查發現新版時的通知在 Windows 通知中心顯示一次。
- [ ] **資料庫整理與成長重設**：可攜版與安裝版的 `%APPDATA%\Agent Pets\` 下三個資料庫 VACUUM 成功、顯示的前後大小正確；防毒即時掃描鎖住 `-wal` 檔時回「失敗」而不是卡住；重設成長資料後寵物視窗與面板同時歸零。
- [ ] **設定頁「切換到 App」開關**：在 Windows 顯示並可關閉；關閉後工作階段列與通知點擊都不再切換。

## 待實作（Windows 專屬）

- [ ] **PM-13 全螢幕偵測**：目前只看前景視窗，補上多螢幕與無邊框全螢幕遊戲／影片的判斷，並在偵測失敗時顯示原因。
- [ ] **PM-10 系統匣圖示**：Windows 數字徽章與高 DPI 圖示素材。
- [ ] **簽章**（已實作、待實機驗證）：`release.yml` 在設定 `WINDOWS_CERTIFICATE_P12`／`WINDOWS_CERTIFICATE_PASSWORD` 後，以 Authenticode 簽可攜版與安裝版兩個 `.exe`，並用 `Get-AuthenticodeSignature` 確認為 Valid（見 [release-signing.md](../dev/release-signing.md)）。待設定憑證後確認 SmartScreen 警告消失；EV／雲端簽章尚不支援。
- [ ] **NSIS 安裝版**（已實作、待實機驗證）：`AgentPets-Setup-<version>.exe`（per-user、不需系統管理員）。待確認安裝、捷徑、解除安裝保留資料、開機啟動指向安裝目錄的 `.exe`、重新啟動與單一實例、hook 部署的 `resources/integrations` 與 `node.exe` 解析。
- [ ] **回到工作階段：切換到 App**（已實作、待實機驗證）：`electron/windows-window-activator.ts` 以 koffi（延遲載入、僅 win32）依 Z 順序掃描最上層視窗，只接受 `src/types/host-app.ts` 的 `windowsExecutables` 白名單（小寫 basename 完全相等；目錄不比對，因為效果只是把使用者自己的視窗帶到前景），略過不可見、被 DWM 遮蔽（其他虛擬桌面）、工具視窗與有擁有者的對話框；最小化先 `SW_RESTORE`，再 `SetForegroundWindow`；若前景鎖定擋下，單次 `AttachThreadInput` 備援後立刻解除。hook 只送 app 類別（`WT_SESSION`、`TERM_PROGRAM=vscode` 等），不送 PID、路徑或執行檔名。白名單：Windows Terminal、VS Code／Insiders、Cursor、Windsurf、Zed、WezTerm、Hyper、Tabby；JetBrains、Claude Desktop 因 hook 無法辨識或執行檔名無把握而暫不支援（`switchable` 為 false，動作維持隱藏）。沿用 `sessionJumpEnabled`／`sessionJumpSwitchAppEnabled` 與每動作頻率限制。待 Windows 實機確認：
  - [ ] Windows Terminal：在 WT 分頁跑 agent，點寵物／通知後 WT 視窗到最前面（執行檔 `WindowsTerminal.exe`；Windows 11 預設終端機與傳統 conhost 視窗是否另有執行檔）。
  - [ ] VS Code（含 Insiders）、Cursor、Windsurf：整合終端機內跑 agent 時辨識為對應 App 並切換（`TERM_PROGRAM=vscode` 加 `CURSOR_TRACE_ID` 判 Cursor；Windsurf 是否能被 hook 辨識）。
  - [ ] 最小化的視窗會先還原再到前景；被其他虛擬桌面遮蔽的視窗行為（會略過，找不到時回「無法使用」）。
  - [ ] 前景鎖定：從寵物點擊與通知點擊都能成功；刻意讓別的程式持有前景權時，備援是否生效，失敗時 UI 顯示「失敗」而非卡住。
  - [ ] 同一程序有多個視窗時挑 Z 順序最上面（最近使用）的那個；無法指定特定視窗或分頁。
  - [ ] 以系統管理員（高 IL）執行的終端機：能否讀到映像路徑、能否被激活；無法激活時應回「失敗／無法使用」，不崩潰。
  - [ ] koffi 載入失敗（例如缺 DLL 或被防毒阻擋）時回退為「失敗」，其他功能不受影響，下次點擊會重試載入。
  - [ ] 安裝版與可攜版的 `app.asar.unpacked` 內有 `@koromix/koffi-win32-x64` 的 `koffi.node`，且 BOOL 改宣告為 `int` 後，`IsWindowVisible`／`SetForegroundWindow`／`AttachThreadInput` 的回傳判斷正確（全螢幕偵測同樣改了宣告，也要一併確認仍能偵測）。
  - [ ] 偏好設定關閉「切換到 App」後動作隱藏、頻率限制（10 秒 5 次）生效。
  - [ ] 「顯示專案資料夾」：`shell.showItemInFolder` 在檔案總管選取資料夾；UNC、`\\?\`、`C:foo`、`a:stream`、任一層 `name.{CLSID}` 都被拒絕。
  - [ ] 「複製專案路徑」：含空白的路徑可複製；含 `% ^ & [ ]`、彎引號（U+2018–201F）或空白後 `#` 的路徑被拒絕，貼進 cmd 與 PowerShell 不會多執行任何東西。
- [ ] **CI**（已實作、待實機驗證）：`ci-platforms.yml` 的 Windows runner 執行 `pnpm test:smoke`（隔離啟動、送事件、確認狀態、正常結束）；尚未在 Windows runner 實際跑過。

驗證完成後，請把對應項目打勾，並更新該問題的工作記錄狀態。
