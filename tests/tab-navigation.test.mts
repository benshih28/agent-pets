import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTabId, panelDomId, tabDomId } from '../src/utils/tab-navigation.ts'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c', disabled: true }, { id: 'd' }]

test('horizontal tabs: arrows wrap and skip disabled tabs', () => {
  assert.equal(nextTabId(items, 'a', 'ArrowRight'), 'b')
  assert.equal(nextTabId(items, 'b', 'ArrowRight'), 'd')
  assert.equal(nextTabId(items, 'd', 'ArrowRight'), 'a')
  assert.equal(nextTabId(items, 'a', 'ArrowLeft'), 'd')
})

test('Home and End jump to the first and last enabled tab', () => {
  assert.equal(nextTabId(items, 'b', 'Home'), 'a')
  assert.equal(nextTabId(items, 'a', 'End'), 'd')
})

test('vertical tabs use up/down and ignore left/right', () => {
  assert.equal(nextTabId(items, 'a', 'ArrowDown', 'vertical'), 'b')
  assert.equal(nextTabId(items, 'a', 'ArrowUp', 'vertical'), 'd')
  assert.equal(nextTabId(items, 'a', 'ArrowRight', 'vertical'), null)
  assert.equal(nextTabId(items, 'a', 'ArrowDown', 'horizontal'), null)
})

test('unrelated keys and empty lists do nothing; unknown current starts from an end', () => {
  assert.equal(nextTabId(items, 'a', 'Enter'), null)
  assert.equal(nextTabId([], 'a', 'ArrowRight'), null)
  assert.equal(nextTabId(items, 'zzz', 'ArrowRight'), 'a')
})

test('tab and panel ids are derived consistently for aria-controls/labelledby', () => {
  assert.equal(tabDomId('dash', 'usage'), 'dash-tab-usage')
  assert.equal(panelDomId('dash', 'usage'), 'dash-panel-usage')
})
