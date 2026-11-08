import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function generatedPlugin(source: 'opencode-cli' | 'opencode-desktop'): string {
  const setup = readFileSync(new URL('../electron/setup.ts', import.meta.url), 'utf8')
  const functionStart = setup.indexOf('function openCodePluginContent(')
  const templateStart = setup.indexOf('return `', functionStart) + 'return `'.length
  const templateEndMatch = /\r?\n`\r?\n}/.exec(setup.slice(templateStart))
  const templateEnd = templateEndMatch ? templateStart + templateEndMatch.index : -1
  assert.notEqual(functionStart, -1)
  assert.notEqual(templateStart, -1)
  assert.notEqual(templateEnd, -1)
  return setup.slice(templateStart, templateEnd).replace('${source}', source)
}

test('generated OpenCode plugins are valid modules with permission hooks', async () => {
  for (const source of ['opencode-cli', 'opencode-desktop'] as const) {
    const code = generatedPlugin(source)
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    const plugin = await import(moduleUrl)
    const hooks = await plugin.DesktopPetPlugin({
      client: {},
      project: { worktree: 'C:/repo' },
      directory: 'C:/repo',
    })

    assert.equal(typeof hooks.event, 'function')
    assert.equal(typeof hooks['permission.ask'], 'function')
    assert.equal(typeof hooks.dispose, 'function')
    assert.equal(code.includes("path: '/v1/permission/request'"), false)
    assert.equal(code.includes("permissionPost('/v1/permission/request'"), true)
    assert.equal(code.includes('project: projectPath'), true)
    assert.equal(code.includes("'tool.execute.before', projectPath"), true)
    assert.equal(code.includes("reply = decision === 'allow_once' ? 'once' : 'reject'"), true)
    assert.equal(code.includes("'always'"), false)
    // Host hints: a few capped env values, sent with every status event.
    assert.equal(code.includes('host: HOST_HINTS'), true)
    assert.equal(code.includes("shortEnv('TERM_PROGRAM'"), true)
    assert.equal(/process\.env\)|\.\.\.process\.env/.test(code), false)
  }
})
