# Phase 16 驗證報告：徽章、指令、Tray 與寵物外觀

- 日期：2026-10-26
- 目前版本：`1.2.4`（未修改）
- 建議版本：`1.3.0`（Phase 12–16 建議 minor；本階段未改版）
- 階段狀態：P16.1–P16.5 已完成；P16.6 程式、測試與文件已提交。單元測試與 source gates 通過，但隔離 Electron 未到達 READY，實機驗收未完成，因此 Phase 16 整體尚未驗收通過。
- 分支：`feat/plugin-host`

## 範圍與結果

- 完成 commands、Tray、badge、plugin skins 的 manifest、Host API、UI、狀態清理與測試；新增 `ok-commands`、`evil-badge`、`evil-skin` fixtures。
- 完成 pomodoro（只使用 `agentStatus`、`schedule`、`feed`、`badge`）及無 `entry` 的 skin-pack 範例。測試以正式 manifest parser 驗證兩個範例，並由 `PluginRegistry` 實際規劃與安裝 skin-pack。
- 更新中英文插件開發索引、API 參考、貢獻點、限制、範例頁、README、規劃文件及 pet-skill project map。新增文件測試檢查雙語頁面配對與本機 Markdown 連結。
- 未修改版本號、`.claude/` 或 runtime dependencies；未執行 `pnpm build`／`pnpm build:fast`。

## Checkpoints

| Checkpoint | 內容 | Commit | 結果 |
|---|---|---|---|
| P16.1 | Manifest commands、Tray、badge、skins | `8ee216e` | 已完成並推送 |
| P16.2 | 使用者觸發指令與 Worker callback | `1c1ffea`, `516bcf0` | 已完成並推送 |
| P16.3 | Tray 插件子選單 | `5f0a3b9` | 已完成並推送 |
| P16.4 | 狀態列徽章、合併計數與清理 | `b9254310c99e00f178758f002c92ca170c03b92c` | 已完成並推送 |
| P16.5 | 插件寵物外觀與 fallback | `0bb08a687ab5d9733d7c6f599df47dd0f3aad8fc` | 已完成並推送 |
| P16.6 | 雙語文件、pomodoro／skin-pack 範例、安全 fixtures | `50ca8702541d1e70c158765d1dac83e3c85af92c` | source gates 通過並推送；隔離 Electron 未驗證 |

## Acceptance criteria

| 驗收項目 | 結果 |
|---|---|
| README 說明插件功能、本機安裝、安全邊界並連到 `docs/plugins/` | 已完成；中英文 README 均有對應內容 |
| P16 文件含 commands、Tray、badge、skins 的 API、權限顯示文字、錯誤碼與數值上限 | 已完成；API 參考、權限、貢獻點、限制與 manifest 文件已核對來源契約；雙語頁面與連結測試通過 |
| pomodoro 與 skin-pack 範例 | Manifest parser 測試通過；pomodoro API 使用範圍測試通過；skin-pack 的 WebP 簽章、安裝計畫與 Registry 安裝測試通過。隔離 Electron 安裝未驗證 |
| ok-commands、evil-badge、evil-skin fixtures | fixture manifest、兩個指令與 Tray 宣告、徽章超長／每 10ms probe、偽造與超大 spritesheet 拒絕測試通過 |
| Tray 子選單出現／消失與指令觸發 | 單元測試通過；Electron 實機未驗證 |
| badge 顯示、`+N` 合併、skin 套用與停用後 fallback | 單元測試通過；Electron 實機未驗證 |
| `ok-notify`、`ok-skin`、`panel-demo` 在打包內容的隔離 Electron 運作 | `electron-builder --dir` 與 `asar extract` 成功，抽取內容有 main bundle 與 renderer entry；隔離啟動器未輸出 READY，插件安裝與執行未驗證 |
| Phase 12–16 總結及規劃差異 | 已新增總結報告，並將規劃文件標為「已實作（Phase 12–16）」 |

## 檢查與安全結果

| 指令／檢查 | 實際結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過，exit code 0 |
| `pnpm test:unit` | 通過，334/334 |
| `pnpm exec vite build` | 通過；renderer、main、preload、plugin host preload、plugin UI preload 均產出 |
| `pnpm check:bundle` | 通過：main bundle 含 panel shared tokens |
| `git diff --check` 與 `git diff --cached --check` | 通過 |
| `pnpm audit --prod --audit-level moderate` | `No known vulnerabilities found` |
| Secret／本機個資 pattern scan | 掃描 P12.1 起至本次 staged diff；private key、GitHub/OpenAI/Slack token、AWS key、Google API key 與 `/Users/<user>` 路徑均為 0 命中。另有 3 個 email-like 範例字串，均位於測試且使用保留的 `example.com` 網域；沒有本機或個人地址。只記錄分類結果，未保存個資值 |
| `pnpm build`／`pnpm build:fast` | 未執行 |

打包命令 `pnpm exec electron-builder --dir --config.compression=store` 成功，並已用 `pnpm exec asar extract` 抽取 `app.asar` 到暫存目錄；未啟動產出的 `.app`。打包器自動輸出本機 code-sign identity discovery 並略過簽署。沒有把 identity 資料存入專案或報告；但無法據此宣稱系統憑證資料未被查詢，列為安全待決事項。沒有再次執行簽署或憑證探查步驟。

## 隔離 Electron 驗證

依規則執行 `node scripts/e2e-isolated-electron.mjs`。腳本輸出啟動器資訊後結束，未出現 `AGENT_PETS_E2E_READY`；因此沒有連接主程序 inspector、沒有安裝或啟用任何插件，也沒有讀到 `globalThis.__agentPetsE2E.calls` 的開始／結束值。依交接 §0.4a 在未 READY 時停止驗收，沒有改用 `pnpm dev` 或自行組 Electron 指令。

結果：Tray 模板／callback、指令通知與徽章、`+N`、外觀選擇與停用 fallback、`ok-notify` storage round-trip、panel-demo `tokens.css` 載入、以及從零照入門教學與 panel-view 指南建立插件，全部標示**未驗證**。此處沒有聲稱通過。這次未執行 secrets API，也沒有呼叫相機、麥克風、定位或螢幕錄影 API。

## 手動驗收步驟

1. 執行 `pnpm exec vite build && pnpm check:bundle`。預期兩項均成功。
2. 執行 `node scripts/e2e-isolated-electron.mjs`。確認出現 `AGENT_PETS_E2E_READY`、`fakeSafeStorage: true`，且 userData／HOME 位於腳本建立的暫存 root；若未 READY，立即停止，不要用 `pnpm dev` 或其他 Electron 命令替代。
3. 透過主程序 inspector 記錄開始時的 `globalThis.__agentPetsE2E.calls`。在隔離環境準備 `.agentpet-plugin` 測試包；需要選檔時依 §0.4a 暫時 stub `dialog.showOpenDialog` 指向該包，再由 Plugins 面板呼叫 `selectPluginArchive()` 並確認 `installPluginPlan(token, true)` 成功。
4. 安裝並啟用 `ok-notify`。預期通知中心出現 `Storage round-trip passed.`；該流程不使用 secrets。
5. 安裝並啟用 `ok-commands`。由主程序 inspector 讀取 `globalThis.__agentPetsE2E.trayMenuTemplate`，確認 Plugins 子選單和 `Start test`／`Stop test`；在 inspector 中直接呼叫對應項目的 `click` callback，不操作真實選單列。預期 Worker 收到 command，通知中心新增 command 通知，徽章更新；停用插件或總開關後 Tray 子選單消失。
6. 啟用 `evil-badge`，查看插件 diagnostics。預期超過 6 個 Unicode code points 的值回 `invalid_request`，有效值在一秒內再次更新回 `rate_limited`；確認狀態列不溢出後停用 fixture。
7. 同時啟用三個徽章來源（例如 `ok-commands`、`evil-badge`、`pomodoro`），透過 inspector 觸發 `ok-commands`。預期每隻可見寵物最多顯示兩個插件徽章，其餘合併為 `+N`；Mini、Edge、隱藏狀態不顯示。
8. 安裝並啟用 `ok-skin`。預期外觀清單顯示「來自插件」標籤，可套用外觀；停用插件後回到預設寵物且 progression 資料仍存在。再試安裝 `evil-skin`；偽造 WebP 與超過 20 MB spritesheet 都應拒絕。
9. 打包驗收另依 §7 步驟執行 `pnpm exec electron-builder --dir --config.compression=store`，抽取 `app.asar`，再使用 `node scripts/e2e-isolated-electron.mjs --app-root <抽取目錄>`。只在 READY 後安裝 `ok-notify`、`ok-skin`、`panel-demo`；預期通知 storage round-trip、skin 可選取，面板頁可讀 `_shared/tokens.css`。不得直接開啟 `.app`。
10. 結束前透過主程序 inspector 記錄 `globalThis.__agentPetsE2E.calls` 結束值；只在隔離啟動器 terminal 結束其程序。預期測試全程未呼叫 secrets，沒有任何相機／麥克風／定位／螢幕錄影權限視窗。

## 殘餘風險與待決問題

- **待決：**隔離啟動器為何在輸出 READY 前結束；需要先確認原因，再完成上述 Electron 手動驗收並記錄 calls 前後值。
- **待決：**`electron-builder --dir` 的 macOS code-sign discovery 是否查詢系統憑證儲存。此流程自動輸出了 identity discovery；未保存 identity 資料。後續重跑前需先確認不會觸碰使用者鑰匙圈的建置設定。
- macOS 的本階段 Electron UI 驗收未完成；Windows/Linux 未驗證。
- 真實系統鑰匙圈、相機、麥克風、定位與螢幕錄影行為沒有驗證，也不得視為通過。
- Plugin Host 目前只有總體 Worker memory budget，沒有精確的單一 Worker 記憶體隔離。
- Phase 17 的線上目錄、作者簽章、自動更新及 `eventSource` 未實作。
