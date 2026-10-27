import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerProgressionIpc } from '../electron/ipc/progression.ts'

test('progression IPC registration delegates validation and pet-scoped snapshots', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const senders: unknown[] = []
  const selectedPets: string[] = []
  const achievementSnapshots: string[] = []
  registerProgressionIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: event => senders.push(event),
    isProgressionPetId: value => typeof value === 'string' && value.startsWith('pet-'),
    setActiveProgressionPet: petId => { selectedPets.push(petId); return { petId } },
    getProgressionStore: () => ({ getActivePetId: () => 'pet-active' }),
    getAchievementStore: () => ({ getSnapshot: petId => { achievementSnapshots.push(petId); return { petId } } }),
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.progressionInit,
    IPC_CHANNELS.progressionSetPet,
    IPC_CHANNELS.achievementsInit,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionInit), { petId: 'aang-airbender' })
  assert.equal(await invoke(IPC_CHANNELS.progressionInit, 'not-a-pet'), null)
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionSetPet, 'pet-next'), { petId: 'pet-next' })
  assert.deepEqual(await invoke(IPC_CHANNELS.achievementsInit), { petId: 'pet-active' })
  assert.deepEqual(await invoke(IPC_CHANNELS.achievementsInit, 'invalid'), null)
  assert.deepEqual(selectedPets, ['aang-airbender', 'pet-next'])
  assert.deepEqual(achievementSnapshots, ['pet-active'])
  assert.equal(senders.length, 5)
})
