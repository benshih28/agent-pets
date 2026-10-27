# Resource and rate limits

The **Plugins ▸ Advanced** defaults and hard ranges are below. Out-of-range settings are rejected; API overages reject the call or write.

| Resource | Default | Adjustable hard range |
|---|---:|---:|
| Enabled plugins at once | 10 | 1–50 |
| Memory budget per plugin | 64 MB | 16–512 MB |
| `net.fetch` response | 2 MB | 64 KB–20 MB |
| `net.fetch` timeout | 15 seconds | 5–60 seconds |
| `net.fetch` requests | 30/minute/plugin | 1–300 |
| `storage` | 1 MB/plugin | 64 KB–50 MB |
| Global notifications | 60/10 minutes | 10–300 |
| Minimum `schedule` interval | 60 seconds | 30–3600 seconds |

Additional fixed limits:

- Feed: default 5 items per plugin per 10 minutes; the panel permits 1–30. Queue depth 8, notification center 500 items, and 100 retained items per plugin. Title 60 characters, body 240; TTL defaults to 6 seconds and accepts 1–15 seconds. `dedupeKey` is at most 128 characters and deduplicates for 24 hours.
- Pet reactions: TTL defaults to 4 seconds and accepts 1–15 seconds; at most 32 RPC arguments and 32 queued interactions.
- Manifest/package: 5 MB total and 64 files; `plugin.json` at most 256 KB. Settings and secrets files are each at most 64 KB; settings have at most 20 fields. Storage defaults to 1 MB and follows the panel limit.
- Network: request body at most 256 KB; response bytes and timeout use the panel limits; at most three redirects, each revalidated before a new request. Plugin requests do not send or store cookies. Requests per plugin per minute follow the panel limit.
- Runtime: heartbeat every 10 seconds, failure after 30 seconds without a pong, and disable plus notification after three consecutive crashes. Plugin Host process memory is monitored against the combined enabled-plugin budgets; **exact per-Worker memory isolation is not available**.
- Runtime host requests: at most three per plugin per 10 minutes; denial cools down that host for 24 hours.
- Commands: at most 10 per plugin; each id is 1–32 characters and each localized title is at most 32 characters. A given command may be invoked at most once per second. Tray contributes at most five command ids per plugin, with at most 30 plugin command items across the Tray; labels are truncated to 32 characters.
- Badges: text is at most six Unicode code points; each plugin may update once per second. At most two plugin badges appear per pet; additional badges are represented by `+N`.
- Skins: at most five per plugin. A package containing skins is at most 25 MB total and each spritesheet is at most 20 MB; the existing 5 MB package limit applies when there are no skins.
- `eventSource`: 30 events per plugin and 120 total in a rolling 60 seconds; 20 active sessions per plugin and 100 total; 2 KiB per event; session id at most 64 ASCII bytes; display name at most 80 characters per locale. Active state expires after 2 minutes without updates, `done`/`error` after 30 seconds, and every session after 30 minutes maximum.

Full queues return `queue_full`, network rate overages return `rate_limited`, and response-size overages return `too_large`. See the [API reference](api-reference.md) for error codes.
