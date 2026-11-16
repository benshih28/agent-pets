import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerProgressionIpc } from '../electron/ipc/progression.ts'
import type { AchievementStore } from '../electron/achievements.ts'
import type { AchievementSnapshot } from '../src/types/achievement.ts'
import type { ProgressionInsights, ProgressionSnapshot } from '../src/types/progression.ts'
import { fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { fakeService } from './support/fake-service.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

function progressionSnapshot(petId: string): ProgressionSnapshot {
  return { petId, totalXp: 0, level: 1, xpIntoLevel: 0, xpToNext: 100, evolutionStage: 'egg', currentStreak: 0, longestStreak: 0, updatedAt: 0 }
}

function progressionInsights(petId: string): ProgressionInsights {
  return { petId, localDate: '2026-01-01', todayXp: 0, firstCompletionClaimed: false, recent: [], averageDailyXp: null, generatedAt: 0 }
}

function achievementSnapshot(petId: string): AchievementSnapshot {
  return { schemaVersion: 1, generatedAt: 0, petId, totalUnlocked: 0, achievements: [] }
}

test('progression IPC registration delegates validation and pet-scoped snapshots', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const senders: unknown[] = []
  const selectedPets: string[] = []
  const achievementSnapshots: string[] = []
  registerProgressionIpc({
    ipcMain,
    assertTrustedIpcSender: event => senders.push(event),
    isProgressionPetId: (value): value is string => typeof value === 'string' && value.startsWith('pet-'),
    setActiveProgressionPet: petId => { selectedPets.push(petId); return progressionSnapshot(petId) },
    getProgressionStore: () => ({ getActivePetId: () => 'pet-active', getInsights: progressionInsights, getSnapshot: progressionSnapshot }),
    getAchievementStore: () => fakeService<AchievementStore>({ getSnapshot: (petId: string) => { achievementSnapshots.push(petId); return achievementSnapshot(petId) } }),
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(fakeIpcMainInvokeEvent(), ...args)

  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.progressionInit,
    IPC_CHANNELS.progressionSetPet,
    IPC_CHANNELS.progressionInsights,
    IPC_CHANNELS.achievementsInit,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionInit), progressionSnapshot('aang-airbender'))
  assert.equal(await invoke(IPC_CHANNELS.progressionInit, 'not-a-pet'), null)
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionSetPet, 'pet-next'), progressionSnapshot('pet-next'))
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionInsights), progressionInsights('pet-active'))
  assert.deepEqual(await invoke(IPC_CHANNELS.progressionInsights, 'pet-other'), progressionInsights('pet-other'))
  assert.equal(await invoke(IPC_CHANNELS.progressionInsights, 'bad'), null)
  assert.deepEqual(await invoke(IPC_CHANNELS.achievementsInit), achievementSnapshot('pet-active'))
  assert.deepEqual(await invoke(IPC_CHANNELS.achievementsInit, 'invalid'), null)
  assert.deepEqual(selectedPets, ['aang-airbender', 'pet-next'])
  assert.deepEqual(achievementSnapshots, ['pet-active'])
  assert.equal(senders.length, 8)
})
