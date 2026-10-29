import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import type { DesktopPreferences } from '../../src/types/desktop'
import type { PresentationStatusSnapshot } from '../../src/types/presentation'
import type { PetWindowMode } from '../../src/types/pet-window'
import { normalizePresentationStatus } from '../presentation-controller.ts'
import { IPC_CHANNELS } from './channels.ts'

type Bounds = { x: number; y: number; width: number; height: number }

export interface WindowControlsIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>
  isTrustedIpcSender(event: IpcMainEvent, requiredWindow?: BrowserWindow | null): boolean
  assertTrustedIpcSender(event: IpcMainEvent, requiredWindow?: BrowserWindow | null): void
  getPetWindow(): BrowserWindow | null
  getPanelWindow(): BrowserWindow | null
  getDesktopPreferences(): DesktopPreferences
  getPetWindowMode(): PetWindowMode
  getNormalPetBounds(): Bounds | null
  setNormalPetBounds(value: Bounds | null): void
  getEdgeRestoreBounds(): Bounds | null
  setEdgeRestoreBounds(value: Bounds | null): void
  getAnchorBottomCenter(): { x: number; y: number } | null
  setAnchorBottomCenter(value: { x: number; y: number } | null): void
  getPetContentHeight(): number | null
  setPetContentHeight(value: number | null): void
  setPanelFullscreenAutoHidden(value: boolean): void
  finiteNumber(value: unknown): number | null
  clamp(value: number, min: number, max: number): number
  computePanelBounds(height: number, width?: number): Bounds
  panelMinWidth: number
  panelMaxWidth: number
  getDisplayWorkArea(bounds: Bounds): Bounds
  animateBounds(bounds: Bounds): void
  persistPetBounds(x: number, y: number, width: number, height: number): void
  persistCurrentPetWindowState(): void
  repositionVisiblePanel(): void
  hidePetWindow(): void
  showPanelWindow(view: 'sessions' | 'settings' | 'restore'): void
  quit(): void
  relaunch(): void
  exit(code: number): void
  setPresentationStatus(status: PresentationStatusSnapshot): void
  updatePluginAgentStatus(status: PresentationStatusSnapshot): void
}

export function registerWindowControlsIpc(deps: WindowControlsIpcDependencies): void {
  deps.ipcMain.on(IPC_CHANNELS.petMousePassthrough, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const ignore = data.ignore
    if (typeof ignore !== 'boolean') return
    if (ignore) petWindow.setIgnoreMouseEvents(true, { forward: true })
    else petWindow.setIgnoreMouseEvents(false)
  })

  deps.ipcMain.on(IPC_CHANNELS.petHideRequest, event => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    if (!deps.getDesktopPreferences().rightClickHideEnabled) return
    deps.hidePetWindow()
  })

  deps.ipcMain.on(IPC_CHANNELS.panelToggle, event => {
    const panelWindow = deps.getPanelWindow()
    if (!panelWindow || !deps.isTrustedIpcSender(event, deps.getPetWindow())) return
    if (panelWindow.isVisible()) {
      deps.setPanelFullscreenAutoHidden(false)
      panelWindow.hide()
      return
    }
    deps.showPanelWindow('restore')
  })

  deps.ipcMain.on(IPC_CHANNELS.panelResize, (event, payload: unknown) => {
    const panelWindow = deps.getPanelWindow()
    if (!panelWindow || !deps.isTrustedIpcSender(event, panelWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const height = deps.finiteNumber(data.height)
    if (height === null) return
    const requestedWidth = deps.finiteNumber(data.width)
    const width = requestedWidth === null
      ? panelWindow.getBounds().width
      : Math.round(deps.clamp(requestedWidth, deps.panelMinWidth, deps.panelMaxWidth))
    panelWindow.setBounds(deps.computePanelBounds(Math.round(deps.clamp(height, 160, 900)), width))
  })

  deps.ipcMain.on(IPC_CHANNELS.panelHide, event => {
    if (!deps.isTrustedIpcSender(event, deps.getPanelWindow())) return
    deps.setPanelFullscreenAutoHidden(false)
    deps.getPanelWindow()?.hide()
  })

  deps.ipcMain.on(IPC_CHANNELS.petResize, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawWidth = deps.finiteNumber(data.width)
    const rawHeight = deps.finiteNumber(data.height)
    if (rawWidth === null || rawHeight === null) return
    const width = Math.round(deps.clamp(rawWidth, 80, 1_600))
    const height = Math.round(deps.clamp(rawHeight, 80, 1_600))
    if (deps.getPetWindowMode() !== 'normal') {
      const current = deps.getEdgeRestoreBounds() ?? deps.getNormalPetBounds() ?? petWindow.getBounds()
      const next = { ...current, width, height }
      deps.setNormalPetBounds(next)
      if (deps.getEdgeRestoreBounds()) deps.setEdgeRestoreBounds({ ...next })
      deps.persistCurrentPetWindowState()
      return
    }
    const workArea = deps.getDisplayWorkArea(petWindow.getBounds())

    let anchorBottomCenter = deps.getAnchorBottomCenter()
    if (!anchorBottomCenter) {
      const [x, y] = petWindow.getPosition()
      const [curW, curH] = petWindow.getSize()
      anchorBottomCenter = { x: x + Math.round(curW / 2), y: y + curH }
    }

    let newX = anchorBottomCenter.x - Math.round(width / 2)
    let newY = anchorBottomCenter.y - height
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
    newX = deps.clamp(newX, workArea.x, maxX)
    newY = deps.clamp(newY, workArea.y, maxY)
    deps.animateBounds({ x: newX, y: newY, width, height })
    deps.setAnchorBottomCenter({ x: newX + Math.round(width / 2), y: newY + height })
    deps.persistPetBounds(newX, newY, width, height)
  })

  deps.ipcMain.on(IPC_CHANNELS.petContentHeight, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawHeight = deps.finiteNumber(data.height)
    if (rawHeight === null) return
    const next = Math.round(deps.clamp(rawHeight, 40, 1_600))
    if (next === deps.getPetContentHeight()) return
    deps.setPetContentHeight(next)
    deps.repositionVisiblePanel()
  })

  deps.ipcMain.on(IPC_CHANNELS.petQuit, event => {
    deps.assertTrustedIpcSender(event)
    deps.quit()
  })

  deps.ipcMain.on(IPC_CHANNELS.petRestart, event => {
    deps.assertTrustedIpcSender(event)
    deps.relaunch()
    deps.exit(0)
  })

  deps.ipcMain.on(IPC_CHANNELS.presentationStatusUpdate, (event, payload: unknown) => {
    const petWindow = deps.getPetWindow()
    if (!petWindow || !deps.isTrustedIpcSender(event, petWindow)) return
    const status = normalizePresentationStatus(payload)
    deps.setPresentationStatus(status)
    deps.updatePluginAgentStatus(status)
  })
}
