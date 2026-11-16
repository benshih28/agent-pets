import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { APP_UPDATE_API_URL, APP_UPDATE_RELEASES_PREFIX } from '../electron/app-update.ts'
import { AppUpdateStore, sanitizeAppUpdateStored } from '../electron/app-update-store.ts'
import { createAppUpdateRuntime } from '../electron/main/app-update-runtime.ts'
import type { PluginFeedController } from '../electron/plugin-feed.ts'
import { PluginNetworkClient } from '../electron/plugin-net.ts'
import { fakeService } from './support/fake-service.mts'
import { removeTempTree } from './support/temp-dir.mts'

const DAY = Date.UTC(2026, 10, 11, 8)

function releaseBody(tag: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ tag_name: tag, html_url: `${APP_UPDATE_RELEASES_PREFIX}tag/${tag}`, draft: false, prerelease: false, ...extra })
}

function setup(options: { body?: string; status?: number; version?: string; notificationAccepted?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-pets-update-test-'))
  const requested: string[] = []
  const notifications: Array<{ title: unknown; body: unknown }> = []
  const opened: string[] = []
  let now = DAY
  let body = options.body ?? releaseBody('v1.14.0')
  let status = options.status ?? 200
  const client = new PluginNetworkClient({
    lookupAll: async () => [{ address: '140.82.112.5', family: 4 }],
    request: async url => {
      requested.push(url)
      return new Response(body, { status, headers: { 'content-type': 'application/json' } })
    },
    now: () => now,
  })
  const runtime = createAppUpdateRuntime({
    state: {
      pluginNetworkClient: client,
      pluginFeedController: fakeService<PluginFeedController>({ addSystemNotification: (_id: unknown, _name: unknown, title: unknown, text: unknown) => {
        notifications.push({ title, body: text })
        return options.notificationAccepted ?? true
      } }),
    },
    userDataDirectory: () => dir,
    appVersion: () => options.version ?? '1.13.1',
    translate: (key, params) => `${key}:${params?.version ?? ''}`,
    openExternal: async url => { opened.push(url) },
    now: () => now,
  })
  return {
    dir, runtime, requested, notifications, opened,
    setBody: (value: string, nextStatus = 200) => { body = value; status = nextStatus },
    setNow: (value: number) => { now = value },
    cleanup: () => { runtime.dispose(); removeTempTree(dir) },
  }
}

test('the check is off by default and a fresh install persists nothing', () => {
  const h = setup()
  try {
    assert.deepEqual(h.runtime.getState(), { currentVersion: '1.13.1', enabled: false, lastCheckedAt: null, lastResult: null, latestVersion: null })
  } finally { h.cleanup() }
})

test('the automatic schedule never touches the network while the toggle is off', async () => {
  const h = setup()
  try {
    h.runtime.initializeAutoCheck()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(h.requested, [])
    assert.equal(h.notifications.length, 0)
  } finally { h.cleanup() }
})

test('enabling the toggle triggers one automatic check against the fixed GitHub API URL and notifies once per version', async () => {
  const h = setup()
  try {
    h.runtime.initializeAutoCheck()
    h.runtime.setEnabled(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepEqual(h.requested, [APP_UPDATE_API_URL])
    assert.equal(h.runtime.getState().lastResult, 'update_available')
    assert.equal(h.runtime.getState().latestVersion, '1.14.0')
    assert.equal(h.notifications.length, 1)
    assert.match(String(h.notifications[0]?.body), /1\.14\.0/)

    // 隔天再檢查：同一版本不重複提示。
    h.setNow(DAY + 25 * 3_600_000)
    await h.runtime.checkNow()
    assert.equal(h.notifications.length, 1)
  } finally { h.cleanup() }
})

test('a newer release announced after the first one is announced again', async () => {
  const h = setup()
  try {
    h.runtime.initializeAutoCheck()
    h.runtime.setEnabled(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(h.notifications.length, 1)
    h.setBody(releaseBody('v1.15.0'))
    h.setNow(DAY + 25 * 3_600_000)
    // 重新開關會觸發一次當日排程檢查（已隔天）。
    h.runtime.setEnabled(false)
    h.runtime.setEnabled(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(h.runtime.getState().latestVersion, '1.15.0')
    assert.equal(h.notifications.length, 2)
  } finally { h.cleanup() }
})

test('manual check works regardless of the toggle and reports up to date, new version, or failure', async () => {
  const h = setup({ version: '1.14.0' })
  try {
    assert.deepEqual((await h.runtime.checkNow()).outcome, 'done')
    assert.equal(h.runtime.getState().lastResult, 'up_to_date')
    assert.equal(h.runtime.getState().lastCheckedAt, DAY)
    h.setBody(releaseBody('v1.15.0'))
    h.setNow(DAY + 61_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'update_available')
    h.setBody('not json')
    h.setNow(DAY + 122_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'failed')
    // 失敗不抹掉先前確認過的新版。
    assert.equal(h.runtime.getState().latestVersion, '1.15.0')
    h.setBody('{}', 500)
    h.setNow(DAY + 183_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'failed')
    h.setBody('{}', 404)
    h.setNow(DAY + 244_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'up_to_date')
    assert.equal(h.runtime.getState().latestVersion, null)
  } finally { h.cleanup() }
})

test('a failed check keeps the known update and openRelease; a later up_to_date clears it', async () => {
  const h = setup()
  try {
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().latestVersion, '1.14.0')
    h.setBody('not json')
    h.setNow(DAY + 61_000)
    await h.runtime.checkNow()
    const failed = h.runtime.getState()
    assert.equal(failed.lastResult, 'failed')
    assert.equal(failed.latestVersion, '1.14.0')
    assert.equal(failed.lastCheckedAt, DAY + 61_000)
    assert.equal(await h.runtime.openRelease(), true)
    assert.deepEqual(h.opened, [`${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0`])
    // 重啟後仍保留。
    assert.equal(new AppUpdateStore(h.dir).get().latestVersion, '1.14.0')
    h.setBody(releaseBody('v1.13.1'))
    h.setNow(DAY + 122_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'up_to_date')
    assert.equal(h.runtime.getState().latestVersion, null)
    assert.equal(await h.runtime.openRelease(), false)
  } finally { h.cleanup() }
})

test('a stored update that the running app has already reached is no longer shown', async () => {
  const h = setup()
  try {
    await h.runtime.checkNow()
    const upgraded = createAppUpdateRuntime({
      state: { pluginNetworkClient: null, pluginFeedController: null },
      userDataDirectory: () => h.dir,
      appVersion: () => '1.14.0',
      translate: key => key,
      openExternal: async url => { h.opened.push(url) },
      now: () => DAY,
    })
    assert.equal(upgraded.getState().latestVersion, null)
    assert.equal(await upgraded.openRelease(), false)
  } finally { h.cleanup() }
})

test('drafts, prereleases and an older latest tag never prompt', async () => {
  for (const body of [releaseBody('v9.0.0', { draft: true }), releaseBody('v9.0.0', { prerelease: true }), releaseBody('v1.0.0')]) {
    const h = setup({ body })
    try {
      await h.runtime.checkNow()
      assert.equal(h.runtime.getState().lastResult, 'up_to_date')
    } finally { h.cleanup() }
  }
})

test('manual checks are rate limited per minute', async () => {
  const h = setup()
  try {
    const outcomes: string[] = []
    for (let index = 0; index < 5; index += 1) outcomes.push((await h.runtime.checkNow()).outcome)
    assert.deepEqual(outcomes, ['done', 'done', 'done', 'rate_limited', 'rate_limited'])
    assert.equal(h.requested.length, 3)
    h.setNow(DAY + 61_000)
    assert.equal((await h.runtime.checkNow()).outcome, 'done')
  } finally { h.cleanup() }
})

test('concurrent manual checks share one request', async () => {
  const h = setup()
  try {
    const first = h.runtime.checkNow()
    const second = await h.runtime.checkNow()
    assert.equal(second.outcome, 'in_progress')
    assert.equal((await first).outcome, 'done')
    assert.equal(h.requested.length, 1)
  } finally { h.cleanup() }
})

test('network failures and a missing network client fail silently', async () => {
  const h = setup()
  try {
    const failing = createAppUpdateRuntime({
      state: { pluginNetworkClient: null, pluginFeedController: null },
      userDataDirectory: () => h.dir,
      appVersion: () => '1.13.1',
      translate: key => key,
      openExternal: async () => {},
      now: () => DAY,
    })
    assert.equal((await failing.checkNow()).state.lastResult, 'failed')
  } finally { h.cleanup() }
})

test('a notification the feed refused is retried on the next check', async () => {
  const h = setup({ notificationAccepted: false })
  try {
    h.runtime.initializeAutoCheck()
    h.runtime.setEnabled(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(h.notifications.length, 1)
    assert.equal(h.runtime.getState().lastResult, 'update_available')
  } finally { h.cleanup() }
})

test('openRelease opens only the stored validated release URL, never anything renderer-supplied', async () => {
  const h = setup()
  try {
    assert.equal(await h.runtime.openRelease(), false)
    await h.runtime.checkNow()
    assert.equal(await h.runtime.openRelease(), true)
    assert.deepEqual(h.opened, [`${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0`])
  } finally { h.cleanup() }
})

test('a hostile html_url is replaced before it is stored or opened', async () => {
  const h = setup({ body: releaseBody('v1.14.0', { html_url: 'https://evil.example/phish' }) })
  try {
    await h.runtime.checkNow()
    await h.runtime.openRelease()
    assert.deepEqual(h.opened, [`${APP_UPDATE_RELEASES_PREFIX}tag/v1.14.0`])
  } finally { h.cleanup() }
})

test('e2e mode reads only the fixture and never reaches the network client', async () => {
  const h = setup()
  const globals = globalThis as typeof globalThis & { __agentPetsE2E?: unknown }
  try {
    globals.__agentPetsE2E = { appUpdateFixture: { status: 200, body: releaseBody('v999.0.0') } }
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().latestVersion, '999.0.0')
    globals.__agentPetsE2E = {}
    h.setNow(DAY + 61_000)
    await h.runtime.checkNow()
    assert.equal(h.runtime.getState().lastResult, 'failed')
    assert.deepEqual(h.requested, [])
  } finally {
    delete globals.__agentPetsE2E
    h.cleanup()
  }
})

test('the toggle, last check and latest version persist across restarts', async () => {
  const h = setup()
  try {
    h.runtime.setEnabled(true)
    await h.runtime.checkNow()
    const reopened = new AppUpdateStore(h.dir).get()
    assert.equal(reopened.enabled, true)
    assert.equal(reopened.latestVersion, '1.14.0')
    assert.equal(reopened.lastCheckedAt, DAY)
    assert.equal(JSON.parse(readFileSync(join(h.dir, 'app-update.json'), 'utf8')).enabled, true)
  } finally { h.cleanup() }
})

test('the stored file is sanitized: wrong types, tampered URLs and oversized files fall back to defaults', () => {
  assert.equal(sanitizeAppUpdateStored({ enabled: 'yes' }).enabled, false)
  assert.equal(sanitizeAppUpdateStored(null).enabled, false)
  assert.equal(sanitizeAppUpdateStored([]).lastCheckedAt, null)
  const tampered = sanitizeAppUpdateStored({
    enabled: true, lastResult: 'update_available', latestVersion: '2.0.0', latestUrl: 'https://evil.example/x', lastCheckedAt: DAY,
  })
  assert.equal(tampered.latestUrl, null)
  assert.equal(tampered.latestVersion, null)
  assert.equal(tampered.lastResult, null)
  assert.equal(tampered.enabled, true)
  assert.equal(sanitizeAppUpdateStored({ lastCheckedAt: -5 }).lastCheckedAt, null)
  assert.equal(sanitizeAppUpdateStored({ lastCheckedDay: '2026-13-xx' }).lastCheckedDay, null)

  const dir = mkdtempSync(join(tmpdir(), 'agent-pets-update-test-'))
  try {
    writeFileSync(join(dir, 'app-update.json'), JSON.stringify({ enabled: true, pad: 'x'.repeat(70 * 1024) }))
    assert.equal(new AppUpdateStore(dir).get().enabled, false)
    writeFileSync(join(dir, 'app-update.json'), '{broken')
    assert.equal(new AppUpdateStore(dir).get().enabled, false)
  } finally { removeTempTree(dir) }
})
