# Phase 16 複檢

- 複檢對象：`feat/plugin-host` 的 `d52b6b8..27264a1`（P16.1–P16.6）
- 複檢日期：2026-10-26
- 結論：**Phase 16 通過；Phase 12–16 全部完成。** Codex 回報 P16.6 實機驗收被擋，是因為它的執行環境無法啟動 Electron；同一支 `scripts/e2e-isolated-electron.mjs` 在本機正常印出 `AGENT_PETS_E2E_READY`。實機驗收改由複檢者完成，結果如下。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 334/334 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `git diff --check d52b6b8..HEAD` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |
| 新增差異的密鑰／本機路徑掃描 | 0 命中 |
| 與 `origin/main`（含 PR #14）試合併 | 沒有衝突 |

### Electron 實機（隔離啟動腳本；safeStorage 呼叫次數全程 0）

| 項目 | 結果 |
|---|---|
| 安裝 `ok-commands`、`ok-skin`（無 entry）、`evil-badge`、`skin-pack`、`pomodoro`、`ok-notify` | 皆成功 ✅ |
| 安裝 `evil-skin`（副檔名改成 .webp 的非圖片） | 拒絕：`invalid_manifest` ✅ |
| Tray | 「插件」子選單位於「檢查更新」之後、「離開」之前，只列出 `命令驗證插件 ▸ 開始測試／停止測試` ✅ |
| 透過 Tray click callback 觸發「開始測試」 | Worker 收到指令並送出通知「Command started」✅ |
| 1 秒內連續觸發同一指令 | 第二次回 `rate_limited` ✅；未宣告的指令回 `not_permitted` ✅ |
| 徽章 | 主寵物顯示 2 個徽章（徽章濫用測試：X、番茄鐘：0m）與 `+1`；tooltip 為「插件名稱：文字」✅ |
| 外觀清單 | 設定 ▸ 寵物出現「冬日狐狸／來自插件：外觀測試插件」「雪狐／來自插件：雪狐外觀包」，沒有重新命名、刪除按鈕 ✅ |
| 外觀圖片 | `agent-pets://plugin/<id>/skins/*.webp` 可載入（1536×1872）；同插件的 `plugin.json` 不能當圖片讀取 ✅ |
| 套用插件外觀後停用該插件 | 改回預設寵物 `aang-airbender`，通知中心新增「寵物外觀已變更」，清單不再列出該外觀 ✅ |
| 停用 `ok-commands` | Tray「插件」子選單消失，徽章被清除 ✅ |
| 打包驗證（`CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir` → 解開 `app.asar` → `--app-root`） | `ok-notify` storage round-trip 通過、`ok-skin` 外觀可列出並載入、`panel-demo` 讀到 `_shared/tokens.css`（2 條規則）✅ |
| 未測 | 真實選單列點擊、Windows／Linux、寵物視窗中的 canvas 畫面截圖（隔離環境的寵物視窗為 1×1 隱藏狀態） |

## 關於 electron-builder 的簽章身分探索

Codex 回報打包時出現 code-sign identity discovery。electron-builder 在 macOS 預設會執行 `security find-identity` 列出鑰匙圈中可用的簽章憑證；這只會列出憑證名稱，不讀取密碼，通常也不會跳出提示。但為了符合「測試不碰鑰匙圈」的規則，複檢時改用 `CSC_IDENTITY_AUTO_DISCOVERY=false`，log 顯示 `skipped macOS application code signing`，沒有進行探索。交接 P16.6 的打包步驟已加上這個環境變數。

## 不阻擋的觀察

- 外觀改回預設時的通知內文，中文逗號被正規化成半形「,」（宿主訊息也經過插件文字的 NFKC 正規化）。外觀問題，之後可讓宿主產生的訊息略過正規化。
- `project-pets-get-enabled` 的 log 錯誤仍會出現：修正已在 `main`（PR #14），本分支尚未同步 `main`。

## 合併前剩下的事

1. 使用者確認版本號（建議 `1.3.0`，minor：新增插件公開契約與安全邊界）。
2. 同步 `main` 到 `feat/plugin-host`（試合併無衝突），改版本號，開 PR 到 `main`。
