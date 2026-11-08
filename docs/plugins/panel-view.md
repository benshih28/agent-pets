# Panel views

A plugin can contribute one HTML page to the Agent Pets settings panel. The page runs in its own sandboxed `WebContentsView` and non-persistent, plugin-specific session. It is separate from the app renderer; do not use an iframe.

## Manifest and package files

Put the panel page and its assets under one directory in the plugin package. The entry path is relative to the package root and must end in `.html`.

```json
{
  "contributes": {
    "panelView": {
      "entry": "ui/index.html",
      "title": { "zh-TW": "專案狀態", "en-US": "Project status" },
      "preferredSize": { "width": 520, "height": 440 }
    }
  }
}
```

`preferredSize` is optional and is still validated (width 320–960 px, height 240–800 px), but it no longer resizes the window. The control panel has one size for every view, chosen by the user by dragging its edges (minimum 360×420, up to the current display's work area minus a small gap) and saved in `panel-size.json` in the app's userData folder (ignored if damaged), so opening your page never moves or resizes the window. Design the page to be responsive. The panel header also lets the user reload, jump to the plugin's permissions and settings, or toggle maximize (double-click the header; Esc restores). The plugin cannot move or resize its window directly.

The host draws the panel border, plugin icon and name, the “Plugin content” marker, and the close button outside the plugin view. Keep page controls inside your own content area. A page can draw arbitrary content inside that area, so users should use the host-drawn identity and controls when deciding whether a prompt is genuine.

## Files and styles

The page can load files from its own plugin package and the read-only shared stylesheet. It cannot load another plugin's files or arbitrary URLs.

```html
<link rel="stylesheet" href="agent-pets://plugin/_shared/tokens.css">
<link rel="stylesheet" href="./panel.css">
<script type="module" src="./panel.js"></script>
```

The shared stylesheet is the app's own `tokens.css`. The page does not receive the app's light/dark switch, so it gets the default dark palette (set `color-scheme: dark`), and the page view is transparent until your content paints. Use tokens such as `--surface-panel`, `--text-primary` and `--border-subtle` with fallbacks for standalone previews, and see the [UX guidelines](ux-guidelines.md) for the full list and the rules for glass. The host destroys the page when it is closed or the user switches away; persist state with `api.storage` and keep background work in the plugin Worker.

## Panel API

The panel page receives `window.agentPetsPlugin`. It exposes `feed.notify`, `pet.status`, `storage.get/set/remove`, `settings.get`, `log.info/warn/error`, `net.fetch`, `links.openExternal`, and `ui.postMessage/onMessage`. It does not expose `secrets.get` or `net.requestHost`. `links.openExternal` requires a declared exact HTTPS host and a current trusted click or Enter/Space activation; it opens the system browser without giving the panel navigation rights. Direct network APIs such as `fetch`, `XMLHttpRequest`, and `WebSocket` are blocked; `net.fetch` still uses the plugin's declared or user-approved HTTPS hosts.

Successful calls return their value directly. Failed calls reject an `Error` with a `code` such as `not_permitted`, `host_not_allowed`, `rate_limited`, `too_large`, or `disabled`.

### Message exchange with the Worker

Use `ui` to send JSON data between this page and the background Worker for the same plugin. Each message must serialize as JSON, be at most 256 KB, and stay within 20 messages per second per plugin and direction.

```js
const api = window.agentPetsPlugin

api.ui.onMessage(message => {
  if (message.type === 'saved') {
    document.querySelector('#status').textContent = 'Saved'
  }
})

const result = await api.ui.postMessage({ type: 'save', value: 'draft' })
if (!result.delivered) document.querySelector('#status').textContent = 'Worker unavailable'
```

The Worker uses the corresponding `api.ui.onMessage` and `api.ui.postMessage` methods. A Worker message sent while the panel is closed is dropped and is not queued; its call resolves to `{ delivered: false }`. A panel message fails with `disabled` if its Worker is unavailable. Use `storage` for data that must survive a closed panel or app restart. Invalid JSON data rejects with `invalid_request`; oversized messages reject with `too_large`; excess messages reject with `rate_limited`.

## Browser restrictions

The panel cannot make direct network requests, open its own window, navigate to another URL, download files, request permissions, or receive file drops. Its only external-opening path is the bounded `links.openExternal` Host API described above. The host blocks the other actions in the session and the panel renderer. The page also cannot access the parent app renderer: `window.parent` and `window.top` refer to the panel page itself.

See the [panel-demo example](examples/panel-demo/) for a complete manifest, Worker, and panel page. The [TypeScript declarations](agent-pets-plugin.d.ts) include the Worker and panel API shapes.
