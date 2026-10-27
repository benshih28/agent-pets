export default {
  async activate(api) {
    try {
      await api.agent.emit({ sessionId: 'fixture-build-1', state: 'thinking' })
      await api.agent.emit({ sessionId: 'fixture-build-1', state: 'tool-running' })
      await api.log.info('eventSource status accepted')
    } catch (error) {
      await api.log.info({ code: error?.code ?? 'unknown' })
    }
  },
}
