import assert from 'node:assert/strict'
import test from 'node:test'
import { linkHost } from '../src/utils/link-host.ts'

test('link host only exposes the hostname', () => {
  assert.equal(linkHost('https://docs.example.com/a/b?q=1'), 'docs.example.com')
  assert.equal(linkHost('not a url'), '')
  assert.equal(linkHost(undefined), '')
})
