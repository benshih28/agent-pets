import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..', 'src', 'components')
const files = [
  ...readdirSync(join(root, 'growth')).map(name => join(root, 'growth', name)),
  join(root, 'status-panel', 'StatusPanelHistory.vue'),
  join(root, 'status-panel', 'StatusPanelUsage.vue'),
  join(root, 'status-panel', 'SettingsGrowth.vue'),
].filter(file => file.endsWith('.vue'))

test('growth views follow the design-system and i18n rules', () => {
  assert.ok(files.length >= 6)
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const name = file.split('/').pop()
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${name}: bare hex colour`)
    assert.doesNotMatch(source, /rgba?\(/, `${name}: bare rgb()/rgba()`)
    assert.doesNotMatch(source, /font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/, `${name}: font-size below 11px`)
    assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/, `${name}: native dialog`)
    assert.doesNotMatch(source, /[✓✗✔✕⚠🔥🏆✨]/u, `${name}: glyph used as an icon`)
    // Template text must go through t(); a CJK literal in markup is a missed key.
    const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>', source.lastIndexOf('<template>')))
    assert.doesNotMatch(template, />[^<{]*[一-鿿][^<{]*</, `${name}: hard-coded CJK text in template`)
  }
})
