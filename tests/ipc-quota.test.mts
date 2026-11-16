import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerQuotaIpc } from '../electron/ipc/quota.ts'
import type { HistoryStore } from '../electron/history.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent, fakeWebContents } from './support/fake-electron.mts'
import { fakeService } from './support/fake-service.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

test('quota IPC normalizes force, stores a snapshot, and broadcasts to live windows', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const calls: unknown[] = []
  const sent: unknown[] = []
  const event = fakeIpcMainInvokeEvent()
  const liveWindow = fakeBrowserWindow({
    isDestroyed: () => false,
    webContents: fakeWebContents({ send: (...args: unknown[]) => { sent.push(args) } }),
  })
  const destroyedWindow = fakeBrowserWindow({ isDestroyed: () => true, webContents: fakeWebContents({ send: () => assert.fail('destroyed window must not receive quota') }) })
  registerQuotaIpc({
    ipcMain,
    assertTrustedIpcSender: received => { calls.push(received) },
    getQuotaUsage: async force => { calls.push(`force:${force}`); return { remaining: 7 } },
    getHistoryStore: () => fakeService<HistoryStore>({ recordQuotaSnapshot: (value: unknown) => { calls.push(value); return true } }),
    broadcastHistoryUpdated: () => { calls.push('history-updated') },
    getWindows: () => [liveWindow, destroyedWindow],
    logError: () => undefined,
  })
  assert.deepEqual([...handlers.keys()], [IPC_CHANNELS.quotaUsage])
  const result = await handlers.get(IPC_CHANNELS.quotaUsage)?.(event, 'true')
  assert.deepEqual(result, { remaining: 7 })
  assert.equal(calls[0], event, 'sender guard receives the original event')
  assert.deepEqual(calls, [event, 'force:false', { remaining: 7 }, 'history-updated'])
  assert.deepEqual(sent, [[IPC_CHANNELS.quotaUsageUpdated, { remaining: 7 }]])
})
