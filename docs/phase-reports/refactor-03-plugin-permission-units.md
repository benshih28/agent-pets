# 重構階段 3：Plugin 權限清單產生器

- **開始時間**：2026-11-10 10:52（Asia/Taipei）
- **完成時間**：2026-11-10 11:15（Asia/Taipei）
- **基準 commit**：`647960e`（分支 `claude/refactor-03-plugin-perms-f308d6`，版本 1.12.5）
- **背景**：[refactor-opportunities-2026-11-10.zh-TW.md](../architecture/refactor-opportunities-2026-11-10.zh-TW.md) 第 2 項；排程見 3.1 節

## 範圍

1. 主行程 `electron/plugin-registry.ts` 的 `permissionUnits()`（安裝計畫的 `addedPermissions`、`requiresReconsent`，以及安裝後寫入 `registry.json` 的 `grantedPermissions.units`）與 renderer `src/utils/plugin-permissions.ts` 的 `permissionUnitsOfPlan()`（安裝／更新畫面的權限清單）各自列舉 network、links、storage、agentStatus、schedule、secrets 與各種 contribution。抽出一份不依賴 Electron／Vue 的共用純函式，兩邊改用。
2. 保留兩邊不同的輸出形狀：main 去重並排序（`[...new Set()].sort()`），renderer 依畫面顯示順序、不去重。
3. 評估 capability 標籤與文案（`parsePermissionUnit()` 的 `KNOWN_CONTRIBUTIONS`、面板控制器的 `permissionLabel()`／`permissionHint()`）能否由 `PLUGIN_CONTRIBUTION_REGISTRY` 推導，結論寫在本記錄。

不在範圍：`plugin-manifest.ts` 的 manifest 驗證、`plugin-catalog-updates.ts` 的 `comparePluginPermissionUnits()`、`installAcknowledgementReasons()` 的重新同意判定邏輯（只用測試確認不變）。

## 驗收條件

1. 先以測試固定現有輸出：main 對每種權限與 contribution 的單位字串、排序與去重；renderer 的單位字串與顯示順序。測試在未修改的程式上先通過，抽取後不改期望值仍通過。
2. 兩邊從同一個函式產生單位；新增 contribution 時若沒有決定它的權限單位，型別檢查失敗。
3. main 仍是授權權威：`addedPermissions`、`requiresReconsent`、`grantedPermissions.units` 與更新目錄的權限增加判定不變；UI metadata 不參與任何安全決策。
4. `vue-tsc --noEmit`、`vite build`、`test:unit`（不新增失敗，與基準清單比對）、`git diff --check` 通過。
5. 以 Electron 實機（或 DOM 文字）確認插件安裝／更新畫面的權限清單與改前一致；不把視窗帶到前景。

## 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 盤點範圍、建立記錄、基準測試清單 | 通過 | 基準 `test:unit`（`647960e`）：1307 項，1275 過、9 失敗、23 skip（8 個已知 + 偶發的「with the pet closed…」） |
| 2 | 以測試固定 main 與 renderer 的現有輸出 | 通過 | 新增 `tests/plugin-permission-units.test.mts` 18 項，在只加上 `export` 的原始邏輯上全過 |
| 3 | 抽出共用純函式，main 與 renderer 改用 | 通過 | `src/utils/plugin-permission-units.ts`；步驟 2 的 18 項不改期望值仍全過，相關 7 個測試檔 54 項（1 skip）全過，`vue-tsc` 通過 |
| 4 | 評估 capability 標籤與文案推導 | 通過 | 結論：不從 `PLUGIN_CONTRIBUTION_REGISTRY` 推導，見「標籤與文案推導評估」；改以測試固定分組／風險並要求 fixture 涵蓋 registry 每個 contribution |
| 5 | Code review、phase gates 與安全審查 | 通過 | 見「驗證證據」「安全審查」「Code review 紀錄」 |
| 6 | Electron 實機／DOM 驗證 | 通過 | 改前／改後兩個 build 跑同一組安裝與更新流程，DOM 擷取結果逐字相同；見「Electron 實機驗證」。本步驟開始時狀態表沒有即時改為「進行中」，是驗證跑完後才補改，特此註記 |
| 7 | 收尾記錄、commit | 通過 | commit 於分支 `claude/refactor-03-plugin-perms-f308d6` |

## 盤點結果

| 位置 | 用途 | 改前 |
|---|---|---|
| `electron/plugin-registry.ts` `permissionUnits()` | `planInstall()` 的 `addedPermissions`／`requiresReconsent`；`install()` 寫入 `grantedPermissions.units` | 自己列舉；`Object.entries(permissions)` 逐鍵處理，其他為 `true` 的鍵自成單位；`Set` 去重後 `sort()` |
| `src/utils/plugin-permissions.ts` `permissionUnitsOfPlan()` | 安裝畫面「此插件要求的權限」與更新畫面折疊的「既有權限」 | 自己列舉；固定顯示順序、不去重，只認得已知的鍵 |
| `src/composables/usePluginPanelController.ts` | 更新畫面以 `plan.addedPermissions`（main 的排序結果）列「新增權限」，以 `permissionUnitsOfPlan()` 扣掉新增者列「既有權限」 | 未修改 |
| `electron/plugin-catalog-updates.ts` `comparePluginPermissionUnits()` | 比較已授權與要求的單位字串集合 | 未修改；`requestedUnits` 目前沒有呼叫端傳入，目錄更新的 `permissionsIncreased` 固定為 `null` |

只有前兩處在組裝單位。`settings` contribution 兩邊都不產生單位（設定欄位本身不是新能力，密鑰另由 `permissions.secrets` 授權）。

## 設計摘要

- 新增 `src/utils/plugin-permission-units.ts`（不依賴 Electron／Vue；主行程與 Node 測試直接載入，執行期只有相對路徑的型別匯入）：
  - `permissionUnitsInDisplayOrder(source)`：權限依 network → links → storage → agentStatus → schedule → secrets，其他鍵依 manifest 順序接在後面；再依 `CONTRIBUTION_PERMISSION_UNITS` 的鍵順序列 contribution。不去重。
  - `grantedPermissionUnits(source)`：`[...new Set(permissionUnitsInDisplayOrder(source))].sort()`，與原本 main 的 `Set` + `sort()` 相同（字串排序與插入順序無關）。
  - `CONTRIBUTION_PERMISSION_UNITS` 的型別是 `{ readonly [K in PluginContributionId]: (value: PluginContributionValueMap[K]) => readonly string[] }`：`PLUGIN_CONTRIBUTION_REGISTRY` 新增 contribution 而這裡沒補，`vue-tsc` 直接失敗。只有 truthy 的 contribution 會呼叫對應函式，與原本兩邊的 `if (contributes.x)` 判斷相同。
  - 逐鍵規則沿用 main：`network`／`links` 是帶 `hosts` 的物件才展開（`network.userGranted` 為 truthy 時加 `network:userGranted`），`secrets` 是陣列才展開，`schedule` 為 truthy 就是 `schedule`，其他鍵只有值為 `true` 時才自成單位。
- `electron/plugin-registry.ts`：刪除 `permissionUnits()`，兩處呼叫改用 `grantedPermissionUnits(manifest)`。`addedPermissions`、`requiresReconsent`、`grantedPermissions` 的讀寫與比較程式一行未改。
- `src/utils/plugin-permissions.ts`：`permissionUnitsOfPlan()` 改為呼叫 `permissionUnitsInDisplayOrder()`，簽名不變；`parsePermissionUnit()`、`groupPermissionUnits()`、`installAcknowledgementReasons()` 未修改。

### 畫面端對不可達輸入的差異

畫面收到的 `plan.permissions` 一律是 main 經 `parsePluginManifest()` 驗證後的 manifest，所以下列形狀實際到不了畫面；只有共用規則跟著 main 的保守寫法：

| 輸入（manifest 驗證會拒絕） | 改前畫面 | 改後畫面（= main 一直以來的授權單位） |
|---|---|---|
| 未知的權限鍵為 `true`（例如 `teleport: true`） | 略過 | 列為 `teleport`，顯示成高風險的「未知權限」 |
| `network: true`、`links: true`、`secrets: true` | 略過 | 列為 `network`／`links`／`secrets` |
| `network: { userGranted: true }` 沒有 `hosts` | 顯示 `network:userGranted` | 不顯示（main 也不授權這個單位） |

這些差異只會讓畫面與 main 的授權清單更一致；main 的輸出對任何輸入都與改前相同（有測試固定未知鍵與 `network: true` 的情況）。

## 標籤與文案推導評估

**結論：不從 `PLUGIN_CONTRIBUTION_REGISTRY` 推導，本階段不改標籤、說明文字與風險分級。**

1. `PLUGIN_CONTRIBUTION_REGISTRY`（`src/types/plugin.ts`）是 main 驗證 manifest 用的表：`parsePluginManifest()` 以它的鍵當作 `contributes` 白名單，`allowsWorkerlessPlugin` 決定能否沒有 entry。把風險等級、i18n key 放進去，等於讓主行程的安全表帶著 UI metadata，與「共用的 UI metadata 不得影響安全決策」相反。
2. 它只涵蓋 contribution；畫面另外要處理 network、links、storage、agentStatus、schedule、secrets 與 `network:userGranted`，這些不屬於 contribution，仍需第二張表。
3. 一個 contribution 不一定對應一個單位與一個風險：`panelThemes` 產生 `contributes:panelThemes:<n>`（低）與 `contributes:panelThemeFonts`（中）；`skins`／`panelThemes` 帶數量；`settings` 不產生單位。
4. `parsePermissionUnit()` 的分組／風險與 `known` 旗標會決定「未知權限一律高風險」這條保守規則，`permissionLabel()`／`permissionHint()` 各是一串 if。這些適合改成畫面端以單位類別為鍵的查表，但面板控制器的拆分排在階段 10（第 4 項），在那裡一起做比較不會重複改同一個檔。

替代的防護（本階段已做）：`tests/plugin-permission-units.test.mts` 以 1.12.5 輸出固定完整 fixture 的分組、風險與 `known`，並要求 fixture 的 `contributes` 鍵與 `PLUGIN_CONTRIBUTION_REGISTRY` 完全相同。新增 contribution 時，型別檢查要求決定它的單位，這個測試要求同時決定它在畫面上的分級。

## Electron 實機驗證（Windows 11，隔離 HOME，螢幕外）

做法：把改後的 `vite build` 複製到 `node_modules/.cache/e2e-apps/after`；暫時把兩個修改過的原始檔換回 `647960e` 的版本建置、複製到 `…/base`，再換回並重建（重建結果與 `after` 逐檔相同）。兩份都用 `scripts/e2e-isolated-electron.mjs --offscreen --app-root <copy> --hook-port-base 28573`（CDP 9358、main inspector 9359）啟動，以同一個 CDP 腳本操作：

1. 設定頁切到「插件」，把 `perm-e2e-1.0.0.agentpet-plugin` 排進 `dialogQueue`，按「安裝插件…」，擷取安裝畫面每個權限群組的標題、風險與每列的 class 與文字，按「同意並安裝」。
2. 讀隔離 userData 的 `plugins/registry.json` 的 `grantedPermissions`。
3. 排入 `perm-e2e-2.0.0.agentpet-plugin`（新增 `upload.example.com`、`network:userGranted`、`links`、`secrets`、`agentStatus`、`reaction`、`eventSource`），擷取更新畫面的「新增權限」、折疊的「既有權限（8）」、確認原因與勾選框。

兩個插件檔都先以 `parsePluginManifest()` 驗證為合法 manifest。

| 項目 | 改前（`647960e`） | 改後 |
|---|---|---|
| 安裝畫面 | 網路（高）2 列、資料（中）2 列、顯示（低）4 列 | 相同 |
| `grantedPermissions.units` | `contributes:badge`、`contributes:commands`、`contributes:feed`、`contributes:tray`、`network:api.example.com`、`network:cdn.example.com`、`schedule`、`storage` | 相同 |
| 更新畫面「新增權限」 | 網路（高）3 列、資料（高）2 列、顯示（低）2 列，皆帶「+」 | 相同 |
| 更新畫面「既有權限（8）」 | 與安裝畫面同順序的 8 列 | 相同 |
| 確認原因／勾選框 | 「此更新新增了網路或外部連結權限。」「此更新新增了密鑰讀取權限。」／有勾選框 | 相同 |

兩次擷取的 JSON（扣掉 app 路徑與啟動日誌）以字串比較完全相同。兩次結束時所有視窗 `focused: false`；可見的寵物視窗在 x ≈ -18750（螢幕外），另一個是未顯示（`visible: false`）的面板視窗。

過程中的偏差：第三次除錯執行時，腳本在 `dialogQueue` 還是空的時候按了「安裝插件…」（非開發者模式下這顆按鈕直接開檔案對話框），隔離 app 因此可能開出一個原生檔案對話框約 10 秒，直到腳本逾時並結束 app。之後改為每次點擊前先排入路徑，正式比對的兩次執行都沒有開出原生對話框。每次執行結束都刪除本次的隔離暫存目錄；量測腳本與插件檔放在 session scratchpad，`node_modules/.cache/e2e-apps` 不在版本控制內。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| 特徵化測試（改前） | `tests/plugin-permission-units.test.mts` 18 項，在只把 `permissionUnits` 加上 `export` 的原始邏輯上全過；分組／風險與 registry 覆蓋 2 項，另以 `647960e` 的 `plugin-permissions.ts` 副本執行全過 |
| 特徵化測試（改後） | 同一批期望值不改，20 項全過（只把 main 的匯入改為共用模組） |
| 相關測試檔 | `plugin-permission-units`、`plugin-permissions`、`plugin-registry`、`panel-theme-plugin-integration`、`plugin-catalog-updates`、`ipc-plugin-install`、`plugin-developer-mode`：54 項過、1 skip（Windows symlink，基準即 skip） |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build` | 通過 |
| `pnpm.cmd run test:unit` | 1327 項：1294 過、10 失敗、23 skip（基準 1307 項：1275 過、9 失敗）。9 個基準失敗都還在；多出的「a starting app that never opens its port holds the hook for a bounded time only」（`agent-hook-delivery`，計時測試）單獨重跑兩次都通過，該檔與它測的程式本階段都沒有修改，判定為整批執行時的負載偶發 |
| `git diff --check` | 通過 |

## 安全審查

- **安裝授權**：`grantedPermissions.units` 仍由 main 在 `install()` 以同一份 manifest 計算；端對端測試確認寫入 `registry.json` 的字串與順序，實機改前改後相同。
- **更新差異**：`addedPermissions = requested.filter(unit => !granted.includes(unit))` 未修改；測試覆蓋權限相同（hosts 順序不同）不需重新同意、權限增加需要重新同意且未同意時 `install()` 回 `permission_reconsent_required`、權限減少不需重新同意。
- **重新同意**：`requiresReconsent = Boolean(existing && addedPermissions.length > 0)` 與 `installAcknowledgementReasons()` 未修改；實機的確認原因與勾選框改前改後相同。
- **保守規則**：main「其他為 true 的權限鍵自成單位」的行為保留並有測試；畫面端沒有任何邏輯會減少 main 的授權單位，畫面的分組與風險不回傳給 main。
- **未改**：manifest 驗證、簽章判定、IPC channel 與 payload、`comparePluginPermissionUnits()`。沒有新增檔案系統、網路或憑證相關程式。

## Code review 紀錄

- 新語法：contribution 單位表用窮舉的映射型別標註（而非 `satisfies`），讓泛型函式能直接呼叫 `CONTRIBUTION_PERMISSION_UNITS[id](value)`；型別守衛 `hasHosts()` 取代原本 main 的兩次 `as { hosts: string[] }`；`??`、`Map` 查表取代 if 鏈。唯一保留的 `as` 是 `Object.keys(CONTRIBUTION_PERMISSION_UNITS) as PluginContributionId[]`，註解說明為何安全（映射型別保證鍵集合）。
- 效能：顯示順序用 `Map` 查排名，只排序 manifest 的權限鍵（最多 6 個）；main 仍只有一次 `Set` 與一次 `sort()`，與改前同級。沒有 I/O。
- 風格：被 main 與 Node 測試載入的新檔只用相對路徑匯入；註解為繁體中文、只寫原因。`project-map.md` 補上權限單位產生器的位置與界線。沒有使用者可見文字變更，不涉及 i18n。
- 自行修正：實機腳本第一次以「最後一顆按鈕」點確認，按鈕仍在 busy 而逾時；改為等「同意並安裝」可按後再點（只影響驗證腳本）。

## 殘餘風險

1. **macOS／Linux 未實測**：只在 Windows 11 驗證。共用模組是純函式，不涉及平台差異，風險低。
2. **實機未涵蓋 skins／panelThemes**：這兩種 contribution 需要合法圖片或字型檔，實機流程沒有打包；單位字串、數量後綴與 `panelThemeFonts` 由單元測試與既有的 `panel-theme-plugin-integration` 端對端測試（經 `PluginRegistry`）固定。
3. **標籤與風險仍是 if 鏈**：新增 contribution 時，型別檢查與測試會要求決定單位與分級，但 `permissionLabel()`／`permissionHint()` 漏寫時只會顯示「未知權限」（保守方向），沒有編譯期檢查。建議在階段 10 改為查表。
4. 本機 8 個既有失敗測試與偶發計時測試不在本階段處理。

## 版本建議

本階段單獨看屬於 **patch**：純內部重構，授權單位字串、排序、持久化格式、IPC 與畫面都不變。依整體排程，全部階段完成後統一升 **minor**，本階段不改版號。

## 檔案變更狀態

| 路徑 | 類型 | 目的 |
|---|---|---|
| `docs/phase-reports/refactor-03-plugin-permission-units.md` | 新增 | 本階段記錄 |
| `src/utils/plugin-permission-units.ts` | 新增 | 權限單位唯一產生器：`permissionUnitsInDisplayOrder()`、`grantedPermissionUnits()`、窮舉的 contribution 單位表 |
| `electron/plugin-registry.ts` | 修改 | 刪除 `permissionUnits()`，安裝計畫與安裝紀錄改用 `grantedPermissionUnits()` |
| `src/utils/plugin-permissions.ts` | 修改 | `permissionUnitsOfPlan()` 改用共用產生器；更新註解 |
| `tests/plugin-permission-units.test.mts` | 新增 | 固定 main／畫面的單位字串、順序、去重、保守規則、分組風險、registry 覆蓋，以及安裝授權、更新差異與重新同意 |
| `.agents/skills/pet-skill/references/project-map.md` | 修改 | 記錄權限單位產生器的位置與安全界線 |
