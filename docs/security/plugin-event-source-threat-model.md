# 插件 Agent 狀態來源威脅模型

## 狀態與範圍

本文件是 P17.5 的設計閘門，供複檢後再決定 P17.6 的實作契約。此 checkpoint 不新增 eventSource 執行能力。模型涵蓋已安裝插件透過宿主要求寵物顯示狀態的流程；不涵蓋插件如何從外部 Agent 取得資料，也不驗證插件所宣稱狀態的真實性。

安全目標是把插件狀態限制為有來源標記、短期存在的顯示資料。它不得成為內建 Agent 事件，不得影響 Permission、寵物自主行為、XP、成就、History、quota、通知或任何持久化記錄。

## 資產與攻擊者

- **資產：** 內建 Agent 身分與狀態、Permission Broker、寵物行為與 XP、成就與 History、quota 資料、使用者對狀態來源的判斷，以及 Main 程序的穩定性。
- **攻擊者：** 已安裝且獲准使用 Agent API 的惡意或遭入侵插件；可能偽造狀態、冒用內建來源名稱、重放舊資料、塞入大量工作階段或在停用後繼續送出資料。
- **能力假設：** 插件可呼叫明確授權的 Host API，並可完全控制傳給 API 的參數與呼叫頻率；不能信任其 manifest 文字、狀態聲明、session ID 或時間戳。

## 建議的輸入與狀態契約

P17.6 的 `api.agent.emit(event)` 應採嚴格 allowlist，成功直接回傳值，失敗回傳既有帶 code 的 `Error`。建議每個事件僅接受 `{ sessionId, state }`；未知欄位一律以 `invalid_request` 拒絕，不可靜默忽略。插件 ID、family、顯示名稱、時間戳與生命週期都由 Main 從已驗證的插件執行個體及 manifest 取得或產生，不接受插件自行指定。

允許的 state 僅為：

| 插件狀態 | 顯示用途 | 限制 |
|---|---|---|
| `thinking` | 正在處理 | 只更新插件自己的顯示列 |
| `tool-running` | 正在執行工具 | 不接受工具名稱或命令內容 |
| `idle` | 暫無活動 | 不代表內建 Agent 已閒置 |
| `done` | 工作階段完成 | 僅為顯示終態；不得映射成可進入 Agent event pipeline 的 `success` |
| `error` | 插件回報工作階段出錯 | 僅顯示狀態，不記錄錯誤文字或 log |

不接受 `waiting-permission`、`waiting-input`、`waiting`、`offline`、內建 Agent 的 `success`、Permission request/notice/response 或任何未知值。`sessionId` 是插件範圍內的不透明識別碼，建議 1–64 個 ASCII 字元；只存於記憶體，不當作路徑、專案名稱、Agent ID 或使用者資料。時間由 Main 以接收時間建立，不接受插件時間戳。`done` 與 `error` 為終態；若要開始新工作階段，必須使用新的 session ID。

## 信任邊界與資料流

1. **插件 Worker → Main IPC：** 只接受由 PluginBroker 依 Worker 身分綁定的插件呼叫。不可從參數讀取 pluginId；未宣告 `contributes.eventSource`、未授權、已停用或已終止的 Worker 一律拒絕。
2. **Main → 暫存顯示投影：** 經專用的插件狀態驗證器與限流器後，寫入獨立、記憶體內的插件狀態 store。store 的 key 至少包含宿主認定的 pluginId 與 plugin family；不得轉成 `AgentStatusEvent` 或 `AgentSession`。
3. **顯示投影 → Renderer：** 僅送出狀態、由 manifest 取得並清理過的顯示名稱、插件來源標籤及宿主接收時間。UI 固定顯示「Plugin」／「來自插件」來源標記，插件文字一律純文字呈現。
4. **生命週期 → 暫存顯示投影：** 停用、移除、崩潰、重新載入插件或宿主關閉時，立即清除該 pluginId 的所有狀態、限流記錄與計時器。使用 generation/token 防止停用前排隊的 IPC 在清理後重新寫入。

此顯示投影只可更新插件專屬的狀態列／展示元件，不得變更內建 Agent 的狀態、寵物自主決策、動畫排程或目前使用中的 Agent。過期或清除時只移除插件列。

## 不得進入的能力與資料路徑

插件狀態不得建立、讀取、回覆或解除 Permission；不提供 Permission Broker handle，也不新增能轉送 Permission 決策的 callback 或 IPC。輸入中出現 permission 相關欄位時拒絕整筆事件。

事件不得呼叫或進入下列程式路徑：

- `createEventServer`、`normalizeIngressEvent`、`AgentAdapterRegistry.normalize()` 或 `agent-status-event`。
- `ProgressionStore.handleEvent()`、`AchievementStore.recordEvent()`、`HistoryStore.recordEvent()`、`HistoryStore.recordQuotaSnapshot()`。
- desktop notification、project routing、內建 Agent session store、Permission Broker、quota adapter 或寵物行為 scheduler。

P17.6 應以測試 spy 或邊界測試證明有效與無效插件事件都沒有呼叫上述副作用，且停用／移除／崩潰會即時清空插件狀態。

## 家族名稱與防冒充

`contributes.eventSource.family` 應是小寫 ASCII slug，並與插件 ID 一起形成插件專屬名稱空間。至少保留 `codex`、`claude`、`claude-code`、`opencode`，以及內建來源 ID `codex-desktop`、`claude-desktop`、`opencode-cli`、`opencode-desktop`；比較前先做大小寫與分隔符正規化，拒絕可正規化成保留字的值。外部插件間相同 family 不代表相同來源，UI 不得依 family 合併或替換內建來源。

顯示名稱只能來自已驗證 manifest 的 `displayName`，長度設上限並去除控制字元；每列都要呈現「來自插件」標記及插件名稱。family slug 只作為插件自己的技術分類，不能顯示成 Claude、Codex、OpenCode 的官方 Agent 標題。無法取得安全標籤時拒絕顯示，不退回到內建來源名稱。

即使有來源標籤，插件仍可捏造狀態內容；UI 必須把它呈現為「插件宣稱的狀態」，不得暗示宿主已驗證該 Agent 或工作階段。

## 限流、容量與清理建議

以下是 P17.6 的保守初始上限，應由複檢確認後才作為公開契約；所有計數以 Main 的單調時鐘為準：

- 每插件每 60 秒最多 30 次有效事件，另設全域每 60 秒最多 120 次；超限回傳 `rate_limited`，拒絕寫入。
- 每插件最多 20 個活躍 session，全宿主最多 100 個；超限回傳 `rate_limited`，不可先移除其他插件的狀態騰出空間。
- 每筆事件上限 2 KiB；session ID 上限 64 bytes；manifest 顯示名稱上限 80 個 Unicode code points。超限回傳 `invalid_request`。
- 活躍狀態閒置 2 分鐘即過期；`done`／`error` 只保留 30 秒；任何 session 最長 30 分鐘。插件不能自行延長 TTL 或回填時間。
- 停用、移除、崩潰、reload、全域插件開關關閉及 App 結束時立即清除所有該插件暫存資料；不做磁碟快取、History 或背景復原。

限流狀態和 session 容量只按宿主驗證的 pluginId 隔離。清除限流記錄不得令仍啟用的插件透過重啟 Worker 繞過全域限制；重新啟用後不保留舊狀態。

## 與既有 `agent-adapter.ts`／`generic-http` 的關係

可借用的僅是**驗證原則**：拒絕非物件輸入、逐欄位驗證型別、字串與 payload 上限、明確 state allowlist、宿主產生接收時間，以及對 malformed input fail closed。若共用程式碼，應抽出不帶來源副作用的純驗證器，並由插件專用型別表示結果。

不可直接重用 `normalizeAgentStatusEvent()`、`AgentAdapterRegistry`、Generic HTTP adapter 或其 ingress handler。現有 normalizer 接受內建 `source`、`project`、`toolName`、token usage 與 event ID，並接受 permission/waiting 狀態及內建 `success`；這些欄位不符合插件最小輸入契約。更重要的是，`event-server.ts` 正規化後會廣播 `agent-status-event` 並呼叫 `onEvent`；Main 的該路徑可觸及通知、XP、成就與 History。`generic-http` 的 capability 雖設定 `permissions: 'none'`，它不是 plugin eventSource 的安全隔離層，也不保證事件沒有上述副作用。

因此 eventSource 必須使用不同 IPC 方法、不同資料型別、不同記憶體 store 與不同 renderer 通道；不得把它偽裝成 `generic-http` 或使用內建 Agent 的 source/family。P17.6 前應由複檢者確認 generic-http 現有 ingress 對 terminal success 等事件的 XP／History 行為是否符合該 adapter 的產品預期；此議題不以新增 eventSource 權限來解決。

## 威脅與控制

| 威脅 | 控制 | 殘餘風險 |
|---|---|---|
| 偽造內建 Agent 狀態 | 插件狀態使用獨立型別與 store；family 保留字檢查；每列固定來源標記；不輸入內建事件通道。 | 使用者仍可能忽略「來自插件」標記；插件可謊稱自己的狀態。 |
| 以事件觸發 Permission 或回覆 Permission | API 僅提供狀態 emit；嚴格拒絕 permission/waiting 欄位；不暴露 Broker handle 或回應 IPC。 | Host API 其他已授權功能仍由既有權限與 broker 控制，需由其測試覆蓋。 |
| 事件誤觸 XP、成就、History、quota 或通知 | 不建立 `AgentStatusEvent`；獨立顯示 store；測試確認副作用 spy 次數為 0。 | 未來程式若把 plugin store 接回共用 event pipeline，可能重新引入副作用；需保留邊界測試。 |
| 事件洪水或大量 session 耗盡資源 | 每插件及全域速率、session、payload 上限；拒絕超額資料；store 限量並定期清理。 | 多個插件同時達上限仍會消耗固定上限內的記憶體；上限數值需依實際產品量測調整。 |
| 停用後舊 Worker 或排隊 IPC 重新注入狀態 | 停用／崩潰同步清理並增加執行世代；寫入時再次確認 Worker 狀態與世代。 | Main 程序的生命週期錯誤仍可能造成短暫狀態殘留；需要競態測試。 |
| session ID 或顯示名稱帶入路徑、控制字元或隱私資料 | ID 嚴格限制；名稱取自 manifest 並清理；不接受專案、命令、路徑、使用者文字或時間戳；不寫 log／磁碟。 | 惡意作者可將資訊藏在允許的顯示名稱中；需限制長度並清楚標示插件來源。 |

## P17.6 實作閘門

開始實作前需由複檢確認：

1. 確認允許狀態、`done` 顯示映射及 terminal 重用 session 的規則。
2. 確認 family 保留字正規化方式及插件名稱空間呈現。
3. 確認本文件的速率、session、payload、TTL 與清理上限；目前數值是保守建議，不是已實作或已驗證行為。
4. 確認 Generic HTTP 現有 event ingress 的產品副作用是否符合預期，並確保 eventSource 不共用該 ingress。
5. 要求測試證明 Permission 無法觸發／回應，且 XP、成就、History、quota、通知、Agent event pipeline 均未被呼叫；disable/remove/crash/reload 清除狀態與限制記錄。

## 殘餘風險與待決

- 插件狀態無法證明來自真實 Agent；此功能只顯示插件提交的聲明。
- 速率、session、payload 與 TTL 數值需複檢確認，未確認前 P17.6 不應開始。
- Generic HTTP 的既有成功事件是否可觸發 XP／History 屬於既有 ingress 行為，須在 P17.6 前確認其產品預期；此問題不授權插件 eventSource 進入該路徑。
