# 不碰 Keychain 與正式版資料的 e2e

自動化測試不能觸發 macOS 鑰匙圈提示，也不能動到你日常使用的 Agent Pets。

1. 建置：`pnpm exec vite build`
2. 啟動隔離版本：`node scripts/e2e-isolated-electron.mjs`
   - 使用全新的暫時 HOME 與 userData。
   - 在任何 App 程式碼執行前就安裝假的 `safeStorage`，所以不會讀寫鑰匙圈。
   - 預設把三個本機埠移到 27373–27375，不會搶走正式版的 17373–17375，也收不到你真實的 hook 事件。
     `--hook-port-base <埠>` 改用另一組連續三個埠（例如與其他工作樹同時測試時）；`--real-hook-ports` 才使用預設埠，
     只在需要真實 hook 送達時使用，並盡量縮短執行時間。啟動日誌的「listening on」會列出實際的埠。
   - 執行器一律以 node_modules 的 Electron 啟動，`--app-root` 指向的建置也會讀下表的變數；只有在這組變數出現之前建置的版本會綁定預設埠。
3. 自己啟動開發版時（例如 `pnpm dev`）也可用環境變數改埠；打包後的正式版一律忽略這些變數。

   | 變數 | 預設 |
   | --- | --- |
   | `AGENT_PETS_EVENT_PORT` | 17373 |
   | `AGENT_PETS_PERMISSION_PORT` | 17374 |
   | `AGENT_PETS_PRESENTATION_PORT` | 17375 |

   只接受 1024–65535 的整數。安裝好的 hook 腳本仍然送到預設埠，所以要驗證真實 hook 時請關閉正式版。

## 經過真實 hook 的 e2e

`scripts/e2e-real-hook.mts` 在隔離 app 的 HOME 執行真正的安裝程式，產生隔離的 Claude Code settings 和 `agent-hook.mjs`；唯一的改動是把部署腳本裡的兩個網址換成隔離埠。接著照 Claude Code 的方式，從那份 settings 讀出 hook 指令、用 stdin 送 payload，最後檢查 store 狀態與寵物畫的列。它不會寫入你的 `~/.claude`，也不會啟動 `claude` CLI；指定 17373 會直接拒絕執行。

```bash
pnpm exec vite build
node scripts/e2e-isolated-electron.mjs   # 記下啟動日誌 READY 那行的 home
node --experimental-strip-types scripts/e2e-real-hook.mts --home <home> [--pet-pack] [--rounds N]
```

加上 `--pet-pack` 會先放一個刻意混入不合法值的寵物包，驗證主程序的 `behaviorManifest` 清理與畫面端回退。`--rounds N` 會把整組 14 個事件（含 `PreCompact`／`PostCompact` 與帶 `notification_type` 的 `Notification`）重複 N 輪，每輪用新的 session，只印出不符合預期的事件和總結。任何一個事件不符合預期，腳本就以非 0 結束。

同一個 app 裡，前面遺失的事件會留下停在「思考中」的 session，蓋過後面的畫面。所以比較修正前後時，每次都要換一個新的 app。

冷啟動：先結束隔離 app，再執行

```bash
node --experimental-strip-types scripts/e2e-real-hook.mts --home <home> --cold-start 150 [--interval 40]
```

腳本會用 `e2e-isolated-electron.mjs --reuse-root` 以同一個 HOME 重新啟動 app，從啟動那一刻起每 `--interval` ms 對一個新 session 送一個 `Stop`，最後分開列出主程序收到幾個、寵物畫面收到幾個，以及 Electron 建立、載入 main.js、寫入啟動標記、事件埠監聽的時間點。app 啟動時會把部署的 hook 換回送往 17373 的版本，所以冷啟動改用 `~/.desktop-pet-e2e/` 裡不會被覆寫的副本，事件不會送到正式版。埠已被佔用時腳本拒絕執行。

## CI 冒煙測試

CI 與本機都用 `scripts/ci-smoke-electron.mjs` 確認建置出的 app 真的能跑起來（script 名稱 `pnpm run test:smoke`）：

```bash
pnpm exec vite build
node scripts/ci-smoke-electron.mjs --offscreen      # 本機一律加 --offscreen，視窗不會出現在螢幕上
# CI（Linux）：xvfb-run -a pnpm run test:smoke；macOS 另加 --tolerate-quit-hang
```

它做的事：

1. 透過 `scripts/e2e-isolated-electron.mjs` 啟動 app（隔離 HOME／userData、假的 `safeStorage`，不碰鑰匙圈與使用者設定）。
2. 等 `AGENT_PETS_E2E_READY`、事件埠 listening 日誌與 renderer 的 `agent` store 出現（逾時預設 60 秒）。
3. 用隔離 HOME 裡的 token，以 `src/types/local-wire.ts` 的路徑與 header POST 一筆 `thinking` 事件，預期 HTTP 204。
4. 經 `--remote-debugging-port`（CDP）讀 renderer store，確認該 session 的狀態是 `thinking`。
5. 經主程序的 `--inspect` 埠呼叫 `app.quit()`（Windows 沒有 SIGTERM 語意，所以不靠訊號），確認 app 在 20 秒內以 0 結束，最後刪除暫存 root。

任何一步失敗都以非 0 結束並印出 app 日誌尾端，且一定會結束殘留的 Electron 程序。啟動前會確認三個事件埠與 inspect／debug 埠都空閒；inspect／debug 預設向作業系統要空閒埠，事件埠預設 28573–28575（可用 `--hook-port-base`、`--inspect-port`、`--debug-port` 指定，與其他工作樹的測試並行時使用）。

部分 macOS 環境（例如沒有 GUI session 的沙盒）連一個空白的 Electron app 呼叫 `app.quit()` 都可能卡住不結束，與本 app 無關。本機遇到時加 `--tolerate-quit-hang`：只有在 app 的 `will-quit` 清理已執行（事件埠已關閉）卻沒在時限內結束時，才改為警告並強制結束。CI 的 Linux job（`ci.yml`）與 Windows job 不加這個旗標；`ci-platforms.yml` 的 macOS job 有加（`runner.os == 'macOS'` 時），事件埠沒關閉的真正卡住在所有平台仍然失敗。

逾時保護：每次 fetch 與 inspector（CDP）呼叫最多 5 秒；等待條件（`waitFor`）的單次檢查也受剩餘時間限制；整個流程另有看門狗（`--timeout` 加 60 秒），觸發時印出 app 日誌尾端、結束 Electron、刪掉暫存 root 並以非 0 結束，所以 inspector 接了連線卻不回應也不會卡到 job 逾時。

Linux 的 Chromium sandbox：Ubuntu 24.04 的 AppArmor 預設禁止 unprivileged user namespace，沒有 SUID 的 `chrome-sandbox` 時 Electron 會啟動失敗。我們**不**在 app 加 `--no-sandbox`（那會讓測試與正式行為不同），而是在 CI 的一次性 runner 上用 `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` 放寬限制，顯示由 `xvfb-run -a` 提供。啟動器會把 `DISPLAY`、`XAUTHORITY`（`xvfb-run -a` 的 X cookie 檔路徑）與 `WAYLAND_DISPLAY`、`XDG_RUNTIME_DIR` 傳給 Electron，因為 HOME 已換成暫存目錄，Electron 找不到 `~/.Xauthority`。

Linux 的 `safeStorage` 與插件機密：e2e 的假 `safeStorage` 只假造 `isEncryptionAvailable`、`encryptString`、`decryptString`，**沒有**假造 `getSelectedStorageBackend()`。App 在 Linux 上透過 `createSafeStorageEncryption`（`electron/plugin-secrets.ts`）判斷插件機密能否儲存，除了 `isEncryptionAvailable()` 還會要求 `getSelectedStorageBackend()` 不是 `basic_text` 或 `unknown`。所以 Linux 的 e2e 與冒煙測試裡，這個函式回報「不可用」（CI runner 沒有 keyring，真實的 backend 是 `basic_text`），插件機密會被拒絕儲存，測試**不會**走到插件機密儲存的路徑；macOS 與 Windows 因為只看 `isEncryptionAvailable()`，假的實作會被用到。需要在 Linux 驗證插件機密時，要在有 gnome-keyring／KWallet 的桌面實機上測試，或另外補假造 backend 的 e2e（目前沒有做）。

單元測試（`pnpm test:unit`）完全不啟動 Electron。想縮短迭代可用 `pnpm test:unit:watch`，或
`node --test --experimental-strip-types tests/<file>.test.mts --test-name-pattern "<名稱>"`。
