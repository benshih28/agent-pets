# Phase 17 — 插件散佈

## 狀態

- 日期：2026-10-26
- 分支：`feat/plugin-distribution`
- 目前版本：`1.3.0`（未修改）
- 建議版本：`1.4.0`（後續規劃參考，本 Phase 未修改版本號）
- 階段狀態：P17.0–P17.7 與 P17.R 複檢修正完成。
- 未建立外部 repo、未上架插件、未建立 PR、未合併，未新增 runtime 相依；未提交私鑰。

## Checkpoint 與提交

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P17.0 | 散佈威脅模型 | `5866ca3b524ab749b87c6f4a88df7546e3f20f5b` | 通過檢查；338/338 單元測試 |
| P17.1 | Ed25519 簽章、TOFU 信任與金鑰變更確認 | `4a1766dc3f3cae6a5b2f14cb0e5dd7a539b09051` | 通過檢查；349/349 單元測試 |
| P17.2 | 線上目錄、下載大小與 SHA-256 驗證 | `96bd21fe59dca6d2024cd6e6ca10ff1b255a74a2` | 通過檢查；360/360 單元測試 |
| P17.3 | 手動更新與選用的每日目錄檢查 | `8b84ff69cacfbdec858e40e432453aaf7d4f0a06` | 通過檢查；366/366 單元測試 |
| P17.4 | 插件問題回報 | `b629497d79cd0b4d0e7f996607ec2155d97f679f` | 通過檢查；369/369 單元測試；隔離 Electron 與打包內容驗收 |
| P17.5 | eventSource 威脅模型（設計與 checkpoint） | `e11732d3b06d7db9cc4cd722047c7feaed677d89`、`a420a743815349373ce009cb301b42a31858c512` | 威脅模型通過複檢，並作為 P17.6 實作契約 |
| P17.R | 複檢修正 R1–R4 | `8c9347400cdcad3a1ecfc500da5ba2215619d353` | 預設目錄、固定回報網址、停用插件圖示與更新權限文案修正 |
| P17.6 | 隔離的插件 eventSource | `85d762aceee0e82f28c2570a2bf4b78deccd9ca3` | 威脅模型契約落地；不共用 Generic HTTP ingress |
| P17.7 | 簽章／更新／eventSource fixtures、作者文件與驗收 | `530a47d79f4a9c185fdf52055680a6a6a7029a7c` | 實作與文件完成；本報告由最後的 P17.7 收尾 commit 一併提交 |

## 複檢修正 R1–R4

| 項目 | 修正與測試 | Commit |
|---|---|---|
| R1 | 線上目錄預設網址設為 `https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json`，保留編輯及「恢復預設」；總開關仍預設關閉；預設網址錯誤會顯示可理解的錯誤。補目錄偏好與介面測試。 | `8c9347400cdcad3a1ecfc500da5ba2215619d353` |
| R2 | 正式回報網址固定為公開插件目錄 repo 的 issue form；移除環境變數依賴，E2E 可用 `__agentPetsE2E.pluginIssueReportBaseUrl` 覆寫。補網址與覆寫測試。 | `8c9347400cdcad3a1ecfc500da5ba2215619d353` |
| R3 | 新增專用插件圖示載入路徑，只允許 manifest 指定的圖示檔並驗證 raster 格式，不放寬其他插件檔案存取。補安全與 fallback 測試。 | `8c9347400cdcad3a1ecfc500da5ba2215619d353` |
| R4 | `permissionsIncreased === null` 時顯示「下載後確認」，不會誤報為未增加權限。補 UI／文案測試。 | `8c9347400cdcad3a1ecfc500da5ba2215619d353` |

## P17.6 eventSource

採用複檢通過的事件、狀態、保留 family、速率、session、大小與 TTL 契約。eventSource 使用自己的 IPC、驗證、store 與 renderer 通道，不共用 Generic HTTP ingress；插件事件不進入 Permission、XP、成就、History、quota、通知或內建 Agent event pipeline。停用、移除、崩潰與 reload 會清除插件狀態及限流紀錄，UI 明確標示「來自插件」。`ok-event-source` 與 `evil-event-source` 及單元測試涵蓋合法狀態、冒用保留名稱、超速、權限類欄位、長字串與隔離副作用。

## P17.7 文件、fixtures 與驗收

- 新增 `ok-signed`、`ok-signed-rotated`、`evil-signed-tampered` fixtures。驗收簽章金鑰於測試執行時以 `node:crypto` 產生；私鑰僅在記憶體中使用，未寫入檔案或 commit。
- 新增中英文簽章與發布指南、可執行的 `event-source-status` 範例，並更新中英文插件索引、README 及 Phase 17 規劃狀態。
- 目錄與套件來源透過隔離驗收注入的 `catalogFixture`；本次驗收未連線真實 GitHub。問題回報使用 E2E 覆寫網址並攔截 `shell.openExternal`。

### §0.4 檢查

| 指令 | 實際結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 通過，391/391 |
| `pnpm exec vite build` | 通過 |
| `pnpm check:bundle` | 通過；`dist-electron/main.js` 包含面板共用 tokens |
| `git diff --check` | 通過 |

以上收尾檢查在 Phase 17 報告完成後再次執行，全部通過。未執行 `pnpm build` 或 `pnpm build:fast`。

### §0.4b 安全檢查

- `pnpm audit --prod --audit-level moderate`：通過，`No known vulnerabilities found`。
- 對 Phase 17 自 `6adf8e3` 起的提交差異及收尾新增差異掃描私鑰標記、GitHub／OpenAI／Slack token、AWS／Google API key、email 與本機路徑格式：沒有私鑰、服務憑證、真實個人資料或特定工作站路徑。少量命中皆為拒絕 URL userinfo 的合成測試輸入，另有一筆交接文件的通用路徑格式範例；逐筆確認不含實際帳號、憑證或本機資料。
- 簽章範例的私鑰只在記憶體中產生，掃描未發現已提交私鑰。

### §0.4a 開發輸出 Electron 實測

1. 執行 `pnpm exec vite build`，再執行 `node scripts/e2e-isolated-electron.mjs`。等到 `AGENT_PETS_E2E_READY` 與 `fakeSafeStorage: true` 後才操作。
2. 透過 `catalogFixture` 載入 `ok-signed`：目錄開關初始為關閉、預設 URL 正確；開啟後列出插件，確認簽章指紋，完成首次信任並安裝 `1.0.0`，狀態顯示簽章有效。
3. 選取簽章後被修改的套件；安裝遭拒，回傳 `signature_invalid`。
4. 使用同一金鑰載入 `1.0.1`；更新清單顯示版本差異，完成更新；權限增加狀態顯示「下載後確認」。
5. 使用不同金鑰載入 `1.0.2`；確認畫面同時顯示舊、新指紋，取消控制項預設取得焦點；確認後才完成安裝。
6. 按下回報按鈕；`shell.openExternal` 記錄器攔截到由 E2E 覆寫網址組成的 issue form，沒有開啟瀏覽器或傳送請求。
7. 啟用簽章插件；Sessions 分頁顯示「來自插件」與 eventSource 的工作狀態。停用插件後狀態被清除，列表不再顯示該列。
8. safeStorage 計數起始與結束均為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`。

### 封裝內容驗收

1. 執行 `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --config.compression=store`，成功產生未簽章封裝內容；建置器明確略過 macOS 簽章身分探索。
2. 將 `app.asar` 解至暫存目錄，執行 `node scripts/e2e-isolated-electron.mjs --app-root <暫存目錄>`，等待 `AGENT_PETS_E2E_READY` 後操作；沒有直接開啟 `.app`。
3. 使用 `catalogFixture` 安裝 `ok-signed`，確認有效簽章與首次信任流程；啟用插件後 Sessions 分頁顯示 eventSource 狀態。未連線真實目錄或 GitHub。
4. safeStorage 起始與結束計數均為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`。

兩輪驗收都使用隔離 userData/HOME 與可逆假 safeStorage。沒有觸發 macOS 鑰匙圈、相機、麥克風、定位或其他系統權限視窗，也沒有使用真實瀏覽器。

## 手動驗收步驟

1. 在隔離環境執行 `pnpm exec vite build`，再執行 `node scripts/e2e-isolated-electron.mjs`；等 `AGENT_PETS_E2E_READY` 且 `fakeSafeStorage: true` 出現後再操作。
2. 確認 Plugins 面板的目錄開關預設關閉、URL 是公開目錄網址；開啟後以 `catalogFixture` 載入 `ok-signed`，預期顯示版本、指紋及首次信任確認。
3. 在主程序 inspector 將選檔對話框 stub 到 `evil-signed-tampered`，從面板安裝；預期拒絕並顯示簽章無效。
4. 載入同金鑰更新 fixture，執行檢查更新並套用；預期版本升級成功。載入輪替金鑰 fixture 時，預期先顯示舊、新指紋與確認畫面，取消時不更新，確認後更新。
5. 確認更新檢視在權限差異尚未計算時顯示「下載後確認」。
6. 按回報按鈕並檢查 E2E 的 `shellOpenExternalCalls`；預期只記錄 issue URL，不開啟瀏覽器。
7. 啟用 `ok-signed`，在 Sessions 分頁確認來源為「來自插件」；停用後預期 eventSource 狀態消失。
8. 記錄 `globalThis.__agentPetsE2E.calls`；safeStorage 三種方法的起始與結束計數均應為 0。
9. 封裝驗收時依 P16.6 步驟建置、抽取 `app.asar` 至暫存位置，並用 `--app-root` 啟動隔離腳本；重做安裝與 eventSource 檢查，不直接開 `.app`。

上述開發與封裝隔離 Electron 步驟已由本次執行完成；手動驗收清單供複檢者重做。真實 GitHub 目錄、系統鑰匙圈及 OS 權限視窗刻意未觸碰；Windows 與 Linux 尚未驗證。

## 待決問題與殘餘風險

1. `Ponpon55837/agent-pets-plugins` 公開目錄 repo 尚待使用者建立並維護。建立前預設網址會收到 404；應由 UI 顯示可理解的錯誤，且目錄開關仍由使用者控制。
2. Windows 與 Linux 的 Electron 與打包流程尚未驗證。
3. 真實 macOS 鑰匙圈及真實系統權限行為依安全規則未驗證；所有本次 secrets 相關驗收均使用假 safeStorage，且沒有觸發硬體或 OS 權限 API。
4. 使用者尚未在真實公開目錄上架插件；本次只使用 `catalogFixture`，不代表外部目錄服務可用性已驗證。
