import { IPC_CHANNELS } from './ipc/channels'
import { ipcRenderer } from 'electron'

ipcRenderer.on(IPC_CHANNELS.pluginHostPort, event => {
  const port = event.ports[0]
  if (!port) return
  window.postMessage('agent-pets-plugin-host-port', window.location.origin, [port])
})
