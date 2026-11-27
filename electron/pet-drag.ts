import { clamp } from '../src/utils/number.ts'
import { QUOTA_TOOLTIP_HEADROOM_H } from '../src/utils/pet-window-size.ts'
import type { WindowBounds, WorkArea } from './pet-window-mode.ts'

export const PET_WINDOW_HEADROOM_PX = QUOTA_TOOLTIP_HEADROOM_H
export const MIN_VISIBLE_SPRITE_FRACTION = 0.6

export function spriteRect(bounds: WindowBounds, headroom: number = PET_WINDOW_HEADROOM_PX): WindowBounds {
  const top = Math.min(headroom, Math.max(0, bounds.height - 1))
  return { x: bounds.x, y: bounds.y + top, width: bounds.width, height: Math.max(1, bounds.height - top) }
}

// The sprite cannot slide up under the menu bar; only the transparent headroom may hang off the top.
export function clampDraggedBounds(
  bounds: WindowBounds,
  workArea: WorkArea,
  headroom: number = PET_WINDOW_HEADROOM_PX,
): WindowBounds {
  const sprite = spriteRect(bounds, headroom)
  const spriteTopOffset = sprite.y - bounds.y
  const hangX = sprite.width * (1 - MIN_VISIBLE_SPRITE_FRACTION)
  const hangY = sprite.height * (1 - MIN_VISIBLE_SPRITE_FRACTION)
  const minX = workArea.x - hangX
  const maxX = workArea.x + workArea.width - sprite.width + hangX
  const minSpriteY = workArea.y
  const maxSpriteY = workArea.y + workArea.height - sprite.height + hangY
  const x = clamp(bounds.x, Math.min(minX, maxX), Math.max(minX, maxX))
  const spriteY = clamp(sprite.y, Math.min(minSpriteY, maxSpriteY), Math.max(minSpriteY, maxSpriteY))
  return {
    x: Math.round(x),
    y: Math.round(spriteY - spriteTopOffset),
    width: bounds.width,
    height: bounds.height,
  }
}
