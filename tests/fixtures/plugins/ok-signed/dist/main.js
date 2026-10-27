export default {
  activate(api) {
    void api.agent.emit({ sessionId: 'signed-e2e-run', state: 'thinking' })
      .then(() => api.log.info('signed eventSource status accepted'))
      .catch(error => api.log.info({ code: error?.code ?? 'unknown' }))
  },
}
