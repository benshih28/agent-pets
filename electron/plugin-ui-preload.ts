import { IPC_CHANNELS } from './ipc/channels'
import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPanelPublicApi } from './plugin-panel-view-bridge.ts'
import { PluginUserActivationGuard } from './plugin-user-activation.ts'

for (const eventName of ['dragstart', 'dragenter', 'dragover', 'drop']) {
  window.addEventListener(eventName, event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}

const userActivation = new PluginUserActivationGuard()
for (const eventName of ['click', 'keydown'] as const) {
  window.addEventListener(eventName, event => {
    if (eventName === 'keydown') {
      if (event instanceof KeyboardEvent) userActivation.recordKeyboard(event)
      return
    }
    if (event instanceof MouseEvent) userActivation.recordClick(event)
  }, true)
}

function consumeUserActivation(): boolean {
  return userActivation.consume()
}

const api = createPluginPanelPublicApi({
  invoke: (method, args) => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelApi, method, args),
  consumeUserActivation,
  onMessage: listener => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelUiMessage, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelUiMessage, handler)
  },
})

contextBridge.exposeInMainWorld('agentPetsPlugin', api)
