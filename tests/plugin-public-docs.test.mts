import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { zipSync } from 'fflate'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'

const docsDirectory = path.resolve('docs/plugins')

test('every public plugin example manifest passes the runtime validator', () => {
  const examplesDirectory = path.join(docsDirectory, 'examples')
  for (const example of fs.readdirSync(examplesDirectory, { withFileTypes: true })) {
    if (!example.isDirectory()) continue
    const manifestPath = path.join(examplesDirectory, example.name, 'plugin.json')
    assert.equal(fs.existsSync(manifestPath), true, `${example.name} must contain plugin.json`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    const parsed = parsePluginManifest(manifest)
    assert.equal(parsed.ok, true, `${example.name}: ${parsed.ok ? '' : parsed.error}`)
  }
})

test('P16 public examples cover the documented timer APIs and skin-only package', () => {
  const examples = path.join(docsDirectory, 'examples')
  const pomodoro = fs.readFileSync(path.join(examples, 'pomodoro/dist/main.js'), 'utf8')
  const pomodoroManifest = JSON.parse(fs.readFileSync(path.join(examples, 'pomodoro/plugin.json'), 'utf8')) as Record<string, unknown>
  const skinManifest = JSON.parse(fs.readFileSync(path.join(examples, 'skin-pack/plugin.json'), 'utf8')) as Record<string, unknown>
  assert.equal(parsePluginManifest(pomodoroManifest).ok, true)
  assert.equal(parsePluginManifest(skinManifest).ok, true)
  assert.match(pomodoro, /api\.pet\.status/)
  assert.match(pomodoro, /api\.pet\.onStatusChange/)
  assert.match(pomodoro, /api\.schedule\.every/)
  assert.match(pomodoro, /api\.feed\.notify/)
  assert.match(pomodoro, /api\.badge\.set/)
  assert.doesNotMatch(pomodoro, /api\.(?:net|secrets|storage|settings|commands|ui)\./)
  assert.equal('entry' in skinManifest, false)
  const spritesheet = fs.readFileSync(path.join(examples, 'skin-pack/skins/snow-fox.webp'))
  assert.equal(spritesheet.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(spritesheet.subarray(8, 12).toString('ascii'), 'WEBP')
})

test('skin-pack example is accepted and installed by PluginRegistry', () => {
  const exampleDirectory = path.join(docsDirectory, 'examples/skin-pack')
  const files: Record<string, Uint8Array> = {}
  function collect(directory: string, relativeDirectory = ''): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(absolutePath, relativePath)
      else if (entry.isFile()) files[relativePath] = new Uint8Array(fs.readFileSync(absolutePath))
    }
  }
  collect(exampleDirectory)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-doc-skin-pack-'))
  try {
    const registry = new PluginRegistry(userData)
    const planned = registry.planInstall(zipSync(files, { level: 6 }))
    assert.equal(planned.ok, true, planned.ok ? '' : planned.error)
    if (!planned.ok) return
    assert.equal(planned.value.pluginId, 'skin-pack')
    assert.equal(registry.install(planned.value.token).ok, true)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('P16 API and contribution docs describe command, Tray, badge, and skin behavior in both locales', () => {
  for (const suffix of ['', '.zh-TW']) {
    const api = fs.readFileSync(path.join(docsDirectory, `api-reference${suffix}.md`), 'utf8')
    const contribution = fs.readFileSync(path.join(docsDirectory, `contribution-points${suffix}.md`), 'utf8')
    const limits = fs.readFileSync(path.join(docsDirectory, `limits${suffix}.md`), 'utf8')
    const examples = fs.readFileSync(path.join(docsDirectory, `examples${suffix}.md`), 'utf8')
    assert.match(api, /commands\.onInvoke/)
    assert.match(api, /badge\.set/)
    assert.match(api, /invalid_request.*rate_limited.*disabled.*not_permitted|invalid_request.*not_permitted.*rate_limited.*disabled/)
    for (const term of ['`commands`', '`tray`', '`badge`', '`skins`']) assert.ok(contribution.includes(term), `${suffix} missing ${term}`)
    for (const term of ['10', '30', '6', '25 MB', '20 MB']) assert.ok(limits.includes(term), `${suffix} missing ${term}`)
    assert.match(examples, /pomodoro/)
    assert.match(examples, /skin-pack/)
  }
})

test('P17 eventSource and publishing contracts are indexed in both locales', () => {
  for (const suffix of ['', '.zh-TW']) {
    const readme = fs.readFileSync(path.join(docsDirectory, `README${suffix}.md`), 'utf8')
    const examples = fs.readFileSync(path.join(docsDirectory, `examples${suffix}.md`), 'utf8')
    const api = fs.readFileSync(path.join(docsDirectory, `api-reference${suffix}.md`), 'utf8')
    const limits = fs.readFileSync(path.join(docsDirectory, `limits${suffix}.md`), 'utf8')
    const publishing = fs.readFileSync(path.join(docsDirectory, `publishing${suffix}.md`), 'utf8')
    const signing = fs.readFileSync(path.join(docsDirectory, `signing${suffix}.md`), 'utf8')
    assert.ok(suffix === ''
      ? /publishing/i.test(readme) && /signing/i.test(readme)
      : /發布至線上目錄/.test(readme) && /簽章與線上目錄/.test(readme))
    assert.match(examples, /event-source-status/)
    assert.match(api, /agent\.emit\(event\)/)
    assert.match(api, /invalid_request.*rate_limited.*not_permitted.*disabled/)
    assert.match(api, /History.*quota/)
    for (const value of ['30', '120', '20', '100', '2 KiB', '64', '80', '2 minutes', '30 seconds', '30 minutes']) {
      if (suffix === '') assert.ok(limits.includes(value), `English limits missing ${value}`)
    }
    if (suffix === '.zh-TW') {
      for (const value of ['30', '120', '20', '100', '2 KiB', '64', '80', '2 分鐘', '30 秒', '30 分鐘']) {
        assert.ok(limits.includes(value), `Traditional Chinese limits missing ${value}`)
      }
    }
    assert.match(publishing, /schemaVersion: 1/)
    assert.match(publishing, /SHA-256/)
    assert.match(publishing, /pull request|pull request|PR/i)
    assert.match(signing, /Ed25519/)
    assert.match(signing, /private|私鑰/i)
  }

  const exampleDirectory = path.join(docsDirectory, 'examples/event-source-status')
  const manifest = JSON.parse(fs.readFileSync(path.join(exampleDirectory, 'plugin.json'), 'utf8')) as Record<string, unknown>
  const source = fs.readFileSync(path.join(exampleDirectory, 'dist/main.js'), 'utf8')
  assert.equal(parsePluginManifest(manifest).ok, true)
  assert.match(source, /export default\s*\{\s*activate\s*\(/)
  assert.match(source, /api\.agent\.emit\(\{ sessionId, state: 'thinking' \}\)/)
  assert.match(source, /state: 'done'/)
})

test('plugin documentation has bilingual page pairs and all local Markdown links resolve', () => {
  const markdownFiles: string[] = []
  function collectMarkdown(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) collectMarkdown(target)
      else if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(target)
    }
  }
  collectMarkdown(docsDirectory)

  for (const file of markdownFiles.filter(file => !file.endsWith('.zh-TW.md'))) {
    const localized = file.replace(/\.md$/, '.zh-TW.md')
    assert.equal(fs.existsSync(localized), true, `${path.relative(docsDirectory, file)} needs a Traditional Chinese page`)
  }

  const readmeFiles = [path.resolve('README.md'), path.resolve('README.zh-TW.md')]
  for (const file of [...markdownFiles, ...readmeFiles]) {
    const source = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
    for (const match of source.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1]?.trim().replace(/^<|>$/g, '').split(/\s+/, 1)[0]
      if (!rawTarget || /^(?:https?:|mailto:|tel:|data:)/i.test(rawTarget) || rawTarget.startsWith('#')) continue
      const relativeTarget = decodeURIComponent(rawTarget.split('#', 1)[0] ?? '')
      const target = path.resolve(path.dirname(file), relativeTarget)
      assert.equal(fs.existsSync(target), true, `${path.relative(process.cwd(), file)} links to missing ${rawTarget}`)
    }
  }
})

test('public manifest schema required keys and enums match the runtime validator', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(docsDirectory, 'plugin.schema.json'), 'utf8')) as {
    required: string[]
    properties: Record<string, { const?: string; enum?: string[]; description?: string; properties?: Record<string, { description?: string; properties?: Record<string, { type?: string; enum?: string[]; const?: string }> }> }>
    $defs: Record<string, { properties?: Record<string, { enum?: string[]; const?: string }> }>
  }
  assert.deepEqual(schema.required, ['id', 'name', 'version', 'apiVersion', 'author', 'permissions', 'contributes'])
  assert.equal(schema.properties.apiVersion?.const, '1')
  assert.deepEqual(Object.keys(schema.properties.permissions?.properties ?? {}).sort(), ['agentStatus', 'network', 'schedule', 'secrets', 'storage'])
  assert.deepEqual(Object.keys(schema.properties.contributes?.properties ?? {}).sort(), ['badge', 'commands', 'eventSource', 'feed', 'panelView', 'reaction', 'settings', 'skins', 'tray'])
  const panelView = schema.properties.contributes?.properties?.panelView
  assert.match(panelView?.description ?? '', /sandboxed host view/)
  assert.equal(panelView?.properties?.preferredSize?.properties?.width?.type, 'integer')
  assert.equal(panelView?.properties?.preferredSize?.properties?.height?.type, 'integer')
  assert.match(panelView?.properties?.preferredSize?.description ?? '', /320–960 px.*240–800 px/)
  assert.deepEqual(schema.$defs.setting?.properties?.type?.enum, ['string', 'number', 'boolean'])
  assert.equal(schema.$defs.setting?.properties?.format?.const, 'secret')

  const base = JSON.parse(fs.readFileSync(path.join(docsDirectory, 'examples/hello-feed/plugin.json'), 'utf8')) as Record<string, unknown>
  assert.equal(parsePluginManifest(base).ok, true)
  assert.equal(parsePluginManifest({ ...base, apiVersion: '2' }).ok, false)
  assert.equal(parsePluginManifest({ ...base, extra: true }).ok, false)
})

test('getting-started tutorial writes its package outside the watched source folder', () => {
  for (const suffix of ['.zh-TW', '']) {
    const content = fs.readFileSync(path.join(docsDirectory, `getting-started${suffix}.md`), 'utf8')
    assert.match(content, /zip -r \.\.\/hello-feed\.agentpet-plugin plugin\.json dist\//)
  }
})

test('plugin network and secret docs match redirect, cookie, and settings event behavior', () => {
  const api = fs.readFileSync(path.join(docsDirectory, 'api-reference.md'), 'utf8')
  const apiZh = fs.readFileSync(path.join(docsDirectory, 'api-reference.zh-TW.md'), 'utf8')
  const limits = fs.readFileSync(path.join(docsDirectory, 'limits.md'), 'utf8')
  const limitsZh = fs.readFileSync(path.join(docsDirectory, 'limits.zh-TW.md'), 'utf8')
  const security = fs.readFileSync(path.join(docsDirectory, 'security.md'), 'utf8')
  const securityZh = fs.readFileSync(path.join(docsDirectory, 'security.zh-TW.md'), 'utf8')

  assert.match(api, /up to three redirects/)
  assert.match(apiZh, /最多 3 次 redirect/)
  assert.match(limits, /at most three redirects/)
  assert.match(limitsZh, /最多跟隨 3 個 redirect/)
  assert.match(api, /do not send or store cookies/)
  assert.match(apiZh, /不會送出或儲存 Cookie/)
  assert.match(api, /secret additions, updates, or clears trigger the callback/)
  assert.match(apiZh, /密鑰新增、更新或清除都會觸發 callback/)
  assert.match(security, /DNS rebinding race/)
  assert.match(securityZh, /DNS rebinding 時間差風險/)
})

test('panel-view guide, API declarations, and panel-demo document the restricted P15 contract', () => {
  const panel = fs.readFileSync(path.join(docsDirectory, 'panel-view.md'), 'utf8')
  const panelZh = fs.readFileSync(path.join(docsDirectory, 'panel-view.zh-TW.md'), 'utf8')
  const api = fs.readFileSync(path.join(docsDirectory, 'agent-pets-plugin.d.ts'), 'utf8')
  const example = path.join(docsDirectory, 'examples/panel-demo')
  const exampleManifest = JSON.parse(fs.readFileSync(path.join(example, 'plugin.json'), 'utf8')) as Record<string, unknown>

  assert.match(panel, /secrets\.get|`secrets\.get`/)
  assert.match(panel, /net\.requestHost/)
  assert.match(panel, /256 KB/)
  assert.match(panel, /20 messages per second/)
  assert.match(panel, /agent-pets:\/\/plugin\/_shared\/tokens\.css/)
  assert.match(panelZh, /256 KB/)
  assert.match(panelZh, /每秒最多 20 則/)
  assert.match(panelZh, /agent-pets:\/\/plugin\/_shared\/tokens\.css/)
  assert.match(api, /interface PluginPanelViewContribution[\s\S]*?preferredSize\?: \{[\s\S]*?width: number[\s\S]*?height: number/)
  assert.match(api, /interface AgentPetsPluginPanelApi/)
  assert.match(api, /ui: \{[\s\S]*?postMessage\(data: PluginJsonValue\): Promise<\{ delivered: boolean \}>/)
  const panelApi = api.split('export interface AgentPetsPluginPanelApi {')[1]?.split('\ndeclare global')[0]
  assert.ok(panelApi, 'panel API declaration must be present')
  assert.doesNotMatch(panelApi, /secrets|requestHost/)
  assert.equal(parsePluginManifest(exampleManifest).ok, true)
  for (const relative of ['dist/main.js', 'ui/index.html', 'ui/panel.js', 'ui/panel.css', 'assets/icon.png']) {
    assert.equal(fs.existsSync(path.join(example, relative)), true, `panel-demo missing ${relative}`)
  }
})
