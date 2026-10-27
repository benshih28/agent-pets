# Phase 13 驗收報告：Sandbox Host + 本機安裝

- 日期：2026-10-23
- 目前版本：1.2.4（未修改）
- 階段狀態：P13.1–P13.6 實作完成；六個 checkpoint 的 §0.4 四項檢查通過並已推送。Electron 實際操作未驗證，見手動驗收步驟。
- 建議版本：1.3.0（Phase 12–16 整體 minor 建議；本階段不改版）
- 分支：feat/plugin-host
- origin/main：已於 P13.1 前以 merge 合併；merge commit a0c571a908d95f05173ab29d8c9b8bda0a4dc1a5。合併前 origin/main 的 package.json Vue 為 ^3.5.44（PR #13 已合併）。沒有 rebase 或合併到 main。

## 範圍摘要

完成本機插件套件安裝與 registry、隔離 Plugin Host Worker、受限 protocol 與 RPC、feed／reaction／storage／log API、寵物通知 UI 與未讀數、雙語插件管理面板，以及 Phase 13 安全測試 fixtures。Plugin Host preload 只提供 MessagePort；安裝和檔案操作採邊界驗證、暫存後原子替換與 symlink 拒絕。插件偏好檔若是 symlink 或非一般檔案，面板保留可用並顯示繁中／英文錯誤。

P13.6 增加七個原始 fixture 和測試打包器。三次連續崩潰停用插件時，宿主現在會在通知中心加入系統通知。Fixture 的 JavaScript 僅供測試；本階段沒有在 Electron 中執行它們。

## Checkpoint

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P13.1 | PluginRegistry 安裝計畫、安裝／更新／降版／移除與偏好保護 | 05011b28d19cffdb1b8e4f425061aa1b7c248784 | §0.4 通過；已推送 |
| P13.2 | Secure plugin protocol、隔離 Host 視窗、Worker bootstrap／生命週期 | e9be74de1bc1600b15ece138728f510f98f0439f | §0.4 通過；已推送。因 simple plugin 的多 preload 輸入在 codeSplitting=false 下無法建置，改成分開建置第二個 preload，並由既有 preload 啟動 Electron。 |
| P13.3 | Host RPC Broker 與 feed、reaction、storage、log API | b5bd18ba85aa5b60ee2fcbbe7179dc9f6f3a0828 | §0.4 通過；已推送 |
| P13.4 | 寵物端通知泡泡、通知中心與未讀 badge 接線 | af885f93ac0fd2fe2db7f65792877e7e8cc329fb | §0.4 通過；已推送 |
| P13.5 | 雙語插件管理面板、安裝確認、控制、診斷與通知中心 | 5c85968ddf0064be3367951b002a196a7a3f24f8 | §0.4 通過；已推送 |
| P13.6 | 惡意／正常 fixture、fixture 打包器與 Phase 13 收尾 | 本報告所在的最終 checkpoint commit（完整 SHA 見最終回報） | §0.4 通過；隨本報告所在最終 checkpoint commit 提交並推送 |

## §0.4 檢查結果

每個 checkpoint 均依序執行下列四項實際指令；每項均通過。

| Checkpoint | pnpm exec vue-tsc --noEmit | pnpm test:unit | pnpm exec vite build | git diff --check |
|---|---|---:|---|---|
| P13.1 | 通過 | 198/198 | 通過 | 通過 |
| P13.2 | 通過 | 201/201 | 通過，含 dist-electron/plugin-host-preload.js | 通過 |
| P13.3 | 通過 | 208/208 | 通過，含 renderer、main、preload 與 plugin-host-preload | 通過 |
| P13.4 | 通過 | 210/210 | 通過 | 通過 |
| P13.5 | 通過 | 214/214 | 通過 | 通過 |
| P13.6 | 通過 | 223/223 | 通過，含 renderer、main、preload 與 plugin-host-preload | 通過 |

未執行 pnpm build。本次手動 Electron 驗收未執行；Vite build 和純模組測試不代表 Electron 執行期驗收。

測試 fixture 打包指令（測試／複檢用途，不會被產品流程呼叫）：
    node scripts/pack-test-plugin.mjs ok-notify /tmp/ok-notify.agentpet-plugin

其餘 fixture 可將 ok-notify 換成 evil-fetch、evil-loop、evil-spam、evil-xss、evil-spoof 或 evil-zip。測試本身使用 fflate 的 zipSync 動態打包，沒有提交二進位套件。

## Phase 13 驗收條件

| 驗收條件 | 結果 | 證據與限制 |
|---|---|---|
| 本機安裝、更新、降版確認、權限重新同意、移除（保留／不保留資料） | 單元測試通過；Electron 未驗證 | PluginRegistry 測試涵蓋安裝計畫、更新／降版、重新同意、原子安裝與移除。未在設定面板實際操作。 |
| ok-notify 通知泡泡、來源標籤、寵物縮小後通知中心與 Edge 未讀數、恢復後只補最新一則 | 純模組測試通過；Electron UI 未驗證 | Feed 測試涵蓋 TTL、佇列、隱藏後恢復及未讀。未在實際寵物視窗觀察動畫或 badge。 |
| 每個 evil fixture 都被擋下或終止，且 App 其他功能正常 | 部分純模組／靜態測試通過；Worker 實際行為未驗證 | 見下方逐項結果；沒有將 fixture 放進 Electron Worker 執行。 |
| 插件總開關關閉後沒有插件執行、Host 視窗關閉 | 程式與生命週期接線已完成；Electron 未驗證 | 未手動檢查實際 Host 視窗及 Worker 數量。 |
| 新 IPC 驗證寄件者與 payload | source review 與自動測試通過 | 面板 IPC 嚴格綁定面板 sender；輸入驗證測試覆蓋插件 id、通知 id、安裝 token、patch 與 unsafe preference 錯誤。Host RPC 由 Main 指派插件身分並拒絕自稱身分或未授權 method。 |

### Fixture 自動測試及實際執行狀態

| Fixture | 自動測試結果 | Electron Worker 實際結果 |
|---|---|---|
| ok-notify | manifest／entry／PNG icon 有效；可用 ZIP 安裝；原始碼提供通知及 storage 寫入／讀回路徑。 | 未驗證；沒有在 Worker 執行通知或 storage 往返。 |
| evil-fetch | 原始碼涵蓋 fetch、WebSocket、importScripts 與外部 dynamic import；Host CSP 的 connect-src 'none' 靜態條件通過。 | 未驗證；沒有實際嘗試網路或觀察拒絕結果。 |
| evil-loop | 原始碼含無限迴圈；bootstrap heartbeat source assertion 通過。 | 未驗證；沒有觀察 watchdog 終止 Worker、重啟或累計崩潰。 |
| evil-spam | feed/controller 模擬 100 則：5 則可送泡泡，另外 95 則保留在通知中心、不送泡泡。 | 未驗證；沒有在實際 Worker 執行 100 次呼叫。 |
| evil-xss | feed 將 HTML payload 淨化為不含標籤的純文字。 | 未驗證；沒有在 Electron 視窗確認文字呈現且無 script 執行。 |
| evil-spoof | Broker 拒絕冒稱另一插件身分及未宣告的 pet.react 權限。 | 未驗證；沒有在實際 Worker／MessagePort 執行攻擊。 |
| evil-zip | Registry 拒絕 ../ traversal 與超過檔案數限制的安裝計畫。 | 未驗證；未在安裝面板實際選取惡意 ZIP。 |

## 安全檢查

- **依賴稽核：未執行。** 使用者指定僅執行 §0.4 四項命令，因此本階段沒有執行 audit；不據此宣稱依賴無弱點。
- **Repository secret scan：未執行。** 同樣受命令限制；新增 fixture 使用合成測試字串與圖示，沒有刻意放入憑證。
- **IPC／最小權限：source review 與測試通過。** 面板 IPC 驗證 sender 並限制 payload；Host preload 僅提供 MessagePort，插件身分由宿主端指派。Broker 對未知 method、過大 payload、錯誤身分、未宣告權限及 storage 邊界採拒絕策略。
- **路徑與檔案系統：source review 與測試通過。** 插件安裝經 archive guard、manifest 與套件檔案檢查，再暫存後原子替換；protocol/storage/preferences 對檔案類型與 symlink 做 fail closed 驗證。測試涵蓋 traversal、檔案數／大小限制及 symlink。
- **通知與面板文字：自動測試通過。** Feed 對文字作純文字淨化；面板使用 Vue interpolation，沒有以 v-html 顯示插件資料。三次崩潰停用的宿主通知進通知中心，不走插件 feed 泡泡和速率額度。
- **通知路徑同步 I/O：source review。** 通知狀態以記憶體中的 controller 更新，未新增同步檔案寫入。
- **本機伺服器、Permission Broker、MCP 安全 gate：不適用。** 本 Phase 沒有新增本機 server 或 Permission 回應能力；reaction 使用既有受限 Presentation queue。
- **版本／相依：通過。** 未改版本號、未新增 runtime dependency，未改 .claude/。Vue 3.5.44 是使用者要求的 origin/main merge 內容。

## Electron 手動驗收

以下操作均為**未驗證**。為符合本次僅執行 §0.4 命令的限制，沒有執行 pnpm dev。複檢者可在專案目錄依序照做：

1. 用 pnpm dev 啟動 App，等待主寵物出現；開啟設定面板的「插件」分頁。預期面板可正常操作，插件總開關預設關閉，沒有啟用中的 Worker。
2. 打包並在面板安裝 ok-notify：node scripts/pack-test-plugin.mjs ok-notify /tmp/ok-notify.agentpet-plugin。確認安裝計畫顯示第三方警告與權限；確認後啟用插件及總開關。預期通知泡泡有插件來源標籤，且插件能寫入再讀回自己的 storage。
3. 在泡泡顯示時讓寵物切到 Mini／Edge 或隱藏。預期通知轉入通知中心並增加未讀；Edge 把手顯示未讀數。連續觸發多則通知後恢復可見，預期只補顯示最新一則且使用新的 TTL。
4. 建立同一插件 id 的新版本套件（提高 version 並加入一項新 permission）與舊版本套件，分別安裝。預期計畫分別標示更新、權限重新同意和降版；拒絕新增權限時保留舊版。移除時分別測試保留與刪除資料，預期行為符合選項。
5. 依序打包並安裝 evil-fetch、evil-loop、evil-spam、evil-xss、evil-spoof。預期：外連與 API 呼叫遭拒；無限迴圈 Worker 被 heartbeat watchdog 終止，三次崩潰後停用並在通知中心出現宿主訊息；spam 受限流且超額項目不進泡泡；XSS 只顯示純文字；偽造身分與未授權 method 被拒絕。每項操作後確認 App 其他功能仍可用。
6. 建立一個 ZIP，包含 ../escape.txt，另建立一個超過 plugin archive 檔案數上限的 ZIP，改名為 .agentpet-plugin 後在安裝面板選取。預期兩者均在建立安裝計畫前以無效 archive 拒絕，且安裝目錄外沒有新增檔案。
7. 啟用插件後關閉插件總開關，再檢查 Host 視窗與通知。預期所有插件 Worker 停止、Host 關閉；重新啟用時才重新建立 Host。
8. 在測試環境建立指向 symlink 或非一般檔案的 plugin preferences 路徑，重新開啟插件分頁。預期面板仍可操作，繁中／英文分別顯示對應的偏好檔安全錯誤，沒有覆寫該路徑。

## 殘餘風險與待決問題

1. 本機 Electron UI 與真實 Worker 的安裝、更新／降版／權限重新同意、通知、Host 關閉、DND／可見性變化，以及全部 evil fixture 執行結果仍待複檢者手動驗收。
2. 依本次命令限制，依賴稽核與 repository secret scan 未執行；不能從四項 build/test gate 推論這兩項檢查通過。
3. 本階段只執行指定的 pnpm exec vite build，沒有執行完整 packaging；平台封裝後的 sandbox／資源路徑行為未驗證。
4. 更新／降版手動驗收需複檢者準備同 id、不同版本及權限集合的套件；現有打包器直接封裝來源 fixture，不提供 manifest 變體參數。

## 複檢修正

本節是 2026-10-23 複檢修正的實際結果；它更新上方原始報告對應的「Electron 未驗證」及「audit／secret scan 未執行」狀態。原 P13.1–P13.6 checkpoint 記錄保留為歷史結果。

程式與測試變更 commit：`aa7df60bf8e080e46c72ef23e1d687d15d834b7e`（`fix(plugin): [P13.R] 修正 Host 隔離與崩潰復原`）。

### B／H／M 修正對照

| 項目 | 修正內容 | Commit | 新增測試 |
|---|---|---|---|
| B1 | 在 `plugin-host` partition 註冊只服務 token 路徑的協定 handler；其他 host 回 404。 | `aa7df60bf8e080e46c72ef23e1d687d15d834b7e` | `plugin-host partition handler serves only token-scoped plugin files and embedded host assets`。 |
| B2 | Preload 以 `window.postMessage` 轉交一次性 MessagePort；Host 檢查來源、origin 和訊息內容。 | 同上 | `evil-escape logs isolation probes and Host API results are unwrapped`。實機可見 Host、Worker，且 fixture 能呼叫 RPC。 |
| B3 | Host 載入／renderer 故障使用退避重試，最多連續三次；重試耗盡時加入系統通知與 `host_unavailable` 診斷。 | 同上 | `host load failures retry with backoff and stop after three failed windows`，驗證 250ms／1s 退避與第三次停止；另有一次 Electron renderer crash 後 Host 重建實測。 |
| B4 | 只在收到 pong 且穩定執行滿 60 秒後重設故障計數；worker 超時會終止、退避重啟，三次失敗後停用。 | 同上 | `watchdog failure counts reset only after a pong and 60 seconds of runtime`、`an early pong does not reset a failure count before stable runtime reaches 60 seconds`。實機 evil-loop 三次阻塞啟動後進入 `disabled_crashed`。 |
| H1 | RPC 成功時只回傳 `value`；失敗時 reject 帶相同錯誤碼／訊息的 Error；feed 結果不暴露內部欄位。 | 同上 | `PluginBroker returns clean feed results and records host startup diagnostics`、`evil-escape logs isolation probes and Host API results are unwrapped`。 |
| H2 | 每個啟動使用新 UUID token；檔案回應套用 `worker-src 'none'` CSP；載入前移除跨插件通道 API。 | 同上 | `plugin-host partition handler serves only token-scoped plugin files and embedded host assets`、`evil-escape logs isolation probes and Host API results are unwrapped`。 |
| H3 | 啟用超過上限時拒絕新插件，保留較早啟用項目；面板提供可調上限與繁中／英文錯誤。 | 同上 | `enabled plugin selection keeps the earliest plugins when stored preferences exceed the limit`、`invalid enabled plugin limits fail closed without selecting a host descriptor`、`enabling a new plugin is rejected at the configured limit while existing plugins stay enabled`。Electron 面板也實測上限 1 時拒絕第二個插件，第一個仍執行。 |
| M1 | `evil-fetch`、`evil-spoof` 等 fixture 將探測結果寫入 log，新增 `evil-escape` 覆蓋隔離逃逸探測。 | 同上 | `every evil fixture records a host log entry for its runtime probe`、`evil-escape logs isolation probes and Host API results are unwrapped`。 |
| M2 | 以 Electron 面板實測版本變更、重新同意、移除資料選項、evil ZIP 與偏好 symlink；Edge 模式實測未讀徽章。 | 同上 | `evil-zip path traversal and excess entries are rejected during planning`；其餘面板流程以本節 Electron 實機結果為驗證。 |

### §0.4 四項檢查與 §0.4b 安全檢查

| 指令 | 實際結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過，exit code 0。 |
| `pnpm test:unit` | 通過，233/233；失敗 0。 |
| `pnpm exec vite build` | 通過；renderer、main、preload、`plugin-host-preload.js` 均建置完成。未執行 `pnpm build`。 |
| `git diff --check` | 通過，無 whitespace error。 |
| `pnpm audit --prod --audit-level moderate` | 通過：`No known vulnerabilities found`。 |
| Secret pattern scan | 對本次變更掃描私鑰、GitHub／OpenAI／Slack token、AWS key、Google API key pattern；無命中。 |

上述四項 §0.4 檢查在程式 commit 前全部通過。報告文件提交前也會重跑四項檢查。

### Electron 實機驗證

使用 §0.4a 指令啟動隔離 Electron：`HOME=/tmp/agent-pets-plugin-review.GJtsHa/home ./node_modules/.bin/electron --inspect=9349 --remote-debugging-port=9348 --user-data-dir=/tmp/agent-pets-plugin-review.GJtsHa/ud .`。`HOME` 與 userData 都在暫存目錄；沒有使用已安裝的 Agent Pets 或 `~/.desktop-pet`。透過兩個 CDP 埠呼叫 Main／renderer 的 `Runtime.evaluate`，所有套件都從隔離面板的 `selectPluginArchive()` 流程選取。驗收後以 Ctrl-C 關閉 Electron，確認 9348 已停止監聽。

| 實測項目 | 步驟與觀察結果 |
|---|---|
| B1／B2 Host 與 Worker | 啟用 `ok-notify` 後，CDP 出現 `agent-pets://plugin/_host/index.html` 與 Worker target；插件 RPC 成功寫入 storage 並送出通知。插件 partition 的協定只回應 token 路徑。 |
| B3 Host 重啟 | 啟用 `evil-fetch` 後對 Host target 呼叫 `Page.crash`。Host target ID 從 `D6470393BDB8537EB2ED05853BA78E4E` 換成 `146DC4F11975E8916BA5255A444F7820`；`evil-fetch` 仍是 enabled，crash 後再次寫入 runtime log。單元測試另覆蓋三次載入失敗停止重試。 |
| B4 evil-loop | 安裝並啟用後 log 記錄三次 `evil-loop entered its blocking loop`；第三次 watchdog 超時後狀態為 `disabled_crashed`、偏好 `enabled=false`，通知中心出現 `Disabled after repeated crashes`。 |
| H1 ok-notify | 啟用後通知標題為 `Plugin ready`，body 為 `Storage round-trip passed.`；notification center 顯示未讀。 |
| H2 evil-escape／evil-fetch／evil-spoof | `evil-escape` log 將 https、loopback、`agent-pets://app`、跨插件 import、巢狀 Worker、BroadcastChannel、indexedDB、prototype RPC 都標成 blocked；storage round-trip 回 `found:true`。`evil-fetch` 的 fetch、WebSocket、importScripts、dynamic import 均 blocked。`evil-spoof` 的 `self.postMessage`、prototype RPC 與未授權 `pet.react` 均 blocked，後者記錄 `invalid_request`。 |
| H3 啟用上限 | 將面板上限設為 1，透過第二個插件的「Run this plugin」切換啟用；面板顯示 `The plugin limit (1) is reached...`，第二個仍 disabled，原有 `evil-fetch` 保持 enabled。 |
| M1 所有 evil fixture | `evil-fetch`、`evil-escape`、`evil-spoof`、`evil-spam`、`evil-xss`、`evil-zip`、`evil-loop` 各自都能從診斷 API 讀到 runtime log。`evil-spam` 記錄 accepted 5／rejected 95，並留下 `rate_limited` diagnostics；`evil-xss` payload 以不含 HTML tag 的純文字保存。 |
| M2 更新／降版／重新同意 | 在面板先安裝 ok-notify 1.0.0；2.0.0 新增 `api.example.com` 權限時計畫明確要求重新同意，確認後版本變為 2.0.0；再選 1.5.0，計畫標示降版，確認後版本變為 1.5.0。 |
| M2 移除保留資料 | 面板勾選「保留設定與資料」後移除；隔離 userData 的 `plugins/ok-notify/data/storage.json` 仍存在。 |
| M2 移除不保留資料 | 重新安裝後以未勾選的預設選項移除；`plugins/ok-notify/data` 不存在。 |
| M2 evil ZIP | 面板選取正常 `evil-zip` 後成功啟用並記錄 activation log；含 `../` traversal 與超量檔案的套件均由 `selectPluginArchive()` 回 `invalid_archive`。 |
| M2 偏好 symlink | 將隔離 `plugin-preferences.json` 改為 symlink，再操作插件總開關。繁中與英文面板分別顯示對應拒寫訊息；設定面板其他控制項仍可用。 |
| M2 Edge 未讀徽章 | 在 Desktop 設定啟用 Edge Peek，將寵物視窗停靠螢幕上緣並觸發 drag-end；650ms dwell 後主程序狀態為 `edge/top`。ok-notify 通知進入未讀，API 計數為 2，Edge 把手徽章顯示 `2`，aria-label 為 `2 則未讀插件通知`。 |
| 插件總開關 | 實際關閉總開關後 Host 與 Worker target 消失；再開啟後 Host 與 Worker target 重建。 |

啟動 log 仍有既有的 `project-pets-get-enabled: Unauthorized IPC sender` 訊息；這是原複檢文件「其他觀察」記載的既存 IPC 問題，未納入本次 B/H/M 修正。

### 手動驗收步驟

以下步驟可在 macOS 專案目錄直接執行；預期結果列於各步。請使用隔離目錄，勿連到已安裝的 Agent Pets userData。

1. 建置與啟動隔離 app：
   ```bash
   pnpm exec vite build
   TMP_DIR="$(mktemp -d)"
   mkdir -p "$TMP_DIR/home" "$TMP_DIR/ud"
   HOME="$TMP_DIR/home" ./node_modules/.bin/electron --inspect=9349 --remote-debugging-port=9348 --user-data-dir="$TMP_DIR/ud" .
   ```
   預期兩個 CDP 埠可列出 App 頁面；已安裝 App 佔用的 17373–17375 埠可能顯示 already in use，屬已知情況。
2. 在另一個終端打包並從設定 → 插件安裝正常 fixture：
   ```bash
   node scripts/pack-test-plugin.mjs ok-notify /tmp/ok-notify.agentpet-plugin
   ```
   預期安裝計畫顯示第三方警告與權限；同意、啟用總開關及插件後，Host 與 Worker target 出現，通知為 `Plugin ready`／`Storage round-trip passed.`。
3. 在同一面板先安裝 ok-notify 1.0.0，再準備兩個同 id 變體：2.0.0 增加 `network.hosts: ["api.example.com"]`，1.5.0 保持既有權限。選 2.0.0 時預期看到更新及新增權限的重新同意提示；同意後版本顯示 2.0.0。選 1.5.0 時預期提示降版；同意後版本顯示 1.5.0。
4. 分別以勾選／未勾選「保留設定與資料」移除插件。預期勾選後 `plugins/ok-notify/data/storage.json` 保留；未勾選後 data 目錄移除。
5. 依序打包並安裝以下 fixture，啟用後在插件診斷查看 log：
   ```bash
   for id in evil-fetch evil-loop evil-spam evil-xss evil-spoof evil-zip evil-escape; do
     node scripts/pack-test-plugin.mjs "$id" "/tmp/$id.agentpet-plugin"
   done
   ```
   預期每個 fixture 都有可讀 log；網路／跨插件通道／偽造 RPC 被拒，XSS 為純文字，spam log 為 accepted 5／rejected 95，evil-loop 三次阻塞後 disabled_crashed 並新增系統通知。
6. 測 ZIP 拒絕：選正常 evil-zip 預期成功；另外選一個含 `../escape.txt` 的 ZIP 和超過 archive 檔案上限的 ZIP，預期兩者在安裝前回 `invalid_archive`，安裝目錄外沒有新檔案。自動測試 `evil-zip path traversal and excess entries are rejected during planning` 中有可參照的 `fflate` 產生方式。
7. 在插件面板 Advanced 將同時啟用上限設為 1，啟用第二個插件。預期顯示目前上限錯誤，第二個維持停用，先前啟用的插件繼續執行。之後關閉再打開插件總開關；預期 Host／Worker target 先消失，再重建。
8. 在 Desktop 設定打開 Edge Peek，把寵物拖到螢幕邊緣並停留超過 650ms；啟用可送通知的 fixture。預期進入 Edge 模式、通知增加未讀數且把手出現相同數字徽章。
9. 在隔離 userData 把 `plugin-preferences.json` 替換為 symlink，再於插件面板操作總開關；預期面板保持可用並以當前語言顯示偏好檔安全錯誤。將面板語言切換一次，重試操作，預期英文／繁中錯誤各自正確。
10. B3 crash recovery 可在 CDP 9348 找到 `agent-pets://plugin/_host/index.html` target，送出 `Page.crash`。預期 Host target 以新 ID 重建，啟用中的插件恢復執行並繼續新增 log。
11. 結束時 Ctrl-C 關閉隔離 Electron，確認 9348／9349 不再監聽。

### 測試套件變體產生指令

在手動驗收第 3 步前，於專案根目錄執行以下命令，產生同 id 的更新／降版套件。2.0.0 新增 `api.example.com` 權限；1.5.0 保留原有權限。

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'
const root = path.resolve('tests/fixtures/plugins/ok-notify')
for (const [version, addNetwork] of [['2.0.0', true], ['1.5.0', false]]) {
  const files = {}
  function collect(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name)
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(absolute, name)
      else if (entry.isFile()) files[name] = new Uint8Array(fs.readFileSync(absolute))
    }
  }
  collect(root)
  const manifest = JSON.parse(new TextDecoder().decode(files['plugin.json']))
  manifest.version = version
  if (addNetwork) manifest.permissions.network = { hosts: ['api.example.com'] }
  files['plugin.json'] = new TextEncoder().encode(JSON.stringify(manifest))
  fs.writeFileSync(`/tmp/ok-notify-${version}.agentpet-plugin`, zipSync(files, { level: 6 }))
}
NODE
```

手動驗收第 6 步可用以下命令，從正常 evil-zip 產生 traversal 與超量檔案套件（archive 上限為 64 個檔案）：

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
const base = unzipSync(new Uint8Array(fs.readFileSync('/tmp/evil-zip.agentpet-plugin')))
fs.writeFileSync('/tmp/evil-zip-traversal.agentpet-plugin', zipSync({ ...base, '../escape.txt': strToU8('outside') }))
const overflow = { ...base }
for (let i = 0; i < 65; i += 1) overflow[`extra/${i}.txt`] = strToU8('x')
fs.writeFileSync('/tmp/evil-zip-overflow.agentpet-plugin', zipSync(overflow))
NODE
```

在設定面板選這兩個檔案，預期都回 `invalid_archive`，不建立安裝計畫。

### 未驗證與待決問題

- Windows Electron 實機驗收未執行；本次隔離實機環境為 macOS。
- B3 的實際 renderer crash／Host 重建已驗證；三次 protocol load failure 的停止條件以注入時鐘／假 window 測試驗證，未在 Electron 中額外製造三次真實載入失敗。
- release packaging／安裝包啟動未驗證；本次執行 `pnpm exec vite build` 與隔離 Electron，不執行 `pnpm build`。
- 原複檢記錄的 `project-pets-get-enabled` 未授權 IPC sender log 是既存觀察，仍待另案處理。
