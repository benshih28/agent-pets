import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ProjectMcpRegistryStore } from '../project-mcp-registry.ts'
import {
  installProjectMcp,
  planProjectMcp,
  removeProjectMcp,
  type ProjectMcpInstallOptions,
} from '../project-mcp-setup.ts'
import type {
  ProjectMcpApplyRequest,
  ProjectMcpClientId,
  ProjectMcpPlan,
  ProjectMcpRegistrySnapshot,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '../../src/types/project-mcp.ts'
import { PROJECT_MCP_CLIENTS } from '../../src/types/project-mcp.ts'
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
  planProjectMcp: typeof planProjectMcp
  removeProjectMcp: typeof removeProjectMcp
  installOptions(): ProjectMcpInstallOptions
  getRegistry(): ProjectMcpRegistryStore | null
  /** Current app language, for native dialog text. */
  getLocale?(): 'zh-TW' | 'en-US'
}

const MAX_REMEMBERED_PICKS = 16

function parseApplyRequest(value: unknown): ProjectMcpApplyRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.projectPath !== 'string' || raw.projectPath.length === 0 || raw.projectPath.length > 4_096) return null
  if (typeof raw.localOnly !== 'boolean') return null
  if (!Array.isArray(raw.clients) || raw.clients.length === 0 || raw.clients.length > PROJECT_MCP_CLIENTS.length) return null
  const clients = raw.clients.filter((client): client is ProjectMcpClientId => (
    typeof client === 'string' && (PROJECT_MCP_CLIENTS as readonly string[]).includes(client)
  ))
  if (clients.length !== raw.clients.length) return null
  if (raw.updateStale !== undefined && typeof raw.updateStale !== 'boolean') return null
  return {
    projectPath: raw.projectPath,
    clients: [...new Set(clients)],
    localOnly: raw.localOnly,
    updateStale: raw.updateStale === true,
  }
}

export function registerProjectMcpIpc(deps: ProjectMcpIpcDependencies): void {
  // The renderer may only apply to folders the user picked in the native dialog during this run
  // (or that are already tracked); it can never name an arbitrary path to write into.
  const pickedProjects: string[] = []
  const rememberPick = (projectPath: string) => {
    const index = pickedProjects.indexOf(projectPath)
    if (index >= 0) pickedProjects.splice(index, 1)
    pickedProjects.push(projectPath)
    if (pickedProjects.length > MAX_REMEMBERED_PICKS) pickedProjects.shift()
  }

  // Step 1: pick a folder and preview. Nothing is written.
  deps.ipcMain.handle(IPC_CHANNELS.projectMcpSetup, async (event): Promise<ProjectMcpPlan> => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!owner || owner.isDestroyed()) return { ok: false, error: 'No settings window is available' }
    if (deps.isDialogOpen()) return { ok: false, error: 'Another dialog is already open' }

    const english = deps.getLocale?.() === 'en-US'
    deps.setDialogOpen(true)
    let result: DirectoryDialogResult
    try {
      result = await deps.showOpenDialog(owner, {
        title: english ? 'Set up Agent Pets MCP for a project' : '為專案設定 Agent Pets MCP',
        message: english ? 'Choose a local project folder' : '選擇本機專案資料夾',
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      deps.setDialogOpen(false)
    }

    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

    try {
      deps.ensurePresentationMcpScript()
      const plan = deps.planProjectMcp(result.filePaths[0]!, deps.installOptions())
      if (plan.projectPath) rememberPick(plan.projectPath)
      return plan
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Step 2: write only the confirmed clients for a folder chosen in step 1.
  deps.ipcMain.handle(IPC_CHANNELS.projectMcpApply, (event, request: unknown): ProjectMcpSetupSummary => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const parsed = parseApplyRequest(request)
    if (!parsed) return { ok: false, results: [], error: 'Invalid project MCP request' }
    const registry = deps.getRegistry()
    const known = pickedProjects.includes(parsed.projectPath) || registry?.has(parsed.projectPath) === true
    if (!known) return { ok: false, results: [], error: 'Project folder was not chosen in this session' }

    try {
      deps.ensurePresentationMcpScript()
      const alreadyTracked = registry?.has(parsed.projectPath) === true
      // Track first: if the registry cannot be written nothing has been changed yet.
      if (registry && !alreadyTracked) registry.register(parsed.projectPath)
      let summary: ProjectMcpSetupSummary
      try {
        summary = deps.installProjectMcp(parsed.projectPath, deps.installOptions(), {
          clients: parsed.clients,
          localOnly: parsed.localOnly,
          updateStale: parsed.updateStale,
        })
      } catch (error) {
        if (registry && !alreadyTracked) registry.forget(parsed.projectPath)
        throw error
      }
      const configured = summary.results.some(item => item.status === 'installed' || item.status === 'already_configured')
      if (registry && summary.projectPath) {
        if (!configured && !alreadyTracked) registry.forget(parsed.projectPath)
        else if (summary.projectPath !== parsed.projectPath) {
          // Canonical (symlink-resolved) path differs from the picked one.
          registry.forget(parsed.projectPath)
          registry.register(summary.projectPath)
        } else if (alreadyTracked) registry.register(summary.projectPath)
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
    // Removal, like apply, may only act on folders that are already tracked.
    if (!registry.has(requestedPath)) {
      return { ok: false, projectPath: requestedPath, results: [], error: 'Project folder is not tracked' }
    }
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
