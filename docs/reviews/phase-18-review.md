# Phase 18 複檢

- 複檢對象：`feat/phase-18-hardening` 的 `02e6bda..67e161f`（P18.0–P18.6）
- 複檢日期：2026-10-26
- 結論：**Phase 18 通過。** 使用者看得到的行為沒有改變，可以升版 `1.3.1` 發布。另有一項既有行為（額度功能讀取鑰匙圈的時機）需要使用者決定，不阻擋本次發版。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 450/450 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `git diff --check 02e6bda..HEAD` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |
| 上傳內容檢查（email、本機路徑、私鑰、token） | 0 命中；commit 身分皆為 GitHub noreply |
| 版本號、相依套件 | 未改版本；`package.json` 只新增 `bench` 指令 |
| 資料格式 | 只新增一個 History 覆蓋索引，沒有 schema 變更 |
| 隔離啟動腳本 | 只改輸出處理（沒看到 READY 就退出時明確報錯）；`security`／`claude`／`codex` 阻擋與環境變數白名單仍在 |

## 行為不變的驗證

| 項目 | 結果 |
|---|---|
| Renderer 可呼叫的 API（`window.electronAPI`） | Phase 18 前後各啟動一次比對：面板與寵物視窗都是 103 個，名稱完全相同 ✅ |
| 主程序大小 | `electron/main.ts` 4,356 → 608 行；`PluginPanel.vue` 1,508 → 457 行；`StatusPanel.vue` 1,408 → 263 行 |
| 隔離 Electron 回歸 | `ok-notify`、`ok-commands`、`ok-skin`、`ok-event-source`、`panel-demo`、`evil-panel` 皆安裝並啟用成功；通知、Tray 指令、徽章、外觀清單、面板頁（含 `tokens.css`）、線上目錄 fixture、eventSource 狀態皆正常；設定 7 個分頁都有內容 ✅ |
| F1（eventSource fixture） | `ok-event-source` 現在可正常執行並顯示 `tool-running` ✅ |
| safeStorage／阻擋紀錄 | `calls` 全程 0；`blockedExecs` 為 `claude`、`security`、`security` |

## 冷啟動重新量測

Phase 18 報告寫冷啟動從 2,342 ms 變成 3,254 ms（慢 39%）。複檢者以同一支啟動腳本，**交錯** 啟動 Phase 18 前（`02e6bda` 的建置）與 Phase 18 後各 6 次，量到寵物視窗畫面完成：

| 版本 | 6 次結果（ms） | 中位數 |
|---|---|---|
| Phase 18 前 | 2932、2575、2365、2473、2477、2507 | 約 2,490 |
| Phase 18 後 | 2609、2171、2257、2137、2204、2240 | 約 2,220 |

沒有變慢，反而快了約 10%。報告中的差異來自前後兩組在不同時間依序量測（系統快取與負載不同），不是程式退步。

## 其他量測結論

- 明確改善：Agent 狀態事件處理快 92%（Map 索引），本機用量追加後重掃快 55%（增量讀取）。
- 插件通知佇列在 10,000 筆微基準中變慢（約每筆 15 微秒），但佇列深度固定為 8，實際使用不會感覺到；換得的是穩定排序與去重。可接受。
- 報告誠實列出沒有改善或變慢的項目，沒有誇大。

## 需要使用者決定（不阻擋 1.3.1）

**額度功能在每次啟動時讀取鑰匙圈。** 隔離啟動後、還沒打開任何額度頁面時，就已經攔到 `claude` 1 次與 `security` 2 次。也就是說，正式版 App 每次啟動都會用 `/usr/bin/security` 讀取 Claude Code 存在鑰匙圈的憑證、並執行 `claude` CLI 來查詢額度。這是既有產品行為，Phase 18 沒有改它；Phase 18 報告寫「只有開啟額度頁才會觸發」並不正確。

可選做法：
1. 維持現狀（啟動時與定時更新額度）。
2. 改成只有使用者打開「Token 剩餘」頁面，或按下更新時才讀取。
3. 在設定中加「顯示 Claude 額度」開關，預設關閉；開啟時才讀取鑰匙圈。
