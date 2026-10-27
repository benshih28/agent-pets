import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDatedMarkdown, parseGithubReleases } from '../src/normalize.mjs'

test('OpenAI dated changelog entries keep their date and API classification', () => {
  const definition = {
    id: 'openai-api',
    provider: 'openai',
    product: 'api',
    publicUrl: 'https://developers.openai.com/api/docs/changelog',
    splitBullets: false,
    maxItems: 10,
  }
  const markdown = `
## October, 2026

### Oct 20

Feature · API: v1/responses

You can now choose 12-hour prompt caching in the API.

### Oct 16

Fix · Model: gpt-example

Fixed image input handling for \`gpt-example\`.
`
  const updates = parseDatedMarkdown(definition, markdown)
  assert.equal(updates.length, 2)
  assert.equal(updates[0].publishedAt, '2026-10-20')
  assert.equal(updates[0].category, 'api-change')
  assert.equal(updates[1].changeType, 'fixed')
  assert.deepEqual(updates[1].subjects, ['gpt-example'])
})

test('Anthropic release-note bullets become separate updates', () => {
  const definition = {
    id: 'anthropic-platform',
    provider: 'anthropic',
    product: 'api',
    publicUrl: 'https://platform.claude.com/docs/en/release-notes/overview',
    splitBullets: true,
    maxItems: 10,
  }
  const markdown = `
### October 21, 2026

- Released API version \`2026-10-21\`.
- Added a new SDK parameter for tool calls.
`
  const updates = parseDatedMarkdown(definition, markdown)
  assert.equal(updates.length, 2)
  assert.equal(updates[0].provider, 'anthropic')
  assert.equal(updates[1].category, 'developer-tool')
})

test('Claude Code GitHub releases retain version, date, and safe release URL', () => {
  const definition = {
    id: 'claude-code',
    provider: 'anthropic',
    product: 'claude-code',
    publicUrl: 'https://github.com/anthropics/claude-code/releases',
    maxItems: 10,
  }
  const releases = JSON.stringify([{
    tag_name: 'v2.1.307',
    published_at: '2026-10-22T02:00:00Z',
    html_url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.307',
    body: '- Added an API migration command\n- Fixed MCP retry behavior',
  }])
  const updates = parseGithubReleases(definition, releases)
  assert.equal(updates.length, 2)
  assert.equal(updates[0].version, 'v2.1.307')
  assert.equal(updates[0].publishedAt, '2026-10-22')
  assert.equal(updates[1].changeType, 'fixed')
})

test('malformed GitHub JSON is rejected', () => {
  const definition = { id: 'claude-code', provider: 'anthropic', product: 'claude-code', maxItems: 10 }
  assert.throws(() => parseGithubReleases(definition, '{'), /invalid_github_json/)
})

test('Claude Code environment variables are developer tools, not model releases', () => {
  const definition = {
    id: 'claude-code',
    provider: 'anthropic',
    product: 'claude-code',
    publicUrl: 'https://github.com/anthropics/claude-code/releases',
    maxItems: 10,
  }
  const releases = JSON.stringify([{
    tag_name: 'v2.1.307',
    published_at: '2026-10-22T02:00:00Z',
    html_url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.307',
    body: '- Fixed `CLAUDE_CODE_CERT_STORE` handling in VS Code',
  }])
  const [update] = parseGithubReleases(definition, releases)
  assert.equal(update.category, 'developer-tool')
  assert.match(update.title, /CLAUDE_CODE_CERT_STORE/)
})

test('a feature mentioning a model is not treated as a new model release', () => {
  const definition = {
    id: 'openai-api',
    provider: 'openai',
    product: 'api',
    publicUrl: 'https://developers.openai.com/api/docs/changelog',
    splitBullets: false,
    maxItems: 10,
  }
  const markdown = `
## September, 2026

### Sep 8

Feature · Model: gpt-5.6-sol · API: v1/responses

Prompt Cache Diagnostics is now generally available for GPT-5.6 Sol.
`
  const [update] = parseDatedMarkdown(definition, markdown)
  assert.equal(update.category, 'api-change')
})
