export default {
  async activate(api) {
    const stored = await api.storage.get('message-count')
    let count = stored.found ? Number(stored.value) || 0 : 0

    api.ui.onMessage(async message => {
      if (!message || message.type !== 'panel-demo:increment') return
      count += 1
      await api.storage.set('message-count', count)
      await api.ui.postMessage({ type: 'panel-demo:updated', count })
    })
  },
}
