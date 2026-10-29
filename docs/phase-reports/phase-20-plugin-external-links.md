# Phase 20 — 插件受控外部連結

日期：2026-10-29
分支：`feat/plugin-external-links`（基準 `main` 0d02a21）
Agent Pets 版本：`1.3.2` → `1.4.0`

## 完成摘要

本 Phase 新增只限面板使用的 `window.agentPetsPlugin.links.openExternal(url)` Host API，讓插件面板在使用者明確操作後，把 manifest 已宣告的 HTTPS 網址交給系統預設瀏覽器。能力沿用既有 `plugin-panel-api` IPC，但另有獨立的 Main controller，並完成 manifest 權限、安裝／更新重新同意、IPC sender 綁定、可信任使用者操作、URL／網域驗證、速率限制、公開型別與雙語文件。

插件面板仍不能自行導覽、`window.open`、取得 Electron `shell` 或讀取瀏覽器回應。

## 驗收範圍

| 驗收項目 | 結果 |
| --- | --- |
| manifest 權限 | `permissions.links.hosts` 只接受 1–20 個精確的公開 DNS host，不接受 wildcard／IP／localhost／scheme／path／port |
| 使用者操作 | preload 只接受 `isTrusted` 的 click 或 Enter／Space，最多保留 1 秒且只消耗一次；鍵盤操作後續的 click 不會重複核發，插件 API 不接受自行傳入 activation |
| IPC 身分 | 只有目前 active panel 的 main frame 與 WebContents 可進入既有 `plugin-panel-api`；plugin id 由 Main 綁定 |
| URL 驗證 | 只接受 HTTPS、無帳密、無自訂 port、非 IP，且 hostname 必須符合目前 manifest 的 exact-host allowlist |
| 速率 | 每插件每 60 秒最多 5 次有效嘗試；交給系統瀏覽器後即使失敗仍計次 |
| 權限同意 | 安裝畫面顯示「在瀏覽器開啟 {host}」；更新時新增 host 會列為新增權限並要求重新同意 |

## 安全檢查

- 程式化呼叫、未宣告權限、插件停用、HTTP、帳密 URL、自訂 port、子網域、IP、未列網域與超過速率皆有負面測試。
- `shell.openExternal` 只存在 Main 注入邊界；panel preload 不暴露 `shell`、任意 IPC 或 plugin id。
- URL 驗證重用既有 `validatePluginNetUrl`，但 `permissions.links` 額外禁止 wildcard，避免宣告一個父網域即可外開任意子網域。
- 無效 URL 與缺少可信任操作在計次前拒絕；有效請求在呼叫 shell 前計次，防止失敗重試轟炸。
- 面板繼續由 session/CSP 阻擋直接連網、外部資源、導覽、彈窗、下載、權限與拖放。
- `pnpm audit --prod --audit-level moderate`：無已知漏洞。
- 背景 Worker（Plugin Host）的 broker 與 host bridge 沒有 `links` 方法，只有面板可用。
- 面板公開 API 為凍結物件，內部通用 `invoke` 不對外暴露；使用者操作旗標由 preload 判斷後附加，插件無法自行傳入。
- `.claude/` 未修改。

詳細信任邊界與殘餘風險見 [`plugin-external-links-threat-model.md`](../security/plugin-external-links-threat-model.md)。

## 驗證證據

### 自動化

| 指令 | 結果 |
| --- | --- |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 460/460 通過（`plugin-developer-mode` 檔案監看測試偶發時序失敗，重跑即通過，與本 Phase 無關） |
| `pnpm exec vite build`、`node scripts/check-plugin-panel-tokens-bundle.mjs` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無已知漏洞 |
| `git diff --check` | 通過 |

### 隔離 Electron

以 `scripts/e2e-isolated-electron.mjs` 啟動本分支建置，安裝一個只宣告 `links.hosts: ["example.com"]` 的最小測試插件（面板有「開啟 example.com」與「開啟未宣告網域」兩個按鈕），結果：

| 情境 | 結果 |
| --- | --- |
| 安裝計畫 | 列出 `links: example.com` |
| 頁面程式化呼叫 `links.openExternal()` | `denied` |
| 合成 click（`element.click()`，`isTrusted=false`） | `denied` |
| 真實滑鼠點擊已宣告網域 | 成功；fake shell 收到 `https://example.com/` |
| 真實滑鼠點擊未宣告網域 | `host_not_allowed` |
| `shell.openExternal` 實際呼叫 | 只有 1 次（`https://example.com/`） |

測試用的 shell 由隔離啟動器攔截，未開啟真實瀏覽器；也觀察到面板 CSP 會擋下行內樣式，面板既有限制維持有效。

## 殘餘風險

- Host 能證明近期有可信任使用者操作，但不能證明使用者點擊的是插件 DOM 中哪一個元素；不受信任插件可把內容區內任一可信任操作用於開啟已同意 host。精確 host、一次性一秒期限、安裝揭露與每分鐘 5 次上限共同限制此風險。
- Agent Pets 只驗證交給系統瀏覽器的初始 URL；網站後續 redirect、登入狀態與內容不在宿主控制範圍。
- Windows／Linux 的實際系統瀏覽器行為尚未驗證；本次 macOS 測試使用隔離啟動器的 fake shell，刻意不開真實網站。
- 速率限制器在插件停用時不會清除；限制本身是每分鐘滑動窗口，項目數不超過已安裝插件數，不影響安全或功能。

## 版本決策

新增公開 Host API、manifest 權限與安全邊界，依專案規則升為 minor：`1.3.2` → `1.4.0`。

使用此能力的插件（例如 Update Radar）需要 Agent Pets `1.4.0` 以上；舊版會因不認得 `permissions.links` 而拒絕安裝。
