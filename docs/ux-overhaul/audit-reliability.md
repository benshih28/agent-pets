# Agent Pets 可靠度 / 效能 / 主行程健壯性 / 開發測試體驗 稽核

範圍：`electron/main.ts`、`electron/main/*`、`event-server.ts`、plugin host、`agentStore.ts`、`tests/`、`scripts/`、CI。純讀取稽核，未改動 repo。所有修正不得弱化任何安全控制（sandbox、token、IPC sender 驗證、CSP、plugin 權限）。

---

## RL-01 主行程沒有任何全域錯誤兜底（uncaughtException / unhandledRejection）
- 嚴重度：高
- 證據：`grep process.on|uncaughtException|unhandledRejection|crashReporter` 在 `electron/`、`src/` 全無結果；`electron/main.ts:226` 的 `app.whenReady().then(async () => {...})` 之後（約 `main.ts:262-330` 以外）沒有 `.catch`。event-server 的 `request.on('end', async ...)`（`event-server.ts:100`）在 try 之外的 `onEvent` 例外會被吞成「invalid JSON 400」。
- 使用者影響：任何未捕捉的 rejection 在 Electron 會彈出原生錯誤對話框或讓主行程不穩，tray app 靜默死亡，寵物消失、hook 全部失聯。
- 子任務：
  - [ ] 在 `main.ts` 最上方註冊 `process.on('uncaughtException'/'unhandledRejection')`，寫入診斷檔並節流 toast，不顯示 Electron 預設對話框
  - [ ] `app.whenReady().then(...)` 末端加 `.catch`，失敗時仍顯示最小可用視窗或錯誤提示並引導「重試／匯出診斷」
  - [ ] 將 `whenReady` 內序列拆為各服務獨立 try/catch（plugin、history、achievement 已部分有，但 `createPluginServices`、`createPetWindow`、`createPresentationServices`、`createPermissionServices` 沒有），單一服務失敗不阻擋其他
  - [ ] event-server `end` handler 內把「JSON 解析失敗」與「onEvent 內部例外」分開處理（前者 400、後者仍回 204 並記錄）
  - [ ] 補 `app.on('child-process-gone')` 記錄 GPU/utility 行程崩潰
  - [ ] 全域錯誤記錄加去重與速率限制，避免錯誤迴圈灌爆磁碟
  - [ ] 新增 `tests/main-error-boundary.test.mts`（注入假 process 驗證 handler 被安裝且不拋出）
- 涉及檔案：`electron/main.ts`、`electron/main/runtime.ts`、`electron/event-server.ts`、新增 `electron/main/crash-guard.ts`

## RL-02 寵物／面板 renderer 崩潰或載入失敗沒有復原機制（寵物凍結／透明空窗）
- 嚴重度：高
- 證據：`runtime.ts:1711-1713` 與 `1819-1821` 的 `loadURL(...)` 回傳 Promise 完全沒處理；`webContents` 只掛 `will-navigate/will-redirect/will-attach-webview`（`runtime.ts:261-267`）。全 repo 唯有 plugin 視窗處理 `render-process-gone`（`plugin-host-window.ts:198`、`plugin-panel-view.ts:412`），主視窗沒有；也沒有 `unresponsive` / `did-fail-load`。
- 使用者影響：renderer OOM/GPU 崩潰後，桌面上留下無法互動的透明視窗或空白面板，只能手動結束程式；dev server 還沒起來時 loadURL 失敗會變成 unhandled rejection。
- 子任務：
  - [ ] 對 pet／panel 兩個 webContents 加 `render-process-gone`：記錄 reason、有上限地自動 `reload()`（退避，如 3 次/5 分鐘），超過則 tray 通知
  - [ ] 加 `unresponsive`／`responsive` 事件：提示或自動重載
  - [ ] 加 `did-fail-load`（排除 ERR_ABORTED）重試，並對 `loadURL().catch` 記錄
  - [ ] 崩潰重載後重新推送必要狀態（power-save、pet window mode、plugin badges、achievement、權限 UI 同步），目前這些多靠 `did-finish-load once`（`runtime.ts:1716`）只跑一次
  - [ ] agentStore 在 renderer 重載後需向 main 要求目前 session 快照（見 RL-04）
  - [ ] 面板窗 `showPanelWindow` 在 renderer 掛掉時改為重建視窗而非 show 一個壞視窗
  - [ ] 新增測試：以假 `webContents` EventEmitter 驗證重載退避與上限
  - [ ] tray 增加「重新載入寵物」手動救援項
- 涉及檔案：`electron/main/runtime.ts`、`electron/desktop-tray.ts`、新增 `electron/main/renderer-recovery.ts`、`tests/`

## RL-03 沒有檔案日誌與「匯出診斷」功能，錯誤只進 console
- 嚴重度：高
- 證據：全 repo 無 `electron-log`／檔案 logger；`runtime.ts` 僅 13 處 `console.error/warn`；唯一寫檔是 `achievements-init-error.log`（`runtime.ts:2476`）。打包後 console 無人看。
- 使用者影響：使用者回報「寵物不動了／hook 沒反應」時無任何可附上的線索；維護者無法重現。
- 子任務：
  - [ ] 建立輕量 logger（userData/logs/main.log，大小輪替如 1MB×3、級別、時間戳），取代散落 `console.error`
  - [ ] logger 內建 redaction（token、家目錄路徑、事件內容、secrets），符合「不上傳個人資料」原則，且僅寫本機
  - [ ] 設定頁／tray 增加「匯出診斷包」：版本、OS、port 綁定狀態、plugin host 失敗計數、history/achievement 初始化狀態、最近 N 行 log（已脫敏）
  - [ ] 將 `achievements-init-error.log` 併入統一 logger，並在診斷包呈現重試次數
  - [ ] plugin worker 的 `log.error` RPC 輸出進同一檔案但分 channel
  - [ ] 啟動時顯示「上次非正常結束」提示（寫 `running.lock` 標記，正常 quit 時清除）
  - [ ] 新增 logger 單元測試（輪替、redaction）
- 涉及檔案：新增 `electron/diagnostics/logger.ts`、`electron/main/runtime.ts`、`electron/desktop-tray.ts`、`electron/ipc/desktop.ts`、i18n locales

## RL-04 事件 Hook 的 17373 埠失效時使用者完全看不到（靜默失聯）
- 嚴重度：高
- 證據：`local-server-listen.ts:11-60` 對 EADDRINUSE 只 `console.error` 並無限重試（延遲封頂 30s）；非 EADDRINUSE 的 error（如 EACCES）只 log、不重試也不通報（`:31-34`）。`event-server.ts:136-141` 回傳 server 但不暴露「是否 listening」狀態；tray/設定頁無健康指示。e2e 腳本也註記測試版與正式版會搶同一埠（`scripts/e2e-isolated-electron.mjs:6-7`）。
- 使用者影響：舊實例、其他程式或測試版佔埠時，所有 agent hook 的事件全丟，寵物永遠 idle，而 UI 毫無異常提示。
- 子任務：
  - [ ] 將 listen 狀態（listening / retrying n / failed code）放進 `mainState` 並經 IPC 提供給 renderer
  - [ ] 面板與 tray 顯示「事件接收器離線，埠被佔用」橫幅與「重試／說明」
  - [ ] 重試達 N 次或非 EADDRINUSE 錯誤時發桌面通知（一次性，不洗版）
  - [ ] 提供埠衝突診斷：嘗試 GET 對方 `/v1/events` 判斷是否為另一個 Agent Pets（不洩漏 token）
  - [ ] hook 腳本端對 connect refused 的行為文件化（重試／靜默），避免拖慢 agent CLI
  - [ ] 對 permission/presentation 兩個 server（17374/17375）套用相同狀態曝光
  - [ ] 新增 `tests/local-server-listen.test.mts` 針對「EACCES 不重試仍通報」與狀態回報的案例
- 涉及檔案：`electron/local-server-listen.ts`、`electron/event-server.ts`、`electron/main/state.ts`、`electron/permission-adapter-server.ts`、`electron/presentation-mcp.ts`、`src/components/StatusPanel.vue`

## RL-05 Session 過期只轉 offline、不移除；renderer 重載後 session 全部遺失（幽靈與消失並存）
- 嚴重度：中高
- 證據：`agentStore.ts:1120-1132` 的 `cleanupStale` 只把 15 分鐘無更新（`SESSION_STALE_MS` `:50`）的 session 設為 `offline`，不 delete；僅靠 `MAX_SESSION_COUNT = 200`（`:51`）驅逐。計時器在 `document.hidden` 時整個停掉（`App.vue:39-69`）。session 完全存在 renderer 記憶體，main 無快照，事件由 `agent-status-event` 單向推送（`event-server.ts:34`）。
- 使用者影響：長時間運作後列表塞滿 offline 殘影；15 分鐘門檻對長任務（等待人工授權、長時間思考）會誤判 offline；renderer 重載/崩潰後所有進行中 session 消失，寵物誤顯示 idle。
- 子任務：
  - [ ] offline 超過 N 分鐘（如 30–60）自動從 index 刪除，並同步清 `moodTaskProgress`
  - [ ] stale 門檻依狀態區分：`waiting-permission` 不以 15 分鐘判死，改看 permission broker 是否仍有 pending
  - [ ] main 行程維護輕量 session 快照（最近狀態 + 時間），renderer 啟動／重載時透過 IPC 拉取
  - [ ] 隱藏視窗時不跑 interval，改以可見事件補跑——補跑時一次處理所有過期，確認不會閃爍（已有，補測試）
  - [ ] 提供「清除已結束 session」使用者按鈕
  - [ ] `cleanupStale` 與 `handleSuccessTimeout` 共用單一排程，降低喚醒次數
  - [ ] 測試：stale→offline→removed 時序、`waiting-permission` 不被誤殺、快照還原
- 涉及檔案：`src/stores/agentStore.ts`、`src/App.vue`、`electron/main/runtime.ts`、新增 session snapshot IPC、`tests/agent-session-index.test.mts`

## RL-06 多個常駐計時器永不停止／不隨電源狀態降頻
- 嚴重度：中
- 證據：
  - `runtime.ts:901` 的 plugin catalog 自動檢查 `setInterval` 每小時一次，沒存 handle，`before-quit` 也未清除。
  - `runtime.ts:2499` 本機用量掃描每 60s 全量掃描（`local-usage.ts:563-600`，最多 2000 檔、遞迴 `readdirSync/lstatSync/realpathSync.native`），不看 `onBattery`／視窗是否可見／使用者是否關閉用量功能。
  - `runtime.ts:202-224` `animateBounds` 以 8ms 間隔 setInterval 強制 `setBounds`（~125Hz，面板開關動畫），`pet-motion.ts:54-70` 拖曳輪詢也是 8ms。
  - `plugin-host-window.ts:318-319` ping／memory 兩個 interval 只要 host 存在就跑。
- 使用者影響：筆電閒置時仍週期性磁碟掃描與喚醒 CPU，耗電、風扇；Windows 上 8ms 計時器偏離螢幕刷新率造成多餘工作。
- 子任務：
  - [ ] 把 catalog 自動檢查 interval handle 存入 `mainState` 並於 `before-quit` 清除，且 `unref()`
  - [ ] 本機用量掃描：on-battery 時間隔拉長（如 5–10 分），或僅在 session 事件／面板開啟時觸發
  - [ ] 掃描改為增量：記錄目錄 mtime，未變動目錄跳過 walk（`filesUnder` 現在每次全走）
  - [ ] 掃描移到 worker／utility process 或分批 `setImmediate`，避免同步 fs 長時間阻塞主行程（`scanNow` 為同步函式，只是包在 Promise.resolve().then 內，仍佔主執行緒）
  - [ ] `animateBounds` 與拖曳輪詢改用 16ms 並以 `Date.now` 補間；pet 視窗隱藏時不啟動
  - [ ] plugin host 無 desired plugin 時關閉 ping/memory 計時器（目前依賴整個 host 被關）
  - [ ] 增加 `tests/` 驗證 quit 後無遺留 handle（用 `process.getActiveResourcesInfo`）
  - [ ] 在 docs/perf 補一個「閒置 CPU wakeups」基準
- 涉及檔案：`electron/main/runtime.ts`、`electron/local-usage.ts`、`electron/ipc/pet-motion.ts`、`electron/plugin-host-window.ts`、`scripts/bench/`

## RL-07 同步檔案／SQLite 工作在主行程熱路徑
- 嚴重度：中
- 證據：`history.ts`、`achievements.ts`、`progression.ts` 皆使用 `node:sqlite` `DatabaseSync`（同步），在 event-server 回呼內執行（`main.ts:~276-310`：progression `handleEvent`、achievement `recordEvent`、history `recordEvent` 依序同步執行），而回應 `response.writeHead(204)` 在 `onEvent` 之後才送出（`event-server.ts:118-121`）。`permission-audit.ts:10-22`、`plugin-registry.ts:140-160` 使用 `writeFileSync/renameSync`。
- 使用者影響：高頻事件（tool-running 心跳，單窗 500 筆/10s 上限 `event-server.ts:12`）下，每筆事件都同步寫 DB，主行程 event loop 被拖慢，造成 IPC 延遲、拖曳寵物卡頓、hook 請求變慢。
- 子任務：
  - [ ] 先 `response.writeHead(204)` 再執行 `onEvent` 副作用（用 `setImmediate`／微任務），hook 不再受 DB 耗時影響
  - [ ] history／progression 對「無新事實」的心跳事件做合併或節流（achievement 已做，history 與 progression 未見同樣短路）
  - [ ] 批次寫入：以單一交易合併 100–250ms 內事件
  - [ ] 確認三個 DB 都設 `journal_mode=WAL` + `busy_timeout`（achievements 有 `:449-451`；檢查 history、progression 是否一致）
  - [ ] 量測：在 `scripts/bench/` 加入 500 events/10s 負載下的 event loop lag（`perf_hooks.monitorEventLoopDelay`）
  - [ ] DB 損毀時自動改名備份並重建（目前失敗僅 `historyStore = null`，功能永久停用到下次重啟）
  - [ ] 重啟前不重試 history 初始化 → 加與 achievements 類似的重試排程（`scheduleAchievementStoreRetry` 只有 achievements 有）
- 涉及檔案：`electron/main.ts`、`electron/event-server.ts`、`electron/history.ts`、`electron/progression.ts`、`electron/main/runtime.ts`、`scripts/bench/`

## RL-08 事件管線在視窗銷毀／背壓情境下的靜默丟失
- 嚴重度：中
- 證據：`event-server.ts:35-39` 對 `webContents.send` 以空 `catch {}` 吞掉所有錯誤；`createOrderedBatchCoalescer`（`broadcast-coalescer.ts:28-42`）無佇列上限，`pending` 可無界成長；rate limit 為全域單一計數（`event-server.ts:46-58`），單一失控 hook 會讓所有合法來源收到 429；超限時回 429 但 hook 端多半不重試。
- 使用者影響：renderer 暫時無響應期間事件堆積在 main 記憶體；失控 agent 迴圈使其他 agent 的 `success/error` 事件被丟，寵物錯過完成／錯誤動畫與通知。
- 子任務：
  - [ ] coalescer 加最大佇列長度，超限時保留「終態事件（success/error/waiting-permission）」優先丟棄中間心跳
  - [ ] rate limit 改為 per-source／per-session 計數，並讓終態事件豁免或有獨立額度
  - [ ] `webContents.send` 失敗時記錄 log（節流），不是完全吞掉
  - [ ] 增加被丟棄事件計數器，納入診斷包（RL-03）
  - [ ] 視窗 reloading 期間（`did-start-loading`）暫存事件，載入完成後補送最近 N 筆
  - [ ] 測試：背壓下終態事件仍送達、限流不互相影響
  - [ ] 文件化 429 對各 hook 腳本的重試語意
- 涉及檔案：`electron/event-server.ts`、`electron/ipc/broadcast-coalescer.ts`、`tests/broadcast-coalescer.test.mts`

## RL-09 Plugin host 失敗 3 次後永久放棄，且缺少使用者可見復原路徑
- 嚴重度：中
- 證據：`plugin-host-recovery.ts:1-3,44-46`：`MAX_CONSECUTIVE_FAILURES = 3`，`shouldRetryPluginHost` 在第 3 次回 false；`plugin-host-window.ts:361-368` 此時 `desired.delete(pluginId)` 並 `terminate`。worker 重啟用裸 `setTimeout`（`:379`）未存 handle，`clearTimers`（`:371-378`）清不到，關閉 host 後仍可能觸發。`handleHostCrash` 只 `window.destroy()`（`:360-362`）。
- 使用者影響：plugin 因網路瞬斷／機器睡眠被判 ping 超時 3 次後就永久停用，直到重啟 App 才恢復；使用者不知道原因。
- 子任務：
  - [ ] 失敗計數加時間衰減（僅計入最近 N 分鐘；`resetAfterHealthyRuntime` 要求 60s 健康，睡眠喚醒時時鐘跳變易誤判）
  - [ ] 偵測 `powerMonitor` suspend/resume，resume 後重置 pong 時間戳與失敗計數，避免睡眠後誤殺全部 plugin
  - [ ] 放棄後在 plugin 管理頁顯示「已停用：反覆當機」狀態與「重新啟動」按鈕
  - [ ] 將 worker 重啟 timer 存入 Map，`clearTimers` 時一併清除
  - [ ] 記憶體超標路徑（`checkMemory` `:337-350`）是對所有 plugin `recordCrash`，一個肥 plugin 連帶殺全部——改為依 worker 報告歸因
  - [ ] crash 事件寫入 logger 並顯示在診斷包
  - [ ] 測試：睡眠喚醒、時鐘回撥、host 重啟後 timer 無洩漏
- 涉及檔案：`electron/plugin-host-window.ts`、`electron/plugin-host-recovery.ts`、`electron/plugin-host-memory.ts`、`src/components/plugin-panel/`、`tests/plugin-host-recovery.test.mts`

## RL-10 Plugin 面板／schedule 計時器與 async callback 的洩漏與 unhandled rejection
- 嚴重度：中
- 證據：`plugin-host-assets.ts:183` 中 `setInterval(() => { try { callback() } catch {} }, interval)` 只擋同步例外；async callback 的 rejection 在 worker 內未處理（Worker 內 unhandledRejection 會終止或污染 host）。`plugin-host-assets.ts:69` `setTimeout(() => worker.terminate(), 100)` 為裸 timer。`plugin-panel-view.ts:378` ackTimeout、`plugin-developer-mode.ts:68-71` debounce 在 destroy 路徑雖有清除，但需確認 cancel 後 pending callback 不會在銷毀後觸發（`plugin-developer-mode.ts:71` 吞掉 `.catch(()=>{})`，開發者看不到錯誤）。
- 使用者影響：壞掉的 plugin 以 async 例外拖垮整個 host（所有 plugin 一起重啟，見 RL-09）；開發者模式 reload 失敗無任何提示。
- 子任務：
  - [ ] schedule callback 以 `Promise.resolve().then(callback).catch(...)` 包裝並回報 `log.error`（不改權限模型）
  - [ ] worker 內安裝 `unhandledrejection` 處理，歸因至該 plugin 並計入其失敗計數，而不是殺 host
  - [ ] 對 schedule 重入（上一次尚未完成又觸發）做跳過，避免堆疊
  - [ ] developer-mode watcher 錯誤顯示於 plugin 管理頁而非吞掉
  - [ ] 補測 `destroy()` 後所有 timer 數量為 0
  - [ ] schedule 數量上限（每 plugin）檢查，防止無限註冊 interval
  - [ ] plugin 結束時自動 `clearSchedules` 已存在，補回歸測試
- 涉及檔案：`electron/plugin-host-assets.ts`、`electron/plugin-developer-mode.ts`、`electron/plugin-panel-view.ts`、`tests/plugin-host-*.test.mts`

## RL-11 Renderer 端缺少全域錯誤處理與使用者可見的失敗回饋
- 嚴重度：中
- 證據：`src/main.ts`、`src/App.vue` 找不到 `app.config.errorHandler`、`window.onerror`、`unhandledrejection`（grep 無結果）。agentStore 內 IPC 呼叫如 `refreshQuota`（`App.vue:57`）以 `void` 呼叫，失敗無 UI 提示。
- 使用者影響：Vue 元件渲染例外會讓寵物畫面局部失效而無人知曉；quota／歷史／安裝 hook 失敗時 UI 停在 loading 或舊值。
- 子任務：
  - [ ] `app.config.errorHandler` + `window.addEventListener('unhandledrejection')` → 經 IPC 送 main logger（脫敏）
  - [ ] 最外層 error boundary（`onErrorCaptured`）顯示「面板發生錯誤，重新載入」按鈕，呼叫 main 的 reload（接 RL-02）
  - [ ] 統一 IPC 呼叫 wrapper：失敗時回傳錯誤碼、store 設 `error` 狀態、顯示 inline 錯誤與重試
  - [ ] quota 刷新失敗顯示「資料可能過期」與上次成功時間
  - [ ] 整合測試：模擬 IPC reject，驗證 UI 錯誤狀態而非卡 loading
  - [ ] 錯誤訊息全走 i18n，不暴露路徑或 token
  - [ ] 將錯誤計數納入診斷包
- 涉及檔案：`src/main.ts`、`src/App.vue`、`src/stores/agentStore.ts`、`src/components/StatusPanel.vue`、`src/locales/`

## RL-12 啟動路徑為全序列 await，首次可見時間受最慢服務影響
- 嚴重度：中
- 證據：`main.ts:226-262`：`await createPluginServices()` 於 `createPetWindow()` 之前；其後又 `await syncPluginHost()`；`refreshInstalledIntegrationScripts()`（`:244`）同步寫檔；`createHistoryServices` 在視窗建立之後同步開 SQLite 並立刻 `reconcileAchievementsFromHistory()` 與觸發首次全量用量掃描（`runtime.ts:2499-2504`）。dev/prod 皆無啟動耗時量測。
- 使用者影響：開機登入時 plugin 目錄很多或磁碟慢，寵物晚數秒才出現；初次掃描與 reconcile 在啟動瞬間搶 CPU。
- 子任務：
  - [ ] 先建立 pet 視窗（可見），plugin/history/achievement 在其後非阻塞初始化
  - [ ] `createPluginServices` 把 registry 載入與 host 啟動拆開，host 啟動延後到 `ready-to-show` 之後
  - [ ] 首次用量掃描與 reconcile 延後（如視窗顯示 +10s 或 idle），避開啟動尖峰
  - [ ] 加入 `performance.mark` 啟動時間軸，輸出到診斷包與 `scripts/bench/`
  - [ ] `refreshInstalledIntegrationScripts` 改為內容 hash 相同則不重寫
  - [ ] 啟動目標預算寫入 docs/perf（如 pet 視窗 < 800ms）並以 bench 檢查
  - [ ] 測試：任一服務初始化丟例外不影響視窗顯示（對應 RL-01）
- 涉及檔案：`electron/main.ts`、`electron/main/runtime.ts`、`scripts/bench/phase-18.mjs`、`docs/perf/`

## RL-13 結束流程不完整：before-quit 未清所有計時器，且無優雅關閉等待
- 嚴重度：中低
- 證據：`main.ts:544-585` `before-quit` 清了多數 timer，但 `resizeAnimHandle`、`dragPollHandle`、`shimejiPersistHandle`、`persistBoundsHandle`、`edgeDwellHandle`、`pluginPanelResizeResetTimer`（皆宣告於 `main/state.ts:53-131`）以及 `runtime.ts:901` 的 interval 未見清除；SQLite `close()` 直接呼叫，沒有等待進行中的 `localUsageScanPromise`（`:2368` 的掃描仍在跑，只是把引用設 null）。待寫入的 `persistBoundsHandle`（防抖）若尚未觸發，視窗位置會遺失。
- 使用者影響：重啟後寵物位置回到舊位置；結束時偶發「Object has been destroyed」例外；最後一批 XP/歷史寫入可能丟失。
- 子任務：
  - [ ] `before-quit` 先 flush 待寫入（bounds、shimeji 位置、progression），再關閉 DB
  - [ ] 在 `mainState` 建立 `disposeAll()`，集中清除所有 handle，並以測試斷言 state 中無殘留 handle
  - [ ] 關閉前等待 `localUsageScanPromise`（有逾時上限）或使用 abort flag 中止掃描
  - [ ] `will-quit` 的 server `close()` 加 `closeAllConnections()` 避免 keep-alive 拖慢結束
  - [ ] 對 `app.relaunch()/exit` 路徑（`runtime.ts` window-controls 注入）共用同一清理
  - [ ] 測試：模擬 quit 序列，確認 flush 在 DB close 之前
- 涉及檔案：`electron/main.ts`、`electron/main/state.ts`、`electron/main/runtime.ts`、`tests/`

## RL-14 CI 與測試覆蓋缺口：沒有 lint、沒有 Electron 整合／e2e、沒有覆蓋率，主行程 runtime.ts 近乎未測
- 嚴重度：中
- 證據：`.github/workflows/ci.yml` 僅 `vue-tsc --noEmit`、`pnpm test:unit`、`vite build`，只跑 ubuntu（`runs-on: ubuntu-latest`），而產品支援 macOS/Windows 且有 Windows 專用程式（`windows-fullscreen-detector`、`koffi`）。`release.yml` 只在 prepare 階段跑 tsc 與 unit。`scripts/e2e-isolated-electron.mjs` 僅手動啟動器，無自動化斷言。`package.json` 無 `lint`／`coverage` script。`electron/main/runtime.ts` 2778 行、`main.ts` 610 行，`tests/` 無直接對應檔案；無測試涵蓋：renderer 崩潰、啟動失敗、埠衝突 UI、`agentStore` 的 stale/快照（僅 `agent-session-index`）、tray、window mode 動畫、主要使用者流程（安裝 hook→收事件→寵物反應→通知）。`tests/support/` 僅一個檔案。
- 使用者影響：回歸只在使用者機器上才發現（如 1.4.5/1.4.6 連續兩次 plugin panel 視窗修正）。
- 子任務：
  - [ ] CI 加 matrix（ubuntu、macos-latest、windows-latest）至少跑 unit 與 tsc
  - [ ] 新增 Electron 冒煙 e2e（使用 `e2e-isolated-electron.mjs` 的隔離與 stub safeStorage，不碰 Keychain）：啟動→POST 一筆事件→斷言 renderer 狀態→退出
  - [ ] 新增 `pnpm lint`（eslint 或 oxlint）與 `no-floating-promises` 規則，專抓 RL-01/02 類問題
  - [ ] 加 `node --test --experimental-test-coverage` 報表並設門檻（先以主行程模組為主）
  - [ ] 將 `runtime.ts` 拆出可注入依賴的純函式（computePanelBounds、animateBounds 等）並補測試
  - [ ] 為 agentStore 的 handleEvent／cleanupStale／eviction 補 store 級測試（Pinia + fake timers）
  - [ ] CI 加 `pnpm audit --prod` 與 `check:bundle` 步驟（package.json 已有 `check:bundle` 但 CI 未執行）
  - [ ] release workflow 在建置前重用 CI job，並在打包後對產物執行冒煙啟動
- 涉及檔案：`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`package.json`、`scripts/`、`tests/`

## RL-15 建置／開發體驗：腳本與基準未納入日常流程，dev 啟動與測試隔離有風險
- 嚴重度：低中
- 證據：`package.json` `prebuild` 以 `scripts/stop-agent-pets.mjs` 終止正在運行的 Agent Pets（可能誤殺使用者正在使用的實例）；`pnpm bench` 只有 `phase-18.mjs`，未接 CI；`dist-electron` 與 `release` 目錄存在於 repo 根（需確認 .gitignore）；`test:unit` 以 `tests/*.test.mts` glob 單進程跑 99 個檔案，無並行／過濾 script；dev 與正式版共用 17373–17375 埠（`e2e-isolated-electron.mjs:6-7`），開發時會與日常使用中的 Agent Pets 搶埠（見 RL-04）。renderer 最大 chunk `index-*.js` 141KB、`Card-*.js` 127KB，尚可，但無 bundle 預算檢查。
- 使用者影響：開發者易誤殺自己的正式版、測試與正式搶埠造成假陰性；效能回歸沒有機制攔截。
- 子任務：
  - [ ] `stop-agent-pets.mjs` 僅終止由本 repo 路徑啟動的實例，或加確認／`--force` 旗標
  - [ ] dev／e2e 模式支援以環境變數覆寫三個 port，避免與正式版衝突
  - [ ] 新增 `test:unit:watch`、`test:unit -- --test-name-pattern` 說明，縮短迭代
  - [ ] 把 `pnpm bench` 輸出與 `docs/perf/phase-18-baseline.md` 比對，PR 超過門檻時 CI 警告
  - [ ] 加 bundle size budget（vite plugin 或 `check:bundle` 擴充）
  - [ ] 確認 `dist/`、`dist-electron/`、`release/` 均在 `.gitignore`
  - [ ] 文件化「如何在不碰 Keychain 下跑 e2e」於 README 的開發章節
- 涉及檔案：`package.json`、`scripts/stop-agent-pets.mjs`、`scripts/e2e-isolated-electron.mjs`、`scripts/bench/`、`vite.config.mts`、`.gitignore`

---

## 優先順序建議
1. 先做 RL-01 / RL-02 / RL-03（兜底 + 復原 + 日誌）：其餘問題的可觀測性基礎。
2. 再做 RL-04 / RL-05 / RL-07（使用者最直接感受到的「寵物沒反應／幽靈 session／卡頓」）。
3. RL-06 / RL-12（耗電與啟動）、RL-09 / RL-10（plugin 穩定性）。
4. RL-14 為所有修正的回歸保護，建議與 1 並行。
