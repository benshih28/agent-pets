# Phase 15 複檢與修正清單

- 複檢對象：`feat/plugin-host` 的 `2061cab..3c5ebd6`（P15.0–P15.4）
- 複檢日期：2026-10-23
- 結論：**面板頁的隔離與功能在實機中大致正確，修正下列項目後即可進入 Phase 16。** Codex 因無法在啟動前證明資料隔離而停止實機驗收，判斷正確；複檢改用新增的隔離啟動腳本完成驗收。

## 使用者資料與鑰匙圈的確認

- 使用者真實 userData（`~/Library/Application Support/agent-pets`）中只有一個由開發版產生的 `plugin-preferences.json`（10/23 14:50，內容為全部預設值、插件總開關關閉、沒有任何插件）。已安裝的 1.2.4 不讀這個檔案，不影響使用；是否刪除由使用者決定。
- `~/.desktop-pet` 內的 hook 腳本與已安裝 App、`main` 分支完全相同；18:38 的寫入來自使用者重新啟動的已安裝 App（PID 3144），不是測試。
- 本次 Phase 15 修改沒有任何會在無密鑰時呼叫 `safeStorage` 的路徑；複檢啟動時以計數假實作確認呼叫次數為 0。

## 新增：隔離啟動腳本 `scripts/e2e-isolated-electron.mjs`

在 **任何 App 程式載入之前**，於 Electron 主程序完成：

1. `app.setPath('userData', <tmp>/ud)`，並以 `HOME=<tmp>/home` 啟動（`~/.desktop-pet`、`~/.claude` 等都寫到暫存資料夾）；
2. 把 `safeStorage` 換成會計數的假實作；
3. 驗證 userData、HOME 都在暫存資料夾、假實作已生效，**任一不符就直接結束，不載入 App**；
4. 印出 `AGENT_PETS_E2E_READY {...}`，再 `require(dist-electron/main.js)`。

計數可在主程序 inspector 以 `globalThis.__agentPetsE2E.calls` 讀取。交接 §0.4a 已改為一律使用這支腳本。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 291/291 |
| `pnpm exec vite build` | 通過 |
| `git diff --check` | 通過 |
| `pnpm audit --prod` | 無弱點 |

### Electron 實機（隔離啟動腳本；safeStorage 呼叫次數全程 0）

| 項目 | 結果 |
|---|---|
| 安裝 `panel-demo`（由 `docs/plugins/examples` 打包）、`ok-panel`、`evil-panel` | 皆成功 ✅ |
| `panel-demo`：讀 storage → 按鈕兩次 | 計數 0 → 1 → 2，狀態「Worker replied and saved the value.」✅ |
| `_shared/tokens.css` | 開發環境可載入（2 條規則）✅；正式打包見 P1 |
| 從設定 ▸ 插件 ▸「開啟插件面板」 | 外框顯示插件名稱、「插件內容」、×；`WebContentsView` 的位置（19,246,423×295）完全在外框下方內容區，標題列不會被蓋住 ✅ |
| `evil-panel`：API 暴露 | 只有 `feed,pet,storage,settings,log,net,ui`；沒有 `secrets`、`requestHost` ✅ |
| `evil-panel`：fetch https／127.0.0.1:17373／`agent-pets://app`／`_host/host.js`／自身檔案 | 全部 blocked ✅ |
| `evil-panel`：XHR、WebSocket、外部圖片 | blocked ✅ |
| `evil-panel`：`window.open`、`location.assign` 外站 | 回 null、仍停在原頁 ✅ |
| `evil-panel`：`window.parent`／`top` | 都是自己 ✅ |
| `evil-panel`：`permissions.query(camera)`、`Notification.requestPermission()` | `denied` ✅ |
| `evil-panel`：Service Worker 註冊 | blocked ✅ |
| `evil-panel`：外部 iframe | `onload` 有觸發但無法讀取內容（推測是 CSP `frame-src 'none'` 的錯誤頁）；未能直接證明沒有連外，見 P4 |
| 面板尺寸 | 開 `ok-panel` 時調整為 520×440；關閉並切到其他分頁後恢復 460×560 ✅ |
| 未測 | 真實相機／麥克風／定位請求（避免觸發 macOS 權限視窗，改以上面兩項替代）、拖放、下載、深淺色／高對比／reduced motion 視覺、Windows |

## 修正清單（給 Codex）

修完後依交接 §0.4、**新版 §0.4a（使用 `scripts/e2e-isolated-electron.mjs`）**、§0.4b 驗證。commit 訊息 `fix(plugin): [P15.R] ...`，最後一個加 `Checkpoint: P15.R`，push，更新 Phase 15 同一筆工作記錄（每個檔案都要有 changedFileChanges 狀態）與 phase report。完成後停止，不要開始 Phase 16。

### P1（高）正式打包後 `tokens.css` 會是空的

- 位置：`electron/main.ts` 以 `app.getAppPath()` 讀 `src/styles/tokens.css`。
- 問題：`package.json` 的 `build.files` 只打包 `dist/`、`dist-electron/`，正式版中沒有 `src/`，`_shared/tokens.css` 會回傳空字串，插件面板拿不到設計 token。開發環境正常，所以單元測試與複檢實機都看不出來。
- 修正：改為建置時嵌入，例如在 Electron main 用 `import tokensCss from '../src/styles/tokens.css?raw'`（Vite 會把內容打包進 `main.js`），不要在執行期讀 `src/`。加一個測試確認建置後的 `dist-electron/main.js` 含有 tokens 內容（或對打包路徑做等效檢查）。

### P2（中）外框與實際面板可能不同步

- 現象：複檢時曾出現一次「外框仍顯示『惡意面板測試 插件內容 ×』，但主程序已沒有任何 `WebContentsView`」的狀態（之後無法穩定重現）。使用者會看到空白的外框。
- 修正：主程序在面板關閉、銷毀、載入失敗、renderer 崩潰時，一律送事件（例如 `plugin-panel-view-closed`，含插件 id）給面板視窗；面板收到後收起外框並顯示對應訊息。另外處理「關閉後立刻開啟另一個插件」的順序：以遞增的開啟序號（open token）比對，舊的關閉事件不得關掉新的面板。
- 測試：模擬快速 close→open、載入失敗與 crash，外框狀態與主程序一致。

### P3（中）未從設定頁開啟時也能建立面板

- 現象：`openPluginPanelView` 直接呼叫時，主程序會建立 1×1 的 `WebContentsView` 並把面板視窗調成偏好尺寸，即使使用者不在插件分頁、畫面上沒有外框。
- 修正：只有在面板 renderer 回報外框已掛載（有有效 bounds）後才把 view 加入視窗、才調整尺寸；或在 IPC 層要求目前分頁是插件頁。外框不存在時不得顯示任何插件內容。

### P4（低）補齊實機驗證

在隔離啟動腳本下補做並記錄：

- iframe 指向外站：在主程序對該 partition 的 `webRequest.onBeforeRequest` 加計數或監看，證明沒有任何對外請求送出。
- 拖放檔案：用 CDP `Input.dispatchDragEvent` 對面板內容送出檔案拖放，確認 drop 被阻擋、沒有讀到檔案。
- 下載：觸發下載後確認暫存 HOME 中沒有產生檔案。
- 視覺：深色、淺色、高對比（`prefers-contrast: more` 以 CDP `Emulation.setEmulatedMedia` 模擬）、reduced motion 下截圖檢查外框。
- **不要** 觸發真實的相機、麥克風、定位請求（會跳 macOS 權限視窗）；權限拒絕以 `permissions.query`、`Notification.requestPermission` 等不會跳系統視窗的 API 驗證即可。
- 修改 `tests/fixtures/plugins/evil-panel/ui/panel.js`：移除 `getUserMedia` 與 `geolocation.getCurrentPosition` 探測，改用 `navigator.permissions.query({ name: 'camera' })`、`navigator.permissions.query({ name: 'geolocation' })` 與 `Notification.requestPermission()`，避免任何人執行探測時跳出 macOS 權限視窗；同步更新 phase report 的手動驗收步驟。

---

# P15.R 複檢（`15298cc..833ad94`）

- 複檢日期：2026-10-26
- 結論：**P1、P2、P4 通過；P3 只修了一半，需再做一輪小修（P15.R2）後才進 Phase 16。**
- Codex 未觸碰鑰匙圈：`git config` 沒有被修改（全域 `credential.helper=osxkeychain` 原樣保留），只是 push 時臨時停用；分支未推送的 2 個 commit 由複檢者推送。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 296/296 |
| `pnpm exec vite build` | 通過 |
| `node scripts/check-plugin-panel-tokens-bundle.mjs` | 通過 |
| `git diff --check 15298cc..HEAD` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |

### Electron 實機（`scripts/e2e-isolated-electron.mjs`；userData／HOME 皆在暫存資料夾，safeStorage 呼叫次數全程 0）

| 項目 | 結果 |
|---|---|
| P1：`panel-demo` 載入 `_shared/tokens.css` | 2 條規則，`--surface-panel` 有值 ✅（內容已編進 `dist-electron/main.js`，不再讀 `src/`） |
| P2：從寵物連續開 ok-panel → evil-panel → ok-panel（同時送出） | 最後只剩 1 個 view，外框標題與 view 內容一致 ✅ |
| P2：按 × 後立刻開 evil-panel | 外框顯示「惡意面板測試」，view 內容為 `EvilPanelFixture` ✅ |
| P2：`forcefullyCrashRenderer()` | view 移除、外框收起、顯示「插件面板發生錯誤，已關閉。」✅ |
| P3：直接呼叫 `openPluginPanelView` 不帶 bounds 或帶 0 寬 | `panel_unavailable`，沒有 view、沒有改尺寸 ✅ |
| P3：直接呼叫、帶「看起來合法」的 bounds，但使用者在「工作階段」分頁、畫面上沒有外框 | **建立了 view、視窗被改成 520×440；顯示面板視窗後插件內容直接出現在工作階段分頁上，沒有任何外框** ❌（見 P3-R） |
| P4：evil-panel 探測 | secrets／requestHost 未暴露；fetch、XHR、WebSocket、跨插件檔案、`window.open`、導覽皆被擋；camera／geolocation／notification 皆 `denied`；暫存 HOME 內沒有下載檔 ✅ |
| 外框與 view 位置 | 外框 (18,193,485×229)，view (19,246,483×175)，在標題列下方 ✅ |

## 修正清單 P15.R2（給 Codex）

修完後依交接 §0.4、§0.4a（`scripts/e2e-isolated-electron.mjs`）、§0.4b 驗證。commit 訊息 `fix(plugin): [P15.R2] ...`，最後一個加 `Checkpoint: P15.R2`，push，更新 Phase 15 同一筆工作記錄（每個檔案都要有 changedFileChanges 狀態與 provenance）與 phase report。完成後停止，不要開始 Phase 16。

### P3-R（中）主程序仍完全相信 renderer 給的 bounds

- 現象：主程序只檢查 bounds 數值是否落在視窗內，不知道外框是否真的掛在畫面上。renderer 在其他分頁、甚至視窗隱藏時傳入合理數值，就會建立並顯示 view；而且 renderer 拿不到這次的 `openToken`，事後也無法關掉它，只能等停用插件或開別的面板。
- 修正（建議做法）：
  1. `open()` 建立 view 後一律保持 `setVisible(false)`，回傳 `openToken`；
  2. renderer 拿到 token 後送出第一筆 `plugin-panel-view-bounds`（token 相符、bounds 合法），主程序才 `setVisible(true)`；
  3. 開啟後 2 秒內沒有收到相符的 bounds，主程序以 `renderer_unavailable` 關閉；
  4. 面板視窗 `hide` 或 renderer 重新載入時，主程序關閉目前的 view；
  5. 若面板視窗不可見，`plugin-panel-view-open` 直接回 `panel_unavailable`，不改尺寸。
- 測試：單元測試涵蓋「沒有 ack 就不顯示、逾時關閉、hide 時關閉、token 不符的 ack 無效」；實機重做上表 ❌ 那一列，結果應為「沒有 view 或 view 不可見並在 2 秒內關閉，視窗尺寸還原」。

### P5（低）正式程式碼裡的測試專用掛鉤

- `electron/main.ts` 的 `onBlockedRequest` 寫死 `example.com` 計數，屬於測試細節；實測該計數一直是 0（CSP 在網路層前就擋掉）。請移除 `example.com` 特例，只保留通用計數，或整段移除並改在 phase report 記錄 CDP 證據。

### P6（低）tokens 打包檢查沒有接到任何流程

- `scripts/check-plugin-panel-tokens-bundle.mjs` 目前只能手動執行。請在 `package.json` 新增 `check:bundle` 指令，交接 §0.4 的檢查清單加上「build 後執行 `pnpm check:bundle`」，並在 `.github/workflows/release.yml` 的 build 之後執行一次。

---

# P15.R2 複檢（`c9c82e7..f28c4d9`）

- 複檢日期：2026-10-26
- 結論：**Phase 15 通過，可以進入 Phase 16。**

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 303/303 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `git diff --check c9c82e7..HEAD` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |

### Electron 實機（隔離啟動腳本；safeStorage 呼叫次數全程 0）

| 項目 | 結果 |
|---|---|
| 面板視窗隱藏時直接呼叫 `openPluginPanelView`（合理 bounds） | `panel_unavailable`，沒有 view、尺寸不變 ✅ |
| 視窗可見、使用者在「工作階段」分頁，直接呼叫並帶合理 bounds | 回傳成功但 view 保持不可見；約 2 秒後關閉，視窗尺寸還原 460×560 ✅（P15.R ❌ 那一列已修正） |
| 從寵物正常開啟 `panel-demo` | view 可見、位置在外框內容區；按鈕後計數更新 ✅ |
| 同時送出開 ok-panel、evil-panel | 只剩 evil-panel 一個 view，外框標題一致 ✅ |
| 面板開啟時隱藏視窗 | view 關閉 ✅ |
| renderer crash | view 關閉、外框收起並顯示錯誤 ✅ |
| 面板視窗重新載入 | view 關閉 ✅ |
| P5：`example.com` 特例 | 已移除 ✅ |
| P6：`check:bundle` | 已加進 `package.json`、交接 §0.4、release workflow ✅ |

## 不阻擋的觀察

- 開啟計時從 `loadURL` 之前開始。插件頁若載入超過 2 秒（例如很大的本機檔案），面板會被當成沒回報而關閉。目前本機載入只要幾毫秒，先記錄，不要求修改。
- 面板開啟時隱藏視窗，下次打開會看到「插件面板外框尚未就緒，請重新開啟面板。」這句提示對使用者有點多餘，Phase 16 若有動到 `PluginPanel.vue` 可順手改成隱藏時不顯示錯誤。
- `project-pets-get-enabled` 的 `Unauthorized IPC sender`：這是 `main` 分支既有的行為，與插件無關。寵物視窗與面板視窗共用 `agentStore`，寵物視窗載入時也會呼叫這個只允許面板視窗的 IPC，被拒絕後就當作「未啟用」。只影響寵物視窗自己的那份狀態，功能不受影響，但每次啟動都會在 log 留一筆錯誤，建議另外修。

## 為 Phase 16 調整的交接內容

- `scripts/e2e-isolated-electron.mjs` 新增 `--app-root <dir>`，可在隔離環境中執行解開後的打包內容。
- 交接 P16.6：實測改用隔離啟動腳本，不再用 `pnpm dev`；打包驗證改成 `electron-builder --dir` → 解開 `app.asar` → `--app-root`。禁止 `pnpm build`／`build:fast`（會關掉使用者正在用的 App），也禁止直接開啟打包出來的 `.app`。
