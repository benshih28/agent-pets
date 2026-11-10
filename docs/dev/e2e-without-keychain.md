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

加上 `--pet-pack` 會先放一個刻意混入不合法值的寵物包，驗證主程序的 `behaviorManifest` 清理與畫面端回退。`--rounds N` 會把整組 8 個事件重複 N 輪，每輪用新的 session，只印出不符合預期的事件和總結。任何一個事件不符合預期，腳本就以非 0 結束。

同一個 app 裡，前面遺失的事件會留下停在「思考中」的 session，蓋過後面的畫面。所以比較修正前後時，每次都要換一個新的 app。

冷啟動：先結束隔離 app，再執行

```bash
node --experimental-strip-types scripts/e2e-real-hook.mts --home <home> --cold-start 150 [--interval 40]
```

腳本會用 `e2e-isolated-electron.mjs --reuse-root` 以同一個 HOME 重新啟動 app，從啟動那一刻起每 `--interval` ms 對一個新 session 送一個 `Stop`，最後分開列出主程序收到幾個、寵物畫面收到幾個，以及 Electron 建立、載入 main.js、寫入啟動標記、事件埠監聽的時間點。app 啟動時會把部署的 hook 換回送往 17373 的版本，所以冷啟動改用 `~/.desktop-pet-e2e/` 裡不會被覆寫的副本，事件不會送到正式版。埠已被佔用時腳本拒絕執行。

單元測試（`pnpm test:unit`）完全不啟動 Electron。想縮短迭代可用 `pnpm test:unit:watch`，或
`node --test --experimental-strip-types tests/<file>.test.mts --test-name-pattern "<名稱>"`。
