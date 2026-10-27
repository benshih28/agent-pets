import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ProjectMcpRegistryStore } from '../project-mcp-registry.ts'
import { installProjectMcp, removeProjectMcp, type ProjectMcpInstallOptions } from '../project-mcp-setup.ts'
import type { ProjectMcpRegistrySnapshot, ProjectMcpRemovalSummary } from '../../src/types/project-mcp.ts'
import { IPC_CHANNELS } from './channels.ts'

type DirectoryDialogResult = { canceled: boolean; filePaths: string[] }
type DirectoryDialogOptions = { title: string; message: string; properties: Array<'openDirectory' | 'createDirectory'> }

export interface ProjectMcpIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getPetWindow(): BrowserWindow | null
  isDialogOpen(): boolean
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: DirectoryDialogOptions): Promise<DirectoryDialogResult>
  ensurePresentationMcpScript(): void
  installProjectMcp: typeof installProjectMcp
  removeProjectMcp: typeof removeProjectMcp
  installOptions(): ProjectMcpInstallOptions
  getRegistry(): ProjectMcpRegistryStore | null
}

export function registerProjectMcpIpc(deps: ProjectMcpIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.projectMcpSetup, async (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!owner || owner.isDestroyed()) return { ok: false, results: [], error: 'No settings window is available' }
    if (deps.isDialogOpen()) return { ok: false, results: [], error: 'Another dialog is already open' }

    deps.setDialogOpen(true)
    let result: DirectoryDialogResult
    try {
      result = await deps.showOpenDialog(owner, {
        title: '將 Agent Pets MCP 安裝到專案',
        message: '選擇本機專案資料夾',
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (error) {
      return { ok: false, results: [], error: error instanceof Error ? error.message : String(error) }
    } finally {
      deps.setDialogOpen(false)
    }

    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, results: [] }

    try {
      deps.ensurePresentationMcpScript()
      const summary = deps.installProjectMcp(result.filePaths[0]!, deps.installOptions())
      const registry = deps.getRegistry()
      if (summary.projectPath && registry) {
        try {
          registry.register(summary.projectPath)
        } catch (registryError) {
          return {
            ...summary,
            ok: false,
            error: registryError instanceof Error ? registryError.message : String(registryError),
          }
        }
      }
      return summary
    } catch (error) {
      return { ok: false, results: [], error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.projectMcpList, (event): ProjectMcpRegistrySnapshot => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const registry = deps.getRegistry()
    if (!registry) return { ok: false, projects: [], error: 'Project MCP registry is unavailable' }
    try {
      deps.ensurePresentationMcpScript()
      return registry.list(deps.installOptions())
    } catch (error) {
      return { ok: false, projects: [], error: error instanceof Error ? error.message : String(error) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.projectMcpRemove, (event, projectPath: unknown): ProjectMcpRemovalSummary => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const requestedPath = typeof projectPath === 'string' ? projectPath : ''
    const registry = deps.getRegistry()
    if (!registry) return { ok: false, projectPath: requestedPath, results: [], error: 'Project MCP registry is unavailable' }
    try {
      deps.ensurePresentationMcpScript()
      const summary = deps.removeProjectMcp(requestedPath, deps.installOptions())
      if (summary.ok) registry.forget(summary.projectPath)
      return summary
    } catch (error) {
      return {
        ok: false,
        projectPath: requestedPath,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.projectMcpForget, (event, projectPath: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const registry = deps.getRegistry()
    if (!registry || typeof projectPath !== 'string') return { ok: false, removed: false }
    try {
      return { ok: true, removed: registry.forget(projectPath) }
    } catch (error) {
      return { ok: false, removed: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
