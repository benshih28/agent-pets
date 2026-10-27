const results = {}
const t = async (name, fn) => {
  try { results[name] = 'ALLOWED: ' + String(await fn()).slice(0, 60) }
  catch (error) { results[name] = 'blocked: ' + String(error && error.message || error).slice(0, 60) }
}

export default {
  async activate(api) {
    await t('fetch https', () => fetch('https://example.com').then(response => response.status))
    await t('fetch loopback event server', () => fetch('http://127.0.0.1:17373/v1/events', { method: 'POST' }).then(response => response.status))
    await t('fetch app origin', () => fetch('agent-pets://app/index.html').then(response => response.status))
    await t('import other plugin module', () => import('agent-pets://plugin/ok-notify/dist/main.js').then(module => typeof module.default))
    await t('nested worker', () => new Promise((resolve, reject) => {
      const worker = new Worker('agent-pets://plugin/ok-notify/dist/main.js', { type: 'module' })
      worker.onerror = () => reject(new Error('worker error'))
      setTimeout(() => { resolve('created'); worker.terminate() }, 300)
    }))
    await t('BroadcastChannel', () => {
      const channel = new BroadcastChannel('x')
      channel.postMessage('hi')
      channel.close()
      return 'posted'
    })
    await t('indexedDB', () => new Promise((resolve, reject) => {
      const request = indexedDB.open('probe')
      request.onsuccess = () => resolve('opened')
      request.onerror = () => reject(request.error)
    }))
    await t('raw rpc via prototype', () => {
      const postMessage = DedicatedWorkerGlobalScope.prototype.postMessage
      postMessage.call(self, { type: 'rpc', request: { id: 'spoof', method: 'pet.react', args: ['happy'] } })
      return 'sent'
    })
    await t('storage round-trip', async () => {
      await api.storage.set('k', 1)
      return JSON.stringify(await api.storage.get('k'))
    })
    await api.log.info(JSON.stringify(results))
  },
}
