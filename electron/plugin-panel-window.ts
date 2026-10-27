export interface PluginPanelSize {
  width: number
  height: number
}

export interface PluginPanelWorkArea {
  width: number
  height: number
}

export interface PluginPanelRect {
  x: number
  y: number
  width: number
  height: number
}

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const MIN_HEIGHT = 240
const MAX_HEIGHT = 800
const CHROME_HEADER_MIN_HEIGHT = 48

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampPluginPanelSize(size: PluginPanelSize, workArea: PluginPanelWorkArea): PluginPanelSize {
  const availableWidth = Math.max(1, Math.floor(workArea.width))
  const availableHeight = Math.max(1, Math.floor(workArea.height))
  const minWidth = Math.min(MIN_WIDTH, availableWidth)
  const minHeight = Math.min(MIN_HEIGHT, availableHeight)
  return {
    width: Math.round(Math.max(minWidth, Math.min(MAX_WIDTH, availableWidth, size.width))),
    height: Math.round(Math.max(minHeight, Math.min(MAX_HEIGHT, availableHeight, size.height))),
  }
}

/** Keeps one session's manual window size scoped to its plugin page. */
export class PluginPanelWindowSizer {
  private readonly manualSizes = new Map<string, PluginPanelSize>()
  private baseSize: PluginPanelSize | null = null
  private activeId: string | null = null

  activePluginId(): string | null {
    return this.activeId
  }

  begin(
    pluginId: string,
    currentSize: PluginPanelSize,
    preferredSize: PluginPanelSize | undefined,
    workArea: PluginPanelWorkArea,
  ): PluginPanelSize {
    if (!this.activeId) this.baseSize = clampPluginPanelSize(currentSize, workArea)
    this.activeId = pluginId
    const requested = this.manualSizes.get(pluginId) ?? preferredSize ?? this.baseSize ?? currentSize
    return clampPluginPanelSize(requested, workArea)
  }

  recordManualSize(pluginId: string, size: PluginPanelSize, workArea: PluginPanelWorkArea): boolean {
    if (this.activeId !== pluginId || !finite(size.width) || !finite(size.height)) return false
    this.manualSizes.set(pluginId, clampPluginPanelSize(size, workArea))
    return true
  }

  finish(): PluginPanelSize | null {
    const baseSize = this.baseSize
    this.activeId = null
    this.baseSize = null
    return baseSize
  }
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
