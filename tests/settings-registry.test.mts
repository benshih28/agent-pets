import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { nextRovingId } from '../src/composables/useRovingTabs.ts'
import {
  SETTINGS_ENTRIES,
  SETTINGS_GROUPS,
  groupOfSection,
  isSettingsGroupId,
  searchSettings,
} from '../src/utils/settingsRegistry.ts'

const localesRoot = join(import.meta.dirname, '..', 'src', 'locales')
function catalog(locale: 'zh-TW' | 'en-US'): Record<string, string> {
  const merged: Record<string, string> = JSON.parse(readFileSync(join(localesRoot, `${locale}.json`), 'utf8'))
  for (const domain of readdirSync(localesRoot).filter(name => statSync(join(localesRoot, name)).isDirectory())) {
    Object.assign(merged, JSON.parse(readFileSync(join(localesRoot, domain, `${locale}.json`), 'utf8')))
  }
  return merged
}

test('every registry label and help key exists in both locale catalogs', () => {
  for (const locale of ['zh-TW', 'en-US'] as const) {
    const messages = catalog(locale)
    for (const group of SETTINGS_GROUPS) assert.ok(messages[group.labelKey], `${locale}: ${group.labelKey}`)
    for (const entry of SETTINGS_ENTRIES) {
      assert.ok(messages[entry.labelKey], `${locale}: ${entry.labelKey}`)
      if (entry.helpKey) assert.ok(messages[entry.helpKey], `${locale}: ${entry.helpKey}`)
    }
  }
})

test('each section belongs to exactly one group and every entry points at a grouped section', () => {
  const sections = SETTINGS_GROUPS.flatMap(group => group.sections)
  assert.equal(new Set(sections).size, sections.length)
  for (const entry of SETTINGS_ENTRIES) assert.ok(sections.includes(entry.section), entry.id)
  assert.equal(new Set(SETTINGS_ENTRIES.map(entry => entry.id)).size, SETTINGS_ENTRIES.length)
  assert.equal(groupOfSection('notifications'), 'desktop')
  assert.equal(groupOfSection('plugins'), 'plugins')
  assert.equal(groupOfSection('advanced'), 'integrations')
  assert.ok(isSettingsGroupId('plugins'))
  assert.equal(SETTINGS_GROUPS.length, 5)
  assert.ok(isSettingsGroupId('pets'))
  assert.ok(!isSettingsGroupId('appearance'))
})

test('search matches labels, help and synonyms in both languages', () => {
  const messages = catalog('zh-TW')
  const translate = (key: string) => messages[key] ?? key
  const ids = (query: string) => searchSettings(query, translate as never).map(hit => hit.entry.id)
  assert.ok(ids('勿擾').includes('dnd'))
  assert.ok(ids('免打擾').includes('dnd'))
  assert.ok(ids('focus').includes('dnd'))
  assert.ok(ids('MCP').includes('presentationMcp'))
  assert.ok(ids('mcp').includes('projectMcp'))
  assert.ok(ids('開機').includes('launchAtStartup'))
  assert.deepEqual(ids('   '), [])
  assert.deepEqual(ids('zzzz-no-match'), [])
  assert.ok(ids('通知').includes('notifications'))
  assert.deepEqual(ids('勿擾 音效'), [])
})

test('plugin search results land in the dedicated plugins group', () => {
  const messages = catalog('zh-TW')
  const hit = searchSettings('插件', ((key: string) => messages[key] ?? key) as never).find(item => item.entry.id === 'plugins')
  assert.ok(hit)
  assert.equal(groupOfSection(hit.entry.section), 'plugins')
})

test('roving tab navigation wraps and supports Home and End', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(nextRovingId(ids, 'a', 'ArrowRight'), 'b')
  assert.equal(nextRovingId(ids, 'c', 'ArrowRight'), 'a')
  assert.equal(nextRovingId(ids, 'a', 'ArrowLeft'), 'c')
  assert.equal(nextRovingId(ids, 'b', 'Home'), 'a')
  assert.equal(nextRovingId(ids, 'b', 'End'), 'c')
  assert.equal(nextRovingId(ids, 'b', 'ArrowDown'), null)
  assert.equal(nextRovingId(ids, 'b', 'ArrowDown', 'vertical'), 'c')
  assert.equal(nextRovingId([], 'a', 'Home'), null)
})

test('completion markers are searchable in both languages', () => {
  for (const locale of ['zh-TW', 'en-US'] as const) {
    const messages = catalog(locale)
    const translate = ((key: string) => messages[key] ?? key) as never
    for (const query of ['完成標記', 'completion', 'badge']) {
      assert.ok(searchSettings(query, translate).some(hit => hit.entry.id === 'completionMarkers'), `${locale}: ${query}`)
    }
  }
})
