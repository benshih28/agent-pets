const api = window.agentPetsPlugin
const status = document.querySelector('#probe-status')
window.__evilPanelDropEventCount = 0
window.__evilPanelDroppedFileCount = 0
window.addEventListener('drop', event => {
  window.__evilPanelDropEventCount += 1
  window.__evilPanelDroppedFileCount += event.dataTransfer?.files?.length ?? 0
}, true)

window.runPanelSecurityProbes = async () => {
  const outcomes = {}
  outcomes.secretsExposed = 'secrets' in api
  outcomes.requestHostExposed = 'requestHost' in api.net
  try {
    await fetch('https://example.com/')
    outcomes.fetch = 'unexpected-success'
  } catch (error) {
    outcomes.fetch = error?.name ?? 'rejected'
  }
  try {
    outcomes.xhr = await new Promise(resolve => {
      const xhr = new XMLHttpRequest()
      const timeout = setTimeout(() => resolve('timeout'), 500)
      xhr.onload = () => { clearTimeout(timeout); resolve('unexpected-success') }
      xhr.onerror = () => { clearTimeout(timeout); resolve('blocked') }
      xhr.open('GET', 'https://example.com/')
      xhr.send()
    })
  } catch (error) {
    outcomes.xhr = error?.name ?? 'rejected'
  }
  try {
    outcomes.webSocket = await new Promise(resolve => {
      const socket = new WebSocket('wss://example.com/')
      const timeout = setTimeout(() => { socket.close(); resolve('timeout') }, 500)
      socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve('unexpected-success') }
      socket.onerror = () => { clearTimeout(timeout); resolve('blocked') }
    })
  } catch (error) {
    outcomes.webSocket = error?.name ?? 'rejected'
  }
  try {
    await fetch('agent-pets://plugin/00000000-0000-4000-8000-000000000000/ui/index.html')
    outcomes.otherPluginFile = 'unexpected-success'
  } catch (error) {
    outcomes.otherPluginFile = error?.name ?? 'rejected'
  }
  outcomes.windowOpen = window.open('https://example.com/') === null ? 'blocked' : 'unexpected-window'
  outcomes.parentIsSelf = window.parent === window
  outcomes.topIsSelf = window.top === window
  outcomes.parentCanSeeHostFrame = Boolean(window.parent.document.querySelector('[data-testid="plugin-panel-view-frame"]'))
  const fakeDialog = document.querySelector('#fake-permission-dialog')
  outcomes.fakeDialogRendered = Boolean(fakeDialog && getComputedStyle(fakeDialog).position === 'fixed')

  try {
    outcomes.permissionCamera = (await navigator.permissions.query({ name: 'camera' })).state
  } catch (error) { outcomes.permissionCamera = error?.name ?? 'rejected' }
  try {
    outcomes.permissionGeolocation = (await navigator.permissions.query({ name: 'geolocation' })).state
  } catch (error) { outcomes.permissionGeolocation = error?.name ?? 'rejected' }
  try { outcomes.notificationPermission = await Notification.requestPermission() }
  catch (error) { outcomes.notificationPermission = error?.name ?? 'rejected' }

  const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
  document.dispatchEvent(drop)
  outcomes.syntheticDropPrevented = drop.defaultPrevented

  const download = document.createElement('a')
  download.href = './index.html'
  download.download = 'evil-panel-download.html'
  document.body.append(download)
  download.click()
  download.remove()
  outcomes.downloadAttempted = true

  const originalUrl = window.location.href
  try {
    window.location.assign('https://example.com/')
    await new Promise(resolve => setTimeout(resolve, 150))
    outcomes.navigationStayedOnPluginPage = window.location.href === originalUrl
  } catch {
    outcomes.navigationStayedOnPluginPage = window.location.href === originalUrl
  }

  status.textContent = JSON.stringify(outcomes)
  await api.log.info('evil-panel security probe', JSON.stringify(outcomes))
  return outcomes
}
