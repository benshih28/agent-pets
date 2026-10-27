import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerProjectPetsIpc } from '../electron/ipc/project-pets.ts'

test('project pets IPC delegates through injected store and dialog dependencies', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted: Array<{ event: unknown; window: unknown }> = []
  const records: string[] = []
  const panelWindow = { isDestroyed: () => false }
  const petWindow = { isDestroyed: () => false }
  const project = { id: 'a'.repeat(32), name: 'sample' }
  let enabled = false
  let dialogOpen = false
  const store = {
    listProjects: (ids: Set<string>) => { records.push(`list:${ids.size}`); return [project] },
    isEnabled: () => enabled,
    setEnabled: (value: boolean) => { enabled = value },
    registerPath: (path: string, _now: number, ids: Set<string>) => {
      records.push(`register:${path}:${ids.size}`)
      return project
    },
    setBinding: (projectId: string, petId: string | null, ids: Set<string>) => {
      records.push(`bind:${projectId}:${petId}:${ids.size}`)
      return project
    },
    archiveProject: (projectId: string) => projectId === project.id,
  }

  registerProjectPetsIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: (event, window) => { trusted.push({ event, window }) },
    getPanelWindow: () => panelWindow,
    getPetWindow: () => petWindow,
    getStore: () => store as never,
    availablePetIds: () => new Set(['sample-pet']),
    isDialogOpen: () => dialogOpen,
    setDialogOpen: value => { dialogOpen = value },
    showOpenDialog: async () => ({ canceled: false, filePaths: ['test-project'] }),
    chooseProjectPetTitle: () => 'Choose project',
    chooseProjectPetHelp: () => 'Choose a project folder',
    logError: () => undefined,
  })

  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.projectPetsList,
    IPC_CHANNELS.projectPetsGetEnabled,
    IPC_CHANNELS.projectPetsSetEnabled,
    IPC_CHANNELS.projectPetsPick,
    IPC_CHANNELS.projectPetsBind,
    IPC_CHANNELS.projectPetsArchive,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.projectPetsList), [project])
  assert.equal(await invoke(IPC_CHANNELS.projectPetsGetEnabled), false)
  assert.equal(await invoke(IPC_CHANNELS.projectPetsSetEnabled, true), true)
  assert.deepEqual(await invoke(IPC_CHANNELS.projectPetsPick), { ok: true, project })
  assert.equal(dialogOpen, false)
  assert.deepEqual(await invoke(IPC_CHANNELS.projectPetsBind, { projectId: project.id, petId: 'sample-pet' }), { ok: true, project })
  assert.deepEqual(await invoke(IPC_CHANNELS.projectPetsBind, { projectId: 'bad', petId: 'sample-pet' }), { ok: false, error: 'invalid_project' })
  assert.deepEqual(await invoke(IPC_CHANNELS.projectPetsArchive, project.id), { ok: true })
  assert.deepEqual(records, [
    'list:1',
    'register:test-project:1',
    `bind:${project.id}:sample-pet:1`,
  ])
  assert.equal(trusted.length, 7)
  assert.ok(trusted.every(entry => entry.window === panelWindow))
})

test('project pets picker fails closed when a dialog is already open', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let pickerCalls = 0
  const panelWindow = { isDestroyed: () => false }
  registerProjectPetsIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: () => undefined,
    getPanelWindow: () => panelWindow,
    getPetWindow: () => null,
    getStore: () => ({}) as never,
    availablePetIds: () => new Set(),
    isDialogOpen: () => true,
    setDialogOpen: () => undefined,
    showOpenDialog: async () => { pickerCalls += 1; return { canceled: true, filePaths: [] } },
    chooseProjectPetTitle: () => 'Choose project',
    chooseProjectPetHelp: () => 'Choose a project folder',
    logError: () => undefined,
  })
  const result = await handlers.get(IPC_CHANNELS.projectPetsPick)?.({})
  assert.deepEqual(result, { ok: false, error: 'unavailable' })
  assert.equal(pickerCalls, 0)
})
