import { PANEL_SIZES, type PanelSize, type PanelSizeKey } from './panel-layout.ts'

export type PanelView = 'sessions' | 'settings'
export type PanelOverlay = 'wizard' | 'mcp'

export interface PanelRouteState {
  view: PanelView
  overlay: PanelOverlay | null
}

export const INITIAL_PANEL_ROUTE: PanelRouteState = { view: 'sessions', overlay: null }

export type PanelRouteAction =
  | { type: 'open-settings' }
  | { type: 'back-to-sessions' }
  | { type: 'open-overlay'; overlay: PanelOverlay }
  | { type: 'close-overlay' }
  | { type: 'reset' }

export function reducePanelRoute(state: PanelRouteState, action: PanelRouteAction): PanelRouteState {
  switch (action.type) {
    case 'open-settings': return { view: 'settings', overlay: null }
    case 'back-to-sessions': return { view: 'sessions', overlay: null }
    case 'open-overlay': return { view: state.view, overlay: action.overlay }
    case 'close-overlay': return { view: state.view, overlay: null }
    case 'reset': return INITIAL_PANEL_ROUTE
  }
}

export function panelSizeKey(state: PanelRouteState): PanelSizeKey {
  return state.overlay ?? state.view
}

export function panelSizeFor(state: PanelRouteState): PanelSize {
  return PANEL_SIZES[panelSizeKey(state)]
}

export type PanelResizeRequest = { release: true } | (PanelSize & { release?: undefined })

export function panelResizeRequest(previous: PanelRouteState, next: PanelRouteState): PanelResizeRequest | null {
  if (previous.overlay === next.overlay) return null
  return next.overlay ? { ...PANEL_SIZES[next.overlay] } : { release: true }
}
