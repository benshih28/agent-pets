# Agent Pets 稽核：成長 / 成就 / 歷史 HUD / 額度與 Token 用量

範圍：`electron/progression.ts`、`src/types/progression.ts`、`electron/achievements.ts`、`src/types/achievement.ts`、`electron/history.ts`、`electron/local-usage.ts`、`electron/quota.ts`、`src/components/status-panel/{SettingsGrowth,StatusPanelHistory,StatusPanelUsage}.vue`、`electron/ipc/{progression,history,quota}.ts`、`src/stores/agentStore.ts`、`src/components/DesktopPet.vue`、`src/App.vue`。
方法：唯讀靜態稽核，未執行 App。嚴重度：P0 資料錯誤或使用者被誤導、P1 明顯體驗或效能缺陷、P2 改善項。

統計：共 16 個大問題（GR-01 ~ GR-16），每個 6~10 個子任務。

---

## GR-01 XP 獲得完全不可見（awards 被丟棄）— P0（體驗核心）
**證據**
- `electron/progression.ts:128-196` `handleEvent()` 回傳 `{ snapshot, awards }`；`src/types/progression.ts:21-24` 定義 `ProgressionEventResult.awards`。
- `electron/main.ts:278-281` 只呼叫 `broadcastProgression(progressionResult.snapshot)`，`awards` 從未傳給 renderer（全專案 grep `awards` 僅出現在型別與 progression.ts 內部）。
- `src/components/status-panel/SettingsGrowth.vue:52-61` 只顯示總 XP 與進度條，沒有「剛剛 +20 XP 因為完成工作」。
- `XP_RULES`（`src/types/progression.ts:28-33`）沒有任何 UI 說明。

**使用者影響**：使用者看到數字變動卻不知道為什麼；無法學會「怎樣得 XP」，成長系統失去動機回饋。

**子任務**
- [ ] 在 `broadcastProgression` payload 帶上 `awards[]`（ruleId、amount），擴充 IPC 型別與 `normalizeProgressionSnapshot`。
- [ ] store 新增 `recentAwards`（最近 20 筆，含時間），供 UI 與寵物氣泡使用。
- [ ] 寵物端顯示 `+20 XP` 浮字（遵守 DND/reactions 設定，見 GR-04）。
- [ ] SettingsGrowth 新增「XP 來源說明」折疊區，從 `XP_RULES` 動態產生（完成 +20、每日首次 +10、每 30 分鐘 +2、連續日 +5）。
- [ ] 新增「最近獲得」列表（rule 名稱 i18n + 時間 + 數量）。
- [ ] ruleId 轉 i18n key 的對照表（`v1.session-completed` 等），避免顯示內部字串。
- [ ] 寫 xp_ledger 的唯讀查詢 `getRecentLedger(petId, limit)`，重啟後仍可顯示歷史。
- [ ] 單元測試：一次 success 事件應回報 3 筆 awards 並被 renderer 收到。

**觸及檔案**：`electron/progression.ts`、`electron/main.ts`、`electron/main/runtime.ts`(broadcastProgression)、`src/stores/agentStore.ts`、`src/components/status-panel/SettingsGrowth.vue`、`src/components/DesktopPet.vue`、`src/locales/*.json`

---

## GR-02 升級 / 進化沒有任何儀式與視覺回饋 — P0
**證據**
- 全專案沒有 `levelUp` / 前後等級比較；`evolutionStage` 只在 `SettingsGrowth.vue:17,54`、`StatusPanelHistory.vue:25,242`、`StatusPanel.vue:71` 作為文字標籤出現。寵物 sprite 不隨 `egg/baby/teen/adult/master` 改變。
- `src/types/progression.ts:56-62` 進化門檻 5/10/20/35 級，但 UI 沒告訴使用者下一階段在幾級。
- `agentStore.ts:855` `setProgressionSnapshot` 直接覆寫，沒有 diff。

**使用者影響**：升級、進化是最重要的情緒峰值，現在完全無感；「蛋」階段標籤對尚無進化外觀的寵物很困惑。

**子任務**
- [ ] store 在 `setProgressionSnapshot` 偵測 `level` 上升與 `evolutionStage` 改變，產生 `levelUpEvent`。
- [ ] 寵物端播放升級動畫（沿用 `playReward`）並顯示 `Lv 7!` 氣泡。
- [ ] 進化時顯示全幅慶祝卡（舊階段 → 新階段），可略過。
- [ ] 面板顯示「下一個進化：Lv 10 · 少年期（還差 N 級）」。
- [ ] 決策：進化是否影響外觀（skin 疊加 / 光環 / 徽章）；若暫不做，將「蛋/幼體」改為中性稱號避免誤導。
- [ ] 啟動時第一次載入不可觸發慶祝（避免把舊等級當成剛升級），需 `lastSeenLevel` 持久化。
- [ ] DND 模式下延後慶祝，解除後補播一次。
- [ ] 快照測試：跨級事件只觸發一次。

**觸及檔案**：`src/stores/agentStore.ts`、`src/components/DesktopPet.vue`、`src/components/status-panel/SettingsGrowth.vue`、`src/types/progression.ts`、`src/locales/*.json`、`src/components/ui/`(新增 Celebration 元件)

---

## GR-03 「下一步是什麼」不明：進度資訊貧乏 — P1
**證據**
- `SettingsGrowth.vue:56-60` 僅顯示 `xpIntoLevel / xpToNext` 與連續天數；`toNextLevel` 文案「距離下一級 {value}」其實顯示的是「已累積/需求」，語意與文案相反（`zh-TW.json:115`）。
- `progressionPercent`（`SettingsGrowth.vue:18-21`）無最小視覺寬度。
- 無「今日已得 XP」、「今日首次完成獎勵是否已拿」、「再 N 天達成連續 7 天成就」等提示。
- `xpToNext` 曲線（`progression.ts` types:38-41，100+25*(L-1)）無說明；Lv35 的總 XP 約 `totalXpForLevel(35)` ≈ 26,000，以每日約 40 XP 計需 650 天，使用者看不到這個預期。

**使用者影響**：不知道還要多久、不知道今天做什麼最有效。

**子任務**
- [ ] 文案改為「還需 {remaining} XP 升級（{into}/{need}）」，並以 `xpToNext - xpIntoLevel` 計算 remaining。
- [ ] 新增「今日」區塊：今日 XP、今日首完成是否已領、今日連續是否已計入。
- [ ] 顯示距離下一個進化門檻的等級與預估天數（以近 7 天平均 XP 估算，資料不足時隱藏）。
- [ ] 進度條在 `<2%` 時給最小寬度；100% 時顯示「即將升級」。
- [ ] 加入「連續天數明日到期」提示（`lastActiveLocalDate` 為昨日 → 今日還沒完成）。
- [ ] 顯示最長連續 `longestStreak`（已在快照中但 UI 未使用）。
- [ ] 提供 XP 曲線說明或進階等級表（Lv→總 XP）。
- [ ] 針對 Lv35 master 後 `xpToNext` 仍持續增加的行為決定是否設上限/顯示「滿階」。

**觸及檔案**：`src/components/status-panel/SettingsGrowth.vue`、`src/types/progression.ts`、`electron/progression.ts`(新增 today 統計)、`src/locales/*.json`

---

## GR-04 成就解鎖預設完全無聲（慶祝被 reactions 開關擋住）— P0
**證據**
- `src/components/DesktopPet.vue:568-570` 解鎖 → `playAchievementReward`；`DesktopPet.vue` `playAchievementReward` 第一行 `if (!store.reactionsActive) return`。
- `agentStore.ts` `reactionsEnabled = localStorage('agent-pet-fx') === '1'`，註解寫明「Off by default」。
- 沒有 toast、氣泡或面板紅點；`achievementUnlock` 只被 DesktopPet 消費（grep 唯一消費者）。
- `visualReward: 'sparkle' | 'badge'`（`achievement.ts:36`）在 renderer 沒有差異化實作，皆呼叫同一個 `playReward()`。

**使用者影響**：預設使用者解鎖成就時什麼都看不到，以為成就壞掉；解鎖後也沒有「新」標記，要主動開設定頁才會發現。

**子任務**
- [ ] 解鎖通知與「動畫效果」解耦：即使 reactions 關閉，也顯示一則輕量 toast（尊重 DND）。
- [ ] 成就 toast 內容：標題、描述、tokenQuality 標籤（沿用 `achievementText`）。
- [ ] 面板 Settings 分頁加「新」紅點，直到使用者看過（持久化 `lastSeenAchievementAt`）。
- [ ] 實作 `sparkle` vs `badge` 兩種視覺差異（粒子 vs 徽章彈出）。
- [ ] DND 期間解鎖排入佇列，結束後一次彙整顯示。
- [ ] 多成就同時解鎖（`reconcileCompletedSessions` 回補）時合併成一則「解鎖 3 個成就」。
- [ ] 提供「重播」按鈕於成就卡，方便使用者再次欣賞。
- [ ] E2E：reactions 關閉時仍出現 toast。

**觸及檔案**：`src/components/DesktopPet.vue`、`src/stores/agentStore.ts`、`src/components/status-panel/SettingsGrowth.vue`、`src/components/ui/`(Toast)、`src/locales/*.json`

---

## GR-05 成就不可探索：沒有進度、沒有排序、10 個固定 — P1
**證據**
- `SettingsGrowth.vue:73-89` 靜態 grid，鎖定的成就顯示描述但無進度（例如 3/100 sessions）。
- `AchievementView`（`achievement.ts:75-84`）無 `progress/target` 欄位；`AchievementEvaluationContext`（38-48）已有 `completedSessions/tokenTotal/activeDays/currentStreak/level` 但未回傳。
- 未解鎖與已解鎖混排，`unlockedAt` 在 UI 不顯示（grid 只有「已解鎖」字樣）。
- 只有 10 個成就，且 `night_owl`、`busy_day` 為單次事件；`getting_serious` 要 100 session 卻沒有中間里程碑（1 → 100 之間空白）。

**使用者影響**：不知道離下個成就多遠；成就牆在數週後就「全部看完」，沒有長尾目標。

**子任務**
- [ ] `AchievementDefinition` 增加 `progress(context) → {current, target}`，`getSnapshot` 一併回傳。
- [ ] 卡片顯示進度條與「42 / 100」。
- [ ] 顯示解鎖日期（`unlockedAt` 以 locale 格式化）。
- [ ] 排序/篩選：已解鎖、進行中（依接近度）、未開始；預設把「最接近完成」放前面。
- [ ] 新增階梯式成就（10/50/100/500 sessions、10M/100M tokens、14/30 天連續）。
- [ ] 隱藏式成就（彩蛋）以「？？？」顯示，保留探索感。
- [ ] 成就分類（里程碑 / 習慣 / 探索 / 等級）分組顯示。
- [ ] 版本升級（`version` 欄位）時的「成就更新」說明與重新評估策略文件化。
- [ ] 成就牆在窄面板下的 grid 排版與 a11y（`role=list`）檢查。

**觸及檔案**：`src/types/achievement.ts`、`electron/achievements.ts`、`src/components/status-panel/SettingsGrowth.vue`、`src/locales/*.json`

---

## GR-06 成就「一百萬 Token」被 cache read 灌水，且標示 exact — P0（正確性）
**證據**
- `electron/local-usage.ts:158-165` Claude 的 `input = input_tokens + cache_read_input_tokens + cache_creation`，全部算入 `input`，並 `quality: 'exact'`（行 ~184）。cache read 在長 session 中可佔 90% 以上。
- `achievement.ts:125-127` `one_million` 以 `tokenTotal >= 1_000_000` 解鎖；`achievementOneMillionHelp`（`zh-TW.json:144`）寫「累計觀測到 1M Token」。
- `StatusPanelHistory.vue:226` 總 Token = input + output，含 cache。
- 與 `quota` 的實際計費/額度消耗無對應。

**使用者影響**：幾小時即達 1M；History 的 Token 數字與使用者從 Anthropic/OpenAI 後台看到的差距很大，信任受損。「exact」標籤誤導。

**子任務**
- [ ] 在 `HistoryTokenUsageRecord`/`daily_stats` 增加 `token_cache_read`、`token_cache_write` 欄位（schema migration v6）。
- [ ] 預設 UI 顯示「新輸入 + 輸出」，cache 另列（可切換「含快取」）。
- [ ] 成就使用「不含 cache read」的總量，或提高門檻並在描述註明計算方式。
- [ ] 重新定義 `tokenQuality`：cache 欄位拆分後才標 exact；否則標 `approximate`。
- [ ] 說明文案新增「Token 計算方式」tooltip。
- [ ] 回補：用 `rebuildDailyStats` 路徑重新匯入或標示舊資料「含快取」。
- [ ] Codex 路徑（`codexUsage`）也確認 cached_input 的處理一致。
- [ ] 單元測試：含大量 cache_read 的 fixture，驗證總量與成就判定。

**觸及檔案**：`electron/local-usage.ts`、`electron/history.ts`(schema/summary)、`src/types/history.ts`、`src/types/achievement.ts`、`electron/achievements.ts`、`StatusPanelHistory.vue`、`src/locales/*.json`

---

## GR-07 History 固定 7 天，無時間範圍選擇，與「保留 90 天」不一致 — P1
**證據**
- `electron/history.ts:545-550` `Array.from({ length: 7 }, ...)` 寫死 7 天；`retentionDays` 預設 90（`history.ts:46`）。
- `StatusPanelHistory.vue:246-262` 長條圖固定 7 根；`historyRetention` 文案說「原始事件保留 90 天；長期統計會保留」，但 UI 無法看超過 7 天。
- `getExport`（`history.ts:629-636`）只匯出 `getSummary()` 的 7 天摘要，不含 90 天資料或事件。
- `historyDayLabel`（`StatusPanelHistory.vue:78-81`）以「最後一天」判斷「今天」，沒有星期資訊；`toLocaleDateString` 僅 `M/D`。

**使用者影響**：無法看週/月趨勢、無法比較本週與上週；匯出給人以為是完整歷史卻只有 7 天。

**子任務**
- [ ] `getSummary(petId, projectId, range)` 支援 `7d / 30d / 90d / all`，days 動態產生。
- [ ] UI 加分段控制（7 / 30 / 90 天），記住選擇。
- [ ] 30/90 天改用更密集的圖（週聚合或細長條 + hover 提示）。
- [ ] 日標籤加星期縮寫與週末底色，今天以標記而非替換日期。
- [ ] 顯示區間比較（本週 vs 上週 delta ↑12%）。
- [ ] 匯出支援選定範圍，並提供 CSV（每日一列）+ JSON 兩種格式。
- [ ] 匯出檔名含範圍與專案過濾條件；匯出內容加入說明欄位（時區、token 口徑）。
- [ ] 效能：`IN (?, ?, ...)` 改為 `local_date BETWEEN ? AND ?`，需確認索引（見 GR-12）。

**觸及檔案**：`electron/history.ts`、`electron/ipc/history.ts`、`src/types/history.ts`、`electron/preload`（IPC 型別）、`StatusPanelHistory.vue`、`src/locales/*.json`

---

## GR-08 圖表可讀性與無障礙不足 — P1
**證據**
- `StatusPanelHistory.vue:248-261` 長條只有 Token 一個維度；每根上方都印出 `formatCompactNumber`（7 個重疊風險，窄面板）。
- 沒有 Y 軸/基準線，`historyDayBarHeight` 以區間最大值正規化（`:43-46,106-109`），全零時 `max=1` 無提示；最小高度 4% 與 0 的視覺差異微小。
- `title` tooltip 內容 `${day.sessionsCompleted}${t('historyCompleted')}`（`:253`）沒有空格也沒有 token 明細，且 `title` 在觸控/鍵盤不可用。
- `aria-label` 寫死英文 `tokens`（`:256`）。
- input/output 沒有堆疊分色；agent 區塊用 `✓`/`!` 符號（`:271`）語意不明且未 i18n。
- Agent 分布條：有 token 時用 token 佔比、無 token 時改用時間佔比（`:131-137`），同一條在不同資料下代表不同東西卻無標示。

**使用者影響**：看不出每天細節，鍵盤/螢幕閱讀器使用者無法取得資料，條的意義會悄悄切換。

**子任務**
- [ ] 長條改為堆疊（input / output），加圖例。
- [ ] 加 2~3 條水平參考線與最大值刻度標籤，移除每根上的重複數字（僅 hover/focus 顯示）。
- [ ] 以 focusable 的自訂 tooltip 取代 `title`，內容含日期、完成/失敗、token in/out、活躍時間。
- [ ] 所有 aria-label 走 i18n，並改為「M月D日，12.3k tokens，完成 5 次」。
- [ ] 零資料日用虛線底座表示「無活動」，與「有活動但極小」區分。
- [ ] Agent 分布的指標標示（「依 Token」/「依時間」）並允許切換。
- [ ] `✓`/`!` 改成 icon + 文字標籤（成功/失敗）。
- [ ] 色彩對比與 Liquid Glass 規範（`references/liquid-glass.md`）核對；失敗用語意色。
- [ ] 窄寬度（面板最小寬）截圖測試。

**觸及檔案**：`src/components/status-panel/StatusPanelHistory.vue`、`src/components/ui/`(新增 BarChart/Tooltip)、`src/locales/*.json`、對應 CSS

---

## GR-09 新使用者空狀態與冷啟動處理缺失 — P1
**證據**
- `StatusPanelHistory.vue:222-283` 只要拿到 summary 就渲染完整 UI，全零資料時顯示 `0`、空長條與「0m」，沒有引導。
- `SettingsGrowth.vue:66` 無進度時只顯示「本機儲存準備完成前，成長資料無法使用」，無法區分「尚未開始」與「資料庫壞了」（`progression.ts` 構造失敗時整個 store 為 null，見 `runtime.ts` 2504-2509 的註解）。
- Usage 分頁（`StatusPanelUsage.vue:47-52`）在尚未登入 Codex/Claude 時只看到 provider 錯誤原文，沒有「如何登入」指引。
- `agents.length === 0` 僅顯示 `historyNoData` 一行（`:265`）。
- 新手沒有導覽：XP、成就、History、Usage 之間的關係無說明。

**使用者影響**：第一次打開的人看到一堆 0 與錯誤，不知道「要先去 CLI 跑一次任務」。

**子任務**
- [ ] 偵測 `totals` 全零且 `agents` 空 → 顯示空狀態插圖 + 「完成第一次任務即可看到統計」+ 整合安裝檢查連結。
- [ ] 成長卡片在 0 XP 顯示「第一次完成任務 +30 XP（含每日首次）」的行動呼籲。
- [ ] 區分「尚未有資料」與「儲存不可用」，後者提供重試與診斷連結。
- [ ] Usage 錯誤依類型顯示：未登入 / token 過期 / 離線 / 被限流，各自給下一步（見 GR-10）。
- [ ] 第一次進入 History 時顯示一次性的「資料只存本機、如何計算」說明卡。
- [ ] 成就牆在 0 解鎖時高亮第一個容易達成的成就（`hello_world`）。
- [ ] 空狀態文案新增 i18n（zh-TW/en-US）。
- [ ] 測試：全新 profile 截圖。

**觸及檔案**：`StatusPanelHistory.vue`、`SettingsGrowth.vue`、`StatusPanelUsage.vue`、`src/locales/*.json`、`src/components/ui/EmptyState.vue`(新增)

---

## GR-10 額度（Quota）錯誤與重新整理回饋不足 — P0
**證據**
- `StatusPanelUsage.vue:50-52` 全域錯誤只在「完全沒有舊資料」時顯示；之後再失敗，`store.quotaError` 被設定（`agentStore.ts` refreshQuota catch）但面板不顯示，舊數據靜默保留。
- 單一 provider 失敗（`:65-67`）僅顯示錯誤文字，無重試按鈕、無原因分類。
- 「更新於」顯示的是整體 `store.quotaUsage.updatedAt`（`:63`），但每個 provider 在每張卡片都重複同一個時間；失敗 provider 的「上次成功時間」不存在。
- `electron/quota.ts:758-759,764-766`：`force` 且距上次抓取 <10 秒時直接回傳 cache，無任何訊息；錯誤結果也被快取 90 秒（`cachedResult = result` 不分成敗），使用者按「重新整理」可能 10~90 秒內看到同樣的錯誤。
- Refresh 按鈕只切換文字「重新整理中」（`:91-93`），沒有 spinner、沒有完成確認、沒有 aria-live。
- 自動輪詢只在 `hasQuotaCapableSessions` 時啟動（`App.vue:56-58`）且僅 pet 視窗；面板開啟 Usage 分頁僅在 `!store.quotaUsage` 時才抓（`StatusPanel.vue:105`），舊資料可能是數小時前。
- 2 分鐘輪詢（`agentStore.ts:57`）與 90 秒伺服端 TTL 並存，使用者看不到下次更新時間。

**使用者影響**：以為額度是最新的卻其實過期；失敗時不知道要登入、等待還是重試。

**子任務**
- [ ] 每張 provider 卡顯示自己的 `fetchedAt` 與相對時間（「3 分鐘前」），超過 5 分鐘標示「資料可能過期」。
- [ ] 失敗時保留上次成功資料並疊加錯誤橫幅（含「重試」按鈕），而非整張卡被錯誤取代。
- [ ] 錯誤分類（未登入 / 授權過期 / 逾時 / 429 / CLI 缺失），各自對應引導文案與動作（`quota.ts:726` 已有 429 文案可重用）。
- [ ] 不快取失敗的 provider 結果，或縮短失敗 TTL 至 ≤10 秒；成功/失敗分別計時。
- [ ] force 在冷卻中時回傳 `{ throttled: true, retryInSec }`，UI 顯示「請稍候 N 秒」。
- [ ] 按鈕加 spinner、完成後 aria-live 公告「已更新」。
- [ ] 開啟 Usage 分頁若資料超過 TTL 則自動刷新；面板也應有自己的輪詢節奏（可見時）。
- [ ] 顯示「下次自動更新」倒數或在 tooltip 說明更新頻率。
- [ ] 錯誤原文過濾：`translateBackendError` 結果避免洩漏路徑或 token 片段（稽核 `safeError`）。

**觸及檔案**：`electron/quota.ts`、`electron/ipc/quota.ts`、`src/stores/agentStore.ts`、`src/App.vue`、`src/components/StatusPanel.vue`、`StatusPanelUsage.vue`、`src/locales/*.json`

---

## GR-11 額度數值正確性：未夾限百分比、基準語意不一致 — P0
**證據**
- `quota.ts:436-449` `remainingPercent: 100 - used`，`used` 若 >100（超額）或負值將得負的剩餘值；`finitePercent` 是否夾限需確認（`:103`）。
- `history.ts` `normalizeQuotaSnapshot`（~1060-1072）遇到 `remaining < 0 || > 100` 時 `continue` 整個 window 丟棄；整個 provider 的 windows 可能被靜默清空，History 內的 quota 快照因此缺資料。
- `StatusPanelUsage.vue:72` 顯示「剩餘 xx%」，條為 remaining；但常見使用者心智是「已用」，兩者不對照（Claude 後端回報 `utilization`=已用）。
- `formatReset`（`:16-28`）以 `Math.round` 計分鐘，59.6 分鐘會顯示「1 小時 0 分」/ 小於 1 分鐘顯示「立即重置」即使仍有 29 秒；`nowTick` 的更新頻率由父層決定，顯示可能落後。
- `formatResetAt` 使用 `toLocaleString` 含年份，窄版面佔空間，且未標時區。
- 低額度（<10%）沒有警示色/通知；沒有預測「依目前速度何時耗盡」。

**使用者影響**：數字錯誤或誤導，用量警示功能缺位，使用者可能被突然限流。

**子任務**
- [ ] 在 `mapClaudeWindow` / `mapCodexWindow` 對 `usedPercent`、`remainingPercent` 夾限到 [0,100]，並保留 `overage` 旗標。
- [ ] `normalizeQuotaSnapshot` 改為夾限而非丟棄，並補單元測試（used=105、-3）。
- [ ] UI 提供「剩餘 / 已用」切換或同時顯示（「已用 72% · 剩 28%」）。
- [ ] 重置倒數改為向上取整並在 <1 分鐘顯示秒或「即將」；`nowTick` 在面板可見時每 30 秒更新。
- [ ] 重置時間改用不含年份的短格式（`週三 14:30`）並顯示時區縮寫。
- [ ] 低額度分級顏色（<25% warn、<10% danger），加可選系統通知。
- [ ] 以 `quota_snapshots` 歷史資料估算消耗速率，顯示「預計 2h15m 後用完」（資料不足時隱藏）。
- [ ] 加入 Claude 週額度 / 5 小時額度 / Opus 專屬額度的說明 tooltip（`quotaWindowLabel` 的標籤語意）。

**觸及檔案**：`electron/quota.ts`、`electron/history.ts`、`src/utils/format.ts`、`StatusPanelUsage.vue`、`src/stores/agentStore.ts`(normalizeQuotaUsage)、`src/locales/*.json`

---

## GR-12 History 查詢與歷史額度快照效能/容量問題 — P1
**證據**
- `history.ts:555-565,585-592` 每次 summary 跑兩段 `daily_stats` 掃描，條件 `(pet_id = ? OR pet_id = ?) AND local_date IN (...)`；`OR` 通常使索引利用變差。需檢查 `daily_stats` 是否有 `(local_date, pet_id)` 索引（migration 區 ~758-900）。
- `quota_snapshots` 以 `INSERT OR REPLACE` + `snapshot_id=digest(updatedAt+providers)`（`:520-531`）；每次輪詢（2 分鐘）都產生新 `updatedAt`，因此永不去重，100 筆上限只涵蓋約 3.3 小時；即使數值沒變也寫入並廣播 `historyUpdated`（`ipc/quota.ts:20`），觸發面板重新抓 summary → 又觸發 `refreshLocalUsage()`（見 GR-13）。
- `getSummary` 只取最新一筆 quota（`:606`），但保留 100 筆；這些歷史沒有任何 UI 使用。
- `getAchievementCompletedSessions`（`:~640-668`）一次拉取至多 100,000 筆 events 到記憶體並做 SHA256，每次啟動 `reconcileAchievementsFromHistory`（`runtime.ts:2502`）執行。
- `clear()` 一次執行多段 `DELETE`；`pruneEvents` 僅刪 events，`daily_stats` 與 `sessions` 無限增長（每日 × 專案 × adapter 的列）。

**使用者影響**：長期使用後啟動變慢；面板每次開啟都耗電；資料庫無限成長。

**子任務**
- [ ] 以 `EXPLAIN QUERY PLAN` 檢查並新增索引 `daily_stats(local_date, pet_id)`；`OR pet_id` 改為 `pet_id IN (?, ?)` 或 UNION。
- [ ] 兩次查詢合併：一次取出列後在 JS 內聚合 agents（避免重複掃描）。
- [ ] quota 快照只在數值或錯誤狀態改變時寫入；`snapshot_id` 不含 `updatedAt`。
- [ ] 依時間設定保留（如 30 天、降頻取樣）取代固定 100 筆；或直接移除未使用的歷史。
- [ ] 達成就回補改為增量（記錄 `lastReconciledEventId`/時間），避免每次啟動全量掃描 10 萬筆。
- [ ] 為 `sessions`、`daily_stats` 設定彙總保留策略（超過 N 天合併為月彙總）。
- [ ] 啟動時 `VACUUM`/`PRAGMA optimize` 排程與 DB 大小顯示於設定。
- [ ] 加基準測試：90 天 × 5 專案 × 3 adapter 的資料量，summary 耗時 < 20ms。

**觸及檔案**：`electron/history.ts`、`electron/ipc/quota.ts`、`electron/main/runtime.ts`、`electron/achievements.ts`

---

## GR-13 本機 JSONL 掃描在主行程同步執行且觸發頻繁 — P0（效能）
**證據**
- `local-usage.ts:285-326` `filesUnder` 使用 `readdirSync`、`lstatSync`、`realpathSync.native` 對每個檔案/目錄逐一同步呼叫（最多 2000 檔、深度 8）。
- `local-usage.ts:595-640` `scanNow()` 內 `readUsageFileRange`（同步讀檔，總量上限 64MB）與 `history.batch` SQLite 寫入全在主行程同步執行；`scan()`（`:559-565`）只是 `Promise.resolve().then(...)` 包裝，並未讓出事件迴圈。
- 觸發點：每 60 秒 `setInterval`（`runtime.ts:~2500`）、啟動時、每次 `historySummary` IPC（`ipc/history.ts:28-31`）、每次匯出（`:51`），以及 `historyUpdated` 廣播 → 面板 `refreshHistory`（`StatusPanelHistory.vue:192-194`）→ 又一次 scan 的迴圈（scan 若 `recordsImported>0` 會再次廣播 `runtime.ts:2372`）。
- 即使檔案未變也要重新遍歷整個目錄樹（stat 全部檔案）。
- `fileCache`（`:540`）僅存於記憶體，重啟後所有檔案（≤16MB 每個）都要從頭解析，雖有 `dedupeKey` 但仍需完整讀取。
- 超過 `maxFileBytes`(16MB) 的 session 檔整個被跳過（`:603-606`），長 session 的 Token 被永久漏計且 UI 沒提示（`filesSkipped` 未外露）。
- Claude 的 `claudeUsage` 對同一 message id 的串流多筆記錄是否去重取決於 `dedupeKey`（`:150-190`），需驗證最終累計取最後一筆而非加總。

**使用者影響**：主行程凍結造成寵物動畫卡頓/拖曳延遲，尤其在大量 log 的機器；大 session 的用量被漏掉；筆電耗電。

**子任務**
- [ ] 將掃描搬到 `worker_threads` / `utilityProcess`，主行程只接收彙總結果。
- [ ] 以 `fs.promises` + 分批 `setImmediate` 讓出事件迴圈（短期折衷）。
- [ ] 使用 `fs.watch`（或 chokidar 類）針對有變更的檔案增量讀取，取代全樹輪詢；輪詢退化為 5 分鐘保底。
- [ ] 持久化 `fileCache`（path/inode/size/mtime/offset）到 SQLite，重啟後避免整檔重讀。
- [ ] 以 mtime < cutoff 預先過濾檔案，不 stat/不讀超出保留期的檔案。
- [ ] `historySummary` IPC 改為讀取現有資料（不等待掃描）；掃描完成後再推送更新；加 debounce（≥10 秒）避免廣播迴圈。
- [ ] 對 >16MB 的檔案改為串流逐行解析（readline）而非跳過，或以尾端 offset 增量；至少在 UI 顯示「N 個檔案因過大未納入」。
- [ ] 暴露掃描診斷：上次掃描時間、耗時、`filesScanned/Skipped`，於「進階」區顯示。
- [ ] 加上掃描耗時的 telemetry（本機 console）與預算測試（2000 檔假資料 < 200ms 阻塞）。

**觸及檔案**：`electron/local-usage.ts`、`electron/main/runtime.ts`、`electron/ipc/history.ts`、`StatusPanelHistory.vue`、新增 `electron/local-usage-worker.ts`

---

## GR-14 時區 / 日期邊界與連續天數正確性 — P1
**證據**
- `progression.ts:80-95` / `history.ts:98-110` / `achievements.ts:150-156` 各自複製 `localDateKey`（三份重複實作）；`new Date(\`${key}T12:00:00\`)` + `setDate` 做日期位移（`progression.ts:98-102`、`history.ts:107-110`）在 DST 當日多半可行但依賴本機時區，旅行跨時區時 `lastActiveLocalDate` 與新時區日期可能不連續，連續天數被重設或重複計算。
- 本地日期以「事件時間 `occurredAt`」決定（`progression.ts:190-199`），但連續天數更新在 `awardCompletion` 只在 `success` 事件發生；`lastActiveLocalDate === date` 提前 return（`:420`）。若事件延遲到達（`event.timestamp` 為過去時間）且日期早於 `lastActiveLocalDate`，`continued` 為 false → `nextStreak = 1`，**會把目前連續天數重設為 1**（補送舊事件即破壞連續）。
- 午夜跨日：session 開始在 23:50、success 在 00:10，`active-time` 與 completion 的 `local_date` 各以 `occurredAt` 計，同一 session 的 XP 落在不同天；`first-completion` 的鍵以完成日計，沒有問題但 History 的 `active_ms` 歸屬日期不直觀。
- `ledger_id` 與 `idempotency_key` 都含 `petId:ruleId:key`（`progression.ts:455-465`），`first-completion:${date}` 在更改時區後同一絕對日可能重複領取。
- `night_owl` 用 `localHour` 判斷 0–5 點（`achievements.ts:~222`），旅行或夏令調整下可能不一致。
- `historyDateLabel`（`StatusPanelHistory.vue:72-76`）使用 `T12:00:00` 避免日期偏移，這是好的；但 `getSummary` 的「今天」由主行程決定，面板跨午夜開著時不會自動刷新。
- 匯出檔名使用 `new Date().toISOString().slice(0,10)`（`ipc/history.ts:52`）是 UTC 日期，與使用者本地日期可能差一天。

**使用者影響**：連續天數神秘歸零、深夜/旅行時日期與預期不符、匯出檔名日期錯。

**子任務**
- [ ] 抽出共用 `src/utils/local-date.ts`（`localDateKey/previousLocalDate/dateOffset/localHour`），三處改用。
- [ ] `awardCompletion` 對 `date < lastActiveLocalDate` 的遲到事件不重設連續（只補帳、不改 streak）。
- [ ] 將時區（IANA）與 UTC offset 存入 ledger metadata，改變時區時以舊帳為準。
- [ ] 面板跨午夜時在 `nowTick` 日期變動時重新抓 summary。
- [ ] 匯出檔名改為本地日期；匯出 JSON 加 `timezone` 與 `generatedAtLocal`。
- [ ] 加測試：DST 切換日、跨時區、遲到事件、午夜 session。
- [ ] 文件化「一天」的定義（以完成時間的本地日）並顯示於說明。
- [ ] 評估 streak 的寬限（例如每週 1 次「護盾」）以降低挫折感（產品決策）。

**觸及檔案**：`electron/progression.ts`、`electron/history.ts`、`electron/achievements.ts`、`electron/ipc/history.ts`、新增 `src/utils/local-date.ts`、`StatusPanelHistory.vue`

---

## GR-15 Token 數字格式與 i18n 不一致 — P2
**證據**
- `StatusPanelHistory.vue:47-49,115-117` 統計與長條用 compact（`1.2K`/`1.2M`，locale 相關；zh-TW 會顯示「1.2萬」「1.2億」），但 Agent 區塊（`:268,270`）使用 `toLocaleString` 完整千分位；同一頁兩種風格。
- 長條柱圖數值用 compact `maximumFractionDigits: 1`，無法顯示 <1000 的小數；不同 locale 的 compact 單位（萬/億 vs K/M）會讓使用者對「M」的認知不同，也與成就文案的「1M」（`zh-TW.json:144`）不一致。
- `historyDuration`（`:83-87`）輸出硬編碼英文 `m`/`h`（`'${minutes}m'`），未走 i18n；超過 24h 顯示 `30h 12m` 無天。
- `aria-label` 內 `tokens` 硬編碼（`:256`）、`${day.sessionsCompleted}${t('historyCompleted')}`（`:253`）無分隔。
- `formatUpdated`（`:178-180` 與 `StatusPanelUsage.vue:39-41`）重複實作；`StatusPanelHistory.vue:247` 把毫秒轉 ISO 再轉回時間，繞圈。
- `moodStage`、`evolutionLabels` 在 `SettingsGrowth.vue:14-27` 與 `StatusPanelHistory.vue:21-31` 重複；違反專案「共用函式抽取」慣例。
- 總 Token 沒有 input/output 比例與「約等於」提示。

**使用者影響**：數字閱讀成本高，中英文顯示不一致，維護容易漏改。

**子任務**
- [ ] 新增 `src/utils/format.ts`：`formatTokens(n, {mode:'compact'|'full'})`、`formatDuration(ms)`（i18n、含天），全站統一。
- [ ] 決定 zh-TW 顯示 `K/M` 或 `萬/億`，並與成就文案一致。
- [ ] `<1000` 顯示完整數字，`≥1000` 才 compact；tooltip 顯示完整千分位。
- [ ] 所有 aria-label/tooltip 的單位與連接詞入 i18n key。
- [ ] 抽共用 composable：`useEvolutionLabel`、`useMoodStage`、`formatTime`。
- [ ] 移除 `StatusPanelHistory.vue:247` 的 ISO 往返。
- [ ] 單元測試：各 locale 的格式化輸出快照。

**觸及檔案**：`src/utils/format.ts`、`StatusPanelHistory.vue`、`SettingsGrowth.vue`、`StatusPanelUsage.vue`、`src/locales/*.json`、`src/composables/`(新增)

---

## GR-16 匯出 / 清除 / 重設的 UX 與資料治理風險 — P1
**證據**
- `ipc/history.ts:47-66` 匯出：`title: '匯出 History'` 硬編碼中文（`:54`），不走 i18n；只匯出 `activePetId()` 的 7 天摘要（見 GR-07）；成功只顯示「已匯出」不含路徑，也沒有「在 Finder 中顯示」。
- `ipc/history.ts:34-45` `historyClear` 只清 History，**不清 progression/XP 或 achievements**；且 `clear()`（`history.ts:~671-681`）會把 `LOCAL_USAGE_CUTOFF_KEY` 設為現在，永久不再回補之前的 Token（`historyClearConfirm` 文案是否說明需確認）。XP/連續/成就仍保留，使用者可能以為全部重設。
- `SettingsGrowth.vue:45` 的「重設」按鈕（`store.resetMood()`）立即執行無確認，與 History 的確認對話不一致；且名稱「重設」放在寵物心情卡，容易被誤認為重設成長。
- 沒有重設 XP/成就的入口（也不確定是否應該有），沒有匯出成長資料（XP ledger、成就）。
- 匯出時先 `await refreshLocalUsage()`（`:51`），在大 log 下會讓 Save dialog 延遲數秒且無 loading 指示。
- 匯出錯誤只區分 `cancelled`/`write_failed`/`unavailable`，UI 一律「操作失敗」（`StatusPanelHistory.vue:144-147`）。
- `historyAction` 狀態文字沒有自動淡出（直到下次操作）。

**使用者影響**：匯出內容不如預期；清除後行為與預期不符；匯出等待無回饋。

**子任務**
- [ ] 對話框標題與預設檔名走 i18n；檔名含範圍、專案、本地日期。
- [ ] 匯出內容納入：日彙總（所選範圍）、agent 分布、成長快照（XP/等級/連續）、成就清單；提供 JSON + CSV。
- [ ] 匯出成功顯示完整路徑 + 「在 Finder 中顯示」動作。
- [ ] 匯出中顯示 loading；將 `refreshLocalUsage` 改為非阻塞或加逾時。
- [ ] 清除對話框明列「會清除什麼 / 不會清除什麼（XP、成就保留）」；提供「同時重設成長」的獨立危險操作（需二次確認）。
- [ ] 心情重設按鈕加確認或 undo toast，並改名「重設今日心情」。
- [ ] 錯誤訊息依 `write_failed`/`unavailable` 區分並提示（磁碟滿/權限）。
- [ ] 狀態訊息 5 秒後自動消失並可手動關閉。
- [ ] 匯出檔案隱私檢查：不含完整專案路徑（目前 `projectId` 為指紋，需確認 summary 內無本機路徑），符合專案「不上傳個資」記憶準則。

**觸及檔案**：`electron/ipc/history.ts`、`electron/history.ts`、`electron/progression.ts`、`electron/achievements.ts`、`StatusPanelHistory.vue`、`SettingsGrowth.vue`、`src/locales/*.json`

---

## 附：其他次要觀察（未獨立成項）
- `progression.ts:59` `MAX_ACTIVE_GAP_MS = 5 分鐘`；活躍時間僅在事件抵達時結算，長時間 `tool-running` 且無新事件的情況會少算（最多 5 分鐘）。每 30 分鐘 +2 XP、每 session 上限 10 點（`src/types/progression.ts:35-36`），相對完成 +20 偏低，使用者感受不到「長時間工作」的價值。
- `progression.ts:157-159` `AgentPetsIntegrationTest` 事件被排除在 XP 外（正確），但 History 與 achievements 也各自排除，三處判斷分散，建議集中。
- `progression.ts:210` 每次開啟都 `PRAGMA journal_mode = WAL`，多個 store（progression/achievements/history）各自開 DB，可考慮合併連線或同一檔案。
- `src/components/status-panel/StatusPanelHistory.vue` 同時含 `historyGrowthLine`（等級/進化/心情/連續）與 `SettingsGrowth` 的資訊重複，資訊架構分散於兩個分頁（Settings 與 History）。

---

# 新「成長與統計」畫面設計提案

## 資訊架構
現況：成長在 Settings 分頁（`SettingsGrowth`）、統計在 Dashboard 的 History 分頁、額度在 Usage 分頁，三處資訊重疊又分散。
建議：Dashboard 新增一個 **「成長」** 分頁（取代 History 的 growth-line），內含三個子區段：**總覽 / 統計 / 成就**；Usage 保留獨立（額度屬即時狀態）。

## 線框 1：總覽（Overview）
```
┌──────────────────────────────────────────────┐
│  成長    [ 總覽 ] [ 統計 ] [ 成就 ]           │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │  [寵物圖]   Lv 7 · 幼體                │  │
│  │              ████████░░░░  64 / 100 XP │  │
│  │  還需 36 XP 升級 · Lv10 進化為「少年」 │  │
│  └────────────────────────────────────────┘  │
│  今日  +30 XP   ✓首次完成  🔥連續 4 天       │
│  ⚠ 今晚完成一次任務可延續連續天數             │
│                                              │
│  ▸ 如何獲得 XP                               │
│    完成工作階段 +20 · 每日首次 +10           │
│    每 30 分鐘活躍 +2 · 連續日 +5             │
│                                              │
│  最近獲得                                    │
│   10:42  完成工作階段          +20           │
│   10:42  每日首次完成          +10           │
│   09:10  持續專注 30 分鐘      +2            │
│                                              │
│  下一個成就                                  │
│   [🏆 忠實夥伴  ███░░░░ 4/7 天]  [查看全部]  │
└──────────────────────────────────────────────┘
```

## 線框 2：統計（Stats）
```
┌──────────────────────────────────────────────┐
│  [7天] [30天] [90天]        專案: [全部 ▾]   │
├──────────────────────────────────────────────┤
│  Token(不含快取)    完成        活躍時間      │
│   1.2M  ↑12%        34 ↑3       18h 20m ↓5%  │
│  含快取 9.8M (切換) 失敗 2      (較上週)      │
│                                              │
│  每日 Token   ■輸入 ■輸出                    │
│  1M ┤        ▇                               │
│     ┤   ▅    ▇  ▃                            │
│  0  ┼───┴────┴──┴──┴──┴──┴──                 │
│     一  二  三  四  五  六  日(今天)          │
│     (hover/focus 顯示明細 tooltip)           │
│                                              │
│  Agent 分布  [依 Token ▾]                    │
│  Claude Code ████████████░░  74%  980k       │
│  Codex       █████░░░░░░░░░  26%  340k       │
│                                              │
│  資料自 2026/10/01 起（本機）· 掃描於 2 分鐘前│
│  [匯出 JSON] [匯出 CSV] [清除統計…]          │
└──────────────────────────────────────────────┘
```

## 線框 3：成就（Achievements）
```
┌──────────────────────────────────────────────┐
│  成就 3 / 10     [全部|進行中|已解鎖]        │
├──────────────────────────────────────────────┤
│  進行中（依接近度）                           │
│  🔒 忠實夥伴   連續 7 天     ███░░░░  4/7    │
│  🔒 初窺門徑   100 個工作階段 █░░░░░  34/100 │
│  🔒 百萬字     1M Token(不含快取) ██░ 62%    │
│                                              │
│  已解鎖                                      │
│  🏆 Hello World   2026/10/03  ✨             │
│  🏆 夜貓子        2026/10/12  ✨             │
│  🏆 等級 10       2026/10/29  🎖               │
│                                              │
│  ？？？  隱藏成就（繼續探索）                 │
└──────────────────────────────────────────────┘
```

## 線框 4：解鎖 / 升級慶祝（桌面寵物上，不受 reactions 開關影響，僅受 DND 影響）
```
        ✨ 升級！ Lv 7 → Lv 8 ✨
   ┌──────────────────────────────┐
   │ 🏆 解鎖：忠實夥伴            │
   │ 連續 7 天完成工作             │
   │          [查看]  [略過]       │
   └──────────────────────────────┘
          [ 寵物 + sparkle 動畫 ]
```

## 線框 5：額度（Usage）改善
```
┌──────────────────────────────────────────────┐
│ Claude Code  [Max]        3 分鐘前更新 ⟳    │
│  5 小時   已用 72% · 剩 28%                  │
│  ██████████████░░░░░░  3h 12m 後重置(14:30)  │
│  ⚠ 依目前速度約 2h15m 後用完                 │
│  本週     已用 41% · 剩 59%   週三 09:00 重置│
├──────────────────────────────────────────────┤
│ Codex  [Plus]   ⚠ 無法更新（授權過期）        │
│  上次成功 2 小時前：剩 64%（可能已過期）      │
│  [重新登入說明]  [重試]                       │
└──────────────────────────────────────────────┘
 自動更新：每 2 分鐘（面板開啟時）  [立即更新]
```

## 設計原則
1. 每個數字都能回答「為什麼」與「下一步」：XP 有來源、進度有預估、成就有進度。
2. 慶祝與動畫解耦：資訊型通知（toast）預設開，裝飾型動畫尊重 reactions 開關與 DND。
3. 統計預設展示「新輸入 + 輸出」，cache 另列，避免數字灌水。
4. 所有失敗狀態保留最後成功資料、標示過期、並提供可行動的下一步。
5. 符合 Liquid Glass 規範（`.agents/skills/pet-skill/references/liquid-glass.md`）：卡片層級清楚、對比足夠、窄面板（最小寬度）下單欄堆疊。
6. 效能預算：面板開啟不觸發同步掃描；掃描在背景 worker，UI 讀取已彙總資料。

## 建議實作順序（依 ROI）
1. GR-06（Token 口徑）、GR-13（掃描阻塞）、GR-10/11（額度正確性與回饋）— 先修正確性與效能。
2. GR-01/02/04（XP 來源、升級、成就通知）— 成長動機核心。
3. GR-07/08/16（範圍、圖表、匯出）— 統計可用性。
4. GR-03/05/09/14/15/12 — 補齊說明、空狀態、日期正確性與格式統一。

註：依專案規範，單一 phase 完成後須完成功能驗證與安全審查，再待使用者確認後才變更版本；schema 變更（GR-06、GR-12）屬持久化 schema 變動，版本應採 minor 升級。
