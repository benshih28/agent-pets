export default {
  async activate(api) {
    const results = {}
    const attempt = async (name, action) => {
      try { results[name] = 'ALLOWED: ' + String(await action()).slice(0, 60) }
      catch (error) { results[name] = 'blocked: ' + String(error && error.message || error).slice(0, 60) }
    }
    await attempt('fetch https', () => fetch('https://example.com').then(response => response.status))
    await attempt('WebSocket', () => new WebSocket('wss://example.com/socket'))
    await attempt('importScripts', () => importScripts('https://example.com/worker.js'))
    await attempt('dynamic import', () => import('https://example.com/module.js').then(module => typeof module))
    await api.log.info(JSON.stringify(results))
  },
}
