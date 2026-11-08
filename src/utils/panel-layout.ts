// Panel window geometry shared by the renderer (which requests a size) and the
// main process (which places the window). Kept free of Electron/Vue imports so
// both sides and the unit tests can load it.

export interface PanelSize { width: number; height: number }
export interface PanelRect extends PanelSize { x: number; y: number }

export const PANEL_WIDTH = 460
// The user can drag the panel from this minimum up to the display's work area
// (minus the gap), so there is no fixed upper bound any more.
export const PANEL_MIN_WIDTH = 360
export const PANEL_MIN_HEIGHT = 420
export const PANEL_GAP = 6

export type PanelSizeKey = 'sessions' | 'settings' | 'wizard' | 'mcp'

// First-run defaults. Once the user resizes the panel their size wins for every
// route (dashboard, Settings, plugin tabs); only the wizard / MCP pages ask for
// a larger minimum, and never shrink a bigger user size.
// The dashboard and Settings share one size on purpose: switching between them
// must not resize or move the window (the old 560 -> 720 jump read as jitter).
export const PANEL_HEIGHT = 720
export const PANEL_SIZES: Record<PanelSizeKey, PanelSize> = {
  sessions: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
  settings: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
  wizard: { width: 680, height: 520 },
  mcp: { width: 720, height: 560 },
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// The biggest panel the work area can hold while keeping a gap on every side.
export function panelMaxSize(workArea: PanelSize, gap = PANEL_GAP): PanelSize {
  return {
    width: Math.max(1, Math.floor(workArea.width - gap * 2)),
    height: Math.max(1, Math.floor(workArea.height - gap * 2)),
  }
}

// The smallest panel allowed on this display; never larger than the display allows.
export function panelMinSize(workArea: PanelSize, gap = PANEL_GAP): PanelSize {
  const max = panelMaxSize(workArea, gap)
  return { width: Math.min(PANEL_MIN_WIDTH, max.width), height: Math.min(PANEL_MIN_HEIGHT, max.height) }
}

// Any requested size, forced into [minimum, work area - gap]. Tiny work areas win
// over the minimum so the panel can never be bigger than the screen.
export function clampPanelSize(size: PanelSize, workArea: PanelSize, gap = PANEL_GAP): PanelSize {
  const min = panelMinSize(workArea, gap)
  const max = panelMaxSize(workArea, gap)
  const width = Number.isFinite(size.width) ? size.width : PANEL_WIDTH
  const height = Number.isFinite(size.height) ? size.height : PANEL_HEIGHT
  return {
    width: Math.round(clampNumber(width, min.width, max.width)),
    height: Math.round(clampNumber(height, min.height, max.height)),
  }
}

export function fitPanelHeight(height: number, workAreaHeight: number, gap = PANEL_GAP): number {
  return clampPanelSize({ width: PANEL_WIDTH, height }, { width: PANEL_WIDTH + gap * 2, height: workAreaHeight }, gap).height
}

// What the window should measure right now: the user's size (or the first-run
// default) with an optional transient minimum from a wizard / MCP page. The
// route itself never changes this, so view switches cannot resize the window.
export function effectivePanelSize(user: PanelSize | null, minimum: PanelSize | null): PanelSize {
  const base = user ?? PANEL_SIZES.sessions
  if (!minimum) return { ...base }
  return { width: Math.max(base.width, minimum.width), height: Math.max(base.height, minimum.height) }
}

// Slides a window rect back inside the work area (used after a user resize).
export function clampRectToWorkArea(rect: PanelRect, workArea: PanelRect): PanelRect {
  const size = clampPanelSize(rect, workArea, 0)
  return {
    ...size,
    x: Math.round(clampNumber(rect.x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - size.width))),
    y: Math.round(clampNumber(rect.y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - size.height))),
  }
}

// Persisted user size: a single value, validated before it is trusted.
export const PANEL_USER_SIZE_VERSION = 1
const USER_SIZE_MIN = 100
const USER_SIZE_MAX = 20_000

function validUserDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= USER_SIZE_MIN && value <= USER_SIZE_MAX
}

export function parsePanelUserSize(raw: unknown): PanelSize | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  if (data.version !== PANEL_USER_SIZE_VERSION || !validUserDimension(data.width) || !validUserDimension(data.height)) return null
  return { width: Math.round(data.width), height: Math.round(data.height) }
}

export function serializePanelUserSize(size: PanelSize): { version: number; width: number; height: number } {
  return { version: PANEL_USER_SIZE_VERSION, width: Math.round(size.width), height: Math.round(size.height) }
}
interface PlacementInput {
  petBounds: PanelRect
  petContentHeight: number | null
  petHeadroom: number
  workArea: PanelRect
  width: number
  height: number
  gap?: number
}

// Anchors the panel to the visible pet sprite, preferring above and falling
// back to below, and guarantees the result lies fully inside the work area.
export function computePanelPlacement(input: PlacementInput): PanelRect {
  const gap = input.gap ?? PANEL_GAP
  const { petBounds, workArea } = input
  const { width, height } = clampPanelSize(input, workArea, gap)
  const visibleHeight = input.petContentHeight !== null
    ? clampNumber(input.petContentHeight, 40, petBounds.height)
    : petBounds.height - input.petHeadroom
  const visibleTop = petBounds.y + petBounds.height - visibleHeight
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
  const aboveY = visibleTop - height - gap
  const belowY = visibleTop + visibleHeight + gap
  let y = aboveY
  if (aboveY < workArea.y && belowY + height <= workArea.y + workArea.height) y = belowY
  const x = clampNumber(petBounds.x + Math.round(petBounds.width / 2) - Math.round(width / 2), workArea.x, maxX)
  return { x, y: clampNumber(y, workArea.y, maxY), width, height }
}

// Delay before a blurred panel hides; long enough for the pet-click toggle IPC
// to arrive first and for the Win32 fullscreen detector to classify the blur.
export const PANEL_BLUR_HIDE_DELAY_MS = 100

export interface PanelBlurState {
  dialogOpen: boolean
  petFocused: boolean
  pinned: boolean
  modalOpen: boolean
}

// Hide-on-blur is only for a genuine click-away: not while a native dialog is
// open, while the pet was just clicked (the toggle owns that case), while the
// user pinned the panel, or while a wizard / confirmation is in progress.
export function shouldHidePanelOnBlur(state: PanelBlurState): boolean {
  return !state.dialogOpen && !state.petFocused && !state.pinned && !state.modalOpen
}
