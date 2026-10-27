import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchTiboPublicPosts,
  localDateKey,
  parseTiboPublicProfile,
  parseTiboSelfReplies,
} from '../src/x-public-source.mjs'

function profilePost({ id, timestamp, text }) {
  return `
    <li>
      <div role="link" data-href="/thsottiaux/status/${id}">
        <img alt="@thsottiaux">
        <script>formatRelativePastTimestamp({"timestamp":${Date.parse(timestamp)}})</script>
        <div class="text-body whitespace-pre-wrap wrap-break-word" dir="auto"><span>${text}</span></div>
      </div>
    </li>
  `
}

function profileHtml(posts) {
  return `<html><body><main aria-label="@thsottiaux"><ul>${posts.join('')}</ul></main></body></html>`
}

function conversationTweet({ id, timestamp, text, author = 'thsottiaux', replyToAuthor, replyToId }) {
  return {
    rest_id: id,
    result: {
      rest_id: id,
      core: { user_results: { result: { core: { screen_name: author } } } },
      details: { created_at_ms: Date.parse(timestamp), full_text: text },
      ...(replyToAuthor ? {
        reply_to_results: { rest_id: replyToId },
        reply_to_user_results: { result: { core: { screen_name: replyToAuthor } } },
      } : {}),
    },
  }
}

function conversationHtml(rootId, tweets) {
  const payload = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{
          entries: tweets.map(tweetResults => ({ content: { content: { tweet_results: tweetResults } } })),
        }],
      },
    },
  }
  return `<html><link rel="canonical" href="https://x.com/thsottiaux/status/${rootId}"><script>value:${JSON.stringify(JSON.stringify(payload))}</script></html>`
}

test('public profile parser keeps only posts from today in the local timezone', () => {
  const html = profileHtml([
    profilePost({
      id: '2113029655095836957',
      timestamp: '2026-10-21T16:30:00Z',
      text: 'Today &amp; local &lt;AI&gt;<br>Developer tool update.',
    }),
    profilePost({
      id: '2113029655095836956',
      timestamp: '2026-10-21T15:59:00Z',
      text: 'Yesterday in Taipei.',
    }),
    profilePost({
      id: '2113029655095836955',
      timestamp: '2026-10-22T03:10:01Z',
      text: 'Too far in the future.',
    }),
  ])

  const updates = parseTiboPublicProfile(html, {
    now: new Date('2026-10-22T03:00:00Z'),
    timeZone: 'Asia/Taipei',
  })

  assert.equal(updates.length, 1)
  assert.equal(updates[0].id, 'x-2113029655095836957')
  assert.equal(updates[0].summary, 'Today & local Developer tool update.')
  assert.equal(updates[0].publishedAt, '2026-10-22')
  assert.equal(updates[0].publishedAtTime, '2026-10-21T16:30:00.000Z')
  assert.equal(updates[0].sourceUrl, 'https://x.com/thsottiaux/status/2113029655095836957')
  assert.equal(updates[0].postKind, 'root')
})

test('conversation parser keeps only Tibo replies directed to Tibo', () => {
  const rootId = '2113162277688070445'
  const html = conversationHtml(rootId, [
    conversationTweet({
      id: rootId,
      timestamp: '2026-10-22T06:55:22Z',
      text: 'Root post.',
    }),
    conversationTweet({
      id: '2113162413008884099',
      timestamp: '2026-10-22T06:55:54Z',
      text: 'Lands tomorrow before 10am PST.',
      replyToAuthor: 'thsottiaux',
      replyToId: rootId,
    }),
    conversationTweet({
      id: '2113162537093267965',
      timestamp: '2026-10-22T06:56:24Z',
      text: 'Someone else replying to Tibo.',
      author: 'someoneelse',
      replyToAuthor: 'thsottiaux',
      replyToId: rootId,
    }),
    conversationTweet({
      id: '2113162537093267966',
      timestamp: '2026-10-22T06:56:25Z',
      text: 'Tibo replying to someone else.',
      replyToAuthor: 'someoneelse',
      replyToId: '2113162537093267965',
    }),
    conversationTweet({
      id: '2113162537093267967',
      timestamp: '2026-10-22T06:56:26Z',
      text: 'Unrelated Tibo-to-Tibo reply injected from another thread.',
      replyToAuthor: 'thsottiaux',
      replyToId: '2112000000000000000',
    }),
    conversationTweet({
      id: '2113162537093267968',
      timestamp: '2026-10-22T06:56:27Z',
      text: 'A second-level self reply.',
      replyToAuthor: 'thsottiaux',
      replyToId: '2113162413008884099',
    }),
    conversationTweet({
      id: '2113000000000000000',
      timestamp: '2026-10-21T06:56:25Z',
      text: 'Yesterday self reply.',
      replyToAuthor: 'thsottiaux',
      replyToId: rootId,
    }),
  ])

  const updates = parseTiboSelfReplies(html, {
    rootId,
    now: new Date('2026-10-22T07:00:00Z'),
    timeZone: 'UTC',
  })
  assert.deepEqual(updates.map(update => update.id).sort(), [
    'x-2113162413008884099',
    'x-2113162537093267968',
  ])
  assert.equal(updates.every(update => update.postKind === 'self-reply'), true)
  assert.equal(updates.find(update => update.id === 'x-2113162413008884099').replyToId, `x-${rootId}`)
})

test('public profile parser deduplicates rendered post markers and rejects changed markup', () => {
  const post = profilePost({
    id: '2113029655095836957',
    timestamp: '2026-10-22T01:00:00Z',
    text: 'One original post.',
  })
  const updates = parseTiboPublicProfile(profileHtml([post, post]), {
    now: new Date('2026-10-22T02:00:00Z'),
    timeZone: 'UTC',
  })
  assert.equal(updates.length, 1)
  assert.throws(() => parseTiboPublicProfile('<html>@thsottiaux</html>'), /x_profile_format_changed/)
  assert.throws(() => parseTiboPublicProfile('<html>other profile</html>'), /x_profile_invalid/)
})

test('public profile fetch uses the fixed page without credentials or redirects', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    const request = { url: String(url), options }
    requests.push(request)
    if (request.url === 'https://x.com/thsottiaux') {
      return new Response(profileHtml([profilePost({
        id: '2113029655095836957',
        timestamp: '2026-10-22T01:00:00Z',
        text: 'A public post.',
      })]), { status: 200, headers: { 'content-type': 'text/html' } })
    }
    return new Response(conversationHtml('2113029655095836957', [conversationTweet({
      id: '2113029655095836958',
      timestamp: '2026-10-22T01:01:00Z',
      text: 'A self reply.',
      replyToAuthor: 'thsottiaux',
      replyToId: '2113029655095836957',
    })]), { status: 200, headers: { 'content-type': 'text/html' } })
  }

  const updates = await fetchTiboPublicPosts({
    fetchImpl,
    now: new Date('2026-10-22T02:00:00Z'),
    timeZone: 'UTC',
  })
  assert.deepEqual(requests.map(request => request.url), [
    'https://x.com/thsottiaux',
    'https://x.com/thsottiaux/status/2113029655095836957',
  ])
  for (const request of requests) {
    assert.equal(request.options.redirect, 'manual')
    assert.equal(request.options.headers.authorization, undefined)
    assert.match(request.options.headers.accept, /text\/html/)
  }
  assert.deepEqual(updates.map(update => update.id), ['x-2113029655095836958', 'x-2113029655095836957'])
})

test('public profile fetch keeps roots when a conversation lookup fails', async () => {
  const updates = await fetchTiboPublicPosts({
    now: new Date('2026-10-22T02:00:00Z'),
    timeZone: 'UTC',
    fetchImpl: async (url) => String(url).endsWith('/thsottiaux')
      ? new Response(profileHtml([profilePost({
          id: '2113029655095836957',
          timestamp: '2026-10-22T01:00:00Z',
          text: 'A public post.',
        })]), { status: 200 })
      : new Response('unavailable', { status: 503 }),
  })
  assert.deepEqual(updates.map(update => update.id), ['x-2113029655095836957'])
})

test('local date keys honor the configured timezone', () => {
  assert.equal(localDateKey('2026-10-21T16:30:00Z', 'Asia/Taipei'), '2026-10-22')
  assert.equal(localDateKey('2026-10-21T16:30:00Z', 'America/Los_Angeles'), '2026-10-21')
  assert.equal(localDateKey('invalid', 'Asia/Taipei'), null)
})
