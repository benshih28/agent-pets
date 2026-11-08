import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOutcome, classifyInstallError, failedOutcome, reportFromWrites } from '../electron/install-outcome.ts'
import { ConfigRefusedError } from '../electron/safe-config-write.ts'

test('install outcome distinguishes installed, repaired and unchanged', () => {
  const written = reportFromWrites([
    { status: 'written', path: '/a', backupPath: '/a.bak' },
    { status: 'unchanged', path: '/b', backupPath: null },
  ])
  assert.deepEqual(written, { changedFiles: ['/a'], backupPaths: ['/a.bak'] })
  assert.equal(buildOutcome('codex', written, 'needs_install').action, 'installed')
  assert.equal(buildOutcome('codex', written, 'degraded').action, 'repaired')
  assert.equal(buildOutcome('codex', reportFromWrites([]), 'ready').action, 'unchanged')
})

test('install errors map to stable codes', () => {
  assert.deepEqual(classifyInstallError(new ConfigRefusedError('unparseable', '/c', 'x')), { code: 'config_unparseable', path: '/c' })
  assert.equal(classifyInstallError(new ConfigRefusedError('too_large', '/c', 'x')).code, 'config_too_large')
  assert.equal(classifyInstallError(Object.assign(new Error('x'), { code: 'EACCES', path: '/p' })).code, 'permission_denied')
  assert.equal(classifyInstallError(Object.assign(new Error('x'), { code: 'EBUSY' })).code, 'file_busy')
  assert.equal(classifyInstallError(Object.assign(new Error('x'), { code: 'EROFS' })).code, 'read_only')
  assert.equal(classifyInstallError(new Error('boom')).code, 'unknown')
  assert.equal(failedOutcome('claude-code', new Error('boom')).action, 'failed')
})

import { NodeNotFoundError, NodeUnsupportedError } from '../electron/node-resolver.ts'

test('missing or old Node.js maps to dedicated install error codes', () => {
  assert.equal(classifyInstallError(new NodeNotFoundError()).code, 'node_missing')
  assert.equal(classifyInstallError(new NodeUnsupportedError('v16.1.0')).code, 'node_unsupported')
})
