export default {
  async activate(api) {
    const results = {}
    const attempt = async (name, action) => {
      try { results[name] = 'ALLOWED: ' + String(await action()).slice(0, 60) }
      catch (error) { results[name] = 'blocked: ' + String(error && error.message || error).slice(0, 60) }
    }
    await attempt('self.postMessage spoof', () => self.postMessage({
      type: 'rpc',
      request: { id: 'spoof-self', method: 'pet.react', args: ['happy'] },
    }))
    await attempt('raw rpc via prototype', () => {
      const postMessage = DedicatedWorkerGlobalScope.prototype.postMessage
      postMessage.call(self, {
        type: 'rpc',
        request: { id: 'spoof-prototype', method: 'pet.react', args: ['happy'] },
      })
      return 'sent'
    })
    await attempt('api.pet.react without permission', () => api.pet.react('happy'))
    await api.log.info(JSON.stringify(results))
  },
}
