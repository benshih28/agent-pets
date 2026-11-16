import type { BrowserWindow, Display, Point, Rectangle } from 'electron'
import { IPC_CHANNELS } from '../ipc/channels.ts'
import {
  EDGE_DWELL_MS,
  EDGE_REDOCK_AFTER_MS,
  EDGE_TRIGGER_DISTANCE_PX,
  clampWindowBounds,
  edgeWindowBounds,
  miniWindowBounds,
  nearestEdge,
  type WindowBounds,
} from '../pet-window-mode.ts'
import type { readWindowState, writeWindowState } from '../setup.ts'
import type { PetEdge, PetWindowMode, PetWindowModeState } from '../../src/types/pet-window'
import { clampPetWindowDimension } from '../../src/utils/pet-window-size.ts'
import type { MainState } from './state.ts'

// 寵物視窗模式（normal／mini／edge）：各模式的 bounds、貼邊停留與重新貼邊的計時器、
// 持久化的視窗狀態，以及模式廣播。
//
// 模式欄位仍放在 `mainState`，因為 pet-motion、window-control 的 IPC registrar 與建立視窗時
// 都要讀；除了建立視窗與拖曳處理，只有這個服務會寫入它們。其他依賴（螢幕、偏好、
// Permission Broker、面板、托盤）都以明確參數傳入，測試可以換成假螢幕。

const SHIMEJI_PERSIST_DELAY_MS = 2_000
const EDGE_REDOCK_POLL_MS = 400

export type PetWindowModeServiceState = Pick<MainState,
  | 'petWindow' | 'panelWindow' | 'dragPollHandle' | 'shimejiPersistHandle'
  | 'petWindowMode' | 'petWindowEdge' | 'normalPetBounds' | 'edgeRestoreBounds'
  | 'edgeDwellHandle' | 'edgeDwellCandidate'>

export interface PetWindowModeScreen {
  getDisplayMatching(rect: Rectangle): Display
  getAllDisplays(): Display[]
  getPrimaryDisplay(): Display
  getCursorScreenPoint(): Point
}

export interface PetWindowModeDeps {
  state: PetWindowModeServiceState
  screen: PetWindowModeScreen
  writeWindowState: typeof writeWindowState
  edgeModeEnabled(): boolean
  /** 有待處理的權限泡泡時寵物維持完整尺寸；判定仍以 Broker 為準。 */
  hasActivePermissionRequests(): boolean
  repositionPanel(): void
  /** 每次廣播模式前執行（plugin feed 的可見性取決於模式）。 */
  onVisibilityChanged(): void
  /** 明確切換模式後執行（托盤選單文字取決於模式）。 */
  onModeApplied(): void
  now?: () => number
}

export interface PetWindowRestoreOptions {
  /** 沒有存檔尺寸時的冷啟動預設尺寸（`initialPetWindowSize(scale)`）。 */
  fallbackSize: { width: number; height: number }
  /** 沒有存檔時預設放在主螢幕工作區右下角。 */
  primaryWorkArea: Rectangle
}

export interface PetWindowModeService {
  modeState(): PetWindowModeState
  broadcastMode(): void
  displayForBounds(bounds: WindowBounds): Display
  displayForSavedState(saved: ReturnType<typeof readWindowState>): Display
  /**
   * 建立視窗前還原上次的模式：寫入 normalPetBounds、petWindowMode、petWindowEdge、
   * edgeRestoreBounds，並回傳視窗的初始 bounds。
   */
  restore(saved: ReturnType<typeof readWindowState>, options: PetWindowRestoreOptions): WindowBounds
  persistCurrentState(): void
  scheduleShimejiPositionPersist(): void
  applyNormalBounds(): void
  applyMiniBounds(): void
  applyEdgeBounds(edge: PetEdge): void
  setMode(mode: PetWindowMode): void
  toggleMini(): void
  clearEdgeDwell(): void
  cancelEdgeRedock(): void
  scheduleEdgeRedock(): void
  scheduleEdgeDwell(): void
  rehomeForDisplayChange(): void
  /** 停止服務自己的重新貼邊輪詢與停留計時器；可重複呼叫。 */
  dispose(): void
}

function liveWindow(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed()
}

export function createPetWindowModeService(deps: PetWindowModeDeps): PetWindowModeService {
  const { state, screen } = deps
  const now = deps.now ?? (() => Date.now())
  let edgeRedockHandle: ReturnType<typeof setInterval> | null = null

  function modeState(): PetWindowModeState {
    return state.petWindowEdge
      ? { mode: state.petWindowMode, edge: state.petWindowEdge }
      : { mode: state.petWindowMode }
  }

  function broadcastMode(): void {
    deps.onVisibilityChanged()
    const payload = modeState()
    for (const window of [state.petWindow, state.panelWindow]) {
      if (liveWindow(window)) window.webContents.send(IPC_CHANNELS.petWindowModeUpdated, payload)
    }
  }

  function displayForBounds(bounds: WindowBounds): Display {
    return screen.getDisplayMatching({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    })
  }

  function displayForSavedState(saved: ReturnType<typeof readWindowState>): Display {
    if (saved?.displayId !== undefined) {
      const byId = screen.getAllDisplays().find(display => display.id === saved.displayId)
      if (byId) return byId
    }
    const savedBounds = saved?.normalBounds ?? (
      saved && saved.width !== undefined && saved.height !== undefined
        ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
        : null
    )
    return savedBounds ? displayForBounds(savedBounds) : screen.getPrimaryDisplay()
  }

  function restore(saved: ReturnType<typeof readWindowState>, options: PetWindowRestoreOptions): WindowBounds {
    // 寵物尺寸存在 renderer 的 localStorage，主行程讀不到，所以沿用上次 renderer 要求並隨位置
    // 一起存檔的尺寸；否則視窗一律以 1x（L）誕生，面板會對著 L 尺寸的 bounds 開啟。
    const { fallbackSize, primaryWorkArea } = options
    const w = saved?.width !== undefined ? clampPetWindowDimension(saved.width) : fallbackSize.width
    const h = saved?.height !== undefined ? clampPetWindowDimension(saved.height) : fallbackSize.height

    const savedDisplay = displayForSavedState(saved)
    const savedNormal = saved?.normalBounds ?? (
      saved
        ? { x: saved.x, y: saved.y, width: saved.width ?? w, height: saved.height ?? h }
        : {
            x: primaryWorkArea.x + primaryWorkArea.width - w - 30,
            y: primaryWorkArea.y + primaryWorkArea.height - h - 30,
            width: w,
            height: h,
          }
    )
    // 重新夾進目前工作區，避免存檔時的螢幕已經拔掉。
    state.normalPetBounds = clampWindowBounds(savedNormal, savedDisplay.workArea)
    const attachedEdge = nearestEdge(state.normalPetBounds, savedDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
    const canRestoreEdge = saved?.mode === 'edge'
      && deps.edgeModeEnabled()
      && attachedEdge !== null
      && (saved.edge === undefined || saved.edge === attachedEdge)
    state.petWindowMode = saved?.mode === 'mini' ? 'mini' : canRestoreEdge ? 'edge' : 'normal'
    state.petWindowEdge = canRestoreEdge ? (saved.edge ?? attachedEdge) : null
    state.edgeRestoreBounds = canRestoreEdge ? { ...state.normalPetBounds } : null
    return state.petWindowMode === 'mini'
      ? miniWindowBounds(state.normalPetBounds, savedDisplay.workArea)
      : state.petWindowMode === 'edge' && state.petWindowEdge
        ? edgeWindowBounds(state.normalPetBounds, savedDisplay.workArea, state.petWindowEdge)
        : state.normalPetBounds
  }

  function persistCurrentState(): void {
    if (!liveWindow(state.petWindow)) return
    const bounds = state.petWindow.getBounds()
    const display = displayForBounds(bounds)
    const normal = state.edgeRestoreBounds ?? state.normalPetBounds ?? bounds
    deps.writeWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      mode: state.petWindowMode,
      edge: state.petWindowEdge ?? undefined,
      displayId: display.id,
      displayBounds: display.bounds,
      normalBounds: normal,
    })
  }

  function scheduleShimejiPositionPersist(): void {
    if (state.shimejiPersistHandle) clearTimeout(state.shimejiPersistHandle)
    state.shimejiPersistHandle = setTimeout(() => {
      state.shimejiPersistHandle = null
      persistCurrentState()
    }, SHIMEJI_PERSIST_DELAY_MS)
  }

  // 每次明確切換模式共同的收尾步驟（順序與改前相同）。
  function settleModeChange(window: BrowserWindow, bounds: WindowBounds): void {
    window.setIgnoreMouseEvents(false)
    window.setBounds(bounds)
    deps.repositionPanel()
    persistCurrentState()
    broadcastMode()
    deps.onModeApplied()
  }

  function applyNormalBounds(): void {
    const window = state.petWindow
    if (!liveWindow(window)) return
    clearEdgeDwell()
    const current = window.getBounds()
    const restore = state.edgeRestoreBounds ?? state.normalPetBounds ?? current
    const display = displayForBounds(restore)
    const normal = clampWindowBounds(restore, display.workArea)
    state.normalPetBounds = normal
    state.edgeRestoreBounds = null
    state.petWindowMode = 'normal'
    state.petWindowEdge = null
    settleModeChange(window, normal)
  }

  function applyMiniBounds(): void {
    const window = state.petWindow
    if (!liveWindow(window)) return
    clearEdgeDwell()
    const current = window.getBounds()
    const normalSource = state.edgeRestoreBounds ?? state.normalPetBounds ?? current
    const display = displayForBounds(normalSource)
    const normal = clampWindowBounds(normalSource, display.workArea)
    state.normalPetBounds = normal
    state.edgeRestoreBounds = null
    state.petWindowMode = 'mini'
    state.petWindowEdge = null
    settleModeChange(window, miniWindowBounds(normal, display.workArea))
  }

  function applyEdgeBounds(edge: PetEdge): void {
    const window = state.petWindow
    if (!liveWindow(window)) return
    if (!deps.edgeModeEnabled()) {
      applyNormalBounds()
      return
    }
    clearEdgeDwell()
    const current = window.getBounds()
    // Edge can only be entered from a full-size normal window. Capture the
    // actual bounds at this moment so expansion returns to the user's exact
    // pre-edge position, even if a previous persisted snapshot is stale.
    const normalSource = state.petWindowMode === 'normal'
      ? current
      : state.edgeRestoreBounds ?? state.normalPetBounds ?? current
    const display = displayForBounds(normalSource)
    const normal = clampWindowBounds(normalSource, display.workArea)
    state.normalPetBounds = normal
    state.edgeRestoreBounds = { ...normal }
    state.petWindowMode = 'edge'
    state.petWindowEdge = edge
    // Edge is an explicit, opaque handle-sized window. Keep it interactive so
    // a click or drag can expand it; click-through remains owned by Normal's
    // transparent-region hit testing.
    settleModeChange(window, edgeWindowBounds(normal, display.workArea, edge))
  }

  function setMode(mode: PetWindowMode): void {
    if (!liveWindow(state.petWindow)) return
    // A permission bubble must remain fully usable. The Broker remains the
    // authority, so a compact/partially hidden window is never allowed while a
    // request is pending.
    if (mode !== 'normal' && deps.hasActivePermissionRequests()) {
      applyNormalBounds()
      return
    }
    if (mode === 'normal') applyNormalBounds()
    else if (mode === 'mini') applyMiniBounds()
    else if (state.petWindowEdge) applyEdgeBounds(state.petWindowEdge)
  }

  function toggleMini(): void {
    setMode(state.petWindowMode === 'mini' ? 'normal' : 'mini')
  }

  function cancelEdgeRedock(): void {
    if (edgeRedockHandle) clearInterval(edgeRedockHandle)
    edgeRedockHandle = null
  }

  function clearEdgeDwell(): void {
    cancelEdgeRedock()
    if (state.edgeDwellHandle) clearTimeout(state.edgeDwellHandle)
    state.edgeDwellHandle = null
    state.edgeDwellCandidate = null
  }

  // After a hover-expand from the edge, tuck the pet back once the cursor has
  // stayed away and the pet is still resting against that edge.
  function scheduleEdgeRedock(): void {
    cancelEdgeRedock()
    if (!deps.edgeModeEnabled()) return
    let outsideSince: number | null = null
    edgeRedockHandle = setInterval(() => {
      const window = state.petWindow
      if (!liveWindow(window) || state.petWindowMode !== 'normal' || state.dragPollHandle) {
        cancelEdgeRedock()
        return
      }
      const bounds = window.getBounds()
      const display = displayForBounds(bounds)
      if (!nearestEdge(bounds, display.workArea, EDGE_TRIGGER_DISTANCE_PX)) {
        cancelEdgeRedock()
        return
      }
      const cursor = screen.getCursorScreenPoint()
      const inside = cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width
        && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height
      if (inside || deps.hasActivePermissionRequests()) {
        outsideSince = null
        return
      }
      outsideSince ??= now()
      if (now() - outsideSince >= EDGE_REDOCK_AFTER_MS) {
        cancelEdgeRedock()
        scheduleEdgeDwell()
      }
    }, EDGE_REDOCK_POLL_MS)
  }

  function scheduleEdgeDwell(): void {
    clearEdgeDwell()
    const window = state.petWindow
    if (!liveWindow(window) || state.petWindowMode !== 'normal' || !deps.edgeModeEnabled()) return
    const bounds = window.getBounds()
    const display = displayForBounds(bounds)
    const edge = nearestEdge(bounds, display.workArea, EDGE_TRIGGER_DISTANCE_PX)
    if (!edge) return
    state.edgeDwellCandidate = { displayId: display.id, edge }
    state.edgeDwellHandle = setTimeout(() => {
      state.edgeDwellHandle = null
      const candidate = state.edgeDwellCandidate
      state.edgeDwellCandidate = null
      if (!candidate || !liveWindow(state.petWindow)) return
      const current = state.petWindow.getBounds()
      const currentDisplay = displayForBounds(current)
      const currentEdge = nearestEdge(current, currentDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
      if (currentDisplay.id === candidate.displayId && currentEdge === candidate.edge) {
        applyEdgeBounds(candidate.edge)
      }
    }, EDGE_DWELL_MS)
  }

  function rehomeForDisplayChange(): void {
    const window = state.petWindow
    if (!liveWindow(window)) return
    const current = window.getBounds()
    const display = displayForBounds(current)
    const normalSource = state.edgeRestoreBounds ?? state.normalPetBounds ?? current
    const normal = clampWindowBounds(normalSource, display.workArea)
    state.normalPetBounds = normal
    if (state.petWindowMode === 'edge') state.edgeRestoreBounds = { ...normal }
    if (state.petWindowMode === 'mini') {
      window.setBounds(miniWindowBounds(normal, display.workArea))
    } else if (state.petWindowMode === 'edge' && state.petWindowEdge) {
      window.setBounds(edgeWindowBounds(normal, display.workArea, state.petWindowEdge))
    } else {
      state.petWindowMode = 'normal'
      state.petWindowEdge = null
      window.setIgnoreMouseEvents(false)
      window.setBounds(normal)
    }
    deps.repositionPanel()
    persistCurrentState()
    broadcastMode()
  }

  return {
    modeState,
    broadcastMode,
    displayForBounds,
    displayForSavedState,
    restore,
    persistCurrentState,
    scheduleShimejiPositionPersist,
    applyNormalBounds,
    applyMiniBounds,
    applyEdgeBounds,
    setMode,
    toggleMini,
    clearEdgeDwell,
    cancelEdgeRedock,
    scheduleEdgeRedock,
    scheduleEdgeDwell,
    rehomeForDisplayChange,
    dispose: clearEdgeDwell,
  }
}
