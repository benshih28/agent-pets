# The `plugin.json` manifest

The manifest root accepts only the fields below; unknown fields make installation fail. See [`plugin.schema.json`](plugin.schema.json). The runtime validator remains authoritative.

| Field | Required | Rule |
|---|---|---|
| `id` | Yes | 3–48 lowercase letters, digits, or `-`; `_host` and `_shared` are reserved. |
| `name` | Yes | Contains both `zh-TW` and `en-US`, each 1–48 characters. |
| `version` | Yes | `major.minor.patch`, non-negative integers without leading zeroes, such as `1.2.0`. |
| `apiVersion` | Yes | Only the string `"1"` is supported. Other values are incompatible and rejected. |
| `author` | Yes | 1–64 characters. |
| `entry` | Conditional | Safe relative `.js` path, required for regular plugins. It may be omitted only when `permissions` is `{}` and every contribution is a workerless one (`skins`, `panelThemes`) with at least one item. |
| `icon` | No | Relative `.png` or `.webp` path with a valid PNG/WebP signature. |
| `permissions` | Yes | Object containing any of `network`, `links`, `secrets`, `schedule`, `storage`, `agentStatus`. |
| `contributes` | Yes | Object containing any of `feed`, `reaction`, `settings`, `panelView`, `commands`, `tray`, `badge`, `skins`, `eventSource`, `panelThemes`. |

`network.hosts` has 1–20 unique DNS names and may use `*.example.com` for subdomains. `links.hosts` has 1–20 exact DNS names and does not accept wildcards. IPs, localhost, and internal domains are not accepted. Optional `network.userGranted` is boolean. `secrets` has up to 10 unique keys: an ASCII letter followed by letters, digits, or underscores, up to 32 characters. `schedule.minIntervalSec` is an integer from 30 to 3600.

Settings use at most 20 keys matching `[A-Za-z][A-Za-z0-9_-]{0,63}`. Types are `string`, `number`, and `boolean`; strings are at most 4096 characters. `enum` has 1–50 unique values and string enum items are at most 256 characters. `format: "secret"` must name a declared secret and cannot have a default. `panelView.entry` is a relative `.html` path with a bilingual title. `preferredSize` is clamped to 320–960 pixels wide and 240–800 high. `commands` allows up to 10 unique ids matching `[a-z][a-z0-9-]{0,31}` with bilingual titles up to 32 characters. `tray.commands` allows up to five declared command ids. `badge` is boolean. `skins` allows up to five entries, each with a unique `id` matching `[a-z0-9-]{1,32}`, a bilingual `displayName` (up to 48 characters), a package PNG/WebP `spritesheet` path, a `kind` of `person` or `animal`, and an optional sanitized `behaviorManifest` (overrides for any motion plus `walk`/`sleep`; same rules as `pet.json`, see the README sprite requirements). Skin packages are limited to 25 MiB total and 20 MiB per spritesheet; packages without skins remain limited to 5 MiB. A manifest without `entry` may only contribute `skins` and/or `panelThemes` and must have an empty permissions object. `panelThemes` (1–8 themes) is described in [panel-themes.md](panel-themes.md); any violation rejects the package with `invalid_panel_theme`.

`eventSource` contains a `family` (up to 80 ASCII characters) and bilingual `displayName` (up to 80 characters per locale). Families are normalized to lowercase with `_`, whitespace, and `.` converted to `-`; built-in families and `generic-http`, `agent-pets`, `plugin`, and `system` are reserved. The contribution requires renewed consent when added by an update. See [API reference](api-reference.md) for status states and limits.

See [`hello-feed`](examples/hello-feed/plugin.json) and [`github-pr-watch`](examples/github-pr-watch/plugin.json) for complete manifests.
