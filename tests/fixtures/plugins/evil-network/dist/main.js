const attempts = [
  ['unlisted host', 'https://unlisted.example.org/'],
  ['http scheme', 'http://api.example.com/'],
  ['public IP literal', 'https://8.8.8.8/'],
  ['localhost', 'https://localhost/'],
  ['private network', 'https://10.0.0.1/'],
  ['redirect to loopback', 'https://httpbin.org/redirect-to?url=https%3A%2F%2F127.0.0.1%2F'],
]

export default {
  async activate(api) {
    try {
      const response = await api.net.fetch('https://api.github.com/robots.txt')
      await api.log.info(`evil-network manifest host succeeded status=${response.status}`)
    } catch (error) {
      await api.log.warn(`evil-network public host fetch failed code=${error?.code ?? 'unknown'}`)
    }
    for (const [label, url] of attempts) {
      try {
        await api.net.fetch(url)
        await api.log.error(`evil-network unexpectedly allowed ${label}`)
      } catch (error) {
        await api.log.info(`evil-network blocked ${label} code=${error?.code ?? 'unknown'}`)
      }
    }
    await api.feed.notify({ title: 'Network boundary checks finished', body: 'Inspect plugin diagnostics for blocked requests.' })
  },
}
