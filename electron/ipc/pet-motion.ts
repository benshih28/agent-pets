import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import type { DesktopPreferences } from '../../src/types/desktop'
import type { PetWindowMode } from '../../src/types/pet-window'
import type { WindowBounds } from '../pet-window-mode'
import { clampDraggedBounds, spriteRect } from '../pet-drag.ts'
import { IPC_CHANNELS } from './channels.ts'

type CursorPoint = { x: number; y: number }
type WorkArea = { x: number; y: number; width: number; height: number }

export interface PetMotionIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>
  getPetWindow(): BrowserWindow | null
  isTrustedIpcSender(event: IpcMainEvent, requiredWindow?: BrowserWindow | null): boolean
  clearEdgeDwell(): void
  clearShimejiPersist(): void
  getDragPollHandle(): ReturnType<typeof setInterval> | null
  setDragPollHandle(handle: ReturnType<typeof setInterval> | null): void
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
  getCursorScreenPoint(): CursorPoint
  getPetWindowMode(): PetWindowMode
  applyNormalPetBounds(): void
  setEdgeRestoreBounds(bounds: WindowBounds | null): void
  setAnchorBottomCenter(anchor: CursorPoint | null): void
  getPanelWindow(): BrowserWindow | null
  persistCurrentPetWindowState(): void
  scheduleEdgeDwell(): void
  getDesktopPreferences(): DesktopPreferences
  hasActivePermissionRequests(): boolean
  currentPowerSaveState(): boolean
  displayForBounds(bounds: WindowBounds): { id: number; workArea: WorkArea }
  clampWindowBounds(bounds: WindowBounds, workArea: WorkArea): WindowBounds
  setNormalPetBounds(bounds: WindowBounds | null): void
  scheduleShimejiPositionPersist(): void
  /** Optional: when present the panel follows the pet during a drag instead of hiding. */
  repositionVisiblePanel?(): void
  /** Optional: re-dock to the edge once the cursor stays away after a hover expand. */
  scheduleEdgeRedock?(): void
  /** Glide walk steps over a short tween instead of jumping. */
  smoothWalk?: boolean
}

const WALK_TWEEN_MS = 700

const DRAG_POLL_MS = 16
const PANEL_FOLLOW_MS = 60

export function registerPetMotionIpc(deps: PetMotionIpcDependencies): void {
  let walkTween: ReturnType<typeof setInterval> | null = null
  const stopWalkTween = () => {
    if (walkTween) deps.clearInterval(walkTween)
    walkTween = null
  }

  deps.ipcMain.on(IPC_CHANNELS.petDragStart, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    stopWalkTween()
    deps.clearEdgeDwell()
    deps.clearShimejiPersist()
    if (deps.getPetWindowMode() !== 'normal') deps.applyNormalPetBounds()
    deps.setEdgeRestoreBounds(null)
    const previousHandle = deps.getDragPollHandle()
    if (previousHandle) deps.clearInterval(previousHandle)
    const startCursor = deps.getCursorScreenPoint()
    const [startX, startY] = petWindow.getPosition()
    // Fixed for the whole drag: setPosition can grow a window on mixed-DPI
    // setups, setBounds with the original size cannot.
    const [startWidth, startHeight] = petWindow.getSize()
    let lastAppliedX = startX
    let lastAppliedY = startY
    let lastPanelFollowAt = 0
    deps.setAnchorBottomCenter(null)
    // The panel is anchored to the pet, so it follows the drag when it can;
    // otherwise it is hidden rather than left stranded.
    if (!deps.repositionVisiblePanel) deps.getPanelWindow()?.hide()

    const dragPollHandle = deps.setInterval(() => {
      const currentPetWindow = deps.getPetWindow()
      if (!currentPetWindow) {
        const handle = deps.getDragPollHandle()
        if (handle) deps.clearInterval(handle)
        deps.setDragPollHandle(null)
        return
      }
      const cursor = deps.getCursorScreenPoint()
      const desired = {
        x: startX + (cursor.x - startCursor.x),
        y: startY + (cursor.y - startCursor.y),
        width: startWidth,
        height: startHeight,
      }
      const display = deps.displayForBounds(spriteRect(desired))
      const target = clampDraggedBounds(desired, display.workArea)
      if (target.x === lastAppliedX && target.y === lastAppliedY) return
      lastAppliedX = target.x
      lastAppliedY = target.y
      currentPetWindow.setBounds(target)
      if (deps.repositionVisiblePanel) {
        const now = Date.now()
        if (now - lastPanelFollowAt >= PANEL_FOLLOW_MS) {
          lastPanelFollowAt = now
          deps.repositionVisiblePanel()
        }
      }
    }, DRAG_POLL_MS)
    deps.setDragPollHandle(dragPollHandle)
  })

  deps.ipcMain.on(IPC_CHANNELS.petDragEnd, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const handle = deps.getDragPollHandle()
    if (handle) deps.clearInterval(handle)
    deps.setDragPollHandle(null)
    const [x, y] = petWindow.getPosition()
    const [width, height] = petWindow.getSize()
    deps.setNormalPetBounds({ x, y, width, height })
    deps.setEdgeRestoreBounds(null)
    deps.repositionVisiblePanel?.()
    deps.persistCurrentPetWindowState()
    const moved = payload && typeof payload === 'object'
      && (payload as Record<string, unknown>).moved === true
    if (moved) deps.scheduleEdgeDwell()
  })

  deps.ipcMain.on(IPC_CHANNELS.petWindowHover, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    if (deps.getPetWindowMode() === 'edge') {
      deps.applyNormalPetBounds()
      deps.scheduleEdgeRedock?.()
    }
  })

  deps.ipcMain.on(IPC_CHANNELS.shimejiWalkStep, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawDelta = data.deltaX
    if (typeof rawDelta !== 'number' || !Number.isFinite(rawDelta)) return
    const preferences = deps.getDesktopPreferences()
    if (!preferences.shimejiEnabled || preferences.dndEnabled) return
    if (deps.getPetWindowMode() !== 'normal' || deps.getDragPollHandle() || deps.hasActivePermissionRequests()) return
    if (deps.currentPowerSaveState()) return

    const deltaX = Math.round(Math.max(-24, Math.min(24, rawDelta)))
    if (deltaX === 0) return
    const current = petWindow.getBounds()
    const display = deps.displayForBounds(current)
    const target = deps.clampWindowBounds({ ...current, x: current.x + deltaX }, display.workArea)
    const targetDisplay = deps.displayForBounds(target)
    if (targetDisplay.id !== display.id) return
    if (target.x === current.x && target.y === current.y) return
    stopWalkTween()
    if (!deps.smoothWalk) {
      petWindow.setPosition(target.x, target.y)
      deps.setNormalPetBounds(target)
      deps.scheduleShimejiPositionPersist()
      return
    }
    // Glide so the walk cycle in the sprite matches actual movement.
    const startedAt = Date.now()
    const fromX = current.x
    walkTween = deps.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / WALK_TWEEN_MS)
      const x = Math.round(fromX + (target.x - fromX) * progress)
      if (deps.getDragPollHandle() || petWindow.isDestroyed()) {
        stopWalkTween()
        return
      }
      petWindow.setBounds({ x, y: target.y, width: target.width, height: target.height })
      if (progress >= 1) {
        stopWalkTween()
        deps.setNormalPetBounds(target)
        deps.scheduleShimejiPositionPersist()
      }
    }, 16)
  })
}
