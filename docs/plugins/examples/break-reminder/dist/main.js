export default {
  async activate(api) {
    const stored = await api.storage.get('count')
    let count = stored.found ? Number(stored.value) || 0 : 0
    let cancel = null

    const remind = async (reason) => {
      const { message } = await api.settings.get()
      count += 1
      await api.storage.set('count', count)
      await api.feed.notify({
        title: 'Time for a break',
        body: String(message),
        // A fresh key per reminder; polling-style plugins would reuse one key instead.
        dedupeKey: `break-${Date.now()}`,
      })
      await api.ui.postMessage({ type: 'break:state', count, reason })
    }

    const start = async () => {
      if (cancel) cancel()
      const { intervalMinutes } = await api.settings.get()
      cancel = api.schedule.every(Number(intervalMinutes) * 60, () => remind('schedule'))
    }

    await start()
    api.settings.onChange(() => { void start() })
    api.commands.onInvoke(async (commandId) => {
      if (commandId === 'remind-now') await remind('command')
    })
    api.ui.onMessage(async (message) => {
      if (message?.type === 'break:get') await api.ui.postMessage({ type: 'break:state', count, reason: 'sync' })
      if (message?.type === 'break:remind') await remind('panel')
    })
  },
}
