# Notifications and bubbles

`api.feed.notify` requires `contributes.feed`. It resolves to `{itemId, delivery}`, where `delivery` is `bubble` or `center`. Bubbles show the plugin source. External links open only after a user click and only for an approved HTTPS host.

Bubble order is permission request → permission notice → presentation say → Agent toast → normal plugin feed → Agent activity → low plugin feed. Plugin feed is gated by the global switch, plugin switch, mute, DND, pet visibility, and rate limits.

When the pet is hidden, DND is on, the plugin is muted, or its rate limit is exceeded, the item stays in the plugin notification center and counts as unread; it is not queued for a later bubble. Ending DND does not replay items created during DND. When the pet becomes visible, only the latest unexpired item is shown, with a fresh TTL. A full queue rejects with `queue_full`.

Use a stable key to deduplicate notifications from polling:

```js
await api.feed.notify({
  title: 'New pull request',
  body: '#42 is ready for review.',
  link: 'https://github.com/example/project/pull/42',
  dedupeKey: 'pr-42',
})
```

The same plugin's `dedupeKey` is deduplicated for 24 hours and is at most 128 characters. TTL defaults to 6 seconds and accepts 1–15 seconds. Titles are at most 60 characters; bodies are at most 240.
