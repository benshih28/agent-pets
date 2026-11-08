# Testing and debugging

## Test before you ship

- **Validate the manifest** with the production parser, exactly as the repository tests do: `parsePluginManifest(JSON.parse(text))` from `electron/plugin-manifest.ts` returns `{ ok: true }` or an error code (`invalid_id`, `invalid_permissions`, `invalid_host`, `invalid_settings`, `invalid_contributions`, …). Check your editor against [`plugin.schema.json`](plugin.schema.json) too, but the parser is authoritative.
- **Install the package** you will publish, not only the folder: folder loading and packages share validation, but only a package proves the file list, size limits and signature.
- **Use the fixtures** in `tests/fixtures/plugins/` as ground truth for both good (`ok-*`) and hostile (`evil-*`) plugins. `node scripts/pack-test-plugin.mjs <fixture-id> <output.agentpet-plugin>` packs one so you can install it and compare behavior. The repository suite (`pnpm test:unit`) also validates every example under `docs/plugins/examples`.
- Test the unhappy paths: plugin disabled, Do Not Disturb on, pet hidden, rate limit reached, network host not granted, panel closed when you call `api.ui.postMessage`.

## Developer mode

1. Turn on **Plugins → Advanced → Developer mode** and use **Load from folder…**. The plugin row is marked **Development folder · signature not verified**.
2. Edits are revalidated and reloaded after a 500 ms debounce. An invalid manifest or a permission increase does not replace the installed version; added permissions need fresh consent. Folder watching stops when the app restarts or the folder is deleted; load it again.
3. Turn Developer mode off when you are not developing: it allows unsigned folders.

## Diagnostics

Open the plugin's detail page → **Diagnostics**.

- **Recent logs** are what the plugin wrote with `api.log.info/warn/error` (up to 200 entries of 1000 characters each). Filter by level and **Copy** the lot for a bug report.
- **Rejected calls** show the error code and method for calls the host refused, with a plain-language reason (no permission, too many requests, plugin disabled).
- Check the **Notifications** tab to see whether Do Not Disturb, mute, a hidden pet or a rate limit sent a notification to the inbox instead of a bubble.

Diagnostics never show your source folder path or secrets. Never log secrets or private user data yourself.

## Log files and exported diagnostics

Plugin log lines are also written, redacted, to the app's `logs/main.log` (in the userData folder, rotated at 1 MB, three files) with the channel `plugin:<plugin-id>`. Host crashes are logged under the channel `plugin-host` with the crash reason and consecutive count. **Settings → Integrations → Advanced → Export diagnostics** saves a report with a `pluginHost` section (plugins wanted and running, recent crashes) plus the recent log; attach it to bug reports. Tokens, prompts and personal paths are removed and nothing is uploaded.

## Common errors

- `host_not_allowed`: the host is undeclared or not granted, not HTTPS, an IP or localhost, or resolves to a non-public address. Fix the manifest host or ask through `requestHost`.
- `rate_limited`: a per-minute network quota, per-10-minute feed quota, per-second badge or command limit was reached. Reduce polling or ask the user to adjust the limit in the plugin's settings.
- `not_permitted`: the manifest lacks the permission or contribution the API needs, `network.userGranted` is absent, or the API is unavailable while disabled.
- `schedule_invalid`: the interval is not a positive number in range, or the plugin already holds 16 active schedules. Cancel schedules you no longer need.
- `host_unavailable`: the plugin Worker is not ready yet (for example just after a crash or restart).
- `invalid_request`: check argument types, field names, text lengths and the manifest.
- Plugin disabled after crashes: the Host pings each Worker every 10 seconds and terminates it after 30 seconds without a pong. Three consecutive failures disable the plugin and post a notification. Host-window startup retries at most three times, after 250 ms, 1 second and 5 seconds.

Failed API calls reject an `Error` with `code`; successful calls return values directly. See the [API reference](api-reference.md) and the [FAQ](faq.md).
