# Renderer localStorage key registry

renderer 存在 localStorage 的每個 key 都寫在 `src/utils/storage-keys.ts` 的 `STORAGE_KEYS`，讀寫一律經過 `src/utils/local-storage.ts`。表用 `as const satisfies Record<string, StorageKeyDefinition<…>>` 檢查形狀，並以 `deepFreeze`（`src/types/freeze.ts`）凍結。`src/` 內不要再直接呼叫 `localStorage`，也不要再寫 key 字面值。

這裡只放單一使用者的介面偏好與快取。需要可靠持久化、跨裝置或主程序要讀的資料（XP、成就、桌面偏好、視窗位置）由主程序寫進 `userData`，不放這裡。

## 每一列的欄位

| 欄位 | 意義 |
|---|---|
| `key` | localStorage 的 key 字串。**是既有資料的位置，不能改名。** |
| `parse(raw)` | 把原始字串（缺值時是 `null`）轉成值；缺值與無效值的回退都寫在這裡，不可丟例外。 |
| `serialize(value)` | 寫入時的字串格式。 |
| `fallback` | storage 不存在或讀取丟例外時的值；沒有指定時等於 `parse(null)`。只有 `coachSeen` 不同（讀不到時當作已看過，避免每次啟動都跳出引導）。 |
| `sync` | 其他視窗寫入時，本視窗是否接收（見「跨視窗同步」）。 |

`DEFAULT_PET_ID`（`aang-airbender`）、`MOOD_BASELINE`（10）與 `MOOD_SYSTEM_VERSION`（`'2'`）也在這個檔案，store 從這裡 import。

## Key 清單

| 名稱 | key | 值 | 缺值／無效值 | 同步 |
|---|---|---|---|---|
| `petId` | `agent-pet-id` | 寵物 id | 空字串也回 `aang-airbender` | ✓ |
| `petScale` | `agent-pet-scale` | 數字 | `parseFloat`，缺值 1（無效字串會得到 `NaN`，照舊） | ✓ |
| `hiddenBuiltinPets` | `agent-pet-hidden` | 隱藏的內建寵物 id（JSON 陣列） | 非陣列或壞 JSON → `[]`；非字串元素丟掉 | |
| `familyPetIds` | `agent-pet-family-map` | 家族 → 寵物 id（JSON 物件） | 只收 `isAgentFamilyKey` 的 key 與字串值；其他 → `{}` | ✓ |
| `multiPet` | `agent-pet-multi` | `'1'`／`'0'` | 只有 `'1'` 算開 | ✓ |
| `mood` | `agent-pet-mood` | 數字 | `parseFloat`，缺值 10；啟動時由 store clamp，同步時不 clamp（照舊） | ✓ |
| `moodDate` | `agent-pet-mood-date` | 本機日期 `YYYY-M-D` | 原樣（`null` 表示沒有） | |
| `moodVersion` | `agent-pet-mood-version` | 心情系統版本 | 原樣；不等於 `MOOD_SYSTEM_VERSION` 時啟動會重設心情（migration） | |
| `moodVisuals` | `agent-pet-mood-visuals` | `'1'`／`'0'` | 只有 `'0'` 算關 | ✓ |
| `patCount` | `agent-pet-pat` | `日期:次數` | 次數 `Number(…) \|\| 0`；日期不是今天就從 0 算 | |
| `sound` | `agent-pet-sound` | `'1'`／`'0'` | 只有 `'1'` 算開（主程序偏好送到前的快取） | ✓ |
| `reactions` | `agent-pet-fx` | `'1'`／`'0'` | 只有 `'0'` 算關 | ✓ |
| `bubble` | `agent-pet-bubble` | `'1'`／`'0'` | 只有 `'0'` 算關 | ✓ |
| `ambient` | `agent-pet-ambient` | `'1'`／`'0'` | 只有 `'1'` 算開；**啟動時**沒有存值則看舊的 `agent-pet-fx` 是否為 `'1'`（`readPetFeedbackDefaults`） | ✓ |
| `activityBubble` | `agent-pet-activity` | `'1'`／`'0'` | 同上，啟動時看舊的 `agent-pet-bubble` | ✓ |
| `locale` | `agent-pet-locale` | `AppLocale` | 不支援的值 → `zh-TW` | ✓ |
| `theme` | `agent-pet-theme` | `ThemePreference` | → `system` | ✓ |
| `petTheme` | `agent-pet-pet-theme` | `PetThemePreference` | → `dark` | ✓ |
| `coachSeen` | `agent-pet-coach-v1` | `'1'` | 只有 `'1'` 算看過；storage 讀不到時當作看過 | |
| `achievementsSeenAt` | `agent-pet-achievements-seen-at` | 毫秒時間戳 | `Number(…) \|\| 0` | |
| `historyRange` | `agent-pet-history-range` | 7／30／90 | 其他 → 7 | |
| `historyCollapsed` | `agent-pet-history-collapsed` | 區塊 → 是否收合（JSON） | 壞 JSON → `{}`；不檢查形狀（照舊） | |
| `historyIntroDismissed` | `agent-pet-history-intro-dismissed` | `'1'` | 只有 `'1'` 算關閉 | |
| `historyView` | `agent-pet-history-view` | `overview`／`sessions` | 其他 → `overview` | |
| `dashboardTab` | `agent-pets-dashboard-tab` | 內建分頁或 `plugin:<id>` | `parseStoredDashboardTab`；無效 → `null`（不還原） | |
| `settingsGroup` | `agent-pets-settings-group` | `SettingsGroupId` | → `general` | |

最後兩個 key 的前綴是 `agent-pets-`（複數），是既有資料，不能統一改名。

解析規則逐一照搬自 `940a00b` 的各呼叫點，所以同樣是 `'1'`／`'0'` 旗標，有的只認 `'1'`、有的只有 `'0'` 算關，這是刻意保留的差異：預設關的開關只認 `'1'`，預設開的開關只有 `'0'` 算關。`tests/storage-keys.test.mts` 把舊運算式逐字抄成 oracle，對 50 多個樣本值逐一比對。

## 讀寫 helper

- `readStored(entry)`：storage 不存在（Node 測試）、讀取屬性或 `getItem` 丟例外（隱私模式、storage 被停用）時回 `fallback`。
- `writeStored(entry, value)`：成功回 `true`；失敗（含配額已滿）回 `false`，不丟例外。呼叫端照常更新自己的狀態，所以 storage 停用時設定在本次執行中仍然有效，只是不會留到下次啟動。
- `safeStorageReader`：給需要多個 key 原始值的遷移規則（`readPetFeedbackDefaults`）；讀取失敗當作沒有存值。

改前 `agentStore` 的讀寫沒有 try/catch：storage 被停用時 store 初始化會丟例外，寵物與面板都起不來；寫入失敗也會中斷後續動作（例如 `setPet` 不再同步 XP 寵物）。現在兩者都不會發生。

## 跨視窗同步

寵物與面板是兩個同源視窗，各有一份 Pinia store、共用一份 localStorage。一邊寫入時，瀏覽器會在**其他**同源視窗觸發 `storage` 事件，所以不需要 IPC。

- `syncOn(entry, handler)` 只接受 `sync: true` 的列（型別檢查），`handler(value, raw)` 收到 registry 解析後的值與原始的 `newValue`。
- `listenStorageSync(bindings)` 只註冊一個 `storage` 監聽器，依 key 以 `Map` 分派（O(1)）；同一個 key 綁兩次會丟錯。`localStorage.clear()` 送出的 `key: null` 事件不處理（與改前相同）。回傳移除監聽器的函式。

誰監聽哪些 key：

| 位置 | key | 更新 |
|---|---|---|
| `src/App.vue`（兩個視窗都掛） | `petScale`、`petId`、`mood`、`locale` | 只在新值非空時更新（key 被移除時不動）；`petId` 先 `loadPets()` 再設定並同步 XP 寵物 |
| | `familyPetIds`、`sound`、`multiPet`、`reactions`、`bubble`、`ambient`、`activityBubble`、`moodVisuals` | 直接套用解析後的值（key 被移除時回到 `parse(null)`） |
| `src/composables/useTheme.ts` | `theme`、`petTheme` | 任一個變了就重讀兩個偏好並套用 |

`sync: true` 的列必須正好是上面這 14 個 key；`tests/storage-keys.test.mts` 固定這份清單。

## 新增一個 key

1. 在 `STORAGE_KEYS` 補一列（放進對應的分組），決定 `parse`／`serialize`，需要時指定 `fallback`。
2. 在 `tests/storage-keys.test.mts` 的 `EXPECTED_KEYS` 與 `LEGACY_PARSE` 補一列；要同步就同時加進 `EXPECTED_SYNCED`，並在需要的視窗用 `syncOn` 綁定。
3. 確認新 key 不會跟既有 key 撞名（測試會檢查重複）。

改名或刪除既有 key 等於清掉使用者的設定：先在 phase report 寫好遷移方式（讀舊 key、寫新 key），再更新測試的期望值。

`src/utils/storage-keys.ts` 與 `local-storage.ts` 會被 Node 測試直接載入（經 `src/i18n.ts`、`useTheme.ts`、`pet-defaults.ts`），所以執行期 import 只用相對路徑（見 agent-pets-conventions §1）。主題的值域與型別因此搬到沒有 import 的 `src/types/theme.ts`，`useTheme.ts` 轉出原名稱。
