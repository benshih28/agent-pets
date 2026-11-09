# What's new for plugin authors in 1.12

Agent Pets 1.12.0 adds a theme contract that plugins can contribute and read. Nothing in apiVersion 1 was removed; existing plugins keep working. Items marked **check** may change how your plugin looks.

## Contribute panel themes (`contributes.panelThemes`)

- A new data-only contribution: 1–8 themes with light and/or dark colour sets, optional packaged `.woff2` fonts, font scale, corner radii and a solid, gradient or packaged-image background. A themes-only plugin needs no Worker, no `entry` and no permissions. Full reference: [Panel themes](panel-themes.md).
- A theme colours every surface of both windows, including permission and risk prompts and the pet window. Instead of protected regions, the host rejects any theme that breaks its invariants: every text colour ≥ 4.5:1 on every surface it can appear on (pet bubbles and pill over black and white desktops), focus ring ≥ 3:1, state colours keep their hue (danger red, success green, warn amber, info blue) and stay apart from each other and from the accent. Rejections name the key, the pair, the measured ratio and the minimum.
- Colour keys: 10 required (`bg`, `surface`, `surface2`, `text`, `textSecondary`, `textMuted`, `accent`, `accentText`, `onAccent`, `border`) and 21 optional (`surfaceWarm`, `surfaceSage`, `surfaceSageSoft`, `surfaceOff`, `textFaint`, `accentHover`, `accentGlow`, `accentTrack`, `accentOnHover`, `sage`, `sageDeep`, `sageDark`, `sageTrack`, `borderSoft`, `dangerText`, `successText`, `warnText`, `scrim`, `infoText`, `shadow`, `highlight`). `borderOnAccent` is deprecated: it is still accepted and checked so existing manifests stay valid, then ignored.
- `modes.<mode>.petStatus` additionally overrides the pet's status pill.

## Packaging, consent and the catalog

- Fonts must be `.woff2` (checked by its `wOF2` magic), ≤ 1 MiB each, at most 4 faces per theme and 8 font files per plugin, and every packaged `.woff2` must be referenced by a theme; unreferenced font files reject the package. Remote fonts and TTF/OTF files are not accepted. Background images are PNG or WebP (≤ 8 MiB, 64–4096 px per side, static, EXIF orientation 1). A package with themes may be up to 25 MiB and 64 files. See [Packaging and versioning](packaging-and-versioning.md) and [Limits](limits.md).
- The install sheet shows "Provide N panel themes" (low) and, with fonts, "Include custom fonts for the panel" (medium). Adding themes or fonts in an update asks again.
- Catalog versions with `panelThemes` must set `"minAppVersion": "1.12.0"`. Apps older than 1.12.0 hide versions that declare `minAppVersion`; 1.12.0+ skips versions that need a newer app and shows "Requires Agent Pets X or later" in Explore. See [Publishing](publishing.md).

## Read the active theme (`--ap-*`, `api.theme`), no permission

- Panel pages get 26 `--ap-*` custom properties on the root before your first script runs (set through CSSOM from a synchronous snapshot, also inline on `<html>`), updated live when the user's theme or light/dark mode changes: `--ap-bg`, `--ap-surface`, `--ap-surface-2`, `--ap-text`, `--ap-text-secondary`, `--ap-text-muted`, `--ap-accent`, `--ap-accent-hover`, `--ap-accent-text`, `--ap-on-accent`, `--ap-border`, `--ap-border-soft`, `--ap-focus`, `--ap-danger`, `--ap-success`, `--ap-warn`, `--ap-info`, `--ap-scrim`, `--ap-shadow`, `--ap-highlight`, `--ap-radius-sm`, `--ap-radius-md`, `--ap-radius-lg`, `--ap-font-body`, `--ap-font-heading`, `--ap-font-scale`.
- `api.theme.get()` and `api.theme.onDidChange(callback)` work in the Worker and on panel pages and need no permission. Changes are coalesced to one event per 100 ms burst and never repeat the previous snapshot.
- `--ap-focus` equals `--ap-accent-text`, the app's own focus ring (≥ 3:1 on every surface; the accent fill is not, it can be about 2.9:1 on light surfaces).
- `--ap-info` is the theme's `infoText`, or the built-in blue (`rgb(46 91 140 / 1)` light, `rgb(156 195 240 / 1)` dark) when the theme omits it or no theme is active. It is ≥ 4.5:1 on `surface`, `surface-2` and `bg`.
- Put text on an accent fill on `--ap-accent-hover`, not `--ap-accent`: `--ap-on-accent` is guaranteed 4.5:1 on `--ap-accent-hover` and only 3:1 on `--ap-accent`.
- Under Windows high contrast (`forced-colors`) and when no theme is active, the tokens carry the built-in palette.

## Users can make their own themes (check)

- Users get a host-rendered theme editor and **My themes** (up to 50), also shown after your theme list in your plugin's tab. They can start from any installed plugin theme; the copy takes colours, gradients, radii, pet pill colours and `userImage` settings, not your fonts or packaged images. See [My themes and the theme editor](panel-themes.md#my-themes-and-the-theme-editor).
- A My theme uses the same validator and the same light/dark slots as plugin themes; applying one replaces your theme. `--ap-*` and `api.theme` report it like any theme and never reveal whose theme is active.

## Changed defaults (check)

- **`_shared/tokens.css` legacy colour names follow `--ap-*`.** `--surface-panel`, `--surface-raised`, `--text-primary`, `--text-muted`, `--accent`, `--border-subtle`, `--state-*` and the other colour names in [UX guidelines](ux-guidelines.md) are now aliases of the theme the user sees, light or dark, plugin theme or built-in. They used to be a fixed dark glass palette (`--surface-panel` was a dark translucent fill, `--text-primary` near-white). A page that relied on that dark palette, or hard-coded `color-scheme: dark`, can now render dark text on a light surface correctly only if it uses these names consistently; set `color-scheme` from `api.theme` (see the [examples](examples.md)). `--ap-*` remains the documented colour contract.
- **Thinking and tool-running use the accent text colour.** The status dot, mini ring and session rows for `thinking` and `tool-running` (including statuses a plugin sends with `agent.emit`) are drawn with the theme's `accentText` instead of the former fixed periwinkle `#8b9cf7`; success, error and waiting use the state colours, idle `textMuted`, offline `textFaint`. Each state is still shown with its label.
- **The pet window follows the theme** of the pet appearance's mode; plugin bubbles keep their "from plugin" border tint from the `sage` family.
