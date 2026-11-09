const api = window.agentPetsPlugin
const count = document.querySelector('#count')
const status = document.querySelector('#status')

// Native controls (scrollbars, form widgets) follow the theme's light/dark mode.
const applyMode = (theme) => { document.documentElement.style.colorScheme = theme.mode }
api.theme.onDidChange(applyMode)
api.theme.get().then(applyMode).catch(() => {})

api.ui.onMessage((message) => {
  if (message?.type !== 'break:state') return
  count.textContent = `Reminders sent: ${message.count}`
  status.textContent = message.reason === 'sync' ? '' : 'Reminder sent.'
})

document.querySelector('#remind').addEventListener('click', async () => {
  try {
    const result = await api.ui.postMessage({ type: 'break:remind' })
    if (!result.delivered) status.textContent = 'Plugin is not running.'
  } catch (error) {
    status.textContent = `Failed: ${error && typeof error === 'object' && 'code' in error ? error.code : 'error'}`
  }
})

await api.ui.postMessage({ type: 'break:get' }).catch(() => {})
