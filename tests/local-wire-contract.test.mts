import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_LOCAL_PORTS,
  DEPLOY_DIR_NAME,
  DEPLOY_FILES,
  LOCAL_PORT_ENV,
  LOCAL_WIRE_HEADERS,
  LOCAL_WIRE_HOST,
  LOCAL_WIRE_PATHS,
} from '../src/types/local-wire.ts'
import { hookStartupMarkerName } from '../electron/main/hook-startup-marker.ts'
import { isAgentPetsHook } from '../electron/hook-config.ts'
import { redactText } from '../electron/diagnostics/redact.ts'
import { openCodePluginContent } from '../electron/setup.ts'

// 已部署的 hook、OpenCode plugin 與 presentation MCP 腳本會一直用這些值連線，所以每個值都寫死在這裡：
// 改了契約模組卻沒有遷移方案，這個測試就會失敗。
test('the local wire contract keeps the values deployed integrations rely on', () => {
  assert.equal(LOCAL_WIRE_HOST, '127.0.0.1')
  assert.deepEqual(DEFAULT_LOCAL_PORTS, { event: 17373, permission: 17374, presentation: 17375 })
  assert.deepEqual(LOCAL_PORT_ENV, {
    event: 'AGENT_PETS_EVENT_PORT',
    permission: 'AGENT_PETS_PERMISSION_PORT',
    presentation: 'AGENT_PETS_PRESENTATION_PORT',
  })
  assert.equal(DEPLOY_DIR_NAME, '.desktop-pet')
  assert.deepEqual(DEPLOY_FILES, {
    eventToken: 'event-token',
    permissionToken: 'permission-token',
    presentationToken: 'presentation-token',
    claudePermissionRespond: 'claude-permission-respond',
    hookScript: 'agent-hook.mjs',
    hookWrapper: 'agent-hook.cmd',
    presentationMcpScript: 'presentation-mcp.mjs',
  })
  assert.deepEqual(LOCAL_WIRE_HEADERS, {
    eventToken: 'x-agent-pets-token',
    permissionToken: 'x-agent-pets-permission-token',
    presentationToken: 'x-agent-pets-presentation-token',
    presentationClient: 'x-agent-pets-client',
    server: 'x-agent-pets-server',
  })
  assert.deepEqual(LOCAL_WIRE_PATHS, {
    events: '/v1/events',
    permissionPrefix: '/v1/permission',
    permissionRequest: '/v1/permission/request',
    permissionDecision: '/v1/permission/decision',
    permissionResult: '/v1/permission/result',
    permissionResolved: '/v1/permission/resolved',
    permissionResolvedSession: '/v1/permission/resolved-session',
    presentationStatus: '/v1/presentation/status',
    presentationIntents: '/v1/presentation/intents',
    presentationDisconnect: '/v1/presentation/disconnect',
  })
  for (const table of [DEFAULT_LOCAL_PORTS, LOCAL_PORT_ENV, DEPLOY_FILES, LOCAL_WIRE_HEADERS, LOCAL_WIRE_PATHS]) {
    assert.ok(Object.isFrozen(table))
  }
})

const PERMISSION_PATHS: ReadonlySet<string> = new Set([
  LOCAL_WIRE_PATHS.permissionRequest,
  LOCAL_WIRE_PATHS.permissionDecision,
  LOCAL_WIRE_PATHS.permissionResult,
  LOCAL_WIRE_PATHS.permissionResolved,
  LOCAL_WIRE_PATHS.permissionResolvedSession,
])

function lineOf(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern)
  assert.ok(match, `${label} not found`)
  return match[0]
}

// integrations/*.mjs 安裝後由 Node 在 app 之外單獨執行，不能 import TS；只能讀原始碼比對它們手寫的字面值。
test('agent-hook.mjs uses the contract values verbatim', () => {
  const hook = readFileSync(new URL('../integrations/agent-hook.mjs', import.meta.url), 'utf8')
  const origin = `http://${LOCAL_WIRE_HOST}`
  assert.equal(
    lineOf(hook, /^const PET_URL = .*$/m, 'PET_URL'),
    `const PET_URL = '${origin}:${DEFAULT_LOCAL_PORTS.event}${LOCAL_WIRE_PATHS.events}'`,
  )
  assert.equal(
    lineOf(hook, /^const PERMISSION_URL = .*$/m, 'PERMISSION_URL'),
    `const PERMISSION_URL = '${origin}:${DEFAULT_LOCAL_PORTS.permission}${LOCAL_WIRE_PATHS.permissionPrefix}'`,
  )
  assert.equal(
    lineOf(hook, /^const DEPLOY_DIR = .*$/m, 'DEPLOY_DIR'),
    `const DEPLOY_DIR = path.join(os.homedir(), '${DEPLOY_DIR_NAME}')`,
  )
  const deployFiles = {
    EVENT_TOKEN_PATH: DEPLOY_FILES.eventToken,
    PERMISSION_TOKEN_PATH: DEPLOY_FILES.permissionToken,
    RESPOND_OPT_IN_PATH: DEPLOY_FILES.claudePermissionRespond,
  }
  for (const [name, file] of Object.entries(deployFiles)) {
    assert.equal(
      lineOf(hook, new RegExp(`^const ${name} = .*$`, 'm'), name),
      `const ${name} = path.join(DEPLOY_DIR, '${file}')`,
    )
  }
  assert.ok(hook.includes(`postLocal(PET_URL, { '${LOCAL_WIRE_HEADERS.eventToken}': eventToken }`))
  assert.ok(hook.includes(`postLocal(\`\${PERMISSION_URL}/\${route}\`, { '${LOCAL_WIRE_HEADERS.permissionToken}': token }`))

  // hook 用 `${PERMISSION_URL}/${route}` 組路徑：每個 route 都要是 server 認得的路徑，而且五個都有用到。
  const routes = [...hook.matchAll(/permissionPost\(token, '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(
    new Set(routes.map(route => `${LOCAL_WIRE_PATHS.permissionPrefix}/${route}`)),
    PERMISSION_PATHS,
  )

  // 啟動標記：hook 以事件埠組檔名，必須與主程序寫的檔名相同。
  assert.ok(hook.includes('path.join(DEPLOY_DIR, `event-port-${new URL(PET_URL).port}.starting`)'))
  assert.equal(hookStartupMarkerName(DEFAULT_LOCAL_PORTS.event), `event-port-${DEFAULT_LOCAL_PORTS.event}.starting`)
})

test('presentation-mcp.mjs uses the contract values verbatim', () => {
  const mcp = readFileSync(new URL('../integrations/presentation-mcp.mjs', import.meta.url), 'utf8')
  assert.ok(mcp.includes(`Number.parseInt(process.env.${LOCAL_PORT_ENV.presentation} ?? '', 10)`))
  assert.ok(mcp.includes(`\n  : ${DEFAULT_LOCAL_PORTS.presentation}\n`))
  assert.ok(mcp.includes(`hostname: '${LOCAL_WIRE_HOST}',`))
  assert.equal(
    lineOf(mcp, /^const TOKEN_PATH = .*$/m, 'TOKEN_PATH'),
    `const TOKEN_PATH = path.join(os.homedir(), '${DEPLOY_DIR_NAME}', '${DEPLOY_FILES.presentationToken}')`,
  )
  assert.equal(lineOf(mcp, /^const TOKEN_HEADER = .*$/m, 'TOKEN_HEADER'), `const TOKEN_HEADER = '${LOCAL_WIRE_HEADERS.presentationToken}'`)
  assert.equal(lineOf(mcp, /^const CLIENT_HEADER = .*$/m, 'CLIENT_HEADER'), `const CLIENT_HEADER = '${LOCAL_WIRE_HEADERS.presentationClient}'`)
  const paths = [...mcp.matchAll(/requestJson\('(?:GET|POST)', '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(new Set(paths), new Set([
    LOCAL_WIRE_PATHS.presentationStatus,
    LOCAL_WIRE_PATHS.presentationIntents,
    LOCAL_WIRE_PATHS.presentationDisconnect,
  ]))
})

test('the OpenCode plugin template interpolates the contract and keeps its header casing', () => {
  for (const source of ['opencode-cli', 'opencode-desktop'] as const) {
    const plugin = openCodePluginContent(source)
    assert.ok(plugin.includes(`path.join(os.homedir(), '${DEPLOY_DIR_NAME}', '${DEPLOY_FILES.eventToken}')`))
    assert.ok(plugin.includes(`path.join(os.homedir(), '${DEPLOY_DIR_NAME}', '${DEPLOY_FILES.permissionToken}')`))
    assert.ok(plugin.includes(`hostname: '${LOCAL_WIRE_HOST}',`))
    // plugin 跑在 OpenCode 裡，一律連預設埠；送出的 header 大小寫與改用契約前相同。
    assert.ok(plugin.includes(`postJson(${DEFAULT_LOCAL_PORTS.event}, '${LOCAL_WIRE_PATHS.events}', 'X-Agent-Pets-Token',`))
    assert.ok(plugin.includes(`    ${DEFAULT_LOCAL_PORTS.permission},\n    pathname,\n    'X-Agent-Pets-Permission-Token',`))
    assert.equal('X-Agent-Pets-Token'.toLowerCase(), LOCAL_WIRE_HEADERS.eventToken)
    assert.equal('X-Agent-Pets-Permission-Token'.toLowerCase(), LOCAL_WIRE_HEADERS.permissionToken)
    const paths = [...plugin.matchAll(/permissionPost\('([^']+)'/g)].map(match => match[1])
    assert.ok(paths.length > 0)
    for (const pathname of paths) assert.ok(PERMISSION_PATHS.has(pathname), pathname)
    assert.equal(plugin.includes('${'), false, 'no uninterpolated template expression left behind')
  }
})

test('deployed hook paths built from the contract are recognised as ours', () => {
  const home = path.join(path.sep, 'home', 'someone')
  for (const file of [DEPLOY_FILES.hookScript, DEPLOY_FILES.hookWrapper]) {
    assert.ok(isAgentPetsHook({ type: 'command', command: `node "${path.join(home, DEPLOY_DIR_NAME, file)}" codex` }), file)
  }
})

test('diagnostics redact every token header value', () => {
  for (const header of [LOCAL_WIRE_HEADERS.eventToken, LOCAL_WIRE_HEADERS.permissionToken, LOCAL_WIRE_HEADERS.presentationToken]) {
    assert.equal(redactText(`${header}: abc123secret`).includes('abc123secret'), false, header)
  }
})
