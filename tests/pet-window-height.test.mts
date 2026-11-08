import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PET_BASE_H,
  QUOTA_TOOLTIP_HEADROOM_H,
  STATUS_LINE_EXTRA_H,
  petWindowHeight,
} from '../src/utils/pet-window-height.ts'

test('single pet: each extra status line adds one thin row, scaled with the sprite part', () => {
  assert.equal(petWindowHeight(0, false, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight(1, false, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight(3, false, 1), PET_BASE_H + 2 * STATUS_LINE_EXTRA_H + QUOTA_TOOLTIP_HEADROOM_H)
  // The tooltip headroom keeps its size whatever the pet size.
  assert.equal(petWindowHeight(1, false, 0.5), Math.round(PET_BASE_H * 0.5) + QUOTA_TOOLTIP_HEADROOM_H)
})

test('multi pet: pills share one row, so the line count adds nothing', () => {
  assert.equal(petWindowHeight(2, true, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight(3, true, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
})
