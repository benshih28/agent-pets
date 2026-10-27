export default {
  async activate(api) {
    await api.storage.set('panel-demo', { value: 'stored by worker' })
    api.ui.onMessage(async message => {
      if (!message || message.type !== 'panel-demo:ping') return
      await api.ui.postMessage({ type: 'panel-demo:pong', value: message.value })
    })
  },
}
