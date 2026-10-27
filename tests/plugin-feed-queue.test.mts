import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginFeedItem } from '../src/types/plugin.ts'
import { PluginFeedQueue } from '../electron/plugin-feed-queue.ts'

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x1_0000_0000
  }
}

function item(id: string, priority: 'low' | 'normal'): PluginFeedItem {
  return {
    id,
    pluginId: 'queue-test',
    pluginName: { 'zh-TW': 'Queue', 'en-US': 'Queue' },
    title: id,
    body: 'body',
    priority,
    createdAt: 0,
    expiresAt: 60_000,
  }
}

test('priority-bucket feed queue preserves FIFO order and Map de-duplication across 1,000 seeded cases', () => {
  const random = seededRandom(0x18_03_2026)

  for (let sample = 0; sample < 1_000; sample += 1) {
    const queue = new PluginFeedQueue()
    const reference: PluginFeedItem[] = []
    const idPool = Array.from({ length: 8 }, (_, index) => `item-${sample}-${index}`)
    const steps = 10 + Math.floor(random() * 60)

    for (let step = 0; step < steps; step += 1) {
      const operation = Math.floor(random() * 4)
      if (operation === 0) {
        const id = idPool[Math.floor(random() * idPool.length)]!
        const candidate = item(id, random() < 0.5 ? 'low' : 'normal')
        const expected = !reference.some(entry => entry.id === id)
        if (expected) reference.push(candidate)
        assert.equal(queue.push(candidate), expected, `push ${sample}:${step}`)
      } else if (operation === 1) {
        assert.deepEqual(queue.shift(), reference.shift(), `shift ${sample}:${step}`)
      } else if (operation === 2) {
        const id = idPool[Math.floor(random() * idPool.length)]!
        const index = reference.findIndex(entry => entry.id === id)
        const expected = index >= 0
        if (expected) reference.splice(index, 1)
        assert.equal(queue.remove(id), expected, `remove ${sample}:${step}`)
      } else if (random() < 0.03) {
        queue.clear()
        reference.length = 0
      }

      assert.equal(queue.length, reference.length, `length ${sample}:${step}`)
      assert.deepEqual(queue.peek(), reference[0], `peek ${sample}:${step}`)
      assert.deepEqual(queue.last(), reference.at(-1), `last ${sample}:${step}`)
      assert.deepEqual(queue.values(), reference, `values ${sample}:${step}`)
    }
  }
})
