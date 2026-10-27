# Phase 18 — 重構、效能、安全與可擴充性

日期：2026-10-26
分支：`feat/phase-18-hardening`
基準：`02e6bda`
版本：`1.3.0`（未變更）

## 完成摘要

P18.0–P18.6 已完成。本 Phase 修正 eventSource fixture，建立固定負載基準，整理 IPC 與視窗安全，拆分主程序與 renderer，改善 session、用量、History 與限流資料結構，並集中 IPC 型別與錯誤碼。效能數字與複雜度比較見 [`docs/perf/phase-18-results.md`](../perf/phase-18-results.md)。

## Checkpoint commits

| Checkpoint | 內容 | Commit |
| --- | --- | --- |
| P18.0 | 修正 eventSource fixture，建立效能基準 | `d7f7745e97f47de0076ec1d7d20088047c985b4c` |
| P18.1 | 建立 IPC 安全清冊並補齊 Electron 安全設定 | `678be54bdcb4fbbe46897919b64a5c6bf454fe03` |
| P18.2 | 拆分 IPC 並收斂主程序組裝根 | `774edb39546d8156821892cef772cbde31017658` |
| P18.3 | 優化主程序演算法與非同步檔案操作 | `5517a07a95fed3a51f5e2814618615fc93195136` |
| P18.4 | 拆分 Renderer 面板並優化 session | `2242e68a18c7c44d42adae68861659aeb5d73950` |
| P18.5 | 集中擴充 registry、IPC 型別與錯誤碼 | `fe84c52fe7c707ea59c282412e4c738c7e6a1c4d` |
| P18.6 | 全面回歸與收尾 | 本報告所屬的最終 checkpoint commit |

## P18.6 驗收

### §0.4 檢查

| 指令 | 結果 |
| --- | --- |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 通過；450/450 |
| `pnpm exec vite build` | 通過；Renderer 與四個 Electron bundle 均建置完成 |
| `pnpm check:bundle` | 通過；plugin panel shared tokens 僅嵌入預期的 main bundle |
| `git diff --check` | 通過 |

### 隔離 Electron：開發版

使用 `pnpm exec vite build` 後執行 `node scripts/e2e-isolated-electron.mjs`。等待 `AGENT_PETS_E2E_READY`，確認 `fakeSafeStorage: true`，再透過 DevTools 驗收。開始及結束計數如下：

| 計數 | 開始 | 結束 |
| --- | --- | --- |
| `calls.isEncryptionAvailable` | 0 | 0 |
| `calls.encryptString` | 0 | 0 |
| `calls.decryptString` | 0 | 0 |
| `blockedExecs` | 3 | 3 |

實測結果：

- 寵物頁已載入並顯示離線狀態；狀態面板的 Sessions、History 與 Growth 可開啟。
- 七個設定頁（語言、外觀、桌面、插件、寵物、成長、進階）均可切換。
- 以五個 `ok-*` fixture 驗證插件安裝與啟用；總開關可關閉及重新開啟，單插件可停用／啟用，並完成保留資料與不保留資料的移除。
- `ok-notify` 的 storage 往返與通知中心訊息可讀；`ok-panel` 顯示測試 storage 並成功收到 Worker 回覆。
- `ok-event-source` 狀態列出 `tool-running`；`ok-skin` 出現在寵物清單。
- 為重新核對 P18.0 F1，隔離實機安裝並啟用 `ok-event-source` 與 `evil-event-source`：前者記錄 `eventSource status accepted` 且無診斷；後者維持 enabled，診斷只出現預期的 `invalid_request` 與 `rate_limited`，未進入 `disabled_crashed`。
- 以主程序中的 Tray 模板呼叫 `ok-commands` 開始／停止 callback；徽章顯示 `ON`，停止後清除。未操作系統選單列。
- 使用 `__agentPetsE2E.catalogFixture` 初次安裝 `ok-signed` 1.0.0，更新至 1.0.1；簽章輪替未同意時回 `signature_confirmation_required`，竄改 archive 回 `signature_invalid`。

### 隔離 Electron：打包內容

執行 `electron-builder --dir`（停用簽章身分自動探索），將 `app.asar` 解至 `<tmp>/app-root`，再以 `node scripts/e2e-isolated-electron.mjs --app-root <tmp>/app-root` 啟動。收到 `AGENT_PETS_E2E_READY` 且確認假 `safeStorage` 後才操作；沒有直接啟動 `.app`。

| 計數 | 開始 | 結束 |
| --- | --- | --- |
| `calls.isEncryptionAvailable` | 0 | 0 |
| `calls.encryptString` | 0 | 0 |
| `calls.decryptString` | 0 | 0 |
| `blockedExecs` | 3 | 3 |

打包內容驗收結果：五個 fixture 可安裝及啟用；七個設定頁、History 與 Growth 可載入；`ok-skin` 出現在寵物清單；EventSource 為 `tool-running`；panel-view 的 storage 讀回與 Worker 回覆成功；Tray callback 可顯示及清除徽章；總開關、單插件啟停、兩種資料移除均成功。catalog fixture 安裝 1.0.0、更新至 1.0.1、拒絕未確認的簽章輪替及拒絕竄改 archive 均符合預期。

### 安全檢查

- 從 P12 首個 checkpoint 的前一個 commit 到 P18.5 的新增行歷史，以及本次報告共掃描 36,473 行；私鑰 PEM、常見 GitHub／OpenAI／Slack／AWS／Google token 與本機絕對路徑皆 0 筆。email pattern 命中 6 行，均為安全測試拒絕 URL user-info 的合成 `example` 網域案例，不是個人信箱；掃描過程未輸出匹配內容。
- `pnpm audit --prod --audit-level moderate`：通過，`No known vulnerabilities found`。
- 隔離驗收過程的 fake `safeStorage` 呼叫起訖皆為 0；`blockedExecs` 維持 3。沒有觸發真實鑰匙圈或相機、麥克風、定位等系統權限。

## 效能與複雜度

`pnpm bench` 已完成：固定種子、30 次微基準、5 次冷啟動。Agent session 索引中位數改善 92.2%；本機用量首次掃描改善 54.0%、追加掃描改善 54.5%。Plugin net 限流中位數改善 1.2%。Feed queue、Feed/eventSource 限流、History 查詢及冷啟動量到較慢結果；數值、p95、複雜度及原因限制均列於效能報告，沒有把慢項標成改善。

## 殘餘風險與待決事項

- Windows 與 Linux 實機驗收未執行。
- 真實 macOS Keychain 與真實系統權限流程未驗證；本次依規定完全使用 fake `safeStorage`，不觸發權限視窗。
- 冷啟動中位數比基準慢 39.0%，主程序 bundle 增加 4.49%；基準測試無法單獨定位原因，建議後續以 profiler 查明。
- Feed queue 10,000 次中位數比基準慢 94.4%；額外去重與優先桶管理是可見的常數成本，需依真實使用負載評估是否值得進一步調整。
- P18.4 拆分後本次驗證了分頁互動與資料載入；本次未重做淺色／深色逐頁截圖比對，因此視覺及捲動容器等價性未在 P18.6 重新量化。
- quota 頁未開啟；隔離啟動與面板操作期間 fake `safeStorage` 計數皆為 0。正式版額度頁讀取鑰匙圈的行為仍依交接規則列為未驗證。

本報告只保留相對路徑與 `<tmp>`，不記錄本機絕對路徑、主機名稱、環境變數值、個人資料、token 或鑰匙圈資料。
