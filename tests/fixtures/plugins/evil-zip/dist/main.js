export default {
  async activate(api) {
    await api.log.info('evil-zip fixture activated; archive traversal probes run before installation')
  },
}
