import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const zh: Record<string, string> = JSON.parse(read('src/locales/onboarding/zh-TW.json'))
const en: Record<string, string> = JSON.parse(read('src/locales/onboarding/en-US.json'))

function unionMembers(source: string, typeName: string): string[] {
  const match = new RegExp(`export type ${typeName} =([^;]*?)\\n\\n`, 's').exec(source)
  assert.ok(match, `type ${typeName} not found`)
  return [...match![1]!.matchAll(/'([\w-]+)'/g)].map(entry => entry[1]!)
}

test('every project MCP result code and install error code has text in both locales', () => {
  const mcp = unionMembers(read('src/types/project-mcp.ts'), 'ProjectMcpResultCode')
  for (const code of mcp) {
    assert.ok(zh[`onboarding.mcpCode.${code}`], `zh-TW missing mcpCode.${code}`)
    assert.ok(en[`onboarding.mcpCode.${code}`], `en-US missing mcpCode.${code}`)
  }
  const install = unionMembers(read('src/types/agent-adapter.ts'), 'InstallErrorCode')
  const wizard = read('src/components/SetupWizard.vue')
  for (const code of install) {
    const mapped = new RegExp(`${code}: '(onboarding\\.[\\w.]+)'`).exec(wizard)?.[1]
    assert.ok(mapped, `wizard has no text key for install error ${code}`)
    assert.ok(zh[mapped!] && en[mapped!], `missing locale text ${mapped}`)
  }
})

test('every diagnostic check code emitted by the backend has localized text', () => {
  const wizard = read('src/components/SetupWizard.vue')
  const sources = ['electron/agent-adapter-operations.ts', 'electron/agent-adapter.ts'].map(read).join('\n')
  const ids = new Set([...sources.matchAll(/check\('([\w-]+)',/g)].map(entry => entry[1]!))
  assert.ok(ids.size >= 10)
  for (const id of ids) {
    assert.ok(new RegExp(`'${id}\\.(pass|warn|fail)'`).test(wizard), `wizard does not localize check ${id}`)
  }
  for (const key of wizard.matchAll(/'(onboarding\.(?:check|fix|summary)\.[\w.-]+)'/g)) {
    assert.ok(zh[key[1]!] && en[key[1]!], `missing locale text ${key[1]}`)
  }
})

test('onboarding backend modules contain no natural-language CJK strings', () => {
  const files = [
    ...readdirSync(join(root, 'electron')).filter(name => /^(agent-adapter|project-mcp|install-outcome|node-resolver|hook-config|safe-config-write|git-tracking|onboarding-state|setup)/.test(name)).map(name => `electron/${name}`),
    'electron/ipc/adapters.ts', 'electron/ipc/integrations.ts', 'electron/ipc/onboarding.ts',
  ]
  const offenders: string[] = []
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      if (!/[一-鿿]/.test(line)) return
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\/\/.*[一-鿿]/.test(line)) return
      // The dialog helper deliberately carries both languages.
      if (file.endsWith('ipc/project-mcp.ts')) return
      offenders.push(`${file}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
})
