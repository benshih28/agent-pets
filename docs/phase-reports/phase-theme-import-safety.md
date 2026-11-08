# Phase D：寵物（主題）匯入安全化

- 日期：2026-11-08
- 基準版本：`1.11.0`（`2dd33cd`），已 rebase 到 `1.11.1`（`origin/main` `a41c2be`，含 History sessions view）
- 分支：`feat/theme-import-safety`
- 建議版本：patch（以 `1.11.2` 發佈）；本階段未修改版本號。

## 範圍

1. **原子性安裝**：Zip 先解析、驗證，再寫入 `~/.desktop-pet/.pet-import-staging/stage-<32 hex>`（與 `custom/` 同一個上層目錄、同一個檔案系統），每個檔案以 `O_EXCL | O_NOFOLLOW` 建立並 `fsync`，目錄也 `fsync`（Windows 無法開啟目錄時略過）。確認後以單一 `rename` 移到 `custom/<id>`。取代既有寵物時：舊目錄 `rename` 成 `backup-<hex>-<id>` → 新目錄 `rename` 進來 → 刪除備份；第二步失敗會把備份 `rename` 回原位。任何失敗都會刪除暫存目錄，不會留下寫到一半的寵物資料夾。
2. **啟動時復原**：`recoverStale()` 只處理暫存根目錄下符合 `stage-<hex>`／`backup-<hex>-<id>` 的項目，最多列舉 1024 筆、處理 64 筆；`lstat` 確認是真正的目錄（符號連結一律略過、不跟隨）；`stage-*` 刪除；`backup-*` 只有帶 `.replaced` 標記（取代成功後才寫入）時才刪除，未標記的備份在 `custom/<id>` 空著時還原，否則保留、絕不刪除。暫存根目錄本身若是符號連結則拒絕使用。
3. **重複 ID**：準備階段以不分大小寫比對 `custom/` 資料夾與內建 `pets.json` 的 ID。有衝突時預覽對話框只提供**取代**（內建寵物不提供）或**保留兩者**（自動加 `-2`…`-99` 後綴，顯示名稱加 `(2)`），沒有衝突才提供**匯入**。對話框使用共用的 `Dialog.vue`，沒有 `window.confirm`。
4. **TOCTOU**：主程序在預覽時記下目的地指紋（目錄 dev/ino/mtimeNs，加上 `pet.json`、`spritesheet.webp` 的 ino/size/mtimeNs），並把 `sha256(token, id, 指紋, 建議 ID)` 作為 `expectedState` 交給 renderer。commit 時 renderer 必須原封帶回，主程序再重新計算一次；不一致就拒絕並回傳新的預覽，renderer 換成新的對話框內容並提示重新選擇。`rename` 撞到已出現的目的地（`EEXIST`／`ENOTEMPTY`／`EPERM`）也走同一條路徑。token 為一次性、10 分鐘逾時，同時只保留一個待確認的匯入；所有 stage/commit/cancel/recovery 在主程序內序列化。
5. **圖集版本**：依圖片列數判定（≥11 列為 v2，9–10 列為 v1），`pet.json` 宣告的 `spriteVersionNumber` 不一致時只產生警告，寫入的是實際版本（以前固定寫 2）。單張 spritesheet 匯入也改用同樣判定。
6. **v2 的 walk／sleep**：專案內的權威來源是 `public/pets/qitian-dasheng/validation.json`，它標明 v2 第 9、10 列是 `look-000-to-157.5`、`look-180-to-337.5`（視線方向列），第 1、2 列是 `running-right`、`running-left`。因此**沒有**把第 9–10 列當成 walk／sleep，而是：v2 素材沒有宣告 walk 時自動使用第 1 列（常數 `SPRITE_ATLAS_WALK_ROW`，與內建寵物手動設定一致）；sleep 在 v2 圖集中沒有對應列，維持回退待命動畫，素材可自行以 `behaviorManifest` 宣告。v1 行為不變。超出實際列數的 `behaviorManifest` 列會被丟棄並警告。
7. **匯入預覽**：顯示待命動畫（依 `prefers-reduced-motion` 只顯示第一格）、每列第一格、版本、單格尺寸、欄 × 列與警告。圖片由新的 `agent-pets://import-preview/<32 hex token>/spritesheet` 提供，主程序只依 token 對到暫存目錄，再以既有的 `readRegularFileWithin`（realpath 範圍檢查、`O_NOFOLLOW`、大小上限）讀取並嗅探內容型別；renderer 只接受符合此格式的 URL，不會載入任意路徑，也沒有把大圖轉成 data URL 經 IPC 傳送。
8. **文件**：README 英文與繁中同步更新；新增 zh-TW／en-US 文案與錯誤訊息翻譯（順便補上既有 `E_SIZE` 訊息缺漏的繁中翻譯）。

不在範圍內：GIF 主題（需要新依賴）。

## IPC 變更

`import-pet-zip` 改為三個頻道，皆只接受設定面板 main frame：

| 頻道 | 輸入檢查 |
|---|---|
| `prepare-import-pet-zip` | 原生檔案選擇器；`lstat` 一般檔案、≤10 MB；完整 Zip 驗證後才暫存 |
| `commit-import-pet-zip` | token 必須是 32 位 hex；decision 只接受 `install`／`replace`／`keep-both` 且需符合衝突狀態；`expectedState` 截斷到 64 字元並逐字比對 |
| `cancel-import-pet-zip` | token 必須是 32 位 hex |

`docs/security/ipc-inventory.md` 已重新產生（rebase 後 106 個 handler）。

## 安全檢查（Zip 路徑）

新增 `electron/zip-inspect.ts`，作為**唯一**的 Zip 解析器：先只讀 EOCD、central directory 與 local header（O(entries)，不 inflate），再由同一份解析結果解壓選定項目。不再交給 fflate `unzipSync` 二次解析（見下方「第二輪審查修正」）。

| 類別 | 處理 |
|---|---|
| Zip slip／絕對路徑 | 拒絕 `/`、`\`、磁碟代號、`..` 片段；輸出路徑本來就固定為 `pet.json`／`spritesheet.webp`，不使用項目名稱 |
| 符號連結 | Unix `S_IFLNK` 與 DOS／NTFS reparse point 屬性一律拒絕 |
| Zip bomb | 項目數上限 64（含目錄與 `__MACOSX`）；宣告總大小 ≤25 MB；單一項目與整體壓縮比 >100 倍（≥1 MiB 時）拒絕；壓縮大小為 0 卻宣告內容者拒絕；項目資料範圍重疊（overlapping-file bomb）拒絕；stored 項目大小不一致拒絕 |
| 格式 | 拒絕多磁碟、ZIP64、加密（含強加密）、未知壓縮方式 |
| 重複項目 | NFC＋不分大小寫比對，重複即拒絕；多個 `pet.json` 也拒絕 |
| 非 UTF-8 檔名 | 檔名必須是有效 UTF-8（接受 macOS 未設旗標的 UTF-8），含控制字元拒絕 |
| `pet.json` 過大 | central directory 宣告與實際解壓都檢查 256 KB |
| `pet.json` 內容 | `TextDecoder` fatal 解碼；reviver 在每一層移除 `__proto__`、`constructor`、`prototype`；必須是物件；文字欄位移除控制字元並截斷 |
| 圖片解壓炸彈 | 仍在解碼前依檔頭限制寬高與 16M 像素；PNG 另外要求第一個 chunk 是 `IHDR`；JPEG 以嚴格的 segment 走訪取得尺寸（見下方） |
| EXIF 旋轉 | JPEG APP1、PNG `eXIf`、WebP `EXIF` 的 Orientation ≠ 1 一律拒絕（`E_ORIENTATION`）；預覽格與 sprite `Image` 另設 `image-orientation: none` |
| 寵物 ID | 拒絕 `.`、結尾為 `.`、Windows 裝置名稱（`CON`、`NUL`、`COM0-9`、`LPT0-9` 等，含副檔名），所有平台一致 |

效能：只 inflate `pet.json` 與選定的那一張圖片（`inflateSync` 寫入依宣告大小 +1 預先配置的緩衝區，其餘項目只計入上限，不解壓）；`agent-pets://` 的 `app`、`custom`、`import-preview` 回應直接使用檔案 Buffer 的 view，不再以 `Uint8Array.from` 逐元素複製（每次最多 20 MB）；圖片以 `Uint8Array` 直接寫入，不再多複製一份 `Buffer`；讀入的 Zip 以 view 傳遞。全部檢查為 O(entries)（重疊檢查為 O(n log n)，n ≤ 64）。

## 驗證

| Gate | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通過，無依賴變更 |
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | rebase 後 982/982 通過（第一輪 957 個中有 1 個既有計時測試 `tests/relaunch.test.mts` 在負載下逾時，單獨重跑通過） |
| 新增測試 | `tests/zip-inspect.test.mts` 11、`tests/pet-import.test.mts` 16、`tests/pet-atlas-preview.test.mts` 2；`tests/pet-sprite-validation.test.mts` 新增 5；`tests/ipc-pet-assets.test.mts` 改寫為新頻道 |
| `pnpm lint` | 通過 |
| `pnpm exec vite build` | 通過 |
| `check:bundle-size`／`check:bundle`／`check:contrast`／`check:design:strict` | 皆通過，design strict 無新 finding |
| `git diff --check` | 通過 |
| 隔離 Electron harness | **未執行**：17373–17375 被使用者正在執行的 Agent Pets 佔用；且匯入流程需要原生檔案選擇器，harness 無法自動操作 |

測試全部使用 `os.tmpdir()` 下的暫存目錄，不碰真實 home，不觸發 Keychain。

## 殘餘風險

- **真實 Electron UI 尚未目視驗證**：預覽對話框在淺色／深色、zh-TW／en-US 長字串、減少動態效果下的實際呈現，需要使用者在 app 內走一次匯入流程確認。
- **Windows 未測試**（依排程延後）：目錄 `fsync` 在 Windows 會被略過；防毒軟體或其他程序持有檔案時 `rename` 可能回 `EPERM`，此時取代流程會還原備份並回報失敗，不會遺失舊寵物。
- 選擇的 Zip 在 `lstat` 與 `readFile` 之間被換成更大的檔案時，仍會先讀入再被 10 MB 檢查拒絕（使用者自己選的檔案，風險低）。
- 待確認的匯入在 app 結束時不會主動清除，由下次啟動的 `recoverStale()` 刪除。
- 取代時若在「新目錄已 rename 進來」與「寫入 `.replaced` 標記」之間當機，下次啟動會保留該備份（不刪也不還原），只佔用磁碟空間，需要手動清理。
- 外掛 skin 不經過本流程；它們的 EXIF 旋轉仍只靠 `image-orientation: none`（脫離 DOM 的 `Image` 在 Chromium 可能不套用 CSS），屬既有範圍外。
- 單張 spritesheet 匯入（`import-pet-sprite`）與 `add-custom-pet` 仍為直接寫檔，未改為暫存＋原子 rename；它們使用新產生的唯一 ID，不會與既有寵物衝突，留待後續。
- v2 的 sleep 沒有專用列，因此仍回退待命動畫；這是依專案內圖集資料做的決定，而非把視線方向列誤用為睡覺動畫。

## 第二輪審查修正

獨立安全審查提出 7 點（其中 1、2 已重現），全部修正並以重現案例加入回歸測試：

| # | 嚴重度 | 問題 | 修正 | 回歸測試 |
|---|---|---|---|---|
| 1 | HIGH | 解析器差異：pre-scan 與 fflate `unzipSync` 選到不同 EOCD，comment 中藏的假 EOCD 讓 pre-scan 看到 `pet.json`、fflate 卻解出 `evil.json` | 不再使用第二個解析器：取最後一個 EOCD 且 comment 必須剛好到 EOF；EOCD 之後再有簽章、`eocd-20` 有 ZIP64 locator、CD 結尾不等於 EOCD 位置都拒絕；local header 的 flags、method、名稱位元組、（無 data descriptor 時）CRC 與大小必須和 central 記錄一致；由檢查過的資料位置自行 `inflateSync` 到預先配置的緩衝區並驗證長度 | `zip-inspect`：隱藏 EOCD 重現、ZIP64 locator、CD 缺口、local header 不一致 4 種 |
| 2 | MEDIUM | JPEG `FF FF` 填充位元組被當成有長度的 marker，跳過真正的 65535×65535 SOF0、採用後面的假 SOF | 跳過填充位元組；只允許一個 SOF 且必須在第一個 SOS 之前；走過 SOS 後的熵編碼資料（`FF00`、RST、填充）繼續檢查後續 segment；segment 超出 EOF 或沒有 scan 視為無效 | `pet-sprite-validation`：審查重現、兩個 SOF、SOS 後的 SOF、熵資料後藏 SOF、超出 EOF、無 scan |
| 3 | LOW | 從未檢查 CRC | 解壓後驗證 CRC-32（`checksum_mismatch`） | `zip-inspect`：CRC 錯誤、串流長於宣告 |
| 4 | LOW | `sanitizePetId` 接受 `.`、Windows 保留名稱、結尾 `.` | 抽到 `electron/pet-id.ts` 並在所有平台拒絕 | `pet-import`：不可攜 ID 清單 |
| 5 | LOW | 取代失敗且還原備份也失敗時，回傳 `E_IMPORT_STATE_CHANGED`（無衝突）讓使用者按「匯入」，之後 `recoverStale` 刪掉唯一的舊寵物 | 還原失敗回傳 `E_IMPORT_FAILED`、不重新預覽；備份只有帶 `.replaced` 標記才可刪除，未標記的備份在目的地被佔用時保留 | `pet-import`：還原失敗 → 另一次匯入佔用 ID → 重啟保留 → 騰出後還原 |
| 6 | LOW perf | protocol 以 `Uint8Array.from` 複製最多 20 MB | `app`／`custom`／`import-preview` 直接回傳 Buffer view | （型別檢查與既有 protocol 測試） |
| 7 | LOW | EXIF 旋轉的 JPEG 通過驗證後在 renderer 被轉向 | 驗證階段拒絕 Orientation ≠ 1（JPEG／PNG／WebP），並設定 `image-orientation: none` | `pet-sprite-validation`：三種格式的旋轉偵測 |

同時把原本的 IPC commit 與面板 commit 合併，branch 上每個 commit 都能通過 `vue-tsc --noEmit`（已逐一驗證）。

## 版本建議

Patch（`1.11.2`）：沒有持久化 schema 變更（`pet.json` 只是寫入正確的版本號），IPC 為面板內部契約的替換，沒有新增外部或 MCP 契約。等待使用者確認後才調整版本。
