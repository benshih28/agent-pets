import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPluginIssueReportUrl, DEFAULT_PLUGIN_ISSUE_REPORT_URL } from '../electron/plugin-report.ts'

const REPORT_BASE = 'https://github.com/example/agent-pets-plugins/issues/new'

test('plugin issue report URL contains only the encoded plugin identity and version', () => {
  const url = buildPluginIssueReportUrl(REPORT_BASE, 'sample-plugin', '1.2.3', false)
  assert.ok(url)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('title'), '[sample-plugin] 1.2.3')
  assert.deepEqual([...parsed.searchParams.keys()], ['title'])
  assert.equal(parsed.pathname, '/example/agent-pets-plugins/issues/new')
})

test('local issue report titles identify local installs without adding machine data', () => {
  const url = buildPluginIssueReportUrl(REPORT_BASE, 'sample-plugin', '1.2.3', true)
  assert.ok(url)
  assert.equal(new URL(url).searchParams.get('title'), '[local install] [sample-plugin] 1.2.3')
  assert.deepEqual([...new URL(url).searchParams.keys()], ['title'])
})

test('production plugin issue reports use the fixed public repository destination', () => {
  const url = buildPluginIssueReportUrl(DEFAULT_PLUGIN_ISSUE_REPORT_URL, 'sample-plugin', '1.2.3', false)
  assert.ok(url)
  assert.equal(new URL(url).origin + new URL(url).pathname, DEFAULT_PLUGIN_ISSUE_REPORT_URL)
})

test('plugin issue report URL rejects invalid identifiers, versions, and destinations', () => {
  assert.equal(buildPluginIssueReportUrl(REPORT_BASE, '../sample', '1.2.3', false), null)
  assert.equal(buildPluginIssueReportUrl(REPORT_BASE, 'sample-plugin', '1.2.x', false), null)
  assert.equal(buildPluginIssueReportUrl('http://github.com/example/repo/issues/new', 'sample-plugin', '1.2.3', false), null)
  assert.equal(buildPluginIssueReportUrl('https://evil.example/example/repo/issues/new', 'sample-plugin', '1.2.3', false), null)
})
