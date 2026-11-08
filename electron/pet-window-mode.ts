import type { PetEdge, PetWindowMode } from '../src/types/pet-window'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export const MINI_WINDOW_SIZE = 96
export const EDGE_PEEK_PX = 42
export const EDGE_HANDLE_LENGTH_PX = 96
export const EDGE_TRIGGER_DISTANCE_PX = 24
export const EDGE_DWELL_MS = 650

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export function clampWindowBounds(bounds: WindowBounds, workArea: WorkArea): WindowBounds {
  const areaWidth = Math.max(1, Math.round(finiteOr(workArea.width, 1)))
  const areaHeight = Math.max(1, Math.round(finiteOr(workArea.height, 1)))
  const width = clamp(Math.round(finiteOr(bounds.width, MINI_WINDOW_SIZE)), 1, areaWidth)
  const height = clamp(Math.round(finiteOr(bounds.height, MINI_WINDOW_SIZE)), 1, areaHeight)
  const minX = Math.round(finiteOr(workArea.x, 0))
  const minY = Math.round(finiteOr(workArea.y, 0))
  const maxX = minX + areaWidth - width
  const maxY = minY + areaHeight - height
  return {
    x: Math.round(clamp(finiteOr(bounds.x, minX), minX, maxX)),
    y: Math.round(clamp(finiteOr(bounds.y, minY), minY, maxY)),
    width,
    height,
  }
}

export function miniWindowBounds(normalBounds: WindowBounds, workArea: WorkArea): WindowBounds {
  const normal = clampWindowBounds(normalBounds, workArea)
  const width = Math.min(MINI_WINDOW_SIZE, Math.max(1, Math.round(workArea.width)))
  const height = Math.min(MINI_WINDOW_SIZE, Math.max(1, Math.round(workArea.height)))
  return clampWindowBounds({
    x: normal.x + Math.round((normal.width - width) / 2),
    y: normal.y + normal.height - height,
    width,
    height,
  }, workArea)
}

/** The bottom is where the pet naturally stands (on the Dock/taskbar), so it never docks there. */
export const DOCKABLE_EDGES: readonly PetEdge[] = ['left', 'right', 'top']
export const EDGE_HOVER_EXPAND_MS = 200
export const EDGE_REDOCK_AFTER_MS = 1_500

export function nearestEdge(
  bounds: WindowBounds,
  workArea: WorkArea,
  threshold = EDGE_TRIGGER_DISTANCE_PX,
  dockable: readonly PetEdge[] = DOCKABLE_EDGES,
): PetEdge | null {
  const current = clampWindowBounds(bounds, workArea)
  const distances: Array<[PetEdge, number]> = [
    ['left', Math.abs(current.x - workArea.x)],
    ['right', Math.abs((current.x + current.width) - (workArea.x + workArea.width))],
    ['top', Math.abs(current.y - workArea.y)],
    ['bottom', Math.abs((current.y + current.height) - (workArea.y + workArea.height))],
  ]
  const candidates = distances.filter(([edge]) => dockable.includes(edge))
  if (candidates.length === 0) return null
  const [edge, distance] = candidates.reduce((best, candidate) => (
    candidate[1] < best[1] ? candidate : best
  ))
  return distance <= Math.max(0, threshold) ? edge : null
}

export function edgeWindowBounds(
  normalBounds: WindowBounds,
  workArea: WorkArea,
  edge: PetEdge,
  peek = EDGE_PEEK_PX,
): WindowBounds {
  const normal = clampWindowBounds(normalBounds, workArea)
  const thickness = clamp(Math.round(peek), 1, Math.min(workArea.width, workArea.height))
  const length = clamp(EDGE_HANDLE_LENGTH_PX, 1, Math.max(workArea.width, workArea.height))
  const width = edge === 'left' || edge === 'right' ? thickness : Math.min(length, workArea.width)
  const height = edge === 'left' || edge === 'right' ? Math.min(length, workArea.height) : thickness
  const centerX = normal.x + Math.round(normal.width / 2)
  const centerY = normal.y + Math.round(normal.height / 2)
  const next: WindowBounds = {
    x: clamp(centerX - Math.round(width / 2), workArea.x, workArea.x + workArea.width - width),
    y: clamp(centerY - Math.round(height / 2), workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
  if (edge === 'left') next.x = workArea.x
  if (edge === 'right') next.x = workArea.x + workArea.width - width
  if (edge === 'top') next.y = workArea.y
  if (edge === 'bottom') next.y = workArea.y + workArea.height - height
  return next
}

export function isPetWindowMode(value: unknown): value is PetWindowMode {
  return value === 'normal' || value === 'mini' || value === 'edge'
}
