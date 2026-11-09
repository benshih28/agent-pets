const api = window.agentPetsPlugin
const countLabel = document.querySelector('#count')
const status = document.querySelector('#status')

// Native controls (scrollbars, form widgets) follow the theme's light/dark mode.
const applyMode = (theme) => { document.documentElement.style.colorScheme = theme.mode }
api.theme.onDidChange(applyMode)
api.theme.get().then(applyMode).catch(() => {})

const stored = await api.storage.get('message-count')
countLabel.textContent = `Stored count: ${stored.found ? stored.value : 0}`

api.ui.onMessage(message => {
  if (message?.type !== 'panel-demo:updated') return
  countLabel.textContent = `Stored count: ${message.count}`
  status.textContent = 'Worker replied and saved the value.'
})

document.querySelector('#increment').addEventListener('click', async () => {
  try {
    const result = await api.ui.postMessage({ type: 'panel-demo:increment' })
    status.textContent = result.delivered ? 'Message sent to Worker.' : 'Worker is unavailable.'
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'disabled'
    status.textContent = `Message failed: ${code}`
  }
})
