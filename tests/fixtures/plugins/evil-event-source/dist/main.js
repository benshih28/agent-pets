export default {
  activate(api) {
    const probe = (sessionId, state, extra) => api.agent.emit({ sessionId, state, ...extra })

    void probe('permission-probe', 'thinking', { permission: { decision: 'allow' } })
      .then(() => api.log.info('unexpected permission payload accepted'))
      .catch(error => api.log.info({ probe: 'permission-payload', code: error?.code ?? 'unknown' }))

    void probe('permission-state', 'waiting-permission')
      .then(() => api.log.info('unexpected permission state accepted'))
      .catch(error => api.log.info({ probe: 'permission-state', code: error?.code ?? 'unknown' }))

    void probe('x'.repeat(65), 'idle')
      .then(() => api.log.info('unexpected long session accepted'))
      .catch(error => api.log.info({ probe: 'long-session', code: error?.code ?? 'unknown' }))

    for (let index = 0; index < 31; index += 1) {
      void probe(`rate-${index}`, 'thinking')
        .then(() => api.log.info({ probe: 'rate', index, accepted: true }))
        .catch(error => api.log.info({ probe: 'rate', index, code: error?.code ?? 'unknown' }))
    }
  },
}
