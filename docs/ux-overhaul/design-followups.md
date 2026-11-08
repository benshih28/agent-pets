# Design follow-ups for other streams

Violations found by the design stream in files it does not own. Each item names the file and what to change; the new tokens/primitives are already available.

## Focus (DS-08)
- `src/components/StatusPanel.css` (`.pet-rename-input`, ~line 1217): `outline: none` with only a 1px border change. Delete the `outline: none`; the global `:focus-visible` ring (base.css) applies. Add `aria-label` in `SettingsPets.vue` or switch to `ui/Input.vue`.
- `src/components/DesktopPet.css` (`.permission-button`, ~line 875): `outline: none` + hand-written box-shadow ring using a bare hex. Remove and rely on the global ring, or use `--focus-ring-*`.
- `role="button" tabindex="0"` elements (`.pet-option` in `SettingsPets.vue`, `.plugin-badge-anchor` in `DesktopPet.vue`, `.quota-*` tabindex elements) get the global ring automatically; do not add `outline: none` to them.

## Dialogs (DS-11)
- `SetupWizard.vue` (`role="dialog" aria-modal` at ~164) and `ProjectMcpPanel.vue` (~168): no Esc, no focus trap, no initial focus, no focus restore. Wrap their body in `ui/Dialog.vue` (props: `open`, `title`, `description`, `role`, `initial-focus`, `show-close`; `#footer` slot; emits `close`). `Dialog` drives `useDialogA11y` (Esc, Tab trap, initial focus, restore, `inert` on the overlay's siblings) and replaces the per-file `blur(4px)` scrims (`--blur-scrim`). If the wizard must keep its own overlay element, call `useDialogA11y({ open, container, scope, onClose })` directly.
- `PluginPanelDialogs.vue` already uses `ConfirmDialog` and inherits the new behaviour; native checkbox at ~83 should become `ui/Checkbox.vue`.

## Tabs (DS-12)
- `StatusPanel.vue` dashboard tabs (~195) and settings nav (~221) duplicate a hand-written tablist (`onTabKeydown` / `onSettingsKeydown`). Replace with `ui/Tabs.vue` (`v-model`, `:items`, `:aria-label`, `id-prefix`) and wrap the three dashboard views and settings content in `ui/TabPanel.vue`. Settings nav: `orientation="vertical"`, wrapped in a `<div>` or an outer `<nav>` (not `<nav role="tablist">`). Use `variant="underline"` for dashboard tabs and `variant="pill"` for the settings nav so one token-driven active style replaces `.dashboard-tab.active` / `.settings-nav-item.active`.

## Hit areas, z-index, motion tokens (DS-17)
Replace literals with tokens (`--hit-min`, `--z-*`, `--transition-*`); for visually small controls extend the hit area with an `::after` inset (see `ui/Button.vue`) instead of changing layout.
- `DesktopPet.css`: controls at ~94 (28px), ~776 (24px, plugin-feed-close), ~1085 (22px).
- `StatusPanel.css:~1054` (26px control); `ProjectMcpPanel.css:~140` (30px); `PluginPanel.css:9` (32px ok) and `PluginPanel.css:3` `z-index: 10000` -> `var(--z-system)`.
- 17 `z-index` literals across DesktopPet/StatusPanel/PluginPanel/SetupWizard/ProjectMcp -> `--z-sticky/popover/modal/toast/system`.
- ~46 `transition:` declarations without `var(--transition-*)` in DesktopPet/StatusPanel/PluginPanel.
- Card tones: `ui/Card.vue` still supports all five (backward compatible); new code should use neutral/accent/danger and express other meaning with `ui/Badge.vue`.
- Fonts: Caprasimo/Figtree were never bundled; `--organic-font-heading` now honestly falls back to Georgia and body to the system stack. If a font is bundled later, add `@font-face` + THIRD_PARTY_NOTICES in the same change.

## Backdrop blur (DS-07)
Tokens: `--blur-chip`, `--blur-bubble`, `--blur-scrim` (all `none` under reduced transparency; `html[data-gpu-safe]` disables every blur). Replace literals (`node scripts/check-design-tokens.mjs --verbose` lists `literal-blur`):
- `DesktopPet.css` ~263/424/762/782 (14/16/14/12px) -> `--blur-bubble` / `--blur-chip`; ~738 `blur(6px)` has no `-webkit-` twin; `.pet-toast` base declares blur once, variants (`.permission-notice`, `.presentation-say`) should only change tint.
- `SetupWizard.css:71`, `ProjectMcpPanel.css:71`: `blur(4px)` scrims -> `var(--blur-scrim)` (or adopt `ui/Dialog.vue`, see DS-11).
- `StatusPanel.css`: keep an opaque background under reduced transparency (only ~1357 handles it today); the `--blur-*` tokens already go to `none`.
- Never place a `backdrop-filter` element inside another; glass is only the outer container.

## Type scale (DS-04)
Tokens added: `--font-2xl` (22px), `--font-floor` (11px), `--leading-tight/normal/relaxed`. `check-design-tokens` `small-font` now also catches `max(10px, …)`.
- `PluginPanel.css:91` `10px` -> `var(--font-xs)`.
- `DesktopPet.css:330` `10px` -> `var(--font-xs)` (widen/truncate the status-line badge if needed); `:742`, `:853` `max(10px, …)` -> `max(var(--font-floor), calc(11px * var(--pet-scale, 1)))`; `:830` `max(8px, calc(9px * …))` -> same floor.
- `SetupWizard.css:109`, `ProjectMcpPanel.css:121` `font-size: 24px` -> `var(--font-2xl)`.
- Replace scattered `line-height: 1 / 1.25 / 1.5` with `--leading-*`.

## Glyph icons (DS-06)
`Icon.vue` now has `close`, `sparkle`, `wrench`, `alert`, `plugin`, `external-link`, `check`, `info`, `search` (paths in `ui/icons.ts`; `size` prop already takes any px size). `check-design-tokens --verbose` lists remaining `glyph-icon` hits. Known sites:
- `DesktopPet.vue`: `x` close (~781, use `Button icon-only` + `<Icon name="close">` with >= 32px hit area), sparkle (~702), wrench emoji (~730), `!` notice icon (~690 -> `alert`).
- `PluginPanel.vue` (~44, ~230): diamond placeholder -> `<Icon name="plugin">`.

## ARIA (DS-15)
Done in ui/: `ToggleRow` is `role="switch"` and links `help` via `aria-describedby`; `ProgressTrack` takes `valueText`; `Input`/`TextField` link errors with `aria-describedby` + `aria-invalid`; `Button` has `aria-busy`; `Toast` uses `role="alert"` for danger.
- `DesktopPet.vue` permission `alertdialog`: add `aria-describedby="permission-request-description"`; merge the 4 `aria-live` bubbles so only one announces at a time.
- `SettingsPets.vue:175`: error container `role="alert"` (success/progress stay `role="status"`); rename input needs a label (`ui/Input` or `TextField`).
- Quota/usage bars: pass `valueText` ("72%, resets in 2h") to `ProgressTrack`; loading regions get `aria-busy="true"` with `ui/Skeleton`.

## i18n literals (DS-13)
Added: `<html lang>` follows the locale (`i18n.ts`), `utils/accelerator.ts` (`formatAccelerator`/`acceleratorKeys`), `utils/state-label.ts` (`stateAriaLabel`), keys `design.state.*`, `design.operationFailed`; zh-TW `permissionBubbleHelp` no longer names English buttons.
- `components/permission/PermissionBubble.vue` (~77/87, `<kbd>Ctrl Shift N/Y</kbd>`) and `DesktopPet.vue` (~661-672): replace literal `Deny`/`Allow once` with `t('permissionDeny')`/`t('permissionAllowOnce')`; render `<kbd v-for="k in acceleratorKeys(accel)">` using the accelerator main reports (currently `CommandOrControl+Shift+Y/N` in `electron/main/runtime.ts`) instead of the literal `Ctrl Shift N/Y`.
- Session state dots/labels: add `:aria-label="stateAriaLabel(state)"` (visual text stays English by decision).
- `desktop-tray.ts:122`, `runtime.ts:2423/2575`: `'Presentation MCP'`/`'Permission adapter'` labels shown to users should come from locale keys (reliability/permission streams).
- `node scripts/check-design-tokens.mjs --verbose` lists `english-literal` template text nodes still to move into `t()`.

## Formatting and plurals (DS-18)
`utils/intl-format.ts` (`formatDateTime/Date/Time/Number/Relative/Duration`) and `tPlural(key, count)` in `i18n.ts` (catalog keys `<key>.one` / `<key>.other`; zh-TW needs only `.other`). Replace the scattered `toLocale*String(locale.value, …)` in `useQuotaFormat.ts`, `usePluginPanelController.ts:897/901`, `DesktopPet.vue:320`, `SetupWizard.vue:296`, `StatusPanelSessions.vue:58`, `StatusPanelHistory.vue:75/124/179/271`, and use `tPlural` where a "{count} items" string is concatenated (English "1 sessions"). The nine `achievement*` same-in-both-languages values are meme names kept on purpose. The glossary is already consistent: zh-TW uses 插件 everywhere (no 外掛).
