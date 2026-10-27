export default {
  async activate(api) {
    await api.storage.set('started', true)
    const stored = await api.storage.get('started')
    await api.feed.notify({
      title: 'Plugin ready',
      body: stored?.found === true ? 'Storage round-trip passed.' : 'Storage value was missing.',
    })
    api.log.info('ok-notify activated')
  },
}
