import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerAdapterIpc } from '../electron/ipc/adapters.ts'
import type { AgentAdapterRegistry } from '../electron/agent-adapter.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent, fakeWebContents } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

// registry 的 adapters/normalize 與這些測試無關，回傳資料也只保留斷言用到的欄位，所以只實作被呼叫的方法。
function asRegistry(ports: object): AgentAdapterRegistry {
  return ports as unknown as AgentAdapterRegistry
}

test('adapter IPC is panel-scoped and never installs the observe-only adapter', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const trustedWindows: unknown[] = []
  const calls: unknown[][] = []
  const panelWindow = fakeBrowserWindow()
  const registry = asRegistry({
    listStatuses: async () => [{ id: 'codex', installed: true }],
    diagnose: async (id: string) => { calls.push(['diagnose', id]); return { id } },
    install: async (id: string) => { calls.push(['install', id]); return { id, installed: true } },
    uninstall: async (id: string) => { calls.push(['uninstall', id]); return { id, installed: false } },
  })
  registerAdapterIpc({
    ipcMain,
    assertTrustedIpcSender: (_event, window) => trustedWindows.push(window),
    getPanelWindow: () => panelWindow,
    getAgentAdapterRegistry: () => registry,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent(), ...args)

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

test('the pet may read integration status for first-run onboarding; diagnose stays panel-only', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const panelContents = fakeWebContents()
  const petContents = fakeWebContents()
  const panelWindow = fakeBrowserWindow({ webContents: panelContents })
  const petWindow = fakeBrowserWindow({ webContents: petContents })
  registerAdapterIpc({
    ipcMain,
    assertTrustedIpcSender: (event, window) => {
      if (event.sender !== window?.webContents) throw new Error('Unauthorized IPC sender')
    },
    getPanelWindow: () => panelWindow,
    getPetWindow: () => petWindow,
    getAgentAdapterRegistry: () => asRegistry({ listStatuses: async () => [], diagnose: async () => ({}) }),
  })
  const fromSender = (sender: ReturnType<typeof fakeWebContents>) => fakeIpcMainInvokeEvent({ sender })
  assert.deepEqual(await handlers.get(IPC_CHANNELS.integrationStatus)!(fromSender(petContents)), { adapters: [] })
  assert.deepEqual(await handlers.get(IPC_CHANNELS.integrationStatus)!(fromSender(panelContents)), { adapters: [] })
  await assert.rejects(async () => handlers.get(IPC_CHANNELS.integrationStatus)!(fromSender(fakeWebContents())), /Unauthorized/)
  await assert.rejects(async () => handlers.get(IPC_CHANNELS.adapterDiagnose)!(fromSender(petContents), 'codex'), /Unauthorized/)
})
