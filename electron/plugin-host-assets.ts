import type { PluginProtocolAssets } from './plugin-protocol.ts'

export const pluginHostAssets: PluginProtocolAssets = {
  'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src agent-pets://plugin; worker-src agent-pets://plugin; connect-src \'none\'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"></head><body><script type="module" src="agent-pets://plugin/_host/host.js"></script></body></html>',
  'host.js': String.raw`
const workers = new Map()
let portAccepted = false
window.addEventListener('message', (event) => {
  if (portAccepted || event.source !== window || event.origin !== window.location.origin
    || event.data !== 'agent-pets-plugin-host-port' || !event.ports || !event.ports[0]) return
  portAccepted = true
  const port = event.ports[0]
  port.start()
  port.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return
      if (data.type === 'start' && typeof data.pluginId === 'string' && typeof data.entry === 'string') {
        const pluginId = data.pluginId
        const token = data.token
        if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId)
          || typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token) || workers.has(pluginId)) return
        try {
          const worker = new Worker('agent-pets://plugin/_host/worker-bootstrap.js', { type: 'module', name: pluginId })
          workers.set(pluginId, worker)
          worker.onmessage = ({ data: message }) => {
            if (!message || typeof message !== 'object') return
            if (message.type === 'rpc') port.postMessage({ type: 'rpc', pluginId, token, request: message.request })
            else if (message.type === 'pong') port.postMessage({ type: 'pong', pluginId, at: message.at })
            else if (message.type === 'ready') port.postMessage({ type: 'worker-ready', pluginId })
            else if (message.type === 'activation-error') {
              workers.delete(pluginId)
              try { worker.terminate() } catch {}
              port.postMessage({ type: 'worker-crash', pluginId })
            }
          }
          worker.onerror = (event) => {
            event.preventDefault()
            workers.delete(pluginId)
            try { worker.terminate() } catch {}
            port.postMessage({ type: 'worker-crash', pluginId })
          }
          worker.onmessageerror = () => {
            workers.delete(pluginId)
            try { worker.terminate() } catch {}
            port.postMessage({ type: 'worker-crash', pluginId })
          }
          worker.postMessage({
            type: 'activate', pluginId, token, entry: data.entry,
            scheduleEnabled: data.scheduleEnabled,
            scheduleMinIntervalSec: data.scheduleMinIntervalSec,
            agentStatusEnabled: data.agentStatusEnabled,
          })
          port.postMessage({ type: 'worker-started', pluginId })
        } catch {
          port.postMessage({ type: 'worker-crash', pluginId })
        }
      } else if (data.type === 'ping' && Number.isSafeInteger(data.at)) {
        for (const worker of workers.values()) worker.postMessage({ type: 'ping', at: data.at })
      } else if (data.type === 'terminate' && typeof data.pluginId === 'string') {
        const worker = workers.get(data.pluginId)
        if (worker) {
          workers.delete(data.pluginId)
          worker.terminate()
        }
      } else if (data.type === 'stop' && typeof data.pluginId === 'string') {
        const worker = workers.get(data.pluginId)
        if (worker) {
          workers.delete(data.pluginId)
          worker.postMessage({ type: 'deactivate' })
          setTimeout(() => worker.terminate(), 100)
        }
      } else if (data.type === 'rpc-result' && typeof data.pluginId === 'string') {
        workers.get(data.pluginId)?.postMessage({ type: 'rpc-result', result: data.result })
      } else if (data.type === 'invoke-command' && typeof data.pluginId === 'string' && workers.has(data.pluginId)
        && typeof data.commandId === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(data.commandId)) {
        workers.get(data.pluginId)?.postMessage({ type: 'command-invoke', commandId: data.commandId })
      } else if (data.type === 'ui-message' && typeof data.pluginId === 'string' && workers.has(data.pluginId)) {
        workers.get(data.pluginId)?.postMessage({ type: 'ui-message', value: data.value })
      } else if (data.type === 'settings-changed' && typeof data.pluginId === 'string'
        && data.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
        workers.get(data.pluginId)?.postMessage({ type: 'settings-changed', value: data.value })
      } else if (data.type === 'status-changed' && typeof data.pluginId === 'string' && Array.isArray(data.value)) {
        workers.get(data.pluginId)?.postMessage({ type: 'status-changed', value: data.value })
      }
  }
})
`,
  'worker-bootstrap.js': String.raw`
const scope = self
const postToHost = scope.postMessage.bind(scope)
let pluginId = null
let pluginToken = null
let pluginModule = null
const pending = new Map()
let sequence = 0
let scheduleMinIntervalSec = 60
let scheduleEnabled = false
let agentStatusEnabled = false
const schedules = new Map()
const settingsListeners = new Set()
const statusListeners = new Set()
const uiListeners = new Set()
const commandListeners = new Set()
let scheduleSequence = 0
const blockedApis = [
  'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebSocket',
  'EventSource', 'XMLHttpRequest', 'fetch', 'postMessage',
]
function removeCrossPluginApis() {
  const chain = []
  for (let current = scope; current; current = Object.getPrototypeOf(current)) chain.push(current)
  for (const name of blockedApis) {
    for (const owner of chain) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name)
      if (!descriptor) continue
      if (!descriptor.configurable && !('value' in descriptor && descriptor.writable)) return false
      try {
        Object.defineProperty(owner, name, { value: undefined, configurable: false, writable: false })
      } catch {
        return false
      }
    }
    try {
      if (!Object.hasOwn(scope, name)) Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false })
    } catch {
      return false
    }
    if (scope[name] !== undefined) return false
  }
  return true
}
function rpc(method, args) {
  const id = String(++sequence)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try { postToHost({ type: 'rpc', request: { id, method, args } }) } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}
function setScheduleMinInterval(value) {
  if (Number.isSafeInteger(value) && value >= 30 && value <= 3600) scheduleMinIntervalSec = value
}
function clearSchedules() {
  for (const timer of schedules.values()) clearInterval(timer)
  schedules.clear()
}
const api = Object.freeze({
  feed: Object.freeze({ notify: (item) => rpc('feed.notify', [item]) }),
  badge: Object.freeze({ set: (badge) => rpc('badge.set', [badge]) }),
  pet: Object.freeze({
    react: (reaction, options) => rpc('pet.react', options === undefined ? [reaction] : [reaction, options]),
    status: () => rpc('pet.status', []),
    onStatusChange: (callback) => {
      if (!agentStatusEnabled) throw Object.assign(new Error('not_permitted'), { code: 'not_permitted' })
      if (typeof callback !== 'function') throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' })
      statusListeners.add(callback)
      return () => statusListeners.delete(callback)
    },
  }),
  agent: Object.freeze({ emit: (event) => rpc('agent.emit', [event]) }),
  net: Object.freeze({
    fetch: (url, options) => rpc('net.fetch', options === undefined ? [url] : [url, options]),
    requestHost: (host, reason) => rpc('net.requestHost', [host, reason]),
  }),
  secrets: Object.freeze({ get: (key) => rpc('secrets.get', [key]) }),
  settings: Object.freeze({
    get: () => rpc('settings.get', []),
    onChange: (callback) => {
      if (typeof callback !== 'function') throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' })
      settingsListeners.add(callback)
      return () => settingsListeners.delete(callback)
    },
  }),
  schedule: Object.freeze({
    every: (seconds, callback) => {
      if (!scheduleEnabled) throw Object.assign(new Error('not_permitted'), { code: 'not_permitted' })
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 2_147_483 || typeof callback !== 'function') {
        throw Object.assign(new Error('schedule_invalid'), { code: 'schedule_invalid' })
      }
      const interval = Math.max(scheduleMinIntervalSec, Math.ceil(seconds)) * 1000
      const id = String(++scheduleSequence)
      const timer = setInterval(() => { try { callback() } catch {} }, interval)
      schedules.set(id, timer)
      return () => { clearInterval(timer); schedules.delete(id) }
    },
  }),
  storage: Object.freeze({
    get: (key) => rpc('storage.get', [key]),
    set: (key, value) => rpc('storage.set', [key, value]),
    remove: (key) => rpc('storage.remove', [key]),
  }),
  log: Object.freeze({
    info: (...values) => rpc('log.info', [values]),
    warn: (...values) => rpc('log.warn', [values]),
    error: (...values) => rpc('log.error', [values]),
  }),
  commands: Object.freeze({
    onInvoke: (callback) => {
      if (typeof callback !== 'function') throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' })
      commandListeners.add(callback)
      return () => commandListeners.delete(callback)
    },
  }),
  ui: Object.freeze({
    postMessage: (value) => rpc('ui.postMessage', [value]),
    onMessage: (callback) => {
      if (typeof callback !== 'function') throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' })
      uiListeners.add(callback)
      return () => uiListeners.delete(callback)
    },
  }),
})
scope.onmessage = async ({ data }) => {
  if (!data || typeof data !== 'object') return
    if (data.type === 'activate' && pluginId === null) {
    const id = data.pluginId
    const entry = data.entry
    const token = data.token
    if (typeof id !== 'string' || !/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(id)
      || typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)
      || typeof entry !== 'string' || !/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\:]+\.js$/.test(entry)) return
    pluginId = id
    pluginToken = token
    setScheduleMinInterval(data.scheduleMinIntervalSec)
    scheduleEnabled = data.scheduleEnabled === true
    agentStatusEnabled = data.agentStatusEnabled === true
    try {
      if (!removeCrossPluginApis()) throw new TypeError('Plugin isolation could not be established')
      pluginModule = await import('agent-pets://plugin/' + pluginToken + '/' + entry)
      if (!pluginModule.default || typeof pluginModule.default.activate !== 'function') throw new TypeError('invalid plugin entry')
      await pluginModule.default.activate(api)
      postToHost({ type: 'ready' })
    } catch {
      postToHost({ type: 'activation-error' })
    }
  } else if (data.type === 'settings-changed' && data.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
    for (const listener of settingsListeners) { try { listener(data.value) } catch {} }
  } else if (data.type === 'status-changed' && Array.isArray(data.value)) {
    for (const item of data.value) {
      for (const listener of statusListeners) { try { listener(item) } catch {} }
    }
  } else if (data.type === 'command-invoke' && typeof data.commandId === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(data.commandId)) {
    for (const listener of commandListeners) { try { listener(data.commandId) } catch {} }
  } else if (data.type === 'ui-message') {
    for (const listener of uiListeners) { try { listener(data.value) } catch {} }
  } else if (data.type === 'ping' && Number.isSafeInteger(data.at)) {
    postToHost({ type: 'pong', at: data.at })
  } else if (data.type === 'rpc-result' && data.result && typeof data.result === 'object') {
    const result = data.result
    const id = result && typeof result.id === 'string' ? result.id : null
    const pendingRequest = id ? pending.get(id) : undefined
    if (pendingRequest) {
      pending.delete(id)
      if (result.ok === true) pendingRequest.resolve(result.value)
      else {
        const code = typeof result.error === 'string' ? result.error : 'invalid_request'
        const error = new Error(code)
        error.code = code
        pendingRequest.reject(error)
      }
    }
  } else if (data.type === 'deactivate' && pluginId !== null) {
    clearSchedules()
    uiListeners.clear()
    commandListeners.clear()
    try {
      if (typeof pluginModule?.default?.deactivate === 'function') await pluginModule.default.deactivate()
    } catch {}
    scope.close()
  }
}
`,
}
