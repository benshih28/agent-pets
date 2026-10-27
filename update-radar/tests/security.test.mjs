import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedSourceUrl } from '../src/config.mjs'
import { fetchOfficialSource } from '../src/fetch-source.mjs'
import { resolveRadarRoute } from '../src/server.mjs'

test('source allowlist accepts only fixed official HTTPS paths', () => {
  assert.equal(isAllowedSourceUrl('https://developers.openai.com/api/docs/changelog.md'), true)
  assert.equal(isAllowedSourceUrl('https://platform.claude.com/docs/en/release-notes/overview.md'), true)
  assert.equal(isAllowedSourceUrl('https://api.github.com/repos/anthropics/claude-code/releases?per_page=10'), true)
  assert.equal(isAllowedSourceUrl('https://x.com/thsottiaux'), true)
  assert.equal(isAllowedSourceUrl('https://x.com/thsottiaux/status/2113162277688070445'), true)
  assert.equal(isAllowedSourceUrl('http://developers.openai.com/api/docs/changelog.md'), false)
  assert.equal(isAllowedSourceUrl('https://developers.openai.com.evil.example/api/docs/changelog.md'), false)
  assert.equal(isAllowedSourceUrl('https://api.github.com/repos/anthropics/claude-code/releases?per_page=100'), false)
  assert.equal(isAllowedSourceUrl('https://api.github.com/repos/other/repo/releases?per_page=10'), false)
  assert.equal(isAllowedSourceUrl('https://x.com/other'), false)
  assert.equal(isAllowedSourceUrl('https://x.com/thsottiaux/status/not-a-number'), false)
  assert.equal(isAllowedSourceUrl('https://x.com/other/status/2113162277688070445'), false)
  assert.equal(isAllowedSourceUrl('https://x.com/thsottiaux?lang=en'), false)
  assert.equal(isAllowedSourceUrl('https://x.com.evil.example/thsottiaux'), false)
})

test('local server routing is read-only and exposes only fixed paths', () => {
  assert.equal(resolveRadarRoute('GET', '/healthz').status, 200)
  assert.equal(resolveRadarRoute('HEAD', '/feed.json').status, 200)
  assert.equal(resolveRadarRoute('GET', '/styles.css').kind, 'static')
  assert.equal(resolveRadarRoute('GET', '/thread-groups.js').kind, 'static')
  assert.equal(resolveRadarRoute('GET', '/update-insights.js').kind, 'static')
  assert.equal(resolveRadarRoute('GET', '/package.json').status, 404)
  assert.equal(resolveRadarRoute('GET', '/../../package.json').status, 404)
  assert.equal(resolveRadarRoute('POST', '/feed.json').status, 405)
})

test('redirects are revalidated against the official-source allowlist', async () => {
  const fetchImpl = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://evil.example/changelog.md' },
  })
  await assert.rejects(
    fetchOfficialSource('https://developers.openai.com/api/docs/changelog.md', { fetchImpl }),
    /source_url_not_allowed/,
  )
})

test('declared oversized source responses are rejected before parsing', async () => {
  const fetchImpl = async () => new Response('small', {
    status: 200,
    headers: { 'content-length': String(3 * 1024 * 1024) },
  })
  await assert.rejects(
    fetchOfficialSource('https://developers.openai.com/api/docs/changelog.md', { fetchImpl }),
    /source_too_large/,
  )
})

test('public X profile requests reject redirects without a second request', async () => {
  let calls = 0
  const fetchImpl = async (_url, options) => {
    calls += 1
    assert.equal(options.headers.authorization, undefined)
    return new Response(null, {
      status: 302,
      headers: { location: 'https://x.com/i/flow/login' },
    })
  }
  await assert.rejects(
    fetchOfficialSource('https://x.com/thsottiaux', {
      fetchImpl,
      maxRedirects: 0,
    }),
    /redirect_rejected/,
  )
  assert.equal(calls, 1)
})
