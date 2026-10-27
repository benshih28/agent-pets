import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import type { DesktopPreferences } from '../../src/types/desktop'
import type { PetWindowMode } from '../../src/types/pet-window'
import type { WindowBounds } from '../pet-window-mode'
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
}

export function registerPetMotionIpc(deps: PetMotionIpcDependencies): void {
  deps.ipcMain.on(IPC_CHANNELS.petDragStart, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    deps.clearEdgeDwell()
    deps.clearShimejiPersist()
    if (deps.getPetWindowMode() !== 'normal') deps.applyNormalPetBounds()
    deps.setEdgeRestoreBounds(null)
    const previousHandle = deps.getDragPollHandle()
    if (previousHandle) deps.clearInterval(previousHandle)
    const startCursor = deps.getCursorScreenPoint()
    const [startX, startY] = petWindow.getPosition()
    let lastAppliedX = startX
    let lastAppliedY = startY
    deps.setAnchorBottomCenter(null)
    deps.getPanelWindow()?.hide()

    const dragPollHandle = deps.setInterval(() => {
      const currentPetWindow = deps.getPetWindow()
      if (!currentPetWindow) {
        const handle = deps.getDragPollHandle()
        if (handle) deps.clearInterval(handle)
        deps.setDragPollHandle(null)
        return
      }
      const cursor = deps.getCursorScreenPoint()
      const targetX = startX + (cursor.x - startCursor.x)
      const targetY = startY + (cursor.y - startCursor.y)
      if (targetX === lastAppliedX && targetY === lastAppliedY) return
      lastAppliedX = targetX
      lastAppliedY = targetY
      currentPetWindow.setPosition(targetX, targetY)
    }, 8)
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
    deps.persistCurrentPetWindowState()
    const moved = payload && typeof payload === 'object'
      && (payload as Record<string, unknown>).moved === true
    if (moved) deps.scheduleEdgeDwell()
  })

  deps.ipcMain.on(IPC_CHANNELS.petWindowHover, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    if (deps.getPetWindowMode() === 'edge') deps.applyNormalPetBounds()
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
    petWindow.setPosition(target.x, target.y)
    deps.setNormalPetBounds(target)
    deps.scheduleShimejiPositionPersist()
  })
}
