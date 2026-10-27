# Plugin Host Phase 12–16 總結

- 日期：2026-10-26
- 發布版本：`1.3.0`（Phase 12–16 期間維持 `1.2.4`，合併前由使用者確認升版）
- 分支：`feat/plugin-host`
- 總體狀態：Phase 12–16 及其複檢已完成。P16.6 的隔離 Electron 與打包驗收由複檢者完成並通過，見 `docs/reviews/phase-16-review.md`。

## Phase 摘要

| Phase | 範圍 | 結果 |
|---|---|---|
| 12 | Plugin Core、manifest、archive、feed 仲裁與偏好 | 完成；含 P12.R 複檢修正 |
| 13 | Sandbox Host、本機安裝、Worker RPC 與管理面板 | 完成；含 P13.R 複檢修正 |
| 14 | 網路、密鑰、設定、排程與 Agent 狀態 | 完成；含 P14.R 複檢修正 |
| 15 | 自訂 sandboxed panelView、外框、尺寸與訊息通道 | 完成；含 P15.R 與 P15.R2 修正 |
| 16 | commands、Tray、badge、skins | P16.1–P16.6 程式／文件與 source gates 完成；P16.6 Electron 驗收待 READY 後補做 |

## Checkpoint commits

以下列出 Phase 12–16 的 checkpoint 與複檢 commit（短 SHA 依目前分支 log）：

| Phase | Checkpoint commits |
|---|---|
| P12 | `9a2e616`, `a268d02`, `efaa097`, `c92825a`, `8e34ba2` |
| P12.R | `bc96ed8`, `67850b2`, `dd861d3`, `5a22ca8`, `b562750`, `2757995`, `4570e14`, `7abdb4a`, `4230f57` |
| P13 | `05011b2`, `e9be74d`, `b5bd18b`, `af885f9`, `5c85968`, `bb0a198` |
| P13.R | `aa7df60`, `9cdc3ae` |
| P14 | `aa56c0f`, `0b5a6b3`, `6596821`, `796926a`, `b679a7d`, `00cbf90`, `554d27d`, `63e9613`, `5fb73a4` |
| P14.R | `732a58e`, `623fa1e` |
| P15 | `83baefc`, `42ce5dc`, `ef80789`, `faeaee5`, `7085e5d`, `3c5ebd6` |
| P15.R | `0695807`, `833ad94` |
| P15.R2 | `08ca468`, `48921ab`, `3200e32`, `f28c4d9` |
| P16 | `8ee216e`, `1c1ffea`, `516bcf0`, `5f0a3b9`, `b925431`, `0bb08a6`, `50ca870` |

`50ca870` 是 P16.6 的功能、測試、文件與範例 commit；本總結及 Phase 16 報告由後續收尾 commit 一併提交。

## 整體實作邊界

- 插件為不受信任程式碼；Host API 嚴格驗證請求與回傳值，不提供 Node.js、檔案系統、shell、權限回應、XP、成就、quota 或 history 存取。
- 網路只允許宣告或使用者核准的 HTTPS public host；redirect 逐跳重新驗證 DNS/IP；不傳送或保存 Cookie。
- Secrets 使用 Electron `safeStorage`，一般設定快照不回傳密鑰。測試 secrets 時必須先以隔離啟動器替換 safeStorage。
- panelView 使用獨立 sandboxed `WebContentsView`、非持久 partition、同插件資源 allowlist 和受限 preload；外框由宿主持有。
- 本機套件安裝、插件啟停、權限重新同意、更新／降版、開發者目錄載入、notifications、commands、Tray、badge、skins 都屬 Phase 12–16 範圍。
- 保留既有自訂寵物 zip／單張圖匯入；插件 skins 共用圖像安全驗證，但不是替代匯入流程。

## Phase 16 本次驗證狀態

- `vue-tsc` 通過；unit tests 334/334；Vite build、`check:bundle`、`git diff --check` 通過。
- `pnpm audit --prod --audit-level moderate`：無已知 production vulnerability。
- P12.1 至 P16.6 staged/committed diff pattern scan：private key、GitHub/OpenAI/Slack token、AWS key、Google API key、本機 `/Users/<user>` 路徑均 0 命中；3 個 email-like 測試值使用保留的 `example.com` 網域，沒有本機或個人地址。
- `electron-builder --dir` 與 `asar extract` 成功，未啟動 `.app`。自動 code-sign identity discovery 的系統憑證存取待確認。
- `node scripts/e2e-isolated-electron.mjs` 未輸出 `AGENT_PETS_E2E_READY`，因此沒有 inspector calls 計數，也沒有插件安裝、Tray callback、徽章、skin、panel-demo 的實機證據。不能將其寫成通過。

## 殘餘風險與建議

- 先釐清隔離啟動器未到 READY 的啟動原因；成功 READY 後再按 [Phase 16 手動驗收步驟](phase-16-plugin-contributions.md#手動驗收步驟) 完成真實 Electron UI 驗收並記錄 `globalThis.__agentPetsE2E.calls` 前後值。
- 先確認 macOS code-sign identity discovery 的安全設定，避免建置工具查詢使用者系統憑證儲存；不應把憑證名稱、識別碼或本機路徑保存進報告或 commit。
- 本次未驗證 Windows/Linux；真實鑰匙圈與系統硬體／權限流程也未驗證。
- 目前沒有每個 Worker 的精確記憶體隔離；線上目錄、發布者簽章、自動更新、`eventSource` 留待 Phase 17。
- 使用者確認版本 `1.3.0`（minor：新增插件公開契約與安全邊界）。
