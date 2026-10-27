export default {
  activate(api) {
    const reported = new Set()
    const probe = async () => {
      for (const badge of [{ text: 'TOO-LONG' }, { text: 'X' }]) {
        try {
          await api.badge.set(badge)
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'unknown'
          if (reported.has(code)) continue
          reported.add(code)
          await api.log.info(`badge-probe-rejected:${code}`)
        }
      }
    }
    setInterval(probe, 10)
  },
}
