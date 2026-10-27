import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerAdapterIpc } from '../electron/ipc/adapters.ts'

test('adapter IPC is panel-scoped and never installs the observe-only adapter', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trustedWindows: unknown[] = []
  const calls: unknown[][] = []
  const panelWindow = { id: 'panel' }
  const registry = {
    listStatuses: async () => [{ id: 'codex', installed: true }],
    diagnose: async (id: string) => { calls.push(['diagnose', id]); return { id } },
    install: async (id: string) => { calls.push(['install', id]); return { id, installed: true } },
    uninstall: async (id: string) => { calls.push(['uninstall', id]); return { id, installed: false } },
  }
  registerAdapterIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (_event, window) => trustedWindows.push(window),
    getPanelWindow: () => panelWindow,
    getAgentAdapterRegistry: () => registry,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.integrationStatus,
    IPC_CHANNELS.adapterDiagnose,
    IPC_CHANNELS.adapterInstall,
    IPC_CHANNELS.adapterUninstall,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.integrationStatus), { adapters: [{ id: 'codex', installed: true }] })
  assert.deepEqual(await invoke(IPC_CHANNELS.adapterDiagnose, 'codex'), { ok: true, report: { id: 'codex' } })
  assert.deepEqual(await invoke(IPC_CHANNELS.adapterInstall, 'generic-http'), { ok: false, error: 'Adapter is not installable' })
  assert.deepEqual(await invoke(IPC_CHANNELS.adapterUninstall, 'generic-http'), { ok: false, error: 'Adapter is not uninstallable' })
  assert.deepEqual(await invoke(IPC_CHANNELS.adapterInstall, 'codex'), { ok: true, status: { id: 'codex', installed: true } })
  assert.deepEqual(await invoke(IPC_CHANNELS.adapterUninstall, 'codex'), { ok: true, status: { id: 'codex', installed: false } })
  assert.deepEqual(calls, [['diagnose', 'codex'], ['install', 'codex'], ['uninstall', 'codex']])
  assert.equal(trustedWindows.every(window => window === panelWindow), true)
})
