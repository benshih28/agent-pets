import { IPC_CHANNELS } from './ipc/channels'
import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPanelPublicApi } from './plugin-panel-view-bridge.ts'

for (const eventName of ['dragstart', 'dragenter', 'dragover', 'drop']) {
  window.addEventListener(eventName, event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}

const api = createPluginPanelPublicApi({
  invoke: (method, args) => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelApi, method, args),
  onMessage: listener => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelUiMessage, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelUiMessage, handler)
  },
})

contextBridge.exposeInMainWorld('agentPetsPlugin', api)
