export type PluginPanelApiMethod =
  | 'feed.notify' | 'pet.status' | 'storage.get' | 'storage.set' | 'storage.remove'
  | 'settings.get' | 'log.info' | 'log.warn' | 'log.error' | 'net.fetch' | 'ui.postMessage'
  | 'links.openExternal'

import { isPluginErrorCode, type PluginErrorCode } from '../src/types/plugin.ts'

export type PluginPanelApiErrorCode = PluginErrorCode

export interface PluginPanelApiTransport {
  invoke: (method: PluginPanelApiMethod, args: unknown[]) => Promise<unknown>
  onMessage: (listener: (data: unknown) => void) => () => void
  consumeUserActivation?: () => boolean
}

export interface PluginPanelPublicApi {
  feed: { notify: (item: unknown) => Promise<unknown> }
  pet: { status: () => Promise<unknown> }
  storage: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<unknown>
    remove: (key: string) => Promise<unknown>
  }
  settings: { get: () => Promise<unknown> }
  log: {
    info: (...values: unknown[]) => Promise<unknown>
    warn: (...values: unknown[]) => Promise<unknown>
    error: (...values: unknown[]) => Promise<unknown>
  }
  net: { fetch: (url: string, options?: unknown) => Promise<unknown> }
  links: { openExternal: (url: string) => Promise<{ opened: true }> }
  ui: {
    postMessage: (data: unknown) => Promise<{ delivered: boolean }>
    onMessage: (callback: (data: unknown) => void) => () => void
  }
}

const PANEL_METHODS = new Set<PluginPanelApiMethod>([
  'feed.notify', 'pet.status', 'storage.get', 'storage.set', 'storage.remove',
  'settings.get', 'log.info', 'log.warn', 'log.error', 'net.fetch', 'ui.postMessage',
  'links.openExternal',
])


function codedError(code: PluginPanelApiErrorCode): Error & { code: PluginPanelApiErrorCode } {
  return Object.assign(new Error(code), { code })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrapResponse(response: unknown): unknown {
  if (!isRecord(response) || typeof response.ok !== 'boolean') throw codedError('invalid_request')
  if (response.ok) return response.value
  const code = isPluginErrorCode(response.error) ? response.error : 'invalid_request'
  throw codedError(code)
}

export function createPluginPanelPublicApi(transport: PluginPanelApiTransport): PluginPanelPublicApi {
  const invoke = async (method: PluginPanelApiMethod, args: unknown[]): Promise<unknown> => {
    if (!PANEL_METHODS.has(method)) throw codedError('not_permitted')
    try { return unwrapResponse(await transport.invoke(method, args)) } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && isPluginErrorCode(error.code)) throw error
      throw codedError('disabled')
    }
  }
  return Object.freeze({
    feed: Object.freeze({ notify: (item: unknown) => invoke('feed.notify', [item]) }),
    pet: Object.freeze({ status: () => invoke('pet.status', []) }),
    storage: Object.freeze({
      get: (key: string) => invoke('storage.get', [key]),
      set: (key: string, value: unknown) => invoke('storage.set', [key, value]),
      remove: (key: string) => invoke('storage.remove', [key]),
    }),
    settings: Object.freeze({ get: () => invoke('settings.get', []) }),
    log: Object.freeze({
      info: (...values: unknown[]) => invoke('log.info', [values]),
      warn: (...values: unknown[]) => invoke('log.warn', [values]),
      error: (...values: unknown[]) => invoke('log.error', [values]),
    }),
    net: Object.freeze({
      fetch: (url: string, options?: unknown) => invoke('net.fetch', options === undefined ? [url] : [url, options]),
    }),
    links: Object.freeze({
      openExternal: async (url: string) => await invoke('links.openExternal', [
        url,
        transport.consumeUserActivation?.() === true,
      ]) as { opened: true },
    }),
    ui: Object.freeze({
      postMessage: async (data: unknown) => await invoke('ui.postMessage', [data]) as { delivered: boolean },
      onMessage: (callback: (data: unknown) => void) => {
        if (typeof callback !== 'function') throw codedError('invalid_request')
        return transport.onMessage(data => {
          try { callback(data) } catch {}
        })
      },
    }),
  })
}
