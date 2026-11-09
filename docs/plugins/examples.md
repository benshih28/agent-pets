# Examples

These sources are references under the documentation tree; they are not packaged or shipped with the app. Tests validate each example's `plugin.json` with the production `parsePluginManifest` function and check that example panel styles read colours, radii and fonts only from `--ap-*`.

- [hello-feed](examples/hello-feed/): the completed getting-started tutorial; shows one bubble after loading.
- [github-pr-watch](examples/github-pr-watch/): demonstrates a manifest host allowlist, `network.userGranted`, `secrets`, `settings`, `schedule`, and `dedupeKey`. Save a `githubToken` secret in the plugin panel. Without a token, GitHub may apply a lower anonymous API rate limit. The sample never logs the token.
- [event-source-status](examples/event-source-status/): sends a short-lived observe-only status, labeled as plugin-sourced and kept outside built-in Agent status.
- [panel-demo](examples/panel-demo/): a settings-panel page that reads plugin storage and exchanges messages with its background Worker. Styled only with the `--ap-*` theme tokens, so it follows the user's panel theme and light/dark mode.
- [pomodoro](examples/pomodoro/): a 25-minute focus reminder that uses only Agent status, schedule, feed, and badge APIs.
- [break-reminder](examples/break-reminder/): the finished [tutorial](tutorial.md) plugin: schedule, notification, command, Tray item, settings form and panel page (colours, radii and fonts from `--ap-*`, spacing from the shared `tokens.css`).
- [skin-pack](examples/skin-pack/): a skins-only plugin package with no `entry` or Worker.

Start with the [quickstart](getting-started.md) and the [tutorial](tutorial.md), then read the [API reference](api-reference.md) and [Security](security.md).
