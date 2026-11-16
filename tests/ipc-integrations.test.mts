import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerIntegrationIpc } from '../electron/ipc/integrations.ts'
import { fakeBrowserWindow, fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

test('integration IPC keeps sender scope, source allowlist, and target validation', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const calls: string[] = []
  const panelWindow = fakeBrowserWindow()
  registerIntegrationIpc({
    ipcMain,
    assertTrustedIpcSender: (_event, window) => { assert.equal(window, panelWindow) },
    getPanelWindow: () => panelWindow,
    sendIntegrationTestEvent: async (source, sessionId, state) => { calls.push(`send:${source}:${sessionId}:${state}`) },
    waitForIntegrationTestReceipt: async sessionId => { calls.push(`wait:${sessionId}`) },
    installIntegration: target => { calls.push(`install:${target}`) },
    uninstallIntegration: target => { calls.push(`uninstall:${target}`) },
    isIntegrationTarget: value => value === 'codex' || value === 'claude',
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent(), ...args)
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.testIntegration,
    IPC_CHANNELS.installIntegrations,
    IPC_CHANNELS.uninstallIntegrations,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.testIntegration, 'invalid'), { ok: false, error: 'Unsupported integration source' })
  assert.deepEqual(await invoke(IPC_CHANNELS.installIntegrations, 'invalid'), { ok: false, error: 'Unsupported integration target' })
  assert.deepEqual(await invoke(IPC_CHANNELS.installIntegrations, 'codex'), { ok: true })
  assert.deepEqual(await invoke(IPC_CHANNELS.uninstallIntegrations), { ok: true })
  assert.deepEqual(await invoke(IPC_CHANNELS.uninstallIntegrations, 'all'), { ok: true })
  assert.deepEqual(await invoke(IPC_CHANNELS.installIntegrations, 'all'), { ok: false, error: 'Unsupported integration target' })
  assert.equal(calls.filter(call => call.startsWith('send:')).length, 0)
  assert.deepEqual(calls, ['install:codex', 'uninstall:undefined', 'uninstall:all'])
})
