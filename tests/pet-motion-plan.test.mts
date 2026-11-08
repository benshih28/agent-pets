import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ERROR_FAILED_LOOPS,
  SUCCESS_DISPLAY_MS,
  SUCCESS_JUMP_LOOPS,
  SUCCESS_WAVE_LOOPS,
  frameDelayMultiplier,
  idleLoopsFor,
  isSignificantTransition,
  motionPlanFor,
} from '../src/utils/pet-motion-plan.ts'

const base = { urgency: 0 as const, petId: 'aang-airbender', random: () => 0 }

test('error plays the fall twice and then settles into idle instead of freezing', () => {
  const plan = motionPlanFor({ ...base, state: 'error' })
  assert.deepEqual(plan.steps, [
    { motion: 'failed', loops: ERROR_FAILED_LOOPS },
    { motion: 'idle', loops: Number.POSITIVE_INFINITY },
  ])
  assert.equal(plan.repeat, false)
})

test('success celebration fits inside the store display window', () => {
  const plan = motionPlanFor({ ...base, state: 'success' })
  assert.equal(plan.steps[0].loops, SUCCESS_JUMP_LOOPS)
  assert.equal(plan.steps[1].loops, SUCCESS_WAVE_LOOPS)
  assert.ok((SUCCESS_JUMP_LOOPS + SUCCESS_WAVE_LOOPS) * 700 <= SUCCESS_DISPLAY_MS)
})

test('idle gesture timing varies per pet and per call but stays in range', () => {
  assert.notEqual(idleLoopsFor('aaa', () => 0), idleLoopsFor('aab', () => 0))
  const samples = new Set(Array.from({ length: 40 }, () => idleLoopsFor('aang-airbender')))
  assert.ok(samples.size > 1)
  for (const loops of samples) assert.ok(loops >= 8 && loops <= 8 + 3 + 6)
})

test('waiting escalates with urgency and walk/sleep only apply to idle/offline', () => {
  assert.equal(motionPlanFor({ ...base, state: 'waiting-input' }).steps[0].loops, Number.POSITIVE_INFINITY)
  assert.equal(motionPlanFor({ ...base, state: 'waiting-input', urgency: 2 }).steps[1].loops, 8)
  assert.equal(motionPlanFor({ ...base, state: 'idle', behavior: 'walk' }).steps[0].motion, 'walk')
  assert.equal(motionPlanFor({ ...base, state: 'thinking', behavior: 'walk' }).steps[0].motion, 'review')
})

test('only meaningful transitions bounce', () => {
  assert.equal(isSignificantTransition('thinking', 'tool-running'), false)
  assert.equal(isSignificantTransition('tool-running', 'thinking'), false)
  assert.equal(isSignificantTransition('offline', 'idle'), false)
  assert.equal(isSignificantTransition('thinking', 'success'), true)
  assert.equal(isSignificantTransition('thinking', 'error'), true)
  assert.equal(isSignificantTransition('idle', 'waiting-input'), true)
  assert.equal(isSignificantTransition('waiting-permission', 'thinking'), true)
  assert.equal(isSignificantTransition(undefined, 'success'), false)
})

test('offline is not slowed down; sulking is', () => {
  assert.equal(frameDelayMultiplier({ state: 'offline', urgency: 0, sulking: false }), 1.25)
  assert.ok(frameDelayMultiplier({ state: 'error', urgency: 0, sulking: true }) > 1.25)
  assert.equal(frameDelayMultiplier({ state: 'waiting-input', urgency: 2, sulking: false }), 0.6)
})
