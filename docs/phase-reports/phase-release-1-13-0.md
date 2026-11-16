# 1.13.0：共用來源整合（12 個重構階段）

- **開始時間**：2026-11-10 09:18（Asia/Taipei，規劃文件 commit `345a100`）
- **完成時間**：2026-11-10（Asia/Taipei，本 PR）
- **基準**：`main` @ `404ab6f`（1.12.5）
- **整合分支**：`claude/shared-sources-refactor`
- **評估與排程**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 3.1 節

## 1. 範圍

依評估文件把 15 項散落的來源整合成 12 個階段。每個階段在獨立 worktree 的子 session 中完成（Opus 總控、Sonnet 子代理執行、Opus 複檢），再由總控審核後 squash 合併到整合分支，並刪除該階段的 worktree 與分支。

| 階段 | 內容 | commit | 工作記錄 |
|---|---|---|---|
| 1 | Agent 設定目錄跟隨 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`XDG_CONFIG_HOME`（含 macOS／Linux login shell 查詢）—**缺陷修正** | `35f6cb9` | [refactor-01](refactor-01-agent-config-dirs.md) |
| 2 | 寵物視窗尺寸契約、不透明 ID 格式、`clamp` | `647960e` | [refactor-02](refactor-02-pet-window-size.md) |
| 3 | Plugin 權限單位產生器 | `1926b08` | [refactor-03](refactor-03-plugin-permission-units.md) |
| 4 | 點陣圖格式辨識 | `bde2f70` | [refactor-04](refactor-04-raster-signature.md) |
| 5 | 本機通訊契約（port、token 路徑、header、endpoint）、Agent 顯示名稱 | `b3a6f25` | [refactor-05](refactor-05-local-wire-contract.md) |
| 6 | Loopback HTTP server 共用骨架 | `f55d2a2` | [refactor-06](refactor-06-loopback-server.md) |
| 7 | 相對時間、時長與 Intl formatter 快取；本地化型別 | `940a00b` | [refactor-07](refactor-07-intl-locale.md) |
| 8 | localStorage key registry | `5fdffe6` | [refactor-08](refactor-08-storage-keys.md) |
| 9 | agentStore 拆成 7 個領域模組 | `d5f5b47` | [refactor-09](refactor-09-agent-store.md) |
| 10 | Plugin 面板控制器拆分 | `26b0b4e` | [refactor-10](refactor-10-plugin-panel-controller.md) |
| 11 | userData 路徑表；寵物視窗模式與 History runtime 服務 | `7a30439` | [refactor-11](refactor-11-main-runtime.md) |
| 12 | 原子寫檔底層機制 | `2c02127` | [refactor-12](refactor-12-atomic-write.md) |

## 2. 版號

**minor（1.12.5 → 1.13.0）**，使用者事先指定。理由符合 `phase-gates.md`：階段 9–11 是大型結構性重構，階段 1 改變 hook 安裝與讀取的檔案系統位置，階段 6 觸及 local server 的安全相關底層步驟。沒有持久化 schema、公開插件契約或 MCP 契約變更。`pnpm-lock.yaml` 沒有記錄專案版本，所以只改 `package.json`。

## 3. 使用者可見的變化

- 設定了 `CLAUDE_CONFIG_DIR`、`CODEX_HOME` 或 `XDG_CONFIG_HOME` 的使用者：hook 安裝、偵測、quota 與本機用量改讀寫 agent 實際使用的目錄；設定精靈顯示目前的設定目錄、被忽略的無效值，以及舊位置的殘留 hook。改了 `CODEX_HOME` 之後需要在 Codex 裡重新信任 hook（Agent Pets 不代替使用者核准）。
- 檔頭損壞的圖片（例如只有 `89 50` 開頭的假 PNG）不再被當成合法的寵物 spritesheet。
- 其他階段的畫面文字、儲存的偏好、IPC 與 HTTP 回應都維持不變（各階段以 characterization 測試固定）。

## 4. 驗證

每個階段合併前，總控在該階段的 worktree 重新執行：

- `pnpm.cmd exec vue-tsc --noEmit`：12 個階段全部通過。
- `git diff --check`：全部通過。
- `pnpm.cmd run test:unit`：與基準分支比對失敗清單，12 個階段都沒有新增失敗。基準失敗共 8 個（這台 Windows 沒有 symlink 權限造成的 EPERM、hook 停滯計時）；`tests/agent-hook-delivery.test.mts` 與 `panel-theme-diagnostics` 的計時測試在機器負載高時偶發失敗，單獨重跑或與基準分支同時比對確認與變更無關。階段 6 新增的一個測試在完整負載下有競態，退回修正後才合併。
- 各階段的工作記錄另有 `vite build`、Electron 隔離實機驗證；階段 11 另跑了 `pnpm build`。

升版後在整合分支重新執行 `vue-tsc --noEmit` 與 `vite build`：都通過；`git diff --check` 通過。

## 5. 待使用者決定與後續

1. **Loopback 位址檢查**（階段 6 評估）：目前只有 permission server 拒絕非 loopback 的 `remoteAddress`。建議 event 與 presentation server 也加上同樣檢查，並在 README 註明 WSL／容器轉送不支援。這是安全邊界變更，本版未改。
2. **插件通知收件匣的相對時間**（階段 10 實機觀察，**已於 1.13.1 修正**，見 [fix-inbox-relative-time](fix-inbox-relative-time.md)）：`PluginNotificationInbox.vue` 以元件建立時的 `now` 計算，晚到的通知會顯示成未來時間；建議改用 `useNow()`。
3. **未拆的部分**：agentStore 的 sessions 與淘汰規則（階段 9）、plugin 控制器的 catalog／安裝／偏好（階段 10）、runtime 的其他服務（階段 11），各自的建議做法記錄在對應的工作記錄。

## 6. 殘餘風險

- macOS／Linux 沒有實機驗證，包括 login shell 查詢、POSIX 權限與 symlink 測試（在這台 Windows 上 skip）。
- 多螢幕／DPI 的視窗尺寸只以單元測試涵蓋。
