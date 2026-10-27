# Phase 12 複檢與修正清單

- 複檢對象：`feat/plugin-host` 的 `9a2e616..8e34ba2`（P12.1–P12.5）
- 複檢日期：2026-10-23
- 結論：**需要修正後才能進入 Phase 13**。結構、測試覆蓋與安全基線良好；有 1 個安全問題、3 個功能問題、2 個與「行為完全不變」衝突的回歸。

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 185/185 通過 |
| `pnpm exec vite build` | 通過 |
| `git diff --check` | 通過 |
| 探測腳本：`0x7f.1`、`127.1` 當 manifest host | **被接受**，且 WHATWG URL 會解析成 `127.0.0.1`（見 R1） |
| 探測腳本：寵物隱藏 60 秒後恢復 | **最新一則沒有補顯示**（見 R2） |
| 探測腳本：寵物 zip 內含 `notes: v2.txt` 或 `cat /pet.json` | **整包被拒**，Phase 12 前可匯入（見 R5） |

## 修正清單（給 Codex）

全部修完後，照交接文件 §0.4 跑檢查，commit 訊息用 `fix(plugin): [P12.R] ...`，最後一個 commit 加 `Checkpoint: P12.R`，push，並更新 Phase 12 的同一筆工作記錄與 `docs/phase-reports/phase-12-plugin-core.md`（新增「複檢修正」一節）。修完後停止回報，不要開始 Phase 13。

### R1（安全，必修）數字形式的主機名稱會被當成合法網域

- 位置：`electron/plugin-manifest.ts` 的 `isValidPluginNetworkHost`。
- 問題：`0x7f.1`、`127.1`、`1.0x7f000001` 這類主機名稱通過驗證，但瀏覽器與 Node 的 URL parser 會把它們當成 IPv4（`127.0.0.1`）。這個函式同時用在 manifest hosts、`grantedHosts` 與通知連結。
- 修正（兩條都要）：
  1. 依 WHATWG URL 的「ends in a number」規則，**最後一個 label** 全是數字（`/^\d+$/`）或是 `0x` 開頭的十六進位（`/^0x[0-9a-f]*$/i`）就拒絕。
  2. 保險：`new URL('https://' + domain).hostname` 必須與 `domain` 完全相同（萬用字元只檢查 `*.` 後面的部分）；丟出錯誤或不相同都拒絕。
- 測試：在 `tests/plugin-manifest.test.mts` 加入 `0x7f.1`、`127.1`、`1.2.3.4`、`foo.123`、`a.0x10`、`*.0x7f.1` 皆拒絕；`a1.example.com`、`123abc.example.com` 仍接受。

### R2（功能，必修）寵物看不到超過 TTL 後，恢復時不會補顯示最新一則

- 位置：`electron/plugin-feed.ts` 的 `observeVisibility`。
- 問題：`hiddenLatest` 保留的是原本的 `expiresAt`（最多 15 秒）。寵物縮小或隱藏超過 TTL 後恢復，`latest.expiresAt > now` 為 false，什麼都不顯示，違反「恢復後補顯示最新一則」。
- 修正：恢復時用 **新的 TTL** 重新排入：保留原 `ttlMs`（存在 item 上或另存），`expiresAt = now + ttlMs`。仍要檢查 `canDisplay`。
- 測試：隱藏 → 送出 → 經過 60 秒 → 恢復，應 emit 該則；隱藏期間送 3 則，恢復只 emit 最後一則。

### R3（功能，必修）DND 期間的插件通知直接丟掉

- 位置：`PluginFeedController.submit`。
- 問題：DND 時回 `disabled` 且不進通知中心；使用者關掉 DND 後完全看不到這段期間的通知。
- 修正：DND 時與「寵物看不到」相同處理：**進通知中心並算未讀、不送泡泡、不計入速率**；DND 結束後 **不補顯示**（避免一關 DND 就跳泡泡）。插件總開關關閉、該插件停用仍維持直接拒絕。
- 同步更新交接文件 P12.4 的描述沒有必要（已由本複檢定案），但 phase report 要寫明。
- 測試：DND 中送出 → `delivery: 'center'`、未讀 +1、未 emit；不消耗速率額度。

### R4（資料保全，必修）偏好檔只要有一筆壞掉就全部重設

- 位置：`electron/plugin-preferences.ts` 的 `parseStoredPreferences` / `load`。
- 問題：
  1. 任何一個插件的設定不合法、或檔案出現未知欄位，整份檔案都視為無效，回到預設值；下一次寫入就把使用者其他插件的設定全部覆蓋掉。
  2. 未來版本新增欄位後，使用者降版就會遺失所有插件設定。
- 修正：
  - 未知欄位（根層級與每插件層級）**忽略**，不視為錯誤，也不寫回。
  - 單一插件項目不合法時 **只丟棄那一筆**（該插件回到預設：停用），其他保留。
  - 根層級欄位型別錯誤時，該欄位用預設值，其他欄位照常解析。
  - 整份檔案無法解析（壞 JSON、超過大小）時，第一次寫入前先把原檔改名為 `plugin-preferences.json.corrupt-<timestamp>` 保留，再寫新檔。symlink 仍拒絕且不改名。
- `patch` 驗證（`parseGlobalPatch`、`parsePluginPatch`）維持嚴格，未知欄位照舊拒絕。
- 測試：一筆壞插件 + 一筆好插件 → 好的保留；未知欄位被忽略；壞 JSON → 寫入後存在 `.corrupt-*` 備份。

### R5（回歸，必修）寵物 zip 匯入變嚴格，原本能匯入的檔案被拒

- 位置：`electron/archive-guard.ts` 與 `main.ts` 的 `import-pet-zip`。
- 問題：寵物匯入只用檔名、輸出路徑是固定的，Phase 12 前包含奇怪路徑（含 `:`、資料夾名稱結尾空白、Windows 保留字）的 zip 都能匯入；現在整包被拒，違反 Phase 12「行為完全不變」。
- 修正：把 `rejectUnsupportedExtensions` 改名為更明確的 `mode: 'strict' | 'compat'`（預設 `strict`）。`compat` 模式下：
  - 路徑不安全的項目 **略過**（不解壓、仍計入檔案數與大小上限），不讓整包失敗。
  - 不支援的副檔名同樣略過（維持現有行為）。
  - 重複路徑：保留第一個、略過後面的。
  - `strict`（插件安裝用）維持現在的全部拒絕規則。
- 寵物匯入改用 `mode: 'compat'`，並在 `includePath` 額外排除 `__MACOSX/` 底下與檔名以 `._` 開頭的 macOS 中繼檔（避免被誤選成 spritesheet）。
- 測試：`compat` 下含 `notes: v2.txt`、`cat /x.png`、`__MACOSX/._a.webp` 的 zip 仍成功，回傳的檔案不含這些；`strict` 下同樣的 zip 被拒。

### R6（回歸，必修）Agent toast 與 MCP `pet_say` 同時存在時的顯示順序改變

- 位置：`src/utils/feed-arbiter.ts`。
- 決定：**維持 Phase 12 前的行為：`presentation-say` 高於 `agent-toast`**。交接文件的順序是我的疏失，以「使用者可見行為不變」為準。
- 修正：調整 `selectBubble` 順序為 permission-request → permission-notice → presentation-say → agent-toast → plugin-feed-normal → activity → plugin-feed-low；同步更新測試的 `PRIORITY` 陣列。
- 規劃文件 §3.3 的順序我會另外更新，你不用改。

### R7（視覺回歸，必修）toast 結束轉成 activity 時少了 out-in 過場

- 位置：`src/components/DesktopPet.vue`。
- 問題：Phase 12 前 toast 與 activity 在同一個 `<Transition mode="out-in">` 裡切換，有淡出再淡入的過場；拆成兩個獨立 Transition 分支後，兩者互換時是整個 Transition 被替換，過場行為不同。
- 修正：把 `agent-toast` 與 `activity` 放回 **同一個** Transition 分支：`v-else-if="bubbleSelection === 'agent-toast' || bubbleSelection === 'activity'"`，內部用原本的 `v-if="store.toast"` / `v-else-if` 結構。
- 這個分支的位置要在 `presentation-say` 分支之後（配合 R6）。

### R8（清理，建議）

- `BubbleCandidates.bubbleEnabled` 沒有任何讀取者，刪除（phase-gates：No unreachable fields/methods）。

## 對 Codex 待決問題的答覆

| # | 問題 | 決定 |
|---|---|---|
| 1 | `source-map-js`、`@vue/server-renderer` High 弱點 | 不在本分支處理。兩者都來自 `vue@3.5.40`，會另開 PR 在 `main` 升級 `vue`；本分支之後 merge `main` 即可。phase report 記錄為「既有、另案處理」。 |
| 2 | Electron 手動驗收 | 由使用者／複檢者在 Phase 複檢時執行。Codex 每個 Phase 的報告要附「手動驗收步驟」清單（可直接照做的步驟與預期結果），其餘仍寫「未驗證」，不要寫通過。 |
| 3 | 低優先同順位順序 | 接受：activity 先於 plugin-feed-low。 |
| 4 | toast 與 say 順序 | 見 R6：維持舊行為。 |
| 5 | 偏好檔 1 MiB 上限 | 接受。 |
| 6 | settings schema 與 archive path 額外限制 | 接受，P14.6 的對外規格文件要逐條寫出這些上限。 |
| 7 | `targetPetId` 與圖示 resolver | 接受目前格式。P16.5 會擴充 `targetPetId` 以接受 `plugin:<pluginId>:<skinId>`（已寫進交接文件）。 |

## 手動驗收（複檢者或使用者執行）

R1–R8 修完後，在 `pnpm dev` 下：

1. 設定面板匯入一個一般寵物 zip（pet.json + spritesheet），確認可匯入並顯示。
2. 匯入一個用 macOS「壓縮」建立、含 `__MACOSX` 的寵物 zip，確認可匯入且外觀正確。
3. 開啟完成提示泡泡，讓 Agent 完成一次工作：完成 toast 出現、倒數後切換為 activity 文字時有淡出淡入。
4. 有 toast 時用 Presentation MCP 送一則 `pet_say`：`pet_say` 先顯示（與 Phase 12 前相同）。
5. 觸發一次權限請求：權限泡泡蓋過其他泡泡。

## 修正複檢與手動驗收結果（2026-10-23）

- 複檢對象：`0c0ed36..4230f57`（R1–R8）。
- 重跑檢查：`vue-tsc` 通過、`pnpm test:unit` 192/192、`vite build` 通過、`git diff --check` 通過。
- 探測腳本：`0x7f.1`、`127.1` 已被拒；隱藏 60 秒後恢復會補顯示最新一則；DND 期間通知進通知中心。
- 結論：**R1–R8 全部修正，Phase 12 通過**，可進 Phase 13。

### Electron 手動驗收方式

無法操作原生畫面，改以隔離環境啟動 `HEAD`（4230f57）的 `vite build` 產物：`HOME` 與 `--user-data-dir` 都指向暫存資料夾，未碰觸使用者已安裝並執行中的 Agent Pets 與 `~/.desktop-pet`；以 `--inspect` 連主程序、`--remote-debugging-port` 連兩個視窗。選檔視窗以主程序端替換 `dialog.showOpenDialog` 回傳測試 zip 路徑，再由面板呼叫 `electronAPI.importPetZip()`；泡泡以寵物視窗的 Pinia store 注入狀態並讀取 DOM。

| # | 項目 | 結果 |
|---|---|---|
| 1 | 一般寵物 zip（pet.json + spritesheet.webp）匯入 | 通過：回傳 `ok`、檔案寫入、spritesheet 與來源逐位元組相同、重新載入後寵物正確顯示 |
| 2 | macOS 風格 zip（含資料夾、`__MACOSX/._*`、`.DS_Store`、`notes: v2.txt`）匯入 | 通過：匯入成功，選到的是真正的 spritesheet（逐位元組相同），重新載入後正確顯示 |
| 3 | 完成 toast 切到 activity 的過場 | 通過：觀察到 toast 的 `toast-leave-active` 後 activity 才 `toast-enter-active`（out-in） |
| 4 | toast 存在時送 `pet_say` | 通過：顯示 `pet_say`；清除 say 後回到 toast |
| 5 | 權限請求蓋過其他泡泡 | 通過：toast + say 同時存在時注入權限請求，只顯示權限泡泡；移除後回到 say |

觀察：從面板直接呼叫匯入 API 後，寵物視窗要重新載入才看得到新寵物；這是測試繞過面板 UI 刷新流程造成的，且該流程不在 Phase 12 變更範圍內，不列為缺陷。
