# Sandbox and execution environment

Plugin background code runs in a restricted Web Worker created by the host. It receives a frozen `api.*` object and Host API responses. It has no Node.js, shell, `process`, Electron, environment variables, or access to another plugin's APIs or data. Plugin modules can only load from that plugin's installed package.

These Web APIs are removed or unavailable in the Worker:

- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`: use `api.net.fetch` and declare HTTPS hosts in the manifest.
- `indexedDB`, `caches`, `BroadcastChannel`: use `api.storage` for the plugin's own JSON data.
- Nested `Worker` and `SharedWorker`: use `api.schedule.every` for background work.
- Native Worker cross-thread `postMessage`: use the supplied `api.*` methods; plugins have no inter-plugin channel.

The Host proxies network traffic through Electron `net.request`. It accepts HTTPS without URL credentials and only an empty or standard 443 port. It resolves every hostname and rejects any non-public IPv4/IPv6 address. Each redirect (up to three) is a new request that repeats URL, grant, and DNS checks. Plugin requests neither send nor store cookies; use an `authorization` header and a declared secret for authenticated APIs. A plugin Worker receives a heartbeat every 10 seconds; 30 seconds without a pong terminates it and starts recovery. Three consecutive crashes disable the plugin and add a notification-center message. See [limits](limits.md) for data, size, and rate bounds.
