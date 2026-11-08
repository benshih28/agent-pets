import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { PluginDeveloperModeWatcher } from '../electron/plugin-developer-mode.ts'

test('developer folder watcher coalesces edits and closes its subscriptions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-watch-'))
  const source = path.join(directory, 'plugin')
  fs.mkdirSync(path.join(source, 'dist'), { recursive: true })
  const entry = path.join(source, 'dist', 'main.js')
  fs.writeFileSync(entry, 'first')
  const watcher = new PluginDeveloperModeWatcher(200)
  try {
    let reloads = 0
    assert.equal(watcher.watch('sample-plugin', source, () => { reloads += 1 }), true)
    // fs.watch delivery latency varies by platform and load (macOS FSEvents can
    // batch for several hundred ms), so wait for the first reload instead of
    // sleeping a fixed time, then confirm the burst produced exactly one reload.
    await new Promise(resolve => setTimeout(resolve, 50))
    fs.writeFileSync(entry, 'second')
    fs.writeFileSync(entry, 'third')
    const deadline = Date.now() + 5_000
    while (reloads === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal(reloads, 1)
    assert.equal(watcher.isWatching('sample-plugin', source), true)
    watcher.unwatch('sample-plugin')
    assert.equal(watcher.isWatching('sample-plugin'), false)
  } finally {
    watcher.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('developer folder watcher rejects a symlink root and invalid plugin id', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-watch-'))
  const source = path.join(directory, 'plugin')
  const linked = path.join(directory, 'linked')
  fs.mkdirSync(source)
  // junction 不需要 Windows 開發者模式，在其他平台會被忽略而建立一般目錄 symlink。
  fs.symlinkSync(source, linked, 'junction')
  const watcher = new PluginDeveloperModeWatcher(10)
  try {
    assert.equal(watcher.watch('sample-plugin', linked, () => {}), false)
    assert.equal(watcher.watch('../outside', source, () => {}), false)
  } finally {
    watcher.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('developer reload failures are reported and no timer outlives destroy()', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-watch-'))
  const source = path.join(directory, 'plugin')
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(source, 'a.js'), 'w')
  const errors: string[] = []
  const watcher = new PluginDeveloperModeWatcher(20, pluginId => errors.push(pluginId))
  try {
    assert.equal(watcher.watch('sample-plugin', source, async () => { throw new Error('reload failed') }), true)
    // fs.watch start-up latency varies by platform; keep touching the file until the watcher reports.
    for (let attempt = 0; attempt < 40 && errors.length === 0; attempt += 1) {
      fs.writeFileSync(path.join(source, 'a.js'), `x${attempt}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(errors.length >= 1 && errors.every(id => id === 'sample-plugin'))
    const seen = errors.length
    fs.writeFileSync(path.join(source, 'a.js'), 'y')
    watcher.destroy()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(errors.length, seen)
  } finally {
    watcher.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
