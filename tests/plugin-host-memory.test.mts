import assert from 'node:assert/strict'
import test from 'node:test'
import { PLUGIN_HOST_MEMORY_STRIKES, PluginHostMemoryMonitor, pluginHostMemoryMb } from '../electron/plugin-host-memory.ts'

test('plugin host memory prefers private bytes and falls back to the working set', () => {
  assert.equal(pluginHostMemoryMb({ workingSetSize: 96 * 1024, privateBytes: 30 * 1024 }), 30)
  assert.equal(pluginHostMemoryMb({ workingSetSize: 96 * 1024 }), 96)
  assert.equal(pluginHostMemoryMb({ workingSetSize: Number.NaN }), null)
  assert.equal(pluginHostMemoryMb({ workingSetSize: -1 }), null)
  assert.equal(pluginHostMemoryMb(undefined), null)
})

test('plugin host memory monitor only counts growth over the host baseline', () => {
  const monitor = new PluginHostMemoryMonitor()
  monitor.setBaseline(90)
  // Windows 實測：working set 空載就超過舊的 64 MB 預算，但相對基準只增長幾 MB。
  for (let index = 0; index < 5; index += 1) assert.equal(monitor.isOverBudget(103, 64), false)
  assert.equal(monitor.isOverBudget(154, 64), false, 'growth equal to the budget is allowed')
})

test('plugin host memory monitor requires consecutive over-budget samples', () => {
  const monitor = new PluginHostMemoryMonitor()
  monitor.setBaseline(30)
  assert.equal(PLUGIN_HOST_MEMORY_STRIKES, 2)
  assert.equal(monitor.isOverBudget(200, 64), false, 'a single spike is tolerated')
  assert.equal(monitor.isOverBudget(40, 64), false, 'a healthy sample clears the strike')
  assert.equal(monitor.isOverBudget(200, 64), false)
  assert.equal(monitor.isOverBudget(200, 64), true)
})

test('plugin host memory monitor skips checks without a budget or a reading', () => {
  const monitor = new PluginHostMemoryMonitor()
  monitor.setBaseline(30)
  assert.equal(monitor.isOverBudget(500, 0), false)
  assert.equal(monitor.isOverBudget(500, Number.NaN), false)
  assert.equal(monitor.isOverBudget(null, 64), false)
  assert.equal(monitor.isOverBudget(500, 64), false)
  assert.equal(monitor.isOverBudget(500, 64), true)
})

test('plugin host memory monitor falls back to the first reading and resets per host', () => {
  const monitor = new PluginHostMemoryMonitor()
  monitor.setBaseline(null)
  assert.equal(monitor.isOverBudget(120, 16), false, 'first reading becomes the baseline')
  assert.equal(monitor.isOverBudget(130, 16), false)
  assert.equal(monitor.isOverBudget(140, 16), false)
  assert.equal(monitor.isOverBudget(140, 16), true)

  monitor.reset()
  assert.equal(monitor.isOverBudget(140, 16), false, 'a new host starts without strikes or baseline')
  monitor.setBaseline(10)
  assert.equal(monitor.isOverBudget(140, 16), false, 'setting a baseline clears pending strikes')
})
