import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerHistoryIpc } from '../electron/ipc/history.ts'

function createHistoryIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const panelWindow = { id: 'panel' }
  const records = { trusted: [] as Array<unknown>, broadcasts: 0, refreshes: 0, writes: [] as Array<{ path: string; value: unknown }>, reveals: [] as string[], sessionQueries: [] as Array<{ petId: string; query: unknown }>, detailIds: [] as string[] }
  let dialogResult: { canceled: boolean; filePath?: string } = { canceled: true }
  const historyStore = {
    clear() {},
    listSessions: (petId: string, query: unknown) => {
      records.sessionQueries.push({ petId, query })
      return { items: [], nextCursor: null }
    },
    getSessionDetail: (petId: string, id: string) => {
      records.detailIds.push(`${petId}/${id}`)
      return null
    },
    getUsageBlocks: () => [{ adapterId: 'codex', startAt: 1, endAt: 2, firstActivityAt: 1, lastActivityAt: 1, tokenInput: 1, tokenOutput: 0, tokenCacheRead: 0, tokenCacheWrite: 0, records: 1 }],
    getExport: (petId: string, _projectId?: string, rangeDays?: number) => ({ petId, rows: [], rangeDays, summary: { localDate: '2026-08-13', days: [{ localDate: '2026-08-13', sessionsCompleted: 1, sessionsFailed: 0, activeMs: 120000, tokenInput: 5, tokenOutput: 6, tokenCacheRead: 7, tokenCacheWrite: 8 }] } }),
  }

  registerHistoryIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (event: unknown, requiredWindow: unknown) => records.trusted.push({ event, requiredWindow }),
    getPanelWindow: () => panelWindow,
    getHistoryStore: () => historyStore,
    refreshLocalUsage: async () => { records.refreshes += 1 },
    currentHistorySummary: (projectId, rangeDays) => ({ projectId: projectId ?? null, rangeDays }),
    broadcastHistoryUpdated: () => { records.broadcasts += 1 },
    documentsPath: () => 'test-documents',
    joinPath: (...parts: string[]) => parts.join('/'),
    showSaveDialog: async (window: unknown, options: unknown) => {
      records.trusted.push({ dialogWindow: window, options })
      return dialogResult
    },
    writeJsonAtomic: (path: string, value: unknown) => records.writes.push({ path, value }),
    writeTextFile: (path: string, text: string) => records.writes.push({ path, value: text }),
    revealPath: (path: string) => records.reveals.push(path),
    activePetId: () => 'sample-pet',
  })

  return {
    handlers,
    panelWindow,
    records,
    setDialogResult(value: { canceled: boolean; filePath?: string }) { dialogResult = value },
  }
}

test('history IPC registration uses injected services and preserves handler behavior', async () => {
  const harness = createHistoryIpcHarness()
  const invoke = (channel: string, ...args: unknown[]) => harness.handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...harness.handlers.keys()], [
    IPC_CHANNELS.historySummary,
    IPC_CHANNELS.historyUsageBlocks,
    IPC_CHANNELS.historySessions,
    IPC_CHANNELS.historySessionDetail,
    IPC_CHANNELS.historyClear,
    IPC_CHANNELS.historyExport,
    IPC_CHANNELS.historyRevealExport,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.historySummary, 'project-a'), { projectId: 'project-a', rangeDays: 7 })
  assert.deepEqual(await invoke(IPC_CHANNELS.historySummary, 7), { projectId: null, rangeDays: 7 })
  assert.equal(harness.records.refreshes, 2)

  assert.deepEqual(await invoke(IPC_CHANNELS.historyClear), { ok: true })
  assert.equal(harness.records.broadcasts, 1)

  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport), { ok: false, error: 'cancelled' })
  assert.deepEqual(harness.records.writes, [])
  harness.setDialogResult({ canceled: false, filePath: 'test-documents/history.json' })
  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport), { ok: true, path: 'test-documents/history.json' })
  assert.equal(harness.records.writes.length, 1)
  assert.equal(harness.records.writes[0].path, 'test-documents/history.json')
  assert.equal(harness.records.refreshes, 4)
  assert.equal(harness.records.trusted.length, 7)
})

test('history summary range is limited to the supported 7/30/90 windows', async () => {
  const harness = createHistoryIpcHarness()
  const invoke = (...args: unknown[]) => harness.handlers.get(IPC_CHANNELS.historySummary)?.({}, ...args) as Promise<{ rangeDays: number }>
  assert.equal((await invoke(undefined, 30)).rangeDays, 30)
  assert.equal((await invoke(undefined, 90)).rangeDays, 90)
  assert.equal((await invoke(undefined, 365)).rangeDays, 7)
  assert.equal((await invoke(undefined, '30')).rangeDays, 7)
})

test('export honours format/range, names files by local date and only reveals what it exported', async () => {
  const harness = createHistoryIpcHarness()
  const invoke = (channel: string, ...args: unknown[]) => harness.handlers.get(channel)?.({}, ...args) as Promise<unknown>
  assert.equal(await invoke(IPC_CHANNELS.historyRevealExport), false)
  harness.setDialogResult({ canceled: false, filePath: 'out/history.csv' })
  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport, { format: 'csv', rangeDays: 30, projectId: 'a'.repeat(32) }), { ok: true, path: 'out/history.csv' })
  const csv = harness.records.writes.at(-1)!.value as string
  assert.equal(csv.split('\n')[0], 'date,sessions_completed,sessions_failed,active_minutes,tokens_input_fresh,tokens_output,tokens_cache_read,tokens_cache_write')
  assert.equal(csv.split('\n')[1], '2026-08-13,1,0,2,5,6,7,8')
  const saveCall = harness.records.trusted.find(entry => (entry as { options?: unknown }).options) as { options: { defaultPath: string; filters: Array<{ extensions: string[] }> } }
  assert.equal(saveCall.options.defaultPath, 'test-documents/agent-pets-history-30d-aaaaaaaa-2026-08-13.csv')
  assert.deepEqual(saveCall.options.filters[0].extensions, ['csv'])
  assert.equal(await invoke(IPC_CHANNELS.historyRevealExport), true)
  assert.deepEqual(harness.records.reveals, ['out/history.csv'])
  // A bogus request degrades to a plain 7-day JSON export.
  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport, { format: 'exe', rangeDays: 5, projectId: '../x' }), { ok: true, path: 'out/history.csv' })
})

test('usage blocks IPC is sender-checked, takes no input and never starts a log scan', async () => {
  const harness = createHistoryIpcHarness()
  const handler = harness.handlers.get(IPC_CHANNELS.historyUsageBlocks)!
  const blocks = await handler({}, '../../etc', 999) as Array<{ adapterId: string }>
  assert.deepEqual(blocks.map(block => block.adapterId), ['codex'])
  assert.equal(harness.records.refreshes, 0)
  assert.deepEqual(harness.records.trusted, [{ event: {}, requiredWindow: harness.panelWindow }])
})

test('session list IPC is sender-checked, normalises every field and never scans logs', async () => {
  const harness = createHistoryIpcHarness()
  const list = harness.handlers.get(IPC_CHANNELS.historySessions)!
  assert.deepEqual(await list({}, {
    projectId: '../../etc',
    adapterId: 'codex; DROP TABLE sessions',
    outcome: 'pwned',
    search: `${'x'.repeat(200)}\u0000`,
    limit: 10_000,
    from: Number.NaN,
    to: 'tomorrow',
    cursor: { lastSeenAt: 5, id: "' OR 1=1 --" },
    extra: { nested: true },
  }), { items: [], nextCursor: null })
  const { petId, query } = harness.records.sessionQueries[0]!
  assert.equal(petId, 'sample-pet')
  assert.deepEqual(Object.keys(query as object).sort(), ['limit', 'search'])
  assert.equal((query as { limit: number }).limit, 50)
  assert.equal((query as { search: string }).search.length, 64)
  await list({}, 'not an object')
  assert.deepEqual(harness.records.sessionQueries[1]!.query, { limit: 30 })
  assert.equal(harness.records.refreshes, 0)
  assert.equal(harness.records.trusted.length, 2)
})

test('session detail IPC only forwards well-formed session ids', async () => {
  const harness = createHistoryIpcHarness()
  const detail = harness.handlers.get(IPC_CHANNELS.historySessionDetail)!
  assert.equal(await detail({}, 42), null)
  assert.equal(await detail({}, 'codex:codex:not-a-hash'), null)
  assert.equal(await detail({}, `codex:codex:${'a'.repeat(24)}\n`), null)
  assert.equal(await detail({}, `codex:codex:${'a'.repeat(24)}`), null)
  // Scoped to the active pet, like the list.
  assert.deepEqual(harness.records.detailIds, [`sample-pet/codex:codex:${'a'.repeat(24)}`])
  assert.equal(harness.records.trusted.length, 4)
})
