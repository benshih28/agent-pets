import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APP_UPDATE_MAX_RESPONSE_BYTES, APP_UPDATE_RELEASES_PREFIX, isAppReleaseUrl, isNewerAppVersion,
  isValidAppVersion, normalizeAppVersion, parseLatestRelease,
} from '../electron/app-update.ts'

const release = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  tag_name: 'v1.14.0',
  html_url: `${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0`,
  draft: false,
  prerelease: false,
  ...overrides,
})

test('isNewerAppVersion compares semver with an optional v prefix', () => {
  assert.equal(isNewerAppVersion('1.13.1', 'v1.14.0'), true)
  assert.equal(isNewerAppVersion('1.13.1', '1.13.2'), true)
  assert.equal(isNewerAppVersion('1.13.1', '2.0.0'), true)
  assert.equal(isNewerAppVersion('1.13.1', '1.13.1'), false)
  assert.equal(isNewerAppVersion('1.13.1', 'v1.13.1'), false)
  assert.equal(isNewerAppVersion('1.14.0', '1.13.9'), false)
  assert.equal(isNewerAppVersion('1.9.0', '1.10.0'), true)
  // 純數字比對而非字串比對
  assert.equal(isNewerAppVersion('1.10.0', '1.9.0'), false)
})

test('isNewerAppVersion orders prereleases below their release', () => {
  assert.equal(isNewerAppVersion('1.14.0-beta.1', '1.14.0'), true)
  assert.equal(isNewerAppVersion('1.14.0', '1.14.0-beta.1'), false)
  assert.equal(isNewerAppVersion('1.14.0-beta.1', '1.14.0-beta.2'), true)
  assert.equal(isNewerAppVersion('1.14.0-beta.2', '1.14.0-beta.10'), true)
})

test('isNewerAppVersion never prompts for invalid input', () => {
  for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'vv1.2.3', '01.2.3', '1.2.3-', ' 1.2.3', null, undefined, 5, {}, 'v', 'x'.repeat(200)]) {
    assert.equal(isNewerAppVersion('1.0.0', bad), false, String(bad))
    assert.equal(isNewerAppVersion(bad, '9.9.9'), false, String(bad))
  }
})

test('normalizeAppVersion strips exactly one leading v', () => {
  assert.equal(normalizeAppVersion('v1.2.3'), '1.2.3')
  assert.equal(normalizeAppVersion('V1.2.3'), '1.2.3')
  assert.equal(normalizeAppVersion('1.2.3'), '1.2.3')
  assert.equal(normalizeAppVersion('vv1.2.3'), 'v1.2.3')
  assert.equal(isValidAppVersion('vv1.2.3'), false)
  assert.equal(normalizeAppVersion(12), null)
})

test('isAppReleaseUrl only accepts https URLs under the project releases path', () => {
  assert.equal(isAppReleaseUrl(`${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0`), true)
  assert.equal(isAppReleaseUrl(APP_UPDATE_RELEASES_PREFIX), true)
  for (const bad of [
    'http://github.com/Ponpon55837/agent-pets/releases/tag/v1',
    'https://github.com/Ponpon55837/agent-pets/releases/../../evil/repo',
    'https://github.com/Ponpon55837/agent-pets/releases/%2e%2e/%2e%2e/evil',
    'https://github.com/Ponpon55837/agent-pets-evil/releases/tag/v1',
    'https://github.com/other/agent-pets/releases/tag/v1',
    'https://github.com.evil.example/Ponpon55837/agent-pets/releases/tag/v1',
    'https://evil@github.com/Ponpon55837/agent-pets/releases/tag/v1',
    'https://github.com:8443/Ponpon55837/agent-pets/releases/tag/v1',
    'https://github.com/Ponpon55837/agent-pets/releases',
    'https://github.com/Ponpon55837/agent-pets/issues/1',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '',
    null,
    42,
    `${APP_UPDATE_RELEASES_PREFIX}${'a'.repeat(3000)}`,
  ]) assert.equal(isAppReleaseUrl(bad), false, String(bad))
})

test('parseLatestRelease keeps only the validated version and URL', () => {
  const parsed = parseLatestRelease(release({ extra: 'ignored', body: 'notes' }))
  assert.deepEqual(parsed, { kind: 'release', release: { version: '1.14.0', url: `${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0` } })
})

test('parseLatestRelease replaces a hostile html_url with a constructed project URL', () => {
  for (const html_url of ['https://evil.example/phish', 'javascript:alert(1)', 'https://github.com/other/repo/releases/tag/v1', 42, null]) {
    const parsed = parseLatestRelease(release({ html_url }))
    assert.deepEqual(parsed, { kind: 'release', release: { version: '1.14.0', url: `${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0` } })
  }
  const parsed = parseLatestRelease(release({ html_url: undefined }))
  assert.equal(parsed.kind, 'release')
})

test('the fallback release URL is rebuilt from the normalized version, whether or not the tag has a v prefix', () => {
  for (const tag of ['v1.2.3', '1.2.3', 'V1.2.3']) {
    const parsed = parseLatestRelease(release({ tag_name: tag, html_url: null }))
    assert.deepEqual(parsed, { kind: 'release', release: { version: '1.2.3', url: `${APP_UPDATE_RELEASES_PREFIX}tag/v1.2.3` } }, tag)
  }
})

test('parseLatestRelease ignores drafts and prereleases', () => {
  assert.deepEqual(parseLatestRelease(release({ draft: true })), { kind: 'ignored' })
  assert.deepEqual(parseLatestRelease(release({ prerelease: true })), { kind: 'ignored' })
  assert.deepEqual(parseLatestRelease(release({ tag_name: 'v2.0.0-rc.1' })), { kind: 'ignored' })
})

test('parseLatestRelease rejects malformed, hostile, or oversized responses', () => {
  const invalid = { kind: 'invalid' }
  assert.deepEqual(parseLatestRelease('not json'), invalid)
  assert.deepEqual(parseLatestRelease(''), invalid)
  assert.deepEqual(parseLatestRelease('[]'), invalid)
  assert.deepEqual(parseLatestRelease('null'), invalid)
  assert.deepEqual(parseLatestRelease('"v1.0.0"'), invalid)
  assert.deepEqual(parseLatestRelease(undefined), invalid)
  assert.deepEqual(parseLatestRelease(release({ tag_name: 'latest' })), invalid)
  assert.deepEqual(parseLatestRelease(release({ tag_name: 42 })), invalid)
  assert.deepEqual(parseLatestRelease(release({ tag_name: '../../x' })), invalid)
  assert.deepEqual(parseLatestRelease(release({ tag_name: 'v1.0.0/../x' })), invalid)
  assert.deepEqual(parseLatestRelease(release({ tag_name: undefined })), invalid)
  assert.deepEqual(parseLatestRelease(release({ body: 'x'.repeat(APP_UPDATE_MAX_RESPONSE_BYTES) })), invalid)
})
