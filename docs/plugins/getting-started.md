# 5-minute quickstart

Build a plugin that shows one notification, load it from a folder in developer mode, then package it. Plugin code is untrusted; use a test folder while learning. Next step: [Concepts](concepts.md) and the [tutorial](tutorial.md).

## 1. Create the files

In a terminal, create `hello-feed`:

```sh
mkdir -p hello-feed/dist
```

Create `hello-feed/plugin.json`:

```json
{
  "id": "hello-feed",
  "name": { "zh-TW": "Hello Feed", "en-US": "Hello Feed" },
  "version": "1.0.0",
  "apiVersion": "1",
  "author": "Your name",
  "entry": "dist/main.js",
  "permissions": {},
  "contributes": { "feed": true }
}
```

Create `hello-feed/dist/main.js`:

```js
export default {
  async activate(api) {
    await api.feed.notify({
      title: 'Hello, Agent Pets!',
      body: 'My first plugin is running.',
      ttlMs: 6000,
      dedupeKey: 'hello-first-run',
    })
  },
}
```

## 2. Load the folder

1. Open **Settings → Integrations → Plugins** (tabs: **Installed / Explore / Notifications / Advanced**).
2. On the **Advanced** tab, turn on **Developer mode**; the install button in the header becomes a menu.
3. Open that menu, choose **Load from folder…**, and select `hello-feed`, the directory containing `plugin.json`.
4. Review the name, version, signature state and risk-grouped permissions in the install sheet, then choose **Agree and install**.
5. The success message offers **Enable now** and also turns plugins on if they were off. A Hello bubble should appear beside the primary pet, and the plugin card should show **Developer folder · signature not verified**.

## 3. Edit and reload

Change the `body` in `dist/main.js` to `Edited and reloaded.` and save. The watcher debounces edits for 500 ms, then reloads through the same package validation. If the edit adds a permission, automatic reload stops until you review and consent in the panel. Invalid files do not replace the installed version. After restarting the app, load the folder again to resume watching.

## 4. Package it

From inside `hello-feed`, run:

```sh
zip -r ../hello-feed.agentpet-plugin plugin.json dist/
```

Choose **Install from file…**, select the package, and confirm. Folder loading and package installation share manifest, path, size, and file-count validation. See [Packaging and versioning](packaging-and-versioning.md).
