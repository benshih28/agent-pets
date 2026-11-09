# Tutorial: build a break reminder

You will build **Break reminder**: it sends a pet notification on a schedule, offers a "Remind me now" command in the Tray and on its detail page, lets the user set the interval and text, and has a small panel page with a counter. The finished plugin is in [`examples/break-reminder`](examples/break-reminder/). Its structure and APIs are the same ones the test fixtures `tests/fixtures/plugins/ok-commands` and `ok-panel` use, so everything here is exercised by the repository tests.

Prerequisite: finish the [5-minute quickstart](getting-started.md) so you know how to load a folder in developer mode.

```text
break-reminder/
├── plugin.json
├── dist/main.js
└── ui/
    ├── index.html
    ├── panel.css
    └── panel.js
```

## 1. Declare the manifest

```json
{
  "id": "break-reminder",
  "name": { "zh-TW": "休息提醒", "en-US": "Break reminder" },
  "version": "1.0.0",
  "apiVersion": "1",
  "author": "Agent Pets example",
  "entry": "dist/main.js",
  "permissions": {
    "storage": true,
    "schedule": { "minIntervalSec": 60 }
  },
  "contributes": {
    "feed": true,
    "settings": { "type": "object", "properties": {
      "intervalMinutes": { "type": "number", "title": { "zh-TW": "提醒間隔（分鐘）", "en-US": "Reminder interval (minutes)" }, "minimum": 5, "maximum": 120, "default": 30 },
      "message": { "type": "string", "title": { "zh-TW": "提醒內容", "en-US": "Reminder text" }, "maxLength": 120, "default": "Stretch, drink some water, rest your eyes." }
    } },
    "commands": [ { "id": "remind-now", "title": { "zh-TW": "現在提醒我", "en-US": "Remind me now" } } ],
    "tray": { "commands": ["remind-now"] },
    "panelView": { "entry": "ui/index.html", "title": { "zh-TW": "休息提醒", "en-US": "Break reminder" }, "preferredSize": { "width": 420, "height": 320 } }
  }
}
```

Why each part is there:

- `storage` keeps the counter across restarts; `schedule` allows `api.schedule.every` (the minimum can never go below 30 seconds).
- `feed` allows `api.feed.notify`. `settings` renders a form on the detail page; every field needs a bilingual `title` or the key is shown, and defaults are applied by `api.settings.get()`.
- `commands` declares what the user can trigger; `tray` lists up to five of those ids for the Tray submenu.
- `panelView` points at an HTML file in the package.

The manifest in the repository is checked against the production validator by `tests/plugin-public-docs.test.mts`.

## 2. Write the Worker

`dist/main.js`:

```js
export default {
  async activate(api) {
    const stored = await api.storage.get('count')
    let count = stored.found ? Number(stored.value) || 0 : 0
    let cancel = null

    const remind = async (reason) => {
      const { message } = await api.settings.get()
      count += 1
      await api.storage.set('count', count)
      await api.feed.notify({ title: 'Time for a break', body: String(message), dedupeKey: `break-${Date.now()}` })
      await api.ui.postMessage({ type: 'break:state', count, reason })
    }

    const start = async () => {
      if (cancel) cancel()
      const { intervalMinutes } = await api.settings.get()
      cancel = api.schedule.every(Number(intervalMinutes) * 60, () => remind('schedule'))
    }

    await start()
    api.settings.onChange(() => { void start() })
    api.commands.onInvoke(async (commandId) => {
      if (commandId === 'remind-now') await remind('command')
    })
    api.ui.onMessage(async (message) => {
      if (message?.type === 'break:get') await api.ui.postMessage({ type: 'break:state', count, reason: 'sync' })
      if (message?.type === 'break:remind') await remind('panel')
    })
  },
}
```

Points to notice:

- `schedule.every` returns a cancel function; cancel and recreate it when settings change. The host skips a tick while the previous async callback is still running, and allows at most 16 schedules per plugin.
- `settings.onChange` fires when the user saves the form. It never carries secret values.
- Commands arrive only from the user (detail page or Tray); the plugin cannot invoke them.
- `ui.postMessage` resolves to `{ delivered: false }` if the panel is closed, so the panel asks for state when it opens (`break:get`).
- The feed allows 5 items per plugin per 10 minutes by default. Clicking "Remind me now" repeatedly will reject with `rate_limited`; the error appears in **Diagnostics**.

## 3. Write the panel page

`ui/index.html` loads the shared design tokens, then your own CSS and module script:

```html
<link rel="stylesheet" href="agent-pets://plugin/_shared/tokens.css">
<link rel="stylesheet" href="./panel.css">
<script type="module" src="./panel.js"></script>
```

`ui/panel.js` uses `window.agentPetsPlugin`, the panel subset of the API:

```js
const api = window.agentPetsPlugin
api.ui.onMessage((message) => {
  if (message?.type === 'break:state') document.querySelector('#count').textContent = `Reminders sent: ${message.count}`
})
document.querySelector('#remind').addEventListener('click', () => api.ui.postMessage({ type: 'break:remind' }))
await api.ui.postMessage({ type: 'break:get' }).catch(() => {})
```

The full files, including error handling, are in the example folder. `ui/panel.css` takes every colour, radius and font from the `--ap-*` theme tokens the host writes on `<html>` (they follow the user's panel theme and light/dark mode live) and only spacing and type sizes from the shared `tokens.css`; `ui/panel.js` sets `color-scheme` from `api.theme.get()` / `onDidChange`. See [Panel themes](panel-themes.md) and the [UX guidelines](ux-guidelines.md), and never rely on external URLs.

## 4. Load and try it

1. Turn on Developer mode (**Plugins → Advanced**) and use **Load from folder…** on `break-reminder`.
2. In the install sheet, confirm that the permission list matches what you declared (storage, schedule, notifications, panel, commands, Tray). Choose **Agree and install**, then **Enable now**.
3. Open the plugin's detail page: **Settings** edits the interval and text, **Commands** runs "Remind me now", **Diagnostics** shows your `api.log` output and rejected calls.
4. Use the Tray: **Break reminder → Remind me now**. A bubble appears next to the pet, and the item is also in the **Notifications** tab.
5. Choose **Open plugin panel** to see the page; the counter updates after each reminder.

Edit `dist/main.js` and save: the folder reloads after 500 ms. If your edit adds a permission, reload stops until you consent again.

## 5. Test it

Parse the manifest with the production validator, the same call the repository tests make:

```ts
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
const result = parsePluginManifest(JSON.parse(fs.readFileSync('plugin.json', 'utf8')))
assert.equal(result.ok, true)
```

For package-level behavior, copy the layout of a fixture under `tests/fixtures/plugins/` and use `node scripts/pack-test-plugin.mjs <fixture-id> <output.agentpet-plugin>` to build a package from it. See [Testing and debugging](debugging.md).

## 6. Package and ship

```sh
cd break-reminder
zip -r ../break-reminder.agentpet-plugin plugin.json dist/ ui/
```

Then follow [packaging and versioning](packaging-and-versioning.md), [signing](signing.md) and [publishing](publishing.md).
