import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { OnboardingStore } from '../electron/onboarding-state.ts'
import { registerOnboardingIpc } from '../electron/ipc/onboarding.ts'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'

test('onboarding state persists completion, skip and reset in a temp dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-onboarding-'))
  try {
    let clock = 1000
    const store = new OnboardingStore(path.join(dir, 'nested', 'onboarding.json'), () => (clock += 1))
    assert.deepEqual(store.get(), { version: 1 })
    assert.equal(store.update('skipped').skippedAt, 1001)
    assert.equal(new OnboardingStore(path.join(dir, 'nested', 'onboarding.json')).get().skippedAt, 1001)
    assert.equal(store.update('completed').completedAt, 1002)
    assert.deepEqual(store.update('reset'), { version: 1 })
    fs.writeFileSync(path.join(dir, 'nested', 'onboarding.json'), '{ not json')
    assert.deepEqual(store.get(), { version: 1 })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('onboarding IPC checks the sender and rejects unknown actions', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const updates: string[] = []
  let trusted = 0
  registerOnboardingIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: () => { trusted += 1 },
    getStore: () => ({ get: () => ({ version: 1 }), update: (action: string) => { updates.push(action); return { version: 1 } } }) as never,
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.deepEqual(invoke(IPC_CHANNELS.onboardingGet), { version: 1 })
  assert.equal(invoke(IPC_CHANNELS.onboardingUpdate, 'bogus'), null)
  assert.deepEqual(invoke(IPC_CHANNELS.onboardingUpdate, 'completed'), { version: 1 })
  assert.deepEqual(updates, ['completed'])
  assert.equal(trusted, 3)
})
