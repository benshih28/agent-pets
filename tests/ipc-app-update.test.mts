import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAppUpdateIpc } from '../electron/ipc/app-update.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import type { AppUpdateState } from '../src/types/app-update.ts'
import { fakeBrowserWindow } from './support/fake-electron.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

const state: AppUpdateState = { currentVersion: '1.13.1', enabled: false, lastCheckedAt: null, lastResult: null, latestVersion: null }

function setup(allow: (event: unknown, window: unknown) => boolean = () => true) {
  const { ipcMain, handlers } = createFakeIpcMain()
  const calls: string[] = []
  const panelWindow = fakeBrowserWindow({ id: 1 })
  registerAppUpdateIpc({
    ipcMain,
    assertTrustedIpcSender: (event: unknown, requiredWindow: unknown) => { if (!allow(event, requiredWindow)) throw new Error('untrusted sender') },
    getPanelWindow: () => panelWindow,
    getState: () => { calls.push('get'); return state },
    setEnabled: enabled => { calls.push(`set:${enabled}`); return { ...state, enabled } },
    checkNow: async () => { calls.push('check'); return { state, outcome: 'done' } },
    openRelease: async () => { calls.push('open'); return true },
  })
  return { handlers, calls, panelWindow, invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args) }
}

test('app update IPC registers four panel-only channels', () => {
  const { handlers } = setup()
  assert.deepEqual([...handlers.keys()].sort(), [
    IPC_CHANNELS.appUpdateCheck, IPC_CHANNELS.appUpdateGet, IPC_CHANNELS.appUpdateOpenRelease, IPC_CHANNELS.appUpdateSetEnabled,
  ].sort())
})

test('app update IPC rejects every channel from a sender that is not the panel window', async () => {
  const { handlers, calls, panelWindow } = setup((_event, window) => window === panelWindow ? false : true)
  for (const channel of handlers.keys()) {
    assert.throws(() => handlers.get(channel)?.({}, true), /untrusted sender/, channel)
  }
  assert.deepEqual(calls, [])
})

test('app update IPC requires the panel window as the allowed sender', () => {
  const required: unknown[] = []
  const { handlers, panelWindow } = setup((_event, window) => { required.push(window); return true })
  for (const channel of handlers.keys()) handlers.get(channel)?.({})
  assert.equal(required.length, 4)
  assert.ok(required.every(window => window === panelWindow))
})

test('setEnabled accepts only booleans and leaves state untouched otherwise', async () => {
  const { invoke, calls } = setup()
  assert.equal(((await invoke(IPC_CHANNELS.appUpdateSetEnabled, true)) as AppUpdateState).enabled, true)
  assert.deepEqual(calls, ['set:true'])
  for (const bad of ['true', 1, 0, null, undefined, {}, [], 'https://evil.example']) {
    assert.deepEqual(await invoke(IPC_CHANNELS.appUpdateSetEnabled, bad), state, String(bad))
  }
  assert.deepEqual(calls, ['set:true', ...Array(8).fill('get')])
})

test('check and open-release take no payload: extra arguments such as URLs are ignored', async () => {
  const { invoke, calls } = setup()
  assert.deepEqual(await invoke(IPC_CHANNELS.appUpdateCheck, 'https://evil.example/x'), { state, outcome: 'done' })
  assert.equal(await invoke(IPC_CHANNELS.appUpdateOpenRelease, 'https://evil.example/x'), true)
  assert.equal(await invoke(IPC_CHANNELS.appUpdateGet, { url: 'x' }), state)
  assert.deepEqual(calls, ['check', 'open', 'get'])
})
