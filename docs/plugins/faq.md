# FAQ and troubleshooting

**My plugin is installed but does nothing.**
A new plugin starts disabled. Turn it on in **Installed**, and make sure plugins are on globally (a banner says so when they are off). The hidden Plugin Host only runs while at least one plugin is enabled, and at most 10 plugins run at once by default (adjustable in **Advanced**). Then open **Details → Diagnostics**.

**`activate` runs but I see no bubble.**
Bubbles are skipped when Do Not Disturb is on, the pet is hidden, the plugin is muted, or a rate limit applies (5 items per plugin per 10 minutes by default). The item still appears in the **Notifications** tab. Items created while hidden or in DND are not replayed later. See [Notifications](notifications.md).

**Why was my package rejected?**
Check the [packaging rules](packaging-and-versioning.md): only `.js`, `.json`, `.png`, `.webp`, `.html` and `.css` files; at most 5 MB in total and 64 files (skins packages up to 25 MB); `plugin.json` and the declared `entry` at the ZIP root; no symlinks, duplicate paths, `..` paths or HTML outside the panel directory. `unsupported_api_version` means `apiVersion` is not `"1"`.

**Why does an update ask for consent again?**
Any added permission or contribution requires new consent, and high-risk additions (network, links, secrets, changed or removed signing key) need an acknowledgement tick. Keep permissions stable across versions where you can. See [Permissions and consent](permissions.md).

**Can my plugin call an HTTP API, an IP address or localhost?**
No. `api.net.fetch` accepts HTTPS to public DNS names on ports 443 only, from hosts you declared or the user approved. Use `network.hosts` for fixed hosts and `network.userGranted` with `api.net.requestHost` for hosts the user chooses.

**Where do I keep an API token?**
Declare it in `permissions.secrets`, add a `format: "secret"` field to `settings`, and read it with `api.secrets.get(key)`. The user enters it in the plugin's settings; it is stored in the system secure store, never returned in settings snapshots and never sent to `settings.onChange` callbacks. The first time any plugin saves a secret the app shows a one-time notice (on macOS it may ask about Keychain access).

**Can my plugin change its own settings?**
No. The Worker can read settings and subscribe to changes; only the user edits them. Use `api.storage` for state the plugin owns.

**Can my plugin run a shell command, read files or use Node.js modules?**
No. See [Sandbox](sandbox.md). Do work that needs a local tool as a separate app and expose the result over HTTPS if you must.

**My panel page is blank or shows an error.**
Confirm `panelView.entry` points to an `.html` file inside the package and that every asset is a package file (the only external URL a page can load is `agent-pets://plugin/_shared/tokens.css`). Use **Reload panel**, read **Diagnostics**, and remember `fetch` and `WebSocket` are blocked in pages; use `api.net.fetch`. A panel that is still loading after 5 seconds offers Cancel.

**The panel opens at the wrong size.**
`preferredSize` is still validated but no longer resizes the window: the control panel uses one user-resizable size (minimum 360×420, up to the display's work area) for every view, so make your page responsive.

**My schedule stopped firing.**
Callbacks that return a Promise block the next tick until they settle (the host skips overlapping runs), schedules are capped at 16 per plugin, and the effective interval is never below the manifest `minIntervalSec` or the user's minimum (default 60 s). Three consecutive Worker crashes disable the plugin.

**How do I remove all of a plugin's data?**
Use **Remove plugin…** and tick **Also delete its settings and data**. Without it, settings, secrets and permissions are kept for a reinstall.

**Where are the logs?**
On the plugin's **Diagnostics** tab, and in `logs/main.log` under the channels `plugin:<id>` and `plugin-host`. See [Testing and debugging](debugging.md).

**Will `apiVersion` change?**
Only `"1"` exists. No cross-major migration period has been announced; an unsupported API version is shown as incompatible.
