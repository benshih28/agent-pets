# 設計 token：間距、動態與檢查器

顏色、字級、圓角的規則見 `.agents/skills/pet-skill/references/ui-design-system.md`；這份只寫間距與動態，以及 `pnpm run check:design` 每一項結果代表什麼、怎麼處理。所有值都定義在 `src/styles/tokens.css` 的 `:root`。

## 間距

| token | 值 | 用途 |
|---|---|---|
| `--space-0-5` | 2px | 標題／副標堆疊的間隙、膠囊的上下內距 |
| `--space-1` | 4px | |
| `--space-1-5` | 6px | 密集列表與小膠囊的左右內距 |
| `--space-2` | 8px | |
| `--space-2-5` | 10px | 狀態膠囊（`2px 10px`）的左右內距 |
| `--space-3` | 12px | |
| `--space-4` | 16px | |
| `--space-5` | 24px | |

- `margin`、`padding`、`gap` 寫死的 px 只要等於上表任一值，就要改用 token（`literal-spacing`，`--strict` 會失敗）。
- 不在刻度上的光學微調（1px、3px、5px、7px…）與負 margin 可以留著，`--verbose` 會列成 `raw-spacing`。
- `calc()`／`max()` 裡的值不檢查：寵物視窗的 `max(8px, calc(8px * var(--pet-scale, 1)))` 是縮放公式，不是刻度。
- 半格 token 不在插件 token 表裡（`docs/plugins/ux-guidelines.md`），插件頁面看得到但不應依賴。

## 動態

| token | 值 | 用途 |
|---|---|---|
| `--transition-fast` / `-base` / `-slow` | 0.15s / 0.2s / 0.35s ease | 所有 `transition` |
| `--duration-spin` | 0.8s | 載入轉圈一圈（`Button` loading、`Spinner`） |
| `--duration-attention` | 1.8s | 寵物視窗的提醒脈動（迷你徽章、額度警示） |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 一般進出場 |
| `--ease-overshoot` | `cubic-bezier(0.2, 1.4, 0.4, 1)` | 略衝過頭再回位（驚訝反應、成就徽章） |

- `transition` 寫死時長會失敗（`literal-transition`）；寫死 `cubic-bezier()` 會失敗（`literal-easing`）。`ease-in-out`、`linear` 這類關鍵字可以直接寫。
- keyframe 動畫：同一種語意在兩處以上重複的時長才收成 `--duration-*`；寵物 sprite 反應等只出現一次的裝飾動畫保留字面值，列為 `raw-motion`。
- 要和程式計時器同步的時長由程式提供：權限倒數條的 width transition 用 `PERMISSION_CLOCK_INTERVAL_MS`（`src/components/permission/usePermissionClock.ts`）。寵物反應標記（`PetAnimation.vue` 的 `REACTION_MARK_MS`）與設定區塊閃爍（`SettingsPage.vue` 的 `SECTION_FLASH_MS`）由元件以行內樣式設定 `--pet-mark-duration`、`--settings-flash-duration`，CSS 只讀這兩個變數，不另寫時長。

### 減少動態

`tokens.css` 檔尾的 `@media (prefers-reduced-motion: reduce)` 把每個 `--transition-*`、`--duration-*` 設成 `0s`，並用一條萬用規則把其他動畫縮成 0.001ms、只跑一次。新增動態 token 時要在這裡補上，`tests/design-motion-tokens.test.mts` 會檢查。由程式驅動的動態（捲動、計時器）讀 `useReducedMotion()`，不要自己呼叫 `matchMedia`（`tests/reduced-motion.test.mts`）。

## 檢查器輸出

```bash
pnpm run check:design                         # 報告
node scripts/check-design-tokens.mjs --verbose  # 列出每一筆
pnpm run check:design:strict                  # CI：任何 finding 或寫死顏色就失敗
```

| 欄位 | 會讓 `--strict` 失敗 | 處理方式 |
|---|---|---|
| `byRule` | 是 | 依規則換成 token |
| `unused` | 否（維持 0） | 刪掉沒人用的 token；插件 token 表裡的 token 一律算有用（`PLUGIN_SHARED_TOKENS`，測試會比對文件） |
| `rawControls` | 否（維持 0） | 換成 `src/components/ui/` 的元件；真的沒有合適元件時，在控制項上一行加 `<!-- raw-control: 理由 -->`，改計入 `rawControlsAccepted` |
| `rawSpacing`、`rawMotion` | 否 | 觀察用；同一個值開始在多處以同一語意出現時再收成 token |
| `rawColors` | 用 `--raw-colors=fail` 時是 | 見 `docs/design/theme-token-audit.md` |

檢查器每個檔案只讀一次、每份 CSS 只切一次宣告，所有規則共用；規則的正規表示式都在模組層預先編譯。
