import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const dir = new URL('../src/components/plugin-panel/', import.meta.url)
const files = readdirSync(dir).filter(name => name.endsWith('.vue'))
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')

test('list cards carry a plugin-specific accessible name on repeated controls', () => {
  const card = read('PluginCard.vue')
  for (const key of ['plugins.openPanelNamed', 'plugins.settingsNamed', 'plugins.detailsNamed', 'plugins.enableNamed', 'plugins.moreNamed']) {
    assert.ok(card.includes(key), `PluginCard is missing ${key}`)
  }
})

test('plugin panel components do not use polite live regions for counters and avoid bare hex colours', () => {
  for (const name of files) {
    const source = read(name)
    assert.doesNotMatch(source, /aria-live="polite"/, `${name} uses aria-live on a counter`)
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${name} contains a bare hex colour`)
    assert.doesNotMatch(source, /font-size:\s*(?:[0-9]|10)px/, `${name} uses a font size below 11px`)
  }
})

test('card surfaces keep a visible border in forced-colors mode', () => {
  for (const name of ['PluginCard.vue', 'PluginCatalog.vue', 'PluginNotificationInbox.vue']) {
    assert.match(read(name), /forced-colors: active/, `${name} lacks a forced-colors rule`)
  }
})

test('unread notifications are marked by more than opacity', () => {
  const inbox = read('PluginNotificationInbox.vue')
  assert.match(inbox, /class="dot"/)
  assert.match(inbox, /plugins\.unread/)
  assert.doesNotMatch(inbox, /opacity:\s*\.\d/)
})
