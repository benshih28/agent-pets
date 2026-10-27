import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerQuotaIpc } from '../electron/ipc/quota.ts'

test('quota IPC normalizes force, stores a snapshot, and broadcasts to live windows', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: unknown[] = []
  const sent: unknown[] = []
  const liveWindow = {
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => sent.push(args) },
  }
  const destroyedWindow = { isDestroyed: () => true, webContents: { send: () => assert.fail('destroyed window must not receive quota') } }
  registerQuotaIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: event => calls.push(event),
    getQuotaUsage: async force => { calls.push(`force:${force}`); return { remaining: 7 } },
    getHistoryStore: () => ({ recordQuotaSnapshot: value => { calls.push(value); return true } }) as never,
    broadcastHistoryUpdated: () => calls.push('history-updated'),
    getWindows: () => [liveWindow, destroyedWindow] as never,
    logError: () => undefined,
  })
  assert.deepEqual([...handlers.keys()], [IPC_CHANNELS.quotaUsage])
  const result = await handlers.get(IPC_CHANNELS.quotaUsage)?.({}, 'true')
  assert.deepEqual(result, { remaining: 7 })
  assert.deepEqual(calls, [{}, 'force:false', { remaining: 7 }, 'history-updated'])
  assert.deepEqual(sent, [[IPC_CHANNELS.quotaUsageUpdated, { remaining: 7 }]])
})
