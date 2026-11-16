import type { IpcMain } from 'electron'

export type FakeIpcHandler = (...args: unknown[]) => unknown

export interface FakeIpcMain {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>
  /** `ipcMain.handle` 註冊的 invoke handler。 */
  handlers: Map<string, FakeIpcHandler>
  /** `ipcMain.on` 註冊的單向 listener；跟 handlers 分開，避免同名 channel 互相覆蓋而測不到。 */
  listeners: Map<string, FakeIpcHandler>
}

export function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, FakeIpcHandler>()
  const listeners = new Map<string, FakeIpcHandler>()
  const fake = {
    handle(channel: string, handler: FakeIpcHandler): void { handlers.set(channel, handler) },
    on(channel: string, listener: FakeIpcHandler) {
      listeners.set(channel, listener)
      return fake
    },
  }
  // Electron 的 `on` 回傳 `this`（完整的 IpcMain），假物件只實作被 Pick 出來的兩個方法。
  return { ipcMain: fake as unknown as Pick<IpcMain, 'handle' | 'on'>, handlers, listeners }
}
