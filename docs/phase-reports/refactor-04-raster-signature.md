# 重構階段 4：圖片格式辨識

- **開始時間**：2026-11-10 11:23（Asia/Taipei）
- **完成時間**：2026-11-10 11:40（Asia/Taipei）
- **基準 commit**：`1926b08`（分支 `claude/refactor-04-raster-8d563a`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 3 項；排程見 3.1 節

## 範圍

1. 主行程多處各自手寫 PNG／WebP／JPEG magic bytes 與 MIME 對應：`electron/main/runtime.ts` 的 `isSupportedRasterImage()`、`rasterContentType()`，`electron/plugin-registry.ts` 的 `hasRasterSignature()`，`electron/plugin-panel-themes.ts` 的 `panelThemeImageType()`，以及 `electron/pet-sprite-validation.ts` 的 `readImageSize()`／`readImageAnimated()`／`readImageOrientation()` 內的格式分派。抽出一個回傳圖片 MIME 的純函式，各入口改用。
2. 各入口保留自己的格式白名單，接受範圍不放寬也不收緊。
3. 格式辨識只看檔頭，不取代尺寸、動畫、EXIF orientation 或解碼驗證；這些檢查一行不動。

不在範圍：副檔名對 MIME 的對應（`contentTypeFor()`、`plugin-protocol.ts`）、WOFF2 字型 signature（`isWoff2()`）、面板主題儲存紀錄的 MIME 字串白名單（`panel-theme-store.ts` 的 `IMAGE_TYPES`）、畫面端的 icon 路徑副檔名規則（`src/utils/plugin-icon.ts`）。這些不是「依檔頭辨識格式」，或屬於別的契約，見「盤點結果」。

## 驗收條件

1. 先以測試固定每個入口現有的接受範圍：PNG、JPEG、WebP、GIF／BMP 等未支援格式、截斷的檔頭、錯一個位元組的 signature、內容與副檔名不符。測試在未修改的程式上先通過，抽取後不改期望值仍通過。
2. 只剩一份 magic bytes 定義；各入口的白名單以型別限定在辨識函式的回傳值內。
3. 尺寸、動畫、orientation、大小上限等檢查不變，既有測試全過。
4. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗，與基準清單比對）、`git diff --check` 通過。
5. 至少一個入口以 Electron 實機驗證（寵物匯入、插件 icon／skin 或面板主題圖片），不把視窗帶到前景。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試清單 | 通過 | 基準 `test:unit`（`1926b08`）：1327 項，1294 過、10 失敗、23 skip（8 個已知 + 「a permission request still reaches the pet when the hook is stalled…」「the worst-case draft … timing ceiling」兩個計時類） |
| 2 | 以測試固定各入口現有接受範圍 | 通過 | `tests/raster-image.test.mts` 4 項，在原樣搬移（未改邏輯）的程式上全過；本步驟開始時沒有先存「進行中」，寫完測試才更新，特此註記 |
| 3 | 抽出共用辨識函式，各入口改用 | 通過 | `vue-tsc` 通過；相關 12 個測試檔 115 項，失敗 2 項皆為基準的 symlink EPERM；步驟 2 的期望值未修改 |
| 4 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 5 | Electron 實機驗證 | 通過 | 三個入口，改前／改後兩個 build 結果逐字相同；見「Electron 實機驗證」 |
| 6 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-04-raster-8d563a` |

## 盤點結果

grep `0x89`、`RIFF`、`WEBP`、`0xff, 0xd8`、`GIF8`、`image/png|jpeg|webp` 於 `electron/`、`src/`、`scripts/`、`integrations/`：

| 位置 | 用途 | 白名單 | 改前 |
|---|---|---|---|
| `runtime.ts` `isSupportedRasterImage()` | 寵物 zip 匯入（`pet-import.ts`）、自訂寵物圖片上傳（`ipc/pet-assets.ts`）先過這關再 `validateSpriteSheet()` | PNG、JPEG、WebP | 自己比對完整 signature；WebP 用 `Buffer.from(...).toString('ascii')` 複製兩段 |
| `runtime.ts` `rasterContentType()` | `ipc/pets.ts` 列出插件 skin；`agent-pets://plugin-skin`、`import-preview`、`custom` 回應的 `content-type` | PNG、JPEG、WebP | 同上，第二份 |
| `plugin-registry.ts` `hasRasterSignature()` | 插件套件內的 skin spritesheet 與 icon | PNG、WebP | 第三份 |
| `plugin-panel-themes.ts` `panelThemeImageType()` | 面板主題圖片：套件內（`checkPanelThemePackagedImage`）與使用者匯入（`checkPanelThemeUserImage`，經 `panel-theme-images.ts`） | 套件 PNG、WebP；使用者 PNG、JPEG、WebP（`ImageRules.types`） | 第四份，逐位元組比對 |
| `pet-sprite-validation.ts` `readImageSize()`／`readImageAnimated()`／`readImageOrientation()` | 依格式選擇檔頭讀取器 | 無（分派用） | 只看 2–3 個位元組（`89 50`、`52 49 … 57`、`FF D8`）就分派 |

其餘結果不屬於本項：`plugin-host-assets.ts` 沒有圖片檢查；`panel-theme-store.ts` 的 `IMAGE_TYPES` 是驗證已存紀錄裡的 MIME 字串，刻意不依賴辨識表（之後若辨識表新增格式，不應讓舊紀錄自動接受）；`contentTypeFor()`、`plugin-protocol.ts` 是副檔名對 MIME；`plugin-icon.ts` 是畫面端的路徑副檔名規則；`isWoff2()` 是字型。

## 設計摘要

- 新增 `electron/raster-image.ts`（沒有任何 import、不用 `Buffer`，可隨面板主題驗證器 vendor）：
  - `RASTER_SIGNATURES` 以 `as const satisfies readonly RasterSignature[]` 定義三種格式的 `[位移, 位元組]`；`RasterImageType` 由表推導，所以表是唯一來源。WebP 的位移 4–7（RIFF 長度）不比對，與改前相同。
  - `sniffRasterImageType(bytes)`：回傳 MIME 或 `null`；最多讀前 12 個位元組、直接索引、不複製 buffer，對帶 `byteOffset` 的 view 也正確。三種 signature 首位元組不同，比對順序不影響結果。
  - `rasterImageTypeIn(bytes, allowed)`：辨識後再套入口的 `ReadonlySet<RasterImageType>` 白名單。
- 各入口的白名單：
  - `pet-sprite-validation.ts`：`PET_SPRITE_TYPES`（PNG、JPEG、WebP）；`isSupportedRasterImage()`、`rasterContentType()` 從 `runtime.ts` 搬來這裡（純模組，可以被 Node 測試直接載入），`main.ts` 與 `runtime.ts` 改為從這裡匯入。`rasterContentType()` 回傳型別由 `string | null` 收斂為 `RasterImageType | null`。
  - `plugin-registry.ts`：`PLUGIN_ARCHIVE_RASTER_TYPES`（PNG、WebP），`hasRasterSignature()` 保留名稱與呼叫點。
  - `plugin-panel-themes.ts`：刪除 `panelThemeImageType()`（沒有其他呼叫者），`ImageRules.types` 由陣列改為 `ReadonlySet`，內容不變；`PanelThemeImageKind` 保留為 `RasterImageType` 的別名，`panel-theme-images.ts` 不必改。
- 讀取函式：三個 `readImage*()` 改為 `switch (sniffRasterImageType(bytes))`，`case null` 讓 switch 窮舉。

### 讀取函式單獨呼叫時的差異（入口結果不變）

改前讀取函式只看前 2–3 個位元組分派，例如 `89 50 00 00 …` 後面接合法 IHDR 時，`readImageSize()` 會讀出尺寸、`validateSpriteSheet()` 會回 `ok: true`（已用改前程式實測）。改後一律要求完整 signature，這種檔頭得到 `null`／`E_TYPE`。

所有正式入口在呼叫讀取函式之前都已經做完整 signature 檢查：`pet-import.ts` 與 `ipc/pet-assets.ts` 先 `isSupportedRasterImage()`，`ipc/pets.ts` 先 `rasterContentType()`，`checkImage()` 先辨識格式；所以這個差異從任何入口都觀察不到。測試（「header readers dispatch on the full signature…」）固定改後的函式行為；入口測試與實機的 `pngPrefixOnly` 樣本證明入口改前改後都拒絕同一份檔頭。

## Electron 實機驗證（Windows 11，隔離 HOME，螢幕外）

做法：改後 `vite build` 複製到 `node_modules/.cache/e2e-apps/after`；暫時把五個修改過的 `electron/` 原始檔換回 `1926b08` 版本建置、複製到 `…/base`，再換回並重建（重建結果與 `after` 逐檔相同）。兩份都以 `scripts/e2e-isolated-electron.mjs --offscreen --app-root <copy> --hook-port-base 28673`（CDP 9368、main inspector 9369）啟動。驅動腳本在面板 renderer 呼叫真正的 preload API（經 IPC 與寄件者檢查進入 main），檔案對話框由 main 的 `__agentPetsE2E.dialogQueue` 提供路徑；`agent-pets://` 回應以 main 的 `net.fetch` 讀狀態與 `content-type`（面板 CSP 不允許 renderer `fetch` 這些網址）。沒有點擊任何畫面元素。

樣本：合法 PNG、JPEG、WebP（192×1872 檔頭），PNG 錯第 8 個位元組、只有 `89 50` 前綴、GIF89a、截斷成 7 個位元組。寵物圖片檔一律命名 `sprite-*.png`，zip 內一律是 `spritesheet.webp`，插件 icon 一律是 `icon.png`、skin 一律是 `skins/fox.webp`（內容與副檔名不符）。

| 入口 | 改前（`1926b08`） | 改後 |
|---|---|---|
| 自訂寵物圖片（`importPetSprite`）＋ `agent-pets://custom/…/spritesheet.webp` | PNG／JPEG／WebP 接受，回應 200 且 `content-type` 分別為 `image/png`／`image/jpeg`／`image/webp`；其餘四種回 `null` | 相同 |
| 寵物 zip 匯入（`prepareImportPetZip`）＋ `agent-pets://import-preview` | PNG／JPEG／WebP 接受（圖集 1×9），預覽回應 200 且 `content-type` 依內容；其餘四種回「Spritesheet content is not a valid PNG, JPEG, or WebP image」 | 相同 |
| 插件 icon（`selectPluginArchive`） | PNG、WebP 通過安裝計畫；JPEG、GIF、截斷回 `invalid_icon` | 相同 |
| 插件 skin（`selectPluginArchive`） | PNG、WebP 通過；JPEG、GIF、截斷回 `invalid_manifest` | 相同 |

兩次擷取的 JSON 以字串比較完全相同。兩次結束時所有視窗 `focused: false`；可見的寵物視窗在 x ≈ -18752（螢幕外），面板視窗 `visible: false`。每次執行結束都結束 app 並刪除本次的隔離暫存目錄；驅動腳本與 fixture 在 session scratchpad，`node_modules/.cache/e2e-apps` 不在版本控制內。

過程中的偏差：第一次執行在 renderer 用 `fetch` 讀 `agent-pets://`，被 CSP 擋下（`Failed to fetch`），改為 main 的 `net.fetch` 後重跑；那次 app 由背景工作結束，其隔離目錄已手動刪除。面板主題圖片沒有實機驗證，由單元測試覆蓋（見殘餘風險）。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| 特徵化測試（改前） | `tests/raster-image.test.mts` 4 項，在 `runtime.ts` 兩個函式原樣搬到 `pet-sprite-validation.ts`（未改邏輯）、其他檔案未改的程式上全過 |
| 特徵化測試（改後） | 同一批期望值不改；加上共用辨識與讀取函式 2 項，6 項全過 |
| 相關測試檔 | `raster-image`、`pet-sprite-validation`、`plugin-panel-themes`、`panel-theme-images`、`plugin-registry`、`pet-import`、`ipc-pets`、`ipc-pet-assets`、`panel-theme-plugin-integration`、`panel-theme-user`、`plugin-public-docs`、`ipc-panel-theme`：115 項，110 過、2 失敗（「a symlinked staging root is refused」「startup recovery restores interrupted replaces…」，皆為基準清單內的 symlink EPERM）、3 skip |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1333 項：1301 過、9 失敗、23 skip（基準 1327 項：1294 過、10 失敗）。9 個失敗全部在基準清單內；基準的「the worst-case draft … timing ceiling」這次通過（計時偶發） |
| `git diff --check` | 通過 |
| 祕密掃描 | 對整份 diff 掃 key／secret／token／password／私鑰／`ghp_`／`sk-` 樣式，無命中 |
| 相依套件 | 沒有新增或更新相依套件，`pnpm-lock.yaml` 未變，本階段不重跑 audit |

## 安全審查

- **接受範圍**：每個入口的白名單逐字保留（寵物 spritesheet PNG／JPEG／WebP、插件套件 PNG／WebP、面板主題套件 PNG／WebP、使用者 PNG／JPEG／WebP）。測試對 20 種檔頭樣本固定每個入口的結果，包含截斷（PNG 7 bytes、JPEG 2 bytes、WebP 11 bytes）、錯一個位元組（PNG 首／尾、JPEG 第 3、WebP form type、`RIFX`、`RIFF…WAVE`）、GIF87a／89a、BMP、ICO、AVIF、SVG、空檔。
- **偽裝副檔名**：寵物匯入與插件套件都依內容判定。測試與實機確認 JPEG 內容放在 `.png`／`.webp` 名稱下，寵物入口接受、插件套件拒絕；WebP 內容放在 `icon.png` 下插件仍接受（改前即如此，manifest 只限制 icon 路徑副檔名為 `.png`／`.webp`）。
- **深度檢查未動**：大小上限、尺寸／像素上限、APNG／動畫 WebP、EXIF orientation、JPEG segment 走訪、`validateSpriteSheet()` 的格線規則都沒有修改；格式辨識只決定交給哪個讀取器。讀取函式改為要求完整 signature，只會更嚴格，且所有入口原本就先做完整檢查。
- **回應標頭**：`agent-pets://` 三種圖片回應的 `content-type` 仍由內容決定並帶 `x-content-type-options: nosniff`；實機改前改後相同。
- **vendor 純度**：`raster-image.ts` 沒有任何 import；`tests/plugin-panel-themes.test.mts` 的純模組檢查加入這個檔，`Plugin-Panel-Theme-Spec.md` 的 vendor 清單補上它與既有的相依（`pet-sprite-validation.ts`、`src/types/pet-atlas.ts`）。
- **未改**：IPC channel 與 payload、寄件者檢查、檔案讀取（`readRegularFileWithin()`、`readUserImageSource()`）、zip 檢查、簽章判定。

## Code review 紀錄

- 新語法：signature 表用 `as const satisfies`，MIME 聯集型別由表推導；`?.`／`??`；各入口白名單是 `ReadonlySet<RasterImageType>`，寫錯 MIME 字串會編譯失敗；讀取函式的 switch 含 `case null`，新增格式時 TypeScript 會要求補 case（回傳型別沒有 `undefined`）。程式碼沒有新增 `as`；測試裡兩處 `Object.entries/fromEntries` 的 `as` 只用於列舉樣本表。
- 效能：辨識最多讀 12 個位元組，移除改前 WebP 判斷的兩次 `Buffer.from(subarray)` 複製；沒有 I/O。一次面板主題檢查會辨識 4 次（入口 1 次、三個讀取函式各 1 次），每次是 ≤12 個位元組的比較，相對於後面的 chunk／segment 走訪可忽略，所以沒有為此改讀取函式的簽名。
- 風格：`electron/` 內用相對路徑與 `.ts` 副檔名（Node 測試會直接載入）；註解為繁體中文、只寫原因與限制。`project-map.md` 記錄共用辨識的位置、各入口白名單與「不要再手寫 signature」的規則。沒有使用者可見文字變更，不涉及 i18n 與 Liquid Glass。
- 子代理：本階段範圍小、安全敏感，全部由總控親自實作與複檢，沒有派發子代理。

## 殘餘風險

1. **macOS／Linux 未實測**：只在 Windows 11 驗證。共用模組是純函式，不涉及平台差異。
2. **面板主題圖片沒有實機驗證**：使用者匯入與套件內圖片由單元測試（含錯一個位元組、截斷、JPEG 不得出現在套件）與既有的 `panel-theme-plugin-integration`、`panel-theme-user` 測試覆蓋。
3. **插件 skin 的安裝與回應白名單不同**：安裝只接受 PNG／WebP，`agent-pets://plugin-skin` 回應與 skin 清單用寵物白名單（含 JPEG）。這是 1.12.5 既有行為，本階段刻意保留並在註解寫明；安裝後的檔案在已啟用插件目錄內，JPEG 只會在安裝後被替換時出現。是否要收斂由之後的階段決定。
4. 本機 8 個既有失敗測試與偶發計時測試不在本階段處理。

## 版本建議

本階段單獨看屬於 **patch**：純內部重構，各入口接受範圍、錯誤碼、回應標頭、持久化格式與 IPC 都不變。依整體排程，全部階段完成後統一升 **minor**，本階段不改版號。

## 檔案變更狀態

| 路徑 | 類型 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-04-raster-signature.md` | 新增 | 本階段記錄 |
| `electron/raster-image.ts` | 新增 | 唯一的 signature 表：`sniffRasterImageType()`、`rasterImageTypeIn()`、`RasterImageType` |
| `electron/pet-sprite-validation.ts` | 修改 | 讀取函式改依完整 signature 分派；接收自 `runtime.ts` 的 `isSupportedRasterImage()`／`rasterContentType()`，以 `PET_SPRITE_TYPES` 白名單實作 |
| `electron/main/runtime.ts` | 修改 | 刪除兩份手寫 signature，改從 `pet-sprite-validation.ts` 匯入 `rasterContentType()` |
| `electron/main.ts` | 修改 | `isSupportedRasterImage`／`rasterContentType` 改從 `pet-sprite-validation.ts` 匯入 |
| `electron/plugin-registry.ts` | 修改 | `hasRasterSignature()` 改用共用辨識與 `PLUGIN_ARCHIVE_RASTER_TYPES` |
| `electron/plugin-panel-themes.ts` | 修改 | 刪除 `panelThemeImageType()`；`ImageRules.types` 改 `ReadonlySet`；`PanelThemeImageKind` 改為 `RasterImageType` 別名 |
| `tests/raster-image.test.mts` | 新增 | 固定四類入口的接受範圍、偽裝副檔名、offset view，以及共用辨識與讀取函式 |
| `tests/plugin-panel-themes.test.mts` | 修改 | vendor 純模組檢查加入 `electron/raster-image.ts` |
| `docs/design/Plugin-Panel-Theme-Spec.md` | 修改 | vendor 清單補上影像檔頭讀取的相依模組 |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 記錄共用辨識與各入口白名單 |
