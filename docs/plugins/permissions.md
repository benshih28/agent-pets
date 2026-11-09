# Permissions and user consent

Declare only the capabilities you need. The install confirmation lists requested permissions. A newly installed plugin starts disabled; the user must enable it and the global plugin switch.

| Manifest permission or contribution | Confirmation text |
|---|---|
| `network.hosts: ["api.example.com"]` | `Connect to api.example.com` |
| `links.hosts: ["docs.example.com"]` | `Open docs.example.com in your browser` |
| `secrets: ["githubToken"]` | `Read the secret setting “githubToken”` |
| `schedule` | `Run on a schedule` |
| `storage: true` | `Store plugin data on this device` |
| `agentStatus: true` | `Know when Agents are busy, idle, or waiting` |
| `contributes.feed: true` | `Show notifications in the pet status bubble` |
| `contributes.reaction: true` | `Request a pet reaction` |
| `contributes.commands` | `Provide command buttons in the plugin panel` |
| `contributes.tray` | `Add items to the Tray menu` |
| `contributes.badge: true` | `Show a badge in the pet status line` |
| `contributes.skins` | `Provide N pet skins` (the manifest count is substituted) |
| `contributes.panelThemes` | `Provide N panel themes` (low; the count is part of the unit, so adding themes asks again) |
| `contributes.panelThemeFonts` | `Include custom fonts for the panel` (medium; shown when any theme packages `.woff2` fonts) |
| `contributes.eventSource` | `Show plugin-reported work in a separate status list` |

`network.hosts` is the pre-approved host list. With `userGranted: true`, the plugin may call `api.net.requestHost(host, reason)` with a bare DNS hostname (no wildcard) and a 1–120 character reason. The host is checked for public DNS before a native confirmation appears. A denial suppresses another prompt for that host for 24 hours; each plugin can request at most three hosts per 10 minutes. Granted dynamic hosts appear in settings and can be revoked. Consent never permits HTTP, IP literals, localhost, private/reserved IPs, or DNS resolving to a non-public address.

`links.hosts` is a separate exact-host allowlist for `links.openExternal()` in a contributed panel page. It does not grant network access. The host opens only after a current trusted click or Enter/Space activation, must use HTTPS without credentials or a custom port, and is limited to five attempts per plugin per minute. Wildcards are not accepted.

`theme.get()`, `theme.onDidChange()` and the `--ap-*` tokens on panel pages need no permission and add nothing to the install sheet; they expose only the display values the user already sees (see [Panel themes](panel-themes.md#reading-the-theme-in-your-plugin---ap--host-api-theme)).

## What the install sheet shows

Before installing, updating, downgrading or reinstalling, the sheet shows the source (catalog, local file or developer folder), the version change, the author signature state, and every permission as a plain-language sentence **grouped by risk**: network and links and secrets are high, storage, schedule and Agent status are medium, display contributions are low. For an update the new permissions are listed apart from the existing ones. Unknown permission units are always shown as high risk.

An update that adds any permission or contribution requires renewed consent. Declining leaves the installed version in place. High-risk changes also require ticking **I understand these changes**, with focus starting on Cancel: a changed signing key, a dropped signature, or new network, link or secret permissions. The first time a secret is saved, the app shows a one-time notice that secrets are encrypted with the system secure store (macOS may ask about Keychain access). `contributes.settings` allows the plugin to read non-secret values entered by the user in the panel. A `format: "secret"` field is read only with `api.secrets.get` and is omitted from the ordinary settings API.
