export interface PluginPanelSize {
  width: number
  height: number
}

export const USER_PANEL_RESIZE_WINDOW_MS = 600
// setBounds may emit several 'resize' events; all of them within this window are ours.
export const PROGRAMMATIC_PANEL_RESIZE_WINDOW_MS = 500

export interface UserPanelResizeInput {
  visible: boolean
  now: number
  supportsWillResize: boolean
  lastUserResizeAt: number
  programmaticUntil: number
}

// Programmatic resizes must never be persisted, however many 'resize' events one setBounds produces.
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

const CHROME_HEADER_MIN_HEIGHT = 48

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

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

export function pluginPanelViewInsets(content: PluginPanelRect, viewport: PluginPanelSize): PluginPanelInsets {
  return {
    left: content.x,
    top: content.y,
    right: Math.max(0, Math.round(viewport.width - content.x - content.width)),
    bottom: Math.max(0, Math.round(viewport.height - content.y - content.height)),
  }
}

// 縮小視窗時 renderer 的量測會落後一個 frame，所以用主行程當下的視窗尺寸套用邊距，不比對絕對座標。
export function layoutPluginPanelView(insets: PluginPanelInsets, windowSize: PluginPanelSize): PluginPanelRect | null {
  const width = Math.round(windowSize.width - insets.left - insets.right)
  const height = Math.round(windowSize.height - insets.top - insets.bottom)
  if (!finite(width) || !finite(height) || width < 1 || height < 1) return null
  return { x: insets.left, y: insets.top, width, height }
}
