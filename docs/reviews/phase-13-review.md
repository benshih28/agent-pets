# Phase 13 複檢與修正清單

- 複檢對象：`feat/plugin-host` 的 `71770d2..bb0a198`（含 merge main `a0c571a`、P13.1–P13.6）
- 複檢日期：2026-10-23
- 結論：**需要修正後才能進入 Phase 14**。單元測試與純模組設計良好，但 **在真實 Electron 中插件完全無法執行**（B1、B2），且看門狗沒有作用（B4）。這些都只有實際啟動 Electron 才看得到。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 223/223 通過 |
| `pnpm exec vite build` | 通過（含 `plugin-host-preload.js`） |
| `git diff --check` | 通過 |
| `pnpm audit --prod --audit-level moderate` | **No known vulnerabilities found**（merge main 後 vue 3.5.44 生效） |
| 新增內容 secret pattern 掃描 | 未命中 |

### Electron 實機驗收方式

以隔離環境啟動 `bb0a198` 的 build（`HOME` 與 `--user-data-dir` 指向暫存資料夾，不碰使用者已安裝並執行中的 Agent Pets），用 `--inspect` 連主程序、`--remote-debugging-port` 連各視窗；選檔視窗在主程序替換為回傳測試套件路徑，再呼叫面板的 `electronAPI` 安裝、啟用插件。

為了在 B1、B2 存在的情況下繼續驗證後續功能，複檢時對 **建置輸出（非原始碼）** 做了臨時修補：在 `plugin-host` partition 註冊協定、改用 `window.postMessage` 傳遞 MessagePort。驗收結束後已重新 `vite build` 還原。下表「修補後」的結果代表 **修完 B1、B2 後** 的預期行為。

另外自製了一個 `probe-escape` 探測插件（原始碼見 R-H2），在 Worker 內嘗試各種逃逸手法並把結果寫進 log。

| 項目 | 結果 |
|---|---|
| 安裝 `ok-notify`、啟用、開總開關 | 安裝與偏好皆回報成功，**但 Host 視窗從未出現，插件沒有執行**（B1） |
| 修補 B1 後 | Host 頁面載入，但丟出 `port.start is not a function`，仍無法執行（B2） |
| 修補 B1+B2 後：`ok-notify` | 啟動、送出通知、泡泡顯示插件名稱來源標籤 ✅；但 body 顯示「Storage value was missing.」（H1） |
| `evil-fetch` / probe 網路 | https、`127.0.0.1:17373`、`agent-pets://app`、其他插件檔案的 fetch 全被擋 ✅ |
| `evil-spam` | 只有前 5 則進泡泡，100 則全進通知中心 ✅ |
| `evil-xss` | 標題與內文以純文字顯示，`<>` 被移除 ✅ |
| `evil-spoof` | `pet.react` 被拒（`invalid_request`）✅；但 fixture 沒有真的測到繞過手法（M1） |
| probe：通知連結指向未授權網域 | 回 `host_not_allowed` ✅（但以 resolve 形式回傳，見 H1） |
| probe：`import()` 其他插件模組、`new Worker`、`BroadcastChannel`、`indexedDB` | **全部允許**（H2） |
| `evil-loop` | **超過 4 分鐘仍為 enabled，Host 程序 CPU 持續 92–100%，沒有崩潰通知**（B4） |
| Mini 模式時送通知 | 不出泡泡、未讀數 1；回到 Normal 後補顯示最新一則 ✅ |
| 關閉插件總開關 | Host 視窗關閉 ✅；再開啟時重新建立 ✅（未修 B1 時重新建立仍會失敗） |
| 未驗證 | Edge 把手未讀徽章、面板上的更新／降版／重新同意流程、移除保留／不保留資料的 UI、`evil-zip` 從面板選取、偏好檔 symlink 時的面板錯誤、Windows |

## 修正清單（給 Codex）

修完後照交接文件 §0.4 跑檢查，並 **務必照 §0.4a 實際啟動 Electron 驗證**（見本次更新的交接文件）。commit 訊息用 `fix(plugin): [P13.R] ...`，最後一個 commit 加 `Checkpoint: P13.R`，push，更新 Phase 13 的同一筆工作記錄與 phase report（新增「複檢修正」一節）。修完後停止回報，不要開始 Phase 14。

### B1（阻斷）`agent-pets://` 協定沒有註冊在 `plugin-host` partition

- 位置：`electron/plugin-host-window.ts` 的 `createHost()`、`electron/main.ts` 的 `configureSecureProtocol`。
- 問題：`protocol.handle` 只對 default session 生效。Host 視窗用 `partition: 'plugin-host'`，載入 `agent-pets://plugin/_host/index.html` 得到 `ERR_FAILED (-2)`，任何插件都不會執行。複檢時以 `session.fromPartition('plugin-host').protocol.isProtocolHandled('agent-pets')` 確認為 `false`。
- 修正：在 `plugin-host` session 上用 `pluginSession.protocol.handle('agent-pets', ...)` 註冊（只註冊一次），**只服務 `agent-pets://plugin/...`**，其他 host（`app`、`custom`）一律 404，不能讓插件 partition 讀到 App 本身的檔案。直接呼叫 `handlePluginProtocolRequest`，不要轉呼叫 default session。
- 測試：抽出「建立 partition handler」的純函式並測 `app`／`custom` 回 404；Electron 實機確認 Host 頁面載入成功。

### B2（阻斷）MessagePort 經 contextBridge 傳給頁面後無法使用

- 位置：`electron/plugin-host-preload.ts`、`electron/plugin-host-assets.ts` 的 `host.js`。
- 問題：contextBridge 不能傳遞 MessagePort，頁面拿到的物件沒有 `start()`，Host 頁面丟出 `port.start is not a function`。
- 修正：照 Electron 官方做法：preload 收到 `plugin-host-port` 後，用 `window.postMessage('agent-pets-plugin-host-port', window.location.origin, [port])` 轉給主世界；`host.js` 用 `window.addEventListener('message', ...)` 接收，並檢查 `event.source === window`、`event.origin === window.location.origin`、`event.data === 'agent-pets-plugin-host-port'`，只接受 **第一次** 收到的 port。preload 不再透過 contextBridge 暴露任何東西（或只暴露無功能的版本標記）。

### B3（阻斷）Host 載入失敗或 renderer 崩潰後永遠不會重啟

- 位置：`PluginHostWindowController.handleHostCrash` 與 `closed` 事件。
- 問題：`handleHostCrash` 先把 `closingIntentionally` 設為 `true` 再 `destroy()`，`closed` 事件因此判定為「刻意關閉」，不重啟也不記崩潰。B1 的載入失敗就是這樣讓插件靜默消失。
- 修正：區分「刻意關閉」與「崩潰」；崩潰與載入失敗要記一次 Host 崩潰、以退避（250ms、1s、5s）重啟，連續 3 次失敗就停止重啟，並在通知中心與每個插件的診斷寫入「插件執行環境無法啟動」的系統訊息（繁中／英文）。
- 測試：用可注入的 window factory 讓 controller 可測，模擬載入失敗 3 次後停止重試並回報。

### B4（阻斷）無限迴圈插件永遠不會被停用

- 位置：`PluginHostWindowController.pingWorkers` / `recordCrash`。
- 問題：`if (now - runtime.startedAt >= PONG_TIMEOUT_MS) this.crashCounts.delete(pluginId)` 與逾時判斷在同一個 tick 執行；卡死的 Worker 每次都是「啟動超過 30 秒」才被判逾時，所以計數先被清掉再 +1，永遠停在 1。實測 `evil-loop` 啟用 4 分鐘以上仍為 enabled，Host CPU 持續 92–100%。
- 修正：只有在「啟動後收到過 pong，且距啟動已穩定運行 ≥ 60 秒」時才重設該插件的崩潰計數（例如記錄 `healthySince`）。逾時判斷前不得重設。另外確認 `terminate` 真的讓 Host 頁面呼叫 `worker.terminate()`，且重啟前有退避。
- 測試：注入時鐘，模擬一個永不回 pong 的插件，經 3 輪後狀態為 `disabled_crashed`、偏好 `enabled: false`、通知中心有系統訊息；另一個正常回 pong 的插件崩潰一次後穩定 60 秒，計數被重設。

### H1（高）Host API 把 RPC 封包原封不動交給插件

- 位置：`worker-bootstrap.js` 的 `rpc()`。
- 問題：`api.storage.get('k')` 回傳的是 `{ id, ok: true, value: { found, value } }`；錯誤（例如 `host_not_allowed`）也是 resolve 一個 `{ ok: false }` 物件。插件作者拿不到乾淨的值，fixture `ok-notify` 也因此誤判「Storage value was missing」。
- 修正：`ok: true` 時 resolve `value`；`ok: false` 時 reject 一個 `Error`，`error.code` 為錯誤碼、`error.message` 為同一字串。`feed.notify` resolve 後的值為 `{ itemId, delivery }`（不含內部欄位）。
- 同步修改 `ok-notify` fixture 為 `stored.found === true` 才算成功，並更新 `src/types/plugin.ts` 中的 Host API 型別（P14.6 的對外 `.d.ts` 以此為準）。

### H2（高）不同插件共用同一個 origin，可互相讀取資料與程式

- 問題：所有插件都在 `agent-pets://plugin` 這個 origin 下。實測一個插件可以 `import()` 另一個插件的模組、建立巢狀 `Worker`、使用 `BroadcastChannel` 與 `indexedDB`（同 origin 的插件共用同一個資料庫）。
- 修正（三項都要）：
  1. **每次啟動給每個插件一個隨機路徑**：Main 為每個執行中的插件產生 `crypto.randomUUID()` 權杖，插件檔案只透過 `agent-pets://plugin/<token>/<path>` 提供；protocol 以權杖查表取得插件根目錄，查不到就 404。插件停用、重啟或 Host 重建時權杖作廢重發。插件知道自己的權杖，但猜不到別人的。
  2. **Worker 端 CSP 分開**：`_host/index.html` 維持 `worker-src agent-pets://plugin`；`worker-bootstrap.js` 與所有插件檔案的回應改用 `worker-src 'none'`（禁止巢狀 Worker）。
  3. **bootstrap 在載入插件前移除跨插件通道**：在 `worker-bootstrap.js` 中，於 `import()` 插件之前，把 `indexedDB`、`caches`、`BroadcastChannel`、`Worker`、`SharedWorker`、`WebSocket`、`EventSource`、`XMLHttpRequest`、`fetch` 從 `self` 及其原型鏈上以 `Object.defineProperty(..., { value: undefined, configurable: false, writable: false })` 移除（網路本來就被擋，這裡是第二道防線）。
- 測試：把複檢用的 probe 收進 fixture `evil-escape`（原始碼如下），單元測試檢查 CSP 標頭與權杖查表；Electron 實機確認每一項都被擋。

```js
// tests/fixtures/plugins/evil-escape/dist/main.js（plugin.json 需要 storage 與 feed）
const results = {}
const t = async (name, fn) => { try { results[name] = 'ALLOWED: ' + String(await fn()).slice(0, 60) } catch (e) { results[name] = 'blocked: ' + String(e && e.message || e).slice(0, 60) } }
export default {
  async activate(api) {
    await t('fetch https', () => fetch('https://example.com').then(r => r.status))
    await t('fetch loopback event server', () => fetch('http://127.0.0.1:17373/v1/events', { method: 'POST' }).then(r => r.status))
    await t('fetch app origin', () => fetch('agent-pets://app/index.html').then(r => r.status))
    await t('import other plugin module', () => import('agent-pets://plugin/ok-notify/dist/main.js').then(m => typeof m.default))
    await t('nested worker', () => new Promise((res, rej) => { const w = new Worker('agent-pets://plugin/ok-notify/dist/main.js', { type: 'module' }); w.onerror = () => rej(new Error('worker error')); setTimeout(() => { res('created'); w.terminate() }, 300) }))
    await t('BroadcastChannel', () => { const c = new BroadcastChannel('x'); c.postMessage('hi'); c.close(); return 'posted' })
    await t('indexedDB', () => new Promise((res, rej) => { const r = indexedDB.open('probe'); r.onsuccess = () => res('opened'); r.onerror = () => rej(r.error) }))
    await t('raw rpc via prototype', () => { const pm = DedicatedWorkerGlobalScope.prototype.postMessage; pm.call(self, { type: 'rpc', request: { id: 'spoof', method: 'pet.react', args: ['happy'] } }); return 'sent' })
    await t('storage round-trip', async () => { await api.storage.set('k', 1); return JSON.stringify(await api.storage.get('k')) })
    api.log.info(JSON.stringify(results))
  },
}
```

### H3（高）啟用插件數超過上限時，所有插件一起被停掉

- 位置：`main.ts` 的 `enabledPluginDescriptors()`。
- 問題：啟用數超過 `maxEnabledPlugins` 時直接回傳空陣列，第 11 個插件一啟用，前 10 個也全部停止，使用者看不到原因。
- 修正：`plugin-preferences-instance-set` 在 `enabled: true` 會超過上限時回 `{ ok: false, error: 'too_many_enabled' }`，面板顯示繁中／英文訊息（含目前上限與可到「進階」調整）；`enabledPluginDescriptors()` 不再整批清空，若資料異常超過上限，只取最早啟用的前 N 個並在診斷記錄。降低上限設定時同樣處理。

### M1（中）evil fixture 無法證明防護有效

- `evil-spoof` 只呼叫被 bootstrap 覆寫的 `self.postMessage`，沒有測到透過原型鏈繞過；`evil-fetch` 把錯誤吞掉，看不出結果。
- 修正：`evil-fetch`、`evil-spoof` 改為把每一項嘗試的結果用 `api.log.info` 寫出（同 H2 probe 的格式）；新增上述 `evil-escape`。phase report 的實機結果以這些 log 為證據。

### M2（中）面板上的已知未驗證流程

修完上面各項後，**實際在 Electron 中驗證** 並在 phase report 記錄結果：更新／降版／權限重新同意、移除時保留與不保留資料、從面板選取 `evil-zip`（含 `../` 與超量檔案）、偏好檔為 symlink 時的面板錯誤、Edge 模式的未讀徽章。

## 其他觀察（不需修）

- 啟動時 log 有 `Error occurred in handler for 'project-pets-get-enabled': Unauthorized IPC sender`：寵物視窗呼叫了只允許面板的 handler。這是 Phase 13 之前就存在的行為（handler 來自 `3641fb1`），不屬於本分支範圍，另案處理。

## 修正複檢結果（2026-10-23）

- 複檢對象：`7ef6837..9cdc3ae`（`aa7df60` 程式修正、`9cdc3ae` 報告）。
- 重跑檢查：`vue-tsc` 通過、`pnpm test:unit` 233/233、`vite build` 通過、`git diff --check` 通過、`pnpm audit --prod` 無弱點。
- 程式審查：partition 協定只服務隨機權杖路徑與 `_host` 資產；MessagePort 改由 `window.postMessage` 傳遞並檢查 `source`／`origin`／訊息且只收第一次；bootstrap 在載入插件前沿原型鏈移除 `indexedDB`、`caches`、`BroadcastChannel`、`Worker`、`SharedWorker`、`WebSocket`、`EventSource`、`XMLHttpRequest`、`fetch`、`postMessage`，移除失敗即拒絕啟動；RPC 成功回傳值、失敗 reject 帶 `code` 的 `Error`。
- **Electron 實機（未修補的 `9cdc3ae` 建置、隔離 `HOME`／userData）**：

| 項目 | 結果 |
|---|---|
| B1／B2 | 啟用插件後 Host 頁面與 Worker 正常執行 ✅ |
| H1 `ok-notify` | 通知為「Plugin ready / Storage round-trip passed.」✅ |
| H2 `evil-escape` | fetch（https／loopback／app）、跨插件 import、巢狀 Worker、BroadcastChannel、indexedDB、原型鏈 RPC 全部 blocked；storage round-trip 回 `{found:true,value:1}` ✅ |
| B4 `evil-loop` | 啟用 105 秒後狀態 `disabled_crashed`、偏好 `enabled:false`、通知中心出現「連續崩潰後已停用」；Host CPU 回到 0% ✅ |
| B3 | 對 Host 頁面送 `Page.crash` 後 Host 以新 target 重建，`ok-notify` 再次啟動 ✅ |

- 結論：**B1–B4、H1–H3、M1–M2 修正確認，Phase 13 通過**，可進 Phase 14。
- 未驗證（沿用 Codex 報告）：Windows、正式打包後的行為、連續三次真實協定載入失敗（僅單元測試覆蓋）。`project-pets-get-enabled` 未授權 IPC 記錄為既有問題，另案處理。
