# Phase 19 — Update Radar 插件 MVP

日期：2026-10-27
分支：`feature/agent-updates-radar`
基準：`1d81c69`
Agent Pets 版本：`1.3.1`（未變更）
插件版本：`0.1.0`

## 完成摘要

本 Phase 以現有 Plugin Host API 完成 Update Radar 的最小端到端切片，未新增 preload、IPC、原生模組或外部導覽權限。插件會在啟動時讀取 OpenAI 官方 API changelog，建立安靜的首次基準，之後每小時檢查一次；只有新項目會進入 Agent Pets 通知中心。插件面板以繁體中文呈現最近 24 筆更新，並可手動要求重新整理。

目前刻意只納入 OpenAI API changelog，Anthropic、Claude Code、Codex、X 貼文與跨來源版本比較留待後續 Phase，避免同時擴張資料來源、解析規則與信任邊界。

## 驗收範圍

| 驗收項目 | 結果 |
| --- | --- |
| 合法 manifest 與封裝內容 | 通過；實際 `PluginRegistry.planInstallDirectory` 驗證成功 |
| 官方來源抓取 | 通過；從 `developers.openai.com` 取得 changelog 並解析 |
| 首次啟動 | 通過；儲存基準但不補發舊通知 |
| 後續更新 | 通過；只儲存與通知未看過的穩定 ID |
| 排程 | 通過；啟動同步後每 3,600 秒執行一次 |
| 私有儲存 | 通過；最多保留 24 筆卡片與 80 個已知 ID |
| 插件面板 | 通過；繁體中文、手動重新整理、無外部連結，沿用一般面板尺寸 |
| 降級行為 | 通過；網路或格式錯誤時保留既有快取 |

## 實作與信任邊界

- Worker 只使用既有 `api.net.fetch`、`api.storage`、`api.feed`、`api.schedule` 與 `api.ui` 能力。
- 網路 allowlist 固定為 `developers.openai.com`；解析器只讀固定 HTTPS changelog URL。
- 面板是沙箱化插件 UI，只使用 `window.agentPetsPlugin` bridge 與 `textContent`，不直接使用網路、`localStorage`、HTML 注入或新視窗。
- manifest 不指定插件專屬 `preferredSize`；Host 會沿用開啟前的一般面板尺寸，較長的更新列表在內容區捲動。
- 新更新通知沿用 Host 的通知驗證與官方固定來源 URL；面板本身不提供外部導覽，因此沒有擴張目前的外連安全邊界。
- 狀態資料由 Host 放在插件私有儲存，未寫入使用者文件或專案外部位置。
- 解析與分類採確定性規則，不需要 API key、X token 或付費 LLM 摘要。

## 驗證證據

### 自動化

| 指令 | 結果 |
| --- | --- |
| `pnpm test:unit` | 通過；455/455 |
| `cd update-radar && pnpm test` | 通過；32/32 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm exec vite build` | 通過；Renderer 與 Electron bundles 建置完成 |
| `pnpm check:bundle` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 通過；無已知漏洞 |
| `git diff --check` | 通過 |

新增的 Update Radar 測試涵蓋 manifest、正式 registry 安裝路徑、解析結果上限與穩定性、安靜基準、新項目通知、持久化去重，以及預設啟動排程。

完整測試期間也修正一個既有測試的跨版本 Node.js 符號連結清理方式：測試由 `rmSync` 改用 `unlinkSync`，產品程式碼未受影響。

### 官方資料與隔離 Electron

- 官方 changelog 實際回應 78,382 bytes；解析器產生上限內的 24 筆更新。
- 以隔離的 Electron user data 與 fake `safeStorage` 安裝、啟用插件；Worker 實際抓取並在私有 `storage.json` 儲存 24 筆資料，狀態為正常。
- 從寵物 renderer 透過既有 Host API 開啟插件面板；標題、同步狀態、24 張卡片與重新整理按鈕均正確顯示。
- 尺寸 follow-up 實測：一般插件設定頁為 460×720，開啟 Update Radar 後仍為 460×720；插件內容 viewport 為 423×455，長列表以內部捲動呈現，沒有水平溢位或插件專屬放大。
- 面板 DOM 外部連結數為 0；只暴露既有 feed、pet、storage、settings、log、net、ui bridge。
- 淺色與深色／高對比／減少動態效果皆完成實際 Electron 視覺檢查。初次檢查發現共享深色 token 在淺色 Canvas 對比不足，已改為沿用 Organic 淺色 token，並保留深色媒體查詢。
- 產出已簽章的 `update-radar-0.1.0.agentpet-plugin`；正式 registry 規劃安裝結果為成功，作者為 `benshih28`、簽章狀態為 valid、作者金鑰指紋為 `ffb643e57400dee3`。封裝共 6 個檔案、9,723 bytes，SHA-256 為 `faf67ff099acc3a3fe8cb1b49a61c4a37108033db3dc0dad274cbfe8eb69a329`。

### 安全檢查

- 插件來源掃描未發現私鑰 PEM、常見 GitHub／OpenAI／Slack／AWS token。
- Ed25519 私鑰只建立在專案外的使用者設定目錄，權限為 `0600`；套件與商店提交只包含公開金鑰和簽章，私鑰未加入 Git。
- 插件程式未使用裸 `fetch`、XHR、WebSocket、EventSource、`window.open`、`innerHTML`、`eval` 或 `localStorage`。
- `pnpm audit --prod --audit-level moderate` 無已知漏洞。
- `.claude/` 未修改。

## 殘餘風險與後續 Phase

- 目前只有 OpenAI API changelog；尚未納入 Anthropic、Claude Code、Codex 與 Tibo 的 X 貼文。
- 官方 Markdown 格式若改變，確定性解析器可能只能保留舊快取並顯示錯誤狀態，需要 fixture 與解析規則更新。
- 首次啟用刻意不通知歷史項目；使用者可在面板查看最近 24 筆，只有之後出現的新 ID 會通知。
- 面板目前不提供外部導覽；新項目的通知可沿用通知中心的官方連結。若要從面板直接開啟來源，應另開 Phase 設計受控的 Host external-open API，而不是讓 iframe 自行導覽。
- 手動重新整理的 Worker message 合約有自動化測試，啟動抓取與面板顯示已在實機驗證；因插件面板失焦即關閉，本 Phase 未另做滑鼠點擊的端到端自動化。
- macOS 隔離 Electron 已驗證；Windows 與 Linux 的實機視覺驗證尚未執行。

## 版本決策

本 Phase 沒有修改 Agent Pets Host 的公開合約、持久化 schema 或安全邊界，因此 Agent Pets 維持 `1.3.1`。Update Radar 是新的獨立插件，先以 `0.1.0` 表示預覽版。依專案規則，完成驗收與安全檢查後在此停止，等待使用者確認是否接受本 Phase；未經確認不調整 Agent Pets 版本，也不開始下一個來源整合 Phase。

## 插件商店提交 follow-up

已從 `Ponpon55837/agent-pets-plugins` 的 `main` 建立本機分支 `codex/update-radar-0.1.0`，加入已簽章套件與第一筆 `index.json` 目錄項目；正式 catalog parser、下載大小／SHA 驗證與插件簽章驗證均通過。本機提交為 `8a608d3`。直接推送被 GitHub 以 403 拒絕，因 `benshih28` 對商店倉庫沒有寫入權限；需先 fork 商店倉庫，再把這個分支推到 fork 並送 Pull Request。

本報告只記錄相對路徑與測試結果，不保存本機絕對路徑、主機名稱、環境變數值、個人資料、token 或鑰匙圈資料。
