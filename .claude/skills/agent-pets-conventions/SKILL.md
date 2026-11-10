---
name: agent-pets-conventions
description: Use for agent-pets project coding conventions and refactor planning. Covers import path rules (@/ alias), script/comment organization, i18n JSON extraction, if-else → switch/lookup-table rewrite guidance, shared function/component extraction, performance optimization, scoped CSS extraction, and build-speed tuning. Load this before editing any src/**/*.vue, src/**/*.ts, or electron/**/*.ts file, or when planning a refactor of this repo.
---

# Skill — Agent Pets 程式碼慣例與重構規劃

## 0. 核心規則（先讀這裡）

| # | 規則 | 詳見 |
|---|------|------|
| 1 | `src/**` 內的跨目錄 import 一律用 `@/`，禁止 `../` | §1 |
| 2 | 註解只寫「為什麼」，不寫「做什麼」；無資訊量的註解直接刪除 | §2 |
| 3 | i18n 文案拆到 `src/locales/*.json`，`i18n.ts` 只留邏輯 | §3 |
| 4 | 三層以上 `if/else if` 或字串比對鏈，改用 `switch` 或物件查表 | §4 |
| 5 | `<script setup>` 內部區塊順序固定（imports → props/emits → state → computed → functions → lifecycle → watch） | §5 |
| 6 | 完成一個檔案/功能後才跑 `pnpm run build`（跑 `vue-tsc --noEmit`）驗證型別 | §6 |
| 7 | 兩個以上元件出現相同邏輯/樣式，抽成共用 util 或元件，不重複貼 | §7 |
| 8 | 效能優化只在有量測依據時做，且每一步都要有回歸測試保底 | §8 |
| 9 | 超過 ~150 行的 `<style scoped>` 抽成獨立 `.css`／`.scss` 並用 `@import`／`<style scoped src="...">` 引入 | §9 |
| 10 | Build 慢的瓶頸要先量測（`vue-tsc` vs `vite build` vs `electron-builder`），不要憑感覺調 | §10 |

**此專案只用 pnpm，禁止 npm。**（既有規則，見使用者記憶）

---

## 1. Import 路徑規則

### 現況（2026-08-14 更新）
`tsconfig.json` 與 `vite.config.mts` 都已設定 `@/* → ./src/*`。此規則已在本輪重構中全面套用：`src/**` 內除了下方「重要例外」列出的測試會直接執行的檔案，其餘所有相對路徑（含同層 `./xxx`）都已改成 `@/`。

### 規則
```typescript
// ❌ 不要
import { useAgentStore } from '../stores/agentStore'
import { SOURCE_LABELS } from '../types/agent'
import PetAnimation from './PetAnimation.vue'

// ✅ 要
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_LABELS } from '@/types/agent'
import PetAnimation from '@/components/PetAnimation.vue'
```

- **所有** `src/**` 內的相對路徑 import（無論 `../`、`../../`，還是同層/子目錄的 `./xxx`）一律改 `@/`，包含 CSS 的 `<style scoped src="...">` 與 `main.ts` 的 side-effect import（`import '@/styles/tokens.css'`）。沒有「同層可以維持相對路徑」的例外——一致性優先於少打幾個字。
- `electron/**` 目錄是扁平結構（全部檔案同層，沒有子目錄巢狀），彼此都是 `./xxx`，不受此規則影響、不需要改。`electron/` 不會走 `@/` 別名（該別名只註冊給 `src`），若未來 electron 需要引用 `src` 內的共用型別，才需要另外設定 alias。

### 重要例外：測試會直接用 Node 執行、不經過 Vite 打包的檔案，必須維持相對路徑
`tests/*.test.mts` 用 `node --experimental-strip-types` 直接執行，**沒有 bundler**，所以完全不認得 `@/` 這個 tsconfig path alias（`@/` 只有 Vite／`vue-tsc` 認得）。以下檔案會被測試直接或間接 import，若改成 `@/` 會讓 `pnpm run test:unit` 直接噴 `ERR_MODULE_NOT_FOUND`：

- `src/i18n.ts`（含它自己 import 的 `src/locales/*.json`）
- `src/types/locale.ts`
- `src/types/achievement.ts`
- `src/types/agent.ts`
- `src/types/agent-adapter.ts`
- `src/types/capabilities.ts`
- `src/types/progression.ts`
- `src/utils/desktop-effects.ts`
- `src/utils/agent-state-presentation.ts`（狀態呈現 registry；執行期只相對匯入 `src/types/agent.ts` 與 `src/types/freeze.ts`，`@/` 只用在 `import type`，Node 執行時會整段拿掉）
- `src/utils/toast-countdown.ts`
- `src/types/pet-atlas.ts`（sprite 圖集規格；主程序也直接 import）。會被測試執行、又對它做值 import 的 `src/utils/pet-motion-plan.ts`、`src/utils/pet-atlas-preview.ts`、`src/utils/status-line-fit.ts` 也必須用相對路徑；只做 `import type` 的檔案不受影響（型別會被 strip 掉）
- `src/types/freeze.ts`（registry 共用的 `deepFreeze`；`agent.ts`、`sound.ts`、`agent-state-presentation.ts` 都用相對路徑值 import 它，所以檔內不能有任何 import）
- `src/types/sound.ts`（音效 registry；主程序 `electron/desktop-preferences.ts` 也直接 import，所以檔內唯一的執行期 import 是相對路徑的 `./freeze.ts`）。對它做值 import 的 `src/utils/sound.ts`（`tests/sound-registry.test.mts` 用假的 AudioContext 動態 import）與 `src/utils/sound-policy.ts` 也必須用相對路徑

這份清單只列跟 registry 相關、最容易改錯的檔案，不是完整閉包。2026-11-10 實算：測試在執行期載入的 src `.ts` 檔有 85 個，其中 24 個自己又值 import 其他 src 檔案（除了上面幾個，還有 `src/types/ipc.ts`、`src/types/plugin*.ts`、`src/utils/panel-theme-*.ts` 等），目前全部都是相對路徑。

閉包內的規則：執行期 import 只能用相對路徑；`@/` 只能出現在 `import type`。新檔案被某個 `tests/*.test.mts` 直接或動態 import 時，它跟它遞移值 import 的所有 src 檔案都要遵守這條；否則要另外幫 Node 測試執行環境接上 `@/` 的 resolver（例如自訂 loader），目前專案沒有做這件事。`pnpm run test:unit` 出現 `ERR_MODULE_NOT_FOUND` 通常就是閉包裡有人用了 `@/`。

### Import 排序（沿用一般慣例）
```typescript
// 1. 第三方套件（vue、electron 等）
import { ref, computed } from 'vue'

// 2. @/ 絕對路徑（stores → types → components → utils）
import { useAgentStore } from '@/stores/agentStore'
import type { AchievementUnlock } from '@/types/achievement'

// 3. 同層相對路徑
import PetAnimation from './PetAnimation.vue'
```

---

## 2. 註解規則

### 現況
專案內大部分的既有註解其實是有價值的「為什麼」型註解（例如 `DesktopPet.vue:16-17`、`:97-100` 解釋動畫節流的原因），**不要把這些刪掉**。問題出在新增程式碼時容易補上「做什麼」型的贅字註解，或是複製貼上舊邏輯時忘記更新的過期註解。

### 規則
- **保留**：解釋隱藏限制、非顯而易見的 workaround、容易被誤改的 invariant。
  ```typescript
  // ✅ 保留：解釋「為什麼」用 class toggle 而非 CSS transition
  // A quota drop is the pet "taking damage" — flash the meter for a moment so
  // a change that happened while you weren't looking still registers. Driven
  // by a class toggle (not a CSS transition) so consecutive drops re-run the
  // animation from the start instead of being swallowed mid-flight.
  ```
- **刪除**：只是把程式碼翻譯成中文的註解。
  ```typescript
  // ❌ 刪除：變數/函式名稱已經說明了「做什麼」
  // 設定 loading 為 true
  loading.value = true
  ```
- **檢查標準**：拿掉這行註解，下一個讀者會不會困惑？會才留。
- 新增註解一律繁體中文（沿用 `devtools-conventions` 慣例，讓專案風格一致）。

---

## 3. i18n 拆分為 JSON

### 現況
`src/i18n.ts`（637 行）把繁中 `messages`、英文 `englishMessages` 兩份近 300 個 key 的字典直接寫死在 `.ts` 檔案裡，外加一份 `translateBackendError` 的錯誤訊息對照表。新增一個語系 = 複製整個物件、風險是兩份 key 對不齊卻沒有型別檢查會抓到（目前用 `Record<TranslationKey, string>` 強制英文版對齊，繁中版本身沒有這層檢查）。

### 目標結構
```
src/locales/
  zh-TW.json       ← 對應現有 messages
  en-US.json       ← 對應現有 englishMessages
  errors.zh-TW.json ← 對應 translateBackendError 的 exact 表
src/i18n.ts         ← 只留 t()/setLocale()/translateBackendError() 邏輯，import JSON
```

### 規則
- `resolveJsonModule` 已在 `tsconfig.json` 開啟，可直接 `import zhTW from '@/locales/zh-TW.json'`。
- 兩份語系檔案的 key 集合必須一致；用 `Record<TranslationKey, string>` 型別註記 **兩個** import（不只英文版）以強制編譯期檢查對齊。
- 新增字串：兩個 JSON 都要加，不新增第三個語系前不用建立額外抽象（避免過度設計 i18n 框架）。
- `translateBackendError` 裡的 `exact` 對照表資料量大且是純資料，適合抽成 `errors.zh-TW.json`；`startsWith(...)` 那幾條前綴比對是邏輯，留在 `i18n.ts`。
- 不要引入 vue-i18n 或其他套件——現有的 `t(key, params)` 函式介面已經夠用，純粹是把資料搬出程式碼檔案，不是換架構。

---

## 4. if-else 鏈 → switch / 查表重構

### 現況
`electron/main.ts` 有 3 處多層 `else if`；`src` 內僅 2 處使用 `switch`（`PetAnimation.vue`、`utils/sound.ts`），代表其餘条件分支幾乎都是 `if/else if` 鏈或三元運算巢狀（例如 `DesktopPet.vue:29-37` 的 `quotaColor()` 就是巢狀三元，可讀性差）。

### 規則：依分支類型選寫法

**A. 判斷同一個變數的多個離散值 → `switch`**
```typescript
// ❌
if (state === 'active') return '#65c89b'
else if (state === 'waiting') return '#e3b64f'
else if (state === 'error') return '#ff6b6b'
else return '#9aa0a6'

// ✅
switch (state) {
  case 'active': return '#65c89b'
  case 'waiting': return '#e3b64f'
  case 'error': return '#ff6b6b'
  default: return '#9aa0a6'
}
```

**B. 純粹是「key → 值」對照 → 物件查表（比 switch 更精簡，且能被型別檢查窮盡性）**
```typescript
// ✅ 優於 switch：常數表，且 TypeScript 可用 satisfies Record<State, string> 強制窮盡
const STATE_COLOR: Record<PetState, string> = {
  active: '#65c89b',
  waiting: '#e3b64f',
  error: '#ff6b6b',
  idle: '#9aa0a6',
}
```
專案裡 `quotaColor()` 這種依門檻分段（`< 20` / `< 50` / else）不是離散 key，維持三元或改寫成早返回（early return）即可，不需要硬套查表：
```typescript
// ✅ 早返回優於巢狀三元
function quotaColor(familyKey: string): string {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return 'transparent'
  if (quota.remainingPercent < 20) return '#ff6b6b'
  if (quota.remainingPercent < 50) return '#e3b64f'
  return familyKey === 'claude' ? '#d97757' : '#65c89b'
}
```

**C. 依條件執行不同「動作」（非回傳值）→ 策略物件 / handler map**
適用於 `electron/main.ts` 這類依 adapter id、事件類型分支處理邏輯的地方：
```typescript
// ❌ 一長串 if (adapterId === 'codex') {...} else if (adapterId === 'claude-code') {...}
// ✅
const ADAPTER_HANDLERS: Record<AgentAdapterId, () => void> = {
  codex: handleCodex,
  'claude-code': handleClaudeCode,
  opencode: handleOpenCode,
}
ADAPTER_HANDLERS[adapterId]?.()
```

**D. 每個 `AgentState` 都要有的資料 → 寫進狀態 registry，不要另開 switch 或 Record**
`AGENT_STATE_POLICY`（`src/types/agent.ts`，主程序也用：優先序、通知、歷史結局）與 `AGENT_STATE_PRESENTATION`（`src/utils/agent-state-presentation.ts`，renderer 專用：標籤、顏色、aria、狀態列文字、迷你徽章、音效 cue）都用 `as const satisfies Record<AgentState, …>`，新增狀態時漏一格就編譯失敗。帶轉換或 urgency 條件的邏輯（例如「進入 waiting-permission 時才播音」）留在原處，只從表裡取值。狀態 → 寵物動作（`src/utils/pet-motion-plan.ts`）就是這種例外：它要看前一個狀態、隨機與時間，所以維持 switch；新增狀態時這裡也要補一個 case。

**E. 每個 `AgentSource`／工具家族都要有的資料 → 寫進來源 registry，不要再寫 `source === 'claude' || …` 或手寫來源清單**
`AGENT_SOURCE_REGISTRY`（名稱、家族、CLI／Desktop）與 `AGENT_FAMILY_REGISTRY`（家族名稱、adapterId、quota、本機 token 紀錄）都在 `src/types/agent.ts`，主程序與 renderer 共用。`SOURCE_LABELS`、`SOURCE_FAMILIES`、`FAMILY_SOURCES`、各種白名單都由這兩張表推導。來源 → 家族直接查 `AGENT_SOURCE_REGISTRY[source].family` 或 `familyOfSource()`，是 O(1)，不要再用 `SOURCE_FAMILIES.find(f => f.sources.includes(s))`。不可信的字串先過 `isAgentSource`／`isAgentFamilyKey`／`isQuotaFamilyKey` 再查表。表裡的字串都是持久化或插件契約的值，不能改名。hook 檔案（`integrations/*`、`electron/setup.ts`、`electron/hook-config.ts`）保留自己的字串。清單見 `docs/dev/agent-sources.md`。

**F. 每個音效 cue 都要有的資料 → 寫進 `SOUND_CUE_REGISTRY`（`src/types/sound.ts`）**
音形、cue 開關、試聽按鈕都在這張 `as const satisfies Record<SoundCue, …>` 表；節流、包絡、音量範圍、持久化預設值是同檔的 `SOUND_POLICY`／`SOUND_ENVELOPE`／`SOUND_VOLUME`／`SOUND_DEFAULTS`。狀態 → cue 不要寫進這裡，那是 `AGENT_STATE_PRESENTATION.cue`。設定頁的開關列與試聽按鈕由 registry 產生，不要再手寫一列。

### 何時**不要**改
- 條件涉及**不同變數**、非離散值判斷（範圍、正則、多個條件 AND/OR）→ 維持 `if`，硬套 `switch` 反而更難讀。
- 只有 2 層的 `if/else` → 不必強改，重構成本大於收益。

---

## 5. `<script setup>` 大檔案的區塊組織

### 決策：功能分組 + 區塊標頭註解，而非強制的全域 phase 排序
原本設想的做法是把整個 `<script setup>` 依「imports → state → computed → function → lifecycle → watch」的全域 phase 硬性排序。實際動手處理 `DesktopPet.vue`（1542 行）、`StatusPanel.vue`（2082 行）、`agentStore.ts`（1558 行）後改變了做法：這三個檔案原本就已經大致依「功能」分組（例如 quota 顯示的 state 跟它的 computed／function 放在一起、drag 相關的 state 跟 handler 放在一起），全域 phase 排序反而會把同一個功能的 state 和使用它的邏輯拆到檔案的兩端，增加跳轉成本，收益不明顯，還要冒著搬動上千行互相依賴的閉包程式碼、手滑弄壞邏輯的風險。

改採更安全、收益更直接的做法：**保留原有的功能分組順序，只在每個分組開頭加上區塊標頭註解**，讓大檔案可以用「跳到下一個 `// ---`」的方式導覽，不搬動任何程式碼：

```typescript
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import PetAnimation from '@/components/PetAnimation.vue'

const store = useAgentStore()
const dragOffset = ref({ x: 0, y: 0 })

// --- 狀態列與 Quota 顯示 ---------------------------------------------------
const displayLines = computed(() => { ... })
function quotaColor(familyKey: string) { ... }

// --- Quota 下降時的閃爍動畫 -------------------------------------------------
const draining = ref<Record<string, boolean>>({})
function flashDrain(familyKey: string) { ... }
watch(() => store.quotaByFamily, (quotas) => { ... })

// --- 拖曳與點擊 --------------------------------------------------------------
function onMouseDown(e: MouseEvent) { ... }
</script>
```

### 什麼時候該做全域搬移，而不是只加標頭
如果同一段 `<script setup>` 內，同一個功能的 state／function 分散在檔案的三、四個不同角落（不是集中一起、只是順序上跳著出現），那才值得真的搬動程式碼讓它們相鄰——但要一次只搬一個功能區塊，搬完立刻跑型別檢查與測試，不要一次搬整個檔案。

### 已完成
`DesktopPet.vue`、`StatusPanel.vue`、`agentStore.ts`（Pinia setup store）都已加上區塊標頭註解，涵蓋各自的主要功能分組（quota、drag、permission、mood、presentation、progression/achievements、project pets 等）。之後新增程式碼時，判斷屬於哪個既有分組就放進該分組；分組本身開始臃腫（單一分組超過 ~150 行）再考慮拆成獨立 composable。

---

## 7. 共用邏輯／元件抽取

### 現況：重複的格式化函式
`formatTime` / `*Duration` / `*Percent` 這類格式化函式在多個檔案各自定義了一份，命名不同但邏輯相似：

| 檔案 | 函式 |
|---|---|
| `DesktopPet.vue` | `quotaColor`、`quotaPercent`、`quotaDetailPercent` |
| `StatusPanel.vue` | `historyDuration`、`historyDayTokenPercent`、`historyAgentBarPercent`、`formatTime` |
| `PetAnimation.vue`、`utils/toast-countdown.ts` | 各自的時間格式化 |

目標抽成 `src/utils/format.ts`（時間／百分比／時長格式化）與（如果配色邏輯也重複）`src/utils/quota-color.ts`，四個檔案改成 import 共用函式。抽取前先確認語意是否真的相同（例如「剩餘秒數轉可讀字串」在 `StatusPanel` 跟 `toast-countdown.ts` 的邊界條件可能不同，抽之前要對照原邏輯，不能假設一致）。

### 現況：重複的顏色值
`src/styles/tokens.css`（134 行）已經是設計 token 檔，但元件內仍大量直接寫死 hex 色碼（`#ff6b6b`、`#cdd4ff` 等重複出現在 `DesktopPet.vue`／`StatusPanel.vue`／`PetAnimation.vue` 三個檔案）。目標是把重複出現 ≥2 次、且語意固定（例如「警示紅」「claude 品牌色」）的顏色值收斂進 `tokens.css`，元件內用 `var(--token-name)` 取代硬編碼；只出現一次、上下文明顯是一次性裝飾色的不用硬套 token。

### 元件層級
`ConfirmDialog.vue` 已經是共用元件的正確示範。檢查 `DesktopPet.vue`／`StatusPanel.vue`／`SetupWizard.vue`／`ProjectMcpPanel.vue` 內有沒有結構相似但各自手刻的 UI 區塊（例如面板 header、狀態徽章、風險等級標籤），有的話比照 `src/components/ui/` 現有的 `Button.vue`／`Card.vue`／`ToggleRow.vue`／`Select.vue` 模式抽成新元件。**先確認畫面結構是否真的一致**（間距、互動狀態）才抽，避免抽出一個為了遷就兩個用法而長滿 props 條件分支的偽共用元件——那種情況不如維持各自獨立。

---

## 8. 效能優化

**前提：任何效能改動前後都要能證明功能沒壞（手動走一次 golden path，並確認既有 `tests/*.test.mts` 全過）。沒有量測數據支持的「感覺會比較快」不做。**

依風險排序，能做且值得做的方向：

1. **大列表／高頻更新元件用 `shallowRef`**：`agentStore.ts`（1558 行）目前 state 管理若有大型物件用 `reactive()` 或深層 `ref()`，改 `shallowRef()` 可以減少不必要的深層響應式追蹤開銷（沿用 §7 通用狀態管理慣例：`ref()` 預設、大型物件用 `shallowRef()`）。改之前要確認該狀態內部欄位是否被巢狀 mutate（`state.inner.x = 1` 這種寫法在 `shallowRef` 下不會觸發更新），有的話要先改成整體替換寫法才能安全切換。
2. **`computed` 取代重複計算的內聯函式**：`DesktopPet.vue` 的 `quotaColor`/`quotaPercent` 這類純函式若在 template 裡對同一份資料被多次呼叫（例如同時給顏色跟寬度用），改成 `computed` 讓 Vue 做快取，避免同一輪 render 內重複算。
3. **動畫／輪詢節流已經有的機制保留、不要重新發明**：`DesktopPet.vue` 現有的 quota-drop 動畫節流（§2 提到的 class-toggle 機制）跟視窗量測邏輯是刻意設計過的節流，重構時原樣搬移，不要「順手優化」改寫，除非要解決明確量測到的問題。
4. **v-if vs v-show**：頻繁切換顯隱（如 Permission 泡泡、tooltip）用 `v-show`；很少切換或切換時需要重建內部狀態的（如 dialog 內容）維持 `v-if`，目前若有搞反的地方才調整。
5. **Electron 主行程（`electron/main.ts` 2378 行）**：檢查是否有輪詢（polling）間隔可以拉長或改事件驅動；桌面寵物是常駐背景 app，主行程的 CPU/記憶體效率比畫面渲染效能更值得優化，但要先用 Task Manager / `--inspect` 量測，不要臆測熱點。

不在此規劃範圍內（除非明確要求）：換掉 Vue/Pinia、引入虛擬滾動等框架級改動——目前資料量（設定面板、歷史清單）不大，用不到。

### 已完成（2026-08-14）
逐一檢查 `agentStore.ts` 內每個持有物件／陣列的 `ref`，只對「確認全程都是整體替換、從未巢狀 mutate」的欄位改成 `shallowRef`：

- `quotaUsage`、`progression`、`achievements`、`permissionRequests` 四個都改了——各自的 setter（`setQuotaUsage`／`setProgressionSnapshot`／`setAchievementsSnapshot`／`setPermissionRequests`）都是 `xxx.value = 新物件` 整體替換，用 grep 確認過專案裡沒有任何 `xxx.value.field = ...` 或 `xxx.value[i] = ...` 這種巢狀寫法。
- **`sessions`、`pets`、`projectPets` 刻意沒有動**：這三個都有巢狀 mutate 的既有寫法（例如 `handleEvent()` 內 `existing.state = event.state`、`renamePet()` 內 `pet.displayName = newName`、`setProjectPetBinding()` 內 `projectPets.value[index] = result.project`），改成 `shallowRef` 會讓這些寫法悄悄停止觸發畫面更新且沒有任何編譯期警告——這正是 §8 開頭「改之前要確認沒有巢狀 mutate」那句話想避免的情況，所以維持原本的 `ref()`。

第 2、3、4 點（重複 computed、既有節流機制、v-if/v-show）逐一檢查後沒有發現明確可改善的案例（例如 `store.quotaByFamily[line.key]` 在 template 內重複讀取，但它本身是已快取的 `computed`，物件屬性存取成本可忽略，硬套一層額外 `computed` 是過度設計）；第 5 點（Electron 主行程輪詢）需要實際跑起來用 Task Manager 量測才能判斷，本輪重構沒有執行。

驗證方式：`vue-tsc --noEmit`、`vite build`、`pnpm run test:unit`（96 個測試）皆通過；沒有另外啟動 Electron 手動走一次 UI（桌面 app 需要 GUI 環境），這點還需要使用者自行確認一次寵物視窗與控制面板的 Quota／成就／Permission 顯示是否正常。

---

## 9. Scoped CSS 抽出檔案

### 現況
`<style scoped>` 區塊大小：

| 檔案 | scoped CSS 行數 |
|---|---|
| `DesktopPet.vue` | 996 |
| `StatusPanel.vue` | 943 |
| `SetupWizard.vue` | 342 |
| `ProjectMcpPanel.vue` | 265 |
| `PetAnimation.vue` | 173 |

`DesktopPet.vue`／`StatusPanel.vue` 兩個檔案樣式比邏輯還長，是拖慢閱讀與 diff 的主因。

### 規則
- 用 Vue SFC 原生支援的外部樣式引入，**不需要**額外套件：
  ```vue
  <style scoped src="./DesktopPet.scss"></style>
  ```
  或維持 `.css`（專案目前沒有引入 Sass/PostCSS 工具鏈，若要用 `.scss` 巢狀語法需額外裝 `sass`，屬於新增依賴，執行前跟使用者確認是否要引入建構工具；若只是想讓檔案分離、不一定需要 SCSS 語法糖，維持 `.css` 最省事）。
- `scoped` 屬性搬到外部檔案後，Vue 仍會用同一份 `data-v-xxxx` 屬性選擇器做 scope 隔離，行為不變，只是樣式來源檔案不同——這是零風險的機械式搬移，不影響功能。
- 抽出後檔案命名跟元件同名：`DesktopPet.vue` → `DesktopPet.css`（同目錄）。
- 抽的同時（不是另開一輪）把 §7 提到的重複 hex 色碼換成 `var(--token)`，兩件事一起做比較不會漏。
- `src/components/ui/*.vue` 內的小型 `<style scoped>`（35~108 行）不用抽，體積本來就小，抽出去反而增加檔案跳轉成本。

---

## 10. Build 速度優化

### 現況
`pnpm run build` = `vue-tsc --noEmit && vite build && electron-builder`，三個階段疊加：

1. `vue-tsc --noEmit`：對整個專案（`src/**/*.ts,vue`、`electron/**/*.ts`）做完整型別檢查，`tsconfig.json` 目前**沒有開 `incremental`/`composite`**，每次都是冷檢查。
2. `vite build`：專案體量不大（16688 行程式碼、依賴很精簡：`fflate`/`pinia`/`vue` 三個 runtime 依賴），這一步理論上不該是瓶頸。
3. `electron-builder`：`package.json` 的 `build` 設定沒有指定 `compression`，預設走 electron-builder 的 `normal`（近似最大壓縮）做 `.7z`／portable 打包；這對應到既有記憶 `project_build_signing_slow`（看起來卡住的其實是壓縮，不是簽章卡死）。

### 可做的優化（依風險排序）

1. **開 TypeScript `incremental`**（風險最低）：`tsconfig.json` 加 `"incremental": true` + `"tsBuildInfoFile"`，讓 `vue-tsc` 在未清 cache 的情況下用增量檢查，本機重複 build 會明顯變快；CI/乾淨環境跑第一次仍是全量，不影響正確性。
2. **開發時跑 build 用較低壓縮**：`electron-builder` 支援 `compression: "store"`（不壓縮）或 `"maximum"`／`"normal"`。可以在 `package.json` 的 `build` 設定加一組給本機驗證用的低壓縮設定（例如透過 `electron-builder --config.compression=store` 的 CLI 覆蓋，或另開一個 `build:fast` script），**正式發版仍用預設壓縮**，避免產出檔案變大影響使用者下載體驗。
3. **`vite build` 平行度**：確認 `vite-plugin-electron` 的 main/preload 建置與 renderer 建置是否有非必要的序列相依；多數情況下這步本來就快，除非量測結果顯示這裡才是瓶頸再動。
4. **不建議**：改動 `electronFuses`／`asar`／簽章相關設定來換取速度——這些是安全性設定，速度收益有限但風險（供應鏈安全、程式完整性驗證）高，不在效能優化範圍內。

### 執行前置動作
動手調之前，先用 `Measure-Command { pnpm run build }`（PowerShell）或分段跑 `pnpm exec vue-tsc --noEmit` / `pnpm exec vite build` / `pnpm exec electron-builder` 各自計時，找出真正佔比最大的階段，再對症優化——不要三個階段一起改，不然出問題不知道是哪個改動造成的。

### 實測結果（2026-08-14）
分段計時：`vue-tsc --noEmit` 冷檢查約 6-7 秒、`vite build`（renderer + main + preload 三段）約 4 秒。兩者都不是瓶頸，跟原本猜測一致——真正慢的是 `electron-builder` 的壓縮打包階段，但此步驟本次重構**沒有實跑計時**（會產生實際安裝檔、且在本機環境跑可能耗時數分鐘甚至觸發簽章相關互動，风险與本次重構的收益不成比例，所以只做了設定層級的優化，沒有跑滿全流程驗證秒數）。

已套用：
1. `tsconfig.json` 加上 `"incremental": true` + `"tsBuildInfoFile": "./node_modules/.cache/tsconfig.tsbuildinfo"`（已在 `.gitignore` 的 `node_modules` 規則涵蓋範圍內，不會誤 commit）。有小幅加速（本機測得約 7s → 5.5s），主要效益會在檔案異動量小的後續多次重複 build 才明顯。
2. `package.json` 新增 `build:fast` / `prebuild:fast` script，透過 `electron-builder --config.compression=store` 產出未壓縮安裝檔，僅供本機驗證用；**`build`／`electron:build`（正式發版用的）維持預設壓縮**，未動風險項目。

尚未執行、留給使用者決定是否需要：實際比較 `pnpm run build` 與 `pnpm run build:fast` 的總耗時差異——因為需要跑完整 electron-builder 流程（含 code signing 相關步驟），建議在確定要發版驗證時再手動比較一次。

---

## 11. 重構執行順序建議

依「風險低、收益高」優先，分階段進行，每階段結束跑一次 `pnpm run build` 驗證：

1. **i18n 抽 JSON**（§3）— 純資料搬移，風險最低，可獨立驗證（型別檢查 key 對齊）。
2. **`@/` 別名替換**（§1）— 機械式取代，可用 codemod/批次 sed，一次處理完 93 處。
3. **TypeScript `incremental` + build 分階段計時**（§10）— 零邏輯風險，先量測再決定要不要動壓縮設定。
4. **Scoped CSS 抽檔 + 顏色值收斂進 `tokens.css`**（§7、§9）— 機械式搬移，同一輪順手做完，降低後續大檔閱讀成本。
5. **`DesktopPet.vue`／`StatusPanel.vue`／`agentStore.ts` 三個大檔的 script 分段整理**（§5）— 純移動程式碼位置，不改邏輯。
6. **共用函式抽取**（§7）— 抽之前逐一比對原邏輯是否真的等價，抽完要跑過對應功能確認行為沒變。
7. **if-else / 巢狀三元重構**（§4）— 需要逐一判斷改哪種寫法，風險較高，放後段且要有測試（`tests/*.test.mts`）覆蓋再動。
8. **效能優化**（§8）— 放最後，因為前面步驟（狀態管理位置搬移、共用函式抽取）會讓效能熱點更容易辨識；每個效能改動都要能個別 revert。
9. **註解清理**（§2）— 可以跟第 5、6、7 步順手做，不用獨立一輪。

不建議一次性全部重構（大量檔案同時變動，難以 review、難以 bisect）。建議每個階段各開一個 commit / PR，效能相關的改動（§8、§10 的壓縮設定）額外要求「改動前後都能提出量測數據」再合併。
