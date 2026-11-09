# 面板主題

`contributes.panelThemes` 讓插件改變 Agent Pets 設定／狀態面板與寵物狀態列的外觀：顏色、字型、字級比例、圓角與背景（純色、漸層或套件內圖片）。主題只有資料。只提供主題的插件沒有 Worker、不需要權限，也沒有 Host API。需要 Agent Pets 1.12.0 以上。

正式規格見 [docs/design/Plugin-Panel-Theme-Spec.md](../design/Plugin-Panel-Theme-Spec.md)，本頁是給作者的摘要。

## 使用者在哪裡選主題

你的插件在儀表板（「工作階段」「額度」「歷史」之後）的分頁以主題清單為主體；同一份清單也在設定 → 插件 → *你的插件* → **面板主題**（插件同時有 `panelView` 時，分頁由面板頁佔滿，只能在這裡選）。每個主題都有淺色與深色預覽（含寵物狀態列），以及「用於淺色模式」、「用於深色模式」、「兩種模式都使用」。整個 App 每種模式只有一個主題，套用新的會取代目前的。設定 → 通用 → 外觀顯示各模式目前使用的主題、「自訂…」、「開啟插件設定」（前往你的分頁；沒有分頁時前往詳情頁的該區塊）與「恢復內建外觀」。使用者也可以在那裡做自己的主題（見[我的主題與主題編輯器](#我的主題與主題編輯器)）。

## 可宣告的欄位

```json
{
  "id": "sakura",
  "displayName": { "zh-TW": "櫻花", "en-US": "Sakura" },
  "fonts": [{ "id": "nunito", "src": "fonts/nunito-400.woff2", "weight": 400 }],
  "typography": { "body": ["@nunito", "PingFang TC", "system-ui", "sans-serif"], "scale": 1.0 },
  "shape": { "radiusSm": 8, "radiusMd": 14, "radiusLg": 24 },
  "modes": {
    "light": {
      "colors": { "bg": "#fbf1f3", "surface": "#fffafb", "surface2": "#f6e6ea", "text": "#2a1d22", "textSecondary": "#5c4750", "textMuted": "#6a5560", "accent": "#b4446a", "accentText": "#8f2f52", "onAccent": "#ffffff", "border": "rgb(42 29 34 / 0.16)" },
      "background": { "type": "image", "src": "backgrounds/sakura-light.webp", "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "userImage": { "allowed": true, "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "petStatus": { "background": "rgb(255 250 251 / 0.92)", "text": "#2a1d22" }
    },
    "dark": { "colors": { "…": "…" } }
  }
}
```

| 欄位 | 規則 |
| --- | --- |
| `id` | `^[a-z0-9-]{1,32}$`，不可重複；每個插件 1–8 個主題 |
| `displayName`／`description` | `{ "zh-TW", "en-US" }`，各 1–48／1–120 字 |
| `fonts[]` | 最多 4 個字面，只接受 `.woff2`（≤ 1 MiB、`wOF2` 開頭），`weight` 400／600／700，`style` normal／italic；每個插件最多 8 個字型檔；套件內每個 `.woff2` 都必須被引用 |
| `typography.body`／`.heading` | 1–5 項：`@字面id`、本機字型名稱（`[A-Za-z0-9 -]`，不可有引號）或通用字族；最後一項必須是通用字族 |
| `typography.scale` | 0.92–1.15，最多兩位小數；字級不會小於 11 px |
| `shape` | `radiusSm` 0–16、`radiusMd` 0–24、`radiusLg` 0–32（整數），且 `Sm ≤ Md ≤ Lg` |
| `modes.light`／`modes.dark` | 至少一個；只有單一模式的主題只會出現在該模式 |
| `colors` | 10 個必填（`bg`、`surface`、`surface2`、`text`、`textSecondary`、`textMuted`、`accent`、`accentText`、`onAccent`、`border`）與選填鍵（規格 §3.2）：`surfaceWarm`、`surfaceSage`、`surfaceSageSoft`、`surfaceOff`、`textFaint`、`accentHover`、`accentGlow`、`accentTrack`、`accentOnHover`、`sage`、`sageDeep`、`sageDark`、`sageTrack`、`borderSoft`、`dangerText`、`successText`、`warnText`、`scrim`、`infoText`、`shadow`、`highlight`。`borderOnAccent` 已停用：仍接受並檢查，但會被忽略 |
| `background` | `solid`（預設）、`gradient`（`linear` 搭配 `angle` 0–359，或 `radial` 搭配 `position`；2–5 個不透明且位置不遞減的色標）或 `image`（套件內 `.png`／`.webp`、`fit`、`position`、`opacity` 0.2–1、`blur` 0–24，以及必填且不透明的 `overlay`，`opacity` 0.5–0.95） |
| `userImage` | `{ "allowed": true, "overlay": {…}, "fit"? }`：允許使用者為該模式匯入自己的背景圖 |
| `petStatus` | 寵物狀態列顏色：`background`（alpha 0.85–1）與 `text` 必填；`border`、`textMuted`、`quotaFill`、`quotaTrack`、`quotaWarn` 選填 |

顏色只接受 `#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`、`rgb()/rgba()`、`hsl()/hsla()` 或 sRGB 範圍內的 `oklch()`；不接受色名、`var()`、`calc()`、`url()` 等其他寫法。主程式會把每個顏色重新輸出為 `rgb(R G B / A)`，插件的字串不會直接進入 CSS。

## 驗證（只拒絕，不自動調整）

每個模式分開檢查，任一項失敗就拒絕整個套件；開發者模式會顯示提示，例如 `sakura.light.colors.textMuted: 3.92:1 < 4.5:1 on surface2`。

- 淺色模式的 `bg` 必須夠亮（亮度 ≥ 0.45）且文字較暗；深色模式的 `bg` 必須夠暗（≤ 0.12）且文字較亮。
- 主要、次要、淡化與強調文字在 `bg`、每個漸層色標與中間點、以及圖片背景（以最黑與最白像素計算）上都要 ≥ 4.5:1，`accent` ≥ 3:1。
- 每個文字 token 在它可能出現的每個表面上都 ≥ 4.5:1：各級文字、`accentText`、危險／成功／警告／資訊文字，在 `surface`、`surface2`、`bg`，以及疊在最黑與最白桌面上的寵物泡泡（`surface` 0.93）、狀態列（`surface` 0.92）與寵物視窗的選單和對話框（`surface` 0.98）上；`sageDeep` 與 `sageDark` 在 `surface`、`surface2`、`bg` 上；`text` 與 `accentText` 在 `surfaceWarm` 上；`text`、`sageDeep`、`sageDark` 在 `surfaceSage` 上，`text` 與 `sageDark` 在 `surfaceSageSoft` 上。
- 文字後方的半透明底以合成後的顏色檢查：懸停底 `accentOnHover` 疊在 `surface`（所有文字 token）、`surface2`（`text`、`textSecondary`）、`surfaceWarm`（`text`、`accentText`）與 `surfaceSage`（`text`、`sageDark`）上；狀態晶片（危險／成功／警告文字放在 12% 的同色底上）疊在 `surface`、`surface2`、`bg` 上；危險按鈕的懸停底（`dangerText` 放在 12% 的同色底上）另外也疊在寵物視窗的對話框上檢查。
- 焦點環使用 `accentText`：在上述每個表面（狀態晶片除外）上 ≥ 3:1。`textFaint`（只用於裝飾）在 `surface` 與 `bg` 上 ≥ 3:1。`accent` 在 `surface` 上 ≥ 3:1。`onAccent` 在 `accentHover` 與懸停中的按鈕（`accentHover` 往 `text` 混合 12%）上 ≥ 4.5:1、在 `accent` 上 ≥ 3:1。`bg` 在危險／成功／警告填色上 ≥ 4.5:1（徽章文字）。
- 寵物狀態列上的配額條（`sageDeep`、`accentText`、`warnText`、`dangerText`）在狀態列與配額軌道上 ≥ 3:1。
- 圖片遮罩不得低於計算出的最小值（且永遠不低於 0.50），提示會列出失敗的配對與最小值。在圖片上沿用內建淺色文字一定無法通過（`textMuted` 在內建 `bg` 上只有 4.96:1），請改用更深的文字色。
- 狀態色必須保持語意：`dangerText` 維持紅色（OKLCH 色相 0–50° 或 340–360°）、`successText` 綠色（105–170°）、`warnText` 琥珀色（55–105°）、`infoText` 藍色（200–290°），色度皆 ≥ 0.05，彼此之間的 OKLab 色差 ≥ 0.08，與 `accent` 填色 ≥ 0.06。
- `shadow` 必須夠暗（相對亮度 ≤ 0.05）、`highlight` 必須夠亮（≥ 0.7），兩者都必須不透明。主機以各模式固定的比例把它們混進陰影、玻璃高光與寵物狀態列。
- 寵物狀態列以最黑與最白桌面計算：`text`、`textMuted` ≥ 4.5:1，`quotaFill`、`quotaWarn` 在狀態列與配額軌道上 ≥ 3:1。

省略的選填顏色會依固定公式推導，或取該模式的內建值（規格 §3.2、§3.5、§3.7）：`dangerText`、`successText`、`warnText`、`scrim`、`infoText`、`shadow`、`highlight` 與 `sage` 色系取內建值，其餘由必填顏色推導。`accentHover` 是把 `accent` 往 `text` 混合，取 0.20、0.25 … 0.60 中第一個讓 `onAccent` 達到 4.5:1 的比例。

## 安全：由主機強制的不變量

主題會套用到面板視窗的每個介面，包含權限與風險提示、插件安裝確認、插件內容框、確認對話框、伺服器狀態橫幅與主題設定本身。沒有「保護區域」；改由主機保證做決定時重要的部分：版面、文字標籤、風險徽章文字與「按住才允許」都由主機程式碼決定、主題無法改變；每個文字 token 都在它可能出現的每個表面上檢查（見上方）；狀態色必須維持色相；焦點環維持可見。背景圖片只會畫在面板背景，至少有 0.50 的遮罩，且無法點擊。

寵物視窗依寵物外觀的模式（深色、淺色或跟隨面板）套用主題：泡泡、權限泡泡、狀態列、狀態圓點、徽章與邊緣把手都由你的顏色衍生（半透明的 `surface` 疊在桌面上，以上方的最黑與最白桌面規則檢查）；`petStatus` 會另外覆寫狀態列。寵物視窗只接收顏色，不接收字型、圓角、圖片或模糊。狀態圓點與配額條透過狀態色保有語意（成功／危險／警告，受色相檢查），思考與工具使用 `accentText`，閒置與離線使用 `textMuted`／`textFaint`；`petStatus` 無法改變配額低於 20% 的危急色，它一律是 `dangerText`。供應商識別色（Claude）使用 `sage` 色系，且一律與供應商名稱一起顯示。寵物圖像與光暈來自寵物圖，不受主題影響。

## 我的主題與主題編輯器

使用者也可以不靠任何插件自己做主題（通用 → 外觀 → **自訂…**、**我的主題**，以及你的插件分頁中主題清單之後的同一份清單）。編輯器是主機程式碼，裡面不執行任何插件程式碼。對插件作者的影響：

- **你的主題可以當起點。**「起點」列出所有已安裝的插件主題。複製時會帶上你的顏色、漸層、圓角、寵物狀態列顏色與 `userImage` 設定；套件內的字型與背景圖不會被複製（我的主題只用系統字型組合與使用者自己的圖片）。複本屬於使用者，之後插件更新不會改動它。
- **同一個驗證器。** 我的主題會轉成一筆 `panelThemes` 宣告，存檔與套用前都以上面完全相同的規則檢查。編輯器列出所有不符合的組合（不只第一個），附上實測對比、最低要求與建議值：在 OKLCH 明度上最接近、能讓該顏色通過且不破壞其他組合的值（狀態色會先移回各自的色相區間）。圖片遮罩會顯示並建議 `minOverlay`。
- **色盤產生器。** 由一個種子色，主機在 OKLCH 的固定明度階層上排出兩個模式，危險／成功／警告／資訊固定在各自的色相區間，再以最多四輪驗證器自己的建議值修正。所有測過的種子色都能通過；若某個色盤仍有問題，編輯器會列出問題，修正前無法存檔。由圖片產生時，把使用者的背景圖縮到 ≤ 128 px，在 OKLab 中做 k-means（固定的初始點與迭代次數），以面積最大且有顏色的群當種子。
- **插槽與讀取 API 不變。** 我的主題與插件主題共用每個模式唯一的插槽；套用它會取代你的主題，`--ap-*`／`api.theme` 回報的是它的顏色，與插件主題完全相同。插件不會知道目前的主題是你的、使用者自己的，還是內建，也不會收到「我的主題」的新增、修改、刪除事件或任何識別值；使用者存檔套用中的我的主題而顏色改變時，你只會收到一般的 `theme.onDidChange`，與切換主題相同。
- **儲存。** 最多 50 個主題，存在 `userData/panel-themes-user/<id>.json`（一個主題一個檔案，≤ 16 KiB）。匯出／匯入的格式是 `{ "format": "agent-pets-panel-theme", "schemaVersion": 1, "name", "definition" }`，只有顏色與設定，絕不包含圖片或路徑；匯入會嚴格解析（未知的鍵一律拒絕），驗證通過才會存檔。

## 在插件中讀取主題（`--ap-*`、Host API `theme`）

任何插件都能跟著使用者目前看到的主題變化，不需要權限，也不需要 `panelThemes` 貢獻。數值來自面板目前淺色／深色模式所套用的主題；沒有套用主題、主題插件停用、該模式沒有主題，或 Windows 高對比（`forced-colors`）開啟時，使用內建色盤。

- **面板頁**：你的第一個腳本執行前，所有 `--ap-*` 屬性就已經設定在頁面的根元素上（preload 以同步方式取得目前的快照，經由 CSSOM 寫入，頁面的 CSP 不變；`<html>` 元素建立後也會以 inline 方式寫一份），主題或模式變更時即時更新。請寫成 `var(--ap-surface, #292420)` 並自備 fallback，方便在瀏覽器單獨預覽。
- **Worker 與面板頁**：`api.theme.get()` 回傳 `{ apiVersion: 1, mode: 'light' | 'dark', tokens }`；`api.theme.onDidChange(callback)` 回傳取消訂閱函式。變更事件會合併（100 ms 內連續變動只送一次，且不會送出與上一份相同的快照），每個回呼拿到各自的凍結複本。

| Token | 用途 | 保證（每個模式分別驗證） |
| --- | --- | --- |
| `--ap-bg` | 頁面背景 | 不透明 |
| `--ap-surface`、`--ap-surface-2` | 浮起的表面（卡片、輸入框） | 不透明 |
| `--ap-text`、`--ap-text-secondary`、`--ap-text-muted` | 文字層級 | 在 `bg`、`surface`、`surface-2` 上 ≥ 4.5:1 |
| `--ap-accent` | 強調色填色（主要按鈕） | 在 `bg` 上 ≥ 3:1 |
| `--ap-accent-hover` | 強調色的 hover／按下 | `on-accent` 在其上 ≥ 4.5:1 |
| `--ap-accent-text` | 強調色文字與連結 | 在 `bg` 上 ≥ 4.5:1 |
| `--ap-on-accent` | `accent` 上的文字與圖示 | 在 `accent` 上 ≥ 3:1，在 `accent-hover` 上 ≥ 4.5:1 |
| `--ap-border`、`--ap-border-soft` | 邊框與分隔線 | 半透明 |
| `--ap-focus` | 焦點框 | 等於 `accent-text`，與 App 自己的焦點框相同（在每個表面上 ≥ 3:1） |
| `--ap-danger`、`--ap-success`、`--ap-warn` | 狀態文字 | 在 `surface`／`surface-2` 上 ≥ 4.5:1；色相維持紅／綠／琥珀 |
| `--ap-info` | 資訊文字 | 主題的 `infoText`（省略時為內建藍色），在 `surface`／`surface-2`／`bg` 上 ≥ 4.5:1；色相維持藍色 |
| `--ap-scrim` | 對話框遮罩 | 透明度 ≥ 0.3 |
| `--ap-shadow` | 陰影色（自行加透明度，例如 `color-mix(in srgb, var(--ap-shadow) 30%, transparent)`） | 不透明，相對亮度 ≤ 0.05 |
| `--ap-highlight` | 玻璃高光色 | 不透明，相對亮度 ≥ 0.7 |
| `--ap-radius-sm`、`--ap-radius-md`、`--ap-radius-lg` | 圓角 | `Npx`，sm ≤ md ≤ lg |
| `--ap-font-body`、`--ap-font-heading` | 字族清單 | 只含本機字型與通用字族 |
| `--ap-font-scale` | 字級倍率 | 無單位，0.92–1.15 |

顏色一律是 `rgb(R G B / A)`。主題附帶的字型只在設定面板註冊，所以字族清單會略過它們，從主題的下一個備援字型開始。這份 token 清單是 apiVersion 1 的契約：名稱與格式不會改變，之後只會新增。

快照不含任何插件或主題 id、圖片、字型檔、路徑或使用者匯入的背景，且每個插件拿到的內容都相同。由於顏色就是畫面上的顏色，插件可以比對數值猜出目前的主題；這屬於顯示資訊，因此不另外要求權限。

```js
export default {
  async activate(api) {
    const theme = await api.theme.get()
    api.log.info('Mode', theme.mode, theme.tokens['--ap-accent'])
    api.theme.onDidChange(next => api.log.info('Theme changed to', next.mode))
  },
}
```

## 封裝與線上目錄

含主題的套件屬於素材套件：總計 ≤ 25 MiB、≤ 64 個檔案；背景圖 ≤ 8 MiB、每邊 64–4096 px、≤ 8.39 MP、靜態且 EXIF 方向為 1；字型 ≤ 1 MiB。線上目錄中含 `panelThemes` 的版本必須設定 `"minAppVersion": "1.12.0"`，舊版 App 會隱藏它。授權畫面顯示「提供 N 個面板主題」（低風險），有字型時另顯示「附帶面板用的自訂字型」（中風險）；新增主題或字型時會重新詢問。
