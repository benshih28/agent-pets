import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { selectBubble, type BubbleCandidates, type BubbleKind, type PluginBubbleControls } from '../src/utils/feed-arbiter.ts'

const ENABLED_PLUGIN: PluginBubbleControls = {
  pluginsEnabled: true,
  enabled: true,
  muted: false,
  dnd: false,
  visible: true,
}

const candidatesFor = (kind: BubbleKind): BubbleCandidates => {
  switch (kind) {
    case 'permission-request': return { permissionRequest: true }
    case 'permission-notice': return { permissionNotice: true }
    case 'agent-toast': return { agentToast: true }
    case 'presentation-say': return { presentationSay: true }
    case 'plugin-feed-normal': return { pluginFeed: { priority: 'normal', controls: ENABLED_PLUGIN } }
    case 'activity': return { activity: true }
    case 'plugin-feed-low': return { pluginFeed: { priority: 'low', controls: ENABLED_PLUGIN } }
  }
}

const feedArbiterSource = readFileSync(new URL('../src/utils/feed-arbiter.ts', import.meta.url), 'utf8')

const PRIORITY: BubbleKind[] = [
  'permission-request',
  'permission-notice',
  'presentation-say',
  'agent-toast',
  'plugin-feed-normal',
  'activity',
  'plugin-feed-low',
]

test('selectBubble returns no selection when no candidate is available', () => {
  assert.equal(selectBubble({}), null)
})

for (let higher = 0; higher < PRIORITY.length; higher += 1) {
  for (let lower = higher + 1; lower < PRIORITY.length; lower += 1) {
    const higherKind = PRIORITY[higher]
    const lowerKind = PRIORITY[lower]
    if (!higherKind || !lowerKind || higherKind.startsWith('plugin-feed') && lowerKind.startsWith('plugin-feed')) continue
    test(`${higherKind} takes precedence over ${lowerKind}`, () => {
      assert.equal(selectBubble({ ...candidatesFor(higherKind), ...candidatesFor(lowerKind) }), higherKind)
    })
  }
}

test('BubbleCandidates omits the unused bubbleEnabled field', () => {
  const declaration = feedArbiterSource.match(/export interface BubbleCandidates \{([\s\S]*?)\n\}/)
  assert.ok(declaration)
  assert.equal(declaration?.[1]?.includes('bubbleEnabled'), false)
})

test('plugin feed selection uses only plugin-side controls', () => {
  assert.equal(selectBubble({
    pluginFeed: { priority: 'normal', controls: ENABLED_PLUGIN },
  }), 'plugin-feed-normal')
})

test('low priority plugin feed is selected when no higher candidate exists', () => {
  assert.equal(selectBubble({ pluginFeed: { priority: 'low', controls: ENABLED_PLUGIN } }), 'plugin-feed-low')
})

test('plugin feed is blocked when any required plugin-side control is closed', () => {
  const blockedControls: PluginBubbleControls[] = [
    { ...ENABLED_PLUGIN, pluginsEnabled: false },
    { ...ENABLED_PLUGIN, enabled: false },
    { ...ENABLED_PLUGIN, muted: true },
    { ...ENABLED_PLUGIN, dnd: true },
    { ...ENABLED_PLUGIN, visible: false },
  ]
  for (const controls of blockedControls) {
    assert.equal(selectBubble({ pluginFeed: { priority: 'normal', controls } }), null)
  }
})
