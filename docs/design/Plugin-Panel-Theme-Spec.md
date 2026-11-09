# Plugin Panel Theme Contract (`panelThemes`), Agent Pets 1.12.0

Status: design, ready to implement. Target version: **1.12.0** (minor: new public contract and security boundary).
Repo baseline: `main` @ 1.11.3 (`6a595e0`).

## 0. Implementation revisions (binding; supersede the sections they name)

Decided during implementation on `feat/panel-themes`. The manifest shape, field names, grammars, limits, consent units and `minAppVersion` semantics are unchanged except for the additive `petStatus` group (§3.7).

| # | Section | Decision |
|---|---|---|
| R1 | §3.5 | `accentHover` (when omitted) = `mix(accent, text, t)` for the first `t` in 0.20, 0.25 … 0.60 with `onAccent` ≥ 4.5:1 on it; 0.20 when none passes (then rejected). With only the 10 required built-in light colours a fixed 0.20 gave 4.43:1. |
| R2 | §2.2, §4.1, §6.1 | Every `overlay.color` must be opaque (alpha 1); `Q_K` assumes it. |
| R3 | §6.1 | Image backdrops `P_K` and `Q_K` are composited **unrounded** (floats in 0–255). Gradient midpoints use `mix()` and are rounded. Translucent foregrounds are composited unrounded. |
| R4 | §6.1 | `minOverlay` is suffix-closed: the smallest `a` on the 0.01 grid in [0.50, 0.95] such that **every** step from `a` to 0.95 passes. Identical to §6.1 when contrast is monotonic in `a`; it guarantees any dim the user picks at or above the minimum passes. |
| R5 | §5.2 | Image diagnostics name the failing pair, ratio and minimum, e.g. `x.light.background.overlay.opacity: 0.6 < minimum 0.86; text 3.87:1 < 4.5:1 on white image pixel` or `… no overlay up to 0.95 passes (textMuted 4.47:1 < 4.5:1 on black image pixel at 0.95)`. |
| R6 | §8 | Theme selection moved to **Settings → Plugins → <plugin> → Panel themes** (see revised §8). General → Appearance keeps only a status card with *Open plugin settings* and *Restore built-in*. |
| R7 | §3.7 (new) | Additive `modes.<mode>.petStatus` colours for the pet status pill — the one narrow exception to "the pet window is never themed". |
| R8 | §4.2, §7.2 | Web fonts are CORS requests and Chromium refuses CORS for custom schemes unless they are `corsEnabled`. The `agent-pets` scheme is now `corsEnabled`; only the `panel-theme` route sends `Access-Control-Allow-Origin`, and only for the trusted panel origin (`agent-pets://app`, or the Vite origin in dev). Verified in the isolated runner: without it the font request is blocked; with it the bytes reach OTS. |
| R9 | §5.2 | Diagnostics travel on the failed result (`{ ok: false, error: 'invalid_panel_theme', diagnostic }`) of developer-folder installs and are shown in the error toast; there is no plan for an invalid manifest. |
| R10 | §15 | Verified: `check-contrast.mjs` resolves `--organic-*` → `--builtin-organic-*` aliases including the dark block (no change needed). `ConfirmDialog`/`Dialog` mount inline inside `.status-panel` (no Teleport), so `.host-protected` matters. The packaged-app CSP is the `index.html` meta tag. |
| R12 | §6.1 | State colours keep their meaning (validated per mode, rejects with the measured value): OKLCH hue of `dangerText` in 0–50° or 340–360°, `successText` 105–170°, `warnText` 55–105°, each chroma ≥ 0.05; OKLab ΔE ≥ 0.08 between the three state colours and ≥ 0.06 from the `accent` fill. The built-in palettes and the §2.1 example pass. |
| R13 | §16.4 | Implemented in 1.12.0 (step 1 of §16): the `--ap-*` read API. 24 tokens (`src/types/plugin-theme.ts`, table in `docs/plugins/panel-themes.md`) built in main from the active slot for the panel's effective mode (`panel-theme-appearance-set`, panel main frame only, `{ mode, forcedColors }`), built-in under `forced-colors` or without an active slot. Host font aliases are dropped from the family lists (they are registered only in the settings panel and are salt-derived identifiers). `theme.get()` / `theme.onDidChange` in the Worker and panel bridge, no permission; pushes are coalesced (100 ms) and de-duplicated at send time; panel pages also get the tokens on `<html>`. `--ap-focus` = accent, `--ap-info` = accentText until the manifest gains an info colour (changed by R14: `--ap-focus` = accentText like the app's focus ring, `--ap-info` = the host info colour). |
| R14 | §3.6, §6.1, §8, §9, §16.3 | Implemented in 1.12.0 (step 2 of §16): one semantic layer for every surface and **host-enforced invariants instead of protected regions**. `.host-protected` is removed; the theme is applied on the panel window's `<html>` and `tokens.css` derives `--color-*` and the legacy `--surface/--text/--accent/--border/--state-*` names from `--organic-*` on `:root`. Invariants (`panelThemeInvariantFailure`, per mode, after the R12 hue rules): every text token (`text`, `textSecondary`, `textMuted`, `accentText`, `dangerText`, `successText`, `warnText`, host `info`) ≥ 4.5 on `surface`, `surface2`, `bg` and on the pet bubble (`surface` α 0.93), pill (`surface` α 0.92) and pet overlay (menus and dialogs, `surface` α 0.98) composited over black and white; `dangerText` on its own colour at 0.12 over `surface`, `surface2`, `bg` and the pet overlay (state chips and the danger button hover); `text`/`accentText` on `surfaceWarm`; `text` on `surfaceSage`/`surfaceSageSoft`; focus ring = `accentText` ≥ 3 on all of them; pill quota fills (`sageDeep`, `accentText`, `warnText`, `dangerText`) ≥ 3 on the pill and its track (`text` α 0.14); `accent` ≥ 3 on `surface`; `onAccent` ≥ 4.5 on `accentHover` and on `mix(accentHover, text, 0.12)` (hovered primary button), ≥ 3 on `accent`; `bg` ≥ 4.5 on danger/success/warn fills (badges); host `info` at OKLab ΔE ≥ 0.08 from the state colours and ≥ 0.06 from `accent`. A host-colour failure names the surface key. Layout, labels, risk badge text and hold-to-allow stay host code. |
| R15 | §3.7, §16.1, §16.5 | Implemented in 1.12.0 (step 2 of §16): the pet window is themed. Bubbles (`surface` α 0.93), the pill (`surface` α 0.92, track `text` α 0.14), the glass layer, badges (`bg` label on state fills), state dots (`STATE_COLORS` are `var(--state-*)`: success/danger/warn text, thinking/tool `accentText`, idle `textMuted`, offline `textFaint`) and quota bars (normal `sageDeep`, Claude `accentText`, low `warnText`, critical `dangerText`) derive from the palette of the pet appearance's mode; the R14 invariants cover them over black and white desktops. Agent brand: Claude uses the `sage` family (identity, always labelled), not a theme-proof constant. The sprite aura falls back to `--organic-highlight`. Only colours reach the pet window (`PET_THEME_COLOR_PROPERTIES` + `petStatus`). |
| R16 | §2.3, §2.4, §3.2, §3.5, §6.1, §16.2 | Implemented in 1.12.0 (step 3 of §16): extended manifest keys `infoText`, `shadow`, `highlight` (optional, opaque, "B": the mode's built-in value when omitted; the host palette entries `info-text`, `shadow`, `highlight` are now themable, 31 colour properties). `infoText` joins the R12 rules (OKLCH hue 200–290°, chroma ≥ 0.05, ΔE ≥ 0.08 from danger/success/warn, ≥ 0.06 from `accent`) and the R14 text matrix; `shadow` relative luminance ≤ 0.05, `highlight` ≥ 0.7. `borderOnAccent` is deprecated: accepted, grammar- and alpha-checked, never emitted (`PANEL_THEME_DEPRECATED_COLOR_KEYS`). `accentOnHover` stays: it is the hover wash `--color-hover` of the setup wizard and Project MCP panel. The R14 matrix gains every pair the components actually render (audited from `background`/`color` rules): `sageDeep`/`sageDark` text on `surface`, `surface2`, `bg`, `surfaceSage` (+ `sageDark` on `surfaceSageSoft`); the `accentOnHover` wash over `surface`/`surface2`/`surfaceWarm`/`surfaceSage` with the text of those rows; danger/success/warn chips (own colour at 0.12, `PANEL_THEME_STATE_TINT_ALPHA`) over `surface`/`surface2`/`bg`; `textFaint` ≥ 3 on `bg`. Components that drew text on unvalidated pairs now use validated ones (badge on an active segment = `accentHover` on `onAccent`; "new" achievement badge = `onAccent` on `accentHover`; wizard/MCP pending chips = `accentText` on `surface`). `--ap-info` = the theme's `infoText`; `--ap-shadow` and `--ap-highlight` are added (26 tokens). |
| R17 | §7.1, §16.5 | "Validation cached by theme hash" was not met: the runtime cached resolved themes by `id@version`, so a developer-folder reload that changed colours without a version bump kept the stale theme. `PanelThemeResolveCache` (`electron/main/panel-theme-cache.ts`) keys by the SHA-256 of the key-sorted declared `panelThemes` (memoised per manifest object), is LRU-bounded at 32 entries, and `sync` drops every key no installed plugin uses (removal, update to different content). A plugin without a loaded manifest keeps its last result for that `id@version`. Invalid declarations cache as `null`. |
| R18 | §3.4, §3.7, §8 | Shadow and sheen strengths are per mode and equal to 1.11.5 (light: soft shadows, bright glass; dark: deeper shadows, faint glass and a dark `text-shadow` under pet text): `--elevation-*` and `--pet-*-strength` on `:root` / `:root[data-theme='dark']` and on `.panel-theme-preview[data-mode]`, so a preview uses the previewed mode instead of the panel's. The composite elevation tokens moved to the semantic block that is re-resolved on the preview. The pill, tooltip and edge-handle gloss is `--pet-gloss` (highlight colour, 60 % light / 8 % dark) instead of a text-coloured wash. |
| R19 | §8 | A plugin that contributes `panelThemes` shows its theme list as the main content of its dashboard tab (`PluginThemeTab`, which hosts the shared `PluginPanelThemes` as its first section; a later host theme editor is meant to mount as the next section). Plugin tabs only render the sections a plugin can use (`pluginTabSections`: panel view, panel themes, notifications only with `contributes.feed`, commands, settings only with a non-empty schema); a plugin with none of them (skins only) gets no tab. With a `panelView` the view fills the tab and the header links to the detail page's Panel themes. The detail page section stays. *Open plugin settings* on the Appearance card and the settings search hit open the tab when it exists, otherwise the detail page section. |
| R20 | §1, §8 (new) | Implemented in 1.12.0 (step 4): **My themes**, user-made themes that need no plugin. A My theme is a closed definition (`src/types/panel-theme-user.ts`): all 31 colour keys per mode (no derivation; the editor always declares every key), optional full pet pill set, background `solid` or linear/radial gradient (2–5 opaque stops), optional user image settings `{ fit, overlayColor, dim }`, typography as ids of fixed system font stacks (`builtin`, `system`, `rounded`, `humanist`, `serif`, `mono`; no font files), scale 0.92–1.15, radii. Both modes are required. It is converted into a `panelThemes` entry (`userPanelThemeContribution`) and parsed by `parsePanelThemes`, so it can never bypass a rule. In the catalog it is one more source with the reserved owner `_user` (`USER_PANEL_THEME_OWNER`; no plugin id can contain `_`), always available (plugins off does not affect it), labelled "My theme: <name>". |
| R21 | §5.2 | `panel-theme-validate` (panel main frame only, one payload ≤ 16 KiB serialised, no extra arguments) validates a draft without installing: a strict schema error (the bounded structural parse runs first, so a schema error is returned without hashing or caching anything), or every semantic issue as `{ mode, path, kind, problem, foreground?, background?, measured?, required?, suggested? }` (≤ 64 issues) plus `minDim` per mode with an image. The validator's checks are one ordered table (`panelThemeModeIssues`), each check listing the keys it reads (an issue's `path` is always one of them), with a key → checks index per input shape; `parsePanelThemes` reports its first item with unchanged text, the editor walks all of them, so both always agree. `suggested` is per key: the nearest OKLCH lightness (0.01 steps, both directions, chroma reduced into sRGB) that removes every issue of that key without adding any new issue; state colours with a hue/chroma issue are first moved to a typical hue of their band (27°/140°/75°/250°, chroma ≥ 0.09); overlay issues suggest the computed minimum. A candidate replaces one key, so only the checks reading that key are re-run (`panelThemeModeIssuesReading`); for contrast, luminance and direction issues each lightness direction is binary-searched for the step where the key's original issues disappear, then scanned outwards for the first fully accepted step, which returns the same nearest step as a linear scan. Each mode is capped at 1,600 candidate evaluations; the worst case (every key mid-grey) takes about 6 ms. Only parsed definitions are cached by content hash in a `ContentHashCache` (the R17 LRU generalised). |
| R22 | §7.1 | Storage `userData/panel-themes-user/<id>.json` (`id` = `u-` + 12 hex), one schema-versioned record per theme (`{ schemaVersion: 1, id, name, createdAt, updatedAt, definition }`), directory 0o700, files 0o600, temporary file + rename, ≤ 16 KiB, ≤ 50 themes. Reads lstat, refuse symlinks and non-regular files, open with `O_NOFOLLOW` and compare dev/ino; corrupt, oversized or mismatched files are renamed to `<file>.corrupt-<ms>` and skipped, keeping the newest 5 backups; a record with a newer `schemaVersion` (after a downgrade) is left untouched, hidden, counted toward the limit and never given to a new id; stale temporary files are removed; the directory is read with `opendir`, at most 116 theme and temporary files and 4,096 raw entries (either cap marks the scan truncated). Every create/update/duplicate/import runs the validator first. IPC (panel main frame only): `panel-theme-user-list/create/update/rename/duplicate/delete/export/import`; names must be strings of ≤ 192 UTF-16 units before normalisation; `update(id, definition, name?)` writes the definition and an optional new name in one temporary-file + rename (`rename` stays for rename-only); applying uses `panel-theme-slot-set` with the `_user` owner. Deleting a theme prunes slots that use it (that mode returns to built-in) and its user images (`panel-theme-images/_user/`), through the same prune as plugin updates; prune removes a `_user` slot or image only when the store was fully scanned and the id is absent on disk (unsafe or truncated → keep everything; unreadable, newer-schema or over-limit files count as present), and an image only when the record's own definition turns that mode's image off — a record a stricter validator now rejects keeps both; the startup orphan sweep keeps the `_user` directory. Export writes `{ format: "agent-pets-panel-theme", schemaVersion: 1, name, definition }` through a native save dialog (temporary file + rename; the default file name keeps letters and numbers in any script, drops separators, control/format and Windows-reserved characters and device names, ≤ 40 code points; dialog filter names are localised); import reads one regular file ≤ 16 KiB through a native open dialog and accepts exactly those four keys. New error codes `theme_limit_reached`, `theme_not_found`, `theme_import_invalid`. |
| R23 | §7.2 | Palette generators (`src/utils/panel-theme-palette.ts`, deterministic): seed → both modes on fixed OKLCH lightness steps (neutrals tinted with ≤ 0.03 chroma, accent chroma 0.02–0.16, state colours pinned to their bands), then at most 4 rounds of the validator's own suggestions (covers every tested seed: greys, black/white, every 10° of hue, chroma to the gamut edge). Image → canvas sample ≤ 128 px per side → k-means in OKLab (deterministic farthest-point seeding from the median-lightness sample, 8 iterations, k = 6, O(n·k), transparent pixels ignored) → seed = largest weight × (0.25 + chroma), neutral hue = largest cluster. To read the pixels the editor loads the image with `crossOrigin`; the `panel-theme` route therefore also sends `Access-Control-Allow-Origin` for user images, only for the trusted panel origin (fonts already did, R8). Packaged images still get none. |
| R24 | §8 | The theme editor is host-rendered (`PanelThemeEditor.vue`, its own lazily loaded chunk with its own lazily loaded `themeEditor` locale domain): one full-panel dialog opened from General → Appearance (**Customize…**: edits the active My theme, or starts from the active plugin theme, else built-in) and from **My themes** (Appearance card and the theme plugin's tab `#after-list`). Start from blank (neutral generated palette), built-in, any plugin theme or another My theme; light and dark edited separately; each key has a native picker, a text field (any manifest colour grammar), OKLCH fine-tune and a usage tooltip; background, typography and radii sections; a live preview of both modes with the same property map and semantic layer as the settings previews (card, button states, menu, toast, dialog, inline permission card with the HIGH badge, pet pill). Validation is debounced 150 ms; stale results are dropped; Save and Use are enabled only when the validation belongs to the current draft and is fully valid; undo (50 steps), reset, an unsaved-changes confirmation and export/import. |
| R11 | §3.1 | `--panel-theme-background` and the `--pet-status-*` hooks are declared `initial` (guaranteed-invalid) in `tokens.css`, so `var()` fallbacks apply until a theme sets them. |

## 1. Goals / non-goals

### Goals
1. A **declarative, data-only** contribution `panelThemes`: no Worker, no plugin code in any renderer, no raw CSS. It follows the `skins` precedent (workerless allowed).
2. A plugin can restyle the **settings/status panel window** (`.status-panel` in the `#panel` window): text, surface, accent, border and state colours, radii, font families, font scale, and background (solid, gradient, packaged image).
3. **Light and dark are first-class.** Each theme declares `modes.light` and/or `modes.dark`. Every mode has its own complete colour set, its own background (and its own packaged image) and its own optional user-image slot. Contrast is validated separately per mode.
4. **User-imported background image**, host-mediated: native dialog in main, strict header validation, stored in userData, served through a host protocol. The plugin never sees the path or the bytes and does not learn the image exists.
5. The built-in theme is always one click away. A disabled, removed, broken or incompatible plugin always falls back to built-in.
6. Permission/risk UI and plugin-content markers can never be restyled or spoofed by a theme.

### Non-goals (1.12.0)
- Theming the **pet window** (pet sprite, pet bubbles, status pills, `PermissionBubble`). It keeps its own pet appearance (`data-pet-theme`).
- Theming the Setup Wizard (`.setup-overlay`) or Project MCP panel (`.mcp-overlay`) (superseded by §16). Plugin `panelView` pages keep the static `_shared/tokens.css` and additionally receive the read-only `--ap-*` tokens (R13).
- Shadows, spacing, font weights, motion, z-index, the quota/data-visualisation colours (`--organic-quota-*`), the pet-layer `--organic-status-*` tokens.
- Backdrop blur / glass on panel surfaces.
- A Host API for theme contributions (`hostApi: null`). No plugin can change the active theme; any plugin can read it through the R13 read API.
- Remote URLs of any kind; JPEG or TTF inside packages.

## 2. Manifest shape

### 2.1 Full example (`plugin.json`, workerless)

```json
{
  "id": "panel-theme-collection",
  "name": { "zh-TW": "面板主題合集", "en-US": "Panel Theme Collection" },
  "version": "1.0.0",
  "apiVersion": "1",
  "author": "Ponpon55837",
  "icon": "assets/icon.png",
  "permissions": {},
  "contributes": {
    "panelThemes": [
      {
        "id": "sakura",
        "displayName": { "zh-TW": "櫻花", "en-US": "Sakura" },
        "description": { "zh-TW": "淡粉色水彩與深梅色夜晚。", "en-US": "Soft watercolour pink by day, deep plum at night." },
        "fonts": [
          { "id": "nunito", "src": "fonts/nunito-400.woff2", "weight": 400, "style": "normal" },
          { "id": "nunito", "src": "fonts/nunito-600.woff2", "weight": 600, "style": "normal" },
          { "id": "nunito", "src": "fonts/nunito-700.woff2", "weight": 700, "style": "normal" }
        ],
        "typography": {
          "body": ["@nunito", "PingFang TC", "Microsoft JhengHei", "system-ui", "sans-serif"],
          "heading": ["@nunito", "PingFang TC", "Microsoft JhengHei", "sans-serif"],
          "scale": 1.0
        },
        "shape": { "radiusSm": 8, "radiusMd": 14, "radiusLg": 24 },
        "modes": {
          "light": {
            "colors": {
              "bg": "#fbf1f3",
              "surface": "#fffafb",
              "surface2": "#f6e6ea",
              "text": "#2a1d22",
              "textSecondary": "#5c4750",
              "textMuted": "#6a5560",
              "accent": "#b4446a",
              "accentText": "#8f2f52",
              "onAccent": "#ffffff",
              "border": "rgb(42 29 34 / 0.16)"
            },
            "background": {
              "type": "image",
              "src": "backgrounds/sakura-light.webp",
              "fit": "cover",
              "position": "top-right",
              "opacity": 1,
              "blur": 0,
              "overlay": { "color": "#fbf1f3", "opacity": 0.9 }
            },
            "userImage": {
              "allowed": true,
              "fit": "cover",
              "overlay": { "color": "#fbf1f3", "opacity": 0.9 }
            }
          },
          "dark": {
            "colors": {
              "bg": "#1c1418",
              "surface": "#261b21",
              "surface2": "#31242b",
              "text": "#f6e9ee",
              "textSecondary": "#d7c3cc",
              "textMuted": "#b9a3ad",
              "accent": "#e07a9c",
              "accentText": "#f2a7c0",
              "onAccent": "#1c1418",
              "border": "rgb(246 233 238 / 0.18)"
            },
            "background": {
              "type": "gradient",
              "kind": "linear",
              "angle": 160,
              "stops": [ { "color": "#1c1418", "at": 0 }, { "color": "#2a1824", "at": 100 } ]
            },
            "userImage": {
              "allowed": true,
              "overlay": { "color": "#1c1418", "opacity": 0.88 }
            }
          }
        }
      }
    ]
  }
}
```

(The example colours were hand-checked against the §6 pairs. Run the validator in §13 before shipping.)

### 2.2 Field rules (runtime validator is authoritative; every violation rejects the manifest)

| Path | Rule |
|---|---|
| `panelThemes` | Array, 1–8 items, unique `id`. |
| `id` | `^[a-z0-9-]{1,32}$`. |
| `displayName` | Bilingual, 1–48 chars per locale (`parseLocalizedText(…, 48)`). |
| `description` | Optional, bilingual, 1–120 chars per locale. |
| `fonts[]` | Optional, ≤ 4 faces per theme. `id` `^[a-z0-9-]{1,32}$` (faces with the same id form one family). `src` is a safe relative `.woff2` path. `weight` ∈ {400, 600, 700}, default 400. `style` ∈ {`normal`, `italic`}, default `normal`. No duplicate (`id`, `weight`, `style`). ≤ 8 distinct font files per plugin. |
| `typography.body` / `.heading` | Optional font-family list, 1–5 entries (grammar in §3.4). The **last entry must be a generic family**. `@id` must name a face in the same theme's `fonts`. |
| `typography.scale` | Optional number 0.92–1.15, at most 2 decimals. Default 1. |
| `shape.radiusSm/Md/Lg` | Optional integers 0–16 / 0–24 / 0–32, with `radiusSm ≤ radiusMd ≤ radiusLg` after defaults are applied. |
| `modes` | Object with only `light` and/or `dark`. At least one is required. |
| `modes.<m>.colors` | Required. 10 required keys plus optional keys (§3.1). Unknown keys reject. |
| `modes.<m>.background` | Optional. Default `{ "type": "solid" }` (§4.1). |
| `modes.<m>.userImage` | Optional `{ allowed: true, overlay, fit? }` (§4.3). |

Workerless rule (change to `plugin-manifest.ts`). `entry` may be omitted only when `permissions` is `{}` and **every** key in `contributes` is a workerless contribution (`skins`, `panelThemes`) with at least one non-empty array. This replaces today's "exactly one key, skins" check (`plugin-manifest.ts` ~L396). A plugin may also combine `panelThemes` with a Worker and other contributions.

### 2.3 JSON-Schema fragment (`docs/plugins/plugin.schema.json`)

Add under `properties.contributes.properties`:

```json
"panelThemes": {
  "description": "Declarative panel themes. Data only; validated and normalised by the host. Requires Agent Pets 1.12.0+.",
  "type": "array", "minItems": 1, "maxItems": 8,
  "items": { "$ref": "#/$defs/panelTheme" }
}
```

Add under `$defs`:

```json
"panelThemeDescription": { "type": "object", "additionalProperties": false, "required": ["zh-TW", "en-US"], "properties": { "zh-TW": { "type": "string", "minLength": 1, "maxLength": 120 }, "en-US": { "type": "string", "minLength": 1, "maxLength": 120 } } },
"panelThemeColor": { "type": "string", "minLength": 4, "maxLength": 64, "pattern": "^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?|oklch)\\([0-9a-z.%,/ ]{1,56}\\))$" },
"panelThemeWoff2Path": { "allOf": [{ "$ref": "#/$defs/relativePath" }, { "type": "string", "pattern": "\\.[wW][oO][fF][fF]2$" }] },
"panelThemeFamilyList": { "type": "array", "minItems": 1, "maxItems": 5, "items": { "type": "string", "pattern": "^(?:@[a-z0-9-]{1,32}|[A-Za-z0-9](?:[A-Za-z0-9 -]{0,46}[A-Za-z0-9])?)$" } },
"panelThemePosition": { "enum": ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] },
"panelThemeFit": { "enum": ["cover", "contain", "tile"] },
"panelThemeOverlay": { "type": "object", "additionalProperties": false, "required": ["color", "opacity"], "properties": { "color": { "$ref": "#/$defs/panelThemeColor" }, "opacity": { "type": "number", "minimum": 0.5, "maximum": 0.95 } } },
"panelThemeColors": {
  "type": "object", "additionalProperties": false,
  "required": ["bg", "surface", "surface2", "text", "textSecondary", "textMuted", "accent", "accentText", "onAccent", "border"],
  "properties": {
    "bg": { "$ref": "#/$defs/panelThemeColor" }, "surface": { "$ref": "#/$defs/panelThemeColor" }, "surface2": { "$ref": "#/$defs/panelThemeColor" },
    "surfaceWarm": { "$ref": "#/$defs/panelThemeColor" }, "surfaceSage": { "$ref": "#/$defs/panelThemeColor" }, "surfaceSageSoft": { "$ref": "#/$defs/panelThemeColor" }, "surfaceOff": { "$ref": "#/$defs/panelThemeColor" },
    "text": { "$ref": "#/$defs/panelThemeColor" }, "textSecondary": { "$ref": "#/$defs/panelThemeColor" }, "textMuted": { "$ref": "#/$defs/panelThemeColor" }, "textFaint": { "$ref": "#/$defs/panelThemeColor" },
    "accent": { "$ref": "#/$defs/panelThemeColor" }, "accentHover": { "$ref": "#/$defs/panelThemeColor" }, "accentText": { "$ref": "#/$defs/panelThemeColor" }, "onAccent": { "$ref": "#/$defs/panelThemeColor" },
    "accentGlow": { "$ref": "#/$defs/panelThemeColor" }, "accentTrack": { "$ref": "#/$defs/panelThemeColor" }, "accentOnHover": { "$ref": "#/$defs/panelThemeColor" },
    "sage": { "$ref": "#/$defs/panelThemeColor" }, "sageDeep": { "$ref": "#/$defs/panelThemeColor" }, "sageDark": { "$ref": "#/$defs/panelThemeColor" }, "sageTrack": { "$ref": "#/$defs/panelThemeColor" },
    "border": { "$ref": "#/$defs/panelThemeColor" }, "borderSoft": { "$ref": "#/$defs/panelThemeColor" }, "borderOnAccent": { "$ref": "#/$defs/panelThemeColor" },
    "dangerText": { "$ref": "#/$defs/panelThemeColor" }, "successText": { "$ref": "#/$defs/panelThemeColor" }, "warnText": { "$ref": "#/$defs/panelThemeColor" },
    "scrim": { "$ref": "#/$defs/panelThemeColor" }
  }
},
"panelThemeStop": { "type": "object", "additionalProperties": false, "required": ["color", "at"], "properties": { "color": { "$ref": "#/$defs/panelThemeColor" }, "at": { "type": "integer", "minimum": 0, "maximum": 100 } } },
"panelThemeBackground": {
  "oneOf": [
    { "type": "object", "additionalProperties": false, "required": ["type"], "properties": { "type": { "const": "solid" } } },
    { "type": "object", "additionalProperties": false, "required": ["type", "kind", "stops"], "properties": {
      "type": { "const": "gradient" }, "kind": { "const": "linear" },
      "angle": { "type": "integer", "minimum": 0, "maximum": 359 },
      "stops": { "type": "array", "minItems": 2, "maxItems": 5, "items": { "$ref": "#/$defs/panelThemeStop" } } } },
    { "type": "object", "additionalProperties": false, "required": ["type", "kind", "stops"], "properties": {
      "type": { "const": "gradient" }, "kind": { "const": "radial" },
      "position": { "$ref": "#/$defs/panelThemePosition" },
      "stops": { "type": "array", "minItems": 2, "maxItems": 5, "items": { "$ref": "#/$defs/panelThemeStop" } } } },
    { "type": "object", "additionalProperties": false, "required": ["type", "src", "overlay"], "properties": {
      "type": { "const": "image" }, "src": { "$ref": "#/$defs/iconPath" },
      "fit": { "$ref": "#/$defs/panelThemeFit" }, "position": { "$ref": "#/$defs/panelThemePosition" },
      "opacity": { "type": "number", "minimum": 0.2, "maximum": 1 },
      "blur": { "type": "integer", "minimum": 0, "maximum": 24 },
      "overlay": { "$ref": "#/$defs/panelThemeOverlay" } } }
  ]
},
"panelThemeMode": { "type": "object", "additionalProperties": false, "required": ["colors"], "properties": {
  "colors": { "$ref": "#/$defs/panelThemeColors" },
  "background": { "$ref": "#/$defs/panelThemeBackground" },
  "userImage": { "type": "object", "additionalProperties": false, "required": ["allowed", "overlay"], "properties": {
    "allowed": { "const": true }, "fit": { "$ref": "#/$defs/panelThemeFit" }, "overlay": { "$ref": "#/$defs/panelThemeOverlay" } } } } },
"panelTheme": { "type": "object", "additionalProperties": false, "required": ["id", "displayName", "modes"], "properties": {
  "id": { "type": "string", "pattern": "^[a-z0-9-]{1,32}$" },
  "displayName": { "$ref": "#/$defs/localizedText" },
  "description": { "$ref": "#/$defs/panelThemeDescription" },
  "fonts": { "type": "array", "maxItems": 4, "items": { "type": "object", "additionalProperties": false, "required": ["id", "src"], "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]{1,32}$" }, "src": { "$ref": "#/$defs/panelThemeWoff2Path" },
    "weight": { "enum": [400, 600, 700] }, "style": { "enum": ["normal", "italic"] } } } },
  "typography": { "type": "object", "additionalProperties": false, "properties": {
    "body": { "$ref": "#/$defs/panelThemeFamilyList" }, "heading": { "$ref": "#/$defs/panelThemeFamilyList" },
    "scale": { "type": "number", "minimum": 0.92, "maximum": 1.15 } } },
  "shape": { "type": "object", "additionalProperties": false, "properties": {
    "radiusSm": { "type": "integer", "minimum": 0, "maximum": 16 }, "radiusMd": { "type": "integer", "minimum": 0, "maximum": 24 }, "radiusLg": { "type": "integer", "minimum": 0, "maximum": 32 } } },
  "modes": { "type": "object", "additionalProperties": false, "minProperties": 1, "properties": {
    "light": { "$ref": "#/$defs/panelThemeMode" }, "dark": { "$ref": "#/$defs/panelThemeMode" } } } } }
```

The schema is intentionally coarse for colours. The runtime grammar in §3.3 is authoritative.

### 2.4 Public TypeScript (`docs/plugins/agent-pets-plugin.d.ts`)

```ts
/** sRGB colour string: #hex, rgb()/rgba(), hsl()/hsla() or oklch(). No url(), var(), calc() or named colours. */
export type PluginPanelThemeColor = string
export type PluginPanelThemeMode = 'light' | 'dark'
export type PluginPanelThemeFit = 'cover' | 'contain' | 'tile'
export type PluginPanelThemePosition =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PluginPanelThemeColors {
  bg: PluginPanelThemeColor
  surface: PluginPanelThemeColor
  surface2: PluginPanelThemeColor
  text: PluginPanelThemeColor
  textSecondary: PluginPanelThemeColor
  textMuted: PluginPanelThemeColor
  accent: PluginPanelThemeColor
  accentText: PluginPanelThemeColor
  onAccent: PluginPanelThemeColor
  border: PluginPanelThemeColor
  surfaceWarm?: PluginPanelThemeColor
  surfaceSage?: PluginPanelThemeColor
  surfaceSageSoft?: PluginPanelThemeColor
  surfaceOff?: PluginPanelThemeColor
  textFaint?: PluginPanelThemeColor
  accentHover?: PluginPanelThemeColor
  accentGlow?: PluginPanelThemeColor
  accentTrack?: PluginPanelThemeColor
  accentOnHover?: PluginPanelThemeColor
  sage?: PluginPanelThemeColor
  sageDeep?: PluginPanelThemeColor
  sageDark?: PluginPanelThemeColor
  sageTrack?: PluginPanelThemeColor
  borderSoft?: PluginPanelThemeColor
  borderOnAccent?: PluginPanelThemeColor
  dangerText?: PluginPanelThemeColor
  successText?: PluginPanelThemeColor
  warnText?: PluginPanelThemeColor
  scrim?: PluginPanelThemeColor
}

export interface PluginPanelThemeOverlay { color: PluginPanelThemeColor; opacity: number }
export interface PluginPanelThemeGradientStop { color: PluginPanelThemeColor; at: number }

export type PluginPanelThemeBackground =
  | { type: 'solid' }
  | { type: 'gradient'; kind: 'linear'; angle?: number; stops: PluginPanelThemeGradientStop[] }
  | { type: 'gradient'; kind: 'radial'; position?: PluginPanelThemePosition; stops: PluginPanelThemeGradientStop[] }
  | {
      type: 'image'
      /** Package-relative .png or .webp path. */
      src: string
      fit?: PluginPanelThemeFit
      position?: PluginPanelThemePosition
      opacity?: number
      blur?: number
      overlay: PluginPanelThemeOverlay
    }

export interface PluginPanelThemeUserImage {
  allowed: true
  fit?: PluginPanelThemeFit
  overlay: PluginPanelThemeOverlay
}

export interface PluginPanelThemeModeDefinition {
  colors: PluginPanelThemeColors
  background?: PluginPanelThemeBackground
  userImage?: PluginPanelThemeUserImage
}

export interface PluginPanelThemeFontFace {
  id: string
  /** Package-relative .woff2 path. */
  src: string
  weight?: 400 | 600 | 700
  style?: 'normal' | 'italic'
}

export interface PluginPanelThemeContribution {
  id: string
  displayName: PluginLocalizedText
  description?: PluginLocalizedText
  fonts?: PluginPanelThemeFontFace[]
  typography?: { body?: string[]; heading?: string[]; scale?: number }
  shape?: { radiusSm?: number; radiusMd?: number; radiusLg?: number }
  modes: Partial<Record<PluginPanelThemeMode, PluginPanelThemeModeDefinition>>
}
```

Add `panelThemes?: PluginPanelThemeContribution[]` to `export interface PluginContributions`. `tests/plugin-extension-registry.test.mts` checks this key against the registry.

Internal (`src/types/plugin.ts`): add `panelThemes: { implementationFile: 'electron/plugin-panel-themes.ts', hostApi: null, allowsWorkerlessPlugin: true }` to `PLUGIN_CONTRIBUTION_REGISTRY`, and `panelThemes: PluginPanelThemeContribution[]` to `PluginContributionValueMap`. The type-level coverage assertion enforces both.

## 3. Token allowlist

### 3.1 How themes attach (verified in code)
- `src/styles/tokens.css` defines the panel **palette layer** `--organic-*` on `:root`, re-pointed by `:root[data-theme='dark']`.
- `src/components/StatusPanel.css` (`.status-panel { … }`) maps the palette to semantic aliases (`--surface-panel: var(--organic-bg)`, `--accent: var(--organic-accent)`, `--font-ui: var(--organic-font-body)`, …). Panel components also read `--organic-*` directly (for example `--organic-accent-text` 16×, `--organic-space-*`).
- So a theme sets **only `--organic-*` custom properties, inline on the `.status-panel` element**. Custom properties resolve per element, so `.status-panel`'s own alias declarations pick up the inline values, and every descendant inherits them. Nothing is set on `:root`, so the pet window and the overlays outside `.status-panel` (`SetupWizard`, `ProjectMcpPanel`, siblings in `App.vue`) are untouched.

### 3.2 Colour tokens (per mode). Defaults are the current built-in values in `tokens.css`.

"R" = required. "D" = optional, derived (§3.5) when absent. "B" = optional, built-in value for that mode when absent. "Opaque" = alpha must be exactly 1.

| Manifest key | CSS property set on `.status-panel` | Req | Opaque | Built-in light | Built-in dark |
|---|---|---|---|---|---|
| `bg` | `--organic-bg` | R | yes | `#f5ead8` | `#1f1b16` |
| `surface` | `--organic-surface` | R | yes | `#f9f4ed` | `#292420` |
| `surface2` | `--organic-surface-2` | R | yes | `#eee7db` | `#342e28` |
| `surfaceWarm` | `--organic-surface-warm` | D | yes | `#ffe1d0` | `#4a3022` |
| `surfaceSage` | `--organic-surface-sage` | D | yes | `#e1eecc` | `#2e3622` |
| `surfaceSageSoft` | `--organic-surface-sage-soft` | D | yes | `#f0fae1` | `#263019` |
| `surfaceOff` | `--organic-surface-off` | D | yes | `#dcd3c4` | `#3f372e` |
| `text` | `--organic-text` | R | yes | `#201e1d` | `#f3ede4` |
| `textSecondary` | `--organic-text-secondary` | R | yes | `#645c50` | `#cfc5b6` |
| `textMuted` | `--organic-text-muted` | R | yes | `#6b6354` | `#b0a592` |
| `textFaint` | `--organic-text-faint` | D | yes | `#8a8070` | `#8d8374` |
| `accent` | `--organic-accent` | R | yes | `#c67139` | `#d98652` |
| `accentHover` | `--organic-accent-hover` | D | yes | `#a85a28` | `#e39a6b` |
| `accentText` | `--organic-accent-text` | R | yes | `#8c491a` | `#f0b48a` |
| `onAccent` | `--organic-accent-contrast` | R | yes | `#fff2eb` | `#201e1d` |
| `accentGlow` | `--organic-accent-glow` | D | no | `rgba(198,113,57,.2)` | `rgba(217,134,82,.28)` |
| `accentTrack` | `--organic-accent-track` | D | no | `rgba(32,30,29,.08)` | `rgba(243,237,228,.1)` |
| `accentOnHover` | `--organic-accent-on-hover` | D | no | `rgba(32,30,29,.05)` | `rgba(243,237,228,.06)` |
| `sage` | `--organic-sage` | B | yes | `#7a8a5e` | `#9db07b` |
| `sageDeep` | `--organic-sage-deep` | B | yes | `#56633f` | `#aebf8c` |
| `sageDark` | `--organic-sage-dark` | B | yes | `#3d472b` | `#c9d6ad` |
| `sageTrack` | `--organic-sage-track` | D | no | `rgba(61,71,43,.16)` | `rgba(201,214,173,.18)` |
| `border` | `--organic-border` | R | no | `rgba(32,30,29,.16)` | `rgba(243,237,228,.18)` |
| `borderSoft` | `--organic-border-soft` | D | no | `rgba(32,30,29,.1)` | `rgba(243,237,228,.1)` |
| `borderOnAccent` | (none; deprecated, R16) | — | no | accepted and ignored | accepted and ignored |
| `dangerText` | `--organic-danger-text` | B | yes | `#a62f1e` | `#ff9a8a` |
| `successText` | `--organic-success-text` | B | yes | `#3f5a1c` | `#b6d48a` |
| `warnText` | `--organic-warn-text` | B | yes | `#7a5200` | `#f0c866` |
| `scrim` | `--organic-scrim` | B | no (alpha ≥ 0.3) | `rgba(46,43,37,.42)` | `rgba(0,0,0,.55)` |
| `infoText` (R16) | `--organic-info-text` | B | yes | `#2e5b8c` | `#9cc3f0` |
| `shadow` (R16) | `--organic-shadow` | B | yes (luminance ≤ 0.05) | `#2e2b25` | `#000000` |
| `highlight` (R16) | `--organic-highlight` | B | yes (luminance ≥ 0.7) | `#ffffff` | `#ffffff` |

Translucent tokens have alpha 0.02–0.95, except `border` 0.08–1 and `scrim` 0.3–0.9.

### 3.3 Colour grammar (runtime, `electron/panel-theme-color.ts`)
- The input must be a string ≤ 64 chars with no leading/trailing whitespace and no control characters. Function names are lowercase.
- `NUM = (?:\d{1,3}(?:\.\d{1,4})?|\.\d{1,4})`. No sign, no exponent, no `none`, no `calc()`, `var()`, `url()`, `from`, `currentcolor` or named colours. A `;`, `}`, `\`, quote or `(` beyond the single function call is impossible under these regexes.
- Accepted forms:
  - `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`
  - `^rgba?\((NUM%?), ?(NUM%?), ?(NUM%?)(?:, ?(NUM%?))?\)$` and `^rgba?\((NUM%?) (NUM%?) (NUM%?)(?: / (NUM%?))?\)$`. All three channels use the same unit; numbers are 0–255, percentages 0–100.
  - `^hsla?\((NUM)(?:deg)?, ?(NUM)%, ?(NUM)%(?:, ?(NUM%?))?\)$` and `^hsla?\((NUM)(?:deg)? (NUM)% (NUM)%(?: / (NUM%?))?\)$`. Hue 0–360.
  - `^oklch\((NUM%?) (NUM) (NUM)(?:deg)?(?: / (NUM%?))?\)$`. L is 0–1 or 0–100%, C is 0–0.4, H is 0–360. Conversion: OKLCH → OKLab → LMS → linear sRGB (Ottosson matrices). **If any linear channel falls outside [−0.0001, 1.0001], the colour is rejected (`out_of_gamut`).** Browsers gamut-map by chroma reduction, so clipping would make the checked colour differ from the rendered one.
  - Alpha is 0–1 or 0–100%.
- **Normalisation.** Main converts every colour to `rgb(R G B / A)` with integer R, G, B (0–255) and A rounded to 3 decimals, with no trailing zeros except `1` and `0`. **Contrast is computed on these emitted values.** The renderer only ever receives host-built strings matching `^rgb\((?:25[0-5]|2[0-4]\d|1?\d?\d) (?:…) (?:…) \/ (?:0|1|0\.\d{1,3})\)$` and re-checks them before `setProperty`.

### 3.4 Typography and shape (theme-level, shared by both modes)

Typography and shape are deliberately not per-mode. A system light↔dark switch must be colour-only (repaint, no relayout), and font metrics must not change under the user (see §9).

| Manifest | CSS property | Grammar / range | Default |
|---|---|---|---|
| `typography.body` | `--organic-font-body` | family list | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `typography.heading` | `--organic-font-heading` | family list | `'Lining Digits', Georgia, 'Times New Roman', serif` |
| `typography.scale` | `--organic-font-label` 12, `--organic-font-body-sm` 12, `--organic-font-body-md` 13, `--organic-font-body-lg` 15, `--organic-font-heading-sm` 15, `--organic-font-heading-md` 18, `--organic-font-panel-title` 18, `--organic-font-display-sm` 22, `--organic-font-display-md` 22 | 0.92–1.15; each value is `max(11, round(base × scale))px` (the 11 px floor matches `--font-floor`) | 1 |
| `shape.radiusSm` | `--organic-radius-sm` | int 0–16 px | 8 |
| `shape.radiusMd` | `--organic-radius-md` | int 0–24 px | 16 |
| `shape.radiusLg` | `--organic-radius-lg` | int 0–32 px | 28 |

Family-list entries:
- `@<fontId>` refers to packaged faces. Main replaces it with a host alias `apt-<16 hex>`, derived from HMAC(sessionSalt, pluginId\0version\0themeId\0fontId). Plugins therefore cannot register or shadow arbitrary family names such as "Segoe UI" or system fonts.
- A local family name matches `^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,46}[A-Za-z0-9])?$` (no quotes, commas, semicolons or backslashes). Main wraps it in double quotes.
- Generic keywords: `serif`, `sans-serif`, `monospace`, `system-ui`, `ui-sans-serif`, `ui-serif`, `ui-rounded`, `ui-monospace`. They are emitted unquoted. The last entry must be generic.
- Emitted value example: `"apt-3f2a…", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`.

Not themable: `--organic-space-*`, weights, shadows (`--organic-*-shadow` keep built-in per mode), `--organic-quota-*`, `--organic-status-*`, `--focus-ring-*`. Inside `.status-panel` the focus ring already follows `--organic-accent` (`StatusPanel.css` `--focus-ring-color: var(--organic-accent)`), which is why accent has a 3:1 requirement.

### 3.5 Derivation for "D" tokens (deterministic, in main, before contrast)

`mix(a, b, t)` = per-channel `a·(1−t) + b·t` in sRGB 0–255, rounded. `withAlpha(c, x)` = c's RGB with alpha x.
- `surfaceWarm = mix(surface, accent, 0.18)`
- `surfaceSage = mix(surface, sage, 0.18)`; `surfaceSageSoft = mix(surface, sage, 0.08)`
- `surfaceOff = mix(surface2, text, 0.12)`
- `textFaint = textMuted`
- `accentHover = mix(accent, text, 0.2)` (darker in light mode, lighter in dark mode, like the built-in values)
- `accentGlow = withAlpha(accent, 0.22)`; `accentTrack = withAlpha(text, 0.08)`; `accentOnHover = withAlpha(text, 0.05)`
- `sageTrack = withAlpha(sageDark, 0.16)`
- `borderSoft = withAlpha(border, round3(alpha(border) × 0.625))` (`borderOnAccent` is no longer derived, R16)

The resolved set always contains all 31 colour properties (R16), plus 2 family, 9 size and 3 radius properties. The renderer sets exactly this allowlisted set (`PANEL_THEME_CSS_PROPERTIES` in `src/types/panel-theme.ts`).

### 3.6 Required `tokens.css` refactor (protected scopes)

To allow "reset to built-in" inside protected regions, the themable palette needs a frozen copy:
- For each themable `--organic-X`, rename the literal declaration in `:root` and `:root[data-theme='dark']` to `--builtin-organic-X`, and add `--organic-X: var(--builtin-organic-X)` in `:root`. Rendering does not change.
- Add `.host-protected { --organic-X: var(--builtin-organic-X); … }` for every themable property, plus `font-family: var(--font-ui)`.
- Extend the alias selectors so aliases re-resolve inside protected regions and previews: `StatusPanel.css` `.status-panel {` becomes `.status-panel, .status-panel .host-protected, .panel-theme-preview {`, and likewise the `tokens.css` `.status-panel { --text-danger … }` and `.status-panel, .setup-overlay, .mcp-overlay { --accent-on … }` blocks. This is needed because inherited aliases arrive already substituted.
- The `@media (prefers-contrast: more)` block must target `--builtin-organic-border*`.
- `scripts/check-contrast.mjs` must resolve `var()` aliases per theme block. **Unverified:** whether its current resolver handles an alias in `:root` whose target is overridden in the dark block. Check and adjust it.

### 3.7 Pet status pill (`modes.<mode>.petStatus`, additive)

Optional per mode. Colours only, same grammar and canonical re-emission as §3.3. Set on the pet window's `.desktop-pet` root as `--pet-status-*`; only `.status-line` (single- and multi-pet pills) reads them.

| Key | Property | Required | Alpha | Default when omitted |
|---|---|---|---|---|
| `background` | `--pet-status-background` (+ `--pet-status-background-opaque` for reduced transparency / more contrast) | yes | 0.85–1 | — |
| `text` | `--pet-status-text` | yes | 1 | — |
| `border` | `--pet-status-border` | no | 0.08–1 | `withAlpha(text, 0.18)` |
| `textMuted` | `--pet-status-text-muted` (separator, project line) | no | 1 | `mix(text, opaque background, 0.25)` |
| `quotaFill` | `--pet-status-quota-fill` (≥ 50% remaining, both families) | no | 1 | the mode's `accent` |
| `quotaTrack` | `--pet-status-quota-track` | no | 0.1–1 | `withAlpha(text, 0.18)` |
| `quotaWarn` | `--pet-status-quota-warn` (20–50% remaining) | no | 1 | built-in amber `#e3b64f` mixed toward `text` by the first of 0.0, 0.1 … 0.6 that reaches 3:1 on the pill and on the track |

Contrast (the pill floats over arbitrary desktop content): with `S_K = background` composited over K ∈ {black, white} and `T_K = quotaTrack` over `S_K`: `text`, `textMuted` ≥ 4.5 on `S_K`; `quotaFill`, `quotaWarn` ≥ 3 on `S_K` and on `T_K`.

(Superseded by R15.) The pill, bubbles, the permission bubble, dots, badges and the edge handle follow the theme of the pet appearance's mode; `petStatus` only overrides the pill, and the critical (< 20%) quota colour is always the mode's `dangerText` (hue-checked, not overridable by `petStatus`). Fonts, radii, images and blur never reach the pet window.

Mode: the pet window uses the slot of the pet appearance (`dark`, `light`, or `follow` the panel, which tracks system/light/dark); `<html data-theme>` in the pet window is that mode. Plumbing (R15): main sends `{ light, dark }`, each `{ colors, status }` or `null`, where `colors` is only `PET_THEME_COLOR_PROPERTIES` (the 21 palette properties the pet CSS reaches; a test derives the set from `tokens.css`) and `status` the full `--pet-status-*` set or `null`, on `panel-theme-pet-status-changed` / `panel-theme-pet-status-get` (pet main frame only). The renderer (`usePetTheme`) accepts each set whole with canonical `rgb()` values or drops it, writes the diff on `<html>` in one `requestAnimationFrame` (one style recalculation per switch), strengthens borders under `prefers-contrast: more` like the panel, and drops everything under `forced-colors`.

## 4. Background, fonts and user image

### 4.1 Background model (per mode)

The layers are painted inside `.status-panel`, which gets `isolation: isolate`:
1. `.status-panel` background is `var(--panel-theme-background, var(--surface-panel))`.
   - solid: the property is unset, so `--organic-bg` shows.
   - gradient: the renderer builds `linear-gradient(<angle>deg, <rgb> <at>%, …)` or `radial-gradient(ellipse at <position>, …)` from host-validated structured data (angle default 180, position default center) and re-checks it against a strict regex before `setProperty('--panel-theme-background', …)`. Stops must be opaque, with non-decreasing `at`.
2. Image backgrounds use a `PanelThemeBackdrop.vue` element as the first child: `position:absolute; inset:0; z-index:-1; border-radius:inherit; overflow:hidden; pointer-events:none; aria-hidden="true"`. It contains:
   - an `<img src="agent-pets://panel-theme/<token>" decoding="async" alt="">` with `object-fit` cover/contain (or a `background-repeat` tile div for `tile`), `object-position` from the enum, `opacity`, and `filter: blur(<n>px)` plus `transform: scale(1.04)` when blur > 0 (hides edge fade);
   - an overlay `<div>` with `background: <overlay rgb>` and `opacity: <overlay.opacity>`.
   - `bg` stays painted underneath as the fallback.
- Blur applies only to the image (`filter`), never `backdrop-filter`. This is not glass-on-glass and keeps the panel content layer opaque (Liquid Glass rules: no glass behind lists/settings).
- `prefers-reduced-transparency: reduce` or `html[data-gpu-safe]`: hide the backdrop (bg colour or gradient only).
- `forced-colors: active`: the plugin theme is **suspended** (all properties removed) so system colours apply.
- `prefers-contrast: more`: the renderer overrides `--organic-border` / `--organic-border-soft` with `withAlpha(text, 0.6)` / `withAlpha(text, 0.4)`, mirroring the built-in rule.
- `<img>` `error` hides the backdrop and keeps bg. Because bg alone is also contrast-validated, the fallback is always legible.

### 4.2 Fonts model
- Only `.woff2`, magic `77 4F 46 32` ("wOF2"), each file ≤ 1 MiB, ≤ 4 faces per theme, ≤ 8 distinct files per plugin. Every packaged `.woff2` must be referenced by some `fonts[].src`; unreferenced files reject install.
- Main never parses fonts; it checks magic and size only. The panel renderer loads them with `new FontFace(alias, 'url("agent-pets://panel-theme/<token>")', { weight, style, display: 'swap' })`. The URL string is built by the renderer from a host token matching `^[0-9a-f]{32}$`. Chromium runs every web font through the OpenType Sanitizer (OTS) in the sandboxed renderer before it reaches the platform rasteriser.
- Only fonts of a theme currently assigned to a slot are loaded. Faces are removed from `document.fonts` when no slot uses them any more.
- CSP change (`index.html`): `font-src 'self' data: agent-pets://panel-theme`. `img-src` already allows `agent-pets:`.
- CJK: 1 MiB cannot hold a usable CJK font, so authors should list system CJK families before the generic fallback.

### 4.3 User-imported background image
- Allowed only where the theme's mode declares `userImage.allowed: true`. One image per (pluginId, themeId, mode).
- When present it replaces that mode's background visually (bg stays the fallback), using `userImage.overlay.color`, the user-chosen dim (≥ the computed minimum, ≤ 0.95), fit (default `userImage.fit` or `cover`), position (default `center`) and blur (0/8/16/24).

**IPC** (new registrar `electron/ipc/panel-theme.ts`, `registerPanelThemeIpc(deps)`). Every handler uses `handleWithSenderGuard(…, assertPluginPanelSender, …)`: panel window main frame only. The pet window, plugin panel views (separate partition, separate preload) and the plugin host cannot call these.

| Channel (`IPC_CHANNELS` key → value) | Type | Payload | Result |
|---|---|---|---|
| `panelThemeStateGet` → `panel-theme-state-get` | handle | none | `{ ok: true, value: PanelThemeState }` |
| `panelThemeSlotSet` → `panel-theme-slot-set` | handle | `mode: 'light'\|'dark'`, `ref: { pluginId, themeId } \| null` | `{ ok, value?: PanelThemeState, error? }` |
| `panelThemeUserImageImport` → `panel-theme-user-image-import` | handle | `ref`, `mode` | same; errors `cancelled`, `dialog_unavailable`, `theme_unavailable`, `image_not_allowed`, `image_invalid`, `image_too_large`, `write_failed` |
| `panelThemeUserImageClear` → `panel-theme-user-image-clear` | handle | `ref`, `mode` | same |
| `panelThemeUserImageOptionsSet` → `panel-theme-user-image-options-set` | handle | `ref`, `mode`, `{ fit, position, dim, blur }` | same; `invalid_request` when out of range (reject, no clamping) |
| `panelThemeChanged` → `panel-theme-changed` | main → panel `send` | `PanelThemeState` | |

Payload validation:
- `pluginId` matches `/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/`, `themeId` matches `/^[a-z0-9-]{1,32}$/`, `mode` is an enum.
- `ref` must be in the **current** catalog (plugin installed, enabled, global switch on, theme has that mode).
- Options: `fit` / `position` enums; `dim` is a number with ≤ 2 decimals in [minOverlay, 0.95]; `blur` ∈ {0, 8, 16, 24}.
- Unknown keys reject.

Preload (`electron/preload.ts`, typed in `src/types/electron-api.ts`): `getPanelThemeState()`, `setPanelThemeSlot(mode, ref)`, `importPanelThemeUserImage(ref, mode)`, `clearPanelThemeUserImage(ref, mode)`, `setPanelThemeUserImageOptions(ref, mode, options)`, `onPanelThemeChanged(cb) → unsubscribe`. Regenerate `docs/security/ipc-inventory.md` (`node scripts/generate-ipc-inventory.mjs --write`).

Import flow (main):
1. Check the sender, validate the payload, confirm the mode allows user images.
2. `setDialogOpen(true)`; `dialog.showOpenDialog(panelWindow, { title: t('design.panelTheme.image.dialogTitle'), filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','webp'] }], properties: ['openFile'] })`; `setDialogOpen(false)` in `finally`. This is the same pattern as `prepareImportPetZip`.
3. `lstat` the path: it must be a regular file, not a symlink, ≤ 20 MiB. Open it with `O_RDONLY|O_NOFOLLOW`, `fstat`, require the same dev/ino/size, and **read once into memory**. All validation runs on those bytes. The source is never re-read (no TOCTOU).
4. Validate the bytes:
   - magic is PNG, JPEG or WebP;
   - `readImageSize` (from `pet-sprite-validation.ts`; the JPEG path walks every segment and allows exactly one SOF): 64 ≤ width, height ≤ 8192 and width × height ≤ 16,777,216;
   - not animated (new `readImageAnimated`: PNG `acTL` before `IDAT`; WebP `VP8X` animation flag (byte 20, bit 0x02) or an `ANIM` chunk);
   - EXIF orientation is **allowed** for user images. Chromium applies it (`image-orientation: from-image`), and both orientations satisfy the pixel caps. Packaged images still require orientation 1.
5. `sha256` the bytes. Write `userData/panel-theme-images/<pluginId>/<sha256>.<png|jpg|webp>` as a temp file in the same directory, then rename. Directories are mode 0o700, files 0o600, with lstat checks that no path component is a symlink.
6. Update the store entry. Delete the previous file if nothing else references it.
7. Broadcast `panel-theme-changed`. The plugin is never notified, and no Host API exposes any of this.

Serving: the `agent-pets://panel-theme/<token>` host (§6.2). User images get token = HMAC(sessionSalt, "user\0" + sha256), so the URL is stable for a given image and different across sessions.

Cleanup:
- **Plugin remove** (`ipc/plugin-install.ts` after `broker.removePlugin`): `panelThemeStore.removePlugin(pluginId)` and `rm -r userData/panel-theme-images/<pluginId>` (after lstat confirms it is a real directory, not a symlink). Clear slots that reference the plugin.
- **Plugin disable / global switch off:** keep the files and slot selections, serve nothing, render built-in.
- **Update:** on sync, prune entries (and files) whose theme or mode no longer exists or no longer allows `userImage`, and clear slots whose theme or mode vanished.
- **Startup sweep:** delete files under `panel-theme-images/` that the store does not reference. Bounded: at most 256 entries examined, like the pet-import recovery bound.

## 5. Validation and limits

### 5.1 Where validation runs
- `parsePluginManifest` → `parsePanelThemes()` (`electron/plugin-panel-themes.ts`): grammar, derivation, contrast. This runs at install/plan time (`plugin-registry.ts` prepare), in developer-folder loading, and on every `refreshPluginRuntimeContexts()`. A manifest that fails now fails everywhere.
- Install-time asset checks in `plugin-registry.ts`:
  - every referenced `src` exists in the archive;
  - images are PNG/WebP by magic, ≤ 8 MiB, 64–4096 px per side, ≤ 8,388,608 px, orientation 1, not animated;
  - fonts have `wOF2` magic and are ≤ 1 MiB;
  - no unreferenced `.woff2`.
- Serve-time: the protocol re-reads through `readRegularFileWithin` (realpath containment, `O_NOFOLLOW`, size cap), re-runs the header checks on the bytes it just read, and serves exactly those bytes.

### 5.2 Error reporting
- New manifest error code `invalid_panel_theme` (add to `PluginManifestError`) and new registry error `invalid_panel_theme` (add to `PLUGIN_REGISTRY_ERROR_CODES` in `src/types/ipc.ts`, and to both tables in `docs/security/ipc-error-codes(.zh-TW).md`, which the test enforces).
- In developer mode the install sheet also shows a sanitised diagnostic of at most 200 chars, for example `sakura.light.colors.textMuted: 3.92:1 < 4.5:1 on surface2`. This needs a new optional `diagnostic` field on the plan result. **Assumption:** the install-plan type has no detail field today, so it must be added and shown only in developer mode.

### 5.3 Limits

| Item | Limit |
|---|---|
| Themes per plugin | 1–8 |
| Modes per theme | 1–2 |
| Gradient stops | 2–5 |
| Font faces per theme / distinct font files per plugin | 4 / 8 |
| Font file | `.woff2`, ≤ 1 MiB |
| Packaged background image | `.png`/`.webp`, ≤ 8 MiB, 64–4096 px/side, ≤ 8.39 MP, static, orientation 1 |
| Distinct packaged images per plugin | ≤ 16 |
| Package with `panelThemes` or `skins` ("asset package") | ≤ 25 MiB total, ≤ 64 files (existing `PLUGIN_ARCHIVE_SKIN_MAX_BYTES`); otherwise 5 MiB as today |
| User image | PNG/JPEG/WebP, ≤ 20 MiB, 64–8192 px/side, ≤ 16.78 MP, static |
| Stored user images | 1 per (plugin, theme, mode); ≤ 64 entries total |
| `panel-theme.json` | ≤ 64 KiB |

## 6. Contrast algorithm

### 6.1 Rules (per mode, on the resolved and normalised set)
- Relative luminance: WCAG 2.x sRGB (`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`). Ratio = `(L1+0.05)/(L2+0.05)`. Compared unrounded with `≥`.
- A translucent foreground is composited over its background in sRGB gamma space (what Chromium paints).
- **Mode direction** (native controls follow `color-scheme`, which `data-theme` sets):
  - light requires `L(text) < L(bg)` and `L(bg) ≥ 0.45`;
  - dark requires `L(text) > L(bg)` and `L(bg) ≤ 0.12`.
  - The built-in values are 0.83 and 0.012.
- **Backdrops** of a mode:
  - solid: `{bg}`.
  - gradient: `{bg} ∪ stops ∪ mix(stopᵢ, stopᵢ₊₁, t)` for t ∈ {0.25, 0.5, 0.75}.
  - image (packaged): `{bg, Q_black, Q_white}`, where `P_K = o·K + (1−o)·bg` for K ∈ {black, white} (o = image opacity) and `Q_K = a·overlay + (1−a)·P_K` (a = overlay opacity).
  - user image: the same with o = 1 and a = `userImage.overlay.opacity`.
  - Because the worst-case image pixel is pure black or pure white, the result does not depend on the image.
- **Pairs:**
  - On every backdrop: `text`, `textSecondary`, `textMuted`, `accentText` ≥ 4.5; `accent` ≥ 3.
  - On `surface` and `surface2`: `text`, `textSecondary`, `textMuted`, `dangerText`, `successText`, `warnText` ≥ 4.5.
  - `accentText` on `surface` and `surfaceWarm` ≥ 4.5.
  - `text` on `surfaceWarm` and `surfaceSage` ≥ 4.5.
  - `textFaint` on `surface` ≥ 3; `accent` on `surface` ≥ 3.
  - `onAccent` on `accentHover` ≥ 4.5; `onAccent` on `accent` ≥ 3.
  - These extend the organic `PAIRS` in `scripts/check-contrast.mjs`.
- **Minimum overlay:** `minOverlay(mode, image)` = smallest a ∈ {0.50, 0.51, …, 0.95} for which all backdrop pairs pass.
  - If none passes, reject.
  - If the declared overlay is below the minimum, reject (the diagnostic includes the minimum).
  - The user-image minimum is sent to the renderer as the lower bound of the dim control.
  - The **0.50 hard floor** applies regardless of contrast. It keeps any picture visibly a backdrop (anti-spoofing, §8).
- Built-in regression: a test asserts that the built-in light and dark palettes pass this same validator. Note that built-in light `onAccent`/`accent` is 3.29:1, which is why that pair is 3 and not 4.5. **Observation:** `InlinePermissionCard` draws `--accent-bright` text on `--accent`, which is 3.29:1 in built-in light. This is an existing issue and out of scope, but worth a follow-up.

### 6.2 Reject, not auto-adjust (decision)
Rejecting is deterministic and visible to the author (developer-mode diagnostics). What the user sees matches the author's screenshots and preview, and the outcome does not drift if the adjustment algorithm changes between app versions. Auto-adjusting would silently "repair" adversarial near-invisible colour choices instead of refusing them. The only adjustable value is the user's own dim control, and it is bounded below by the computed minimum.

## 7. Data flow, persistence and lifecycle

### 7.1 Main
- New `electron/plugin-panel-themes.ts`, pure with no Electron import. Responsibilities: parse, derive, validate, and build the catalog: `buildPanelThemeState(contexts, store, tokens)`.
- New `electron/panel-theme-store.ts`, modelled on `PluginPreferencesStore`: lstat/symlink refusal, `O_NOFOLLOW` read, size cap, corrupt-file backup, `writeJsonAtomic`. It writes `userData/panel-theme.json`:

```json
{
  "version": 1,
  "slots": {
    "light": { "pluginId": "panel-theme-collection", "themeId": "sakura" },
    "dark": null
  },
  "userImages": {
    "panel-theme-collection": {
      "sakura": {
        "light": {
          "file": "<sha256>.jpg",
          "type": "image/jpeg",
          "width": 4032,
          "height": 3024,
          "bytes": 3456789,
          "fit": "cover",
          "position": "center",
          "dim": 0.9,
          "blur": 8,
          "importedAt": "2026-11-08T00:00:00.000Z"
        }
      }
    }
  }
}
```

Why a dedicated file:
- The light/dark preference (`agent-pet-theme`) stays in localStorage, unchanged.
- The plugin-theme selection must live in main, because main decides what to serve, prunes images, and cleans up on removal.
- `plugin-preferences.json` deletes per-plugin records on removal and has a plugin-scoped patch allowlist. The selection is an appearance preference across plugins.

Sync and broadcast:
- `syncPluginHost()` (`electron/main/runtime.ts`) already runs after install, enable, disable, remove, update, developer-folder reload and global-switch changes. After `refreshPluginRuntimeContexts()` it:
  - rebuilds the panel-theme state,
  - rebuilds the token→asset map,
  - prunes the store (§4.3),
  - and if the state's stable hash changed, sends `panel-theme-changed` to `mainState.panelWindow` only (coalesce with `ipc/broadcast-coalescer.ts`).
- Resolved themes are cached per `pluginId@version`.

`PanelThemeState` (new `src/types/panel-theme.ts`):

```ts
type Mode = 'light' | 'dark'
interface PanelThemeRef { pluginId: string; themeId: string }

interface PanelThemeState {
  slots: Record<Mode, {
    ref: PanelThemeRef | null
    status: 'builtin' | 'active' | 'unavailable'
    reason?: 'plugin_disabled' | 'plugins_off' | 'theme_removed'
  }>
  themes: PanelThemeCatalogEntry[]
}

interface PanelThemeCatalogEntry {
  ref: PanelThemeRef
  pluginName: LocalizedText
  displayName: LocalizedText
  description?: LocalizedText
  shared: {
    properties: Partial<Record<PanelThemeCssProperty, string>>
    fonts: Array<{ alias: string; url: string; weight: 400 | 600 | 700; style: 'normal' | 'italic' }>
  }
  modes: Partial<Record<Mode, {
    properties: Record<PanelThemeColorProperty, string>
    background:
      | { type: 'solid' }
      | { type: 'gradient'; kind: 'linear'; angle: number; stops: Array<{ color: string; at: number }> }
      | { type: 'gradient'; kind: 'radial'; position: Position; stops: Array<{ color: string; at: number }> }
      | { type: 'image'; url: string; fit: Fit; position: Position; opacity: number; blur: number; overlay: { color: string; opacity: number } }
    userImage?: {
      minDim: number
      defaultDim: number
      overlayColor: string
      current?: { url: string; fit: Fit; position: Position; dim: number; blur: number; width: number; height: number }
    }
  }>>
}
```

The catalog is bounded: ≤ 50 enabled plugins × 8 themes, typically ≤ 10 × 8.

### 7.2 Protocol host
In `configureSecureProtocol()` (`electron/main/runtime.ts`), add a hostname `panel-theme`:
- Path must be exactly `/^\/([0-9a-f]{32})$/`, with no search, hash, userinfo or port.
- Look the token up in the in-memory map `{ kind: 'image'|'font'|'user', root, relativePath, maxBytes }`, rebuilt on every sync. Unknown, disabled or removed tokens get 404 immediately.
- Read through `readRegularFileWithin`, re-run the magic/header checks on those bytes, and respond with `content-type` from the magic, `x-content-type-options: nosniff` and `cache-control: private, max-age=31536000, immutable`. GET only.
- Packaged token = HMAC-SHA256(sessionSalt, kind\0pluginId\0version\0relativePath)[0..32].
- The plugin partitions (`createPluginHostProtocolHandler`, `createPluginPanelProtocolHandler`) do **not** get this host, so plugin code cannot probe whether a user image exists.

### 7.3 Renderer
New `src/composables/usePanelTheme.ts`, initialised in `StatusPanel.vue` for the `panelRoot` ref (panel window only; `App.vue` `isPanelWindow`):
- `getPanelThemeState()` on mount, then `onPanelThemeChanged`.
- `watch([state, resolvedTheme, mediaFlags], apply)`. `resolvedTheme` comes from `useTheme.ts`, which already follows the `system|light|dark` preference, `matchMedia('(prefers-color-scheme: dark)')` change events and cross-window `storage` events, so live OS appearance changes need no new plumbing.
- `apply()`:
  1. Pick the slot for `resolvedTheme`. If it is null, unavailable or suspended by `forced-colors`, the target is the empty property set.
  2. Compute `next: Map<property, value>` = shared properties plus the mode's colour properties, plus `--panel-theme-background` for gradients and the high-contrast border override.
  3. Check every name against `PANEL_THEME_CSS_PROPERTIES` and every value against its per-property regex; drop any failure and log it to diagnostics.
  4. In one `requestAnimationFrame`, `removeProperty` for stale names and `setProperty` only for changed values. Never `style.cssText`, `innerHTML` or a `<style>` element.
  5. Set `panelRoot.dataset.panelTheme = 'plugin'` while active.
- Fonts: when typography changes, `FontFace.load()` all faces (timeout 1500 ms) **before** writing the family and size properties, so there is one relayout.
- `PanelThemeBackdrop.vue` gets the mode's image or user image. It `await img.decode()`s before swapping, so there is no flash.

### 7.4 Lifecycle
| Event | Behaviour |
|---|---|
| Plugin disabled / global switch off | Slot kept, status `unavailable`, built-in rendered, tokens 404. |
| Re-enabled | Theme returns automatically. |
| Removed | Slots cleared, images and store entries deleted. |
| Updated | Revalidated. If invalid, install is rejected (old version stays). If the theme or mode vanished, the slot is cleared and orphaned images pruned. Adding themes needs consent (§10). |
| Worker crash | No effect (themes are data). After three crashes the plugin is auto-disabled, which goes through sync and falls back to built-in. |
| Asset read failure at serve time | 404; the backdrop hides and the solid bg (validated) shows. Font failure: the fallback family is used. |
| Panel renderer reload/crash | State re-fetched on mount. |
| Corrupt or unsafe `panel-theme.json` | Treated as all built-in. The corrupt file is backed up (same as plugin preferences). Writes return `preferences_unsafe`. |

## 8. Settings UI

> Revised (R6). Implemented layout:
> - **Settings → Plugins → <plugin> → Panel themes** (`PluginPanelThemes.vue`, a section of `PluginDetail.vue`, `.host-protected`): every theme of that plugin with light/dark previews (each preview includes a pet pill), badges "In use · Light/Dark" (使用中 · 淺色／深色), "Light mode only"/"Dark mode only" for single-mode themes, buttons **Use in light mode / Use in dark mode / Use for both modes** (用於淺色模式／用於深色模式／兩種模式都使用), the user background image controls for each mode in which this theme is active (**Choose image… / Remove image**, Fit, Position, Dim, Blur), and **Restore built-in** (恢復內建外觀). Applying replaces that mode's slot; there is exactly one slot per mode.
> - **Settings → General → Appearance** (`SettingsPanelTheme.vue`, `.host-protected`): the existing panel/pet theme switch card, then a **Panel theme** (面板主題) status card: "Light mode / Dark mode: <theme> (from plugin <plugin>)" or "Built-in", **Open plugin settings** (開啟插件設定, to the owning plugin's Panel themes section) and **Restore built-in** (always in this fixed place).
> - The plugin card shows "Panel themes (N)" and "Panel theme in use"; the detail's overview links to the section.
> - Settings search entry `panelThemeStyle` (keywords unchanged) opens the owning plugin's Panel themes section when a theme plugin is available, otherwise the Appearance status card.
>
> The original text below is kept for history.

- Location: `SETTINGS_GROUPS` → `general` → section `appearance` (`SettingsAppearance.vue`). Add a new card component `src/components/status-panel/SettingsPanelTheme.vue` after the existing Theme card.
- Search entry in `SETTINGS_ENTRIES`: `{ id: 'panelThemeStyle', section: 'appearance', labelKey: 'design.panelTheme.entry', helpKey: 'design.panelTheme.help', keywords: ['theme','skin','background','wallpaper','font','colour','color','plugin','主題','背景','桌布','字型','字體','顏色','外觀','插件','外掛'] }`.
- The whole card has class `host-protected`, so it is always rendered with built-in tokens and the user can always revert.
- Card layout:
  - **Light mode** row: a `Select` with "Built-in" plus themes that have `modes.light`, labelled "<theme> · From plugin: <plugin>".
  - **Dark mode** row: the same for `modes.dark`. A single-mode theme only appears in that mode's select. The other mode stays independently built-in or any other theme. This is the defined behaviour for single-mode themes.
  - **Use for both modes** button, shown when the highlighted theme has both modes and the other slot differs.
  - **Previews**: two side-by-side `PanelThemePreview.vue` tiles (light and dark) for the pending selection. Each is a static mock (header, card, three text levels, accent button, danger/success text, backdrop) with the same property map applied inline to a `.panel-theme-preview` element. Each has `role="img"` and `aria-label` = `design.panelTheme.preview`. The mock content is `inert`. Previews render only while the card is visible.
  - **Apply** commits pending slot changes (`setPanelThemeSlot` per changed mode). **Restore built-in** clears both slots (always enabled when any slot is set). Pending changes are discarded when you leave the section.
  - **Background image** subsection, per mode, shown only if the slot's theme mode allows `userImage`: "Choose image…", "Remove image", Fit (`Select`), Position (`Select`), Dim (`SegmentedControl` presets: min, min+0.05, min+0.10, 0.95 clamped to unique values), Blur (`SegmentedControl` 0/8/16/24). Existing `ui/` primitives only; no new slider.
  - Status lines: unavailable reason; "Suspended while Windows high-contrast is on" under `forced-colors`.
- `PluginDetail.vue` / `PluginCard`: capability "Panel themes (N)" with a link that navigates to `general/appearance`. `src/utils/plugin-capabilities.ts` gains `'panelThemes'`.
- Accessibility: every control is labelled; guaranteed contrast (§6); the accent is ≥ 3:1 so the focus ring (`--organic-accent` in the panel) stays visible; no colour transitions on theme switch (and `prefers-reduced-motion` is already global); keyboard-only operable; previews announce theme and mode; `forced-colors` suspends the theme.

### Protected (never themed) regions (superseded by R14)
Historical; 1.12.0 ships no protected regions. These used to get `class="host-protected"`:
- `InlinePermissionCard.vue` and `PermissionOutcomeNotice.vue` (panel permission UI)
- `PluginInstallSheet.vue` (consent and risk groups)
- `PluginPanelFrame.vue` host chrome (plugin name, "Plugin content" marker, close)
- `ConfirmDialog.vue`
- `ServerHealthBanner.vue`
- `SettingsPanelTheme.vue`

The pet window (permission bubbles) is not themed at all.

### i18n keys (EN + zh-TW, same files as their siblings)
- `src/locales/design/*.json`:
  - `design.panelTheme.title`, `.help`, `.entry`, `.lightSlot`, `.darkSlot`, `.builtIn`, `.fromPlugin` (`{plugin}`), `.optionLabel` (`{theme}`, `{plugin}`), `.useForBoth`, `.apply`, `.restoreBuiltIn`, `.preview` (`{theme}`, `{mode}`), `.modeLight`, `.modeDark`, `.unavailablePluginDisabled`, `.unavailablePluginsOff`, `.unavailableRemoved`, `.suspendedForcedColors`, `.applied`
  - `design.panelTheme.image.title`, `.choose`, `.remove`, `.dialogTitle`, `.fit`, `.fitCover`, `.fitContain`, `.fitTile`, `.position`, `.positionCenter`, `.positionTop`, `.positionBottom`, `.positionLeft`, `.positionRight`, `.positionTopLeft`, `.positionTopRight`, `.positionBottomLeft`, `.positionBottomRight`, `.dim`, `.dimValue` (`{percent}`), `.blur`, `.blurNone`, `.imported`, `.removed`
  - errors: `design.panelTheme.error.imageInvalid`, `.imageTooLarge`, `.imageAnimated`, `.imageNotAllowed`, `.themeUnavailable`, `.writeFailed`
- `src/locales/en-US.json` / `zh-TW.json`: `pluginPermissionPanelThemes` ("Provide {count} panel themes"), `pluginPermissionPanelThemeFonts` ("Include custom fonts for the panel")
- `src/locales/plugins/*.json`: `plugins.hintPanelThemes`, `plugins.presencePanelThemes` ("Provides {count} panel themes you can pick in Appearance settings"), and the capability label in the same pattern as `skins`
- Error-code copy for `invalid_panel_theme`, `theme_unavailable`, `image_invalid`, `image_too_large`, `image_not_allowed` wherever `IPC_ERROR_CODES` messages are mapped.

## 9. Security analysis

| Threat | Mitigation |
|---|---|
| CSS injection | No plugin string reaches CSS. Main parses each value with closed grammars and **re-emits** host-built canonical strings (`rgb(R G B / A)`, `Npx`, quoted families, host aliases). The renderer re-validates names (allowlist) and values (regex) and only uses `style.setProperty` on custom properties of `.status-panel` / `.panel-theme-preview`. No `cssText`, `<style>`, `innerHTML` or plugin CSS files. Gradients are built from numbers. |
| Remote fetch / tracking | No URL fields in the contract. Images and fonts come only from `agent-pets://panel-theme/<token>`. CSP is not widened for remote origins; `font-src` gains only `agent-pets://panel-theme`. Plugins get no Host API, so they cannot learn which theme is active or whether a user image exists. |
| UI spoofing of permission/risk prompts | (R14) No protected regions. Layout, labels, risk badge wording and hold-to-allow are host code; every text token is contrast-checked on every surface it can appear on (including the pet bubble and pill over black and white desktops); danger/success/warn keep their hue bands and distances (R12) and the host info colour stays distinct; the focus ring is ≥ 3:1 everywhere. Contrast and mode-direction rules prevent invisible text, accents or controls. The backdrop is `pointer-events:none`, `aria-hidden`, behind content and dimmed by an overlay of at least 0.50, so a picture of a fake "Allow" button reads as wallpaper and cannot be clicked. Residual risk: a convincing faded image; catalog review in §14 covers it. |
| Image/decompression bombs | Header-only dimension and pixel caps before any decode. Main never decodes. Animated PNG/WebP rejected. Byte caps (8 MiB packaged, 20 MiB user). Archive caps (25 MiB, 64 files). The existing archive guard bounds total inflated bytes. **Unverified:** whether `archive-guard.ts` enforces a per-entry compression ratio (zip-inspect does; archive-guard showed no ratio check). The 25 MiB total cap bounds it either way. |
| Font parser exploits | woff2 only, ≤ 1 MiB, magic-checked. Parsed only in the sandboxed panel renderer through Chromium's OTS. Never in main or the pet window. Only fonts of an assigned theme load. A separate consent line (`contributes:panelThemeFonts`, medium risk) tells the user. Residual risk: an OTS/FreeType 0-day; keep Electron updated. |
| Path traversal | Manifest paths use `normalizeRelativePath` (no `..`, backslashes, `:`, reserved names, extension allowlist). Protocol takes only 32-hex tokens mapped in memory. Reads go through `readRegularFileWithin` (realpath containment, `O_NOFOLLOW`). User-image paths are `<validated pluginId>/<sha256>.<ext>`. |
| TOCTOU | User file read once through a checked fd and validated in memory. Serve path validates the exact bytes it read before responding. Writes are temp file + rename in an app-owned 0o700 directory. Store file is checked with lstat/`O_NOFOLLOW`. |
| IPC abuse | Panel-window-only sender guard on every channel. Strict payloads. Refs must be in the live catalog. All channels in the inventory test. |
| Privacy | User images stay local (EXIF/GPS kept but never transmitted); deleted on clear or plugin removal; orphan sweep at startup. |

## 10. Consent, packaging, catalog gating

### 10.1 Consent (match skins)
- `permissionUnits()` (`electron/plugin-registry.ts`) and `permissionUnitsOfPlan()` (`src/utils/plugin-permissions.ts`) add `contributes:panelThemes:<count>`, plus `contributes:panelThemeFonts` when any theme declares fonts.
- `parsePermissionUnit`: `panelThemes:*` → display/low; `panelThemeFonts` → display/medium.
- Count-based units mean adding themes or fonts on update produces a new unit and therefore renewed consent, exactly like `skins:N`. User-image allowance is not a consent unit (user-initiated, host-mediated).

### 10.2 Package rules: what changes where
Decision:
- Packaged images stay **PNG/WebP only**. WebP-lossy covers photographic backgrounds smaller than JPEG and needs no new extension anywhere. JPEG is accepted only for user imports, which are never packaged.
- Packaged fonts: **`.woff2` only**. Worth it: custom typography is an explicit user requirement, the parser runs in the sandboxed renderer behind OTS, and a separate consent line makes it visible. TTF adds size and no capability.
- Fonts are separable. If the maintainer rejects the surface, delete §4.2 and the `@id` family entries; nothing else changes and no extension is added.

App (`electron/plugin-registry.ts`):
1. `ALLOWED_EXTENSIONS` becomes `['.js', '.json', '.png', '.webp', '.html', '.css', '.woff2']`.
2. "Asset package" condition: `skinPaths.size > 0` becomes `assetPaths.size > 0`, where assetPaths = skin spritesheets ∪ panel-theme images ∪ fonts. This applies to the total-limit selection and the `archive.byteLength > PLUGIN_ARCHIVE_MAX_BYTES` check.
3. Per-file limits: skin spritesheet 20 MiB (unchanged), theme image 8 MiB, woff2 1 MiB, other files 5 MiB.
4. Every `.woff2` must be referenced. Theme image checks as in §5.1.
5. The developer-folder collector already caps at 20 MiB/file and 25 MiB total, so it needs no change. The same post-collection checks apply.
6. `pack-test-plugin.mjs` must allow a workerless fixture (it currently requires `dist/main.js`).

Catalog (`agent-pets-plugins/scripts/validate-catalog.mjs`), merged **before** the theme package PR:
1. `ARCHIVE_EXTENSIONS` adds `.woff2`. No `.jpg/.jpeg/.ttf`.
2. Keep 64 files and 25 MB total. Add per-type caps mirroring the app: woff2 ≤ 1 MiB with `wOF2` magic and referenced by `panelThemes[].fonts[].src`; theme images png/webp ≤ 8 MiB, header dimensions 64–4096, ≤ 8,388,608 px, not animated, orientation 1; packages without skins/panelThemes ≤ 5 MB.
3. Validate `contributes.panelThemes` with the same grammar, derivation and contrast. Vendor the app's pure module (`electron/plugin-panel-themes.ts` + `electron/panel-theme-color.ts`, which have no Electron imports) as `scripts/vendor/panel-theme-rules.mjs`, with a header comment naming the source commit.
4. Version entries gain optional `minAppVersion`. **Required** (≥ `1.12.0`) when the package manifest has `panelThemes`.

### 10.3 Minimum app version (`minAppVersion`)
Verified behaviour of ≤ 1.11.x (`electron/plugin-catalog.ts`):
- `parseCatalogVersion` rejects any version object with a key outside `CATALOG_VERSION_KEYS`.
- `parseCatalogPlugin` drops a plugin with no surviving versions.
- `parsePluginCatalog` skips (does not fail on) invalid plugin entries.

So adding `"minAppVersion": "1.12.0"` makes old apps **silently hide** that version, and the plugin too if every version has it, without breaking the rest of the catalog. A sideloaded package on an old app fails with `invalid_manifest`, because `panelThemes` is an unknown contribution. That is clear but generic; old apps cannot be changed.

App 1.12.0 changes:
- Add `minAppVersion` to `CATALOG_VERSION_KEYS` and `PluginCatalogVersion`: optional, `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`.
- `selectLatestCompatiblePluginVersion(plugin, apiVersion, appVersion)` skips versions whose `minAppVersion > app.getVersion()`.
- If a catalog plugin has versions but none is compatible because of `minAppVersion`, Explore shows it disabled with "Requires Agent Pets {version} or later" (new key `plugins.catalogRequiresApp`).
- Update `docs/plugins/registry.schema.json` (`version.properties.minAppVersion`) and `publishing(.zh-TW).md`.

## 11. Performance
- A mode switch changes colour properties only (typography and shape are shared), so it costs style recalc and repaint with no layout. A theme switch adds one layout, after `FontFace.load()`. All writes are batched in one rAF and diffed, and only `.status-panel` is touched.
- No CSS transitions on themed properties.
- Main caches resolved themes per `pluginId@version` and broadcasts only on a state-hash change, coalesced.
- Images: only the active mode's image is decoded; previews mount only while visible. `decoding="async"` and `img.decode()` before swap. Decoded memory is ≤ 32 MB (8.4 MP packaged) or ≤ 64 MB (16.8 MP user). Blur is a static `filter` on one layer, disabled under gpu-safe and reduced transparency, with no `will-change`.
- Protocol responses are `immutable` (content-addressed tokens), so repeated previews hit cache.
- Main does no image decoding and no font parsing; only header reads.

## 12. Files, tests, docs, version

### Create (agent-pets)
- `electron/plugin-panel-themes.ts`: parse, derive, contrast, asset rules, catalog builder (pure)
- `electron/panel-theme-color.ts`: grammar, conversion, normalisation, luminance (pure)
- `electron/panel-theme-store.ts`: `panel-theme.json`
- `electron/panel-theme-images.ts`: user-image validate, store, prune, sweep
- `electron/ipc/panel-theme.ts`: registrar
- `src/types/panel-theme.ts`: state types, `PANEL_THEME_CSS_PROPERTIES`, value regexes
- `src/utils/panel-theme-css.ts`: pure diff and validate, gradient builder
- `src/composables/usePanelTheme.ts`
- `src/components/PanelThemeBackdrop.vue`
- `src/components/status-panel/SettingsPanelTheme.vue`
- `src/components/status-panel/PanelThemePreview.vue`
- `docs/plugins/panel-themes.md` + `.zh-TW.md`: author guide
- `docs/plugins/examples/panel-theme-sample/` (plugin.json + small webp + icon)
- `tests/fixtures/plugins/panel-theme-sample/` (+ invalid variants)
- `docs/design/Plugin-Panel-Theme-Plan.zh-TW.md`: this plan
- phase report under `docs/phase-reports/`

### Modify (agent-pets)
- `src/types/plugin.ts`: registry, value map
- `src/types/ipc.ts`: error codes `invalid_panel_theme`, `theme_unavailable`, `image_invalid`, `image_too_large`, `image_not_allowed`
- `src/types/electron-api.ts`, `electron/preload.ts`, `electron/ipc/channels.ts`
- `electron/main/runtime.ts`: protocol host, sync hook, broadcast, registrar wiring, startup sweep
- `electron/plugin-manifest.ts`: parse, workerless rule, error code
- `electron/plugin-registry.ts`: extensions, asset limits, units, checks, diagnostic
- `electron/ipc/plugin-install.ts`: remove cleanup
- `electron/pet-sprite-validation.ts`: export `readImageAnimated`
- `electron/plugin-catalog.ts`, `src/types/plugin-catalog.ts`: `minAppVersion`
- `src/utils/plugin-permissions.ts`, `src/utils/plugin-capabilities.ts`, `src/utils/settingsRegistry.ts`
- `src/components/StatusPanel.vue`, `StatusPanel.css`, `src/styles/tokens.css`
- `src/components/status-panel/SettingsAppearance.vue`
- protected-class additions: `ui/InlinePermissionCard.vue`, `permission/PermissionOutcomeNotice.vue`, `plugin-panel/PluginInstallSheet.vue`, `plugin-panel/PluginPanelFrame.vue`, `ui/ConfirmDialog.vue`, `status-panel/ServerHealthBanner.vue`
- `plugin-panel/PluginDetail.vue` / `PluginCard.vue` / `PluginCatalog.vue`
- `index.html` (CSP)
- `scripts/check-contrast.mjs`, `scripts/pack-test-plugin.mjs`
- locales (§8)
- `package.json` (+ lockfile metadata) → `1.12.0`

### Tests
- `tests/panel-theme-color.test.mts`:
  - every accepted form;
  - rejections: `url(`, `var(`, `calc(`, named colours, `;`, `}`, `\`, quotes, Unicode escapes/fullwidth digits, exponent, negative, `none`, > 64 chars, trailing space, uppercase function name, out-of-range values, oklch out of gamut;
  - normalisation output and the renderer regex round-trip.
- `tests/plugin-panel-themes.test.mts`:
  - derivation formulas;
  - each contrast pair fails individually;
  - mode-direction rule;
  - gradient sampling;
  - min-overlay computation and 0.50 floor;
  - single-mode themes;
  - family-list grammar (last entry generic, `@id` must exist);
  - scale floor 11 px;
  - radius ordering;
  - **built-in light/dark pass the validator**;
  - reject, not clamp, for every out-of-range number.
- `tests/plugin-manifest.test.mts`: `panelThemes` parse; workerless themes-only; themes + skins workerless; workerless with permissions rejected; unknown keys rejected.
- `tests/plugin-registry.test.mts`:
  - `.woff2` accepted, `.jpg`/`.ttf` rejected;
  - unreferenced woff2 rejected; bad magic;
  - animated PNG/WebP; orientation ≠ 1; oversize dimensions;
  - 25 MiB asset limit vs 5 MiB;
  - units `contributes:panelThemes:N` / `panelThemeFonts`;
  - renewed consent on a count increase or fonts added;
  - developer diagnostic text.
- `tests/pet-sprite-validation.test.mts`: `readImageAnimated`.
- `tests/panel-theme-store.test.mts`: symlink/oversize/corrupt backup; slots; `removePlugin`; prune on update; 64-entry cap.
- `tests/ipc-panel-theme.test.mts`:
  - sender guard (pet window, plugin view and foreign frames rejected);
  - payload validation;
  - dialog cancel; `image_not_allowed`;
  - EXIF accepted for user images; pixel/byte caps; JPEG walk;
  - sha256 filename; atomic write; clear deletes;
  - options reject out-of-range values.
- Protocol tests (alongside `tests/plugin-protocol.test.mts`): `panel-theme` host token-only; 404 for unknown, disabled or removed tokens; header re-check on served bytes; nosniff/cache headers; non-GET → 405.
- `tests/plugin-catalog*.test`: `minAppVersion` parse; filtering; old-shape compatibility; "requires" state.
- `tests/panel-theme-css.test.mts` (renderer pure): diff; non-allowlisted names and values dropped; gradient builder; forced-colors suspension; prefers-contrast border override.
- `tests/theme.test.mts` / `design-contrast.test.mts`: slot selection follows `resolvedTheme` and OS change; `check-contrast` after the builtin alias refactor.
- `tests/ipc-inventory.test.mts` (regenerated doc), `tests/plugin-extension-registry.test.mts` (registry ↔ schema ↔ d.ts ↔ docs ↔ error tables), settings search test.
- Real Electron e2e (`scripts/e2e-isolated-electron.mjs`):
  - load the fixture folder, consent, enable;
  - assign light/dark slots and toggle system/light/dark;
  - import an image; disable the plugin and confirm the built-in fallback;
  - remove the plugin and confirm the files are gone;
  - check that the permission card stays built-in under an aggressive theme;
  - check forced-colors / reduced-transparency / increased-contrast;
  - Liquid Glass acceptance set (light/dark wallpaper, focus/unfocus, 100/125/150 % scaling).

### Docs (EN + zh-TW twins)
- `docs/plugins/contribution-points`, `manifest`, `permissions` (two new consent lines), `limits`, `packaging-and-versioning` (`.woff2`, asset-package limit), `security`, `ux-guidelines` (theme guidance), `publishing` (`minAppVersion`), `README` (index link to `panel-themes.md`), `examples`, `plugin.schema.json`, `registry.schema.json`, `agent-pets-plugin.d.ts`
- `docs/security/ipc-inventory.md` (generated), `docs/security/ipc-error-codes(.zh-TW).md`
- Root `README.md` and `README.zh-TW.md`: plugin capability sentence (~L124) adds "panel themes (colours, fonts, backgrounds)".

### Version
**1.12.0** (minor): new public manifest contract, new IPC and protocol security boundary, new persisted file. Bump only after phase sign-off, per `AGENTS.md`.

## 13. `agent-pets-theme-plugin` repo (buildable from this spec)

Repo `Ponpon55837/agent-pets-theme-plugin` currently has only `.gitattributes`. Target app: Agent Pets ≥ 1.12.0.

```text
agent-pets-theme-plugin/
├── README.md / README.zh-TW.md     # install (catalog / developer folder), theme list, screenshots light+dark, licence notes
├── LICENSE                          # repo code licence
├── FONT-LICENSES/                   # OFL.txt for bundled fonts (repo only; .txt cannot ship in a package)
├── package.json                     # "type":"module", engines.node>=22, devDependencies: fflate; scripts below
├── .gitignore                       # dist/, *.agentpet-plugin, *.pem, keys/, .env*
├── src/                             # = the package root (load this folder in developer mode)
│   ├── plugin.json                  # id "panel-theme-collection", no entry, permissions {}, contributes.panelThemes
│   ├── licenses.json                # {"fonts":[{"family":"Nunito","license":"OFL-1.1","text":"…"}]} (.json is allowed)
│   ├── assets/icon.png              # 256×256 PNG
│   ├── backgrounds/*.webp           # ≤ 8 MiB, ≤ 4096 px/side, static, no EXIF rotation
│   └── fonts/*.woff2                # ≤ 1 MiB each, Latin subsets, OFL
├── scripts/
│   ├── rules/                       # copy of the app's pure validator (panel-theme-color + plugin-panel-themes) pinned to an app commit
│   ├── validate.mjs                 # schema + grammar + contrast + asset checks (magic/dims/animation/size/referenced) + package rules
│   ├── keygen.mjs                   # Ed25519 key generation (see §14)
│   ├── sign.mjs                     # builds signature.json over src/ files (docs/plugins/signing.md algorithm)
│   ├── pack.mjs                     # deterministic zip (sorted paths, fixed mtime) -> dist/panel-theme-collection-<v>.agentpet-plugin
│   ├── verify.mjs                   # unzip in memory, re-run validate + signature verify (mirror of plugin-signature.ts)
│   └── catalog-entry.mjs            # prints size, sha256, publicKeyFingerprint and the index.json version entry
└── tests/validate.test.mjs          # node:test: every example theme passes; mutated copies fail
```

`package.json` scripts: `validate`, `sign` (needs `AGENT_PETS_SIGNING_KEY=/abs/path/key.pem`), `pack` (= validate, sign, zip), `verify`, `catalog-entry`, `test`.

Example themes. **Every theme ships both `light` and `dark`**, each passing §6:
1. **Sakura**: the §2.1 example. Light: packaged watercolour webp, overlay 0.9. Dark: plum linear gradient. Nunito woff2 (400/600/700). User image allowed in both modes.
2. **Nord Frost**: system fonts only (`["system-ui","sans-serif"]`). Light: solid `#eceff4`-family palette. Dark: `#2e3440`-family palette with a radial gradient. No images (smallest package path).
3. **Matcha Paper**: light: paper-texture webp (tile, opacity 0.6, overlay ≥ min). Dark: deep green solid. Heading `["ui-serif","Georgia","serif"]`, radii 4/8/12, scale 1.05.
4. **Midnight Terminal**: heading `["ui-monospace","Menlo","Consolas","monospace"]`. Dark: near-black gradient with a teal accent. Light: high-contrast paper variant. User image allowed in dark only.

Authoring rules for the other agent:
- Use only the keys in §2.4.
- Colours: hex or `rgb()` is simplest. Text and surface colours must be opaque. Light-mode bg luminance ≥ 0.45, dark ≤ 0.12.
- Image overlay ≥ the minimum the validator prints.
- CJK families go before the generic fallback.
- Total package ≤ 25 MiB and ≤ 64 files.

Developer-mode load:
1. Agent Pets ≥ 1.12.0 → Settings → Integrations → Plugins → Advanced → Developer mode on.
2. Install menu → Load from folder… → select `src/`.
3. Review consent ("Provide 4 panel themes", "Include custom fonts for the panel"), install, enable.
4. Settings → General → Appearance → Panel theme: assign Light and Dark, check both previews, Apply, toggle system appearance.
5. Folder edits reload after 500 ms.

## 14. Publishing (catalog `Ponpon55837/agent-pets-plugins`)

Order: (1) merge the validator change (§10.2), (2) release Agent Pets 1.12.0, (3) open the package PR. Old apps never see the plugin because of `minAppVersion`, so step (3) may land before (2), but end-to-end testing needs 1.12.0.

1. **Key generation (once).** `node scripts/keygen.mjs --out ~/.agent-pets/keys/panel-theme-collection.ed25519.pem`
   - Uses `crypto.generateKeyPairSync('ed25519')` and exports PKCS#8 PEM.
   - Creates the directory with mode 0o700 and writes the file with `{ mode: 0o600, flag: 'wx' }` (never overwrites).
   - Refuses any `--out` inside a git work tree (check `path.relative` against the repo root and `git rev-parse --show-toplevel`).
   - Prints the raw public key (base64) and the fingerprint (`sha256(raw32).hex.slice(0,16)`).
   - Back up the key offline (encrypted volume or password manager). Never commit it, never put it in CI, never in the package or the registry.
2. **Build:** bump `src/plugin.json` `version` (semver; published versions are immutable). `npm run validate && AGENT_PETS_SIGNING_KEY=… npm run pack`.
   - `sign.mjs` computes the payload: sorted `path\tsha256\n` lines over every file except `signature.json`. It writes `src/signature.json` `{alg:'ed25519', publicKey, signature}` (canonical base64).
   - `pack.mjs` zips `src/` with `plugin.json` at the root.
3. **Verify:** `npm run verify dist/panel-theme-collection-1.0.0.agentpet-plugin`. It checks the signature, rules, ≤ 64 files and ≤ 25 MiB.
4. **Digest:** `npm run catalog-entry` prints `size` (bytes) and `sha256` (lowercase hex of the final archive) and emits:

   ```json
   {
     "id": "panel-theme-collection",
     "name": { "zh-TW": "面板主題合集", "en-US": "Panel Theme Collection" },
     "description": { "zh-TW": "可自訂面板顏色、字型與背景的主題（含淺色與深色）。", "en-US": "Panel themes with colours, fonts and backgrounds for light and dark modes." },
     "author": "Ponpon55837",
     "homepage": "https://github.com/Ponpon55837/agent-pets-theme-plugin",
     "publicKeyFingerprint": "<16 hex>",
     "versions": [{
       "version": "1.0.0",
       "apiVersion": "1",
       "minAppVersion": "1.12.0",
       "url": "https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/packages/panel-theme-collection-1.0.0.agentpet-plugin",
       "sha256": "<64 hex>",
       "size": 1234567,
       "publishedAt": "2026-11-08T00:00:00.000Z"
     }]
   }
   ```
5. **Catalog PR** in `agent-pets-plugins`: add `packages/panel-theme-collection-1.0.0.agentpet-plugin` and the `index.json` entry. CI `scripts/validate-catalog.mjs` must pass (it needs the §10.2 changes first). The reviewer compares the declared contributions with the content and checks that background images contain no UI-like imagery (fake buttons or permission prompts). Merge. Any later change means a new version, never an in-place edit.
6. **Key rotation/loss:** users see a key-change confirmation (Cancel focused). Document the new fingerprint in the release notes.

## 15. Assumptions not verified in code
- `check-contrast.mjs` alias resolution across the dark block after the `--builtin-organic-*` refactor.
- Whether `archive-guard.ts` enforces a compression ratio (only total and file caps were observed).
- The install-plan error/diagnostic shape (a developer-only `diagnostic` field must be added).
- `validate-catalog.mjs` internals (facts taken from the coordinator: extension list, 64 files, 20 MB per file, 25 MB total).
- `ConfirmDialog` / `Dialog` mount location (inside `.status-panel` or teleported). If teleported outside, it is unthemed anyway; `.host-protected` is harmless.
- Precedence between `tokens.css` `.status-panel { --focus-ring-color: var(--focus-ring-color-on-light) }` and `StatusPanel.css` `--focus-ring-color: var(--organic-accent)`. The spec assumes the StatusPanel.css value wins (it loads later), which is why the accent has a 3:1 rule.
- Prod app CSP comes from the `index.html` meta tag (the protocol handler adds no CSP header for `agent-pets://app`). Dev uses the Vite origin, where `agent-pets://panel-theme` must still be listed explicitly.

## 16. Phase 2 (in progress): one theme for every surface

Requested after this phase was built. It supersedes "panel-only" and "protected regions never themed". All five items are implemented in 1.12.0: item 4 (R13), items 1, 3 and 5 (R14, R15), item 2 (R16).

1. **One semantic token layer** for both windows: surface levels (base, raised, sunken, overlay), text levels, accent / onAccent / accentHover, border / divider, focus ring, scrim, input bg/border, state success/warn/error/info with on-colours, tooltip / popover / menu surfaces, toast, pet pill and bubble surfaces. Every `src/**` colour, radius and font goes through it; `check:design:strict` fails on any raw colour outside `tokens.css`.
2. **Manifest**: `modes.<mode>.colors` grows to the full semantic set (current required core + optional extended keys derived from the core). Typography and shape apply app-wide. Background images stay limited to the panel/dialog backdrop.
3. **Safety by invariants instead of protected regions**: permission/risk UI is themed, but layout, labels and hold-to-confirm stay host-fixed; danger / success / warn must stay inside OKLCH hue/chroma bands (red, green, amber), risk badges and accent must be separated by a minimum OKLab ΔE, the focus ring ≥ 3:1 on every surface, and every token pair is contrast-checked on every surface it can appear on. Failures reject with pair, measured and required values.
4. **Read API for plugins** (implemented, see R13): a versioned public subset `--ap-*` injected into plugin panelView documents and updated live, plus `theme.get()` / `theme.onDidChange` in the worker and panel bridge returning the canonical token map and mode name (no user image, no other plugin ids). No permission (display-only data); documented with a stable token table and d.ts types.
5. **Performance**: one style recalculation per window per switch (single generated rule set or one batched frame), no per-component watchers, validation cached by theme hash, the pet window receives only its tokens.
