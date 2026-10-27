export default {
  activate(api) {
    api.log.info('evil-panel worker active')
    api.ui.onMessage(message => {
      api.log.info('evil-panel panel message received', JSON.stringify(message))
    })
  },
}
