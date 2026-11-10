# 音效 registry

基底：main `f8965ae`（1.12.4）。分支 `claude/sound-registry-47de5d`。版本不升，1.12.5 由整合線統一升。

## 盤點（改動前）

| 資料 | 位置（f8965ae） | 用途 |
|---|---|---|
| `SoundCue` 型別 | `src/utils/sound.ts:38` | 四個 cue 的名稱 |
| `CUE_TONES` | `src/utils/sound.ts:53-74` | 每個 cue 的頻率、起點、時長、增益、波形 |
| 起音 0.01 秒、停止尾端 0.02 秒、增益倍率 1.6 | `src/utils/sound.ts:22-35` | `beep()` 內寫死的包絡 |
| `CUE_THROTTLE_MS = 3_000` | `src/utils/sound.ts:41` | 同一個 cue 的節流 |
| `masterVolume = 0.6`、`/ 100` | `src/utils/sound.ts:14-19` | 預設音量與換算 |
| `CUE_SWITCHES` | `src/utils/sound-policy.ts:17-22` | cue → 偏好設定開關 |
| `SUCCESS_SOUND_MIN_MS = 15_000`、`shouldPlaySuccessSound` | `src/utils/pet-toast.ts:14,25-27` | 短任務不播成功音 |
| 狀態 → cue | `src/utils/agent-state-presentation.ts` 的 `cue` 欄位 | 1.12.3 已收進狀態 registry，本線不動 |
| 何時回傳 cue | `src/stores/agentStore.ts:609,1432-1445` | 進入狀態時、waiting-input 延遲 5 秒（`WAITING_INPUT_DELAY_MS` 同時決定提醒氣泡，留在 `pet-toast.ts`） |
| 只有寵物視窗出聲、權限請求補播 | `src/App.vue:298-341` | 呼叫 `shouldPlayCue` 與 `playCue` |
| 持久化預設值 | `electron/desktop-preferences.ts:137-141`；`src/stores/agentStore.ts:396-400` | 兩處各寫一次 |
| 音量範圍 0–100 | `electron/desktop-preferences.ts:147,184`；`SettingsDesktop.vue:133-135`（含步進 5） | 驗證與滑桿 |
| 設定頁三個開關、三個試聽按鈕 | `src/components/status-panel/SettingsDesktop.vue:143-149` | 手寫三列 |
| 文案 | `src/locales/permission/*.json:56-63`、`src/locales/*.json:91,98-99` | 不變 |
| 測試 | `tests/sound-policy.test.mts`、`tests/agent-state-registry.test.mts:95-112`、`tests/pet-toast.test.mts:38-45`、`tests/desktop-preferences.test.mts:36,199-203` | |

持久化 key：localStorage `agent-pet-sound`（`'1'`／`'0'`），`desktop-preferences.json` 的 `soundEnabled`、`soundVolume`、`soundOnPermission`、`soundOnError`、`soundOnSuccess`。都沒改。

## 改動

- 新增 `src/types/sound.ts`：`SOUND_CUE_REGISTRY`（`as const satisfies Record<SoundCue, SoundCueSpec>`，欄位 `tones`、`toggle`、`previewKey`），以及 `SOUND_ENVELOPE`、`SOUND_POLICY`、`SOUND_VOLUME`、`SOUND_DEFAULTS`、由 registry 推導的 `SOUND_CUES`、`SOUND_CUE_TOGGLES`、`SOUND_CUE_PREVIEWS`。全部深層凍結。檔內沒有執行期 import，因為主程序和 Node 測試都會直接載入它。
- `sound.ts` 只負責排程。每個音的時間都用同一個 `currentTime`，加總順序跟舊版一樣，所以浮點結果逐位元相同。
- `sound-policy.ts` 從 registry 讀 cue 開關；`shouldPlaySuccessSound` 從 `pet-toast.ts` 移過來，門檻讀 `SOUND_POLICY`。
- `desktop-preferences.ts` 的 `DEFAULTS` 在原位置展開 `SOUND_DEFAULTS`，key 順序不變；`isVolume` 和錯誤訊息讀 `SOUND_VOLUME`。store 初始值讀 `SOUND_DEFAULTS`。
- 設定頁的 cue 開關列和試聽按鈕改由 registry 產生，滑桿範圍讀 `SOUND_VOLUME`。DOM 結構、文字和順序不變，沒有視覺變動。

## 順手修的既有問題

- `audio.resume()` 的 rejection 沒有接住（context 已關閉時會變成未處理的 rejection）。補上 `.catch`，測試用會拒絕的假 context 鎖住。
- `setSoundVolume(NaN)` 會讓之後每次排程都丟 `TypeError`，現在會忽略非有限值。目前的呼叫端只傳驗證過的值，所以使用者看不出差別。
- `(window as any).webkitAudioContext` 改成有型別的寫法。
- `tests/pet-toast.test.mts` 檔案中間的 import 移到檔頭。
- conventions skill §1 的例外清單原本寫「是完整遞移閉包」，實際上不是：實算後，測試執行期會載入 85 個 src `.ts` 檔，其中 24 個自己又值 import 其他 src 檔。已改寫成正確的說法，並補上這次新增的三個檔案。

## 證據

- 對照測試 `tests/sound-registry.test.mts`：
  - 先用假 AudioContext（`currentTime = 12.5`）跑舊版 `f8965ae:src/utils/sound.ts`，記下音量 35／60／100 時四個 cue 的完整排程，寫進測試當期望值。
  - 新版逐狀態播放，波形、頻率、起點、峰值、峰值時間、降到 0 的時間、停止時間都完全相同，包括 `12.639999999999999` 這種末位。
  - 同時檢查節點的連接方式和起音從 0 開始。
  - 突變檢查：拿掉 `.catch`，或改變停止時間的加總順序，各會有 1 個測試失敗。
- 同一個測試還檢查：registry 窮盡（每個 cue 都有狀態用到，狀態用到的 cue 都在表裡）、深層凍結（改值會丟 `TypeError`）、峰值在 100% 時不超過 1、開關不重複、預設值與範圍和舊值相同、節流按 cue 分開計算且試聽不受限、音量 0 不出聲、短任務不播成功音。
- 隔離 Electron 實測：`node scripts/e2e-isolated-electron.mjs`，埠 27373–27375，fake safeStorage，已安裝版本的 17373–17375 沒被占用。
  - 用 CDP 讀設定頁：開關文字、勾選與停用狀態、滑桿 `0/100/5/60`、三個試聽按鈕的順序都正確。點擊開關後，`desktop-preferences.json` 的 key 與值正確，`agent-pet-sound` 是 `'1'`／`'0'`。
  - 在寵物視窗換上會錄音的假 AudioContext，再送帶 token 的 HTTP 事件：
    - error、waiting-permission、沒有開始時間的 success，各自排出跟上表相同的音形；音量 35% 時峰值 0.0672。
    - 太短的 success、tool-running、idle 不出聲。
    - waiting-input 在 5 秒後播 440／587 Hz。
  - 結束後移除了暫存目錄。

| 檢查 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | 成功（node_modules 是實體目錄，不是 symlink） |
| `pnpm exec vue-tsc --noEmit` | 0 錯誤 |
| `pnpm run lint` | main-process lint passed |
| `pnpm run check:design:strict` | 通過；`unused:1, rawControls:15, rawColors:0`，跟 1.12.3 報告的基準相同 |
| `pnpm exec vite build` | 成功 |
| `pnpm run test:unit` | 1246 tests：1245 pass / 0 fail / 1 skipped |

## 效能

詳見 `docs/dev/sound-registry.md`。每次播放讀 `currentTime` 的次數從 5t 降到 1（t ≤ 3），`getContext()` 從 1 + t 次降到 1 次。Web Audio 節點仍是 2t 個：振盪器依規格只能 start 一次，無法重用。節流和開關判斷原本就是 O(1)。CPU 時間在假 context 上量不出差別（交錯 7 輪中位數 3255 vs 3284 ns），所以不宣稱加速。事先渲染成 `AudioBuffer` 會改變輸出路徑，沒有採用。

## 安全

- 沒有新增 IPC、檔案 I/O、網路或權限。
- 設定頁送出的 patch 仍經主程序的 `parseDesktopPreferencesPatch` 驗證，key 來自凍結的常數。
- 主程序只多 import 一個沒有執行期依賴的純資料檔。

## 未驗證與殘留風險

- 真實喇叭的聽感沒有人工確認；證據是 Web Audio 排程值和舊版逐位元相同。
- 勿擾與寵物不可見時不出聲只有單元測試覆蓋，沒有在 Electron 裡實測。
- Windows、Linux 未實測。

## 建議版本

patch。沒有改到 schema、公開契約或安全邊界，跟其他線一起由整合線升到 1.12.5。
