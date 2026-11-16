# Renderer 結構與設計 token 收尾（1.13.2 整合輪，線 3）

日期：2026-11-10  
基準版本：`1.13.1`（不在本線升版）  
基準 commit：`38a75fa`  
分支：`claude/renderer-cleanup-cb193c`

## 範圍

原則是不改變外觀與行為；唯一刻意的使用者可見差異是英文複數（例如「1 sessions」改成「1 session」）。

| 項目 | 結果 |
|---|---|
| 分頁共用元件 | 原本的前提已經過期：儀表板與設定導覽早就改用共用的 `ui/SegmentedControl.vue`（膠囊外觀，設定導覽也已改成水平）。換成 `ui/Tabs.vue` 會改變外觀，所以沒有換；改成把三份方向鍵演算法（`nextTabId`、`nextRovingId`、`SegmentedTabs` 手寫的 `onKeydown`）收成一份 `nextTabId`，並修正 `ui-design-system.md` 對 Tabs／SegmentedControl／SegmentedTabs 用途的描述。 |
| 設計 token | `rawSpacing` 76 → 61、`rawMotion` 28 → 23（見下節）。`outline: none` 剩 `Dialog.vue` 一處（程式聚焦的容器在滑鼠聚焦時不畫環，鍵盤仍走全域環），z-index 字面值改用 `--z-base ± 1`。 |
| 過期文件 | `docs/ux-overhaul/design-followups.md` 逐節核對後重寫：已完成的移除，本次做掉複數字串與 `.unread-badge` 命中區域，只留行高刻度、主程序兩個複數字串與 `themeEditor.issueSummary`。 |
| `agentStore.ts` 拆分 | 1,527 → 219 行，新增 `sessions`、`session-views`、`unread-alerts`、`desktop-preferences`、`quota`、`progression`、`pets`、`project-pets` 八個模組，每個檔頭寫明事件輸入、計時器、storage key、跨視窗同步。 |
| 大型元件拆分 | 見下表。 |
| 效能與複雜度 | 見下節。 |
| `PluginPanel.vue` style src | `@/` 在 `<style scoped src>` 可用（`StatusPanel.vue` 已這樣寫），已改為 `@/components/PluginPanel.css`；`src/**` 沒有其他相對路徑的 style src。 |

### 大檔行數

| 檔案 | 前 | 後 |
|---|---|---|
| `src/stores/agentStore.ts` | 1,527 | 219 |
| `src/composables/usePluginPanelController.ts` | 877 | 461 |
| `src/components/DesktopPet.vue` | 1,272 | 351 |
| `src/components/PetAnimation.vue` | 747 | 517 |
| `src/components/SetupWizard.vue` | 671 | 354 |
| `src/components/permission/PermissionBubble.vue` | 620 | 467 |

新增的子元件：`src/components/desktop-pet/`（`PetStatusLine`、`PetEdgePeekHandle`、`PetBubbleStack`）、`src/components/setup-wizard/`（`SetupWizardToolCard`、文案表）、`permission/PermissionQueueOverview.vue`。新增的 composable：`usePetStatusLines`、`usePetPluginBadges`、`usePetPointerInteractions`、`usePetReactions`、`usePetIdleMotion`、`usePetSpriteLoader`、`usePetCoachMark`、`useShimejiBehavior`、`useRealEventWait`、權限泡泡的鍵盤與點擊防護，以及插件面板的 `usePluginCatalog`、`usePluginInstalledList`、`usePluginPreferences`、`usePluginInstall`。

### Token 數字

- `rawSpacing` 76 → 61：設定精靈與專案 MCP 對話框共用的 `15px`／`22px` 外框，和三種清單卡片的 `15px` 上下內距收成 `--dialog-shell-gap`、`--dialog-shell-padding`、`--list-card-padding-y`。設定精靈的 `18px` 縮排（6 處）與 MCP 的 `26px` 縮排（2 處）改用元件自己的 custom property。這些都只是把同一個數字集中成一個來源，像素沒有變。剩下 61 筆都是 1／3／5／7／9px 的光學微調、負 margin，或 `Button`／`Select`／`TextField` 等元件刻度以外的單次內距。
- `rawMotion` 28 → 23：新增 `--duration-breathe`（3.8s，待機與離線呼吸）與 `--duration-glance`（0.42s，向左右看），兩者都已加進 reduced-motion 歸零；`pet-ghost-fade` 改用 `--transition-fast`。剩下 23 筆是只出現一次的 sprite 反應或裝飾 keyframe。
- 掃描器的分類已核對：`calc()`、`0`、百分比都沒有被誤算，所以 `scripts/check-design-tokens.mjs` 不用改。

### 效能與複雜度

| 位置 | 前 | 後 |
|---|---|---|
| 設定搜尋結果的分組標籤 | 每一列對分組與區段做巢狀 `find`，O(結果 × 分組 × 區段) | `SETTINGS_GROUP_BY_ID`／`GROUP_BY_SECTION` 兩個 Map，在 computed 裡一次算好 |
| `StatusPanel` 的 `countByBucket` | 每次更新掃兩次 sessions | 掃一次，兩處共用 |
| 歷史分頁的各 agent 占比與標題 | 每列呼叫兩次 | `agentRows` computed，每個 agent 只算一次 |
| 寵物狀態列的文字、aria、額度分級與百分比 | 模板每一條線呼叫多次 | 一個 computed 一次算好，模板只查表 |
| `permissionNoticeItems` | 每次複製整張 sessions Map 再 filter | 單趟掃描，只對等待中的幾筆排序 |
| `renamePet`／`removePet` | `pets.find`，O(P) | `petsById` Map，O(1) |
| 插件目錄的「有更新」篩選、全部更新與更新數 | 每次重掃目錄 | 共用 `updatableItems`／`updatableIds`（Set） |
| 資源上限欄位 | `resourceFields.find` | Map |
| `PluginHostTable` 每一列 | `includes`，O(h·(d+g)) | Set，O(h) |

`pnpm run check:bundle-size` 通過，renderer chunk 都在預算內。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm lint` | 通過 |
| `pnpm run check:design:strict` | 通過，`rawColors` 0、`unused` 0、`rawControls` 0 |
| `pnpm run check:contrast` | 通過 |
| `pnpm test:unit` | 1,556 個：1,553 通過、1 略過、2 失敗。失敗的兩個都在 `tests/agent-hook-delivery.test.mts`，屬於計時斷言，單獨重跑 8/8 通過。同一台機器上還有其他工作線在跑測試，負載高時會出現這種時序失敗。 |
| `tests/agent-store-characterization.test.mts` | 拆分前後都是 34/34 |
| `tests/plugin-panel-controller-characterization.test.mts` | 39/39 |
| IPC 清單測試（`ipc-*.test.mts`） | 包含在 `test:unit` 內，全部通過；本線沒有新增或修改 IPC 頻道 |
| `pnpm exec vite build`＋`pnpm run check:bundle-size` | 通過 |
| `git diff --check` | 通過 |

### 隔離 Electron 截圖比對

用 `node scripts/e2e-isolated-electron.mjs --offscreen` 同時啟動兩個隔離 App：基準 commit `38a75fa` 的建置與本分支的建置，各自使用獨立的埠、暫時 HOME 與假的 `safeStorage`。兩邊經由隔離事件埠送入相同的三個 session 事件，再用 CDP 的 `prefers-color-scheme` 模擬淺色與深色，以 `webContents.capturePage()` 截圖，並在 Electron 主程序內逐像素比較。

| 畫面 | 結果 |
|---|---|
| 設定 5 頁（一般、寵物、桌面、整合、插件）× 淺色／深色 | 10 張逐像素完全相同 |
| 面板的工作階段、額度、歷史分頁 × 淺色／深色 | 只有動畫頭像那一列（第 32–135 列）與相對時間文字不同。淺色歷史頁差異大，是因為基準版拍攝時資料還沒載入；深色那組兩邊都已載入，排版一致 |
| 寵物視窗 × 淺色／深色 | 狀態列、精靈、泡泡排版一致；差異來自兩個 App 的狀態不同（改動後那個 App 先前已多跑一輪事件，所以多了 ✓1 未讀徽章，OpenCode 顯示 Done） |
| 權限泡泡（兩筆佇列）× 淺色／深色，以及展開佇列 | 排版一致，只有倒數秒數不同 |
| 鍵盤 | 儀表板分頁與設定導覽的方向鍵、Home、End 在兩版都符合環繞規則，焦點跟著選取移動；`aria-controls` 的分布兩版相同 |

截圖過程中確認了一個既有行為，不是回歸：首次啟動精靈把面板撐到 680px 寬，關閉精靈後不會縮回。基準版同樣如此。

## 安全審查

- 沒有新增 IPC 頻道、preload 方法或主程序程式碼。renderer 的信任邊界不變。
- 新增或修改的程式碼沒有 `v-html`、`innerHTML`、`eval`、`new Function`、`window.open` 或 `openExternal`。
- `localStorage` 仍只經過 `readStored`／`writeStored`。
- 權限泡泡拆分後，允許與拒絕仍只送出 `decidePermission(requestId, decision)`。點擊防護（`usePermissionClickGuard`）與快捷鍵條件（`usePermissionKeyboard`）是原樣搬移，沒有放寬。
- 會提交的檔案已掃描過，沒有本機路徑、帳號、權杖或私鑰。

## 殘餘風險與未驗證

- **沒有實機比對的畫面**：edge-peek／迷你模式、多寵物模式下的泡泡錨點、`Transition`／`TransitionGroup` 對新子元件根節點的進出場動畫。這些只由單元測試與原始碼檢查涵蓋。
- **沒有手動走過插件安裝、更新、移除流程**，由控制器特性測試涵蓋。
- **畸形的權限單位**（例如 `skins:x`）現在顯示 0，原本顯示 x。manifest 驗證本來就會擋掉這種值。
- **權限佇列「全部拒絕」的 `.confirming` 樣式**：這條規則原本一直被按鈕規則蓋過，從未生效，本次刪除，維持現狀。確認狀態仍只靠文字提示。
- **單元測試的計時斷言**在多個工作線同時跑測試時偶爾失敗（`agent-hook-delivery`），屬於線 1 的測試。
- **仍待處理的設計項目**：見 `docs/ux-overhaul/design-followups.md`，包括行高刻度，以及主程序 `notificationAggregate`／`pluginCatalogAutoCheckFound` 的複數化。
- **macOS 以外的平台**沒有驗證。

## 範圍外修正

- 為了配合拆分或複數 key，有十多個 `tests/*.test.mts` 改為讀取新的檔案位置。斷言語意沒有削弱。`session-attention` 的計數從 2 變 1，因為單寵物與多寵物改成共用同一個 `PetStatusLine`。
- `tests/locale-domains.test.mts`、`tests/i18n.test.mts` 允許 zh-TW 只有 `.other`，並以去掉 `.one`／`.other` 後的基底 key 檢查是否被引用。
- 設定精靈的工具卡補上 `:focus-visible` 規則。拆成子元件後 scope id 改變，父層規則不再命中。
- 沒有修改 `electron/`、`integrations/`、`package.json`、`.github/` 或 `scripts/`。

## 版本建議

這是 renderer 內部的結構調整加上英文複數修正，沒有改公開契約或持久化格式，建議 patch。依整合輪安排，由總控統一升版。
