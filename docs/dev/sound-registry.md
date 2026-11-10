# 音效 registry

跟音效有關的資料分在兩處，各自只寫一次：

| 資料 | 位置 |
|---|---|
| 哪個 Agent 狀態對應哪個 cue | `src/utils/agent-state-presentation.ts` 的 `AGENT_STATE_PRESENTATION[state].cue` |
| 每個 cue 的音形、開關、試聽按鈕 | `src/types/sound.ts` 的 `SOUND_CUE_REGISTRY` |
| 包絡（起音 0.01 秒、停止前多留 0.02 秒、增益倍率 1.6） | `SOUND_ENVELOPE` |
| 同一個 cue 3 秒內只播一次；任務跑不到 15 秒就完成時不播成功音 | `SOUND_POLICY` |
| 音量 0–100、滑桿步進 5 | `SOUND_VOLUME` |
| 持久化預設值（`soundEnabled` 關、音量 60、三個 cue 開關都開） | `SOUND_DEFAULTS`，主程序的 `DEFAULTS` 和 renderer store 的初始值都從這裡展開 |

什麼時候播仍然由邏輯決定，不寫進表：store 在「進入」waiting-permission、success、error 時才回傳 cue，waiting-input 要等 5 秒還沒回應才提醒；App.vue 只讓寵物視窗出聲；`shouldPlayCue` 依序檢查總開關、勿擾、寵物可見與 cue 自己的開關。

## 新增一個 cue

1. 在 `SoundCue` 加上名稱，在 `SOUND_CUE_REGISTRY` 補一列。少填任何欄位，型別檢查就會失敗。
2. 要有獨立開關的話，先在 `DesktopPreferences`、`DesktopPreferencesPatch` 和主程序的 `BOOLEAN_KEYS` 加上 key，再把它加進 `SoundCueSwitch` 與 `SOUND_DEFAULTS`。設定頁的開關和試聽按鈕會依 registry 的順序自動產生。
3. 在 `AGENT_STATE_PRESENTATION` 把狀態指到新的 cue，再到 store 決定在哪個狀態轉換時回傳它。
4. `tests/sound-registry.test.mts` 會要求每個 cue 至少有一個狀態用到，而且峰值在音量 100% 時不能超過 1（否則會削波）。

`src/types/sound.ts` 會被主程序和 Node 測試直接載入，所以檔內不能有執行期 import（見 agent-pets-conventions §1）。

## 改音形或策略之前

`tests/sound-registry.test.mts` 用假的 AudioContext 驅動 `playCue`，把每個狀態、音量 35／60／100 時排程出去的波形、頻率、時間點和峰值，逐格跟 main `f8965ae` 的舊實作比對，浮點數末位也要相同。改任何數值都會讓這個測試失敗，這是刻意的：使用者聽到的聲音變了，就要在 phase report 記錄並更新期望值。

## 熱路徑

每次播放的成本（t 是這個 cue 的音數，最多 3）：

| 項目 | 1.12.4 | 現在 |
|---|---|---|
| 讀 `AudioContext.currentTime` | 5t 次 | 1 次 |
| 呼叫 `getContext()` | 1 + t 次 | 1 次 |
| 新建的 Web Audio 節點 | 2t | 2t |
| 節流判斷 | `Map` 查找，O(1) | 不變 |
| 能不能播（`shouldPlayCue`） | 查表，O(1) | 不變 |

- 節點數無法再降：`OscillatorNode` 依規格只能 `start()` 一次，每個音都要新建一組振盪器加增益節點。
- 考慮過把每個 cue 事先渲染成 `AudioBuffer`，播放時只建一個來源節點。沒有採用：要非同步的 `OfflineAudioContext`，取樣率不同時還要重採樣，輸出不再保證跟現在一樣；而每個 cue 3 秒最多播一次，省下的配置量不明顯。
- `currentTime` 只讀一次，同一個 cue 的音都對齊同一個時間基準。舊版每讀一次都可能跨過一個 render quantum（約 2.9 ms），讓後面的音晚一點點。
- Node 26 加上假 AudioContext，新舊交錯各跑 7 輪、每輪 20 萬次，每次播放的中位數是 3255 ns 與 3284 ns，在雜訊範圍內。時間主要花在建節點，所以 CPU 時間沒有可量測的改善。

量測腳本沒有放進 repo。重跑方法：用 `git show f8965ae:src/utils/sound.ts` 取出舊版，把兩版裝上同一個計數用的假 `window.AudioContext`，交錯呼叫 `playCue(cue, { preview: true })`。
