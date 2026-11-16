import test from 'node:test'
import assert from 'node:assert/strict'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerReliabilityIpc, type ReliabilityIpcDependencies } from '../electron/ipc/reliability.ts'
import { fakeBrowserWindow, fakeWebContents } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

type RendererErrorReport = Parameters<ReliabilityIpcDependencies['reportRendererError']>[0]

function setup(trusted = true) {
  const { ipcMain, handlers, listeners } = createFakeIpcMain()
  const reports: RendererErrorReport[] = []
  let reloads = 0
  const panel = fakeBrowserWindow({ webContents: fakeWebContents({ id: 1 }) })
  registerReliabilityIpc({
    ipcMain,
    isTrustedIpcSender: () => trusted,
    assertTrustedIpcSender: () => { if (!trusted) throw new Error('Unauthorized IPC sender') },
    getPanelWindow: () => panel,
    getServerHealth: () => ({ servers: [] }),
    retryServer: () => {},
    getSessionSnapshot: () => [],
    exportDiagnostics: async () => ({ ok: true }),
    reportRendererError: r => reports.push(r),
    reloadRenderers: () => { reloads += 1 },
  })
  return { handlers, listeners, reports, reloads: () => reloads, panel }
}

test('renderer error reports are validated, truncated and attributed', () => {
  const ctx = setup()
  const send = ctx.listeners.get(IPC_CHANNELS.rendererErrorReport)!
  send({ sender: ctx.panel.webContents }, { kind: 'vue', message: 'x'.repeat(2000), stack: 's'.repeat(5000) })
  send({ sender: {} }, { kind: 'bogus', message: 'm' })
  send({ sender: {} }, { message: 42 })
  send({ sender: {} }, null)
  assert.equal(ctx.reports.length, 2)
  assert.equal(ctx.reports[0].message.length, 500)
  assert.equal(ctx.reports[0].stack?.length, 2000)
  assert.equal(ctx.reports[0].window, 'panel')
  assert.equal(ctx.reports[1].kind, 'error')
  assert.equal(ctx.reports[1].window, 'pet')
})

test('reports are rate limited and untrusted senders are ignored', () => {
  const ctx = setup()
  const send = ctx.listeners.get(IPC_CHANNELS.rendererErrorReport)!
  for (let i = 0; i < 100; i += 1) send({ sender: {} }, { kind: 'error', message: 'm' })
  assert.equal(ctx.reports.length, 20)
  const untrusted = setup(false)
  untrusted.listeners.get(IPC_CHANNELS.rendererErrorReport)!({ sender: {} }, { kind: 'error', message: 'm' })
  untrusted.listeners.get(IPC_CHANNELS.rendererReload)!({ sender: {} })
  assert.equal(untrusted.reports.length, 0)
  assert.equal(untrusted.reloads(), 0)
  ctx.listeners.get(IPC_CHANNELS.rendererReload)!({ sender: {} })
  assert.equal(ctx.reloads(), 1)
})

test('privileged reliability invokes reject untrusted senders', async () => {
  const ctx = setup(false)
  await assert.rejects(async () => ctx.handlers.get(IPC_CHANNELS.diagnosticsExport)!({}))
  assert.throws(() => ctx.handlers.get(IPC_CHANNELS.serverHealthGet)!({}))
})
