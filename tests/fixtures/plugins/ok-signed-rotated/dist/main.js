export default {
  activate(api) {
    void api.agent.emit({ sessionId: 'signed-rotated-e2e-run', state: 'tool-running' })
      .then(() => api.log.info('rotated signed eventSource status accepted'))
      .catch(error => api.log.info({ code: error?.code ?? 'unknown' }))
  },
}
