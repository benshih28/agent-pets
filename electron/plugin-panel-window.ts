export interface PluginPanelSize {
  width: number
  height: number
}

/** A user drag keeps its flag alive this long after the last 'will-resize'. */
export const USER_PANEL_RESIZE_WINDOW_MS = 600
/** setBounds may emit several 'resize' events; all of them within this window are ours. */
export const PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS = 500

export interface UserPanelResizeInput {
  visible: boolean
  now: number
  /** Platforms with 'will-resize' (macOS, Windows) only emit it for manual resizes. */
  supportsWillResize: boolean
  lastUserResizeAt: number
  programmaticUntil: number
}

/**
 * Decides whether a 'resize' event is the user's size. Programmatic resizes
 * (wizard minimum, view switch) must never be persisted, no matter how many
 * resize events one setBounds produces or whether the min-size clamp changes it.
 */
export function shouldRecordUserPanelSize(input: UserPanelResizeInput): boolean {
  if (!input.visible) return false
  if (input.supportsWillResize) return input.now - input.lastUserResizeAt <= USER_PANEL_RESIZE_WINDOW_MS
  return input.now >= input.programmaticUntil
}

export interface PluginPanelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PluginPanelInsets {
  left: number
  top: number
  right: number
  bottom: number
}

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const MIN_HEIGHT = 240
const MAX_HEIGHT = 800
const CHROME_HEADER_MIN_HEIGHT = 48

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Verifies the native child view stays inside the host-drawn frame and below its header. */
export function validatePluginPanelViewBounds(
  frame: PluginPanelRect,
  content: PluginPanelRect,
  windowSize: PluginPanelSize,
): PluginPanelRect | null {
  if (![frame.x, frame.y, frame.width, frame.height, content.x, content.y, content.width, content.height,
    windowSize.width, windowSize.height].every(finite)) return null
  if (frame.width < 1 || frame.height < CHROME_HEADER_MIN_HEIGHT || content.width < 1 || content.height < 1) return null
  const frameRight = frame.x + frame.width
  const frameBottom = frame.y + frame.height
  const contentRight = content.x + content.width
  const contentBottom = content.y + content.height
  if (frame.x < 0 || frame.y < 0 || frameRight > windowSize.width || frameBottom > windowSize.height) return null
  if (content.x < frame.x || content.y < frame.y + CHROME_HEADER_MIN_HEIGHT
    || contentRight > frameRight || contentBottom > frameBottom) return null
  return {
    x: Math.round(content.x),
    y: Math.round(content.y),
    width: Math.round(content.width),
    height: Math.round(content.height),
  }
}

/** Converts content bounds into edge insets measured against the renderer's own viewport. */
export function pluginPanelViewInsets(content: PluginPanelRect, viewport: PluginPanelSize): PluginPanelInsets {
  return {
    left: content.x,
    top: content.y,
    right: Math.max(0, Math.round(viewport.width - content.x - content.width)),
    bottom: Math.max(0, Math.round(viewport.height - content.y - content.height)),
  }
}

/**
 * 以主行程當下的視窗尺寸套用邊距，而非沿用 renderer 回報的絕對座標：
 * 縮小視窗時 renderer 的量測會落後一個 frame，直接比對絕對座標會誤判越界。
 */
export function layoutPluginPanelView(insets: PluginPanelInsets, windowSize: PluginPanelSize): PluginPanelRect | null {
  const width = Math.round(windowSize.width - insets.left - insets.right)
  const height = Math.round(windowSize.height - insets.top - insets.bottom)
  if (!finite(width) || !finite(height) || width < 1 || height < 1) return null
  return { x: insets.left, y: insets.top, width, height }
}
