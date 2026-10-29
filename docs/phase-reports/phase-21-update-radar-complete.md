# Phase 21 — 完整 Update Radar 插件

日期：2026-10-28  
分支：`feature/agent-updates-radar`  
基準 commit：`1d81c69`  
Agent Pets 版本：`1.3.1`（未變更）  
Update Radar 插件版本：`0.1.0`（未變更）

## 範圍與驗收條件

本 Phase 只完成 Update Radar 的完整來源與面板，不更動版本、不封裝發布，也不開始後續商店上架工作。驗收條件如下：

1. 在既有 OpenAI API 垂直切片上加入 OpenAI deprecations、Claude Platform release notes、Claude model deprecations、Claude Code GitHub releases 與 Tibo 公開頁。
2. 官方來源約每小時檢查，Tibo 約每 10 分鐘檢查；單一來源失敗不得清空其他來源或既有快取。
3. 每個來源獨立建立安靜基準與持久化去重；第一次啟用不把歷史資料當成新通知。
4. 失敗來源以有上限的退避策略自動重試，並在 UI 顯示狀態、快取與下次重試時間。
5. Tibo 只保留裝置時區中的當日原始貼文，以及作者與被回覆者皆為 `thsottiaux`、可追溯到原貼的自我回文；原貼與多層回文在同一區塊呈現。
6. 官方更新要顯示更新類型、變更類型、影響範圍、注意事項與可用的版本前後差異；保留來源語言，不加入付費 AI 翻譯／摘要。
7. 完整 UI 必須支援來源健康度、搜尋、供應商／類型／變更篩選、來源外開、窄版、鍵盤焦點、減少動態、提高對比與降低透明度。

## 實作結果

### 多來源收集與排程

- 插件現在宣告並固定使用六個來源：
  - OpenAI API changelog
  - OpenAI API deprecations
  - Claude Platform release notes
  - Claude model deprecations
  - Claude Code GitHub releases
  - Tibo `@thsottiaux` 公開 X 頁
- 以五分鐘 heartbeat 判斷到期來源；官方來源成功後下次到期為 60 分鐘，Tibo 為 10 分鐘。heartbeat 本身不代表每五分鐘都發出網路請求。
- 來源失敗依序在 5、15、30、60 分鐘後重試，之後維持 60 分鐘上限；每個來源的失敗次數、下次嘗試與最近成功時間都持久化。
- state 從 schema 1 遷移至 schema 2；舊 OpenAI 更新與 seen ID 會保留，新加入的來源各自先建立安靜基準。
- 去重 ID 使用正規化後的純文字內容；來源只調整 Markdown 空白時不會被當成新更新。
- 最多保留 160 筆更新與 400 個已知 ID。多於三筆的新內容會合併成一則通知，避免撞上預設通知速率；少量更新仍逐筆顯示來源與變更類型。

### Tibo 上下文

- 不登入 X、不使用 Developer App、token 或 X API 額度，只讀取固定公開頁 `x.com/thsottiaux` 與最多五個當日原貼的公開對話頁。
- 只接受數字 post ID、Tibo 對 Tibo 的回覆，以及能沿 reply chain 追溯到當日原貼的內容；他人回覆、Tibo 回覆他人、跨日內容與孤立 injected tweet 都會排除。
- 修正了第二層自我回文在特定 timeline 順序下可能提早停止迭代的情況；測試涵蓋 root → reply → second-level reply。
- UI 以時間軸、文字標籤、不同節點與回文底色，在同一張卡片凸顯原貼和自我回文差異。

### 更新判讀與版本比較

- 正規化欄位包含 `provider`、`product`、`category`、`changeType`、`effectiveAt`、`replacement`、`subjects` 與 `version`。
- 類型包含新模型、新功能、開發工具、API 變更；變更包含新增、改善、修正、棄用、移除。
- Claude Code release 會以同來源下一個較舊的不同版本建立 `previousVersion → version`；同版多則 release note 共用相同版本差異。
- 注意事項只使用明確欄位與關鍵字標示遷移、相容性、成本、限制、安全／合規；沒有訊號時顯示「未標示必要動作」，不假設沒有影響。

### 完整面板

- 頂部顯示更新總數、需留意數量與正常來源數。
- 來源區顯示六個來源的筆數、最近同步、快取／失敗狀態、下次重試與「立即重試」。
- 工具列可搜尋並依來源、更新類型與變更類型篩選；Tibo 任一回文符合篩選時仍保留整串上下文。
- 官方卡片顯示快速判讀、可展開原文、版本差異、生效日期與受控來源按鈕。
- 依 Liquid Glass 規則，只有黏附式工具列使用單層 functional glass；長列表與卡片維持 content layer，不使用 glass-on-glass。CSS 有 `focus-visible`、`prefers-reduced-motion`、`prefers-contrast` 與 `prefers-reduced-transparency` fallback。

## 信任邊界與安全檢查

本 Phase 沒有新增 preload、IPC 或 Host API；只擴充插件 manifest 對既有受控能力的精確宣告：

- 網路：`api.github.com`、`developers.openai.com`、`platform.claude.com`、`x.com`
- 外開：`developers.openai.com`、`github.com`、`platform.claude.com`、`x.com`
- 排程最低間隔：300 秒
- 私有 storage 與 feed 通知

安全結果：

- 遠端資料只經 `textContent` 進入 UI；沒有 `innerHTML`、`window.open`、頁面導覽、token、cookie 或 credential。
- 持久化資料重新載入時會驗證來源、長度、日期、類型、post ID、reply ID 與來源 URL；面板外開前再次驗證精確 HTTPS host/path。
- X 頁格式不符、被導向非預期內容或無法建立回文鏈時失敗關閉，不猜測內容關係；單一對話頁失敗不隱藏已確認的原貼。
- Host 既有網路邊界繼續提供公開 DNS 重驗、cookie 移除、2 MB 預設回應上限、15 秒 timeout、每分鐘 30 次預設上限與最多三次 redirect。
- 插件初次同步最多 11 個請求；平常 Tibo 每輪最多 6 個、官方到期每個 1 個，低於預設速率限制。
- 高可信秘密掃描未發現 AWS key、OpenAI-style key、GitHub token 或私鑰；`.claude/` 未修改。
- `pnpm audit --prod --audit-level moderate`：無已知漏洞。
- `git diff --check`：通過。

## 自動化與建置證據

| 檢查 | 結果 |
|---|---|
| Update Radar 插件 targeted tests | 8/8 通過 |
| `cd update-radar && pnpm test` | 32/32 通過 |
| `pnpm test:unit` | 468/468 通過 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm exec vite build` | 通過；Renderer、Main 與三個 preload bundles 完成 |
| `pnpm check:bundle` | 通過；共享 panel tokens 已打包 |
| `pnpm audit --prod --audit-level moderate` | 通過；無已知漏洞 |
| 語法檢查 | `core.js`、`main.js`、`panel.js` 通過 |

真實公開來源一次收集結果為 160 筆，六個來源成功、stale 0、error 0。固定視覺 fixture 在 920px 與 320px 都滿足 `scrollWidth === clientWidth`；顯示 6 個來源列、1 個 Tibo thread，並正確顯示 `v2.0.0 → v2.1.0`。

## 隔離 Electron 驗收

- 只使用 `scripts/e2e-isolated-electron.mjs`；收到 `AGENT_PETS_E2E_READY`，`fakeSafeStorage: true`，HOME 與 userData 均位於臨時目錄。
- 正式安裝計畫列出四個 network host、四個 links host、schedule、storage、feed 與 panelView；安裝後 granted snapshot 完全一致。
- 第一次啟用曾出現與 Phase 20 相同的隔離環境瞬時 `host_unavailable`；同一隔離環境重新啟用後成功，未再重現。
- 真實插件面板同步 160 筆，來源為 OpenAI API 48、OpenAI deprecations 14、Claude Platform 48、Claude Models 2、Claude Code 48、Tibo 0，健康度 6/6。Tibo 0 表示驗收當天當下沒有符合的公開貼文，不是來源失敗。
- 面板 viewport 為 423×455，document/client width 同為 408，沒有水平溢位；實際 Claude Code 資料顯示 `v2.1.311 → v2.1.312`。
- 以真實 DOM 點擊第一個「查看官方來源」後，fake shell 只記錄一筆 `https://github.com/anthropics/claude-code/releases/tag/v2.1.312`；按鈕狀態顯示「已交給系統瀏覽器」。
- fake safeStorage 起始／結束皆為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`；外開由 fake shell 攔截，未碰觸真實 Keychain 或瀏覽器。

## 殘餘風險

- X 公開 HTML 不是穩定 API；匿名存取政策、HTML class 或 streamed payload 格式改變時，Tibo 來源會進入 stale/error 並需要更新解析器。
- 實機驗收當下 Tibo 沒有當日貼文，因此真實 Electron 沒有 live thread 可顯示；root／多層 self-reply 由 deterministic parser test 與 320px／920px 面板 fixture 驗證。
- 全域 160 筆上限偏向最新內容，來源健康區顯示的是截斷後實際可見筆數；舊的低頻來源項目可能先被淘汰。
- Windows／Linux 的實際面板與系統瀏覽器尚未驗證；本次 macOS 外開使用 fake shell。
- 首次啟用的隔離 `host_unavailable` 與 Phase 20 相同，重新啟用可恢復；若在一般環境重現，應另開 Host startup 穩定性 phase，不在插件內繞過 crash policy。

## 版本建議與停止點

本 Phase 對 Update Radar 引入多來源、持久化 schema 2、排程／重試與完整 UI，建議插件從 `0.1.0` 升至 `0.2.0`。同一工作樹中的 Phase 20 已新增公開 `links.openExternal()` 安全邊界，Agent Pets 仍建議從 `1.3.1` 升至 `1.4.0`。

依專案規則，本 Phase 已完成功能、視覺、安全與實機驗收，但尚未修改任何版本。等待使用者確認後，才同步更新 `package.json`／`pnpm-lock.yaml` 與插件 manifest 版本，並重新執行版本後驗證。

## 後續：與 Agent Pets `1.4.1` 同步（2026-10-29）

- Phase 20（`links.openExternal()`，`1.4.0`）、面板縮放與記憶體修正（`1.3.2`）已由上游 PR #17、#18 合併；本分支改為合併上游 `main`（`1.4.1`），工作樹只保留 Update Radar 插件、測試與文件。
- `1.4.1` 起 Plugin Host 記憶體改以「host 載入完成、Worker 啟動前的自身用量」為基準，只比較增長量，預算為每插件 64 MB（預設）× 啟用數，連續兩次超標才重啟；`1.3.2` 的 192 MB 固定額度已移除。
- 隔離 Electron（macOS，只啟用 Update Radar，含首次六來源同步）觀察 180 秒：host working set 第一次取樣 95 MB、峰值 102 MB、之後穩定在約 81 MB；最大增長約 7 MB（即使以空載約 80 MB 估算基準也低於 25 MB），遠低於 64 MB 預算。host 0 次重啟，插件維持 `enabled`。
- `pnpm test:unit`：495 個測試 494 通過；唯一失敗為既有的 `plugin-developer-mode` 檔案監看時序測試，單獨重跑通過。
- 使用 `permissions.links` 的 Update Radar 需要 Agent Pets `1.4.0` 以上；送進插件目錄時應註明。
- 插件版本升為 `0.2.0`，以 `update-radar/scripts/pack-plugin.mts` 打包並簽章（指紋 `ffb643e57400dee3`，34,928 bytes，SHA-256 `e28124421d2effd7c674e3ab8788d14e00ad23aa904fa9537094f8bd151ca544`）。腳本以 Agent Pets 的簽章驗證與安裝規劃檢查成品，並固定 zip 時間戳，任何時區都能重現相同位元組。
- 已上架 `Ponpon55837/agent-pets-plugins`（PR #1，`19f779c`）；從正式 raw 網址下載的套件大小與 SHA-256 均與 `index.json` 相符。0.1.0 從未發布，目錄只列 0.2.0。
