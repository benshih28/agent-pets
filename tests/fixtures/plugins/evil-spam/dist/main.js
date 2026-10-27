export default {
  async activate(api) {
    const results = { accepted: 0, rejected: 0 }
    for (let index = 0; index < 100; index += 1) {
      try {
        await api.feed.notify({ title: `Spam ${index}`, body: 'Repeated test notification.' })
        results.accepted += 1
      } catch {
        results.rejected += 1
      }
    }
    await api.log.info(JSON.stringify(results))
  },
}
