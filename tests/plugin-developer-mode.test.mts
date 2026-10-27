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
    fs.writeFileSync(entry, 'second')
    fs.writeFileSync(entry, 'third')
    await new Promise(resolve => setTimeout(resolve, 500))
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
  fs.symlinkSync(source, linked)
  const watcher = new PluginDeveloperModeWatcher(10)
  try {
    assert.equal(watcher.watch('sample-plugin', linked, () => {}), false)
    assert.equal(watcher.watch('../outside', source, () => {}), false)
  } finally {
    watcher.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
