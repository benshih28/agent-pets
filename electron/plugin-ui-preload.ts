import { IPC_CHANNELS } from './ipc/channels'
import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPanelPublicApi } from './plugin-panel-view-bridge.ts'
import { PluginUserActivationGuard } from './plugin-user-activation.ts'
import { constructRootThemeSheet, createPluginThemeApplier, type PluginThemeDocument } from './plugin-theme-apply.ts'

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

// 宿主把 `--ap-*` 放在頁面上（見 plugin-theme-apply.ts）。第一份快照以同步 IPC 取得，所以在頁面的
// 第一個 script 執行前就生效；之後的變動由推送更新。監聽先註冊，同步取值之後的推送一定比它新。
const applyThemeTokens = createPluginThemeApplier(document as unknown as PluginThemeDocument, constructRootThemeSheet)
ipcRenderer.on(IPC_CHANNELS.pluginPanelThemeChanged, (_event, snapshot: unknown) => applyThemeTokens(snapshot))
try {
  applyThemeTokens(ipcRenderer.sendSync(IPC_CHANNELS.pluginPanelThemeInitial))
} catch {}

const api = createPluginPanelPublicApi({
  invoke: (method, args) => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelApi, method, args),
  consumeUserActivation,
  onMessage: listener => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelUiMessage, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelUiMessage, handler)
  },
  onThemeChange: listener => {
    const handler = (_event: unknown, snapshot: unknown) => listener(snapshot)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelThemeChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelThemeChanged, handler)
  },
})

contextBridge.exposeInMainWorld('agentPetsPlugin', api)
