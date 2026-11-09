# 1.12 給插件作者的新功能

Agent Pets 1.12.0 新增一份主題契約，插件可以提供主題，也可以讀取目前的主題。apiVersion 1 沒有移除任何東西，既有插件照常運作。標示 **請確認** 的項目可能改變插件的外觀。

## 提供面板主題（`contributes.panelThemes`）

- 新的純資料貢獻：1–8 個主題，各有淺色及／或深色配色、選用的套件內 `.woff2` 字型、字級倍率、圓角，以及純色、漸層或套件圖片背景。只提供主題的插件不需要 Worker、`entry` 或任何權限。完整說明見[面板主題](panel-themes.zh-TW.md)。
- 主題會套用到兩個視窗的每個介面，包含權限與風險提示與寵物視窗。沒有保護區域，改由主機拒絕違反不變量的主題：每個文字色在它可能出現的每個表面上 ≥ 4.5:1（寵物泡泡與狀態列以疊在全黑與全白桌面上計算）、焦點環 ≥ 3:1、狀態色維持色相（危險紅、成功綠、警告琥珀、資訊藍），彼此之間及與強調色保持距離。拒絕訊息會指出鍵、配對、量到的比值與最低要求。
- 顏色鍵：10 個必填（`bg`、`surface`、`surface2`、`text`、`textSecondary`、`textMuted`、`accent`、`accentText`、`onAccent`、`border`），21 個選填（`surfaceWarm`、`surfaceSage`、`surfaceSageSoft`、`surfaceOff`、`textFaint`、`accentHover`、`accentGlow`、`accentTrack`、`accentOnHover`、`sage`、`sageDeep`、`sageDark`、`sageTrack`、`borderSoft`、`dangerText`、`successText`、`warnText`、`scrim`、`infoText`、`shadow`、`highlight`）。`borderOnAccent` 已停用：仍接受並檢查，讓既有 manifest 維持有效，但會被忽略。
- `modes.<mode>.petStatus` 可另外覆寫寵物的狀態列。

## 打包、授權與目錄

- 字型必須是 `.woff2`（以 `wOF2` 檔頭檢查），每個 ≤ 1 MiB，每個主題最多 4 個字面、每個插件最多 8 個字型檔，且套件內每個 `.woff2` 都必須被主題引用；未引用的字型檔會讓套件被拒絕。不接受遠端字型與 TTF／OTF。背景圖為 PNG 或 WebP（≤ 8 MiB、每邊 64–4096 px、靜態、EXIF 方向為 1）。含主題的套件最大 25 MiB、64 個檔案。見[打包與版本](packaging-and-versioning.zh-TW.md)與[限制](limits.zh-TW.md)。
- 安裝確認會顯示「提供 N 個面板主題」（低風險），附字型時另有「附帶面板用的自訂字型」（中風險）。更新時新增主題或字型會再次詢問。
- 含 `panelThemes` 的目錄版本必須設定 `"minAppVersion": "1.12.0"`。1.12.0 以前的 App 會隱藏宣告了 `minAppVersion` 的版本；1.12.0 以上會略過需要更新版 App 的版本，並在探索頁顯示「需要 Agent Pets X 或更新版本」。見[發佈](publishing.zh-TW.md)。

## 讀取目前的主題（`--ap-*`、`api.theme`），不需要權限

- 面板頁在第一個腳本執行前，根元素上就有 26 個 `--ap-*` 自訂屬性（由同步取得的快照經 CSSOM 寫入，`<html>` 上也有 inline 的一份），使用者的主題或淺色／深色模式變更時即時更新：`--ap-bg`、`--ap-surface`、`--ap-surface-2`、`--ap-text`、`--ap-text-secondary`、`--ap-text-muted`、`--ap-accent`、`--ap-accent-hover`、`--ap-accent-text`、`--ap-on-accent`、`--ap-border`、`--ap-border-soft`、`--ap-focus`、`--ap-danger`、`--ap-success`、`--ap-warn`、`--ap-info`、`--ap-scrim`、`--ap-shadow`、`--ap-highlight`、`--ap-radius-sm`、`--ap-radius-md`、`--ap-radius-lg`、`--ap-font-body`、`--ap-font-heading`、`--ap-font-scale`。
- `api.theme.get()` 與 `api.theme.onDidChange(callback)` 在 Worker 與面板頁都能用，不需要權限。變更以 100 ms 合併為一個事件，且不會重複送出與上一份相同的快照。
- `--ap-focus` 等於 `--ap-accent-text`，也就是 App 自己的焦點環（在每個表面上 ≥ 3:1；強調填色在淺色表面上可能只有約 2.9:1）。
- `--ap-info` 是主題的 `infoText`；主題沒有設定或沒有套用主題時是內建藍色（淺色 `rgb(46 91 140 / 1)`、深色 `rgb(156 195 240 / 1)`），在 `surface`、`surface-2`、`bg` 上 ≥ 4.5:1。
- 放在強調色填色上的文字請用 `--ap-accent-hover` 當底，不要用 `--ap-accent`：`--ap-on-accent` 在 `--ap-accent-hover` 上保證 4.5:1，在 `--ap-accent` 上只保證 3:1。
- Windows 高對比（`forced-colors`）或沒有套用主題時，token 是內建色盤。

## 使用者可以自己做主題（請確認）

- 使用者有主機繪製的主題編輯器與**我的主題**（最多 50 個），也會顯示在你的插件分頁的主題清單之後。他們可以從任何已安裝的插件主題開始；複本會帶上顏色、漸層、圓角、寵物狀態列顏色與 `userImage` 設定，不會帶上你的字型或套件內的圖片。見[我的主題與主題編輯器](panel-themes.zh-TW.md#我的主題與主題編輯器)。
- 我的主題使用與插件主題相同的驗證器與淺色／深色插槽；套用它會取代你的主題。`--ap-*` 與 `api.theme` 回報方式與其他主題相同，也不會透露目前是誰的主題。

## 預設值的改變（請確認）

- **`_shared/tokens.css` 的舊顏色名稱跟著 `--ap-*`。** `--surface-panel`、`--surface-raised`、`--text-primary`、`--text-muted`、`--accent`、`--border-subtle`、`--state-*` 以及 [UX 指南](ux-guidelines.zh-TW.md)列出的其他顏色名稱，現在都是使用者看到的主題（淺色或深色、插件主題或內建）的別名。以前它們是固定的深色玻璃色盤（`--surface-panel` 是深色半透明、`--text-primary` 接近白色）。依賴那組深色色盤或寫死 `color-scheme: dark` 的頁面，要一致使用這些名稱，淺色表面上的深色文字才會正確；請依 `api.theme` 設定 `color-scheme`（見[範例](examples.zh-TW.md)）。正式的顏色契約仍是 `--ap-*`。
- **思考與執行工具改用強調文字色。** `thinking` 與 `tool-running` 的狀態點、迷你環與工作階段列（包含插件以 `agent.emit` 送出的狀態）改用主題的 `accentText`，不再是固定的藍紫色 `#8b9cf7`；成功、錯誤與等待使用狀態色，閒置用 `textMuted`，離線用 `textFaint`。每個狀態仍然搭配文字標籤。
- **寵物視窗跟著主題**，依寵物外觀的模式套用；插件泡泡的「來自插件」邊框維持 `sage` 色系。
