import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AGENT_SOURCE_REGISTRY, AGENT_STATES, FAMILY_SOURCES, isAgentState } from '../src/types/agent.ts'
import { DEPLOY_FILES } from '../src/types/local-wire.ts'
import {
  CLAUDE_PERMISSION_WAIT_MAX_SECONDS,
  CLAUDE_PERMISSION_WAIT_MIN_SECONDS,
} from '../src/types/permission.ts'
import { PRESENTATION_REACTIONS } from '../src/types/presentation.ts'
import {
  PRESENTATION_MAX_MESSAGE_LENGTH,
  PRESENTATION_MAX_TTL_MS,
  PRESENTATION_MIN_TTL_MS,
} from '../electron/presentation-controller.ts'
import { isValidPetId } from '../src/utils/pet-id.ts'
import { openCodePluginContent } from '../electron/setup.ts'

// integrations/*.mjs 與 OpenCode plugin 模板安裝後在 app 之外執行，不能 import TS，所以許多字面值是手動同步的。
// 逐一固定「每個字面值對哪個 TS 來源」的測試分散在：
//   tests/local-wire-contract.test.mts  埠、路徑、header、部署檔名、啟動標記檔名、權限 route
//   tests/id-patterns.test.mts          IDENTIFIER_PATTERN
//   tests/agent-source-registry.test.mts validSources
// 這個檔案補上其餘的：來源與狀態字串、事件名稱對照、等待秒數、host 提示格式、presentation MCP 的 schema、cmd 包裝。
// 做法是讀原始碼文字再用括號配對取出片段，而不是在 vm 裡執行：agent-hook.mjs 一載入就會 main()、
// 讀 stdin 並結束程序，setup.ts 的常數也沒有 export，文字解析不需要改動任何來源檔，
// 也不會因為其他欄位怎麼重構而失效（只依賴函式名稱與常數名稱）。

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const hook = read('integrations/agent-hook.mjs')
const mcp = read('integrations/presentation-mcp.mjs')
const cmd = read('integrations/agent-hook.cmd')
const setup = read('electron/setup.ts')
const hostApp = read('electron/host-app.ts')

/** 從 `open` 所在位置起，取出到對應右括號為止的文字（略過字串字面值裡的括號）。 */
function balanced(text: string, openIndex: number): string {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const stack: string[] = []
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (pairs[char]) stack.push(pairs[char])
    else if (char === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return text.slice(openIndex, i + 1)
    }
  }
  throw new Error(`unbalanced block at ${openIndex}`)
}

function functionBody(text: string, name: string): string {
  const match = new RegExp(`function ${name}\\(`).exec(text)
  assert.ok(match, `function ${name} not found`)
  return balanced(text, text.indexOf('{', text.indexOf(')', match.index)))
}

/** `const NAME = ...` 後第一個 { 或 [ 的區塊（支援 Object.freeze({...}) 與 new Set([...])，以及型別註記）。 */
function constBlock(text: string, name: string): string {
  const match = new RegExp(`(?:^|\\n)(?:export )?const ${name}\\b[^=\\n]*=`).exec(text)
  assert.ok(match, `const ${name} not found`)
  const rest = text.slice(match.index + match[0].length)
  const open = rest.search(/[{[]/)
  assert.ok(open >= 0, `const ${name} has no block`)
  return balanced(rest, open)
}

const quoted = (text: string) => [...text.matchAll(/'([^']*)'/g)].map(match => match[1])
const cases = (body: string) => [...body.matchAll(/case '([^']+)'/g)].map(match => match[1])

/**
 * 函式回傳的狀態字串：`return 'x'`、三元式或物件值（`: 'x'`）。函式內引用的全大寫常數（例如對照表）也一併掃描，
 * 所以把狀態搬進對照表不會讓測試失效。
 */
function mappedStates(text: string, name: string): string[] {
  const body = functionBody(text, name)
  const referenced = new Set([...body.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)].map(match => match[0]))
  const scanned = [body]
  for (const constant of referenced) {
    if (new RegExp(`(?:^|\\n)const ${constant}\\b`).test(text)) scanned.push(constBlock(text, constant))
  }
  return scanned.flatMap(block => [...block.matchAll(/(?:\breturn|[?:])\s*'([^']+)'/g)].map(match => match[1]))
}

const claudeCases = cases(functionBody(hook, 'mapClaudeEvent'))
const codexCases = cases(functionBody(hook, 'mapCodexEvent'))
const installedClaude = quoted(constBlock(setup, 'CLAUDE_CODE_HOOK_EVENTS'))
const installedCodex = quoted(constBlock(setup, 'CODEX_HOOK_EVENTS'))

test('the extractors find the literals they are meant to guard', () => {
  // 防止解析器壞掉時其餘測試空轉。
  assert.ok(claudeCases.length >= 8 && codexCases.length >= 5)
  assert.ok(installedClaude.length >= 8 && installedCodex.length >= 5)
  assert.ok(mappedStates(hook, 'mapClaudeEvent').length >= 5)
  assert.ok(mappedStates(hook, 'mapCodexEvent').length >= 5)
})

test('hook source names are registered sources', () => {
  // validSources 的內容本身由 agent-source-registry.test.mts 固定。這裡檢查其餘兩個寫死的來源：預設值與 desktop 對應。
  const defaultSource = hook.match(/validSources\.includes\(process\.argv\[2\]\) \? process\.argv\[2\] : '([^']+)'/)
  assert.ok(defaultSource, 'default source not found')
  const desktopBlock = hook.match(/source === 'claude' && process\.env\.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'\) \{\s*source = '([^']+)'/)
  assert.ok(desktopBlock, 'claude-desktop mapping not found')
  for (const source of [defaultSource[1], desktopBlock[1]]) assert.ok(AGENT_SOURCE_REGISTRY[source as keyof typeof AGENT_SOURCE_REGISTRY], source)
  assert.ok((FAMILY_SOURCES.codex as readonly string[]).includes(defaultSource[1]))
  assert.ok((FAMILY_SOURCES.claude as readonly string[]).includes(desktopBlock[1]))
})

test('the OpenCode plugin template stamps registered opencode sources', () => {
  for (const source of ['opencode-cli', 'opencode-desktop'] as const) {
    assert.equal(AGENT_SOURCE_REGISTRY[source].family, 'opencode')
    assert.ok(openCodePluginContent(source).includes(`const SOURCE = '${source}';`), source)
  }
  // 模板函式的參數型別列出的來源，要等於 registry 裡 opencode 家族的來源。
  const signature = setup.match(/function openCodePluginContent\(source: ([^)]+)\)/)
  assert.ok(signature, 'openCodePluginContent signature not found')
  assert.deepEqual(new Set(quoted(signature[1])), new Set(FAMILY_SOURCES.opencode))
})

test('every state the hook and the OpenCode plugin send is a registry state', () => {
  const plugin = openCodePluginContent('opencode-cli')
  const pluginStates = [...plugin.matchAll(/setState\(\s*[^,()]+(?:\([^)]*\))?,\s*'([^']+)'/g)].map(match => match[1])
  assert.ok(pluginStates.length >= 5, 'plugin setState calls not found')
  const sets = {
    mapClaudeEvent: mappedStates(hook, 'mapClaudeEvent'),
    mapCodexEvent: mappedStates(hook, 'mapCodexEvent'),
    'OpenCode plugin': pluginStates,
  }
  for (const [owner, states] of Object.entries(sets)) {
    for (const state of states) assert.ok(isAgentState(state), `${owner} returns unknown state ${state}`)
  }
  // 沒有 hook 會送出的狀態以外的值：所有狀態都至少有一條路徑（offline 由 SessionEnd 送出）。
  const reachable = new Set(Object.values(sets).flat())
  for (const state of AGENT_STATES) assert.ok(reachable.has(state), `no integration ever sends ${state}`)
})

// mapXEvent 處理但安裝流程不會註冊的事件：若有，要寫明原因，不能默默漏裝。
const INTENTIONALLY_NOT_INSTALLED: { claude: Record<string, string>; codex: Record<string, string> } = { claude: {}, codex: {} }

test('Claude hook events installed in settings.json and handled by mapClaudeEvent are the same set', () => {
  const handled = new Set(claudeCases)
  for (const event of installedClaude) assert.ok(handled.has(event), `${event} is installed but mapClaudeEvent ignores it`)
  const installed = new Set(installedClaude)
  for (const event of claudeCases) {
    assert.ok(installed.has(event) || event in INTENTIONALLY_NOT_INSTALLED.claude, `${event} is mapped but never installed`)
  }
  assert.equal(new Set(installedClaude).size, installedClaude.length, 'duplicate installed event')
})

test('Codex hook events installed in hooks.json and handled by mapCodexEvent are the same set', () => {
  const handled = new Set(codexCases)
  for (const event of installedCodex) assert.ok(handled.has(event), `${event} is installed but mapCodexEvent ignores it`)
  const installed = new Set(installedCodex)
  for (const event of codexCases) {
    assert.ok(installed.has(event) || event in INTENTIONALLY_NOT_INSTALLED.codex, `${event} is mapped but never installed`)
  }
})

test('RESOLVING_EVENTS only lists events Claude actually sends to the hook', () => {
  const resolving = quoted(constBlock(hook, 'RESOLVING_EVENTS'))
  assert.ok(resolving.length >= 4)
  for (const event of resolving) {
    assert.ok(claudeCases.includes(event), `${event} is never mapped`)
    assert.ok(installedClaude.includes(event), `${event} is never installed`)
  }
  // 權限請求本身也走 respond 模式。
  assert.ok(installedClaude.includes('PermissionRequest'))
})

test('the permission wait limits equal the app clamp', () => {
  assert.equal(Number(hook.match(/^const MIN_WAIT_SECONDS = (\d+)$/m)?.[1]), CLAUDE_PERMISSION_WAIT_MIN_SECONDS)
  assert.equal(Number(hook.match(/^const MAX_WAIT_SECONDS = (\d+)$/m)?.[1]), CLAUDE_PERMISSION_WAIT_MAX_SECONDS)
})

test('the respond opt-in file keeps the keys the hook reads', () => {
  // setup.ts 寫 { enabled, waitSeconds }；hook 讀同兩個欄位。
  assert.ok(setup.includes('JSON.stringify({ enabled: true, waitSeconds: clampClaudePermissionWaitSeconds(waitSeconds) })'))
  assert.ok(hook.includes('value?.enabled !== true || typeof value.waitSeconds !== \'number\''))
})

test('host hint formats are shared between the hook, the plugin and the app', () => {
  const appPattern = (name: string) => hostApp.match(new RegExp(`const ${name} = (/[^\\n]+/)\\n`))?.[1]
  const hookPattern = (text: string, name: string) => text.match(new RegExp(`${name}: (?:process\\.platform === 'darwin' \\? )?shortEnv\\('[A-Z_a-z]+', (/[^\\n]+/)\\)`))?.[1]
  assert.ok(appPattern('TERM_PROGRAM_PATTERN'))
  assert.equal(hookPattern(hook, 'termProgram'), appPattern('TERM_PROGRAM_PATTERN'))
  assert.equal(hookPattern(hook, 'entrypoint'), appPattern('ENTRYPOINT_PATTERN'))
  // OpenCode plugin 與 hook 的 termProgram／bundleId 格式相同。
  const plugin = openCodePluginContent('opencode-cli')
  for (const name of ['termProgram', 'bundleId']) {
    assert.ok(hookPattern(hook, name), name)
    assert.equal(hookPattern(plugin.replaceAll(';', ''), name), hookPattern(hook, name), name)
  }
  // hook 傳出的 key 都在 app 認得的 HINT_KEYS 裡；bundleId 長度上限與 app 的上限相同。
  const sent = [...functionBody(hook, 'hostHints').matchAll(/^\s{4}(\w+):/gm)].map(match => match[1])
  const known = new Set(quoted(constBlock(hostApp, 'HINT_KEYS')))
  assert.ok(sent.length >= 5)
  for (const key of sent) assert.ok(known.has(key), key)
  const maxBundle = Number(hostApp.match(/const MAX_BUNDLE_ID_LENGTH = (\d+)/)?.[1])
  assert.equal(Number(hookPattern(hook, 'bundleId')?.match(/\{\d+,(\d+)\}\$/)?.[1]), maxBundle)
})

test('presentation-mcp.mjs tool schemas match the controller limits', () => {
  const schemaOf = (tool: string) => {
    const start = mcp.indexOf(`name: '${tool}'`)
    assert.ok(start >= 0, tool)
    return balanced(mcp, mcp.indexOf('inputSchema:', start) + 'inputSchema:'.length + 1)
  }
  const react = schemaOf('pet_react')
  assert.deepEqual(quoted(react.match(/enum: (\[[^\]]*\])/)![1]), [...PRESENTATION_REACTIONS])
  for (const schema of [react, schemaOf('pet_say')]) {
    assert.equal(Number(schema.match(/minimum: (\d+)/)![1]), PRESENTATION_MIN_TTL_MS)
    assert.equal(Number(schema.match(/maximum: (\d+)/)![1]), PRESENTATION_MAX_TTL_MS)
    const petPattern = new RegExp(schema.match(/pattern: '([^']+)'/)![1])
    // MCP 端只接受一般寵物 id（較嚴），而且被它接受的值 app 一定也接受。
    const maxLength = Number(petPattern.source.match(/\{1,(\d+)\}/)![1])
    assert.equal(isValidPetId('a'.repeat(maxLength), maxLength), true)
    assert.equal(petPattern.test('a'.repeat(maxLength + 1)), false)
    assert.equal(isValidPetId('a'.repeat(maxLength + 1), maxLength), false)
    for (const id of ['cat', 'Cat_1.x-y', 'plugin:abc:skin', 'bad id', '', '../x']) {
      if (petPattern.test(id)) assert.ok(isValidPetId(id, maxLength), id)
    }
  }
  assert.equal(Number(schemaOf('pet_say').match(/maxLength: (\d+)/)![1]), PRESENTATION_MAX_MESSAGE_LENGTH)
})

test('the Windows wrapper launches the deployed hook script and keeps the placeholder setup.ts fills', () => {
  assert.equal(cmd.split('__NODE_EXECUTABLE__').length - 1, 1)
  assert.ok(cmd.includes(`"%SCRIPT_DIR%${DEPLOY_FILES.hookScript}" %*`))
  assert.ok(setup.includes(".replace('__NODE_EXECUTABLE__',"))
})
