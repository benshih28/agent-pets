import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PluginExternalLinkController,
  PLUGIN_EXTERNAL_LINKS_PER_MINUTE,
  PLUGIN_EXTERNAL_LINK_WINDOW_MS,
} from '../electron/plugin-external-links.ts'
import { PluginUserActivationGuard } from '../electron/plugin-user-activation.ts'

function createFixture() {
  let now = 10_000
  let context = {
    enabled: true,
    pluginsEnabled: true,
    hosts: ['developers.openai.com'] as readonly string[],
  }
  const opened: string[] = []
  let fail = false
  const controller = new PluginExternalLinkController({
    getContext: pluginId => pluginId === 'update-radar' ? context : null,
    openExternal: async url => {
      if (fail) throw new Error('unavailable')
      opened.push(url)
    },
    now: () => now,
  })
  return {
    controller,
    opened,
    setNow: (value: number) => { now = value },
    setContext: (value: typeof context) => { context = value },
    setFail: (value: boolean) => { fail = value },
  }
}

test('external links require a trusted user activation and an enabled declared host', async () => {
  const fixture = createFixture()
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/api/docs/changelog', false),
    { ok: false, error: 'denied' },
  )
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/api/docs/changelog', true),
    { ok: true, value: { opened: true } },
  )
  assert.deepEqual(fixture.opened, ['https://developers.openai.com/api/docs/changelog'])

  fixture.setContext({ enabled: false, pluginsEnabled: true, hosts: ['developers.openai.com'] })
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/', true),
    { ok: false, error: 'disabled' },
  )
  fixture.setContext({ enabled: true, pluginsEnabled: true, hosts: [] })
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/', true),
    { ok: false, error: 'not_permitted' },
  )
})

test('external link validation rejects alternate schemes, credentials, ports, subdomains, IPs, and unlisted hosts', async () => {
  const fixture = createFixture()
  for (const url of [
    'http://developers.openai.com/api/docs/changelog',
    'https://user:pass@developers.openai.com/api/docs/changelog',
    'https://developers.openai.com:444/api/docs/changelog',
    'https://sub.developers.openai.com/api/docs/changelog',
    'https://127.0.0.1/',
    'https://example.com/',
    'not a url',
  ]) {
    assert.deepEqual(await fixture.controller.open('update-radar', url, true), { ok: false, error: 'host_not_allowed' }, url)
  }
  assert.deepEqual(fixture.opened, [])
})

test('external links are rate-limited per plugin and recover after the sliding window', async () => {
  const fixture = createFixture()
  for (let index = 0; index < PLUGIN_EXTERNAL_LINKS_PER_MINUTE; index += 1) {
    assert.equal((await fixture.controller.open('update-radar', 'https://developers.openai.com/', true)).ok, true)
  }
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/', true),
    { ok: false, error: 'rate_limited' },
  )
  fixture.setNow(10_000 + PLUGIN_EXTERNAL_LINK_WINDOW_MS)
  assert.equal((await fixture.controller.open('update-radar', 'https://developers.openai.com/', true)).ok, true)
})

test('external link host failures use a stable error and still consume the attempt', async () => {
  const fixture = createFixture()
  fixture.setFail(true)
  assert.deepEqual(
    await fixture.controller.open('update-radar', 'https://developers.openai.com/', true),
    { ok: false, error: 'host_unavailable' },
  )
  assert.deepEqual(fixture.opened, [])
})

test('panel user activation is trusted, one-shot, short-lived, and does not double-count keyboard click', () => {
  const guard = new PluginUserActivationGuard()
  guard.recordClick({ isTrusted: false, detail: 1 }, 1_000)
  assert.equal(guard.consume(1_000), false)

  guard.recordClick({ isTrusted: true, detail: 1 }, 2_000)
  assert.equal(guard.consume(2_500), true)
  assert.equal(guard.consume(2_500), false)

  guard.recordClick({ isTrusted: true, detail: 1 }, 4_000)
  assert.equal(guard.consume(5_001), false)

  guard.recordKeyboard({ isTrusted: true, key: 'Enter', repeat: false }, 6_000)
  assert.equal(guard.consume(6_000), true)
  guard.recordClick({ isTrusted: true, detail: 0 }, 6_010)
  assert.equal(guard.consume(6_010), false)

  guard.recordKeyboard({ isTrusted: true, key: ' ', repeat: true }, 7_000)
  assert.equal(guard.consume(7_000), false)
})
