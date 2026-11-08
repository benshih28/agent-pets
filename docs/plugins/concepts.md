# Concepts

Five ideas explain how a plugin works. Each links to the full reference.

## Worker sandbox

The `entry` file of a plugin runs in a restricted Web Worker inside one hidden Plugin Host window that exists only while at least one plugin is enabled. The module must `export default { activate(api) { … } }`; `activate` receives the frozen `api` object and may be async. Node.js, `process`, Electron, the filesystem, `fetch`, `WebSocket`, `indexedDB` and nested Workers are not available, and a plugin can only import files from its own package. The host pings each Worker every 10 seconds and restarts it after 30 seconds of silence; three consecutive crashes disable the plugin. Details: [Sandbox](sandbox.md), [limits](limits.md).

## Host RPC

Everything a plugin can do outside its Worker is a request to the host through `api.*`. Each call is checked in the main process against the manifest and the user's state (plugin enabled, global switch, Do Not Disturb, rate limits) before anything happens. A call that succeeds resolves to a plain value; one that fails rejects an `Error` whose `code` is a stable string such as `not_permitted`, `rate_limited` or `host_not_allowed`. Callback-style methods (`schedule.every`, `settings.onChange`, `commands.onInvoke`, `pet.onStatusChange`, `ui.onMessage`) return an unsubscribe function and throw coded errors immediately. Requests are plain JSON of at most 256 KB. Reference: [API reference](api-reference.md), [TypeScript declarations](agent-pets-plugin.d.ts).

## Manifest

`plugin.json` is the plugin's contract: identity (`id`, bilingual `name`, `version`, `author`), `apiVersion` (only `"1"`), the `entry` file, the `permissions` it needs and the `contributes` it adds. Unknown fields fail the install, and the runtime validator is authoritative over the [JSON Schema](plugin.schema.json). A manifest without `entry` may only provide skins. Reference: [Manifest fields](manifest.md).

## Contribution points

A contribution is something the user sees. Declare only what you use.

| Contribution | Appears as |
|---|---|
| `feed` | pet bubble and the Notifications inbox |
| `reaction` | a pet animation |
| `settings` | a form on the plugin's detail page |
| `panelView` | your own HTML page inside the panel frame |
| `commands`, `tray` | buttons on the detail page and items in the Tray menu |
| `badge` | a small capsule beside the pet's status line |
| `skins` | selectable pet skins |
| `eventSource` | a separate, labeled work-status row |

Reference: [Contribution points](contribution-points.md), [Panel views](panel-view.md), [Notifications](notifications.md).

## Permissions and consent

Capabilities are explicit. `permissions` covers network hosts, link hosts, secrets, schedule, storage and Agent status; `contributes` covers what shows up in the UI. The install sheet lists every item grouped by risk (network and links, data and secrets, display), a newly installed plugin starts disabled, and an update that adds a permission or contribution needs new consent. High-risk changes (new network, link or secret permissions, a changed or removed signing key) additionally require ticking an acknowledgement box. Network access can also be extended at run time with `api.net.requestHost`, which asks the user per host. Reference: [Permissions and consent](permissions.md).
