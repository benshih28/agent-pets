# Debugging

1. Turn on **Advanced ▸ Developer mode** in the plugin panel and load a folder. The plugin row shows **Development**. Changes debounce for 500 ms. An invalid manifest or permission increase does not replace the installed version; added permissions need fresh consent.
2. Select a plugin in the panel and inspect **Diagnostics** for logs and rejection reasons. Logs retain up to 200 entries of at most 1000 characters each. Never log secrets or private user data.
3. Check the notification center to see whether DND, mute, hidden pets, or a rate limit routed an item there.

Common errors:

- `host_not_allowed`: the host is undeclared/ungranted, not HTTPS, an IP/localhost, or resolves to any non-public address. Fix the manifest host or ask through `requestHost`.
- `rate_limited`: the per-minute network or per-10-minute feed quota is spent. Reduce polling or ask the user to adjust the panel limit.
- `not_permitted`: the manifest lacks the required permission, `network.userGranted` is absent, or the API is unavailable while DND/disabled.
- Plugin disabled after crashes: the Host pings every 10 seconds and terminates a Worker after 30 seconds without a pong. Three consecutive failures disable the plugin and create a notification. Host-window startup retries at most three times, after 250 ms, 1 second, and 5 seconds.
- `invalid_request`: check argument types, field names, text lengths, and the manifest. Failed API calls reject an Error with `code`; successful calls return values directly.

Diagnostics do not show the full source folder path or secrets. After deleting the folder or restarting the app, load it again to resume watching.
