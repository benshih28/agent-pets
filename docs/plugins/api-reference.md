# Host API reference (apiVersion 1)

Successful calls return the values listed below directly. A failure rejects an `Error` whose `code` is one of the listed strings. Do not depend on internal error details. See [`agent-pets-plugin.d.ts`](agent-pets-plugin.d.ts) for TypeScript declarations and the [complete error-code tables](../security/ipc-error-codes.md).

| Method | Permission / result | Errors and copyable example |
|---|---|---|
| `feed.notify(item)` | `contributes.feed`; `{itemId, delivery}` | `invalid_request`, `host_not_allowed`, `rate_limited`, `queue_full`, `duplicate`, `disabled`, `not_permitted`. `await api.feed.notify({title:'Done',body:'Build passed.'})` |
| `pet.react(reaction, options?)` | `contributes.reaction`; `{accepted:true}` | `invalid_request`, `rate_limited`, `queue_full`, `not_found`, `disabled`, `not_permitted`. `await api.pet.react('happy')` |
| `pet.status()` | `permissions.agentStatus`; `PetStatusChange[]` | `not_permitted`, `agent_status_unavailable`, `disabled`. `const pets = await api.pet.status()` |
| `pet.onStatusChange(fn)` | `permissions.agentStatus`; unsubscribe function | Throws `not_permitted` or `invalid_request` immediately. `const off = api.pet.onStatusChange(s => api.log.info(s.visibleState))` |
| `net.fetch(url, options?)` | `permissions.network`; `{status,headers,body,isBase64Encoded?}` | `invalid_request`, `host_not_allowed`, `too_many_redirects`, `timeout`, `too_large`, `rate_limited`, `disabled`, `not_permitted`. `const r = await api.net.fetch('https://api.example.com/status')` |
| `net.requestHost(host, reason)` | `network.userGranted`; `{granted:true,host}` | `invalid_request`, `rate_limited`, `denied`, `host_not_allowed`, `disabled`, `not_permitted`. `await api.net.requestHost('api.example.com','Read release notes')` |
| `links.openExternal(url)` (panel only) | `permissions.links`; `{opened:true}` | `invalid_request`, `host_not_allowed`, `denied`, `rate_limited`, `host_unavailable`, `disabled`, `not_permitted`. Call directly from a click or Enter/Space handler: `await api.links.openExternal('https://docs.example.com/release')` |
| `secrets.get(key)` | manifest `permissions.secrets`; `string` | `not_permitted`, `secret_unavailable`, `secret_not_found`, `disabled`. `const token = await api.secrets.get('githubToken')` |
| `settings.get()` | `contributes.settings`; non-secret settings object | `not_permitted`, `settings_invalid`, `disabled`. `const options = await api.settings.get()` |
| `settings.onChange(fn)` | unsubscribe function | Throws `invalid_request` immediately. Non-secret setting changes and secret additions, updates, or clears trigger the callback; the value contains non-secret settings only. Call `api.secrets.get(key)` from the callback to read an authorized secret. `api.settings.onChange(v => api.log.info(v.repository))` |
| `schedule.every(seconds, fn)` | manifest `permissions.schedule`; cancel function | Throws `not_permitted` or `schedule_invalid` immediately. `const cancel = api.schedule.every(300, refresh)` |
| `storage.get(key)` | `permissions.storage`; `{found,value}` | `invalid_request`, `too_large`, `disabled`, `not_permitted`. `const saved = await api.storage.get('etag')` |
| `storage.set(key,value)` | `permissions.storage`; `{stored:true}` | Same as `storage.get`. `await api.storage.set('etag','abc')` |
| `storage.remove(key)` | `permissions.storage`; `{removed:boolean}` | `invalid_request`, `disabled`, `not_permitted`. `await api.storage.remove('etag')` |
| `log.info/warn/error(...values)` | Plugin-panel diagnostic; `{logged:true}` | `invalid_request`, `too_large`, `disabled`. `await api.log.warn('Retrying', code)` |
| `commands.onInvoke(fn)` | `contributes.commands`; unsubscribe function | Throws `invalid_request` immediately for a non-function callback. Plugins cannot trigger commands. `const off = api.commands.onInvoke(id => api.log.info('Command', id))` |
| `badge.set(badge|null)` | `contributes.badge`; `{set:boolean}` | `invalid_request`, `rate_limited`, `disabled`, `not_permitted`. `await api.badge.set({text:'OK',tone:'info'})`; `await api.badge.set(null)` clears it. |
| `agent.emit(event)` | `contributes.eventSource`; `{accepted:true}` | `invalid_request`, `rate_limited`, `not_permitted`, `disabled`. `await api.agent.emit({sessionId:'build-1',state:'thinking'})` |
| `ui.postMessage(data)` | `contributes.panelView`; `{delivered:boolean}` | `invalid_request`, `too_large`, `rate_limited`, `disabled`. `const result = await api.ui.postMessage({type:'refresh'})` |
| `ui.onMessage(fn)` | `contributes.panelView`; unsubscribe function | Throws `invalid_request` immediately. `const off = api.ui.onMessage(message => api.log.info(message.type))` |

`net.fetch` methods are `GET`, `POST`, `PUT`, `DELETE`, and `PATCH`. Allowed request headers are `accept`, `authorization`, `content-type`, `if-modified-since`, `if-none-match`, and `x-api-key`; request bodies are at most 256 KB. Only `content-type`, `etag`, `last-modified`, and `retry-after` response headers are returned. Binary bodies are base64 strings with `isBase64Encoded: true`. A `requestHost` reason is 1–120 characters.

`PetStatusChange` contains only `petId`, `name`, `agentFamily`, `previousState`, `visibleState`, `dnd`, and `at`. `net.fetch` requires HTTPS and public DNS; each of up to three redirects rechecks the hostname and DNS. Plugin network requests do not send or store cookies. Use an `authorization` header with a declared secret when an API requires authentication. Host API successes are direct values, not `{ok,value}` wrappers.

`agent.emit` accepts exactly `{sessionId, state}`. States are `thinking`, `tool-running`, `idle`, `done`, and `error`. `done` and `error` are terminal; start another session with a new id. The host assigns receive time and displays these rows separately with the fixed `From plugin: <plugin name>` label. These statuses are unverified plugin claims and do not become native Agent events or trigger Permission, XP, achievements, History, quota, or notifications.

`ui.postMessage` and `ui.onMessage` exchange JSON values between a plugin Worker and its open panel page. Each message is limited to 256 KB and 20 per second per plugin and direction. A Worker message sent while the panel is closed resolves to `{delivered:false}` without being queued. The panel page API subset and browser restrictions are listed in [Panel views](panel-view.md).

Commands are declared in the manifest and can only be triggered by a user from that plugin's panel or the Tray. `commands.onInvoke` receives the declared command id. A user-triggered command request can fail with `invalid_request` (malformed command), `disabled` (plugin or global switch is off), `not_permitted` (the command is not declared), `rate_limited` (the same command was triggered within one second), or `host_unavailable` (the plugin Worker is not ready). The panel shows a localized status for unavailable, unpermitted, or rate-limited commands; other failures show a generic action error. Tray entries and pet skins are manifest contributions and have no extra Host API.

Badges are cleared when a plugin is disabled, removed, or crashes. A malformed badge (including text over six Unicode code points) fails with `invalid_request` without consuming the rate limit; a valid update more frequent than once per second fails with `rate_limited`. The app shows up to two plugin badges beside a visible pet's status line and combines the remaining count as `+N`.
