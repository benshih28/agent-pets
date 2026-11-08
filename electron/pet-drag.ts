import type { WindowBounds, WorkArea } from './pet-window-mode.ts'

/** Transparent headroom the pet window reserves above the sprite (see agentStore). */
export const PET_WINDOW_HEADROOM_PX = 190
/** How much of the sprite must stay inside the display while dragging. */
export const MIN_VISIBLE_SPRITE_FRACTION = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** The part of the window that actually paints the pet (the lower body). */
export function spriteRect(bounds: WindowBounds, headroom: number = PET_WINDOW_HEADROOM_PX): WindowBounds {
  const top = Math.min(headroom, Math.max(0, bounds.height - 1))
  return { x: bounds.x, y: bounds.y + top, width: bounds.width, height: Math.max(1, bounds.height - top) }
}

/**
 * Keeps a dragged pet reachable: at least 60% of the sprite stays inside the
 * display, and the sprite cannot slide up under the menu bar. The transparent
 * headroom is free to hang off the top of the screen.
 */
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
