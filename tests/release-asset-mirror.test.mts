import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRequest } from '../scripts/release-asset-mirror.mjs'

test('the release mirror accepts only the two known repositories and plain tag/file names', () => {
  assert.deepEqual(parseRequest('/electron/v43.3.0/SHASUMS256.txt'), { repository: 'electron/electron', tag: 'v43.3.0', file: 'SHASUMS256.txt' })
  assert.deepEqual(parseRequest('/builder/icons%401.1.0/icons-bundle.tar.gz'), { repository: 'electron-userland/electron-builder-binaries', tag: 'icons@1.1.0', file: 'icons-bundle.tar.gz' })
  assert.deepEqual(parseRequest('/builder/icons@1.1.0/icons-bundle.tar.gz')?.tag, 'icons@1.1.0')

  for (const rejected of [
    '/other/v1/file.zip',
    '/electron/v1',
    '/electron/v1/a/b',
    '/builder/..%2Fx/a',
    '/builder/v1/..',
    '/builder/v1/.hidden',
    '/electron/v1/a%2Fb',
    '/electron/%E0%A4%A/file',
    `/electron/v1/${'a'.repeat(200)}`,
  ]) assert.equal(parseRequest(rejected), null, rejected)
})
