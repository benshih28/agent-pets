import { PANEL_SIZES, type PanelSize, type PanelSizeKey } from './panel-layout.ts'

// The panel's navigation as one small state machine instead of three loose
// flags. `view` is the page underneath; `overlay` is a wizard / MCP page opened
// on top of it, so closing it always returns to where the user came from.

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

// What the window should be told when the route changes. Switching between the
// dashboard and Settings never resizes (the user's size is the one size); only a
// wizard / MCP overlay asks for a larger minimum, and closing it releases that.
export type PanelResizeRequest = { release: true } | (PanelSize & { release?: undefined })

export function panelResizeRequest(previous: PanelRouteState, next: PanelRouteState): PanelResizeRequest | null {
  if (previous.overlay === next.overlay) return null
  return next.overlay ? { ...PANEL_SIZES[next.overlay] } : { release: true }
}
