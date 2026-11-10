# CSS 動畫時長、easing 與間距 token

比照主題色 `--ap-*` 與狀態色 `--state-*`，把重複出現的動畫時長、easing、間距收進 `src/styles/tokens.css`，並讓 `check:design` 擋下新的寫死值。基準：main `f8965ae`（1.12.4）。版本號不變，由整合線升 1.12.5。

## 盤點（改動前）

範圍：`src/**/*.css`、`.vue` 的 `<style>` 與靜態 `style=""`（`.vue` 沒有任何靜態 inline style）。

- 動畫時長：48 處、27 種。`tokens.css` 佔 8 處；元件 40 處，其中 `transition` 只剩 1 處（權限倒數條 `1s`），其餘都是 keyframe 動畫。重複且語意相同的只有兩組：載入轉圈 0.8s（`Button`、`Spinner`；`StatusPanelUsage` 另有一份手刻的 0.9s 轉圈）與寵物視窗提醒脈動 1.8s（迷你徽章、三種額度警示）。1.4s 出現 6 次但是 6 種不同動畫。
- easing：48 處、7 種。關鍵字 `ease-in-out` 21、`ease` 9、`ease-out` 8、`linear` 6；`cubic-bezier(0.2, 1.4, 0.4, 1)` 2 處（驚訝反應、成就徽章），`steps(6, end)` 1 處。
- 間距（margin／padding／gap 的 px，不含 `var()`）：168 處、23 種。2px 55、6px 18、1px 16、3px 15、10px 9、7px 8、4px 6、8px 6、15px 6，其餘為個位數。
- `check:design`：`unused: 1` 是 `--font-xl`，屬於插件 token 表（`docs/plugins/ux-guidelines.md` 承諾 `--font-xs`…`--font-2xl`），掃描器看不到插件頁面的使用，是既有誤報（1.12.2 phase report 已記為既有狀態）。`rawControls: 15` 中 `HistorySessions.vue:65` 是 script 註解裡的 `<input type="date">`，掃描器沒有排除 script，其餘 14 處是真的原生控制項，都是之前就存在。

## Token

| 新增 | 值 | 取代 |
|---|---|---|
| `--space-0-5` / `--space-1-5` / `--space-2-5` | 2 / 6 / 10px | 元件裡等於這些值的 px |
| `--duration-spin` | 0.8s | `Button`、`Spinner` 的轉圈 |
| `--duration-attention` | 1.8s | `DesktopPet.css` 的 4 個提醒脈動 |
| `--ease-overshoot` | `cubic-bezier(0.2, 1.4, 0.4, 1)` | 驚訝反應、成就徽章 |

- 79 行間距宣告改用 `--space-*`（含既有的 4/8/12/16/24px），px 完全不變。剩下 74 處不在刻度上（1px、3px、5px、7px、9px、13px、15px、18px、22px、26px、負 margin），屬於光學微調或各元件專屬尺寸，不收。
- 未收的時長：sprite 反應、額度光澤、成就閃光等 31 處只出現一次的裝飾動畫。關鍵字 easing 本身就是名字，不另做 token。
- 減少動態：`--duration-*` 與既有的 `--transition-*` 一起在 `prefers-reduced-motion` 歸零，萬用規則照舊停掉其他動畫。`useReducedMotion.ts` 不需要改。
- 權限倒數條的 `transition: width 1s` 改由 `PERMISSION_CLOCK_INTERVAL_MS` 以 inline `transitionDuration` 提供，和 1 Hz 時鐘同一個常數。
- 插件契約：沒有改 `--ap-*` 或 panelThemes。新 token 會出現在插件頁面讀到的共用 `tokens.css`，但沒有加進插件 token 表，文件寫明插件不應依賴。

### 不一致的地方

- `StatusPanelUsage` 的重新整理轉圈是另一份手刻實作（0.9s、頂邊 `--accent-bright`、減少動態時變成整圈灰）。改用共用 `Spinner`（0.8s、頂邊 `--accent`、減少動態時保留靜止的缺口，讓「載入中」仍看得出來），外距維持 8px。
- 主題編輯器色彩列的「用途」圖示按鈕是 32px 手刻，同一列的「微調」按鈕是 38px `Button`。改成同一個 `Button`（ghost、icon-only），兩顆一致；截圖差異只在這一欄。

## unused 與 rawControls

- `unused` 0：掃描器把插件 token 表內的 token 視為有用（`PLUGIN_SHARED_TOKENS`，測試比對文件與 `tokens.css`）。`--accent-wash` 原本只有成就篩選在用，篩選改用 `SegmentedControl` 後沒人用、也不在插件表，已刪除。
- `rawControls` 0，`rawControlsAccepted` 12：
  - 換成共用元件：成就篩選 3 個按鈕 → `SegmentedControl`（radio、sm，與工作階段篩選一致，鍵盤方向鍵可切換）；色彩用途按鈕 → `Button`。
  - 掃描器誤報修正：template 先去掉 script、style 與 HTML 註解。
  - 保留並在控制項上一行寫 `<!-- raw-control: 理由 -->`：插件訊息整則連結、面板寵物頭像、歷史清單列、工作階段列、設定搜尋結果列（整列可點、含多欄內容）；兩個 `type=color`（系統色盤只能由原生 input 開）；色碼文字欄（同列精簡欄位，`Input.vue` 是直式表單欄位）；權限泡泡的展開／複製（文字連結，有框按鈕會和允許／拒絕搶層級）；音量滑桿（`ui/` 沒有 slider，只此一處）；寵物選擇卡（含預覽的 radio 卡片）。

## 掃描器

- 新規則（會讓 `--strict` 失敗，現況都是 0）：`literal-spacing`、`literal-transition`、`literal-easing`。
- 新的報告欄位（不失敗）：`rawSpacing` 74、`rawMotion` 31、`rawControlsAccepted` 12。之後同一個值在多處以同一語意出現時再收成 token；`docs/dev/design-tokens.md` 寫了處理方式。
- 效能：原本 `.ts`／`.vue` 會再 walk 一次並重新讀檔，template 對每條規則各切一次。現在 walk 一次、每檔讀一次，CSS 宣告只切一次，所有規則共用；正規表示式在模組層預先編譯。量測（同機器、新舊交錯 3 輪、每輪 15 次取中位數）：舊版 103–109 ms，新版 92–111 ms，規則變多但時間持平。

## 其他

- §9：改到的 `HistoryChart.vue`（179 行）、`PluginCatalog.vue`（172 行）、`PluginInstallSheet.vue`（260 行）的 scoped style 抽成同名 `.css`。`tests/plugin-panel-a11y.test.mts` 改為連同 `<style src>` 一起讀，原本的 forced-colors、色碼與字級檢查仍涵蓋抽出的樣式。
- §1：`PluginPanelFrame.vue` 的 `src="./PluginPanelFrame.css"` 改成 `@/`。`PluginPanel.vue` 的同類寫法不在這次改動範圍，未改。
- 未動：hook 相關檔案、`src/utils/sound*.ts`、Agent 來源型別檔。

## 驗證

- `pnpm install --frozen-lockfile --offline` 通過（node_modules 為實體目錄）。
- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design:strict` 通過；strict 報告 `{"byRule":{},"unused":0,"rawControls":0,"rawControlsAccepted":12,"rawSpacing":74,"rawMotion":31,"rawColors":0}`。
- `pnpm exec vite build` 通過。
- `pnpm run test:unit`：1245 個，1244 通過、1 略過、0 失敗。新增 `tests/design-motion-tokens.test.mts`（3 個），`tests/check-design-tokens.test.mts` 新增 4 個。
- 截圖（`scripts/e2e-isolated-electron.mjs`，27373–27375，假 safeStorage，未觸發鑰匙圈）：寵物視窗、面板工作階段／額度／歷史、設定通用／寵物／成就／桌面／進階、主題編輯器，淺色與深色各一張，動畫與 transition 凍結後逐像素比對。
  - 同一份舊程式跑兩次就會在寵物 sprite、面板頭像、相對時間（「2s」）與狀態點脈動相位出現差異，所以用第二次舊版截圖當基準。
  - 對穩定基準：寵物視窗（淺／深）、面板工作階段（淺／深）、額度與歷史（深色）、設定通用／寵物／桌面／進階（淺／深）都是 0 差異。剩下的差異只有額度與歷史淺色的面板頭像 sprite（約 1000 px，框在頭像內）、成就篩選（預期的元件替換，篩選列高 8px，下方清單跟著下移）與主題編輯器的用途按鈕欄。改動後連拍兩次 0 差異。
- 減少動態（CDP 模擬 `prefers-reduced-motion`，寵物與面板視窗）：一般狀態 `--duration-spin` 0.8s、`--transition-fast` 0.15s ease、`--ease-overshoot` 套用正確；減少動態時三者時長為 0s，探針元素的動畫時長 1e-6 s、只跑 1 次，transition 1e-6 s；半格間距 token 兩個視窗都是 2/6/10px。

## 未驗證

- Windows 實機、125%／150% 縮放、高對比與減少透明度未截圖。
- 權限泡泡與插件面板沒有開啟截圖（間距 token 化的 px 不變，未目視確認）。
