import assert from 'node:assert/strict'
import test from 'node:test'
import {
  levelUpFromAward,
  normalizeProgressionAwardEvent,
  recentAwardsFromEvent,
} from '../src/utils/progression-events.ts'

const base = {
  petId: 'aang-airbender',
  awards: [{ ruleId: 'v1.session-completed', amount: 20 }, { ruleId: 'v1.first-completion-of-day', amount: 10 }],
  at: 1_700_000_000_000,
  levelBefore: 4,
  levelAfter: 5,
  stageBefore: 'egg',
  stageAfter: 'baby',
}

test('award events are validated before reaching the store', () => {
  assert.deepEqual(normalizeProgressionAwardEvent(base), base)
  assert.equal(normalizeProgressionAwardEvent(null), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, petId: '../x' }), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, awards: [] }), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, awards: [{ ruleId: 'v1.x', amount: -5 }] }), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, awards: [{ ruleId: '<script>', amount: 5 }] }), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, stageAfter: 'god' }), null)
  assert.equal(normalizeProgressionAwardEvent({ ...base, levelAfter: 0 }), null)
})

test('a level-up and its evolution fire exactly once per crossing, never when the level did not rise', () => {
  const up = levelUpFromAward(normalizeProgressionAwardEvent(base)!, 'a')
  assert.deepEqual([up?.fromLevel, up?.toLevel, up?.evolved, up?.toStage], [4, 5, true, 'baby'])
  const same = levelUpFromAward(normalizeProgressionAwardEvent({ ...base, levelBefore: 5, levelAfter: 5, stageBefore: 'baby' })!, 'b')
  assert.equal(same, null)
  const noEvolve = levelUpFromAward(normalizeProgressionAwardEvent({ ...base, levelBefore: 6, levelAfter: 7, stageBefore: 'baby' })!, 'c')
  assert.equal(noEvolve?.evolved, false)
  // Two levels in one event is still a single celebration.
  assert.equal(levelUpFromAward(normalizeProgressionAwardEvent({ ...base, levelBefore: 3, levelAfter: 5 })!, 'd')?.toLevel, 5)
})

test('recent awards get unique ids and keep the rule order', () => {
  const fresh = recentAwardsFromEvent(normalizeProgressionAwardEvent(base)!, 7)
  assert.deepEqual(fresh.map(item => item.ruleId), ['v1.session-completed', 'v1.first-completion-of-day'])
  assert.equal(new Set(fresh.map(item => item.id)).size, 2)
})
