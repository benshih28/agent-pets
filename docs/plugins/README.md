# Agent Pets plugin developer handbook

Plugins run in an isolated background Worker and can optionally add a sandboxed page to the plugin area of Settings. They can show pet notifications, request reactions, add user-triggered panel and Tray commands, show status badges, provide pet skins, read authorized Agent status, and publish clearly labeled observe-only statuses. They can also use controlled network, secrets, settings, schedule, and private storage APIs. They get no Node.js, filesystem or shell access, no arbitrary network access, and no access to another plugin's data. The Host API major version is `apiVersion: "1"`.

Users install a `.agentpet-plugin` package from **Settings → Integrations → Plugins**; with Developer mode on you can load a plain folder while developing. Plugins are untrusted code and always shown with their requested permissions before installing.

## Learning path

1. [5-minute quickstart](getting-started.md): a plugin that shows one notification.
2. [Concepts](concepts.md): the Worker sandbox, host RPC, manifest, contribution points, permissions and consent.
3. [Tutorial](tutorial.md): build a plugin with a notification feed, a command, settings and a panel page.
4. [UX guidelines](ux-guidelines.md): how plugins appear in the app, and how to write titles, descriptions and permission reasons.
5. [Testing and debugging](debugging.md): developer mode, diagnostics, logs.
6. Ship it: [packaging and versioning](packaging-and-versioning.md), [signing and online catalog](signing.md), [publishing to the online catalog](publishing.md).
7. [Security checklist](security.md).
8. [FAQ and troubleshooting](faq.md).

## Reference

- [Manifest fields](manifest.md) and [JSON Schema](plugin.schema.json)
- [Host API reference](api-reference.md) and [TypeScript declarations](agent-pets-plugin.d.ts)
- [Contribution points](contribution-points.md)
- [Permissions and consent](permissions.md)
- [Sandbox](sandbox.md)
- [Resource and rate limits](limits.md)
- [Notifications](notifications.md)
- [Panel views](panel-view.md)
- [Reporting plugin issues](reporting.md)
- [Examples](examples.md)

Examples under `examples/` are author references only. They are not packaged or shipped with the app.
