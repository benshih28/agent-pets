import assert from 'node:assert/strict'
import test from 'node:test'
import { addAchievement, addLevelUp, batchIsEmpty, emptyBatch, mergeBatches } from '../src/utils/celebration-batch.ts'

test('deferred level-ups merge into a single span and keep the evolution', () => {
  let batch = addLevelUp(emptyBatch(), { fromLevel: 4, toLevel: 5, evolved: true, toStage: 'baby' })
  batch = addLevelUp(batch, { fromLevel: 5, toLevel: 6, evolved: false, toStage: 'baby' })
  assert.deepEqual(batch.level, { from: 4, to: 6, evolvedTo: 'baby' })
  assert.equal(batchIsEmpty(batch), false)
  assert.equal(batchIsEmpty(emptyBatch()), true)
})

test('achievements dedupe by id and merge across batches', () => {
  const a = { id: 'hello_world', titleKey: 't', descriptionKey: 'd', visualReward: 'sparkle' as const }
  let batch = addAchievement(addAchievement(emptyBatch(), a), a)
  assert.equal(batch.achievements.length, 1)
  const other = addAchievement(emptyBatch(), { ...a, id: 'level_10', visualReward: 'badge' })
  batch = mergeBatches(batch, other)
  assert.deepEqual(batch.achievements.map(item => item.id), ['hello_world', 'level_10'])
})
