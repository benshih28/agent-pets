import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerProjectMcpIpc } from '../electron/ipc/project-mcp.ts'

test('project MCP IPC preserves setup, list, remove, and forget contracts through injected services', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: string[] = []
  const panelWindow = { isDestroyed: () => false }
  const registry = {
    register: (projectPath: string) => { calls.push(`register:${projectPath}`) },
    list: () => ({ ok: true, projects: [] }),
    forget: (projectPath: string) => { calls.push(`forget:${projectPath}`); return true },
  }
  registerProjectMcpIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    assertTrustedIpcSender: () => undefined,
    getPanelWindow: () => panelWindow,
    getPetWindow: () => null,
    isDialogOpen: () => false,
    setDialogOpen: () => undefined,
    showOpenDialog: async () => ({ canceled: false, filePaths: ['test-project'] }),
    ensurePresentationMcpScript: () => calls.push('ensure'),
    installOptions: () => ({ nodeExecutable: 'node', bridgePath: 'bridge-script' }),
    getRegistry: () => registry as never,
    installProjectMcp: (projectPath: string) => {
      calls.push(`install:${projectPath}`)
      return { ok: true, projectPath, results: [] }
    },
    removeProjectMcp: (projectPath: string) => {
      calls.push(`remove:${projectPath}`)
      return { ok: true, projectPath, results: [] }
    },
  })

  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args)
  assert.deepEqual([...handlers.keys()], [
    IPC_CHANNELS.projectMcpSetup,
    IPC_CHANNELS.projectMcpList,
    IPC_CHANNELS.projectMcpRemove,
    IPC_CHANNELS.projectMcpForget,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.projectMcpSetup), { ok: true, projectPath: 'test-project', results: [] })
  assert.deepEqual(await invoke(IPC_CHANNELS.projectMcpList), { ok: true, projects: [] })
  assert.deepEqual(await invoke(IPC_CHANNELS.projectMcpRemove, 'test-project'), { ok: true, projectPath: 'test-project', results: [] })
  assert.deepEqual(await invoke(IPC_CHANNELS.projectMcpForget, 'test-project'), { ok: true, removed: true })
  assert.deepEqual(calls, [
    'ensure',
    'install:test-project',
    'register:test-project',
    'ensure',
    'ensure',
    'remove:test-project',
    'forget:test-project',
    'forget:test-project',
  ])
})
