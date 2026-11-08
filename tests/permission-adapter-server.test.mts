import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { PermissionBroker } from '../electron/permission-broker.ts'
import {
  createPermissionAdapterServer,
  mapOpenCodeDecision,
  PermissionAdapterRelay,
  type PermissionAdapterSource,
} from '../electron/permission-adapter-server.ts'

const TOKEN = 'a'.repeat(64)

async function withServer(
  run: (context: {
    broker: PermissionBroker
    relay: PermissionAdapterRelay
    post: (path: string, body: unknown, token?: string) => Promise<Response>
  }) => Promise<void>,
  options: { isSourceEnabled?: (source: PermissionAdapterSource) => boolean, now?: () => number } = {},
) {
  const relay = new PermissionAdapterRelay()
  const broker = new PermissionBroker({
    randomId: (() => {
      let id = 0
      return () => `generated-${++id}`
    })(),
  })
  broker.registerAdapter(relay.createPort('opencode-cli'))
  broker.registerAdapter(relay.createPort('opencode-desktop'))
  broker.registerAdapter(relay.createPort('claude'))
  broker.registerAdapter(relay.createPort('claude-desktop'))
  const server = createPermissionAdapterServer({
    token: TOKEN,
    broker,
    relay,
    ...options,
    randomId: (() => {
      let id = 100
      return () => `server-${++id}`
    })(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const post = (path: string, body: unknown, token = TOKEN) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-pets-permission-token': token,
    },
    body: JSON.stringify(body),
  })

  try {
    await run({ broker, relay, post })
  } finally {
    broker.shutdown()
    relay.shutdown()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function permission(overrides: Record<string, unknown> = {}) {
  return {
    source: 'opencode-cli',
    instanceId: 'plugin-1',
    permissionId: 'per-1',
    sessionId: 'ses-1',
    project: 'C:/work/agent-pets',
    permission: 'bash',
    title: 'Run a local command',
    patterns: ['git status'],
    ...overrides,
  }
}

test('permission adapter server requires its dedicated token', async () => {
  await withServer(async ({ post }) => {
    const response = await post('/v1/permission/request', permission(), 'wrong-token')
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  })
})

test('permission adapter server rejects browser origins even with a valid token', async () => {
  await withServer(async ({ post }) => {
    const originalFetch = globalThis.fetch
    const response = await originalFetch(
      (await post('/v1/permission/request', permission())).url,
      {
        method: 'POST',
        headers: {
          origin: 'https://attacker.invalid',
          'content-type': 'application/json',
          'x-agent-pets-permission-token': TOKEN,
        },
        body: JSON.stringify(permission({ permissionId: 'per-origin' })),
      },
    )
    assert.equal(response.status, 403)
  })
})

test('request, decision, and acknowledgement complete exactly once', async () => {
  await withServer(async ({ broker, post }) => {
    const created = await post('/v1/permission/request', {
      ...permission(),
      callbackUrl: 'http://attacker.invalid/callback',
      responseHandle: 'forged-handle',
    })
    assert.equal(created.status, 201)
    const receipt = await created.json() as { requestId: string }
    assert.equal(receipt.requestId, 'server-102')

    const requests = broker.listRequests()
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.adapterId, 'opencode-cli')
    assert.equal(requests[0]?.projectId, 'agent-pets')
    assert.equal(requests[0]?.risk, 'high')
    assert.equal(JSON.stringify(requests).includes('attacker.invalid'), false)
    assert.equal(JSON.stringify(requests).includes('forged-handle'), false)

    const deciding = broker.decide(receipt.requestId, 'allow_once', 'bubble')
    const decisionResponse = await post('/v1/permission/decision', permission())
    assert.equal(decisionResponse.status, 200)
    const decision = await decisionResponse.json() as { decisionId: string; decision: string }
    assert.equal(decision.decision, 'allow_once')

    const forgedResult = await post('/v1/permission/result', {
      ...permission(),
      decisionId: 'wrong-decision',
      result: 'delivered',
    })
    assert.equal(forgedResult.status, 409)

    const result = await post('/v1/permission/result', {
      ...permission(),
      decisionId: decision.decisionId,
      result: 'delivered',
    })
    assert.equal(result.status, 204)
    assert.deepEqual(await deciding, { ok: true, status: 'allowed' })

    const replay = await post('/v1/permission/result', {
      ...permission(),
      decisionId: decision.decisionId,
      result: 'delivered',
    })
    assert.equal(replay.status, 409)
  })
})

test('duplicate create is idempotent and external Agent resolution cancels delivery', async () => {
  await withServer(async ({ broker, post }) => {
    const first = await post('/v1/permission/request', permission())
    const firstReceipt = await first.json() as { requestId: string }
    const duplicate = await post('/v1/permission/request', permission())
    assert.equal(duplicate.status, 200)
    assert.deepEqual(await duplicate.json(), firstReceipt)

    const deciding = broker.decide(firstReceipt.requestId, 'deny', 'hotkey')
    const polled = await post('/v1/permission/decision', permission())
    assert.equal(polled.status, 200)

    const resolved = await post('/v1/permission/resolved', permission())
    assert.equal(resolved.status, 204)
    assert.deepEqual(await deciding, { ok: false, error: 'conflict', status: 'cancelled' })
    assert.equal(broker.getAuditRecords()[0]?.terminalReason, 'agent_resolved')
  })
})

test('OpenCode decisions never map to permanent allow', () => {
  assert.equal(mapOpenCodeDecision('allow_once'), 'once')
  assert.equal(mapOpenCodeDecision('deny'), 'reject')
})

test('title and patterns both reach the broker view, redacted and bounded', async () => {
  await withServer(async ({ broker, post }) => {
    const created = await post('/v1/permission/request', permission({
      permissionId: 'per-details',
      title: 'Run a local command',
      patterns: ['git push https://user:hunter2@example.com/repo.git', 'cat /Users/alice/.ssh/config', 'x'.repeat(400)],
    }))
    assert.equal(created.status, 201)
    const view = broker.listRequests().find((item) => item.description === 'Run a local command')
    assert.ok(view)
    assert.equal(view.details.length, 3)
    assert.ok(!JSON.stringify(view).includes('hunter2'))
    assert.ok(!JSON.stringify(view).includes('alice'))
    assert.ok(view.details[1]?.startsWith('cat ~/.ssh/config'))
    assert.equal(view.details[2]?.length, 120)
    assert.equal(view.truncated, true)
    assert.equal(view.truncatedChars, 280)
  })
})

test('create budget is per plugin instance, not shared across the whole host', async () => {
  await withServer(async ({ post }) => {
    for (let index = 0; index < 60; index += 1) {
      const response = await post('/v1/permission/request', permission({
        permissionId: `per-${index}`, sessionId: `ses-${index}`,
      }))
      assert.equal(response.status, 201)
    }
    const limited = await post('/v1/permission/request', permission({ permissionId: 'per-over', sessionId: 'ses-over' }))
    assert.equal(limited.status, 429)
    const other = await post('/v1/permission/request', permission({
      instanceId: 'plugin-2', permissionId: 'per-other', sessionId: 'ses-other',
    }))
    assert.equal(other.status, 201)
  })
})

const NONCE_A = '1'.repeat(32)
const NONCE_B = '2'.repeat(32)

function claudePermission(overrides: Record<string, unknown> = {}) {
  return {
    source: 'claude',
    instanceId: 'claude-3f1c2a9e-1111-4222-8333-944455556666',
    permissionId: 'a'.repeat(32),
    sessionId: '3f1c2a9e-1111-4222-8333-944455556666',
    project: '/Users/alice/work/agent-pets',
    permission: 'Bash',
    detail: 'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://example.com',
    ttlSeconds: 30,
    nonce: NONCE_A,
    ...overrides,
  }
}

test('Claude requests use the Claude risk table, a redacted command and the hook wait as TTL', async () => {
  await withServer(async ({ broker, post }) => {
    const created = await post('/v1/permission/request', claudePermission())
    assert.equal(created.status, 201)
    const [view] = broker.listRequests()
    assert.ok(view)
    assert.equal(view.adapterId, 'claude')
    assert.equal(view.risk, 'high')
    assert.equal(view.hotkeyEligible, false)
    assert.equal(view.projectId, 'agent-pets')
    assert.ok(view.description.startsWith('curl -H'))
    assert.ok(!JSON.stringify(view).includes('abcdefghijklmnop1234'))
    assert.ok(!JSON.stringify(view).includes('alice'))
    assert.equal(view.expiresAt - view.receivedAt, 30_000)
    assert.deepEqual(view.allowedDecisions, ['allow_once', 'deny'])

    const cases: Array<[string, string, boolean]> = [
      ['Write', 'high', false], ['Edit', 'high', false], ['MultiEdit', 'high', false], ['NotebookEdit', 'high', false],
      ['WebFetch', 'high', true], ['WebSearch', 'high', true], ['mcp__github__create_issue', 'unknown', false], ['Task', 'unknown', false],
    ]
    for (const [index, [tool, risk, network]] of cases.entries()) {
      const response = await post('/v1/permission/request', claudePermission({ permissionId: `${index}`.padStart(32, 'b'), permission: tool, detail: undefined, scope: `agent-${index}` }))
      assert.equal(response.status, 201)
      const { requestId } = await response.json() as { requestId: string }
      const item = broker.listRequests().find(request => request.requestId === requestId)!
      assert.equal(item.risk, risk, tool)
      assert.equal(item.network, network, tool)
      assert.equal(item.description, `Claude Code requests ${tool} permission.`)
    }
  })
})

test('Claude TTL is clamped and OpenCode cannot borrow the Claude-only fields', async () => {
  await withServer(async ({ broker, post }) => {
    await post('/v1/permission/request', claudePermission({ ttlSeconds: 100_000 }))
    await post('/v1/permission/request', claudePermission({ permissionId: 'c'.repeat(32), ttlSeconds: 1, scope: 'agent-2' }))
    await post('/v1/permission/request', permission({ ttlSeconds: 299, detail: 'forged' }))
    const [high, low, opencode] = broker.listRequests()
    assert.equal(high!.expiresAt - high!.receivedAt, 120_000)
    assert.equal(low!.expiresAt - low!.receivedAt, 15_000)
    assert.equal(opencode!.expiresAt - opencode!.receivedAt, 60_000)
    assert.equal(opencode!.description, 'Run a local command')
  })
})

test('a disabled source cannot create requests, and an enabled one still needs the token', async () => {
  let enabled = false
  await withServer(async ({ broker, post }) => {
    const refused = await post('/v1/permission/request', claudePermission())
    assert.equal(refused.status, 503)
    assert.equal(broker.listRequests().length, 0)
    assert.equal((await post('/v1/permission/request', permission())).status, 201)

    enabled = true
    assert.equal((await post('/v1/permission/request', claudePermission(), 'f'.repeat(64))).status, 401)
    assert.equal((await post('/v1/permission/request', claudePermission({ source: 'claude-cli' }))).status, 400)
    assert.equal((await post('/v1/permission/request', claudePermission())).status, 201)
  }, { isSourceEnabled: source => !source.startsWith('claude') || enabled })
})

test('the same Claude request asked again after it finished becomes a new request', async () => {
  await withServer(async ({ broker, post }) => {
    const first = await (await post('/v1/permission/request', claudePermission())).json() as { requestId: string }
    // Still active: the hook retrying is idempotent.
    const retry = await post('/v1/permission/request', claudePermission())
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), first)

    const deciding = broker.decide(first.requestId, 'allow_once', 'bubble')
    const polled = await (await post('/v1/permission/decision', claudePermission())).json() as { decisionId: string }
    assert.equal((await post('/v1/permission/result', { ...claudePermission(), decisionId: polled.decisionId, result: 'delivered' })).status, 204)
    assert.deepEqual(await deciding, { ok: true, status: 'allowed' })
    // A finished request can never hand out its decision again.
    assert.equal((await post('/v1/permission/decision', claudePermission())).status, 410)

    const again = await post('/v1/permission/request', claudePermission())
    assert.equal(again.status, 201)
    const second = await again.json() as { requestId: string }
    assert.notEqual(second.requestId, first.requestId)
    assert.equal(broker.listRequests()[0]?.requestId, second.requestId)
    assert.equal((await post('/v1/permission/decision', claudePermission())).status, 204)
  })
})

test('resolved-session takes down only that Claude session, and a late decision poll gets 410', async () => {
  await withServer(async ({ broker, post }) => {
    await post('/v1/permission/request', claudePermission())
    await post('/v1/permission/request', claudePermission({ permissionId: 'd'.repeat(32), scope: 'agent-2' }))
    await post('/v1/permission/request', claudePermission({ instanceId: 'claude-other', sessionId: 'other', permissionId: 'e'.repeat(32) }))
    await post('/v1/permission/request', permission())
    assert.equal(broker.listRequests().length, 4)

    assert.equal((await post('/v1/permission/resolved-session', { source: 'claude', instanceId: 'bad id' })).status, 400)
    assert.equal((await post('/v1/permission/resolved-session', { source: 'claude-desktop', instanceId: 'claude-3f1c2a9e-1111-4222-8333-944455556666' })).status, 204)
    assert.equal(broker.listRequests().length, 4)

    const resolved = await post('/v1/permission/resolved-session', { source: 'claude', instanceId: 'claude-3f1c2a9e-1111-4222-8333-944455556666' })
    assert.equal(resolved.status, 204)
    const left = broker.listRequests()
    assert.deepEqual(left.map(request => request.sessionId).sort(), ['other', 'ses-1'])
    assert.equal((await post('/v1/permission/decision', claudePermission())).status, 410)
    assert.ok(broker.getAuditRecords().every(record => record.terminalReason === 'agent_resolved'))
  })
})

test('a Claude request in flight when the broker shuts down is never auto-allowed', async () => {
  await withServer(async ({ broker, post }) => {
    const { requestId } = await (await post('/v1/permission/request', claudePermission())).json() as { requestId: string }
    const deciding = broker.decide(requestId, 'allow_once', 'bubble')
    broker.shutdown()
    assert.deepEqual(await deciding, { ok: false, error: 'conflict', status: 'cancelled' })
    assert.equal((await post('/v1/permission/decision', claudePermission())).status, 410)
  })
})

test('one decision reaches exactly one hook invocation; a parallel identical request stays silent', async () => {
  await withServer(async ({ broker, post }) => {
    const first = await post('/v1/permission/request', claudePermission())
    assert.equal(first.status, 201)
    const { requestId } = await first.json() as { requestId: string }
    // A second invocation of the same command (parallel subagent) is refused, not merged.
    const parallel = await post('/v1/permission/request', claudePermission({ nonce: NONCE_B }))
    assert.equal(parallel.status, 409)
    assert.equal(broker.listRequests().length, 1)
    // The same invocation retrying is still idempotent.
    assert.equal((await post('/v1/permission/request', claudePermission())).status, 200)

    const deciding = broker.decide(requestId, 'allow_once', 'bubble')
    assert.equal((await post('/v1/permission/decision', claudePermission({ nonce: NONCE_B }))).status, 409)
    assert.equal((await post('/v1/permission/decision', claudePermission({ nonce: undefined }))).status, 409)
    const polled = await post('/v1/permission/decision', claudePermission())
    assert.equal(polled.status, 200)
    const { decisionId } = await polled.json() as { decisionId: string }
    assert.equal((await post('/v1/permission/result', { ...claudePermission({ nonce: NONCE_B }), decisionId, result: 'delivered' })).status, 409)
    assert.equal((await post('/v1/permission/result', { ...claudePermission(), decisionId, result: 'delivered' })).status, 204)
    assert.deepEqual(await deciding, { ok: true, status: 'allowed' })
  })
})

test('Claude requests without a valid nonce are rejected', async () => {
  await withServer(async ({ broker, post }) => {
    for (const nonce of [undefined, '', 'short', 'Z'.repeat(32), '1'.repeat(65)]) {
      assert.equal((await post('/v1/permission/request', claudePermission({ nonce }))).status, 400, String(nonce))
    }
    assert.equal((await post('/v1/permission/request', claudePermission({ scope: 'bad scope' }))).status, 400)
    assert.equal(broker.listRequests().length, 0)
    // OpenCode is unchanged: no nonce needed.
    assert.equal((await post('/v1/permission/request', permission())).status, 201)
  })
})

test('a new prompt or PreToolUse in the same agent scope takes older Claude prompts down', async () => {
  await withServer(async ({ broker, post }) => {
    await post('/v1/permission/request', claudePermission())
    await post('/v1/permission/request', claudePermission({ permissionId: 'f'.repeat(32), scope: 'subagent-1' }))
    // Same scope ("main"): the earlier prompt was answered in the terminal.
    await post('/v1/permission/request', claudePermission({ permissionId: 'e'.repeat(32), nonce: NONCE_B }))
    assert.equal(broker.listRequests().length, 2)
    assert.equal((await post('/v1/permission/decision', claudePermission())).status, 410)

    // PreToolUse of the main agent settles only the main scope.
    assert.equal((await post('/v1/permission/resolved-session', { source: 'claude', instanceId: claudePermission().instanceId, scope: 'main' })).status, 204)
    assert.equal(broker.listRequests().length, 1)
    assert.equal((await post('/v1/permission/resolved-session', { source: 'claude', instanceId: claudePermission().instanceId, scope: 'bad scope' })).status, 400)
    assert.equal((await post('/v1/permission/resolved-session', { source: 'claude', instanceId: claudePermission().instanceId, scope: 'subagent-1' })).status, 204)
    assert.equal(broker.listRequests().length, 0)
  })
})

test('a file edit is medium only inside the project and never for execution-relevant paths', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-edit-risk-')))
  const project = path.join(root, 'project')
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'outside'))
  fs.symlinkSync(path.join(root, 'outside'), path.join(project, 'linked'))
  try {
    await withServer(async ({ broker, post }) => {
      const cases: Array<[string, unknown, string, string?]> = [
        ['Write', path.join(project, 'src', 'app.ts'), 'medium', path.join('src', 'app.ts')],
        ['Edit', 'src/new-file.ts', 'medium', path.join('src', 'new-file.ts')],
        ['NotebookEdit', path.join(project, 'nb.ipynb'), 'medium', 'nb.ipynb'],
        ['Write', path.join(root, 'outside', 'x.ts'), 'high'],
        ['Write', path.join(project, '..', 'escape.ts'), 'high'],
        ['Write', path.join(project, 'linked', 'x.ts'), 'high'],
        ['Edit', path.join(project, '.git', 'hooks', 'pre-commit'), 'high'],
        ['Edit', path.join(project, '.Git', 'hooks', 'pre-commit'), 'high'],
        ['Write', path.join(project, '.claude', 'settings.json'), 'high'],
        ['Write', path.join(project, '.husky', 'pre-push'), 'high'],
        ['Write', path.join(project, '.vscode', 'tasks.json'), 'high'],
        ['Write', path.join(project, 'node_modules', '.bin', 'tsc'), 'high'],
        ['Write', path.join(project, '.zshrc'), 'high'],
        ['Write', path.join(project, '.envrc'), 'high'],
        ['Write', undefined, 'high'],
      ]
      for (const [index, [tool, filePath, risk, relative]] of cases.entries()) {
        const response = await post('/v1/permission/request', claudePermission({
          permissionId: `${index}`.padStart(32, 'c'), scope: `edit-${index}`, permission: tool,
          project, filePath, detail: typeof filePath === 'string' ? filePath : undefined,
        }))
        assert.equal(response.status, 201, String(filePath))
        const { requestId } = await response.json() as { requestId: string }
        const view = broker.listRequests().find(request => request.requestId === requestId)!
        assert.equal(view.risk, risk, `${tool} ${String(filePath)}`)
        assert.equal(view.hotkeyEligible, risk === 'medium', String(filePath))
        // In-project edits show the project-relative path, never the absolute one.
        if (relative) assert.equal(view.description, relative)
      }
      // A cwd too long to keep whole is never trusted for "inside the project".
      const long = await post('/v1/permission/request', claudePermission({
        permissionId: 'z'.repeat(32), scope: 'long', permission: 'Write',
        project: `/${'a'.repeat(5000)}`, filePath: `/${'a'.repeat(5000)}/x.ts`,
      }))
      const { requestId } = await long.json() as { requestId: string }
      assert.equal(broker.listRequests().find(request => request.requestId === requestId)!.risk, 'high')
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
