import assert from 'node:assert/strict'
import test from 'node:test'
import { PANEL_SIZES } from '../src/utils/panel-layout.ts'
import { INITIAL_PANEL_ROUTE, panelSizeFor, reducePanelRoute, type PanelRouteState } from '../src/utils/panel-route.ts'

const settings: PanelRouteState = { view: 'settings', overlay: null }

test('overlays return to the page they were opened from', () => {
  const fromSessions = reducePanelRoute(INITIAL_PANEL_ROUTE, { type: 'open-overlay', overlay: 'mcp' })
  assert.deepEqual(fromSessions, { view: 'sessions', overlay: 'mcp' })
  assert.deepEqual(reducePanelRoute(fromSessions, { type: 'close-overlay' }), INITIAL_PANEL_ROUTE)
  const fromSettings = reducePanelRoute(settings, { type: 'open-overlay', overlay: 'wizard' })
  assert.deepEqual(reducePanelRoute(fromSettings, { type: 'close-overlay' }), settings)
})

test('settings, back and reset clear overlays', () => {
  const overlay: PanelRouteState = { view: 'sessions', overlay: 'wizard' }
  assert.deepEqual(reducePanelRoute(overlay, { type: 'open-settings' }), settings)
  assert.deepEqual(reducePanelRoute({ view: 'settings', overlay: 'mcp' }, { type: 'back-to-sessions' }), INITIAL_PANEL_ROUTE)
  assert.deepEqual(reducePanelRoute({ view: 'settings', overlay: 'mcp' }, { type: 'reset' }), INITIAL_PANEL_ROUTE)
})

test('each route maps to its shared panel size', () => {
  assert.equal(panelSizeFor(INITIAL_PANEL_ROUTE), PANEL_SIZES.sessions)
  assert.equal(panelSizeFor(settings), PANEL_SIZES.settings)
  assert.equal(panelSizeFor({ view: 'settings', overlay: 'wizard' }), PANEL_SIZES.wizard)
  assert.equal(panelSizeFor({ view: 'sessions', overlay: 'mcp' }), PANEL_SIZES.mcp)
})
