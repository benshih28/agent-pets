# Theme token audit (raw colours outside the theme palette)

**Status: done (spec §16 step 2, R14/R15).** `node scripts/check-design-tokens.mjs --raw-colors` reports **0** raw colours in `src/**` outside the theme palette source `--builtin-organic-*`, and `check:design:strict` (CI) runs with `--raw-colors=fail`, so a new literal colour fails the build. The tables below record the baseline and where each group went.

Baseline on `feat/panel-themes` after the `--ap-*` read API: **145 raw colours**, 133 in `tokens.css` and 12 elsewhere (141 before the scanner read multi-line declarations; the four it missed are `--shadow-panel`, `--shadow-edge-handle` and the two `--pet-bubble-shadow` values).

## Enforcement

`package.json` `check:design:strict` = `node scripts/check-design-tokens.mjs --strict --raw-colors=fail`; `shouldFail()` and `tests/check-design-tokens.test.mts` cover the flag. The only literals left are the `--builtin-organic-*` palette entries; since step 3 every one of them is themable (`info-text`, `shadow` and `highlight` gained the manifest keys `infoText`, `shadow`, `highlight`; spec R16).

## Summary by surface

"Target" was the planned palette key; "Result" is what step 2 did (all groups are at 0). Manifest keys for the *new* entries were added in step 3 (§16.2, spec R16).

| Group | Count | Where it renders | Target | Result |
| --- | --- | --- | --- | --- |
| `shared-glass-layer` | 36 | `:root` defaults of `--surface-*`, `--text-*`, `--accent*`, `--border-*`, `--state-*`: every component rendered outside `.status-panel` (setup wizard, Project MCP panel, pet window, plugin pages via `_shared/tokens.css`). Inside `.status-panel` these names are already aliased to the palette. | surface levels, text levels, accent family, border/borderSoft, state text, scrim (see table below) | Semantic layer `--color-*` + legacy names on `:root`, derived from the palette (StatusPanel's alias block moved to `tokens.css`); theme applied on `<html>` |
| `pet-bubbles` | 30 | Pet speech, success/error/warn/info/plugin bubbles and the permission bubble, dark and light pet appearance | *new* `bubbleSurface` (derived from `surface`), `text`, state text, `accentText` for info, *new* `pluginTint` | `surface` at 0.93 over the desktop; text/state/info from `--color-*`; plugin tint from `sage` |
| `pet-status-pill` | 27 | Status pill, quota tooltip and edge track in the pet window (built-in values when no `petStatus` is declared) | `petStatus.*` (§3.7) falling back to `surface`/`text`/`border`; shadows to *new* elevation tokens | `surface` at 0.92, track `text` at 0.14, shadows/highlights mixed from `--color-shadow` / `--color-highlight`; `petStatus` still overrides |
| `pet-window-glass-light` | 12 | Light pet appearance overrides of the glass layer inside `.desktop-pet` | same targets as `shared-glass-layer`, light mode | Removed: the pet window's palette mode is the pet appearance (`data-theme`), `.desktop-pet` derives translucent surfaces |
| `agent-state-colours` | 10 | `STATE_COLORS` in `src/types/agent.ts` (pet status dots, mini ring, session rows) and `--state-idle`/`--state-offline` | `successText`, `warnText`, `dangerText`, `accent` (thinking/tool), `textMuted` (idle/offline); move the TS table to `var(--state-*)` names | `STATE_COLORS` are `var(--state-*)`: success/danger/warn text, thinking/tool `accentText` (the fill is < 3:1 on the light pill), idle `textMuted`, offline `textFaint` |
| `panel-elevation` | 8 | `--organic-{panel,card,hero,thumb}-shadow`, light and dark | *new* `shadow` colour (derived: `text` at low alpha in light, black in dark) | Mixed from the host `--builtin-organic-shadow` (per-mode strength) |
| `agent-brand` | 4 | Claude brand gradient, accent, border and surface on cards | keep as brand constants, or *new* `brandClaude`; decide in step 2 (brand colours are identity, not theme) | Claude = `sage` family (as the panel already showed it); unused `--surface-claude` / `--border-claude` deleted |
| `scrollbars` | 4 | `--scrollbar-thumb(-hover)` dark and light | `text` at 0.2–0.45 alpha (derived) | `text` at 28 % / 45 % |
| `pet-window-chrome` | 4 | Drag shadow (dark/light), edge-peek handle shadow, the error badge `color: white` in `DesktopPet.css:258` | elevation tokens; badge text to `onAccent`-style *new* `onDanger` | Shadows from `--color-shadow`/`--color-highlight`; badge text `--color-bg` |
| `quota-meters` | 3 | `--organic-quota-warning/error/sage` | `warnText`, `dangerText`, `sage`; the < 20 % critical colour stays host-fixed per §3.7 | normal `sageDeep`, Claude `accentText`, low `warnText`, critical `dangerText` (not overridable by `petStatus`) |
| `shared-controls` | 2 | Primary button hover `color-mix(… 88%, black)` in `src/components/ui/Button.vue:147-148` | `accentHover` (already validated against `onAccent`) | Hover mixes 12 % toward `--text-primary` (validated as `PANEL_THEME_PRESSED_MIX`) |
| `pet-sprite-effects` | 1 | Aura tint `rgb(235, 242, 255)` in `src/components/PetAnimation.vue:132` | sprite effect, not UI chrome: keep host-fixed or read `accent`; decide in step 2 | Fallback aura tint reads `--organic-highlight` |

## `shared-glass-layer` and `pet-window-glass-light` mapping

| Token | Dark default | Target |
| --- | --- | --- |
| `--surface-panel`, `--surface-overlay`, `--surface-option` | `rgba(18,18,26,.86)`, `rgba(25,25,35,.98)`, `#1b1b29` | `bg` / *new* `overlay` (popover, menu, dialog, toast; derived from `surface`) |
| `--surface-raised`, `--surface-raised-hover`, `--surface-sunken` | translucent white / black | `surface`, `surface2`, *new* `sunken` (derived from `bg` toward `text`) |
| `--surface-scrim` | `rgba(0,0,0,.5)` | `scrim` |
| `--text-primary`, `--text-bright`, `--text-on-option` | `#e8ecfa`, `#f1f3ff`, `#ddd` | `text` |
| `--text-secondary`, `--text-muted` | `#a4a8b4`, `#858b9b` | `textSecondary`, `textMuted` |
| `--accent`, `--accent-bright`, `--accent-on` | `#8b9cf7`, `#cdd4ff`, `#12121a` | `accent`, `accentText`, `onAccent` |
| `--accent-wash/soft/strong/glow`, `--border-accent(-strong)` | accent at 0.08–0.4 | `accent` with fixed alphas (derived) |
| `--gradient-accent` | `#667eea → #8b9cf7` | `accent` → `accentHover` |
| `--border-subtle`, `--border-strong` (+ `prefers-contrast` block) | white 0.08 / 0.14 (0.3 / 0.5) | `borderSoft`, `border` |
| `--state-success`, `--state-error`, `--state-warn(-bright)`, `--state-info` (1.12 removed `--state-error-soft`; its users read `--text-danger`) | `#50c878`, `#ff6b6b`, `#c8b450`, `#9dd8ff` | `successText`, `dangerText`, `warnText`, *new* `info` (today `accentText`, as `--ap-info`) |
| `--focus-ring-color-on-light` | `#1b5fb0` / `#9dd8ff` | `accent` (focus follows accent, §3.4); token currently unused |
| `--shadow-raised`, `--text-shadow-panel` | white inset 0.06, black 0.55 | elevation tokens |

## Pre-existing findings (fixed in step 2)

- `DesktopPet.css:258` uses the named colour `white` for the error badge text, and `Button.vue` mixes the primary hover with `black`; neither follows the light pet appearance or a theme.
- `STATE_COLORS` duplicates `--state-*` values in TS, so a palette change must be made twice today.
- `--focus-ring-color-on-light` is declared (light and dark) but never read; removed, the one focus ring is `--color-focus` (accent text).
- Also fixed: the inline permission card drew secondary text, the countdown and `onAccent` text on the accent fill; bubble secondary text was 64–84 % translucent; the setup wizard and Project MCP panel used the blue glass primitives and missed `--font-body-sm`/`--font-label`; the pet appearance repainted the panel's scrollbars.

## Unused tokens (`check:design --verbose`, 20)

`tokens.css` is also served read-only to plugin pages as `agent-pets://plugin/_shared/tokens.css`, so its definitions stay until step 2 decides each case. The checker now counts `var(--x)` inside TS and Vue script/template strings as a use (the pet quota colours were misreported as unused before).

| Tokens | Status | Step 2 decision | Result |
| --- | --- | --- | --- |
| `--accent-strong`, `--border-claude`, `--surface-claude`, `--font-xl` | Never read. The dead re-declarations in `StatusPanel.css`, `SetupWizard.css` and `ProjectMcpPanel.css` are removed; the `tokens.css` definitions remain for plugin pages. | Keep in `tokens.css` while plugin pages may use them; the re-tokenised surfaces must not reintroduce panel-scope copies. | `--accent-strong`, `--border-claude`, `--surface-claude` deleted (not in the plugin token table); `--font-xl` kept (part of the documented plugin type scale `--font-xs`…`--font-2xl`) |
| `--color-bg` … `--color-scrim` (12 semantic aliases of the palette) | Declared as "the names new panel-layer CSS should use", never adopted. They mirror the `--ap-*` colour subset 1:1. | Adopt as the internal semantic layer that every re-tokenised surface reads (and extend with the *new* keys above), or delete; do not keep two unused layers. | Adopted and extended to 23 `--color-*` tokens; every surface reads them |
| `--accent-primary`, `--surface-secondary`, `--font-2xs` | Compatibility aliases for references that were removed in the UX overhaul; not in the documented plugin token table. | Delete once step 2 confirms no component or documented plugin token uses them. | Deleted (no component or documented plugin token used them); `--status-error` kept as an alias of `--color-danger` |
| `--font-floor` | 11 px helper for `max(var(--font-floor), calc(11px * var(--pet-scale)))`; the pet bubbles use `max(var(--font-xs), …)` (also 11 px) instead. | Use it in the pet window's scaled text when that CSS is re-tokenised, otherwise delete. | Adopted in the pet bubbles' scaled text |

`check:design` no longer reports `--font-xl`: tokens in the plugin token table (`PLUGIN_SHARED_TOKENS` in the checker, tested against `docs/plugins/ux-guidelines.md`) count as used. `--accent-wash` was deleted when the achievement filter moved to `SegmentedControl` (it had no other reader and is not in the plugin table). Unused tokens: 0. Step 3 deleted `--organic-border-on-accent` and deprecated its manifest key `borderOnAccent` (accepted and ignored; no host CSS read it since the permission card left the accent fill). `--organic-accent-on-hover` stays as the semantic hover wash `--color-hover` (setup wizard, Project MCP panel). The legacy `--border-on-accent` / `--accent-on-hover` aliases were removed in step 2.
