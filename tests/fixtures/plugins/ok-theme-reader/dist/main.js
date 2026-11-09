export default {
  async activate(api) {
    const theme = await api.theme.get()
    await api.log.info('theme', theme.mode, theme.tokens['--ap-accent'])
    api.theme.onDidChange(next => api.log.info('theme changed', next.mode, next.tokens['--ap-accent']))
  },
}
