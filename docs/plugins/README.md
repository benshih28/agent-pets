# Agent Pets plugin development

Plugins run in an isolated background Worker and can optionally add a sandboxed page to the settings panel. They can show feed notifications, request pet reactions, add user-triggered panel and Tray commands, display status badges, provide pet skins, read authorized Agent status, and publish clearly labeled observe-only statuses. They can also use controlled network, secrets, settings, schedule, and private storage APIs. Plugins do not receive Node.js, filesystem or shell access, arbitrary network access, or another plugin's data. The Host API major version is `apiVersion: "1"`.

Install a `.agentpet-plugin` package from **Settings → Plugins**, or enable Developer mode to load a plugin folder while developing. Review its declared contributions and permissions before installing; plugins are untrusted code, and network access is limited to declared/approved HTTPS hosts. Online catalog installs and author signatures use explicit user confirmation. See [Security](security.md) and the [10-minute guide](getting-started.md).

## Guides

- [Getting started in 10 minutes](getting-started.md)
- [Manifest fields](manifest.md)
- [Permissions and consent](permissions.md)
- [Host API reference](api-reference.md)
- [Contribution points](contribution-points.md)
- [Sandbox](sandbox.md)
- [Resource and rate limits](limits.md)
- [Notifications](notifications.md)
- [Debugging](debugging.md)
- [Packaging and versioning](packaging-and-versioning.md)
- [Signing and online catalog](signing.md)
- [Publishing to the online catalog](publishing.md)
- [Reporting plugin issues](reporting.md)
- [Security](security.md)
- [Panel views](panel-view.md)
- [Examples](examples.md)
- [Manifest JSON Schema](plugin.schema.json)
- [TypeScript Host API](agent-pets-plugin.d.ts)

Examples under `examples/` are author references only. They are not packaged or shipped with the app.
