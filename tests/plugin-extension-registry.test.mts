import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createAgentAdapterRegistry, isAgentAdapterId } from '../electron/agent-adapter.ts'
import { AGENT_ADAPTER_REGISTRY } from '../src/types/agent-adapter.ts'
import { IPC_ERROR_CODES } from '../src/types/ipc.ts'
import { PLUGIN_CONTRIBUTION_REGISTRY, PLUGIN_ERROR_CODES } from '../src/types/plugin.ts'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8')
}

function tableCodes(markdown: string, heading: string): string[] {
  const section = markdown.split(`${heading}\n`)[1]?.split('\n## ')[0] ?? ''
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(match => match[1]!)
}

test('adapter ids and public metadata are driven by the shared registry', async () => {
  const expected = AGENT_ADAPTER_REGISTRY.map(definition => definition.id)
  assert.equal(new Set(expected).size, expected.length)
  assert.deepEqual((await createAgentAdapterRegistry().listStatuses()).map(status => status.id), expected)
  for (const id of expected) assert.equal(isAgentAdapterId(id), true)
  assert.equal(isAgentAdapterId('unregistered-adapter'), false)
  assert.match(read('src/types/agent-adapter.ts'), /AgentAdapterId = typeof AGENT_ADAPTER_REGISTRY\[number\]\['id'\]/)
  assert.match(read('electron/agent-adapter.ts'), /AGENT_ADAPTER_REGISTRY\.map\(definition => createAdapter/)
  assert.match(read('electron/ipc/adapters.ts'), /AdapterDiagnoseIpcResult/)
  assert.match(read('electron/preload.ts'), /AdapterDiagnoseIpcResult/)
  assert.match(read('src/types/electron-api.ts'), /AdapterDiagnoseIpcResult/)
})

test('plugin contribution registry matches manifest schema, public types, implementation files and docs', () => {
  const ids = Object.keys(PLUGIN_CONTRIBUTION_REGISTRY)
  const schema = JSON.parse(read('docs/plugins/plugin.schema.json')) as {
    properties: { contributes: { properties: Record<string, unknown> } }
  }
  assert.deepEqual(Object.keys(schema.properties.contributes.properties).sort(), [...ids].sort())

  const declaration = read('docs/plugins/agent-pets-plugin.d.ts')
  const contributionType = declaration.match(/export interface PluginContributions \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const declaredIds = [...contributionType.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*)\?:/gm)].map(match => match[1]!)
  assert.deepEqual(declaredIds.sort(), [...ids].sort())

  const english = read('docs/plugins/contribution-points.md')
  const chinese = read('docs/plugins/contribution-points.zh-TW.md')
  const apiEnglish = read('docs/plugins/api-reference.md')
  const apiChinese = read('docs/plugins/api-reference.zh-TW.md')
  for (const [id, definition] of Object.entries(PLUGIN_CONTRIBUTION_REGISTRY)) {
    assert.ok(existsSync(path.resolve(definition.implementationFile)), `${id} implementation file exists`)
    assert.ok(english.includes('| `' + id + '` |'), `${id} appears in English contribution docs`)
    assert.ok(chinese.includes('| `' + id + '` |'), `${id} appears in Chinese contribution docs`)
    assert.match(read('electron/plugin-manifest.ts'), /Object\.keys\(PLUGIN_CONTRIBUTION_REGISTRY\)/)
    if (definition.hostApi) {
      assert.ok(apiEnglish.includes(`\`${definition.hostApi}(`), `${definition.hostApi} appears in English API docs`)
      assert.ok(apiChinese.includes(`\`${definition.hostApi}(`), `${definition.hostApi} appears in Chinese API docs`)
    }
  }
})

test('plugin contribution and error registries match their public docs', () => {
  const english = read('docs/security/ipc-error-codes.md')
  const chinese = read('docs/security/ipc-error-codes.zh-TW.md')
  assert.deepEqual(tableCodes(english, '## Plugin Host API error codes'), [...PLUGIN_ERROR_CODES])
  assert.deepEqual(tableCodes(chinese, '## 插件 Host API 錯誤碼'), [...PLUGIN_ERROR_CODES])
  assert.deepEqual(tableCodes(english, '## IPC result error codes'), [...IPC_ERROR_CODES])
  assert.deepEqual(tableCodes(chinese, '## IPC 結果錯誤碼'), [...IPC_ERROR_CODES])
  assert.equal(new Set(IPC_ERROR_CODES).size, IPC_ERROR_CODES.length)

  const ipcFiles = readdirSync(path.resolve('electron/ipc')).filter(file => file.endsWith('.ts'))
  const ipcErrorLiterals = new Set<string>()
  for (const file of ipcFiles) {
    for (const match of readFileSync(path.resolve('electron/ipc', file), 'utf8').matchAll(/error:\s*'([a-z][a-z0-9_]*)'/g)) {
      ipcErrorLiterals.add(match[1]!)
    }
  }
  const ipcErrorCodeSet: ReadonlySet<string> = new Set(IPC_ERROR_CODES)
  for (const code of ipcErrorLiterals) assert.ok(ipcErrorCodeSet.has(code), `${code} is registered and documented`)

  const publicTypes = read('docs/plugins/agent-pets-plugin.d.ts')
  const errorType = publicTypes.match(/export type PluginErrorCode =([\s\S]*?)\n\nexport interface PluginCodedError/)?.[1] ?? ''
  const declaredCodes = [...errorType.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(match => match[1]!)
  assert.deepEqual(declaredCodes.sort(), [...PLUGIN_ERROR_CODES].sort())
})

test('remaining production double assertions document narrow external API seams', () => {
  const runtimeLines = read('electron/main/runtime.ts').split('\n')
  const castOccurrences = runtimeLines.flatMap((line, index) =>
    [...line.matchAll(/as unknown as|as PluginPanelViewSession/g)].map(() => index))
  assert.equal(castOccurrences.length, 6)
  for (const index of castOccurrences) {
    const explanation = runtimeLines.slice(Math.max(0, index - 4), index).join(' ')
    assert.match(explanation, /Node's bundled declarations|structural test seam|structural controller seam|Electron's concrete Session/)
  }
})

test('Electron preload and renderer use one shared API type contract', () => {
  const env = read('src/env.d.ts')
  const preload = read('electron/preload.ts')
  const shared = read('src/types/electron-api.ts')
  assert.match(env, /electronAPI\?: ElectronAPI/)
  assert.match(env, /@\/types\/electron-api/)
  assert.match(preload, /const electronAPI: ElectronAPI = \{/)
  assert.match(shared, /export interface ElectronAPI \{/)
  assert.equal((env.match(/electronAPI\?: \{/g) ?? []).length, 0)
})
