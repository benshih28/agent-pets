export default {
  async activate(api) {
    try {
      await api.feed.notify({
        title: '<img src=x onerror=alert(1)>',
        body: '<svg onload=alert(1)>unsafe markup</svg>',
      })
      await api.log.info('evil-xss payload was accepted as plain text')
    } catch (error) {
      await api.log.info(`evil-xss payload rejected: ${error && error.code || 'unknown'}`)
    }
  },
}
