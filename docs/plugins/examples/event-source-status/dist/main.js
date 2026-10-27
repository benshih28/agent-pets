export default {
  activate(api) {
    const sessionId = `example-${Date.now()}`
    void api.agent.emit({ sessionId, state: 'thinking' })
      .then(() => setTimeout(() => {
        void api.agent.emit({ sessionId, state: 'done' })
      }, 2000))
      .catch(error => api.log.info({ code: error?.code ?? 'unknown' }))
  },
}
