import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginCatalogDocument, PluginCatalogPanelItem, PluginCatalogVersion } from '../src/types/plugin-catalog.ts'
import type { PluginPreferencesStore } from '../electron/plugin-preferences.ts'
import type { PluginRegistry } from '../electron/plugin-registry.ts'
import type { PluginCatalogIpcDependencies } from '../electron/ipc/plugin-catalog.ts'
import { registerPluginCatalogIpc } from '../electron/ipc/plugin-catalog.ts'
import { catalogFingerprintMatches, isPluginCatalogUrl, selectLatestCompatiblePluginVersion } from '../electron/plugin-catalog.ts'
import { fakeIpcMainInvokeEvent } from './support/fake-electron.mts'
import { fakeService } from './support/fake-service.mts'
import { createFakeIpcMain } from './support/fake-ipc.mts'

function fixture() {
  const { ipcMain, handlers } = createFakeIpcMain()
  // 以物件身分辨識 panel 來源，取代原本的字串哨兵。
  const panelEvent = fakeIpcMainInvokeEvent()
  const calls: string[] = []
  const pluginVersion: PluginCatalogVersion = {
    version: '1.2.0', apiVersion: '1', url: 'https://cdn.example.test/sample.zip', sha256: 'a'.repeat(64),
    size: 3, publishedAt: '2026-01-01T00:00:00.000Z',
  }
  const plugin: PluginCatalogDocument['plugins'][number] = {
    id: 'sample-plugin',
    name: { 'zh-TW': '範例', 'en-US': 'Sample' },
    description: { 'zh-TW': '測試', 'en-US': 'Test' },
    author: 'Fixture author',
    versions: [pluginVersion],
  }
  const document: PluginCatalogDocument = { schemaVersion: 1, plugins: [plugin] }
  const preferences = {
    onlineCatalogEnabled: true,
    catalogUrl: 'https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json',
    dailyUpdateCheck: false,
  }
  // PluginRegistry 會碰檔案系統與簽章驗證，catalog IPC 只呼叫 list/planInstall，且只讀回斷言用到的欄位。
  const registry = {
    list: () => [{ id: 'sample-plugin', currentVersion: '1.0.0' }],
    planInstall: () => ({ ok: true, value: {
      token: 'fixture-plan', kind: 'update', pluginId: 'sample-plugin', version: '1.2.0',
      signatureFingerprint: undefined, signatureStatus: 'unsigned',
    } }),
  }
  let cache: { url: string; document: PluginCatalogDocument } | null = null
  const opened: string[] = []
  const deps: PluginCatalogIpcDependencies = {
    ipcMain,
    assertPluginPanelSender: event => { if (event !== panelEvent) throw new Error('untrusted panel') },
    getRegistry: () => fakeService<PluginRegistry>(registry),
    getPreferencesStore: () => fakeService<PluginPreferencesStore>({ get: () => preferences }),
    getCatalogCache: () => cache,
    setCatalogCache: value => { cache = value; calls.push('catalog:cache') },
    createCatalogGateway: () => ({
      load: async () => ({ ok: true as const, value: document }),
      download: async () => ({ ok: true as const, value: new Uint8Array([1, 2, 3]) }),
    }),
    buildCatalogItems: (_document, installed): PluginCatalogPanelItem[] => {
      calls.push(`items:${installed.length}`)
      return []
    },
    isPluginCatalogUrl,
    selectLatestVersion: selectLatestCompatiblePluginVersion,
    catalogFingerprintMatches,
    pendingPlanIds: new Map(),
    pendingDeveloperFolders: new Map(),
    issueReportBaseUrl: () => 'https://github.com/example/plugins/issues/new',
    openExternal: async url => { opened.push(url) },
  }
  registerPluginCatalogIpc(deps)
  return { handlers, panelEvent, calls, opened, document, pluginVersion }
}

test('catalog IPC loads through the injected gateway and remembers a validated install plan', async () => {
  const state = fixture()
  const list = state.handlers.get('plugin-catalog-list')!
  const listing = await list(state.panelEvent) as {
    ok: boolean
    value?: PluginCatalogPanelItem[]
  }
  assert.equal(listing.ok, true)
  assert.equal(listing.value?.length, 0)
  assert.deepEqual(state.calls, ['catalog:cache', 'items:1'])

  const install = state.handlers.get('plugin-catalog-install')!
  const result = await install(state.panelEvent, 'sample-plugin', '1.2.0') as {
    ok: boolean
    value?: { source: string; token: string }
  }
  assert.deepEqual(result, { ok: true, value: { token: 'fixture-plan', kind: 'update', pluginId: 'sample-plugin', version: '1.2.0', signatureFingerprint: undefined, signatureStatus: 'unsigned', source: 'catalog' } })
  assert.equal(state.pluginVersion.version, '1.2.0')
})

test('issue report IPC only passes a validated report URL to the injected external opener', async () => {
  const state = fixture()
  const report = state.handlers.get('plugin-report-issue')!
  assert.deepEqual(await report(state.panelEvent, 'sample-plugin'), {
    ok: true,
    value: { opened: true },
  })
  assert.equal(state.opened.length, 1)
  assert.match(state.opened[0]!, /^https:\/\/github\.com\/example\/plugins\/issues\/new\?/)
  assert.deepEqual(await report(state.panelEvent, 'bad id'), { ok: false, error: 'invalid_request' })
  assert.equal(state.opened.length, 1)
})
