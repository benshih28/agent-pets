import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ProjectRoutingStore } from '../project-routing'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from '../../src/types/project-pet'
import { isValidPetId } from '../../src/utils/pet-id.ts'
import { IPC_CHANNELS } from './channels.ts'
import { handleTrusted } from './trusted.ts'

type DirectoryDialogResult = { canceled: boolean; filePaths: string[] }
type DirectoryDialogOptions = { title: string; message: string; properties: Array<'openDirectory' | 'createDirectory'> }

export interface ProjectPetsIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getPetWindow(): BrowserWindow | null
  getStore(): ProjectRoutingStore | null
  availablePetIds(): Set<string> | Promise<Set<string>>
  isDialogOpen(): boolean
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: DirectoryDialogOptions): Promise<DirectoryDialogResult>
  chooseProjectPetTitle(): string
  chooseProjectPetHelp(): string
  logError(message: string, error: unknown): void
}

export function registerProjectPetsIpc(deps: ProjectPetsIpcDependencies): void {
  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsList, deps.getPanelWindow, deps.assertTrustedIpcSender, async (): Promise<ProjectPetView[]> => {
    try {
      return deps.getStore()?.listProjects(await deps.availablePetIds()) ?? []
    } catch (error) {
      deps.logError('Project pet list failed', error)
      return []
    }
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsGetEnabled, deps.getPanelWindow, deps.assertTrustedIpcSender, (): boolean => {
    return deps.getStore()?.isEnabled() ?? false
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsSetEnabled, deps.getPanelWindow, deps.assertTrustedIpcSender, (_event, value: unknown): boolean => {
    const store = deps.getStore()
    if (!store) return false
    try {
      store.setEnabled(value === true)
      return store.isEnabled()
    } catch (error) {
      deps.logError('Project pet enable toggle failed', error)
      return store.isEnabled()
    }
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsPick, deps.getPanelWindow, deps.assertTrustedIpcSender, async (): Promise<ProjectPetCommandResult> => {
    const store = deps.getStore()
    if (!store) return { ok: false, error: 'unavailable' }
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!owner || owner.isDestroyed() || deps.isDialogOpen()) return { ok: false, error: 'unavailable' }

    deps.setDialogOpen(true)
    let result: DirectoryDialogResult
    try {
      result = await deps.showOpenDialog(owner, {
        title: deps.chooseProjectPetTitle(),
        message: deps.chooseProjectPetHelp(),
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch {
      return { ok: false, error: 'unavailable' }
    } finally {
      deps.setDialogOpen(false)
    }
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }

    try {
      const project = store.registerPath(result.filePaths[0]!, Date.now(), await deps.availablePetIds())
      return project ? { ok: true, project } : { ok: false, error: 'invalid_project' }
    } catch (error) {
      deps.logError('Project pet registration failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsBind, deps.getPanelWindow, deps.assertTrustedIpcSender, async (_event, payload: unknown): Promise<ProjectPetCommandResult> => {
    const store = deps.getStore()
    if (!store || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'unavailable' }
    }
    const input = payload as Record<string, unknown>
    const projectId = typeof input.projectId === 'string' ? input.projectId : ''
    const petId = input.petId === null ? null : typeof input.petId === 'string' ? input.petId : undefined
    if (!/^[a-f0-9]{32}$/.test(projectId)) return { ok: false, error: 'invalid_project' }
    if (petId === undefined) return { ok: false, error: 'invalid_pet' }
    const available = await deps.availablePetIds()
    if (petId !== null && (!isValidPetId(petId, 128) || !available.has(petId))) {
      return { ok: false, error: 'invalid_pet' }
    }
    try {
      const project = store.setBinding(projectId, petId, available)
      return project ? { ok: true, project } : { ok: false, error: 'not_found' }
    } catch (error) {
      deps.logError('Project pet binding failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.projectPetsArchive, deps.getPanelWindow, deps.assertTrustedIpcSender, (_event, projectId: unknown): ProjectPetArchiveResult => {
    const store = deps.getStore()
    if (!store) return { ok: false, error: 'unavailable' }
    if (typeof projectId !== 'string' || !/^[a-f0-9]{32}$/.test(projectId)) {
      return { ok: false, error: 'invalid_project' }
    }
    try {
      return store.archiveProject(projectId) ? { ok: true } : { ok: false, error: 'not_found' }
    } catch (error) {
      deps.logError('Project pet archive failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })
}
