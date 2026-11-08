# Agent Pets 桌面寵物本體 — 體驗稽核報告（audit-pet）

範圍：桌寵本體（DesktopPet / PetAnimation / App.vue 的 hit-test / shimeji / mini・edge 模式 / 拖曳 / 氣泡 / 狀態動畫映射 / 自訂素材 / Presentation MCP 可見效果）。
方式：純讀碼稽核（repo 唯讀，未改任何檔、未碰 `.claude/`），所有證據為 `檔案:行號`。未實機執行，標示「推測」者代表由程式結構推導、需實機確認。
規範對照：`liquid-glass.md`（功能層才用玻璃、避免 glass-on-glass、不得僅以顏色/透明度表達狀態、支援 reduced-motion/contrast/transparency）。

總計：**20 個大問題**（P0 × 6、P1 × 11、P2 × 3），**約 165 個子任務**。最後附「並行衝突矩陣」與「新互動／畫面設計（ASCII）」。

---

## 0. 一句話診斷

這隻寵物「技術上很用心（多層防呆、安全邊界、效能閘門）」，但**產品體驗上很啞**：預設值把所有會讓它「活起來」的功能（反應動畫、氣泡、Shimeji、音效）全關掉；打開之後，氣泡蓋在臉上、內容只有「Claude Desktop · repo」、錯誤沒有原因、等待輸入沒有通知；動畫是硬切、錯誤永久停格；邊緣／迷你模式有誤觸與無狀態指示；hit-test 只在 mousemove 才更新；效能上每一格動畫都 3 個 canvas + `getImageData`。使用者感受到的是「一堆細節都不順」。

---

## P0 — 必修（直接影響「這東西有沒有用」）

### PET-01　P0　預設就是「啞巴寵物」：所有讓寵物有反應的功能預設關閉
- **證據**
  - `src/stores/agentStore.ts:336` `reactionsEnabled` 預設 `=== '1'`（預設 false）；`:339` `bubbleEnabled` 預設 false；`:365` `shimejiEnabled = ref(false)`；`:326` `soundEnabled` 預設 false；`:331` `multiPetEnabled` 預設 false。
  - `src/components/PetAnimation.vue:689-705`：所有 ambient／fidget／urgent／reacting／rewarding class 都被 `store.reactionsActive` 擋住；預設下點擊寵物只會切換面板（`DesktopPet.vue:513-522`），寵物本身毫無回饋。
  - 完成／失敗 toast 受 `bubbleActive` 擋（`DesktopPet.vue:212-216`、`agentStore.ts:1108` 只在事件發生時建立 toast，但顯示被 `bubbleEnabled` 擋）。
- **使用者影響**：新手安裝後 agent 做完事，只有 sprite 換 row；沒有「完成了！」「出事了」的明顯回饋。使用者會以為「這只是個會動的圖示」，讀不到產品價值，也找不到開關在哪（設定藏在面板）。
- **子任務**
  - [ ] 重新定義預設值：reactions=on、bubble=on（僅 success/error/waiting 三種關鍵事件）、shimeji=off（保留 opt-in）、sound=off。保留「減少動態」與 DND 覆蓋。
  - [ ] 以 schema 版本（如 `agent-pet-defaults-version`）做一次性遷移：既有使用者明確選過 off 的不覆蓋；從未動過設定的才套新預設。
  - [ ] 把 reactions／bubble 拆成「關鍵事件回饋（預設開）」與「裝飾性環境動畫（預設關）」兩層，避免「為了要通知而被迫開抖動」。
  - [ ] 首次啟動 coach mark：寵物頭上一句「點我看工作階段、拖我換位置、右鍵更多」，點過一次或 20 秒後消失，記錄 `agent-pet-coach-v1`。
  - [ ] SetupWizard 末步加入「回饋強度」三段（安靜／標準／熱鬧）取代散落的 4 個 toggle。
  - [ ] DND 開啟時仍保留「權限請求」不可被吞掉的最小提示（現況 `isDesktopEffectActive` 全擋，需確認 permission 泡泡不受影響）。
  - [ ] 補單元測試：預設值、遷移、DND、reduced-motion 的組合矩陣（`tests/desktop-pet-bubbles.test.mts` 擴充）。
  - [ ] 設定頁 help 文案改為描述「你會看到什麼」而非「啟用 xx」。
- **修改檔案**：`src/stores/agentStore.ts`、`src/utils/desktop-effects.ts`、`src/components/status-panel/Settings*.vue`、`src/components/SetupWizard.vue`、`src/locales/*.json`、`tests/desktop-pet-bubbles.test.mts`（與 PET-02/03 共用 store，需序列化）

### PET-02　P0　氣泡位置錯：蓋在寵物臉上，頭上 190px 空白不用
- **證據**
  - `DesktopPet.css:894-901` `.pet-toast { position:absolute; top:max(2px,…) }` 相對於 `.pet-click-area`（`:8-20`），而 click-area 只包 sprite + 狀態列；視窗上方預留的 `QUOTA_TOOLTIP_HEADROOM_H = 190`（`agentStore.ts:77`、`:1286`）在 click-area **之外**。
  - `agentStore.ts:1279-1282` 註解明講「toast/activity 氣泡不長高視窗，直接 overlay canvas」。
  - `DesktopPet.css:1113-1124` 尾巴 `::after` 在氣泡底下 -5px，指向的是 sprite 的頭頂**內側**，而不是頭上方。
  - `DesktopPet.css:733-751` permission 卡同樣 `top:2px` 疊在 sprite 上，遮住寵物本體（互動時看不到寵物的表情）。
- **使用者影響**：每次通知都把寵物臉蓋住；氣泡尾巴指向錯誤；與「說話泡泡」的心智模型相反；寵物縮小（scale 0.3-1）時氣泡甚至比寵物大。
- **子任務**
  - [ ] 把氣泡容器改成獨立 `.pet-bubble-layer`，錨定在 sprite 頂部**之上**（`bottom: calc(100% + 6px)` 相對 `.pet-visual` 上緣），利用既有 190px headroom，不需改視窗尺寸。
  - [ ] 尾巴改為指向 sprite 頭部中心；多寵物時指向目標寵物（`pluginFeedTargetStyle` 的作法抽成共用 composable）。
  - [ ] 氣泡高度上限 + 超出時向上延伸不超過 headroom；超過則 clamp 並可展開（見 PET-03）。
  - [ ] 視窗貼近螢幕上緣時（`workArea.y` 與視窗 y 差 < 氣泡高度）自動翻到 sprite 下方或側邊（需主行程回報可用上方空間：新增 `pet-bubble-space` IPC 或由 renderer 用 `window.screenY` 推算）。
  - [ ] 氣泡進出場改成「從嘴巴位置彈出」（transform-origin 對齊尾巴），目前 `toast-enter-from` 是 `scale(.9) translateY(6px)` 無方向感（`DesktopPet.css:1195-1199`）。
  - [ ] permission 卡改為「寵物上方卡片 + 寵物仍可見」，並限制高度不吃掉 sprite；拖曳時氣泡跟著移動（目前靠視窗，OK）但 mini 模式要隱藏。
  - [ ] 字級改用 token（現為 `max(10px, 11px*scale)` 寫死於 `:907`），並依 scale 設下限 12px。
  - [ ] 針對 scale 0.3 / 1 / 2 / 5 與 4 種 edge 位置補 screenshot 測試。
- **修改檔案**：`src/components/DesktopPet.vue`（template 氣泡區）、`DesktopPet.css`（:733-1215）、`src/stores/agentStore.ts`（headroom 常數）、新增 `src/composables/usePetBubbleLayout.ts`

### PET-03　P0　氣泡「資訊量」太低且壽命固定：看不懂發生什麼、來不及看完
- **證據**
  - `agentStore.ts:428-436`：完成／失敗 toast 文字只有 `${SOURCE_LABELS[source]} · ${project}`，沒有「完成」「失敗」字樣，也無耗時、無錯誤摘要；語意只靠邊框色（`DesktopPet.css:1126-1134`）。
  - `src/utils/toast-countdown.ts:1` 固定 3 秒、`success` 與 `error` 同長；無 hover 暫停、無點擊展開。
  - Presentation `say` 預設 TTL 4 秒（`electron/presentation-controller.ts:15`），上限 240 字（`:18`），但氣泡 CSS 沒有 line-clamp／max-height（`DesktopPet.css:937-957`，僅 `overflow-wrap:anywhere`），240 字的氣泡會長到超出視窗上緣被裁；而 4 秒不足以讀 240 字。
  - 活動氣泡直接顯示原始 `toolName` 並前綴 `🔧`（`DesktopPet.vue:729-731`），例如 `mcp__server__tool_name`，沒有人類可讀化、沒有截斷提示。
  - 多寵物模式完全不顯示活動氣泡（`DesktopPet.vue:215` `!isMultiPet`）。
- **使用者影響**：離開座位 5 秒回來，什麼都沒留下；錯誤只知道「某個 repo 紅了」，要打開面板才知道原因；`pet_say` 的內容被截斷或來不及看。
- **子任務**
  - [ ] toast 文案改為「語意 + 來源 + 專案」：`完成 · Claude · agent-pets`／`失敗 · Codex · agent-pets`，帶圖示（✓／!）不只靠顏色（符合 liquid-glass「不得只靠顏色」）。
  - [ ] 失敗 toast 延長到 6–8 秒並且 hover 暫停；點擊 toast = 開面板並定位到該 session（`store.openSession(key)`）。
  - [ ] 若 `AgentStatusEvent` 有錯誤摘要欄位（目前沒有；需在 `event-normalizer.ts` 補一個 sanitised `summary`≤80 字），顯示於第二行。
  - [ ] 顯示耗時（`lastSeenAt - taskStartedAt`，`moodTaskProgress.startedAt` 已有資料可重用）。
  - [ ] `say` 氣泡：依字數動態 TTL（`max(4s, 字數 × 120ms)`，上限仍受 `PRESENTATION_MAX_TTL_MS`）；`-webkit-line-clamp: 4` + hover 展開 + 滑鼠停留暫停。
  - [ ] 活動氣泡：toolName 對照表（Bash→「執行指令」、Edit→「修改檔案」、Read→「讀取」、`mcp__*` → 「MCP：<server>」），並移除硬寫 emoji（zh-TW/en-US 走 i18n key）。
  - [ ] 氣泡佇列：連續完成 N 個 session 時合併為「3 個工作完成」，避免互相覆蓋（現況單一 `toast` ref，後者直接蓋前者，`agentStore.ts:441-445`）。
  - [ ] 氣泡歷史：最近 20 則可由右鍵選單／面板回看（對應「剛剛有什麼我錯過了」）。
  - [ ] `permissionCountdown` sr-only 文案「約 3 秒後自動關閉」對所有 toast 一律朗讀，要依實際 duration（`DesktopPet.vue:714`、`zh-TW.json:290`）。
- **修改檔案**：`src/stores/agentStore.ts`（toast 區 :426-467）、`src/utils/toast-countdown.ts`、`src/components/DesktopPet.vue/.css`、`electron/event-normalizer.ts`、`electron/presentation-controller.ts`、`src/locales/*.json`、`tests/desktop-pet-bubbles.test.mts`

### PET-04　P0　「等待你輸入／長任務／你不在場」沒有任何主動通知
- **證據**
  - `agentStore.ts:1106-1116`：`handleEvent` 只對 `success`、`error`、`waiting-permission` 回傳 cue／建 toast，**`waiting-input` 完全沒有**。
  - `src/utils/sound.ts:30-47`：cue 只有 3 種，沒有 `waiting-input`。
  - `PetAnimation.vue:209-232`：等待升級的 urgency（12s/30s 抖動）只在 `reactionsActive` 為真時才視覺化（`:692-693`），預設關。
  - success 只維持 4 秒（`agentStore.ts:49` `SUCCESS_DISPLAY_MS`），之後回 idle；沒有「你不在時完成了」的持久標記。
- **使用者影響**：agent 停下來等你回答（最浪費時間的情境）時，寵物只是換成 waiting row；離開螢幕回來也不知道有什麼結果沒看。
- **子任務**
  - [ ] 新增 `waiting-input` cue + 氣泡「<專案> 在等你回覆」，延遲 5 秒才觸發以避免剛問完就閃一下。
  - [ ] 未讀結果徽章：success／error 若發生時視窗未被互動（沒有 mouse move 超過 N 秒），在寵物右上角留 `●` 或數字，直到點擊／開面板清除（edge 模式已有 unread badge 樣式可重用：`DesktopPet.css:126-140`）。
  - [ ] 長時間等待的升級路徑：12s 輕微 → 30s 明顯 → 120s 觸發系統通知（走 `desktop-notifications.ts`，僅限未聚焦時）。
  - [ ] 完成音效依任務時長分級（短任務不響、>60s 才響），避免提示疲勞。
  - [ ] 失敗音效加入第二聲（現在僅一聲 220Hz sawtooth，聽感像故障）；提供音量滑桿（`beep` 增益寫死 0.1-0.12，`sound.ts:25`）。
  - [ ] Windows／Linux 無法用音效時，提供 flash 視窗邊框的視覺替代。
  - [ ] 把「通知策略」做成共用 `notification-policy`（`electron/notification-policy.ts` 已存在）與桌寵氣泡一致，避免兩套規則。
  - [ ] 測試：waiting-input 去抖、DND、已聚焦、多 session 同時等待。
- **修改檔案**：`src/stores/agentStore.ts`、`src/utils/sound.ts`、`src/App.vue`（cue 播放 :160-173）、`electron/notification-policy.ts`、`src/components/DesktopPet.vue/.css`

### PET-05　P0　動畫狀態機：硬切、錯誤永久停格、每次狀態切換都彈一下
- **證據**
  - `PetAnimation.vue:576-591`：`watch(props.state)` 直接 `startAnimation()` → `selectStep(0)`、`draw()`，**沒有過渡**（上一個 row 的姿勢瞬間跳到下一個 row 的第 0 格）。
  - `:296-300` `error` 計畫只播一次 `failed` 後「停在最後一格直到 store 回報下個狀態」（`:553-555`）。error session 要到 `SESSION_STALE_MS = 15 分鐘`（`agentStore.ts:50`）才會變 offline → 寵物可能哭 15 分鐘。
  - `:287-295` success：jump → wave → **idle 無限**；但 `handleSuccessTimeout` 是 4 秒後變 idle，兩者各算各的，動畫可能比 session 狀態晚/早結束。
  - `:578-580`：每次 `state` 變更都 `playReaction()`（squash bounce），`offline→idle`、`thinking↔tool-running` 這種高頻小變化也彈，造成「一直抖」。
  - `:245` 閒置揮手週期由 `petId` 字元碼決定（`10 + sum % 5` loops），同一隻寵物永遠同一節奏、可預測。
  - `:310-318` `frameDelay()` 內 idle ×1.25、offline ×2.4，是整個動畫變慢而非「降低存在感」，offline 看起來像卡頓。
- **使用者影響**：狀態切換不順（尤其 tool-running ↔ thinking 來回），失敗後長時間停在哭臉，感覺「壞掉」而非「情緒」。
- **子任務**
  - [ ] 引入 transition 層：切 state 時先把前一格 cross-fade（雙 buffer canvas，120–160ms），或至少用短暫 squash 過場取代整體 reaction bounce。
  - [ ] 只對「語意重大」切換（→success／→error／→waiting／離開 waiting）播 reaction；thinking↔tool-running 不彈。
  - [ ] error 計畫：failed 播 2 次 → 回到較低存在感的「沮喪 idle」（用 idle row + 低 mood tint 或慢速），並在 60 秒後自動降級；與 session 狀態解耦的「情緒殘留」計時器。
  - [ ] 動畫序列與 store 時間對齊：success 的 jump+wave 長度 ≈ `SUCCESS_DISPLAY_MS`，由單一常數推導，不要兩邊各寫。
  - [ ] idle 變化：把 `idleLoops` 改為隨機區間（種子仍可由 petId 衍生以避免多寵物同步），加入 2–3 種小動作池（伸懶腰、東張西望、打哈欠；沒有素材的以 CSS fidget 代替）。
  - [ ] offline 改為「變淡 + 呼吸」而非放慢整個 frame 速度（`:312` 的 ×2.4）；保留 `pet-offline-breathe`。
  - [ ] 把 `motions` 的 frameDurations 外移到 manifest（目前寫死 v2 atlas，自訂素材無法調整，見 PET-14）。
  - [ ] 動畫狀態機抽成純函式（state, urgency, behavior → plan）並加單元測試；現況 `motionPlanForState` 是元件內閉包，難以測。
- **修改檔案**：`src/components/PetAnimation.vue/.css`、`src/stores/agentStore.ts`（SUCCESS/STALE 常數）、新增 `src/utils/pet-motion-plan.ts`、`tests/` 新增 motion-plan 測試

### PET-06　P0　Click-through hit-test：只在 mousemove 才更新、與主行程狀態會不同步
- **證據**
  - `src/App.vue:101-114` 只在 `mousemove`（capture）重算 `ignore`。寵物走路／狀態切換／氣泡出現或消失時，若游標不動，穿透狀態不更新 → 氣泡出現在游標下但點擊仍穿透；寵物走開後游標下仍攔截點擊。
  - `App.vue:35` 以 renderer 區域變數 `petMousePassthrough` 記錄狀態，但主行程 `apply*PetBounds` 都會 `setIgnoreMouseEvents(false)`（`electron/main/runtime.ts:1447, 1465, 1495, 1562, 1701`），renderer 並未被通知 → 切換 mini／normal 後 renderer 以為仍是 `true`，之後 `ignore === petMousePassthrough` 比對相同而**不再送 IPC**，造成「透明區域攔截點擊」或「寵物點不到」直到狀態翻轉。
  - `App.vue:75-90` 每次 mousemove 都 `getImageData`（pet-canvas 建立時帶 `willReadFrequently`，OK，但仍每次呼叫 `elementFromPoint`＋同步讀像素）。
  - hit 判定只看**當前格**的 alpha > 16（`:84`）：腿縫、手臂間空隙會穿透，導致「點不到寵物」或拖曳中斷；沒有膨脹（dilate）容忍。
  - `electron/ipc/window-controls.ts:48-56` 使用 `setIgnoreMouseEvents(true,{forward:true})`；`forward` 在 Linux 不被支援（Electron 文件），Linux 上穿透後再也收不到 mousemove，永遠點不回來（推測，需實機）。
- **使用者影響**：偶發「點不到寵物」「點寵物旁邊卻被攔截桌面圖示」「氣泡的按鈕按不下去」。這類 bug 難重現、傷信任。
- **子任務**
  - [ ] 主行程在每次 `setIgnoreMouseEvents` 變更時廣播 `pet-passthrough-state`，renderer 以主行程為準；或 renderer 在 `petWindowMode` 變更時重設 `petMousePassthrough=false`。
  - [ ] 增加「重新評估觸發點」：`ResizeObserver`、狀態／氣泡變更、`requestAnimationFrame` 節流下的最後游標座標重算（紀錄 `lastClient` 座標）。
  - [ ] 對 alpha 判定做 4–6px 膨脹（採樣 3×3 或 5 點），並加入「drag 開始容忍半徑」。
  - [ ] 將 `getImageData` 結果以 frame 為單位快取成 alpha mask（每次 `draw()` 後更新一次，hit-test 只查 mask），降低 mousemove 成本。
  - [ ] 以 `data-pet-hit-target="solid"` 為預設保守策略：氣泡內可點元素、狀態列一律 solid；補測試確保 plugin feed 的按鈕不被穿透。
  - [ ] Linux fallback：偵測 `process.platform==='linux'` 時不用 passthrough（或改用 `setShape`/固定小視窗），並在設定中說明。
  - [ ] 加入 IPC 節流（只在 ignore 值變化時送，已做）＋ 100ms 內不重送相同值的保險。
  - [ ] E2E：mini↔normal 切換後游標不動，點擊寵物仍有效。
- **修改檔案**：`src/App.vue`、`electron/ipc/window-controls.ts`、`electron/main/runtime.ts`（apply*Bounds 廣播）、`electron/preload.ts`、`electron/ipc/channels.ts`

---

## P1 — 重要（顯著拉低品質）

### PET-07　P1　拖曳手感與多螢幕／DPI：硬輪詢、無夾限、無落地回饋
- **證據**
  - `electron/ipc/pet-motion.ts:54-69` 以 8ms `setInterval` 輪詢 `getCursorScreenPoint()`，每次 `setPosition`（約 125 次/秒 IPC-free 但佔主行程）；`setPosition`（`:68`、shimeji `:114`）在 Windows 非 100% 縮放、跨螢幕不同 DPI 時，Electron 有已知「視窗尺寸被縮放而增長」問題，應使用 `setBounds` 並固定 width/height（推測，需 Win 實機）。
  - 拖曳**沒有夾限**：`dragEnd` 直接 `setNormalPetBounds({x,y,width,height})`（`:79-81`），可把寵物拖到螢幕外或 Dock／選單列下方；只有下次啟動才 clamp（`runtime.ts:1615+`）。
  - `DesktopPet.css:26-30` 拖曳時對整個 click-area 套 `filter: drop-shadow` + transform：Chromium 中祖先有 `filter` 會建立 backdrop root，子層狀態列的 `backdrop-filter` 失效（拖曳時玻璃變實心閃爍，推測）。
  - `DesktopPet.vue:457-500` 拖曳判定 `>2px`；點擊與拖曳沒有「按住 150ms 才算拖」的意圖緩衝，輕微手抖就不開面板。
  - 拖曳開始就 `getPanelWindow()?.hide()`（`pet-motion.ts:52`）：面板被無聲關掉，使用者可能只是想挪位置卻失去正在看的面板。
  - 放開後沒有「落地」動畫或吸附（無重力、無輕彈），Shimeji 風格的核心樂趣缺席。
- **子任務**
  - [ ] 拖曳中夾限在「可見螢幕聯集」內（保留 sprite 至少 60% 可見），含多螢幕不規則排列；放開時再 clamp 一次並動畫回彈。
  - [ ] 以 `setBounds({x,y,width,height})` 取代 `setPosition`，Windows DPI 加測試（或以 `screen.dipToScreenPoint` 處理）。
  - [ ] 輪詢頻率改為 `~16ms` 並在游標未移動時停止更新（已有相同值略過，再加指數退避）。
  - [ ] 拖曳視覺：去掉對整個容器的 `filter`，改為只對 sprite 加陰影；狀態列不隨拖曳縮放。
  - [ ] 放開動畫：落地擠壓（squash）+ 輕微回彈；若落在邊緣 ±24px 顯示「將停靠」預覽（見 PET-08）。
  - [ ] 拖曳意圖：mousedown 後 120ms 內位移 <4px 視為 click，之後才進拖曳狀態；觸控板輕點更穩。
  - [ ] 拖曳開始不再自動關面板，改為「面板跟隨」（`repositionVisiblePanel` 已有）或僅在面板被遮擋時關。
  - [ ] 記錄最後位置時一併記錄 displayId + 相對位置，螢幕拔除後回到同一相對位置（`displayForSavedState` 已有基礎）。
- **修改檔案**：`electron/ipc/pet-motion.ts`、`electron/main/runtime.ts`（clamp／rehome）、`src/components/DesktopPet.vue/.css`、`electron/pet-window-mode.ts`

### PET-08　P1　Edge（停靠）模式：用「視窗邊界」判斷、單向、懸停即展開
- **證據**
  - `electron/pet-window-mode.ts:60-76` `nearestEdge` 以**視窗** bounds 計算與 workArea 的距離，閾值 24px（`:20`）。視窗寬至少 260px（`agentStore.ts:1271`）、高含 190px 透明 headroom，因此 sprite 看起來離邊緣還有一段距離時就會判定貼邊；bottom 邊更是寵物「站在 Dock 上」的自然位置，拖到螢幕底部停 650ms（`:21`）就被收成 96×42 小把手（若開啟 edge 模式）。
  - `runtime.ts:1521-1546` `scheduleEdgeDwell` 只在 dragEnd 呼叫（`pet-motion.ts:86`）；`pet-motion.ts:89-93` 懸停即 `applyNormalPetBounds()` 且**沒有再次入口停靠的計時**，所以 edge 是「一次性」：碰一下滑鼠就彈出，且之後永遠留在 normal（除非再拖到邊緣）。
  - `App.vue:102-108` edge 模式下**每次 mousemove** 都送 `notifyPetHover`（未節流）；沒有 hover 延遲，滑鼠從旁邊掃過就彈出。
  - 停靠沒有預覽、沒有可撤銷提示，使用者不知道「為什麼寵物不見了」。
  - `DesktopPet.css:89-100` edge 頭像 28px 圓形，`--edge-peek-avatar-scale` 為 `0.5/petScale`，在 petScale 大時頭像只剩局部身體。
- **子任務**
  - [ ] `nearestEdge` 改用「sprite 可見範圍」（renderer 回報 sprite rect）而非視窗矩形；bottom 邊預設不啟用停靠（寵物自然站在底部）。
  - [ ] 拖曳時距邊 ≤ 40px 顯示吸附預覽（邊緣發光 + 文字「放開以收合到邊緣」），進入 650ms 倒數環。
  - [ ] 懸停展開加 180–250ms 延遲與「游標速度」判斷（快速掃過不展開）；`notifyPetHover` 節流 100ms。
  - [ ] 展開後游標離開 1.5s 且位置仍貼邊 → 自動回到 edge（雙向狀態機）；手動拖離則解除。
  - [ ] edge 把手顯示當前狀態色環與未讀數（已有 plugin 未讀，加入 agent success/error 未讀，銜接 PET-04）。
  - [ ] 第一次進入 edge 顯示氣泡「我躲在邊邊囉，滑鼠靠近就會出來」。
  - [ ] edge 頭像改用固定裁切（頭部區域）而非等比縮放整張 cell，避免在不同 scale 下變形。
  - [ ] 狀態機測試：drag→dwell→edge→hover→expand→leave→re-dock。
- **修改檔案**：`electron/pet-window-mode.ts`、`electron/main/runtime.ts`（:1473-1546）、`electron/ipc/pet-motion.ts`、`src/App.vue`、`src/components/DesktopPet.vue/.css`

### PET-09　P1　Mini（迷你）模式：沒有任何狀態資訊、被凍結、難以離開
- **證據**
  - `DesktopPet.css:32-43`：mini 隱藏 `.status-lines` 與 `.multi-pet-row`，只把 click-area `scale(0.42)`。
  - `DesktopPet.vue:202` `petAnimationFrozen` 在 mini 為 true → `PetAnimation.vue:57` `isPaused`：動畫完全停止，只顯示該 motion 第 0 格。error、waiting 在 mini 看起來只是「某一格靜態圖」，**狀態資訊為零**。
  - 氣泡位於 `top:2px` 的 click-area 內，被 0.42 倍縮小並被 96px 視窗裁切（`pet-window-mode.ts:17` `MINI_WINDOW_SIZE = 96`）；scale 5（`runtime.ts:1621` 上限）時 192×5×0.42 ≈ 403px > 96px，sprite 被裁。
  - mini 下點擊 = `togglePanel`（`DesktopPet.vue:521`），沒有「還原為 Normal」的直覺入口；只能從設定頁（`SettingsDesktop.vue:12`）或 tray（`desktop-tray.ts:174`）。
  - `runtime.ts:1597-1611`：有 permission 請求時強制 normal（合理），但使用者沒收到說明。
- **子任務**
  - [ ] mini 保留低頻動畫（降到 ≤ 4fps 或只播關鍵 state 的循環），不要完整凍結；僅 reduced-motion 才凍結。
  - [ ] mini 顯示狀態環（sprite 外圈色環＋圖示角標：! ✓ …），符合「不僅靠顏色」。
  - [ ] mini 的視窗尺寸與 petScale 連動：`MINI_WINDOW_SIZE` 改為 `clamp(96, 192*scale*0.42, 160)`，sprite 改以實際渲染縮放而非固定 `0.42`。
  - [ ] mini 手勢：單擊 = 展開成 Normal 約 6 秒（懸停預覽）、雙擊 = 開面板、拖曳 = 移動。
  - [ ] mini 下重要事件（success/error/permission）以「角標彈跳」而非被裁切的氣泡。
  - [ ] permission 強制還原時顯示一句原因並在處理完後回到 mini。
  - [ ] 補 mini 的 a11y：role=button、aria-label 描述當前狀態。
- **修改檔案**：`src/components/DesktopPet.vue/.css`、`electron/pet-window-mode.ts`、`electron/main/runtime.ts`（:1455-1471、:1597-1611）、`src/components/PetAnimation.vue`（freeze 語意拆分）

### PET-10　P1　Shimeji 自主行為：瞬移式走路、不翻面、睡 15 秒就醒、死碼
- **證據**
  - `src/types/pet.ts:47-48` 每步 `18px`、間隔 `1800ms`：視窗每 1.8 秒瞬間跳 18px（`pet-motion.ts:114` `setPosition`），不是滑行；sprite 的走路動畫卻連續播放（`PetAnimation.vue:236-241`）→ 腳滑／瞬移感。
  - 全 repo 無 `scaleX(-1)`：往左走不翻面（`grep` 結果為空）。
  - `pet.ts:98-108`：`walkDirection` 隨機，邊緣夾限後 `pet-motion.ts:113 target.x===current.x` 直接 return，但 renderer 仍在播 walk → 撞牆原地踏步，且不反向。
  - `pet.ts:110-113`：`sleep` 與 `idle` 皆回傳 `delayMs = 15s`；sleep 只持續一個 tick（15s）就可能被 idle 蓋掉，**不是持續睡到被喚醒**。入睡條件還要求 `idleMs ≥ 90s` 且 `value<0.22`，實際很少看到。
  - `PetAutonomousBehavior` 含 `'cursor-look' | 'poke'`（`pet.ts:2`），但 `ShimejiScheduler` 從不回傳它們；`PetAnimation.vue:600` 的 poke 分支為死碼；`cursor-look` 僅由 mousemove 觸發 ±3px 位移（`PetAnimation.css:128-136`），幾乎看不出來。
  - `DesktopPet.vue:788-797, 868` 多寵物時同一個 `shimejiBehavior` 傳給所有寵物 → 全部同步走、同步睡。
  - `walk` 只移動視窗（含 190px 透明 headroom 與正在顯示的氣泡）；使用者游標停在寵物上時寵物會走開。
  - 自訂寵物沒有 manifest 時，`behaviorMotion` 回退成 idle（`PetAnimation.vue:100-103`），但 `shimejiManifestCapabilities` 要求 `walk` 存在才可走（`DesktopPet.vue:58-61`），OK；問題是只要有一隻缺 manifest，**整個多寵物組合都不走**（`every`）。
- **子任務**
  - [ ] 走路改為主行程補間：一個 walk 行為 = 持續 N 秒、16ms 級 `setPosition` 補間（或渲染層 CSS translate 搭配視窗放大，見風險），速度與 sprite frame cadence 對齊。
  - [ ] 方向翻面：renderer 把 `walkDeltaX` 方向傳給 PetAnimation，canvas `transform: scaleX(-1)`；manifest 可宣告 `facing: 'left'|'right'` 以支援原生朝左的素材。
  - [ ] 撞牆反向：主行程回傳實際位移結果（IPC `invoke` 或事件），scheduler 在位移為 0 時翻轉方向；到邊緣時有機率進入「靠牆坐下」。
  - [ ] sleep 變持久狀態：進入後保持至「使用者互動 / 活動 / 游標靠近」；睡眠時顯示 `Zzz` 小氣泡；醒來播 wake 動作（用 waving 或 jump）。
  - [ ] 實作 `poke`：連點寵物 3 次進入「被戳」反應（不同於單擊開面板）；移除或實作 `cursor-look`（改成頭/眼睛偏移需素材，否則整身位移 ±3px 太弱，提高到 ±6px 並加 120ms ease）。
  - [ ] 多寵物各自獨立 scheduler（以 petId 為 seed），避免同步；`canWalk` 判斷改為 per-pet。
  - [ ] 游標在寵物上或 hover 狀態時暫停 walk，避免「逃跑」。
  - [ ] 行為清單擴充：伸懶腰、打哈欠、追著游標一小段、被拖放後坐下；每種需有「無素材的 CSS fallback」。
  - [ ] `SHIMEJI_IDLE_DELAY_MS` 改成區間隨機（8–25s）並避免連續同一行為。
  - [ ] 補 `ShimejiScheduler` 單元測試（目前只測邏輯閘門？請確認 tests 覆蓋 walkRemaining／sleep 持續）。
- **修改檔案**：`src/types/pet.ts`、`electron/shimeji-behavior.ts`、`electron/ipc/pet-motion.ts`、`src/components/DesktopPet.vue`、`src/components/PetAnimation.vue/.css`、`electron/pet-behavior-manifest.ts`

### PET-11　P1　渲染效能：每一格動畫 3 個 canvas ＋ `getImageData` ＋ 重算光暈色
- **證據**
  - `PetAnimation.vue:444-486` `draw()` 每格都對 **3 個** canvas（本體＋兩層 aura）各畫一次；且在本體 canvas 上每格 `getImageData(0,0,192,208)`（≈160KB）再跑 `deriveAuraTintFromPixels`（`:337-382`，逐像素迴圈 + 取 max 展開 `Math.max(...channels)`）。這一切在 mood 為 resting（`--aura-inner-opacity: 0`）時仍全部執行（`:34-53`）。
  - `:513-528` `animationTick` 是 rAF 輪詢：只為等 80–600ms 的 frame delay 卻以 60fps 喚醒主執行緒（每秒 ~60 次空 tick）。
  - `PetAnimation.css:8-18` aura canvas 常駐 `will-change: transform, filter, opacity` + `mix-blend-mode: screen` + `blur` filter 動畫：兩個永久合成層，視窗透明時 GPU 成本明顯（尤其 Windows）。
  - `imageCache`／`auraTintCache` 是**每個元件實例**的 `new Map`（`:120-121`）→ 多寵物、edge 頭像各自 decode 2–3MB webp（`public/pets/*/spritesheet.webp` 1.6–2.8MB）。
  - `App.vue:75-90` 每次 mousemove 也 `getImageData`（見 PET-06）。
  - `PetAnimation.vue:211-217` urgency 另開 500ms `setInterval`；DesktopPet 另有 shimeji timer、drain rAF、ResizeObserver — 計時器分散且沒有統一暫停（視窗 hidden 時有處理，但 mini/edge/DND/reduced-motion 時 aura 動畫仍跑）。
- **子任務**
  - [ ] aura tint 只在「圖片載入完成」計算一次（快取 per spritesheet），不要每格重算；移除 `draw()` 中本體的 `getImageData`（`:472-477`）。
  - [ ] aura 層依 mood：opacity 為 0 時 `v-if` 不渲染兩個 canvas；aura 只在 `reactionsActive && moodVisualsEnabled` 時繪製。
  - [ ] aura 不再重畫 sprite：用單一 offscreen canvas 預先著色成 tinted sheet，aura 兩層以 CSS `background`/同一 bitmap 引用；或用 `OffscreenCanvas`/`ImageBitmap` 預切 frame。
  - [ ] 動畫迴圈改為 `setTimeout` 依 frame delay 排程（或 rAF 搭配 `delay>100ms` 時用 timeout），降低空轉喚醒；idle 時 CPU 目標 <1%。
  - [ ] 模組級共用 `imageCache`（`Map<cacheKey, Promise<ImageBitmap>>`），所有 PetAnimation 實例共用；自訂寵物重新匯入時失效（見 PET-14）。
  - [ ] 統一「寵物不可見／mini／edge／DND／reduced-motion」的暫停策略，集中成 `usePetActivityGate()` composable。
  - [ ] 在 `perf` 面板或 dev flag 加入 FPS／CPU 取樣；補 CI 用 headless 量測的最低門檻（idle 10 秒內 rAF 次數）。
  - [ ] 移除 `willReadFrequently` 於顯示 canvas（會強制軟體光柵化，降低 GPU 繪製效率，推測）。
- **修改檔案**：`src/components/PetAnimation.vue/.css`、新增 `src/composables/usePetSpriteCache.ts`、`usePetActivityGate.ts`、`src/App.vue`（hit-test 與 PET-06 協調）

### PET-12　P1　畫質／DPI／縮放：backing store 固定 192×208 + `pixelated`
- **證據**
  - `PetAnimation.vue:329-330, 664-687`：canvas 的 `width/height` 固定 `CELL_W×CELL_H`（192×208），顯示尺寸 `CELL × petScale` 以 CSS 放大；`PetAnimation.css:13, 47` `image-rendering: pixelated`。
  - 在 Retina（DPR 2）或 scale 1.5/2/5 時為 nearest-neighbor 放大：非像素風格的插畫素材會鋸齒、非整數倍率（0.8、1.2…）會出現不均勻像素。`runtime.ts:1621` 允許 0.3–5 倍。
  - sprite 內建的 6 格 idle 動畫速度（~1.4s/循環）在 scale 大時更顯得頓。
  - `PetAnimation.css:105-114` reaction bounce `scale(1.16, 0.85)` 以 `transform-origin: 50% 100%`，在 click-area 邊界處可能被視窗裁切（視窗寬貼齊 sprite 寬時，推測）。
- **子任務**
  - [ ] 依 `devicePixelRatio × petScale` 建立 backing store（尺寸取整數倍），`drawImage` 時用 `imageSmoothingQuality='high'`（非像素風）；manifest 可宣告 `pixelArt: true` 才用 `pixelated`。
  - [ ] 提供縮放級距（0.5/0.75/1/1.5/2）而非任意值，避免非整數倍；自訂值保留但標示「可能模糊」。
  - [ ] DPR 變化（移動到不同螢幕）監聽 `matchMedia('(resolution: Xdppx)')` 重建 canvas。
  - [ ] reaction bounce 與 sway 動畫改在 sprite 外層容器做，並確保 click-area 有 4–8px 安全邊。
  - [ ] 增加 `public/pets/*/pet.json` 的 `render: {pixelArt, anchor, shadow}` 欄位並文件化。
  - [ ] 增加 sprite 腳下柔影（可選）讓寵物「站」在桌面上，增加實體感。
  - [ ] 視覺回歸：Retina／1x／125%／150% 的 screenshot。
- **修改檔案**：`src/components/PetAnimation.vue/.css`、`public/pets/*/pet.json`、`electron/pet-behavior-manifest.ts`（擴充 render 欄位）、`src/stores/agentStore.ts`（scale 級距）

### PET-13　P1　多寵物模式：ref 順序、共用行為、固定寬度與資訊缺失
- **證據**
  - `DesktopPet.vue:788-790` `v-for` 中的 `ref="multiPetRefs"`／`ref="multiPetItemElements"`；Vue 文件明確指出 v-for 內 ref 陣列**不保證與來源陣列同順序**，而 `:538-562` 以 `findIndex(line.petId)` 取 `multiPetRefs.value[index]` 對應，狀態列重排（`familyLines` 變動）時可能讓反應/獎勵動畫與氣泡錨點落到錯的寵物（推測，需複現）。
  - `DesktopPet.css:227-233` `.multi-pet-status-line` 寬固定 `192px - 12px`，不隨 petScale 變動；`agentStore.ts:1265-1272` 視窗寬 = `count × 204 × scale`，兩者縮放行為不一致 → scale ≠ 1 時狀態列與寵物錯位。
  - `DesktopPet.vue:215` 多寵物下活動氣泡被停用；`say` 氣泡（Presentation MCP）忽略 `petId`，永遠置中（`:572-581` 只對 plugin feed 計算 `pluginFeedTargetStyle`）。
  - 兩個 family 設定成同一隻寵物時，使用者無法分辨誰是誰（沒有名牌）。
  - 家族數變動時視窗寬度 `animateBounds` 200ms 縮放（`runtime.ts:192`），寵物位置會往中心收縮／展開，觀感不穩。
  - `shimejiBehavior` 共用（見 PET-10）。
- **子任務**
  - [ ] 以 `Map<petKey, instance>` 的函式 ref（`:ref="el => setRef(line.key, el)"`）取代陣列 ref，消除順序假設。
  - [ ] 狀態列寬度與間距改為 `calc(var(--pet-w)/count)` 或隨 scale 同步，並加 screenshot 測試（scale 0.5/1/2、2/3 隻）。
  - [ ] `say`／活動氣泡支援 `petId` 目標（共用 PET-02 的 bubble layout composable）；多寵物下活動氣泡改為每隻寵物頭上的小氣泡。
  - [ ] 同款外觀時在腳下顯示家族色小標（Claude 橙／Codex 綠／OpenCode 藍），並在狀態列旁加 family 圖示。
  - [ ] 視窗寬度變動時固定「重心」（按當前寵物 x 位置錨定）而非中心，避免主寵物位置跳動。
  - [ ] 多寵物 hit-test 與 tab 順序：每隻寵物皆可聚焦（見 PET-16）。
  - [ ] 當 families > 3 或視窗寬超過螢幕時改為堆疊/縮小排列。
- **修改檔案**：`src/components/DesktopPet.vue/.css`、`src/stores/agentStore.ts`（:1262-1288）、`src/composables/usePetBubbleLayout.ts`

### PET-14　P1　自訂寵物／素材管線：無尺寸驗證、錯誤靜默、快取不失效、競態
- **證據**
  - `electron/ipc/pet-assets.ts:190, 238` 只驗「是 PNG/JPEG/WebP 位元組」（`isSupportedRasterImage`），**不驗尺寸**是否為 192×208 的整數倍、是否至少有 9 個 row（`PetAnimation.vue:84-92` 用到 row 0–8）。尺寸不對時寵物變空白或抓到透明格，沒有任何錯誤。
  - `importPetSprite` 所有失敗皆 `return null`（`:225, 233, 236, 238, 240`），UI 無從得知原因；`importPetZip` 錯誤字串全為硬編碼英文（`:120-191`），對話框標題為硬編碼中文（`:124, 228`），不走 i18n。
  - `PetAnimation.vue:408-417`：自訂寵物 `imageCacheKey = targetId`（無版本／mtime）。重新匯入同 id 後 `imageCache` 命中舊圖；`removeCustomPet` 也不會通知 renderer 清快取。
  - `:419-441`：`new Image()` 沒有 `onerror`，載入失敗後 `imgRef` 保持舊值或 null，**畫面空白且無 fallback**；`await getCustomPetSprite` 後沒有「petId 是否已改變」的檢查 → 快速切換寵物時舊 onload 覆蓋新寵物（競態）。
  - `:399, 406` 的 fallback id 是 `'qitian-dasheng'`，但全域預設是 `'aang-airbender'`（`agentStore.ts:89, 208`）→ 缺圖時顯示的不是預設寵物。
  - `importPetZip` 以 `pet.json.id` 當目錄名，同 id 會**直接覆蓋**既有自訂寵物（`:194-202`），沒有確認。
  - 沒有 manifest 的自訂寵物：walk 回退 idle（`PetAnimation.vue:100-103`）— 視窗在移動但寵物沒有走路姿勢；也沒有 waving／jumping 等 row 的存在性檢查。
  - `public/pets/qitian-dasheng/validation.json` 只有一隻有驗證檔，格式與用途沒有文件化。
  - 單一 sprite 匯入流程只吃一張圖並假設符合 v2 atlas；沒有「預覽各狀態」的步驟（`importPetSprite` 無預覽）。
- **子任務**
  - [ ] 主行程以圖片解碼（`nativeImage`／`sharp` 不可用則用 header 解析）驗證寬 = N×192、高 ≥ 9×208，回傳結構化錯誤碼（`E_SIZE`、`E_ROWS`、`E_TYPE`…）。
  - [ ] 錯誤碼 → i18n 訊息（zh-TW/en-US），匯入 UI 顯示具體原因與修正建議（附「下載範本」）。
  - [ ] 匯入前預覽 modal：以 9 個狀態逐一播放 2 秒，使用者確認後才寫入；顯示 manifest 警告（缺 walk/sleep）。
  - [ ] cacheKey 加入 `mtime`／hash（`getCustomPetSprite` 回傳 `?v=<mtimeMs>`），刪除／重匯入時 `store.invalidatePetSprite(id)`。
  - [ ] `loadImage` 加入 `onerror` → fallback 到 DEFAULT_PET_ID 並在狀態列顯示「素材載入失敗」；加入請求序號防競態。
  - [ ] 統一預設寵物 id 常數（共用 `DEFAULT_PET_ID`），移除 `qitian-dasheng` 魔術字串。
  - [ ] 匯入同 id 時詢問「覆蓋／另存為新寵物」。
  - [ ] 缺 walk/sleep 的自訂寵物：UI 說明「此寵物沒有走路動畫，Shimeji 行為將使用待機」，或自動以 CSS 搖擺 fallback。
  - [ ] 發布素材規格文件（欄位、row 對照表、frame 數、manifest 範例）並附 validator CLI（`scripts/validate-pet.ts`）。
- **修改檔案**：`electron/ipc/pet-assets.ts`、`electron/ipc/pet-assets-fs.ts`、`electron/pet-behavior-manifest.ts`、`src/components/PetAnimation.vue`、`src/stores/agentStore.ts`、狀態面板的寵物管理（`src/components/status-panel/*`，另一審計範圍，需協調）、`src/locales/*.json`

### PET-15　P1　權限卡（Permission bubble）的可用性與在地化
- **證據**
  - `DesktopPet.vue:661-672`：按鈕文字「Deny」「Allow once」為硬編碼英文（其餘走 `t()`），zh-TW 使用者看到中英混雜；`kbd` 內容寫死 `Ctrl Shift N/Y`，但主行程註冊的是 `CommandOrControl+Shift+Y/N`（`runtime.ts:102-103`），macOS 應顯示 `⌘⇧Y`。
  - `DesktopPet.css:845-893`：按鈕字級 `9.5px`、`kbd` `7px`（`:888-891`）— 低於可讀下限；整張卡寬 248px 且字級 `--font-xs`。
  - `zh-TW.json:288` `permissionWarning`：「請先回到 OpenCode 檢查再允許」寫死 OpenCode，但來源可能是 Claude／Codex。
  - 卡片上只顯示 `action`／`description` 三行 clamp（`DesktopPet.css:819-830`），看不出**哪個 session／哪個專案**在要權限（`store.permissionRequest` 有 queue 但無 project 顯示）。
  - 無逾時／等待時間顯示；多筆佇列只顯示 `1/3`，無法預覽下一筆；deciding 狀態僅改文字。
  - 卡片 `role="alertdialog"` 但沒有焦點管理（開啟時不聚焦、無 focus trap、Esc 不處理），且在 `pointer-events` 穿透系統下取得焦點的方式不明（推測）。
  - 卡片蓋在寵物上（PET-02）。
- **子任務**
  - [ ] 全面 i18n：Deny→「拒絕」、Allow once→「允許一次」；快捷鍵依平台渲染（`navigator.platform`／主行程提供 `hotkeyLabel`）。
  - [ ] `permissionWarning` 改為帶來源名稱的參數化文案（`{source}`）。
  - [ ] 卡片頂部顯示來源 icon + 專案名 + 等待時長（秒），超過 60 秒標紅。
  - [ ] 字級下限 11px（按鈕）／10px（kbd），並提供「放大模式」跟隨系統字級。
  - [ ] 焦點管理：出現時聚焦主要按鈕但不搶輸入焦點（Electron 視窗 `showInactive` 取捨），Esc = 拒絕（需確認安全政策，預設不綁 Esc 以免誤拒，改為可設定）。
  - [ ] 佇列 UI：顯示「還有 2 個等待中」並可展開預覽；按鈕加入「全部拒絕」需二次確認。
  - [ ] 風險等級以圖示＋文字呈現（不只是邊框顏色，`DesktopPet.css:758-764`）。
  - [ ] 安全審查：確認 UI 變更不弱化 broker 驗證（`permission-broker.ts`）；補 a11y 測試。
- **修改檔案**：`src/components/DesktopPet.vue/.css`（:733-893）、`src/locales/*.json`、`electron/permission-broker.ts`（hotkey label）、`electron/main/runtime.ts`

### PET-16　P1　無障礙與減少動態（reduced-motion）
- **證據**
  - 寵物本體沒有 `tabindex`／`role`／`aria-label`（`DesktopPet.vue:473-482`）：鍵盤與螢幕閱讀器無法觸及寵物、無法開面板或移動；只有 edge 把手有 `role="button"`（`:486-492`）。
  - 滑鼠才有的資訊：quota 細節 tooltip 靠 `:hover`（`DesktopPet.css:401-444`），僅有 `tabindex` 的 status-line 可用 focus 觸發（`:501`）。
  - 狀態點 `5px`（`DesktopPet.css:688-694`），`STATE_COLORS` offline `#555`、idle `#666`（`agent.ts:100-109`）在深色狀態列上對比不足（推測 < 3:1）。
  - 狀態變更沒有 `aria-live` 公告（toast 有 `role=status`，但狀態列切換沒有）。
  - reduced-motion：`shimejiReducedMotion` 為 true 時 `petAnimationFrozen` 讓**整個 sprite 完全凍結**（`DesktopPet.vue:202`、`PetAnimation.vue:57`），連 error/waiting 的 row 都不再播，狀態只剩那一格；而 CSS 的 `@media (prefers-reduced-motion)` 又只關掉 aura／reward（`PetAnimation.css:185-198`），ambient 動畫（breathe/think/pulse）依靠 `pet-frozen` class 才關。兩套機制並存、語意不一致。
  - `STATE_LABELS` 刻意不在地化（`agent.ts:71-76` 註解），螢幕閱讀器用英文唸 zh-TW 介面。
  - 玻璃狀態列已有 `prefers-contrast`／`reduced-transparency` 後備（`DesktopPet.css:669-690`），這部分做得好。
- **子任務**
  - [ ] 寵物容器加 `role="button"`、`tabindex=0`、`aria-label="<寵物名>，目前<狀態>，按 Enter 開啟面板"`；Enter/Space 開面板、方向鍵微調位置（Shift = 大步）。
  - [ ] 新增視覺隱藏的 `aria-live=polite` 區塊公告「Claude 已完成／失敗／等待輸入」。
  - [ ] reduced-motion 策略改為「降階而非凍結」：保留 sprite 在 ≤ 2fps 的低頻切換、關閉 shake/bounce/aura/walk；至少狀態 row 要能被辨識。
  - [ ] 狀態點加大到 8px 並加形狀（● ▲ ■ ✓ !），且 `STATE_COLORS` 通過 WCAG 非文字對比 3:1 檢查。
  - [ ] hover tooltip 全部提供 focus／鍵盤路徑，Esc 關閉；tooltip 不遮擋狀態列本身。
  - [ ] `STATE_LABELS` 對 a11y 輸出（`aria-label`）提供 zh-TW 版本，視覺顯示維持英文。
  - [ ] 在 CI 加入 axe／eslint-plugin-vuejs-accessibility 規則。
  - [ ] 測試：`prefers-reduced-motion` 切換期間 state 變更仍能看出差異。
- **修改檔案**：`src/components/DesktopPet.vue/.css`、`src/components/PetAnimation.vue/.css`、`src/types/agent.ts`、`src/locales/*.json`

### PET-20　P1　Presentation MCP（pet_react / pet_say）的可見效果：5 種 reaction 長得一樣、被靜默丟棄
- **證據**
  - `src/types/presentation.ts:3-9` 定義 `happy/curious/thinking/surprised/encouraging` 五種，但 `DesktopPet.vue:538-551` 的 watcher 對任何 reaction 都只呼叫 `playReaction()`（同一個 0.26s squash，`PetAnimation.css:105-114`）→ 五種完全無法區分。
  - `agentStore.ts:94, 580, 642`：當前狀態 priority ≥ 85（waiting-input／permission／error）時 `presentationBlocked` 為真，意圖被**靜默丟棄**；MCP 端仍可能收到 `accepted:true`（controller 層無法得知 renderer 丟棄），agent 以為牠說了話。
  - `agentStore.ts:675-677` 佇列滿時 `shift()` 丟最舊的；MCP 端不知情。
  - `say` 忽略 `petId` 的位置（見 PET-13）；多寵物下 `say` 只置中。
  - `reactionsActive` 為假（預設）時 `PetAnimation` 不會播 reaction 動畫（`DesktopPet.vue:539`），而 `say` 仍顯示 → 行為不一致。
  - 氣泡不標示來源（是哪個 agent／哪個 MCP client 在說話），使用者無法判斷可信度；訊息為 agent 可任意撰寫的文字（已消毒 `<>`，`agentStore.ts:629-636`）。
- **子任務**
  - [ ] 為五種 reaction 設計不同表現：happy=跳一下＋星芒、curious=歪頭（rotate）＋問號、thinking=review row＋點點點、surprised=縮放驚嘆＋「!」、encouraging=waving row＋愛心；以 CSS／既有 row 組合，無需新素材。
  - [ ] reaction 在 reactions 關閉時仍給最小視覺（短暫圖示氣泡），因為這是 MCP 明確要求的呈現。
  - [ ] controller 與 renderer 加入 ack：renderer 回報 `shown / dropped(reason)`，`pet_say` 工具回應帶 `delivered:false, reason:'busy'`，讓 agent 能重試。
  - [ ] 在被高優先狀態阻擋時改為「排隊至狀態解除」（有 TTL）而非丟棄；佇列滿時回報 `queue_full`（controller 層已有，renderer 層同步）。
  - [ ] `say` 氣泡顯示來源小標（如「來自 Claude」）與可關閉 ×；使用者可一鍵「本次工作階段靜音 MCP 說話」。
  - [ ] 支援 `say` 目標寵物（`petId`）定位與多行排版（見 PET-02/03）。
  - [ ] 補 `pet_status` 回傳目前 `visibleState`／是否被阻擋，方便 agent 判斷時機。
  - [ ] 單元／整合測試：五種 reaction 的 class、阻擋後的 ack、佇列排序。
- **修改檔案**：`src/components/DesktopPet.vue`、`src/components/PetAnimation.vue/.css`、`src/stores/agentStore.ts`（:570-690）、`electron/presentation-controller.ts`、`electron/presentation-mcp.ts`、`src/types/presentation.ts`、`electron/ipc/window-controls.ts`（status 通道）

---

## P2 — 提升質感

### PET-17　P2　互動語彙貧乏：點擊＝開面板，沒有個性、沒有右鍵選單
- **證據**
  - `DesktopPet.vue:513-522` 單擊只做 `playReaction()` + `togglePanel()`；沒有雙擊、長按、摸頭、懸停反應。
  - `:524-534` 右鍵：`rightClickHideEnabled` 關閉時什麼都不發生（且 `@contextmenu.prevent`），開啟時只有「隱藏」；沒有 DND、mini、換寵物、設定、結束等快捷選單。
  - mood 只表現在光暈（`PetAnimation.vue:34-53`），等級／成就／連續天數在寵物表面完全看不見；成就解鎖只有 0.9 秒光暈（`:152-159`），沒有氣泡或慶祝。
  - 懸停無反應（只有 shimeji 開啟時的 ±3px，見 PET-10）。
  - 只有 3 種提示音（`sound.ts`），沒有寵物專屬聲音／無聲替代。
- **子任務**
  - [ ] 右鍵選單（原生 `Menu.popup`，走主行程）：勿擾、迷你、切換寵物、隱藏 1 小時、設定、結束；zh-TW/en-US。
  - [ ] 雙擊 = 摸頭（愛心／開心動作＋mood +1，每日上限），單擊 = 開面板（延遲 220ms 以區分雙擊）。
  - [ ] 長按 0.6s = 抱起（拖曳前的預備姿勢）；放開 = 落地。
  - [ ] 懸停 1.5s 顯示「小資訊卡」：今日完成數、目前 mood、連續天數（可關）。
  - [ ] 成就解鎖氣泡＋彩帶粒子（尊重 reduced-motion），並在面板記錄。
  - [ ] 時間／情境彩蛋：深夜打哈欠、早晨伸懶腰、長時間未互動撒嬌；寫入 manifest 可選行為池。
  - [ ] 每隻內建寵物 3–5 句個性台詞庫（zh-TW），隨 state 與 mood 抽選，頻率受氣泡設定控制。
  - [ ] 等級／mood 顯示小環（可選，預設關），與 Liquid Glass 規範一致（功能層、不搶 sprite）。
- **修改檔案**：`src/components/DesktopPet.vue/.css`、`electron/desktop-tray.ts`（共用選單項目）、`electron/ipc/desktop.ts`、新增 `electron/pet-context-menu.ts`、`src/locales/*.json`、新增 `src/utils/pet-lines.ts`

### PET-18　P2　文案與在地化（zh-TW）不一致
- **證據**
  - 狀態標籤刻意英文（`agent.ts:71-98`），其他全中文，`Permission`、`Allow once`、`Deny`、`Idle`、`Running` 混用；`zh-TW.json:298` 「需要 Permission」。
  - 活動氣泡 `🔧 {toolName}`（`DesktopPet.vue:730`）：硬寫 emoji＋原始工具識別字。
  - `importPetZip` 錯誤與對話框標題為主行程硬編碼字串（`pet-assets.ts:120-191, 124, 228`）。
  - 缺乏寵物「語氣」：全部是機械式狀態文字，沒有品牌個性。
  - toast 只用來源名稱（`SOURCE_LABELS`，英文）。
- **子任務**
  - [ ] 決策：寵物表面（狀態列、氣泡）全部在地化；技術術語（Claude／Codex／MCP）保留，其餘（Idle→待命、Running→執行中、Waiting→等待你、Permission→權限）改中文，面板內技術列表仍可保留英文。
  - [ ] 建立「寵物語氣指南」：句長 ≤ 14 字、不使用感嘆號洪流、錯誤訊息溫和不責怪。
  - [ ] 移除硬寫 emoji，改用 SVG 圖示（符合 Liquid Glass 的符號規範）。
  - [ ] 主行程對話框與錯誤改走 `electron/` 側 i18n（目前無？需建立共用 messages 或由 renderer 傳字串）。
  - [ ] 檢查 `en-US.json` 與 `zh-TW.json` key 一致（`tests/i18n.test.mts` 已存在，補檢查硬編碼字串的 lint 規則）。
  - [ ] 複數／單位（秒、分鐘）格式化集中到 `utils/format.ts`。
- **修改檔案**：`src/types/agent.ts`、`src/locales/*.json`、`src/components/DesktopPet.vue`、`electron/ipc/pet-assets.ts`、`tests/i18n.test.mts`

### PET-19　P2　Liquid Glass 規範落差與視覺 token
- **證據**
  - `DesktopPet.css:894-915` `.pet-toast` 使用硬編碼色（`rgba(30,30,40,.92)`、`#f2f2f2`、`blur(6px)`）而非 `--organic-*`／`--surface-*` token；`.permission-request`（`:733-757`）亦同；與 `status-line` 使用的 token 體系分裂，且沒有亮色主題。
  - `.status-line` 本身是 `backdrop-filter`（`:263`），其內的 `.quota-tooltip` 又是 `backdrop-filter`（`:424`）→ glass-on-glass（規範第 3 條禁止），且巢狀 backdrop 在 Chromium 取不到背景（推測，視覺上等同實色）。
  - `.pet-toast` 同時有 backdrop 與動畫尾巴 `::after`（`:1113-1124`）以 `background: inherit` 繪製，尾巴與本體材質不連續。
  - 寵物陰影／拖曳 `drop-shadow` 與玻璃層混用（見 PET-07）。
  - prefers-contrast／reduced-transparency 後備已有（`:1216-1266`），但 toast／permission 的 contrast 版本未涵蓋 `.plugin-feed-toast` 等所有變體（需逐一檢查）。
  - 未驗證 inactive window 外觀（規範要求）。
- **子任務**
  - [ ] 把 `.pet-toast`／`.permission-request`／`.presentation-say` 的顏色、陰影、blur 全部改用語意 token（`--bubble-surface`、`--bubble-border`…）並補亮色版本。
  - [ ] 移除 `quota-tooltip` 的 backdrop（改實色 tint），避免 glass-on-glass。
  - [ ] 氣泡尾巴改用 SVG／clip-path 與本體同一材質，或改為無尾巴的「氣泡 + 圓點」風格。
  - [ ] 為所有氣泡變體補 `prefers-contrast: more`／`reduced-transparency` 測試。
  - [ ] 失焦（inactive）視窗：玻璃降低飽和度與對比，驗證可讀性。
  - [ ] 以 token 建立 `bubble` 元件（`src/components/ui/PetBubble.vue`）統一 5 種氣泡，減少 CSS 重複（`DesktopPet.css` 已 1268 行）。
  - [ ] 拆分 `DesktopPet.css`（狀態列／氣泡／edge／mini 各自檔案）降低合併衝突。
- **修改檔案**：`src/components/DesktopPet.css`（拆分）、`src/components/ui/PetBubble.vue`（新）、`src/styles/*` tokens、`.agents/skills/pet-skill/references/ui-design-system.md`（若新增 token 需同步）

---

## 並行衝突矩陣（建議分工）

| 工作群 | 問題 | 主要檔案 | 可與哪些並行 |
|---|---|---|---|
| A 氣泡系統 | PET-02, 03, 13(部分), 15, 19, 20 | `DesktopPet.vue/.css`、`ui/PetBubble.vue`、`agentStore.ts` toast 區、`locales` | 與 B 不衝突（需先拆 `DesktopPet.css`） |
| B 動畫與渲染 | PET-05, 11, 12 | `PetAnimation.vue/.css`、新 composables | 與 A 不衝突；PET-10 共用 `PetAnimation.vue`，需序列化 |
| C 視窗／主行程 | PET-06, 07, 08, 09 | `App.vue`、`runtime.ts`、`pet-motion.ts`、`pet-window-mode.ts`、`window-controls.ts`、`preload.ts` | 與 A/B 大致獨立；PET-06/09 同碰 `DesktopPet.vue` 小區域 |
| D Shimeji | PET-10 | `types/pet.ts`、`pet-motion.ts`、`PetAnimation.vue` | 依賴 C 的 pet-motion 改動，建議 C 之後 |
| E 通知與預設 | PET-01, 04 | `agentStore.ts`、`sound.ts`、`notification-policy.ts`、設定頁 | 與 A 共用 store，需序列化 |
| F 素材管線 | PET-14 | `pet-assets*.ts`、`pet-behavior-manifest.ts`、`PetAnimation.vue`(loadImage 區) | 與 B 協調 `loadImage` |
| G 無障礙與文案 | PET-16, 17, 18 | `DesktopPet.vue`、`locales`、`agent.ts`、`desktop-tray.ts` | 最後整合 |

建議順序：PET-06（hit-test 穩定性）→ PET-01/04（讓寵物有反應）→ PET-02/03（氣泡）→ PET-05/11/12（動畫與效能）→ PET-07/08/09（視窗）→ PET-10/13/14 → PET-15–19。每個階段依 AGENTS.md 完成功能驗證與安全審查後停下，等使用者確認再升版（修補級預設；涉及 permission UI 與持久化預設遷移者視為 minor 評估）。

---

## 新互動／畫面設計（ASCII 線稿）

### D1　氣泡改版：位於頭上、尾巴指向寵物、兩行資訊

```
                 ┌────────────────────────────┐
                 │ ✓ 完成 · Claude · agent-pets│   <- 第一行：語意＋來源＋專案
                 │ 用時 2m 14s  ·  點我查看      │   <- 第二行：耗時／行動
                 │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │   <- 倒數線（hover 暫停）
                 └──────────────┬─────────────┘
                                ▼  (尾巴指向頭部中心)
                             ( ◕‿◕ )
                              /|  |\
                              寵物本體（不被遮蓋）
```

失敗版本：`! 失敗 · Codex · api-server`＋第二行錯誤摘要（≤ 40 字）＋「查看」；停留 7 秒、hover 暫停。

### D2　權限卡：寵物可見、來源明確、中文與平台快捷鍵

```
        ┌───────────────────────────────────┐
        │ ⚠ 高風險            Claude · repo  │
        │ 執行 shell 指令：rm -rf build/      │
        │ 已等待 00:12              1 / 3     │
        │ ┌──────────┐ ┌──────────────────┐  │
        │ │ 拒絕 ⌘⇧N │ │ 允許一次  ⌘⇧Y    │  │
        │ └──────────┘ └──────────────────┘  │
        └─────────────────┬─────────────────┘
                          ▼
                      ( ʘ_ʘ )   <- 寵物保持可見，做「緊張」表情
```

### D3　未讀結果徽章（你不在場時）

```
                  ┌──┐
                  │ 3│  <- 3 個未讀結果（● 綠=成功 ● 紅=有失敗）
              ( ^_^ )┘
              Claude · 待命   [ 點擊清除 ]
```
懸停展開成迷你清單：
```
        ┌─────────────────────────────┐
        │ ✓ agent-pets      2 分鐘前   │
        │ ✓ docs-site       5 分鐘前   │
        │ ! api-server      8 分鐘前   │
        └─────────────────────────────┘
```

### D4　Mini 模式：狀態環＋角標

```
   ┌────────┐
   │  ◜◝    │   外圈色環 = 狀態（黃=等待、紅=失敗、綠=完成、藍=工作中）
   │ ( ·ᴗ·) │   右上角角標 = ! / ✓ / … （不只靠顏色）
   │  ◟◞  ● │
   └────────┘
 單擊：預覽展開 6 秒　雙擊：開面板　拖曳：移動
```

### D5　Edge 停靠：吸附預覽與雙向狀態

```
 螢幕邊緣 ║
          ║▒▒▒  <- 拖到距邊 ≤ 40px：邊緣發光＋倒數環 650ms
          ║▒▒▒     「放開以收合到邊緣」
      ( ˘ω˘ )

 已停靠：                   游標靠近 250ms 後：
 ║┌─┐                      ║
 ║│◔│ ●2  (狀態環＋未讀)    ║  ( ˘ω˘ ) 滑出，離開 1.5s 自動縮回
 ║└─┘
```

### D6　右鍵選單（原生）

```
 ┌───────────────────────┐
 │ 🔕 勿擾 1 小時          │
 │ ▫ 迷你模式              │
 │ 🐾 切換寵物 ▸           │
 │ 🕘 最近通知（20）▸      │
 │ ⚙ 設定…                │
 │ ──────────────────────  │
 │ 隱藏寵物                │
 │ 結束 Agent Pets         │
 └───────────────────────┘
```

### D7　睡眠與喚醒（Shimeji）

```
 閒置 90s → 打哈欠 → 躺下
          z Z z
        ( -.- ) 睡眠持續到：滑鼠靠近 / 新活動 / 點擊
 醒來：    ( ◉_◉)! → 伸懶腰 → 待命
```

### D8　首次啟動引導（coach mark）

```
   ┌──────────────────────────────┐
   │ 嗨！點我看工作階段            │
   │ 拖曳換位置，右鍵更多選項       │
   │              [知道了]         │
   └──────────────┬───────────────┘
                  ▼
              ( ◕ᴗ◕ )
```

### D9　自訂寵物匯入預覽

```
 ┌ 匯入寵物 ─────────────────────────────────┐
 │ my-pet.codex-pet.zip   ✓ 尺寸 1152×1872    │
 │                                           │
 │  待命 ▶  思考 ▶  執行 ▶  等待 ▶  成功 ▶     │
 │ [ 預覽  ][ 預覽  ][ 預覽  ][ 預覽  ][ 預覽 ] │
 │  失敗 ▶  走路 ✕缺少  睡覺 ✕缺少             │
 │                                           │
 │ ⚠ 缺少 walk/sleep，Shimeji 將以待命代替      │
 │ 名稱 [ my-pet ]   ID 衝突：覆蓋 / 另存新檔    │
 │                    [取消]   [匯入]          │
 └───────────────────────────────────────────┘
```

---

## 附：已確認做得好的地方（修改時請保留）

- 玻璃狀態列已有 `prefers-contrast` / `prefers-reduced-transparency` 後備（`DesktopPet.css:669-690, 1216-1266`）。
- 拖曳以主行程輪詢游標，避開 Windows 合成 mousemove 迴圈（`DesktopPet.vue:466-489` 註解）。
- `pet-behavior-manifest.ts` 對 manifest 做嚴格消毒（row/frames/duration 範圍），自訂素材包有 archive guard。
- 視窗 hidden 時動畫／計時器暫停（`PetAnimation.vue:612-623`、`App.vue:48-73`）。
- Presentation MCP 有速率限制、TTL 上限與 DND/priority 閘門（`presentation-controller.ts:15-20`）。
