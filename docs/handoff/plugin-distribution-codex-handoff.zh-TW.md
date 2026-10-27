# 交接：插件散佈（Phase 17）

> 給執行者（Codex）的完整指示。請 **從頭到尾讀完** 再開始。
> 前置：Phase 12–16 已合併進 `main` 並發布 `v1.3.0`。規劃文件：`docs/architecture/Plugin-System-Plan.zh-TW.md`；Phase 12–16 的交接：`docs/handoff/plugin-host-codex-handoff.zh-TW.md`（以下稱「舊交接」）。本文件與兩者衝突時，以本文件為準。

---

## 0. 工作方式

**沿用舊交接 §0.2–§0.7 的全部規則**（一次一個 Phase、絕對不能做的事、§0.4 檢查、§0.4a 隔離 Electron、§0.4b 安全檢查、commit 格式、回報、工作記錄），只有下列差異：

- **分支：** `feat/plugin-distribution`（已建立，基於 `main`）。所有工作 commit 在這個分支並 push。不要開 PR、不要合併、不要 rebase、不要 force push。
- **版本：** 不改版本號。建議版本 `1.4.0`（minor：新增散佈與簽章的公開契約），由使用者確認後另外處理。
- **中途停點：** P17.5（eventSource 威脅模型）完成後 **停止並回報**，等複檢通過才做 P17.6。P17.6–P17.7 完成後再停止回報。
- **工作記錄：** 一筆記錄涵蓋整個 Phase 17。`idempotencyKey`：`agent-pets-plugin-host-phase-17`；`title`：`插件宿主 Phase 17：散佈、簽章、更新與 eventSource`；`parentSessionId`：`0a84ada3-c88c-4197-9e8e-3d84a1747e6a`。每個檔案都要有 `changedFileChanges` 狀態與 provenance。
- **網路：** 單元測試與隔離 Electron 驗收 **都不可以連到真的 GitHub**。registry 與下載一律可注入（見 P17.2），驗收用本機 fixture。
- **打包驗證：** 照舊交接 P16.6 的步驟（`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir ...` → 解開 `app.asar` → `--app-root`）。不要跑 `pnpm build`／`build:fast`，不要直接開啟打包出來的 `.app`。
- **不新增 runtime 相依：** ed25519 與 SHA-256 一律用 Node 內建 `node:crypto`。
- **不得上傳使用者個資或環境資訊：** commit、push、文件、報告、工作記錄、issue／PR 內容都不可包含使用者的 email、本機絕對路徑（`/Users/...`、暫存資料夾路徑）、環境變數或 `.env` 內容、token、鑰匙圈／憑證資料、主機名稱或機器識別碼。commit 一律使用 repo 既有的 GitHub noreply 身分。每次 push 前檢查差異；需要這類資訊才能繼續時，停下來回報。

## 1. 已確認的決策（2026-10-26，使用者）

| 項目 | 決策 |
|---|---|
| 插件目錄 | 放在一個 GitHub 公開 repo 的 JSON（預設 `https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json`）。**repo 由使用者自己建立**，Codex 只提供 schema 與範例檔，不要建立或推送任何外部 repo。 |
| 作者簽章 | ed25519；**首次安裝綁定作者公鑰**（trust on first use）。之後的更新必須用同一把金鑰簽章；換金鑰或從「已簽章」變成「未簽章」都要使用者明確確認。未簽章的插件仍可安裝，但要明顯警示。 |
| 更新 | 只做 **檢查** 與 **提示**，安裝一律由使用者按確認，走既有的更新流程（權限增加要重新同意、降版要確認）。不做背景自動安裝。 |
| 評分／回報 | 不做評分。只做「回報問題」連結，開啟目錄 repo 的 GitHub issue 頁面。 |
| eventSource | 納入 Phase 17，但 **先寫威脅模型、複檢通過後才實作**，且只做 observe-only。 |

## 2. 全域規則（Phase 17 新增）

- 目錄 JSON、下載內容、簽章檔都是 **不可信資料**，逐欄驗證型別、長度、格式；驗證失敗就丟掉該筆，不影響其他筆。
- 下載與目錄讀取 **只在 Main** 進行，沿用 `electron/plugin-net.ts` 的防護：只允許 https／443、逐跳重驗 redirect、DNS 結果 IP 封鎖、不帶 cookie、大小上限、逾時。允許的 host 固定在程式碼內（`raw.githubusercontent.com`、`github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`；後兩者是 GitHub Release 下載 redirect 的目的地），**不能由目錄內容擴充**。
- 線上功能 **預設關閉**：設定 ▸ 插件新增「線上插件目錄」開關，關閉時 App 不會對外連線。開啟時才在使用者開啟目錄或按「檢查更新」時連線；可選每日檢查一次（預設關）。
- 所有新增 UI 文字走 `t()`，中英文同時新增；目錄提供的文字一律當純文字顯示。
- 回報連結的網址由宿主組成（固定的 issue 網址 + 插件 id + 版本），不採用目錄或插件提供的網址，不帶任何使用者資料。

---

## 3. Phase 17 checkpoints

### P17.0 散佈威脅模型（先寫，再實作）

- 新增 `docs/security/plugin-distribution-threat-model.md`：資產、攻擊者（惡意作者、目錄被入侵、網路中間人、搶註插件 id、偷換金鑰）、信任邊界、每項威脅的緩解與殘餘風險。
- 必須涵蓋：目錄被竄改、下載被替換、降版攻擊、id 搶註、金鑰遺失或外洩、未簽章插件、redirect 到不允許的 host、超大檔案或解壓縮炸彈。
- 獨立 commit，`Checkpoint: P17.0`。

### P17.1 簽章格式與驗證

- 套件內新增選填檔 `signature.json`（放在 zip 根目錄，與 `plugin.json` 同層）：
  ```json
  { "alg": "ed25519", "publicKey": "<base64，32 bytes>", "signature": "<base64，64 bytes>" }
  ```
- 簽章內容（payload）：除了 `signature.json` 以外的所有檔案，依路徑排序，每行 `<路徑>\t<sha256 hex>\n` 組成的 UTF-8 字串。在 `docs/plugins/` 寫清楚這個格式，並附一段 **只用 Node 內建 `node:crypto` 的簽章範例**（文件範例，不提供官方 CLI）。
- 新增純模組 `electron/plugin-signature.ts`（不 import `electron`）：解析與驗證 `signature.json`、計算 payload、驗證簽章、算公鑰指紋（`sha256(publicKey)` 前 16 個 hex，顯示時每 4 碼分組）。
- 安裝計畫（install plan）新增簽章狀態：`unsigned`、`valid`、`invalid`。**`invalid` 一律拒絕安裝**（新錯誤碼 `signature_invalid`）。
- 首次安裝時，把公鑰指紋記錄為該插件的信任金鑰（存在插件偏好或 registry 狀態，沿用既有原子寫入）。
- 更新時比對：
  - 同金鑰：照舊流程。
  - 不同金鑰：確認框顯示「作者金鑰已變更」與新舊指紋，預設按鈕是取消。
  - 已簽章 → 未簽章：同樣要確認，並顯示警告。
  - 未簽章 → 已簽章：記錄新金鑰，提示一次即可。
- 開發者模式從資料夾載入時不檢查簽章，但介面要標示「開發中，未驗證簽章」。
- 插件列表與安裝確認框顯示簽章狀態與指紋。
- 測試：payload 計算（排序、子資料夾）、正確簽章、竄改任一檔案、竄改 `plugin.json`、錯誤長度的 key／signature、非 base64、未知 `alg`、多餘欄位、更新時的四種金鑰情境。測試金鑰在測試內用 `generateKeyPairSync('ed25519')` 產生，**不要 commit 任何私鑰**。

### P17.2 線上插件目錄

- 新增 `docs/plugins/registry.schema.json` 與 `docs/plugins/registry/index.example.json`。目錄格式（`schemaVersion: 1`）：
  - `plugins[]`：`id`、`name`（LocalizedText）、`description`（LocalizedText，≤ 200 字）、`author`、`homepage`（https，選填）、`publicKeyFingerprint`（選填）、`versions[]`。
  - `versions[]`：`version`（semver）、`apiVersion`、`url`（https，host 必須在允許清單內）、`sha256`、`size`（bytes，≤ 25MB）、`publishedAt`（ISO 8601）。
  - 上限：目錄檔 ≤ 1MB、插件 ≤ 500 個、每個插件版本 ≤ 20 個。
- 新增純模組 `electron/plugin-catalog.ts`：解析與驗證目錄、選出與目前 App `apiVersion` 相容的最新版本、比對已安裝版本。
- Main 接線：讀目錄與下載都走 Main，下載完先比對 `size` 與 `sha256`，不符就丟掉（錯誤碼 `download_mismatch`）。通過後交給既有的 archive guard 與 install plan，**沿用同一個安裝確認框**（加上「來自線上目錄」與簽章資訊）。
- 若目錄有 `publicKeyFingerprint`，而套件簽章的指紋不同：拒絕安裝（`signature_mismatch`）。
- UI：設定 ▸ 插件新增「線上目錄」區塊：開關、搜尋、列表（名稱、作者、簡介、版本、簽章狀態）、「安裝」按鈕。開關關閉時整塊只顯示說明與開關。
- **可注入：** registry 讀取與下載函式要能在測試中替換。隔離 Electron 驗收時，只在 `globalThis.__agentPetsE2E` 存在（隔離啟動腳本才會設定）時，允許從 `__agentPetsE2E.catalogFixture` 取得目錄與套件內容；正式執行時不得有任何後門。
- 測試：目錄驗證（每個欄位的正反例、上限）、不允許的 host、sha256／size 不符、與 apiVersion 不相容的版本被跳過、redirect 到不允許的 host 被擋。

### P17.3 更新檢查

- 「檢查更新」按鈕：比對已安裝插件與目錄，列出可更新項目（目前版本 → 新版本、權限是否增加、金鑰是否變更）。
- 每個項目的「更新」按鈕走 P17.2 的下載與既有更新流程；權限增加要重新同意，金鑰變更走 P17.1 的確認。
- 選填「每天自動檢查一次」（預設關閉，且只有線上目錄開啟時才能開）：只檢查並在通知中心留一則系統訊息，**不下載、不安裝**。
- 不在目錄裡的插件（本機安裝的）顯示「不在線上目錄」，不檢查。
- 測試：版本比較（含 prerelease）、降版不列為更新、權限增加與金鑰變更的標示、每日檢查的排程與上限。

### P17.4 回報問題

- 插件詳情新增「回報問題」按鈕：用 `shell.openExternal` 開啟 `https://github.com/Ponpon55837/agent-pets-plugins/issues/new?title=<編碼後的 "[<id>] <version>">`。
- 網址只在 Main 組成，只帶插件 id 與版本，**不帶任何使用者資料、路徑、log**。本機安裝且不在目錄中的插件也可回報，但標題註明「本機安裝」。
- 測試：網址組成與編碼、拒絕不合法的 id／version。

### P17.5 eventSource 威脅模型（寫完就停）

- 新增 `docs/security/plugin-event-source-threat-model.md`，前提：**observe-only**，插件只能讓寵物「顯示」另一個 Agent 的狀態。必須回答：
  - 插件可以送出哪些狀態（建議只限 canonical 的 `thinking`、`tool-running`、`idle`、`done`、`error` 子集）？
  - 如何保證 **不能** 觸發 Permission 請求、不能回應 Permission、不能產生 XP、成就、History、quota 紀錄？
  - 狀態列如何標示「來自插件」，避免冒充 Claude／Codex 等內建來源（family 名稱保留字）？
  - 速率限制、session 數上限、逾時自動清除、插件停用時的清除。
  - 與既有 `agent-adapter.ts`（特別是 `generic-http`）的關係：重用哪些驗證、哪些絕對不能共用。
- 寫完後 commit（`Checkpoint: P17.5`），更新工作記錄與 phase report 草稿，**停止並回報**，等複檢意見。

### P17.6 eventSource 實作（複檢通過後才開始）

- 依複檢通過的威脅模型實作。最低要求：
  - manifest 新增 `contributes.eventSource: { family: string; displayName: LocalizedText }`，family 不可使用內建保留名稱。
  - Host API：`api.agent.emit(event)`，只接受威脅模型允許的欄位與狀態；錯誤碼沿用既有 union（`invalid_request`、`rate_limited`、`not_permitted`）。
  - 事件只進入顯示用的狀態，**不進入** Permission、XP、成就、History、quota 的任何路徑；加測試證明。
  - 插件停用、移除、崩潰時清除它產生的狀態。
- Fixture：`ok-event-source`（送出合法狀態）、`evil-event-source`（冒充內建 family、超速、送出 permission 類事件、超長字串）。
- 文件：`contribution-points`、`api-reference`、`permissions`、`limits` 中英文同步補上。

### P17.7 Phase 17 收尾

- 測試插件：`ok-signed`（有效簽章）、`evil-signed-tampered`（簽章後竄改檔案）、`ok-signed-rotated`（同 id、不同金鑰的新版本）；簽章用測試中產生的金鑰即時產生，不要 commit 私鑰。
- 隔離 Electron 實測（用 `catalogFixture`，不連外網）：線上目錄開關、目錄列表、從目錄安裝（簽章顯示正確）、竄改套件被拒、金鑰變更時出現確認、檢查更新列出新版本並完成更新、回報按鈕產生的網址（攔截 `shell.openExternal`，不要真的開瀏覽器）、eventSource 狀態顯示與清除。
- 打包驗證（§0 的步驟）：至少在打包內容上驗證「從目錄 fixture 安裝 `ok-signed`」與 eventSource。
- 開發者文件：新增 `docs/plugins/signing.md`／`signing.zh-TW.md`（簽章格式、範例、金鑰保管建議、換金鑰會發生什麼）與 `docs/plugins/publishing.md`／`publishing.zh-TW.md`（如何把插件送進目錄 repo：index 格式、sha256、PR 流程）；更新 README 索引、`examples`、`limits`、錯誤碼表；全文校對數值與程式一致。
- 更新 `README.md`／`README.zh-TW.md` 的插件段落（線上目錄、簽章、更新、回報），規劃文件 Phase 17 狀態改為「已實作」並列出差異。
- 寫 `docs/phase-reports/phase-17-plugin-distribution.md`。
- 停止並回報。**不要改版本號。**

---

## 4. 不在本次範圍

- 建立或推送 `agent-pets-plugins` repo、上架任何插件（由使用者處理）。
- 評分、帳號、伺服器端服務。
- 背景自動安裝更新。
- 官方簽章 CLI 或 SDK（只提供文件範例）。
