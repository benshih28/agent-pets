import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export type TrustedInvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
export type SenderGuardedInvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
export type SenderGuardedEventHandler = (event: IpcMainEvent, ...args: unknown[]) => void

export function handleTrusted(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: string,
  getWindow: () => BrowserWindow | null,
  assertTrustedIpcSender: (event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null) => void,
  handler: TrustedInvokeHandler,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, getWindow())
    return handler(event, ...args)
  })
}

export function handleWithSenderGuard(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: string,
  assertSender: (event: IpcMainInvokeEvent) => void,
  handler: SenderGuardedInvokeHandler,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertSender(event)
    return handler(event, ...args)
  })
}

export function onWithSenderGuard(
  ipcMain: Pick<IpcMain, 'on'>,
  channel: string,
  assertSender: (event: IpcMainEvent) => void,
  handler: SenderGuardedEventHandler,
): void {
  ipcMain.on(channel, (event, ...args) => {
    assertSender(event)
    handler(event, ...args)
  })
}
