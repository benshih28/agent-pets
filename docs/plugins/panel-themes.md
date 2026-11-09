# Panel themes

`contributes.panelThemes` lets a plugin restyle the Agent Pets settings/status panel and the pet's status pill: colours, fonts, font scale, corner radii and a background (solid, gradient or packaged image). Themes are data only. A themes-only plugin has no Worker, no permissions and no Host API. Requires Agent Pets 1.12.0 or later.

The authoritative contract is [docs/design/Plugin-Panel-Theme-Spec.md](../design/Plugin-Panel-Theme-Spec.md). This page is the author summary.

## Where users pick a theme

Your plugin's dashboard tab (after Sessions, Quota and History) shows its themes as the tab's main content; the same list is also in Settings → Plugins → *your plugin* → **Panel themes** (the only place when your plugin also has a `panelView`, which fills the tab). Each theme shows a light and a dark preview (including the pet status pill) and has **Use in light mode**, **Use in dark mode** and **Use for both modes**. There is one theme slot per mode for the whole app, so applying a theme replaces the one in use. Settings → General → Appearance shows which theme each mode uses, **Customize…**, **Open plugin settings** (opens your tab, or the detail page section without a tab) and **Restore built-in**. Users can also build their own themes there (see [My themes and the theme editor](#my-themes-and-the-theme-editor)).

## What you declare

```json
{
  "id": "sakura",
  "displayName": { "zh-TW": "櫻花", "en-US": "Sakura" },
  "fonts": [{ "id": "nunito", "src": "fonts/nunito-400.woff2", "weight": 400 }],
  "typography": { "body": ["@nunito", "PingFang TC", "system-ui", "sans-serif"], "scale": 1.0 },
  "shape": { "radiusSm": 8, "radiusMd": 14, "radiusLg": 24 },
  "modes": {
    "light": {
      "colors": { "bg": "#fbf1f3", "surface": "#fffafb", "surface2": "#f6e6ea", "text": "#2a1d22", "textSecondary": "#5c4750", "textMuted": "#6a5560", "accent": "#b4446a", "accentText": "#8f2f52", "onAccent": "#ffffff", "border": "rgb(42 29 34 / 0.16)" },
      "background": { "type": "image", "src": "backgrounds/sakura-light.webp", "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "userImage": { "allowed": true, "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "petStatus": { "background": "rgb(255 250 251 / 0.92)", "text": "#2a1d22" }
    },
    "dark": { "colors": { "…": "…" } }
  }
}
```

| Field | Rules |
| --- | --- |
| `id` | `^[a-z0-9-]{1,32}$`, unique, 1–8 themes per plugin |
| `displayName` / `description` | `{ "zh-TW", "en-US" }`, 1–48 / 1–120 characters |
| `fonts[]` | ≤ 4 faces, `.woff2` only (≤ 1 MiB, `wOF2` magic), `weight` 400/600/700, `style` normal/italic; ≤ 8 font files per plugin; every packaged `.woff2` must be referenced |
| `typography.body` / `.heading` | 1–5 entries: `@fontId`, a local family name (`[A-Za-z0-9 -]`, no quotes) or a generic family; the last entry must be generic |
| `typography.scale` | 0.92–1.15, at most 2 decimals; sizes never go below 11 px |
| `shape` | `radiusSm` 0–16, `radiusMd` 0–24, `radiusLg` 0–32 (integers), `Sm ≤ Md ≤ Lg` |
| `modes.light` / `modes.dark` | At least one. A single-mode theme only appears for that mode |
| `colors` | 10 required keys (`bg`, `surface`, `surface2`, `text`, `textSecondary`, `textMuted`, `accent`, `accentText`, `onAccent`, `border`) plus optional ones (spec §3.2): `surfaceWarm`, `surfaceSage`, `surfaceSageSoft`, `surfaceOff`, `textFaint`, `accentHover`, `accentGlow`, `accentTrack`, `accentOnHover`, `sage`, `sageDeep`, `sageDark`, `sageTrack`, `borderSoft`, `dangerText`, `successText`, `warnText`, `scrim`, `infoText`, `shadow`, `highlight`. `borderOnAccent` is deprecated: still accepted and checked, then ignored |
| `background` | `solid` (default), `gradient` (`linear` with `angle` 0–359 or `radial` with `position`; 2–5 opaque, non-decreasing stops) or `image` (package `.png`/`.webp`, `fit`, `position`, `opacity` 0.2–1, `blur` 0–24, required opaque `overlay` with `opacity` 0.5–0.95) |
| `userImage` | `{ "allowed": true, "overlay": {…}, "fit"? }` lets the user import their own background for that mode |
| `petStatus` | Pet status pill colours: `background` (alpha 0.85–1) and `text` required; `border`, `textMuted`, `quotaFill`, `quotaTrack`, `quotaWarn` optional |

Colours: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `hsl()/hsla()` or `oklch()` (inside sRGB). No named colours, `var()`, `calc()`, `url()` or anything else. The host re-emits every colour as `rgb(R G B / A)`; your strings never reach CSS.

## Validation (reject, never adjust)

Every mode is checked separately and any failure rejects the whole package, with a developer-mode hint such as `sakura.light.colors.textMuted: 3.92:1 < 4.5:1 on surface2`.

- Light mode needs a light `bg` (luminance ≥ 0.45) and darker text; dark mode a dark `bg` (≤ 0.12) and lighter text.
- Text, secondary, muted and accent text ≥ 4.5:1 and `accent` ≥ 3:1 on `bg`, on every gradient stop and midpoint, and on an image backdrop over a worst-case black and white pixel.
- Every text token ≥ 4.5:1 on every surface it can appear on: all text levels, `accentText`, danger/success/warn/info text on `surface`, `surface2`, `bg`, and on the pet bubble (`surface` at 0.93), status pill (`surface` at 0.92) and pet-window menus and dialogs (`surface` at 0.98) over a black and a white desktop; `sageDeep` and `sageDark` on `surface`, `surface2`, `bg`; `text` and `accentText` on `surfaceWarm`; `text`, `sageDeep` and `sageDark` on `surfaceSage`, `text` and `sageDark` on `surfaceSageSoft`.
- Translucent backgrounds behind text are checked composited: the hover wash `accentOnHover` over `surface` (every text token), `surface2` (`text`, `textSecondary`), `surfaceWarm` (`text`, `accentText`) and `surfaceSage` (`text`, `sageDark`); each state chip (danger/success/warn text on its own colour at 12 %) over `surface`, `surface2` and `bg`; the danger button hover (`dangerText` on its own colour at 12 %) also over the pet-window dialogs.
- The focus ring is `accentText`: ≥ 3:1 on every one of those surfaces except the state chips. `textFaint` (decoration only) ≥ 3:1 on `surface` and `bg`. `accent` ≥ 3:1 on `surface`. `onAccent` ≥ 4.5:1 on `accentHover` and on the hovered button (`accentHover` mixed 12% toward `text`), ≥ 3:1 on `accent`. `bg` ≥ 4.5:1 on danger/success/warn fills (badge labels).
- On the pet pill the quota fills (`sageDeep`, `accentText`, `warnText`, `dangerText`) are ≥ 3:1 on the pill and on its track.
- Image overlays must be at least the computed minimum (and never below 0.50). The hint names the failing pair and the minimum. Reusing the built-in light text colours on an image cannot pass (`textMuted` is 4.96:1 on the built-in `bg`); pick darker text.
- State colours keep their meaning: `dangerText` stays red (OKLCH hue 0–50° or 340–360°), `successText` green (105–170°), `warnText` amber (55–105°), `infoText` blue (200–290°), each with chroma ≥ 0.05, at least ΔE 0.08 (OKLab) apart and ≥ 0.06 from the `accent` fill.
- `shadow` must be dark (relative luminance ≤ 0.05) and `highlight` light (≥ 0.7); both are opaque. The host mixes them at fixed per-mode strengths for elevation shadows, glass sheens and the pet pill.
- The pet pill is checked over a black and a white desktop: `text` and `textMuted` ≥ 4.5:1, `quotaFill` and `quotaWarn` ≥ 3:1 on the pill and on the quota track.

Omitted optional colours are derived deterministically or take the mode's built-in value (spec §3.2, §3.5, §3.7): `dangerText`, `successText`, `warnText`, `scrim`, `infoText`, `shadow`, `highlight` and the `sage` family use the built-in value; the rest are derived from your required colours. `accentHover` is `accent` mixed toward `text` by the first of 0.20, 0.25 … 0.60 that keeps `onAccent` at 4.5:1.

## Safety: host-enforced invariants

A theme colours every panel-window surface, including permission and risk prompts, the plugin install sheet, plugin content frames, confirmation dialogs, the server health banner and the theme controls. There are no protected regions; instead the host guarantees what matters for a decision: layout, labels, the risk badge text and hold-to-allow are host code a theme cannot change, every text token is checked on every surface it can appear on (above), state colours must keep their hue, and the focus ring stays visible. A background image only ever paints the panel backdrop, dimmed by an overlay of at least 0.50 and never clickable.

The pet window follows the theme of the pet appearance's mode (dark, light, or the panel's): bubbles, the permission bubble, the status pill, state dots, badges and the edge handle are derived from your colours (translucent `surface` over the desktop, checked over black and white as above); `petStatus` additionally overrides the pill. The pet window receives colours only: no fonts, radii, images or blur. State dots and quota bars keep their meaning through the state colours (success/danger/warn, hue-checked), thinking/tool use `accentText`, idle/offline `textMuted`/`textFaint`; `petStatus` cannot change the critical (< 20 %) quota colour, which is always `dangerText`. Provider identity (Claude) uses the `sage` family and is always shown with the provider name. The sprite and its aura come from the pet artwork, not the theme.

## My themes and the theme editor

Users can also make their own themes without any plugin (General → Appearance → **Customize…**, **My themes**, and the same list after your theme list in your plugin's tab). The editor is host code; no plugin code runs in it. What it means for you:

- **Your theme can be a starting point.** "Start from" lists every installed plugin theme. The copy takes your colours, gradients, radii, pet pill colours and `userImage` settings; packaged fonts and packaged background images are not copied (a My theme only uses system font stacks and the user's own image). The copy is the user's: later updates of your plugin do not change it.
- **The same validator.** A My theme is converted into a `panelThemes` entry and checked by the exact rules above before it is saved and before it is applied. The editor lists every failing pair (not just the first) with the measured ratio, the minimum and a suggested value: the nearest OKLCH lightness that clears that colour without breaking any other pair (state colours are first moved to their hue band). `minOverlay` is shown and suggested for an image dim.
- **Palette generators.** From one seed colour the host lays out both modes on fixed OKLCH lightness steps, pins danger/success/warning/info to their hue bands and repairs the result with up to four rounds of the validator's own suggestions. Every tested seed passes; if a palette still has issues, the editor lists them and Save stays off until they are fixed. From an image it samples the user's background (≤ 128 px) with k-means in OKLab (fixed seeding and iterations) and uses the largest colourful cluster as the seed.
- **Slots and the read API do not change.** A My theme occupies the same light/dark slot as a plugin theme; applying one replaces yours, and `--ap-*` / `api.theme` report its colours exactly like a plugin theme's. Your plugin is never told whether the active theme is yours, a My theme or built-in, and gets no My-themes create, change or delete events or identifiers; saving the applied My theme with new colours reaches you as an ordinary `theme.onDidChange`, like any theme switch.
- **Storage.** Up to 50 themes in `userData/panel-themes-user/<id>.json` (one file each, ≤ 16 KiB). Export/import uses `{ "format": "agent-pets-panel-theme", "schemaVersion": 1, "name", "definition" }` with colours and settings only; images and paths are never exported. Imports are parsed strictly (unknown keys reject) and validated before they are saved.

## Reading the theme in your plugin (`--ap-*`, Host API `theme`)

Any plugin can follow the theme the user is looking at; this needs no permission and no `panelThemes` contribution. The values are the active theme for the panel's current light/dark mode, or the built-in palette when no theme is active, the theme plugin is disabled, the mode has no theme, or Windows high-contrast (`forced-colors`) is on.

- **Panel pages**: every `--ap-*` property is set on the page's root before your first script runs (the preload reads the current snapshot synchronously and sets it through CSSOM, so the page CSP is unchanged; it is also written inline on `<html>` once the element exists) and updated live when the theme or mode changes. Use `var(--ap-surface, #292420)` with your own fallback for standalone previews.
- **Worker and panel page**: `api.theme.get()` returns `{ apiVersion: 1, mode: 'light' | 'dark', tokens }`; `api.theme.onDidChange(callback)` returns an unsubscribe function. Change events are coalesced (one event per 100 ms burst, never a duplicate of the previous snapshot). Each callback receives its own frozen copy.

| Token | Meaning | Guarantee (validated per mode) |
| --- | --- | --- |
| `--ap-bg` | Page background | Opaque |
| `--ap-surface`, `--ap-surface-2` | Raised surfaces (cards, inputs) | Opaque |
| `--ap-text`, `--ap-text-secondary`, `--ap-text-muted` | Text levels | ≥ 4.5:1 on `bg`, `surface`, `surface-2` |
| `--ap-accent` | Accent fill (primary button) | ≥ 3:1 on `bg` |
| `--ap-accent-hover` | Accent fill on hover/press | `on-accent` ≥ 4.5:1 on it |
| `--ap-accent-text` | Accent-coloured text and links | ≥ 4.5:1 on `bg` |
| `--ap-on-accent` | Text and icons on `accent` | ≥ 3:1 on `accent`, ≥ 4.5:1 on `accent-hover` |
| `--ap-border`, `--ap-border-soft` | Borders and dividers | Translucent |
| `--ap-focus` | Focus ring | Equals `accent-text`, the app's own focus ring (≥ 3:1 on every surface) |
| `--ap-danger`, `--ap-success`, `--ap-warn` | State text | ≥ 4.5:1 on `surface`/`surface-2`; hue stays red / green / amber |
| `--ap-info` | Informational text | The theme's `infoText` (built-in blue when omitted), ≥ 4.5:1 on `surface`/`surface-2`/`bg`; hue stays blue |
| `--ap-scrim` | Modal backdrop | Alpha ≥ 0.3 |
| `--ap-shadow` | Shadow colour (mix it with your own alpha, e.g. `color-mix(in srgb, var(--ap-shadow) 30%, transparent)`) | Opaque, relative luminance ≤ 0.05 |
| `--ap-highlight` | Glass highlight / sheen colour | Opaque, relative luminance ≥ 0.7 |
| `--ap-radius-sm`, `--ap-radius-md`, `--ap-radius-lg` | Corner radii | `Npx`, sm ≤ md ≤ lg |
| `--ap-font-body`, `--ap-font-heading` | Font-family lists | Local and generic families only |
| `--ap-font-scale` | Font-size multiplier | Unitless, 0.92–1.15 |

Colours are always `rgb(R G B / A)`. A theme's packaged fonts are registered only in the settings panel, so the font lists leave them out and start at the theme's next fallback. The token list is the apiVersion 1 contract: names and formats do not change; new tokens may be added.

The snapshot carries no plugin or theme id, image, font file, path or user-imported background, and it is identical for every plugin. Because the colours are the ones on screen, a plugin could guess which theme is active by comparing values; this is accepted as display information and is why no permission is asked for.

```js
export default {
  async activate(api) {
    const theme = await api.theme.get()
    api.log.info('Mode', theme.mode, theme.tokens['--ap-accent'])
    api.theme.onDidChange(next => api.log.info('Theme changed to', next.mode))
  },
}
```

## Packaging and the catalog

A package with themes is an asset package: ≤ 25 MiB and ≤ 64 files; background images ≤ 8 MiB, 64–4096 px per side, ≤ 8.39 MP, static, EXIF orientation 1; fonts ≤ 1 MiB. Catalog versions with `panelThemes` must set `"minAppVersion": "1.12.0"`; older apps hide them. Consent shows "Provide N panel themes" (low) and, with fonts, "Include custom fonts for the panel" (medium); adding themes or fonts asks again.
