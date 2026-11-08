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

單元測試（`pnpm test:unit`）完全不啟動 Electron。想縮短迭代可用 `pnpm test:unit:watch`，或
`node --test --experimental-strip-types tests/<file>.test.mts --test-name-pattern "<名稱>"`。
