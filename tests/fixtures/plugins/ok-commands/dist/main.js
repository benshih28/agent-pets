export default {
  activate(api) {
    api.commands.onInvoke(async commandId => {
      if (commandId !== 'start' && commandId !== 'stop') return
      await api.badge.set(commandId === 'start' ? { text: 'ON', tone: 'info' } : null)
      await api.feed.notify({
        title: commandId === 'start' ? 'Command started' : 'Command stopped',
        body: 'The command was invoked by the user.',
        ttlMs: 5_000,
      })
    })
  },
}
