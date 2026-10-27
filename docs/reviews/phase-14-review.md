# Phase 14 複檢與修正清單

- 複檢對象：`feat/plugin-host` 的 `fbf4c57..5fb73a4`（P14.1–P14.6）
- 複檢日期：2026-10-23
- 結論：**需要修正後才能進入 Phase 15**。網域白名單、IP 黑名單、`requestHost`、密鑰儲存、Agent 狀態事件、排程下限與開發者文件都已到位；但真實 Electron 中 **所有轉址都失敗**（N1），而且 **cookie 會被保存並在插件之間共用**（N2）。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 270/270 通過 |
| `pnpm exec vite build` | 通過 |
| `git diff --check` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |

### Electron 實機驗收方式

以隔離環境啟動 `5fb73a4` 的 build（`HOME`、`--user-data-dir` 皆為暫存資料夾）。**依交接 §0.4a 第 8 步，先以假的可逆實作取代 `safeStorage`（並以函式原始碼確認替換成功）**，再安裝自製的 `probe-net` 探測插件（manifest hosts：`httpbin.org`、`localtest.me`、`127.0.0.1.nip.io`；`userGranted`、`secrets`、`agentStatus`、`schedule`）。`dialog.showMessageBox` 以回傳「允許」的假實作取代。

> 複檢第一次執行時尚未替換 `safeStorage`，導致開發版 Electron 觸發使用者的 macOS 鑰匙圈存取視窗。已立即停止並補上 §0.4a 第 8 步；之後的所有結果都是在替換後取得。

| 項目 | 結果 |
|---|---|
| `https://httpbin.org/get`（manifest host） | 200 ✅ |
| `http://`、未宣告網域、IP literal | `host_not_allowed` ✅ |
| `localtest.me`、`127.0.0.1.nip.io`（DNS 解析為 127.0.0.1） | `host_not_allowed` ✅ |
| `httpbin.org/redirect/1`（同網域轉址） | **`invalid_request`** ❌（N1） |
| `httpbin.org/relative-redirect/1` | **`invalid_request`** ❌（N1） |
| 轉址到 `localtest.me`／`169.254.169.254` | `invalid_request`（因 N1 一律失敗，未能驗證逐跳檢查） |
| `response-headers?Set-Cookie=leak=1` 後讀 `/cookies` | **回傳 `{"cookies":{"leak":"1"}}`；`/headers` 顯示請求帶了 `Cookie`** ❌（N2） |
| `requestHost('example.org')` → 允許 → fetch | 授權成功、fetch 200 ✅ |
| 面板 `setPluginSecret` → `secrets.get` | 檔案內為密文、讀回原值 ✅（以假 `safeStorage`） |
| 只儲存密鑰時 `settings.onChange` | **沒有觸發**，插件要等下次啟動才知道已設定（N3） |
| `pet.onStatusChange` | 送出 thinking／idle 事件後收到兩次變化，欄位恰為 `petId,name,agentFamily(claude-code),previousState,visibleState,dnd,at` ✅ |
| `schedule.every(1)` | 70 秒內只觸發 1 次（被拉高到 60 秒下限）✅ |

## 修正清單（給 Codex）

修完後依交接 §0.4、§0.4a（**含第 8 步：先替換 `safeStorage`，絕不可觸發鑰匙圈**）、§0.4b 驗證。commit 訊息用 `fix(plugin): [P14.R] ...`，最後一個 commit 加 `Checkpoint: P14.R`，push，更新 Phase 14 的同一筆工作記錄與 phase report（新增「複檢修正」一節）。修完後停止回報，不要開始 Phase 15。

### N1（高）真實 Electron 中所有轉址都失敗

- 位置：`electron/plugin-net.ts` 與 `main.ts` 注入的 `session.fromPartition('plugin-network').fetch`。
- 問題：Chromium 的 `session.fetch` 在 `redirect: 'manual'` 下不會回傳帶 `Location` 的 3xx（得到 opaque redirect 或拋錯），所以連同網域、相對路徑的轉址都回 `invalid_request`。單元測試用的是假的 `fetch`，phase report 的「注入 302」也不是真實 Chromium 行為，所以沒發現。很多 API（包括 GitHub）會用轉址，這會讓插件無法正常使用。
- 修正：改用 Electron `net.request`（指定插件專用的 session、`redirect: 'manual'`、`useSessionCookies: false`）。收到 `redirect` 事件時：
  1. 用與第一跳相同的規則檢查新網址（https、443、白名單、DNS 不得落在黑名單）；
  2. 通過就 **中止目前請求、自己以新網址發新請求**（這樣才能在跨來源時移除 `authorization`、`x-api-key`，並處理 303／POST→GET），不要直接 `followRedirect()`；
  3. 最多 3 次，超過回 `too_many_redirects`。
  逾時、大小上限、串流讀取維持現有行為。
- 驗收：**在隔離 Electron 中對 `httpbin.org` 實測**：`/redirect/1`、`/relative-redirect/1` 成功；`/redirect-to?url=https://localtest.me/`、`/redirect-to?url=http://169.254.169.254/`、轉址到未宣告網域都被擋；跨來源轉址後 `/headers` 看不到 `Authorization`。若執行環境連不到 `httpbin.org`，改在 Main 以 `node:https` 在暫存資料夾起一個本機 HTTPS 轉址伺服器（自簽憑證並僅在測試 session 信任），不得用假的 fetch 代替。

### N2（高）cookie 被保存並自動送出，所有插件共用

- 問題：`plugin-network` partition 會保存回應的 `Set-Cookie`，之後的請求自動帶上 `Cookie`。所有插件共用這個 partition，所以插件 A 拿到的登入 cookie，插件 B 對同一網域請求時也會送出；也能被用來跨插件追蹤。
- 修正：插件網路請求 **完全不使用 cookie**：`net.request` 設 `useSessionCookies: false`、不寫入 cookie store；回應的 `set-cookie` 本來就不在回傳 header 白名單中，維持不回傳。並移除 `accept-language` 等會洩漏使用者環境的預設 header（若 Chromium 自動加入則保留 `user-agent`，但改成固定字串 `AgentPetsPlugin/1`，不要帶 Electron 與 App 版本）。
- 驗收：實機先打 `response-headers?Set-Cookie=leak%3D1`，再打 `/cookies` 必須回空、`/headers` 不得出現 `Cookie`。
- 文件：`sandbox`、`api-reference`、`security` 頁說明「插件請求不帶 cookie，需要登入請用 `authorization` header 與 `secrets`」。

### N3（中）只儲存密鑰時不會通知插件

- 問題：面板只儲存密鑰（沒有其他設定欄位變更）時，`settings.onChange` 不會觸發，插件要等下次啟動才會去讀新的 token。
- 修正：密鑰新增、更新、清除後也觸發 `settings.onChange`（傳入的仍只有非密鑰欄位，**絕不傳密鑰值**）；文件寫明「密鑰變更也會觸發 onChange，請在 callback 中重新呼叫 `secrets.get`」。
- 驗收：實機以面板只設定密鑰，插件的 onChange 被呼叫並能讀到新值（以假 `safeStorage`）。

### N4（中）macOS 未簽章版本使用密鑰會跳鑰匙圈視窗

- 背景：目前發佈的 macOS 版本未簽章（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。`safeStorage` 在 macOS 會向鑰匙圈要金鑰；未簽章的 App 可能每次啟動或每次更新後都要使用者再次允許。這是使用者會直接感受到的行為，而且使用者對鑰匙圈存取很敏感。
- 修正（不需要改加密方式）：
  1. 第一次在面板儲存密鑰前，顯示一次性說明（繁中／英文）：「儲存密鑰會使用系統鑰匙圈加密，macOS 可能會詢問是否允許 Agent Pets 存取鑰匙圈」，使用者確認後才儲存。
  2. **只在需要時才呼叫 `safeStorage`**：沒有任何已設定密鑰時，不得呼叫 `isEncryptionAvailable()` 或任何 `safeStorage` 方法（包括 App 啟動、開啟面板、讀取設定快照時）；面板顯示「已設定」只看密文檔是否存在。
  3. 使用者文件（兩份 README 的插件段落）說明這個行為。
- 驗收：以 inspector 包裝 `safeStorage` 方法並計數（仍是假實作），確認啟動、開面板、讀設定快照時呼叫次數為 0；只有儲存或讀取密鑰時才呼叫。

### N5（低）IP 黑名單補齊

- 在 `isPluginNetIpBlocked` 補上：`192.0.0.0/24`、`192.0.2.0/24`、`198.18.0.0/15`、`198.51.100.0/24`、`203.0.113.0/24`、`255.255.255.255/32`；IPv6 `64:ff9b::/96`（NAT64，需取出內嵌 IPv4 再判斷）、`2002::/16`（6to4，取出內嵌 IPv4 再判斷）、`2001:db8::/32`、`100::/64`。附單元測試。
- DNS rebinding：在只允許 https＋443 且需通過 TLS 憑證驗證的前提下，風險可接受；在 `security` 文件與 phase report 記錄這個理由，列為已知殘餘風險。

### N6（低）文件與實作不符的地方

- `limits`、`api-reference`、`sandbox` 頁寫「最多跟隨 3 個 redirect」，目前實際上一個都跟不了；修完 N1 後確認文字與行為一致。
- 依 N2、N3、N4 更新對應頁面。

## 確認通過的項目

- 網域白名單、https-only、IP literal、DNS 解析到 loopback 的網域都被擋。
- `requestHost` 授權流程與授權後 fetch；已在 manifest 中的網域直接回 `granted`。
- 密鑰以密文儲存、只能讀 manifest 宣告的 key（未宣告回 `not_permitted`）。
- `pet.status()`／`onStatusChange` 欄位恰為規定的七個，`agentFamily` 正確。
- `schedule` 最短間隔被拉高到偏好下限。
- §7.1 中 P14.6 的 13 個頁面（中英文）、`plugin.schema.json`、`.d.ts`、`hello-feed` 與 `github-pr-watch` 範例皆已建立（內容依 N6 修正）。

## 修正複檢結果（2026-10-23）

- 複檢對象：`b11f4b2..623fa1e`（`732a58e` 程式修正、`623fa1e` 報告）。
- 重跑檢查：`vue-tsc` 通過、`pnpm test:unit` 276/276、`vite build` 通過、`git diff --check` 通過、`pnpm audit --prod` 無弱點。
- 程式審查：網路改用 `net.request`（插件專用 session、`redirect: 'manual'`、`useSessionCookies: false`），收到 `redirect` 事件即中止並交回逐跳檢查迴圈重發；移除 `Cookie`、`Accept-Language`，`User-Agent` 固定為 `AgentPetsPlugin/1`，並在 session 層剝除 `Set-Cookie`；IP 黑名單補齊 N5 各網段，NAT64／6to4 會取出內嵌 IPv4 判斷；密鑰新增一次性同意，同意前不呼叫 `safeStorage`。
- **Electron 實機（隔離環境，先以「會計數的假 `safeStorage`」取代真實實作，全程未觸碰鑰匙圈）**：

| 項目 | 結果 |
|---|---|
| N1 `/redirect/1`、`/relative-redirect/2` | 200 ✅ |
| N1 `/redirect/5` | `too_many_redirects` ✅ |
| N1 轉址到 `localtest.me`／`169.254.169.254`／未宣告網域 | 皆 `host_not_allowed` ✅ |
| N1 跨來源轉址（`httpbin.org` → `www.httpbin.org/headers`） | 目的端看不到 `Authorization` ✅；同來源請求仍保留 ✅ |
| N2 設定 cookie 後讀 `/cookies` | `{"cookies":{}}` ✅；`/headers` 無 `Cookie`、`User-Agent` 為 `AgentPetsPlugin/1` ✅ |
| N4 啟動、開面板、安裝與啟用插件、讀設定快照 | `safeStorage` 呼叫次數 0 ✅ |
| N4 未同意說明就存密鑰 | 回 `secret_consent_required`，呼叫次數仍 0 ✅ |
| N3 同意後只存密鑰 | 插件 `settings.onChange` 被呼叫並讀到新值 ✅（此時才呼叫 `safeStorage`：isEncryptionAvailable 2、encrypt 1、decrypt 1） |

- 結論：**N1–N6 修正確認，Phase 14 通過**，可進 Phase 15。
- 觀察：`pnpm-lock.yaml` 有 1 行 `glob@7.2.3` 的 deprecated 說明文字變動（pnpm 重新產生的中繼資料），不影響版本與相依，保留。
- 未驗證：真實 macOS 鑰匙圈（依規定不在自動化中觸發）、真實 Codex／Claude adapter 事件、原生 `requestHost` 確認框的點擊、Windows。DNS rebinding 依 N5 理由列為已知殘餘風險。
