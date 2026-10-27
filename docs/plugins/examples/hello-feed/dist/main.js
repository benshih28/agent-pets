export default {
  async activate(api) {
    await api.feed.notify({
      title: 'Hello from a plugin',
      body: 'This bubble came from the local plugin sandbox.',
      priority: 'normal',
      ttlMs: 6000,
      dedupeKey: 'hello-feed-welcome',
    })
  },
}
