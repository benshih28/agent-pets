import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgressionChangeGate, createVisibleSender } from '../electron/ipc/progression-broadcast-gate.ts'
import { createLatestValueCoalescer } from '../electron/ipc/broadcast-coalescer.ts'

const snap = (over = {}) => ({ petId: 'a', totalXp: 10, level: 1, xpIntoLevel: 10, xpToNext: 90, evolutionStage: 'baby', currentStreak: 1, longestStreak: 1, updatedAt: 5, ...over }) as any

test('progression gate suppresses identical snapshots and passes changes', () => {
  const gate = createProgressionChangeGate()
  assert.equal(gate.shouldBroadcast(snap()), true)
  gate.record(snap())
  assert.equal(gate.shouldBroadcast(snap()), false)
  assert.equal(gate.shouldBroadcast(snap({ totalXp: 11 })), true)
  assert.equal(gate.shouldBroadcast(snap({ petId: 'b' })), true)
})

test('visible sender skips hidden windows and resyncs once on show', () => {
  const sender = createVisibleSender<any>()
  const win = { visible: false, isDestroyed: () => false, isVisible() { return this.visible } }
  const got: number[] = []
  sender.send(win, () => got.push(1))
  sender.send(win, () => got.push(2))
  assert.deepEqual(got, [])
  win.visible = true
  sender.resync(win, () => got.push(3))
  sender.resync(win, () => got.push(4))
  assert.deepEqual(got, [3])
  sender.send(win, () => got.push(5))
  assert.deepEqual(got, [3, 5])
  const dead = { isDestroyed: () => true, isVisible: () => true }
  sender.send(dead, () => got.push(9))
  assert.deepEqual(got, [3, 5])
})

test('history-updated coalescer emits once per timer window', () => {
  let cb: (() => void) | undefined
  let flushes = 0
  const q = createLatestValueCoalescer<void>(() => { flushes++ }, c => { cb = c })
  for (let i = 0; i < 500; i++) q()
  cb!()
  assert.equal(flushes, 1)
  q(); cb!()
  assert.equal(flushes, 2)
})
