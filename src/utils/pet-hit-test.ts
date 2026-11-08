// Click-through decisions for the transparent pet window.

/** Canvas-pixel radius around the cursor that still counts as "on the pet". */
export const HIT_DILATE_PX = 4
export const ALPHA_THRESHOLD = 16
/** An unchanged passthrough value is re-sent after this long, in case main reset it. */
export const PASSTHROUGH_RESYNC_MS = 1_500

/** True when any pixel in an RGBA block is opaque enough to catch a click. */
export function hasOpaquePixel(rgba: ArrayLike<number>, threshold: number = ALPHA_THRESHOLD): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] > threshold) return true
  }
  return false
}

export interface PassthroughDecision {
  /** Whether an IPC message should be sent now. */
  send: boolean
  /** The value to remember as the last one sent. */
  next: boolean
}

/**
 * Sends on every change, and re-asserts an unchanged value occasionally: the
 * main process resets mouse-event handling whenever it re-applies window
 * bounds, and the renderer is not told.
 */
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
