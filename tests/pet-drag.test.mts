import assert from 'node:assert/strict'
import test from 'node:test'
import { clampDraggedBounds, spriteRect } from '../electron/pet-drag.ts'

const display = { x: 0, y: 0, width: 1440, height: 900 }
const window = { x: 600, y: 400, width: 260, height: 420 }

test('a pet inside the display is untouched', () => {
  assert.deepEqual(clampDraggedBounds(window, display), window)
})

test('the transparent headroom may hang above the screen but the sprite may not', () => {
  const clamped = clampDraggedBounds({ ...window, y: -400 }, display)
  assert.equal(spriteRect(clamped).y, display.y)
  assert.ok(clamped.y < 0)
})

test('at least 60% of the sprite stays visible at every edge', () => {
  const sprite = spriteRect(window)
  const left = clampDraggedBounds({ ...window, x: -5_000 }, display)
  assert.ok(Math.abs(left.x - -sprite.width * 0.4) <= 1)
  const right = clampDraggedBounds({ ...window, x: 5_000 }, display)
  assert.ok(Math.abs(right.x - (display.width - sprite.width * 0.6)) <= 1)
  const bottom = clampDraggedBounds({ ...window, y: 5_000 }, display)
  assert.ok(spriteRect(bottom).y + spriteRect(bottom).height <= display.height + sprite.height * 0.4 + 1)
})

test('window size is never changed by clamping', () => {
  const clamped = clampDraggedBounds({ ...window, x: -9_999, y: 9_999 }, display)
  assert.equal(clamped.width, window.width)
  assert.equal(clamped.height, window.height)
})
