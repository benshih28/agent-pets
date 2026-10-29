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
| `contributes.eventSource` | `Show plugin-reported work in a separate status list` |

`network.hosts` is the pre-approved host list. With `userGranted: true`, the plugin may call `api.net.requestHost(host, reason)` with a bare DNS hostname (no wildcard) and a 1–120 character reason. The host is checked for public DNS before a native confirmation appears. A denial suppresses another prompt for that host for 24 hours; each plugin can request at most three hosts per 10 minutes. Granted dynamic hosts appear in settings and can be revoked. Consent never permits HTTP, IP literals, localhost, private/reserved IPs, or DNS resolving to a non-public address.

`links.hosts` is a separate exact-host allowlist for `links.openExternal()` in a contributed panel page. It does not grant network access. The host opens only after a current trusted click or Enter/Space activation, must use HTTPS without credentials or a custom port, and is limited to five attempts per plugin per minute. Wildcards are not accepted.

An update that adds any permission or contribution requires renewed consent. Declining leaves the installed version in place. `contributes.settings` allows the plugin to read non-secret values entered by the user in the panel. A `format: "secret"` field is read only with `api.secrets.get` and is omitted from the ordinary settings API.
