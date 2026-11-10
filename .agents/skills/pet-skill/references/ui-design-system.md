# UI design system

This project has a token layer and a shared primitive component set. They exist because the panel used to accumulate divergent one-off styles per feature (five card treatments, twelve button styles, nine progress-bar implementations, a dropdown that never disabled the native OS arrow). Read this before writing or editing any `.vue` file under `src/components/`.

Full audit and rationale: [UI-Audit-And-Redesign-Plan.zh-TW.md](../../../docs/design/UI-Audit-And-Redesign-Plan.zh-TW.md).

## Rule: no bare hex or rgba(), no naked font-size

Every colour, font size, spacing, radius, and shadow in a component `<style>` block must be a `var(--token)` from `src/styles/tokens.css`. A literal `#8b9cf7` or `rgba(139, 156, 247, 0.15)` in a new `.vue` file is a bug, not a style choice — it cannot be themed, cannot be audited, and is how the app ended up with 121 unique hex values and 9px body text.

If the colour/size you need does not have a token yet, add one to `tokens.css` (with a comment explaining what it is for) rather than inlining a literal. Keep the token count small — reuse an existing token before adding a near-duplicate.

The floor for any user-facing text is `--font-xs` (11px). CJK glyphs lose stroke definition below that on both Windows and macOS; do not add a smaller size to "make it fit" — that is a symptom of the container being too small, not a font-size problem (see the panel-sizing note below).

## Token layers (DS-01)

- **Palette** — `--builtin-organic-*` holds the only literal colours in `src/**` (light on `:root`, dark on `:root[data-theme='dark']`), including host-fixed entries (`info-text`, `shadow`, `highlight`). `--organic-*` aliases it; a plugin theme re-points `--organic-*` inline on `<html>`. Spacing and type steps are on the 4px grid / 5-step scale.
- **Semantic** — `--color-*` (`bg`, `surface`, `surface-2`, `overlay`, `sunken`, `text`, `text-2`, `text-3`, `text-faint`, `accent`, `accent-hover`, `accent-text`, `on-accent`, `border`, `border-strong`, `scrim`, `danger`, `success`, `warn`, `info`, `focus`, `shadow`, `highlight`) and the legacy names (`--surface-*`, `--text-*`, `--accent*`, `--border-*`, `--state-*`) are derived from the palette on `:root, .panel-theme-preview`. New CSS reads `--color-*`; never write a literal colour or `color-mix(…, black|white)` — mix with `--color-shadow` / `--color-highlight` / `--color-text` instead.
- **Windows** — both windows use the same layers. `<html data-window>` is `panel` or `pet`; `data-theme` is the panel appearance in the panel window and the pet appearance in the pet window. Typography/spacing/radius aliases of the palette apply only in the panel window. The pet window's floating surfaces (`.desktop-pet`, bubbles, pill) are the palette `surface` at fixed alphas that the theme validator also checks over black and white desktops.
- **State** — the `color` column of `AGENT_STATE_PRESENTATION` (`src/utils/agent-state-presentation.ts`) is `var(--state-*)`; `--state-*` derive from the hue-checked danger/success/warn colours, `accent-text` (thinking/tool) and the muted text levels. Never pass a hex colour from TS.
- `tokens.css` is also served to plugin pages; its `--organic-*` colours read `--ap-*` first there, so the legacy names follow the user's theme. Do not delete a token documented in `docs/plugins/ux-guidelines.md`.

## Foreground/background pairs (DS-10)

`scripts/check-contrast.mjs` (and `tests/design-contrast.test.mts`) resolve `tokens.css` per context (panel light/dark, pet light/dark), follow `var()` and `color-mix()`, and judge translucent surfaces over the worse of a black and a white desktop. Add a pair there when you add a token that carries text. Plugin themes get the same guarantees from the validator's invariants (`panelThemeInvariantFailure`, spec R14).

| Foreground | Background | Min | Notes |
| --- | --- | --- | --- |
| `--organic-text`, `-secondary`, `-muted` | `--organic-bg/surface/surface-2` | 4.5 | body and helper text |
| `--organic-accent-text` | `--organic-surface` | 4.5 | accent used as text; never `--organic-accent` itself |
| `--organic-accent-contrast` | `--organic-accent-hover` | 4.5 | primary button (`Button` uses `--accent-hover` fill + `--accent-on` label; hover mixes 12% toward `--text-primary`) |
| `--organic-text-faint` | `--organic-surface` | 3 | decorative only, never text |
| `--organic-danger/success/warn-text`, `--color-info` | surface, surface-2 | 4.5 | `--text-danger/-success/-warning` |
| `--color-focus` (= accent text) | bg, surface, surface-2, surface-warm | 3 | the one focus ring (`--focus-ring-color`); `Highlight` under forced colours |
| pet bubble / pill text, quota fills, state dots | `--pet-bubble-surface`, `--organic-status-surface` over black and white | 4.5 / 3 | pet window |

State is never conveyed by colour alone: pair status dots with a text label or shape.

## Rule: reuse the primitive before writing a new element

`src/components/ui/` holds the app's only implementations of these UI patterns. Import them; do not hand-roll a competing version.

| Component | Replaces | Use for |
| --- | --- | --- |
| `Button.vue` | any `<button class="...">` with custom styling | Every clickable action. Pick `variant` by role — `primary` (section's main action), `secondary` (supporting: refresh, reset, export), `danger` (destructive: quit, remove, clear), `ghost` (icon-only chrome: header controls, inline row actions). Never introduce a 13th button style. |
| `Card.vue` | any `.xxx-card` / bordered content block | Grouping settings, stats, or list content. Default `tone="neutral"`. Reach for `accent` / `success` / `claude` / `warn` only when the card shares a real semantic identity with other UI using that colour elsewhere in the panel (sessions/streak = success, token/growth numbers = accent, Claude's own quota card = claude, a status that needs attention = warn) — colouring every card is the "monotone panel" problem in reverse (a wall of noise instead of a wall of grey) and was explicitly walked back once already. |
| `ToggleRow.vue` | hand-written `<label class="toggle-row">` + switch markup | Every on/off setting. Takes `label`, optional `help`, `v-model` boolean. |
| `Select.vue` | any `<select>` | Every dropdown. Wraps the native `<select>` (kept native on purpose — a custom listbox would get clipped by the panel's `overflow: hidden` in this frameless window, and loses OS keyboard/typeahead behaviour) but takes over `appearance` and the closed-state chrome so both platforms render identically. If you write a raw `<select>` anywhere, that is the bug this component exists to prevent. |
| `ProgressTrack.vue` | any percentage bar (`quota-track`, `mood-bar`, day-activity bars, etc.) | Any 0–100 value shown as a bar. `tone` picks the fill colour family; `decorative` drops the `role="progressbar"` ARIA wiring for bars that are visual-only. |
| `ConfirmDialog.vue` | `window.confirm(...)` | Every destructive/irreversible action (remove, clear, delete). Never call `window.confirm` or `window.alert` — the native dialog steals OS focus, which the main process reads as the panel window losing focus, which hides the panel out from under the confirmation. It also renders as a different native surface on Windows vs. macOS, which is the kind of cross-platform inconsistency this whole system exists to avoid (see the platform note below). |
| `Icon.vue` | any Unicode/emoji glyph used as a UI icon | Any icon in chrome (nav, buttons, section headers). Plain text glyphs (`⌘ ◈ ✦`) render through the OS font and differ in weight/alignment between Windows and macOS, and some carry unrelated platform meaning (`⌘` is the macOS Command key — do not reuse it as a generic symbol). Add new icons as inline path data in `ICON_PATHS` (`src/components/ui/icons.ts`); keep them on the existing 16×16 grid with 1.4 stroke-width so a new icon does not look heavier or lighter than the rest. A solid-shape icon (such as `more`, the Material `more_vert` dots) goes in `FILLED_ICONS` so `Icon.vue` fills it with `currentColor` instead of stroking it. |
| `SegmentedTabs.vue` | hand-written tab buttons | A tablist with roving focus and optional count badges (the plugin area's Installed / Explore / Notifications / Advanced). The caller renders the `role="tabpanel"` with `${idPrefix}-panel-${id}`. |
| `ActionMenu.vue` | native menus, one-off popovers | A trigger button plus an in-page menu of actions (overflow `more` menus, split install menu). Native menus would blur the window and hide the panel. |
| `Chip.vue` | per-feature status pills | Status/label pill that always pairs tone with an icon or text (installed, update, signature state). Prefer `Badge.vue` for counts. |
| `NumberField.vue` | `<input type="number">` | Numeric field that reports only valid values on blur/Enter, shows an inline range error and reverts. |
| `Spinner.vue` | CSS-only loaders | Small inline activity ring; static under reduced motion. |

Additional primitives (all backward compatible; existing props above are unchanged):

| Component | Use for |
| --- | --- |
| `Dialog.vue` + `composables/useDialogA11y.ts` | Every modal. Props `open`, `title`, `description`, `role`, `initial-focus`, `show-close`, `size` (`sm`/`md`/`lg`, or `full` for a full-panel tool such as the theme editor); `#footer` slot; `#overlay` slot for a dialog opened from inside this one (it stays in scope, so the outer dialog's keys step aside); emits `close`. Provides Esc, Tab trap, initial focus, focus restore, `inert` siblings, `aria-labelledby/describedby`. Inside the panel it teleports its scrim to the panel root (`StatusPanel` provides `DIALOG_HOST_KEY`, see `ui/dialog-host.ts`), so the scrim always covers the whole panel — header, search and tabs included — however deep the caller sits (a `position: relative` Card or a scroll frame would otherwise scope and clip it); a dialog nested in another dialog stays in place. `ConfirmDialog` is built on it. |
| `Tabs.vue` + `TabPanel.vue` (+ `utils/tab-navigation.ts`) | Every tablist (dashboard tabs, settings nav). `v-model` id, `items`, `aria-label`, `orientation` (vertical uses up/down), `variant` underline/pill, `id-prefix` shared with `TabPanel` for `aria-controls/labelledby`. Roving tabindex, Home/End. Hidden panels use the `hidden` attribute. Wrap in `<nav>` for a landmark; never put `role="tablist"` on `<nav>`. |
| `TextField.vue` | Pill-shaped text/search field with leading search icon, clear button and character counter (`v-model`, `search`, `clear-label`, `maxlength`, `error`). Use `Input.vue` for labelled form fields, `TextField` for search boxes and inline rename. |
| `Input.vue` | Every text field. `v-model`, `label`, `help`, `error` (renders `role="alert"`, sets `aria-invalid` and `aria-describedby`), `ariaLabel` when there is no visible label. Extra attrs fall through to the `<input>`. |
| `Checkbox.vue` | Selections inside forms/dialogs (`ToggleRow` stays for on/off settings). `v-model`, `label`, `help` (linked via `aria-describedby`). |
| `Badge.vue` | Plugin / DEV / status / quota chips. `tone` neutral/accent/success/warn/danger, `dot`, `count`. Always pair colour with text. |
| `Toast.vue` + `ToastHost.vue` + `composables/useToast.ts` | Transient messages. Push with `useToast().push({ tone, title, message, actionLabel, onAction, duration })`; mount `<ToastHost />` once near the app root. Danger toasts are `role="alert"`, the rest `role="status"`; max 3 visible. |
| `EmptyState.vue` | "Nothing here yet": `icon`, `title`, `description`, default slot for actions, `compact` inside Cards. |
| `Skeleton.vue` | Loading placeholder (`line` / `block` / `circle`, `lines`). Static under reduced motion; put `aria-busy="true"` on the loading region. |
| `Tooltip.vue` | Replacement for native `title=` hints: hover (300ms) + focus, `aria-describedby`, Esc closes (only the tooltip, not a surrounding dialog), clamped to the viewport. Wrap one focusable element, e.g. an icon button that explains a setting (the theme editor's "where is this colour used" hints). |

New tokens for primitives: `--hit-min` (32px minimum hit area), `--z-*` scale (the only z-index values components may use), `--leading-tight/normal/relaxed`, `--ease-standard`.

A raw `<button>`, `<select>` or `<input>` outside `ui/` is allowed only when no primitive fits (a whole clickable list row, a native `type=color` picker, a range slider, a text link inside the permission bubble). Put `<!-- raw-control: <reason> -->` on the line above it; `check:design` counts unexplained ones as `rawControls`.

## Spacing and motion tokens

Token tables and what each `check:design` field means: [docs/dev/design-tokens.md](../../../../docs/dev/design-tokens.md).

- Spacing: `--space-1`…`--space-5` (4/8/12/16/24px) plus the half steps `--space-0-5` (2px), `--space-1-5` (6px), `--space-2-5` (10px) for dense label stacks and pill padding. A margin/padding/gap px that equals any `--space-*` value must use the token (`literal-spacing`). Off-scale optical nudges (1px, 3px, 5px, 7px …) and negative margins stay literal; `check:design --verbose` lists them as `raw-spacing`. Values inside `calc()`/`max()` (the pet window's `--pet-scale` formulas) are not checked.
- Motion: every `transition` uses `--transition-fast/base/slow` (`literal-transition` fails otherwise). Keyframe durations that repeat with one meaning are tokens — `--duration-spin` (loading spinner turn) and `--duration-attention` (pet-window attention pulse); one-off decorative animations (sprite reactions) keep their literal and show up as `raw-motion`. Curves are `--ease-standard` and `--ease-overshoot`; a literal `cubic-bezier()` fails (`literal-easing`). Keyword easings (`ease-in-out`, `linear`) are fine.
- A duration that must match a script timer comes from the script: the permission countdown sets its width transition from `PERMISSION_CLOCK_INTERVAL_MS` (`usePermissionClock.ts`); the pet reaction mark and the settings section flash set `--pet-mark-duration` / `--settings-flash-duration` inline from `REACTION_MARK_MS` / `SECTION_FLASH_MS`.
- Reduced motion: `tokens.css` zeroes every `--transition-*` and `--duration-*` under `prefers-reduced-motion` and stops all other animations with one universal rule (`tests/design-motion-tokens.test.mts` checks both). Script-driven motion reads `useReducedMotion()`.
- None of the half steps or `--duration-*`/`--ease-overshoot` are part of the plugin token table; plugin pages can see them in the shared `tokens.css` but must not rely on them.

Session state labels (`label` / `shortLabel` in `AGENT_STATE_PRESENTATION`, `src/utils/agent-state-presentation.ts`) and `SOURCE_LABELS` (Codex CLI, OpenCode Desktop, …) are deliberately **not** localized — they're the agent's technical run states and product/vendor names, not prose, and stay English in every locale. This was tried the other way (routed through `t()`) and reverted: translating "Thinking"/"Idle" read as inconsistent next to the untranslated tool vocabulary the rest of the panel already uses. Don't route these through `t()` again; add new state copy to `AGENT_STATE_PRESENTATION` and source copy to the `label` of `AGENT_SOURCE_REGISTRY` in `types/agent.ts` (`SOURCE_LABELS` is derived from it).

## Cross-platform is the constraint, not an afterthought

This app ships for **both Windows (portable) and macOS (dmg)** — see `package.json` `build.win` / `build.mac`. A design decision that only works on one platform is wrong, not a rare edge case:

- Never rely on a plain Unicode/emoji character as a UI icon — use `Icon.vue`. Font fallback, glyph coverage, and optical weight differ by platform and there is no CSS that fixes it after the fact.
- Never use `window.confirm` / `window.alert` / `window.prompt` — the native chrome differs by platform (Windows message box vs. macOS sheet), and it steals focus in a way that breaks this app's panel specifically (see above). Use `ConfirmDialog.vue`.
- When touching `electron/main.ts` window-geometry code (`computePanelBounds`, `animateBounds`, edge/mini mode), verify against both platforms' `workArea` semantics — macOS excludes the menu bar and Dock, Windows excludes the taskbar, and they are not the same shape.
- CJK text and Latin text do not share font metrics; do not assume a string's rendered width or vertical alignment is portable across `zh-TW` / `en-US` without checking both.

## Panel sizing is content-driven, not per-view constants

Historically each panel view (`Sessions`, `Usage`, `History`, `Settings`, Project MCP) requested a hardcoded pixel size via `resizePanel(height, width)` in `src/stores/agentStore.ts`. That is why History (six-plus cards, a 7-day chart, quota snapshot) was squeezed into the same 380×380 box as a two-line session list, and why body text kept shrinking to fit. If you add content to a panel view, do not reach for a new hardcoded `resizePanel()` call — prefer a layout that scrolls within the existing bounds, and flag to the user if the view now structurally needs more room (that is a sizing-strategy change, not a per-feature one).

## Layer rules (Liquid Glass)

See [liquid-glass.md](liquid-glass.md) for the full material/motion contract. The short version relevant to the primitives above: `--surface-panel` + `--surface-blur` belong on the outer glass container only (`.status-panel`, `ConfirmDialog`'s scrim). Everything inside — cards, rows, buttons — uses a flat `--surface-raised` tint, never a second `backdrop-filter`. Glass-on-glass is a repeated regression, not a style preference.

## When you're done

- Run `npx vue-tsc --noEmit`, `pnpm build`, and `pnpm test:unit` — all three must be clean before treating a UI change as finished (see `phase-gates.md`).
- If you touched `StatusPanel.vue`, `SetupWizard.vue`, or `ProjectMcpPanel.vue`, grep the file's `<style>` block for bare `#`/`rgba(` and any `font-size: <number>px` literal below `11px` — none should exist post-edit.
- If you added a new interactive element, confirm it is reachable by keyboard (`tabindex`, visible `:focus-visible`) and does not nest a `<button>`-rendering component inside another `<button>` — the browser silently closes the outer tag early, which breaks both the outer click target and whatever was nested inside it. Use `role="button"` + `tabindex="0"` + explicit `keydown` handling on a non-button container when a clickable element needs to contain other buttons.
