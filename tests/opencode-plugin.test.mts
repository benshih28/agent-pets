import test from 'node:test'
import assert from 'node:assert/strict'
import { openCodePluginContent } from '../electron/setup.ts'

test('generated OpenCode plugins are valid modules with permission hooks', async () => {
  for (const source of ['opencode-cli', 'opencode-desktop'] as const) {
    const code = openCodePluginContent(source)
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    const plugin = await import(moduleUrl)
    const hooks = await plugin.DesktopPetPlugin({
      client: {},
      project: { worktree: 'C:/repo' },
      directory: 'C:/repo',
    })

    assert.equal(typeof hooks.event, 'function')
    assert.equal(typeof hooks['permission.ask'], 'function')
    assert.equal(typeof hooks.dispose, 'function')
    assert.equal(code.includes("path: '/v1/permission/request'"), false)
    assert.equal(code.includes("permissionPost('/v1/permission/request'"), true)
    assert.equal(code.includes('project: projectPath'), true)
    assert.equal(code.includes("'tool.execute.before', projectPath"), true)
    assert.equal(code.includes("reply = decision === 'allow_once' ? 'once' : 'reject'"), true)
    assert.equal(code.includes("'always'"), false)
    // Host hints: a few capped env values, sent with every status event.
    assert.equal(code.includes('host: HOST_HINTS'), true)
    assert.equal(code.includes("shortEnv('TERM_PROGRAM'"), true)
    assert.equal(/process\.env\)|\.\.\.process\.env/.test(code), false)
  }
})

// 執行產生出來的 plugin，鎖住 `event` hook 對每種 event.type 送出的請求（路徑、狀態、originalEvent、順序），
// 讓範本裡分派寫法的改寫可以證明語意不變。token 與 HTTP 都在行程內攔截，不會碰到真的檔案或連線。
type CapturedRequest = { path: string; body: Record<string, unknown> }

async function runPluginEvent(event: unknown, statusFor: (path: string) => number): Promise<CapturedRequest[]> {
  const { default: http } = await import('node:http')
  const { default: fs } = await import('node:fs')
  const { EventEmitter } = await import('node:events')
  const captured: CapturedRequest[] = []
  const originalRequest = http.request
  const originalReadFileSync = fs.readFileSync
  const fakeRequest = (options: { path: string }, onResponse: (res: InstanceType<typeof EventEmitter> & { statusCode: number }) => void) => {
    let payload = ''
    return {
      setTimeout() {},
      on() {},
      write(chunk: string) { payload += chunk },
      end() {
        captured.push({ path: options.path, body: JSON.parse(payload) })
        setImmediate(() => {
          const res = Object.assign(new EventEmitter(), { statusCode: statusFor(options.path) })
          onResponse(res)
          res.emit('end')
        })
      },
    }
  }
  Object.assign(http, { request: fakeRequest })
  Object.assign(fs, { readFileSync: () => 'test-token' })
  try {
    // 每個情境載入新的模組實例，模組內的 currentState 去重不會跨情境互相影響。
    const code = `${openCodePluginContent('opencode-cli')}\n// ${Math.random()}`
    const plugin = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
    const hooks = await plugin.DesktopPetPlugin({ client: {}, project: { worktree: 'C:/repo' }, directory: 'C:/repo' })
    await hooks.event({ event })
    for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve))
    return captured
  } finally {
    Object.assign(http, { request: originalRequest })
    Object.assign(fs, { readFileSync: originalReadFileSync })
  }
}

const summarize = (requests: CapturedRequest[]) => requests.map(({ path, body }) => (
  path === '/v1/events'
    ? { path, sessionId: body.sessionId, state: body.state, originalEvent: body.originalEvent, toolName: body.toolName, project: body.project }
    : { path, permissionId: body.permissionId }
))

test('the generated OpenCode event hook dispatches every event type to the same requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const statusFor = (path: string) => (path.endsWith('/request') ? 201 : path.endsWith('/decision') ? 410 : 204)
  const statusEvent = (type: string) => ({ type: 'session.status', properties: { sessionID: 's1', status: { type } } })
  const permission = { id: 'p1', sessionID: 's1', permission: 'bash' }
  const stateEvent = (state: string, originalEvent: string) => ({ path: '/v1/events', sessionId: 's1', state, originalEvent, toolName: undefined, project: 'C:/repo' })
  const cases: { name: string; event: unknown; expected: unknown[] }[] = [
    { name: 'status busy', event: statusEvent('busy'), expected: [stateEvent('thinking', 'session.status')] },
    { name: 'status retry', event: statusEvent('retry'), expected: [stateEvent('thinking', 'session.status')] },
    { name: 'status idle', event: statusEvent('idle'), expected: [stateEvent('idle', 'session.status')] },
    { name: 'status unknown', event: statusEvent('compacting'), expected: [] },
    { name: 'session.idle', event: { type: 'session.idle', properties: { sessionID: 's1' } }, expected: [stateEvent('idle', 'session.idle')] },
    { name: 'session.error', event: { type: 'session.error', properties: { sessionID: 's1' } }, expected: [stateEvent('error', 'session.error')] },
    ...['permission.updated', 'permission.asked'].map(type => ({
      name: type,
      event: { type, properties: permission },
      expected: [
        { path: '/v1/permission/request', permissionId: 'p1' },
        stateEvent('waiting-permission', 'permission.request'),
        { path: '/v1/permission/decision', permissionId: 'p1' },
      ],
    })),
    {
      name: 'permission.replied',
      event: { type: 'permission.replied', properties: { sessionID: 's1', permissionID: 'p1' } },
      expected: [{ path: '/v1/permission/resolved', permissionId: 'p1' }, stateEvent('thinking', 'permission.replied')],
    },
    { name: 'unknown type', event: { type: 'message.updated', properties: { sessionID: 's1' } }, expected: [] },
    { name: 'no properties', event: { type: 'session.idle' }, expected: [{ ...stateEvent('idle', 'session.idle'), sessionId: 'unknown' }] },
  ]
  for (const { name, event, expected } of cases) {
    assert.deepEqual(summarize(await runPluginEvent(event, statusFor)), expected, name)
  }
})
