# 階段報告：寵物狀態列回到單行、狀態詞改用英文、溢出選單圖示

> 分支 `fix/pet-line-kebab`，基於 `main` @ d97b3a5（1.11.4）。版號尚未變更。

## 問題

1. **狀態列變厚**：1.11.4 在同一家族有多個工作階段時，於狀態列加了第二行專案名稱（例如 `Claude · 工作中 71%` 下方再一行 `agent-pets`），狀態列從約 24 px 變成約 37 px，比原本的細條粗重許多。
2. **狀態詞**：使用者希望狀態列上的狀態詞不論介面語言都以英文顯示。
3. **溢出選單圖示**：`more` 圖示是三個零長度線段，在 18 px 下是三個又小又細的點，不像 Material 的 `more_vert`。

## 變更

| 區塊 | 檔案 | 內容 |
|---|---|---|
| 狀態列 | `DesktopPet.vue/.css`、`src/utils/session-attention.ts` | 移除第二行專案列（單寵物與多寵物）。狀態列回到 1.11.3 的單行結構與尺寸（`line-height: 1.3`、`padding: 3px 9px`）：狀態點、名稱 · 狀態、Quota 百分比與分段條。保留 1.11.4 的其他改善：沒有 `(+N)`、名稱先縮、`role="group"` 與完整的 aria-label、完成標記設定。`statusLineText()` 只回傳完整文字（名稱、CLI/Desktop、專案、在地化狀態），專案只出現在提示框與 aria-label；移除不再使用的 `truncateProject()`。 |
| 狀態不被截斷 | `DesktopPet.css` | 狀態改為 `flex: none`。原本的 `flex-shrink: 1` 即使只縮 0.01 px，`text-overflow` 也會把字尾換成省略號（多寵物 180 px 欄位出現 `Permissi…`）。沒有插件徽章時，徽章容器不再佔一個 gap。 |
| 提示框 | `DesktopPet.css` | 額度提示框第一行（完整名稱、專案與狀態）允許換行，最多三行；長專案名不再被截成 `agent-pets-…`。 |
| 視窗高度 | `src/utils/pet-window-height.ts`、`src/stores/agentStore.ts` | 移除專案列的高度預算（`STATUS_LINE_PROJECT_H`、`showsProjectRow()`）；`petWindowHeight()` 只依行數計算，與 1.11.3 相同。 |
| 英文狀態詞 | `src/utils/state-aria.ts`、`src/locales/pet/*.json` | `stateLineLabel()` 改用固定的英文短字對照（Idle、Thinking、Working、Permission、Needs input、Done、Failed、Offline），不經過 `t()`；移除兩個語系檔中不再使用的 `pet.lineState*`。提示框與 aria-label 仍使用介面語言的完整說法。面板使用的 `STATE_LABELS_SHORT` 不變。 |
| 溢出圖示 | `src/components/ui/icons.ts`、`src/components/ui/Icon.vue` | `more` 改為三個實心圓點（16 格座標中心 y = 4／8／12、半徑 1.333，與 `more_vert` 在 24 格的比例相同），以圓弧自行繪製。新增 `FILLED_ICONS`，`Icon` 對其中的圖示改用 `fill="currentColor"`、`stroke="none"`；其他圖示維持線條樣式。 |
| 文件 | `README.md`、`README.zh-TW.md` | 狀態列說明改為單行、英文狀態詞與範例 `Claude · Working 71%`。 |

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm run lint` | 通過 |
| `pnpm run test:unit` | 1028／1028 通過 |
| `pnpm exec vite build` | 通過 |
| `pnpm run check:bundle-size`／`check:bundle` | 通過 |
| `pnpm run check:contrast` | 通過 |
| `pnpm run check:design:strict` | 通過，與 main 相同（沒有新增 finding） |
| `git diff --check` | 通過 |

更新的測試：`pet-window-height`（只依行數）、`session-attention`（完整文字含專案、模板沒有第二行、英文狀態詞與語系檔中不再有 `pet.lineState*`）、`icons`（`more` 為三個中心 4／8／12 的實心圓點，只有它是填色圖示，`Icon` 的填色分支）。

**隔離 Electron 實測**（`scripts/e2e-isolated-electron.mjs`：暫存 HOME／userData、假 safeStorage、`security`／`claude`／`codex` 指向 `/usr/bin/false`；1.11.3 與 1.11.4 以 `--app-root` 執行各自的建置）。寵物狀態與 Quota 直接注入寵物視窗的 store，zh-TW 介面：

| 情境 | 1.11.3 | 1.11.4 | 本分支 |
|---|---|---|---|
| 單寵物、Claude 3 個工作階段、長專案名、有 Quota：狀態列高度 | 23.59 px | 36.79 px | 23.59 px |
| 同上：寵物視窗高度 | 422 px | 436 px | 422 px |
| 單寵物三個家族堆疊：視窗高度 | 466 px | 494 px | 466 px |
| 多寵物（Codex＋Claude）：每條狀態列高度 | — | 36.79 px | 23.59 px |

- 狀態列只顯示 `Claude · Working 71%` 與分段條；滑過時的提示框顯示 `Claude (CLI+Desktop) · <完整專案名> · 工作中` 與額度明細，aria-label 為同樣的中文完整文字。
- 多寵物 180 px 欄位：`Codex · Permission 40%` 與 `Claude · Working 71%` 都完整，沒有省略號。三個家族堆疊時，`OpenCode · Needs input` 也完整。
- 視窗高度預算等於實際視窗高度，最後一條狀態列底部正好落在視窗內（與 1.11.3 相同）。
- 溢出圖示：面板標題列 18 px 圖示置中於 38 px 按鈕；勿擾的 8 px 圓點位於右上角，與最上方的圓點不重疊。插件卡片的選單按鈕同樣置中。淺色與深色主題都已截圖確認。

## 未驗證項目與殘留風險

- 狀態列畫面上的狀態詞是英文，可存取名稱是中文；語音控制使用者說出畫面上的「Working」可能對不上（WCAG 2.5.3 Label in Name）。這是使用者明確要求的取捨。
- 第一輪隔離測試仍綁定 17373–17375，會收到真實 hook 事件；截圖前重新注入狀態，只裁切寵物、面板標題與插件卡片。審查修正後的測試改用獨立埠（見下節）。
- `PluginDetail` 的選單按鈕沿用同一個 `Icon` 與 `ActionMenu`，未單獨截圖。
- Windows 分層視窗、高對比、減少透明度與 125%／150% 縮放未在本階段實測。

## 審查修正

獨立審查後在同一分支修正：

| 項目 | 檔案 | 內容 |
|---|---|---|
| 窄狀態列的狀態詞被截掉 | `src/utils/status-line-fit.ts`（新）、`DesktopPet.vue/.css` | 狀態改為 `.status-line` 的直接子項（`flex: 1 0 auto`，不縮）。新的純函式 `fitStatusLine()` 以 canvas 量到的字寬做寬度預算，放不下時依序拿掉 `+N`、徽章（由後往前）、讓名稱縮短、拿掉名稱，最後拿掉 Quota 百分比（分段條保留）。多寵物狀態列寬度下限 112 px（仍在 0.6 倍、約 115 px 的寵物欄內）。名稱與狀態之間的間距維持兩側各 3 px。 |
| 插件徽章撐高狀態列 | `DesktopPet.css` | 既有問題：徽章上下 1 px padding 讓狀態列從 23.59 px 變成 25.2 px。改為 `padding: 0 5px`，有徽章時高度不變。 |
| 整體狀態列沒有名稱 | `DesktopPet.vue` | 沒有家族時（Idle／Offline）的 `title` 與 aria-label 改為同一個英文字（使用者決定，不加中文）。 |
| 每次 render 重算 | `DesktopPet.vue` | 既有問題：模板對每條狀態列多次呼叫 `pluginBadgeSummary()`（每次過濾並複製徽章）與組字函式。改為一個 computed 依線預先算好文字、aria-label、寬度取捨與徽章，同一隻寵物的徽章只彙整一次；字寬以字串快取，只在字型載入完成時清除。 |
| 未使用的 `count` | `agentStore.ts`、`DesktopPet.vue` | 移除。 |
| 測試 | `tests/status-line-fit.test.mts`（新）、`session-attention`、`pet-window-height` | 移除只比對原始碼文字的測試與用正則解析字表的測試；英文狀態詞移到 `src/utils/state-line-words.ts`，改為行為測試。寬度預算測試涵蓋 0.6／0.8／1.0 倍、單／多寵物、Quota＋兩個徽章＋`+N`，並檢查尺寸常數與 CSS 一致。 |
| 隔離測試佔用 hook 埠 | `scripts/e2e-isolated-electron.mjs`、`electron/main/runtime.ts`、`electron/event-server.ts` | 隔離執行器預設以 `AGENT_PETS_*_PORT` 把三個埠移到 27373–27375（`--hook-port-base` 可改，`--real-hook-ports` 才用預設埠）。執行器一律以 node_modules 的 Electron 啟動（`app.isPackaged` 為 false），所以 `--app-root` 也會讀這組環境變數；只有在這組變數出現之前建置的 `--app-root` 會綁定預設埠，需從啟動日誌的「listening on」確認。既有問題：整合測試事件固定送往 17373、事件伺服器的日誌固定印 17373，改為使用實際設定的埠。 |

**實測**（隔離執行器，埠 27373–27375，已確認未佔用 17373–17375）：單寵物與多寵物 × 0.6／0.8／1.0 倍 × 五種狀態（Needs input、Permission、Thinking、Working、Idle），Codex／Claude 有 Quota、四個插件徽章（兩個顯示加 `+2`）：30 組全部「狀態完整、沒有項目超出狀態列、高度 23.59 px」。例：多寵物 0.6 倍為 `▲ Permission`、`● Needs input`；0.8 倍為 `Permission 40%`；1.0 倍為 `Codex · Permission 40%`。單寵物 `Codex · Idle 40%` 加兩個徽章。整體狀態列在 zh-TW 下顯示 `Offline`，`title` 與 aria-label 都是 `Offline`。

殘留風險：字寬是在 macOS 量測；Windows（Segoe UI）以同一套 canvas 量測運作，但未實機截圖。

## 第二次審查修正

| 項目 | 檔案 | 內容 |
|---|---|---|
| 單寵物寬度預算固定 250 px | `src/utils/status-line-fit.ts`、`DesktopPet.vue` | 改用 `store.scaledW`（即 `--pet-w`）：預設至大尺寸的內容寬 226 px，特大 266 px，超大 341 px；特大與超大不再無故拿掉徽章或名稱。 |
| 徽章寬度模型與 CSS 不符 | `DesktopPet.css`、`status-line-fit.ts` | `.plugin-badge-anchor` 由固定 `flex: 0 1 42px` 改為 `flex: 0 1 auto; max-width: 42px`，徽章寬度隨文字、最寬 42 px，與預算模型相同；放不下的徽章依序被拿掉，不再被擠成省略號。 |
| 測試未綁定常數 | `tests/status-line-fit.test.mts` | CSS 檢查改由 `STATUS_LINE_GEOMETRY`、`MULTI_PET_LINE_MIN_W`、`STATUS_TEXT_FONTS` 組出，並檢查字型 token 的值；匯出 `statusLineWidth()`，以手算數字驗證；新增特大、超大尺寸。 |
| 被拿掉的徽章從無障礙樹消失 | `DesktopPet.vue` | 被拿掉的徽章（插件名稱與文字）與「還有 N 個插件徽章」接在 aria-label 後；沒有額度提示框時也接在 `title` 後。 |
| 字寬快取無上限 | `DesktopPet.vue` | 超過 256 筆整批清除；字型載入完成與寵物主題切換時同時重設字型設定。 |
| 執行器說明與中文註解 | `scripts/e2e-isolated-electron.mjs`、`electron/main/runtime.ts` | 更正埠的說明（執行器一律以 node_modules 的 Electron 啟動，`--app-root` 也讀環境變數）；新註解改為繁體中文。 |
| 縮排與 README | `DesktopPet.vue`、`README*.md` | 修正三處 `PetAnimation` 屬性縮排；README 補上「名稱先縮短」的順序、完成標記說明與隔離執行器的埠。 |
| 淺色寵物上的插件徽章對比（既有） | `DesktopPet.css`、`scripts/check-contrast.mjs` | info 徽章原用 `--state-info`，在淺色寵物底上只有 1.44:1；警告徽章也偏低。改用寵物外觀各自的 `--pet-bubble-info-accent`／`--pet-bubble-warn-accent`（淺色 6.89:1／6.68:1，深色 8.72:1／13.10:1），並加入對比檢查。 |

文件：`README.md`、`README.zh-TW.md`、`docs/dev/e2e-without-keychain.md`（執行器的預設埠與參數）、`docs/plugins/api-reference*.md` 與 `docs/plugins/contribution-points*.md`（窄狀態列的徽章取捨）、`.agents/skills/pet-skill/references/ui-design-system.md`（圖示放在 `icons.ts`、填色圖示用 `FILLED_ICONS`）。

**實測**（隔離執行器，埠 37373–37375；17373–17375 由已安裝的 Agent Pets 使用）：單寵物與多寵物 × 0.6／0.8／1.0／1.2／1.5 倍 × 五種狀態，有額度與四個徽章：50 組全部狀態完整、沒有超出、高度 23.59 px。超大尺寸單寵物顯示 `Claude · Working`、兩個徽章、`+2` 與 `71%`。預設尺寸 Permission 時拿掉 `+N` 與第二個徽章，aria-label 結尾為「deploy：Deploy」「還有 2 個插件徽章」。

## Token 檢查補正

`check:design:strict` 的未使用 token 數從 22 變成 23：`--organic-quota-warning` 只剩 `DesktopPet.vue` 的 `quotaColor()` 以字串回傳，檢查工具看不到（`--organic-quota-error`、`--organic-quota-sage` 原本就是同樣情形）。改為 `quotaTier()` 只回傳等級，狀態列帶 `data-quota-tier`，由 `DesktopPet.css` 依等級把 `--quota-color` 指向對應 token；沒有 Quota 時為 `transparent`。未使用數降為 20，其餘 20 個是 `ui-design-system.md` 指定保留的語意別名與相容別名（`tokens.css` 也提供給插件面板，不刪除）。隔離執行器實測：Codex 40% → `warning`／`#e3b64f`，10% → `low`／`#d64a3a`；Claude → `claude`／`#d98652`；沒有 Quota 的 OpenCode 為 `transparent`，與改動前的顏色相同。

## 建議版號

修補版（patch，1.11.5）：版面與圖示修正，加上狀態詞顯示方式的調整；沒有變更偏好欄位、IPC 或資料格式。
