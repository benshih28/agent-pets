# Phase 14 驗收報告：插件網路、密鑰、設定、排程與 Agent 狀態

- 日期：2026-10-23
- 目前版本：`1.2.4`（未修改）
- 階段狀態：P14.1–P14.6 實作及複檢修正均完成；N1–N6 的最新檢查、Electron 實測與安全結果見本文「複檢修正」。真實 macOS Keychain 與真實 Agent adapter 仍未驗證。
- 建議版本：`1.3.0`（Phase 12–16 整體 minor 建議；本階段不改版）
- 分支：`feat/plugin-host`
- `origin/main`：`package.json` 的 Vue 為 `^3.5.44`。`git merge origin/main` 回報 `Already up to date`；主線已在本分支祖先中，沒有新增 merge commit，也沒有合併到 main。

## 範圍與結果

完成 P14.1–P14.6：插件網路代理與逐跳 URL／DNS／IP 檢查、執行時網域申請、密鑰與非密鑰設定儲存、排程與 Agent 狀態 API、每插件偏好與資源上限、開發者資料夾載入與自動重載，以及雙語第三方開發者文件、JSON Schema、TypeScript declarations 和範例。`net.fetch` 及其他新 Host API 維持成功直接回傳值、失敗丟出帶 `code` 的 Error。

P14.6 收尾修正兩項實測發現：bootstrap 不再把選填的 `undefined` 序列化進 `pet.react`／`net.fetch` RPC；入門教學改把套件輸出到監看資料夾的上一層，避免開發者監看器把套件本身當作來源變更。新增對應測試。未執行 `pnpm build`，未改版本、runtime dependency 或 `.claude/`。

## Checkpoint

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P14.1 | HTTPS 網路代理、host/DNS/IP 安全檢查、redirect 與大小／逾時／速率限制 | `aa56c0f8ef3f80fb725848919db9c6765a849707` | §0.4 通過；單元測試 240/240；已推送 |
| P14.2 | `net.requestHost` 同意、拒絕冷卻、申請限流與撤銷 | `0b5a6b35e12399eb94eff4c373e6c2683f2722c1` | §0.4 通過；單元測試 246/246；已推送 |
| P14.3 | `safeStorage` 密鑰服務與 settings schema／表單 | `65968214a23bd788f6c5583a2a78b6df5e1ede17` | §0.4 通過；單元測試 254/254；已推送 |
| P14.4 | `schedule.every`、`pet.status`／`onStatusChange` 及安全狀態投影 | `796926aab5135b3771ace75829f72d0d9f028574`、`b679a7d5f2acc61560f2ba4a2a1b6f2f2296b06a` | §0.4 通過；最後一個 checkpoint 單元測試 260/260；已推送 |
| P14.5 | 每插件通知偏好、授權網域、寵物目標與進階資源上限 | `00cbf90b6ba6179b27199db4f87b8142805afe48` | §0.4 通過；單元測試 260/260；已推送 |
| P14.6 | 開發者模式、雙語文件與範例；選填 RPC 參數及打包教學修正 | `554d27d1fd98d259e030024984a128416257b416`、`63e961386759b7d4d97860909d7d6768aafced64`；驗收報告隨最終 checkpoint commit 推送 | 最終 §0.4 通過；單元測試 270/270；已推送 |

P14.4 有兩個依序推送的 commit，用於補齊淨化狀態中的 Agent family。P14.6 最終報告 commit 的 SHA 由 Git HEAD／最終回報提供，避免在報告內自我引用。

## §0.4 檢查結果

| 最終 P14.6 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 通過，270/270；0 失敗、0 略過 |
| `pnpm exec vite build` | 通過；renderer、Electron main、preload 與 plugin-host preload 均建置成功 |
| `git diff --check` | 通過 |

P14.1–P14.6 各 checkpoint 均依序通過相同四項檢查後才 commit、push。最終 P14.6 修正 commit `63e9613` 的完整檢查結果如上。沒有執行 `pnpm build`。

## Phase 14 驗收條件

| 驗收條件 | 結果 | 證據與限制 |
|---|---|---|
| manifest host 與逐跳 redirect | 複檢隔離 Electron 通過 | httpbin.org 的絕對／相對 redirect 成功；localtest.me、169.254.169.254 與未宣告網域目標均遭拒；跨來源後 Authorization 已移除。原始 P14.6 的未驗證狀態由複檢結果更新。 |
| `requestHost` 確認、拒絕冷卻、申請速率與撤銷 | Host API 邏輯通過隔離 Electron 驗證；確認框視覺操作未驗證 | 對話框回應以 CDP stub 分別模擬允許與拒絕。拒絕 `example.com` 後再次申請回 `denied`；兩個公開網域成功加入 `grantedHosts`；同一插件第 4 次申請回 `rate_limited`；面板將授權清單設為空後確認已撤銷。 |
| 密鑰保護、設定通知與無密鑰行為 | fake safeStorage 的隔離 Electron 及單元測試通過；真實 Keychain 未觸碰 | secret-only 儲存觸發只含非密鑰欄位的 settings.onChange；無密鑰啟動、面板與設定快照時 safeStorage 呼叫數均為 0。真實 macOS Keychain 加密仍未驗證。 |
| `onStatusChange` 接收 Codex／Claude 狀態變更且只含規定欄位 | 部分隔離 Electron 驗證；真實 Agent adapter 未驗證 | 寵物視窗透過現有 Presentation 投影管線注入 `agentFamily: 'claude-code'` 狀態變更；插件收到事件，欄位為 `agentFamily, at, dnd, name, petId, previousState, visibleState`。這是隔離注入，不是真實 Codex／Claude 程序事件。純模組測試確認 status object 欄位集合。 |
| 開發者模式資料夾載入與自動重載 | 隔離 Electron 通過 | 開啟開發者模式，載入 `hello-feed` 資料夾，寵物 DOM 出現 `Hello Feed` 泡泡；修改來源後 watcher 重新載入插件。 |
| 依入門教學從零建立插件，在隔離 Electron 載入並看到泡泡；打包並安裝 | 隔離 Electron 通過 | 建立 `plugin.json` 與 `dist/main.js`、資料夾載入並看到泡泡、編輯來源觸發自動重載。依修正後命令在來源資料夾內執行 `zip -r ../hello-feed.agentpet-plugin plugin.json dist/`，輸出檔列出三個預期項目；面板 `selectPluginArchive()` 回傳安裝計畫，`installPluginPlan()` 成功安裝。 |
| Storage、settings、schedule Host API | 隔離 Electron 通過（settings change callback 僅有自動測試） | 插件 log 確認 storage 寫入／讀回 `{found:true,value:"roundtrip"}`、settings 預設值 `{"mode":"safe"}`；等待使用者偏好最短 60 秒後觀察到 `schedule-fired`。settings 表單變更通知另由單元測試覆蓋。 |

## Electron 實機驗證

原始 P14.6 Electron 驗收記錄如下；本次複檢另使用主程序預載 hook 將 app userData 明確指向新的暫存目錄，並在插件啟用前確認 safeStorage 假實作。

| 實測項目 | 步驟與觀察結果 |
|---|---|
| 教學資料夾載入與通知泡泡 | 面板選取 `hello-feed` 開發資料夾並啟用；寵物視窗 `.plugin-feed-toast` 顯示 `Hello Feed`、`P14 Electron smoke` 與通知內文，並觀察到 `onPluginFeedItem`。 |
| 開發者 watcher | 修改暫存插件來源後，診斷記錄顯示重新 activate；面板快照標示 `development: true`。 |
| 教學 archive 安裝 | 從來源目錄依文件命令輸出到上一層；archive chooser 回傳 `kind: reinstall` 安裝計畫，確認後面板回傳安裝成功、`development: false`。 |
| net.fetch 攻擊面 | 原始驗收未驗證外部 redirect source；本次複檢以真實 httpbin source 完成逐跳檢查，結果見「複檢修正」。 |
| `requestHost` | 使用暫存插件逐項呼叫；以 CDP 對話框 stub 回應拒絕／同意。診斷顯示拒絕、24 小時同 host 冷卻、每 10 分鐘三次上限；面板快照先顯示已授權 `api.github.com` 與 `www.iana.org`，撤銷後清單為空。 |
| Storage 與 settings | API smoke log 顯示 storage round-trip 成功及 settings 預設值 `mode: safe`。 |
| 排程 | manifest 最短間隔為 30 秒、使用者偏好為 60 秒；隔離 Electron 等候後診斷 log 出現 `schedule-fired`。 |
| Agent 狀態 | 從隔離寵物視窗發布一筆 `claude-code` Presentation snapshot；插件收到 `onStatusChange`，log 中欄位名稱符合 allowlist。只驗證注入快照，不代表真實 Agent integration。 |
| 密鑰 | 本次複檢以隔離 fake safeStorage 驗證無密鑰計數、面板同意說明、合成值讀回及非密鑰 callback；真實 Keychain 未呼叫。 |

## 安全檢查

- `pnpm audit --prod --audit-level moderate`：通過，`No known vulnerabilities found`。
- Secret／個資模式掃描：本次掃描 Phase 12 起至複檢工作樹的新增內容；私鑰、GitHub／OpenAI／Slack token、AWS key、Google API key、本機使用者路徑與非保留網域 email 均為 0。email-like 命中僅為保留 example 網域測試佔位值；未發現個人聯絡資料或符合憑證模式的值。
- IPC／最小權限：新 API 透過已驗證插件身分的 Host RPC；面板設定 IPC 綁定可信任面板 sender，並對插件 id、網域、設定 patch 與輸入長度執行執行期驗證。單元測試涵蓋未授權 API、錯誤 payload 與 status 欄位。
- 網路邊界：只允許 HTTPS、無帳密及空／443 port；manifest／使用者授權網域比對後，每一 redirect 重新檢查 URL、host 與 DNS；解析結果含 loopback、私有、link-local、CGNAT、multicast 與 IPv4-mapped IPv6 即拒絕。仍保留 handoff 指定的 DNS 檢查與實際連線之間時間差風險。
- 檔案／密鑰／設定：插件資料檔案拒絕 symlink 與非一般檔；偏好和 settings 測試涵蓋安全路徑、原子寫入、大小界限及 schema 驗證。fake safeStorage 的密鑰實機與無密鑰計數已驗證；真實 macOS Keychain 未驗證。
- 通知與 UI：插件文字以純文字呈現，設定與診斷不回傳密鑰原值；回歸測試涵蓋選填 RPC 參數避免 `undefined` 進入 JSON message。
- 版本／依賴：`package.json` 仍是 `1.2.4`；未新增 runtime dependency，未改 `.claude/`，沒有執行 `pnpm build`。

## 手動驗收步驟

以下步驟可在 macOS 專案目錄照做；每一步列出預期結果。使用獨立暫存 HOME 與 user-data，不指向已安裝 App 的資料目錄。

1. 依 §0.4a 建立暫存資料夾，啟動 Electron 並從 9348／9349 連接各 CDP target。預期主程序、面板及寵物 target 可回應，任何既有 App 埠衝突只顯示 handoff 註明的訊息。
2. 開啟插件面板的開發者模式，選取 `docs/plugins/examples/hello-feed`。預期面板顯示「開發中」，寵物顯示 Hello Feed 通知泡泡。修改 `dist/main.js` 的通知文字並儲存，預期 watcher 自動重載並顯示新文字。
3. 在 `hello-feed` 目錄執行 `zip -r ../hello-feed.agentpet-plugin plugin.json dist/`。預期 archive 位於來源資料夾上一層且僅含 `plugin.json` 與 `dist/main.js`；在面板選取並確認，預期安裝成功且 development badge 消失。
4. 以 `node scripts/pack-test-plugin.mjs evil-network /tmp/evil-network.agentpet-plugin` 建立網路 fixture，安裝後檢查插件診斷。預期 manifest host 連線取得 HTTP response；未宣告 host、HTTP、IP、localhost、私有網段與 redirect 私有目標均回 `host_not_allowed`。
5. 使用 manifest 宣告 `network.userGranted: true` 的測試插件呼叫 `net.requestHost`。預期允許後網域出現在面板清單；拒絕後同網域冷卻期內回 `denied`；10 分鐘內第 4 次新網域申請回 `rate_limited`；撤銷後對該網域的 fetch 回 `host_not_allowed`。Native 對話框需在隔離環境以允許／拒絕按鈕操作。
6. 使用非密鑰 settings 欄位變更 repository 值並儲存。預期表單使用 schema 的預設值，Worker 收到 `settings.onChange`；此步不輸入或讀寫任何密鑰，也不操作個人密碼鑰匙圈。
7. 啟用有 `agentStatus` 權限的測試插件，透過真實 Codex／Claude 狀態來源切換 idle／busy。預期 callback 僅含 `petId`、`name`、`agentFamily`、`previousState`、`visibleState`、`dnd`、`at`；狀態變化按 1 秒合併。
8. 設定 `schedule.every(60, ...)`，等待一分鐘。預期診斷出現一次 schedule callback；停用插件後不再有 callback。

## 複檢修正

依 docs/reviews/phase-14-review.md 完成 N1–N6。下方結果更新並取代前文原始 P14.6 驗收時，對 redirect source 與密鑰行為所記錄的未驗證狀態。

| 項目 | 修正內容 | Commit SHA | 新增或更新的測試 |
|---|---|---|---|
| N1 | 改用 Electron net.request 與手動逐跳 redirect；每跳檢查 URL、白名單、DNS/IP；跨來源移除 Authorization 與 x-api-key；最多 3 次。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-net.test.mts：逐跳 DNS/私有目標、跨來源憑證移除；隔離 Electron 真實 httpbin redirect。 |
| N2 | 禁用 Session cookies、過濾 Set-Cookie、移除 Accept-Language，使用固定 User-Agent。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-net.test.mts：Cookie 回應與請求標頭過濾；隔離 Electron cookie store 與端點測試。 |
| N3 | 密鑰新增、更新、清除後均發送僅含非密鑰欄位的 settings snapshot。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-settings.test.mts：secret-only 更新只發布非密鑰設定；隔離 Electron callback 驗證。 |
| N4 | 首次儲存前顯示繁中／英文一次性說明；無非空密鑰時不呼叫 safeStorage。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-settings.test.mts：無密鑰呼叫數、同意檔與 symlink；隔離 Electron inspector 與面板確認框。 |
| N5 | 補上 IPv4 特殊用途網段與 IPv6 NAT64、6to4、文件位址和 discard-only 網段，並檢查內嵌 IPv4。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-net.test.mts：擴充 IPv4/IPv6 黑名單和 NAT64/6to4 位址案例。 |
| N6 | 修正 redirect 次數、cookie、settings callback、密鑰同意與 DNS rebinding 文件。 | 732a58e7f54527fd7c75d1c6b2ee36b2ce566975 | tests/plugin-public-docs.test.mts：比對 redirect、cookie、callback、DNS rebinding 文件與實作。 |

### 最終檢查與安全掃描

| 檢查 | 實際結果 |
|---|---|
| pnpm exec vue-tsc --noEmit | 通過 |
| pnpm test:unit | 通過，276/276；0 失敗、0 略過 |
| pnpm exec vite build | 通過；renderer、Electron main、preload、plugin-host preload 均建置成功 |
| git diff --check | 通過 |
| pnpm audit --prod --audit-level moderate | 通過，No known vulnerabilities found |
| Phase 12 起新增內容 secret／個資模式掃描 | 私鑰、GitHub/OpenAI/Slack token、AWS key、Google API key、本機使用者路徑、非保留網域 email 均為 0；email-like 命中僅為保留 example 網域測試佔位值 |

### Electron 實機驗證（§0.4a）

- 在全新暫存 HOME 與 userData 啟動 Electron。由主程序預載 hook 在應用程式初始化前將 app userData 明確設為暫存目錄，並把 safeStorage 三個方法換成可逆假實作。Inspector 確認 userData 路徑隔離、三個函式原始碼為假實作後才啟用測試插件；原生 safeStorage 未被呼叫，沒有觸發或存取使用者 Keychain。
- N1 使用實際 httpbin.org 回應，不使用假的 fetch 或注入 redirect：/redirect/1 與 /relative-redirect/1 均回 200；轉址至 localtest.me、169.254.169.254 及未宣告網域均回 host_not_allowed；跨來源轉址回 200，目標端回應沒有 Authorization。
- N2 先呼叫 response-headers 設定合成 Set-Cookie，再讀 /cookies，cookie 數為 0；/headers 沒有 Cookie。plugin-network Session cookie store 為空；回應中的 User-Agent 固定為 AgentPetsPlugin/1，沒有 Accept-Language。
- N3 在隔離插件中只設定合成密鑰後，settings.onChange 有觸發；插件 callback 不含合成密鑰，並能重新讀到已設定狀態。假 safeStorage 計數為 isEncryptionAvailable 2、encryptString 1、decryptString 1。
- N4 在另一個沒有密鑰的全新暫存 profile，啟動、開啟面板、讀面板快照及 getPluginSettings 後，isEncryptionAvailable、encryptString、decryptString 均為 0。面板輸入合成值按儲存後先顯示一次性說明；尚未確認時呼叫數仍為 0。真實 Keychain 未驗證且未觸碰。
- N5 的新增特殊用途網段由單元測試驗證；DNS rebinding 時間差仍是已知殘餘風險。
- N6 由文件一致性測試與上述真實 redirect、cookie 結果核對文件與行為。

### 可直接照做的複檢步驟

1. 執行 pnpm exec vite build；建立暫存資料夾並建立 home 與 userData 子資料夾。啟動隔離 Electron，於主程序初始化前把 app userData 指向暫存 userData。
2. 在主程序以 inspector 把 safeStorage.isEncryptionAvailable、encryptString、decryptString 換成 §0.4a 第 8 步的可逆假實作。先核對函式原始碼與 app.getPath('userData')；確認後才安裝或啟用宣告 secrets 的插件。預期原生 Keychain 沒有被呼叫。
3. 安裝測試插件，manifest 宣告 httpbin.org、httpbingo.org、localtest.me 及 probeToken。呼叫 /redirect/1、/relative-redirect/1、redirect-to localtest.me、redirect-to 169.254.169.254、redirect-to 未宣告網域及跨來源 Authorization 案例。預期前兩項 200，三種不允許目標均回 host_not_allowed，跨來源不含 Authorization。
4. 呼叫 response-headers?Set-Cookie=leak%3D1，再依序呼叫 /cookies 與 /headers。預期 cookies 為空、請求沒有 Cookie、Session cookie store 為空。
5. 使用沒有密鑰的全新 userData，記錄 fake safeStorage 計數；啟動、開啟插件面板、讀面板與設定快照後三個方法都應為 0。輸入合成密鑰並按儲存，預期先顯示雙語一次性說明；只在假實作下確認與保存，並核對 secret-only callback 不含密鑰。
6. 執行 pnpm test:unit、pnpm exec vue-tsc --noEmit、pnpm exec vite build、git diff --check、pnpm audit --prod --audit-level moderate 及 Phase 12 起新增內容 secret pattern 掃描。預期四項檢查通過、audit 無弱點，憑證模式與本機路徑掃描無命中。

## 殘餘風險與待決問題

1. 依使用者要求，真實 macOS Keychain 行為未驗證且本次完全未觸碰；密鑰流程只在可逆假 safeStorage 下測試，正式版首次使用仍需使用者手動確認系統提示。
2. 真實 Codex／Claude adapter 狀態更新未驗證；目前 Electron 驗收使用隔離 Presentation 狀態投影，欄位 allowlist 由單元測試覆蓋。
3. requestHost 原生確認框的畫面與實際滑鼠操作未驗證；允許／拒絕、冷卻、限流、授權與撤銷由 CDP 驅動的隔離測試驗證。
4. DNS 查詢與實際連線之間仍有 DNS rebinding 時間差；HTTPS-only、443、TLS 憑證驗證及逐跳檢查降低風險，但不能完全消除。
