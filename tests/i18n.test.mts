import test from 'node:test'
import assert from 'node:assert/strict'
import { setLocale, t, translateBackendError } from '../src/i18n.ts'

test('Traditional Chinese translations cover core settings and interpolation', () => {
  setLocale('zh-TW')
  assert.equal(t('settings'), '設定')
  assert.equal(t('appearance'), '外觀')
  assert.equal(t('remainingPercent', { value: 87.5 }), '87.5% 剩餘')
  assert.equal(t('dayStreak', { days: 3 }), '3 天連續紀錄')
})

test('technical status and tool terms remain canonical where requested', () => {
  setLocale('zh-TW')
  assert.equal(t('miniMode'), 'Mini 模式')
  assert.match(t('permissionBubbleHelp', { seconds: 60 }), /最多保留 60 秒/)
  assert.equal(t('adapterNote').includes('Generic HTTP'), true)
})

test('backend error mapper localizes known and structured setup errors', () => {
  setLocale('zh-TW')
  assert.equal(translateBackendError('Unsupported adapter'), '不支援的 Adapter')
  assert.equal(translateBackendError('Configuration is not valid JSON: C:\\project\\.mcp.json'), '設定不是有效的 JSON：C:\\project\\.mcp.json')
  assert.equal(translateBackendError('Claude quota is rate limited. Wait a minute and retry.'), 'Claude Quota 受到速率限制，請稍候一分鐘再試。')
  assert.equal(translateBackendError('Codex usage request failed (429).'), 'Codex 用量請求失敗（429）。')
  assert.equal(translateBackendError('a custom diagnostic'), 'a custom diagnostic')
})

test('language selection switches shared renderer copy and keeps English diagnostics readable', () => {
  setLocale('en-US')
  assert.equal(t('settings'), 'Settings')
  assert.equal(t('languageHelp'), 'Choose the language used by the panel, Tray, notifications, and setup messages.')
  assert.equal(translateBackendError('Unsupported adapter'), 'Unsupported adapter')
  setLocale('zh-TW')
})

test('permission surfaces use translated labels and the removed keys stay removed', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const ui = [
    '../src/components/permission/PermissionBubble.vue',
    '../src/components/permission/PermissionNoticeBubble.vue',
    '../src/components/ui/InlinePermissionCard.vue',
    '../src/components/DesktopPet.vue',
    '../electron/desktop-tray.ts',
    '../electron/tray-menu.ts',
  ].map(read).join('\n')
  assert.doesNotMatch(ui, />\s*(Deny|Allow once)\s*</)
  assert.doesNotMatch(ui, /label: 'Presentation MCP'/)
  for (const locale of ['zh-TW', 'en-US']) {
    const catalog = JSON.parse(read(`../src/locales/${locale}.json`)) as Record<string, string>
    for (const key of ['permissionNeeded', 'checkUpdates', 'trayTooltip', 'needsAttention', 'noPendingAttention', 'pendingCount']) {
      assert.ok(!(key in catalog), `${key} should stay removed`)
    }
  }
})

test('every permission-domain key is referenced by the app', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'locales' || name === 'node_modules') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(name)) files.push(full)
    }
  }
  walk(join(root, 'src'))
  walk(join(root, 'electron'))
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  const keys = Object.keys(JSON.parse(readFileSync(join(root, 'src/locales/permission/zh-TW.json'), 'utf8')) as object)
  // Keys picked through lookup tables are listed literally in those tables.
  for (const key of keys) assert.ok(source.includes(`'${key}'`), `unused locale key ${key}`)
})
