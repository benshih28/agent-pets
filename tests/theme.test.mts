import test from 'node:test'
import assert from 'node:assert/strict'
import { isPetThemePreference, isThemePreference, nextThemePreference, resolvePetTheme, resolveTheme } from '../src/composables/useTheme.ts'

test('system preference follows the OS, explicit preferences win', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

test('only known preferences are accepted', () => {
  assert.ok(isThemePreference('system') && isThemePreference('light') && isThemePreference('dark'))
  assert.ok(!isThemePreference('sepia') && !isThemePreference(null))
})

test('pet theme: dark default, explicit values win, follow tracks the panel', () => {
  assert.equal(resolvePetTheme('dark', 'light'), 'dark')
  assert.equal(resolvePetTheme('light', 'dark'), 'light')
  assert.equal(resolvePetTheme('follow', 'dark'), 'dark')
  assert.equal(resolvePetTheme('follow', 'light'), 'light')
  assert.ok(isPetThemePreference('follow') && !isPetThemePreference('system') && !isPetThemePreference(undefined))
})

test('quick toggle cycles system -> light -> dark -> system', () => {
  assert.equal(nextThemePreference('system'), 'light')
  assert.equal(nextThemePreference('light'), 'dark')
  assert.equal(nextThemePreference('dark'), 'system')
})
