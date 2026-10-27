export default {
  async activate(api) {
    let agentIsWorking = false
    let elapsedMinutes = 0

    const updateBadge = () => {
      void api.badge.set({ text: `${elapsedMinutes}m`, tone: 'info' }).catch(() => {})
    }

    const updateWorkingState = statuses => {
      agentIsWorking = statuses.some(status =>
        !status.dnd && ['Thinking', 'Tool Running'].includes(status.visibleState),
      )
    }

    updateWorkingState(await api.pet.status())
    api.pet.onStatusChange(() => {
      void api.pet.status().then(statuses => {
        updateWorkingState(statuses)
        updateBadge()
      }).catch(() => {})
    })

    api.schedule.every(60, async () => {
      if (!agentIsWorking) return
      elapsedMinutes = (elapsedMinutes + 1) % 25
      updateBadge()
      if (elapsedMinutes === 0) {
        await api.feed.notify({
          title: 'Focus session complete',
          body: 'You have completed 25 minutes of focused agent work.',
        }).catch(() => {})
      }
    })
    updateBadge()
  },
}
