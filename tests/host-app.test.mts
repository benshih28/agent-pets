import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidBundleId, parseHostHints, resolveHostBundleId } from '../electron/host-app.ts'
import { normalizeAgentStatusEvent } from '../electron/event-normalizer.ts'
import { HOST_APPS } from '../src/types/host-app.ts'

test('maps terminal, IDE and desktop hints onto the allowlist', () => {
  assert.deepEqual(parseHostHints({ termProgram: 'iTerm.app' }), { host: { kind: 'terminal', app: 'iterm2' } })
  assert.deepEqual(parseHostHints({ termProgram: 'Apple_Terminal' }), { host: { kind: 'terminal', app: 'apple-terminal' } })
  assert.deepEqual(parseHostHints({ termProgram: 'vscode' }), { host: { kind: 'ide', app: 'vscode' } })
  assert.deepEqual(parseHostHints({ termProgram: 'vscode', cursor: true }), { host: { kind: 'ide', app: 'cursor' } })
  assert.deepEqual(parseHostHints({ entrypoint: 'claude-desktop' }), { host: { kind: 'desktop', app: 'claude-desktop' } })
  assert.deepEqual(parseHostHints({ entrypoint: 'claude-vscode' }), { host: { kind: 'ide', app: 'vscode' } })
  assert.deepEqual(parseHostHints({ windowsTerminal: true }), { host: { kind: 'terminal', app: 'windows-terminal' } })
})

test('an allowlisted bundle id wins over TERM_PROGRAM (tmux inside iTerm2, VS Code forks)', () => {
  assert.deepEqual(
    parseHostHints({ termProgram: 'tmux', bundleId: 'com.googlecode.iterm2' }),
    { host: { kind: 'terminal', app: 'iterm2' }, bundleId: 'com.googlecode.iterm2' },
  )
  assert.deepEqual(
    parseHostHints({ termProgram: 'vscode', bundleId: 'com.todesktop.230313mzl4w4u92' }),
    { host: { kind: 'ide', app: 'cursor' }, bundleId: 'com.todesktop.230313mzl4w4u92' },
  )
})

test('unknown, malformed or oversized hints never yield a bundle id', () => {
  assert.equal(parseHostHints(undefined), null)
  assert.equal(parseHostHints('iTerm.app'), null)
  assert.equal(parseHostHints(['iTerm.app']), null)
  assert.deepEqual(parseHostHints({}), { host: { kind: 'unknown', app: 'unknown' } })
  // Valid reverse-DNS but not on the allowlist: dropped, never activated.
  assert.deepEqual(parseHostHints({ bundleId: 'com.evil.Launcher' }), { host: { kind: 'unknown', app: 'unknown' } })
  assert.deepEqual(parseHostHints({ bundleId: 'com.apple.Terminal; rm -rf /' }), { host: { kind: 'unknown', app: 'unknown' } })
  assert.deepEqual(parseHostHints({ termProgram: 'x'.repeat(33) }), { host: { kind: 'unknown', app: 'unknown' } })
  assert.deepEqual(parseHostHints({ termProgram: 'iTerm.app', env: { HOME: '/Users/x' } }), { host: { kind: 'unknown', app: 'unknown' } })
  assert.deepEqual(parseHostHints({ windowsTerminal: 'yes', vscode: 1 }), { host: { kind: 'unknown', app: 'unknown' } })
  for (const termProgram of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(parseHostHints({ termProgram }), { host: { kind: 'unknown', app: 'unknown' } }, termProgram)
  }
  // A client cannot set kind or app directly.
  assert.deepEqual(parseHostHints({ kind: 'ide', app: 'vscode' }), { host: { kind: 'unknown', app: 'unknown' } })
})

test('bundle id validation is strict reverse-DNS with a length cap', () => {
  assert.equal(isValidBundleId('com.apple.Terminal'), true)
  assert.equal(isValidBundleId('dev.warp.Warp-Stable'), true)
  for (const bad of ['', 'Terminal', '-a.Calculator', 'com.-x', '.com.apple', 'com..apple', 'com.apple.', '-b com.x', 'com/apple', `a.${'b'.repeat(130)}`, 'com.apple.Terminal\n']) {
    assert.equal(isValidBundleId(bad), false, bad)
  }
})

test('only allowlisted bundle ids are ever resolved for activation', () => {
  assert.equal(resolveHostBundleId('iterm2'), 'com.googlecode.iterm2')
  assert.equal(resolveHostBundleId('warp', 'dev.warp.Warp-Preview'), 'dev.warp.Warp-Preview')
  assert.equal(resolveHostBundleId('iterm2', 'com.evil.Launcher'), 'com.googlecode.iterm2')
  // Ambiguous app with no reported bundle, and apps with no macOS bundle at all.
  assert.equal(resolveHostBundleId('jetbrains'), null)
  assert.equal(resolveHostBundleId('jetbrains', 'com.jetbrains.goland'), 'com.jetbrains.goland')
  assert.equal(resolveHostBundleId('windows-terminal'), null)
  assert.equal(resolveHostBundleId('unknown'), null)
  assert.equal(resolveHostBundleId(undefined), null)
  for (const definition of Object.values(HOST_APPS)) {
    for (const bundleId of definition.bundleIds) assert.equal(isValidBundleId(bundleId), true, bundleId)
    if (definition.defaultBundleId) assert.ok(definition.bundleIds.includes(definition.defaultBundleId))
  }
})

test('the normalized event carries only kind and app, never the bundle id', () => {
  const result = normalizeAgentStatusEvent({
    source: 'claude',
    sessionId: 's1',
    state: 'thinking',
    timestamp: 1,
    host: { termProgram: 'iTerm.app', bundleId: 'com.googlecode.iterm2' },
  }, 5)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.event.host, { kind: 'terminal', app: 'iterm2' })
  assert.doesNotMatch(JSON.stringify(result.event), /googlecode/)

  const withoutHost = normalizeAgentStatusEvent({ source: 'codex', sessionId: 's2', state: 'idle', timestamp: 1 }, 5)
  assert.equal(withoutHost.ok && 'host' in withoutHost.event, false)
})
