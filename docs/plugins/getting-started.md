# Build your first plugin in 10 minutes

This guide loads a folder in developer mode and then packages it as `.agentpet-plugin`. Plugin code is untrusted; use a test folder while learning.

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

1. Open the Plugins panel in Agent Pets settings.
2. Turn on **Developer mode** under **Advanced**.
3. Choose **Load from folder…** and select `hello-feed`, the directory containing `plugin.json`.
4. Review the name, version, and permissions in the install confirmation, then agree.
5. Enable the plugin and the global plugin switch. A Hello bubble should appear beside the primary pet, and the plugin row should show **Development**.

## 3. Edit and reload

Change the `body` in `dist/main.js` to `Edited and reloaded.` and save. The watcher debounces edits for 500 ms, then reloads through the same package validation. If the edit adds a permission, automatic reload stops until you review and consent in the panel. Invalid files do not replace the installed version. After restarting the app, load the folder again to resume watching.

## 4. Package it

From inside `hello-feed`, run:

```sh
zip -r ../hello-feed.agentpet-plugin plugin.json dist/
```

Choose **Install plugin…**, select the package, and confirm. Folder loading and package installation share manifest, path, size, and file-count validation. See [Packaging and versioning](packaging-and-versioning.md).
