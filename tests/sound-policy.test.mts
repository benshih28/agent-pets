import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldPlayCue } from '../src/utils/sound-policy.ts'

const gate = { soundEnabled: true, dndEnabled: false, soundOnPermission: true, soundOnError: true, soundOnSuccess: true, petVisible: true }

test('cues play only when every gate is open', () => {
  assert.equal(shouldPlayCue('success', gate), true)
  assert.equal(shouldPlayCue('success', { ...gate, soundEnabled: false }), false)
  assert.equal(shouldPlayCue('error', { ...gate, dndEnabled: true }), false)
  assert.equal(shouldPlayCue('error', { ...gate, petVisible: false }), false)
})

test('each cue honours its own switch', () => {
  assert.equal(shouldPlayCue('success', { ...gate, soundOnSuccess: false }), false)
  assert.equal(shouldPlayCue('waiting-permission', { ...gate, soundOnSuccess: false }), true)
  assert.equal(shouldPlayCue('waiting-permission', { ...gate, soundOnPermission: false }), false)
  assert.equal(shouldPlayCue('error', { ...gate, soundOnError: false }), false)
})
