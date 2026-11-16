import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// 回歸：Windows 補上「切換到 App」後，設定頁的開關也必須在 Windows 顯示，
// 否則使用者無法關掉這個會把其他程式帶到前景的動作。
const source = readFileSync(new URL('../src/components/status-panel/SettingsDesktop.vue', import.meta.url), 'utf8')

test('the switch-to-app toggle is offered on macOS and Windows', () => {
  const match = source.match(/const canSwitchApp = (\/[^/]+\/i)\.test\(navigator\.platform\)/)
  assert.ok(match, 'SettingsDesktop gates the toggle on navigator.platform')
  const pattern = new RegExp(match[1].slice(1, -2), 'i')
  assert.equal(pattern.test('MacIntel'), true)
  assert.equal(pattern.test('Win32'), true)
  assert.equal(pattern.test('Linux x86_64'), false)
  assert.match(source, /v-if="canSwitchApp"[\s\S]{0,120}sessionJumpSwitchAppEnabled/)
})
