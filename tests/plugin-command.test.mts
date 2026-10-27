import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginCommandController } from '../electron/plugin-commands.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'

function setup() {
  let now = 1_000
  let dispatchCount = 0
  let enabled = true
  let pluginsEnabled = true
  const controller = new PluginCommandController({
    getContext: id => id === 'safe-plugin' ? { enabled, pluginsEnabled, commandIds: ['start'] } : null,
    dispatch: () => { dispatchCount += 1; return true },
    now: () => now,
  })
  return { controller, calls: () => dispatchCount, setNow: (value: number) => { now = value }, setEnabled: (value: boolean) => { enabled = value }, setGlobal: (value: boolean) => { pluginsEnabled = value } }
}

test('plugin commands require a valid declared command and enabled plugin', () => {
  const h = setup()
  const undeclared = h.controller.invoke('safe-plugin', 'missing')
  const unknown = h.controller.invoke('unknown-plugin', 'start')
  const malformed = h.controller.invoke('../plugin', 'start')
  assert.equal(undeclared.ok ? '' : undeclared.error, 'not_permitted')
  assert.equal(unknown.ok ? '' : unknown.error, 'disabled')
  assert.equal(malformed.ok ? '' : malformed.error, 'invalid_request')
  h.setEnabled(false)
  const disabled = h.controller.invoke('safe-plugin', 'start')
  assert.equal(disabled.ok ? '' : disabled.error, 'disabled')
  h.setEnabled(true)
  h.setGlobal(false)
  const globallyDisabled = h.controller.invoke('safe-plugin', 'start')
  assert.equal(globallyDisabled.ok ? '' : globallyDisabled.error, 'disabled')
  assert.equal(h.calls(), 0)
})

test('plugin commands dispatch only through user-gated controller and rate-limit per command', () => {
  const h = setup()
  assert.deepEqual(h.controller.invoke('safe-plugin', 'start'), { ok: true, value: { accepted: true } })
  const limited = h.controller.invoke('safe-plugin', 'start')
  assert.equal(limited.ok ? '' : limited.error, 'rate_limited')
  h.setNow(2_000)
  assert.equal(h.controller.invoke('safe-plugin', 'start').ok, true)
  assert.equal(h.calls(), 2)
})

test('a declared command returns host_unavailable when its worker is not ready', () => {
  const controller = new PluginCommandController({
    getContext: () => ({ enabled: true, pluginsEnabled: true, commandIds: ['start'] }),
    dispatch: () => false,
    now: () => 5_000,
  })
  const unavailable = controller.invoke('safe-plugin', 'start')
  assert.equal(unavailable.ok ? '' : unavailable.error, 'host_unavailable')
})


test('worker command API only subscribes to host-delivered user commands', () => {
  const worker = pluginHostAssets['worker-bootstrap.js']
  const host = pluginHostAssets['host.js']
  assert.match(worker, /commands: Object\.freeze\([\s\S]*?onInvoke:/)
  assert.match(worker, /command-invoke[\s\S]*?commandListeners/)
  assert.match(host, /invoke-command[\s\S]*?command-invoke/)
  assert.doesNotMatch(worker, /rpc\(['"]commands\.invoke/)
})
