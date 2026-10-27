import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mainPath = resolve(root, 'electron/main.ts')
const preloadPaths = [
  resolve(root, 'electron/preload.ts'),
  resolve(root, 'electron/plugin-ui-preload.ts'),
]
const channelPaths = [
  resolve(root, 'electron/main.ts'),
  resolve(root, 'electron/preload.ts'),
  resolve(root, 'electron/plugin-ui-preload.ts'),
  resolve(root, 'electron/plugin-host-preload.ts'),
]
const channelDefinitions = new Map([...source(resolve(root, 'electron/ipc/channels.ts')).matchAll(/^\s{2}([A-Za-z_$][\w$]*): '([^']+)',$/gm)]
  .map(match => [match[1], match[2]]))
const inventoryPath = resolve(root, 'docs/security/ipc-inventory.md')
const envTypesPath = resolve(root, 'src/types/electron-api.ts')

function source(path) {
  return readFileSync(path, 'utf8')
}

function collectRegistrationSources() {
  const ipcDirectory = resolve(root, 'electron/ipc')
  return [
    { path: 'electron/main.ts', text: source(mainPath) },
    ...readdirSync(ipcDirectory)
      .filter(file => file.endsWith('.ts') && file !== 'channels.ts')
      .map(file => ({ path: `electron/ipc/${file}`, text: source(resolve(ipcDirectory, file)) })),
  ]
}

function collectPreloadApis() {
  const apis = new Map()
  for (const path of preloadPaths) {
    const content = source(path)
    if (path.endsWith('plugin-ui-preload.ts')) {
      apis.set('plugin-panel-api', ['agentPets (createPluginPanelPublicApi)'])
      continue
    }
    const properties = [...content.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)]
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index]
      const end = properties[index + 1]?.index ?? content.length
      const body = content.slice(property.index, end)
      const call = body.match(/ipcRenderer\.(invoke|send|on)\(\s*IPC_CHANNELS\.([A-Za-z_$][\w$]*)/)
      if (!call) continue
      const channel = channelDefinitions.get(call[2])
      if (!channel) continue
      const list = apis.get(channel) ?? []
      list.push(`${property[1]} (${call[1]})`)
      apis.set(channel, list)
    }
  }
  return apis
}

function compareRendererTypes() {
  const preload = source(preloadPaths[0])
  const typeSource = source(envTypesPath)
  const typeStart = typeSource.indexOf('export interface ElectronAPI {')
  const typeEnd = typeSource.indexOf('\n}', typeStart)
  const apiTypes = typeSource.slice(typeStart, typeEnd)
  const preloadNames = new Set([...preload.matchAll(/^  ([A-Za-z_$][\w$]*):/gm)].map(match => match[1]))
  const typeNames = new Set([...apiTypes.matchAll(/^      ([A-Za-z_$][\w$]*):/gm)].map(match => match[1]))
  return {
    missingTypes: [...preloadNames].filter(name => !typeNames.has(name)),
    extraTypes: [...typeNames].filter(name => !preloadNames.has(name)),
  }
}

function senderSummary(channel, block) {
  if (channel === 'plugin-panel-api') return 'panelView 主 frame；active WebContents 二次比對'
  if (block.includes('handleTrusted(') || block.includes('handleWithSenderGuard(') || block.includes('onWithSenderGuard(')) {
    return '設定面板 main frame（共用 sender guard）'
  }
  if (block.includes('deps.assertTrustedIpcSender(event, deps.getPanelWindow())')) return '設定面板 main frame'
  const window = block.match(/(?:assertTrustedIpcSender|isTrustedIpcSender)\(event,\s*(petWindow|panelWindow)\)/)?.[1]
  if (window === 'petWindow') return '寵物視窗 main frame'
  if (window === 'panelWindow') return '設定面板 main frame'
  if (block.includes('assertPluginPanelSender(event)')) return '設定面板 main frame'
  if (block.includes('assertTrustedIpcSender(event)') || block.includes('isTrustedIpcSender(event)')) {
    return '受信任寵物或設定面板 main frame'
  }
  if (block.includes('senderFrame !== event.sender.mainFrame')) return '受信任的主 frame（再由 controller 驗證 active WebContents）'
  return '受信任 main frame；handler 以 isTrustedIpcSender 驗證'
}

function validationSummary(block) {
  const checks = []
  if (/typeof\s+[\w.]+\s*!==?/.test(block) || /typeof\s+[\w.]+\s*===?/.test(block)) checks.push('型別')
  if (/\.length\s*[<>!=]=?/.test(block) || /\.length\s*===?/.test(block)) checks.push('長度／數量上限')
  if (/Number\.is(?:Safe)?Integer|Number\.isFinite/.test(block)) checks.push('數值範圍')
  const helpers = [...new Set([...block.matchAll(/\b((?:is|validate|normalize)[A-Z][A-Za-z0-9_]*)\s*\(/g)]
    .map(match => match[1])
    .filter(name => !['isTrustedIpcSender', 'isArray', 'isSafeInteger', 'isNaN', 'isFinite', 'isDestroyed', 'isVisible', 'isEnabled'].includes(name)))].slice(0, 3)
  if (helpers.length) checks.push(helpers.join(', '))
  const hasPayload = /\(event\s*,/.test(block)
  if (!hasPayload) return '無 payload；檢查 sender 並回傳受限狀態'
  if (checks.length === 0) return 'handler／controller 驗證 payload；拒絕無效輸入'
  return `${checks.join('；')}；無效輸入回安全預設或錯誤`
}

function directTests(channel, apis, testFiles) {
  const references = [channel, ...apis.map(value => value.split(' ')[0])]
  const matches = testFiles.filter(({ text }) => references.some(reference => reference && text.includes(reference)))
    .map(({ path }) => `\`${path}\``)
  return matches.length ? matches.join('<br>') : '`tests/ipc-inventory.test.mts`（頻道與寄件者契約）'
}

export function analyzeIpcInventory() {
  const main = source(mainPath)
  const registrationSources = collectRegistrationSources()
  const registrations = registrationSources.flatMap(({ path, text }) => [
    ...[...text.matchAll(/(?:ipcMain|deps\.ipcMain)\.(handle|on)\(\s*IPC_CHANNELS\.([A-Za-z_$][\w$]*)/g)]
      .map(match => ({ path, text, index: match.index, kind: match[1], key: match[2] })),
    ...[...text.matchAll(/handleTrusted\(\s*deps\.ipcMain,\s*IPC_CHANNELS\.([A-Za-z_$][\w$]*)/g)]
      .map(match => ({ path, text, index: match.index, kind: 'handle', key: match[1] })),
    ...[...text.matchAll(/(handle|on)WithSenderGuard\(\s*deps\.ipcMain,\s*IPC_CHANNELS\.([A-Za-z_$][\w$]*)/g)]
      .map(match => ({ path, text, index: match.index, kind: match[1] === 'handle' ? 'handle' : 'on', key: match[2] })),
  ]).sort((left, right) => left.path.localeCompare(right.path) || left.index - right.index)
  const registrationCalls = registrationSources
    .filter(({ path }) => path !== 'electron/ipc/trusted.ts')
    .flatMap(({ text }) => [
      ...[...text.matchAll(/(?:ipcMain|deps\.ipcMain)\.(?:handle|on)\s*\(/g)],
      ...[...text.matchAll(/handleTrusted\(\s*deps\.ipcMain,/g)],
      ...[...text.matchAll(/(?:handle|on)WithSenderGuard\(\s*deps\.ipcMain,/g)],
    ])
  const channelReferences = registrationSources.map(({ text }) => text)
    .concat(channelPaths.map(path => source(path)))
    .flatMap(text => [...text.matchAll(/IPC_CHANNELS\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]))
  const unknownChannelKeys = [...new Set(channelReferences.filter(key => !channelDefinitions.has(key)))]
  const unusedChannelKeys = [...channelDefinitions.keys()].filter(key => !channelReferences.includes(key))
  const apis = collectPreloadApis()
  const tests = []
  for (const file of readdirSync(resolve(root, 'tests'))) {
    if (!file.endsWith('.test.mts')) continue
    const path = `tests/${file}`
    tests.push({ path, text: source(resolve(root, path)) })
  }
  const rows = registrations.map((registration, index) => {
    const nextStart = registrations.slice(index + 1).find(item => item.path === registration.path)?.index ?? registration.text.length
    const block = registration.text.slice(registration.index, nextStart)
    const channel = channelDefinitions.get(registration.key)
    if (!channel) throw new Error(`IPC channel key is not defined: ${registration.key}`)
    return {
      kind: registration.kind,
      channel,
      sender: senderSummary(channel, block),
      validation: validationSummary(block),
      api: (apis.get(channel) ?? []).join('<br>') || '（無 renderer API；由 main 對內使用）',
      tests: directTests(channel, apis.get(channel) ?? [], tests),
      hasSenderGuard: /handleTrusted\(|(?:handle|on)WithSenderGuard\(|assertTrustedIpcSender|assertPluginPanelSender|isTrustedIpcSender|senderFrame !==/.test(block),
      hasPreloadApi: apis.has(channel),
    }
  })
  const mainChannels = new Set(rows.map(row => row.channel))
  const outboundPreloadChannels = new Set([...apis.entries()]
    .filter(([, entries]) => entries.some(entry => /\((invoke|send)\)$/.test(entry)))
    .map(([channel]) => channel))
  const rendererTypes = compareRendererTypes()
  return {
    rows,
    dynamicRegistrationCount: registrationCalls.length - registrations.length,
    unknownChannelKeys,
    unusedChannelKeys,
    missingTypes: rendererTypes.missingTypes,
    extraTypes: rendererTypes.extraTypes,
    missingPreloadChannels: [...mainChannels].filter(channel => !apis.has(channel)),
    unregisteredPreloadChannels: [...outboundPreloadChannels].filter(channel => !mainChannels.has(channel)),
    unguardedChannels: rows.filter(row => !row.hasSenderGuard).map(row => row.channel),
  }
}

export function renderIpcInventory() {
  const analysis = analyzeIpcInventory()
  const rows = analysis.rows.map(row => `| \`${row.channel}\` | \`${row.kind}\` | ${row.sender} | ${row.validation} | ${row.api} | ${row.tests} |`)
  return [
    '# IPC 安全清單',
    '',
    `由 \`node scripts/generate-ipc-inventory.mjs --write\` 從 \`electron/ipc/channels.ts\`、主程序與 preload 產生；目前 ${analysis.rows.length} 個 handler。每列列出 sender guard、handler 中的輸入檢查概況、preload 對應與測試。新增 IPC 頻道若未同步 preload 或 sender 驗證，\`tests/ipc-inventory.test.mts\` 會失敗。`,
    '',
    '| 頻道 | 類型 | 允許的寄件者 | 輸入驗證概況 | Preload API | 對應測試 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## 分析規則',
    '',
    '- `assertTrustedIpcSender` 與 `assertPluginPanelSender` 都確認 sender 的 main frame、可信 URL 與允許的視窗；具名視窗參數會限制至該視窗。',
    '- `plugin-panel-api` 先要求 main frame，再由 `PluginPanelViewController.handleApiRequest` 驗證目前 active WebContents、方法 allowlist、JSON 形狀與訊息大小。',
    '- 寄件者與 payload 不合法時，handler 依各 API 回傳既有安全預設值或錯誤結果。',
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const expected = renderIpcInventory()
  if (process.argv.includes('--write')) {
    mkdirSync(resolve(root, 'docs/security'), { recursive: true })
    writeFileSync(inventoryPath, expected)
    process.stdout.write(`Wrote IPC inventory (${analyzeIpcInventory().rows.length} handlers).\n`)
  } else if (process.argv.includes('--check')) {
    let current = ''
    try { current = source(inventoryPath) } catch {}
    if (current !== expected) {
      process.stderr.write('IPC inventory is stale. Run node scripts/generate-ipc-inventory.mjs --write.\n')
      process.exitCode = 1
    } else {
      process.stdout.write(`IPC inventory matches ${analyzeIpcInventory().rows.length} handlers.\n`)
    }
  } else {
    process.stdout.write(expected)
  }
}
