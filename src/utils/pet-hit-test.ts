export const HIT_DILATE_PX = 4
export const ALPHA_THRESHOLD = 16
export const PASSTHROUGH_RESYNC_MS = 1_500

export function hasOpaquePixel(rgba: ArrayLike<number>, threshold: number = ALPHA_THRESHOLD): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] > threshold) return true
  }
  return false
}

export interface PassthroughDecision {
  send: boolean
  next: boolean
}

/** Re-asserts an unchanged value occasionally: main resets mouse-event handling whenever it re-applies window bounds, and the renderer is not told. */
export function decidePassthrough(
  wanted: boolean,
  last: boolean,
  lastSentAt: number,
  now: number,
): PassthroughDecision {
  if (wanted !== last) return { send: true, next: wanted }
  if (now - lastSentAt >= PASSTHROUGH_RESYNC_MS) return { send: true, next: wanted }
  return { send: false, next: last }
}
