import test from 'node:test'
import assert from 'node:assert/strict'
import { groupUpdatesForDisplay } from '../public/thread-groups.js'

function xPost(id, postKind, replyToId, publishedAtTime) {
  return { id: `x-${id}`, sourceId: 'x-ajambrosino', provider: 'x', postKind, replyToId, publishedAtTime }
}

test('groups a @ajambrosino root and self-replies into one chronological conversation', () => {
  const root = xPost('100', 'root', undefined, '2026-10-22T08:00:00Z')
  const reply = xPost('101', 'self-reply', 'x-100', '2026-10-22T08:01:00Z')
  const nestedReply = xPost('102', 'self-reply', 'x-101', '2026-10-22T08:02:00Z')
  const groups = groupUpdatesForDisplay([nestedReply, reply, root])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].kind, 'thread')
  assert.deepEqual(groups[0].updates.map(update => update.id), ['x-100', 'x-101', 'x-102'])
})

test('does not merge unrelated, missing-root, or non-@ajambrosino updates', () => {
  const root = xPost('200', 'root', undefined, '2026-10-22T08:00:00Z')
  const orphan = xPost('201', 'self-reply', 'x-999', '2026-10-22T08:01:00Z')
  const official = { id: 'openai-1', sourceId: 'openai-api', provider: 'openai' }
  const groups = groupUpdatesForDisplay([orphan, official, root])

  assert.equal(groups.length, 3)
  assert.ok(groups.every(group => group.kind === 'single'))
  assert.deepEqual(groups.map(group => group.updates[0].id), ['x-201', 'openai-1', 'x-200'])
})
