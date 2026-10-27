import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerIntegrationIpc } from '../electron/ipc/integrations.ts'

test('integration IPC keeps sender scope, source allowlist, and target validation', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const panelWindow = { id: 'panel' }
  registerIntegrationIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: (_event, window) => { assert.equal(window, panelWindow) },
    getPanelWindow: () => panelWindow,
    sendIntegrationTestEvent: async (source, sessionId, state) => { calls.push(`send:${source}:${sessionId}:${state}`) },
    waitForIntegrationTestReceipt: async sessionId => { calls.push(`wait:${sessionId}`) },
    installIntegration: target => { calls.push(`install:${target}`) },
    uninstallIntegration: target => { calls.push(`uninstall:${target}`) },
    isIntegrationTarget: value => value === 'codex' || value === 'claude',
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.testIntegration,
    IPC_CHANNELS.installIntegrations,
    IPC_CHANNELS.uninstallIntegrations,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.testIntegration, 'invalid'), { ok: false, error: 'Unsupported integration source' })
  assert.deepEqual(await invoke(IPC_CHANNELS.installIntegrations, 'invalid'), { ok: false, error: 'Unsupported integration target' })
  assert.deepEqual(await invoke(IPC_CHANNELS.installIntegrations, 'codex'), { ok: true })
  assert.deepEqual(await invoke(IPC_CHANNELS.uninstallIntegrations), { ok: true })
  assert.equal(calls.filter(call => call.startsWith('send:')).length, 0)
  assert.deepEqual(calls, ['install:codex', 'uninstall:undefined'])
})
