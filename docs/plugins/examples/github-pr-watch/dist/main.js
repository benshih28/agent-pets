export default {
  async activate(api) {
    const readLatest = async () => {
      try {
        const settings = await api.settings.get()
        const repository = settings.repository || 'openai/openai'
        const token = await api.secrets.get('githubToken')
        const response = await api.net.fetch(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=1`, {
          headers: {
            accept: 'application/vnd.github+json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        })
        if (response.status < 200 || response.status >= 300) return
        const pulls = JSON.parse(response.body)
        const pull = pulls[0]
        if (!pull) return
        await api.feed.notify({
          title: `Open PR: ${pull.title}`,
          body: `#${pull.number} in ${repository}`,
          link: pull.html_url,
          dedupeKey: `github-pr-${pull.node_id}`,
        })
      } catch (error) {
        await api.log.warn('GitHub PR check failed', error?.code || 'unknown')
      }
    }
    api.settings.onChange(() => { void readLatest() })
    await readLatest()
    api.schedule.every(300, () => { void readLatest() })
  },
}
