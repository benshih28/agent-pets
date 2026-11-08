import { ref } from 'vue'
import zhTWMessages from './locales/zh-TW.json' with { type: 'json' }
import enUSMessages from './locales/en-US.json' with { type: 'json' }
import petZhTW from './locales/pet/zh-TW.json' with { type: 'json' }
import petEnUS from './locales/pet/en-US.json' with { type: 'json' }
import panelZhTW from './locales/panel/zh-TW.json' with { type: 'json' }
import panelEnUS from './locales/panel/en-US.json' with { type: 'json' }
import pluginsZhTW from './locales/plugins/zh-TW.json' with { type: 'json' }
import pluginsEnUS from './locales/plugins/en-US.json' with { type: 'json' }
import onboardingZhTW from './locales/onboarding/zh-TW.json' with { type: 'json' }
import onboardingEnUS from './locales/onboarding/en-US.json' with { type: 'json' }
import permissionZhTW from './locales/permission/zh-TW.json' with { type: 'json' }
import permissionEnUS from './locales/permission/en-US.json' with { type: 'json' }
import growthZhTW from './locales/growth/zh-TW.json' with { type: 'json' }
import growthEnUS from './locales/growth/en-US.json' with { type: 'json' }
import designZhTW from './locales/design/zh-TW.json' with { type: 'json' }
import designEnUS from './locales/design/en-US.json' with { type: 'json' }
import reliabilityZhTW from './locales/reliability/zh-TW.json' with { type: 'json' }
import reliabilityEnUS from './locales/reliability/en-US.json' with { type: 'json' }
import zhTWErrors from './locales/errors.zh-TW.json' with { type: 'json' }
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './types/locale.ts'

export type TranslationParams = Record<string, string | number>

// 各領域的新文案放在 src/locales/<domain>/{zh-TW,en-US}.json，避免平行開發時同時改一個大檔而衝突。
// key 必須以領域前綴開頭（例如 pet.xxx），且不得與主檔重複。
const messages = {
  ...zhTWMessages,
  ...petZhTW,
  ...panelZhTW,
  ...pluginsZhTW,
  ...onboardingZhTW,
  ...permissionZhTW,
  ...growthZhTW,
  ...designZhTW,
  ...reliabilityZhTW,
}

export type TranslationKey = keyof typeof messages

// 顯式標註 Record<TranslationKey, string>：若 en-US.json 缺漏或多出 key，這裡會編譯期報錯
const englishMessages: Record<TranslationKey, string> = {
  ...enUSMessages,
  ...petEnUS,
  ...panelEnUS,
  ...pluginsEnUS,
  ...onboardingEnUS,
  ...permissionEnUS,
  ...growthEnUS,
  ...designEnUS,
  ...reliabilityEnUS,
}

function readPersistedLocale(): AppLocale {
  try {
    if (typeof localStorage !== 'undefined' && isAppLocale(localStorage.getItem('agent-pet-locale'))) {
      return localStorage.getItem('agent-pet-locale') as AppLocale
    }
  } catch {}
  return DEFAULT_LOCALE
}

export const locale = ref<AppLocale>(readPersistedLocale())

// Keep <html lang> in step with the UI language so screen readers pick the
// right voice and the browser picks CJK-appropriate fonts.
const HTML_LANG: Record<AppLocale, string> = { 'zh-TW': 'zh-TW', 'en-US': 'en' }

function syncDocumentLang(value: AppLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[value]
}

syncDocumentLang(locale.value)

export function getLocale(): AppLocale {
  return locale.value
}

export function setLocale(value: unknown): AppLocale {
  const next = isAppLocale(value) ? value : DEFAULT_LOCALE
  locale.value = next
  syncDocumentLang(next)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('agent-pet-locale', next)
  } catch {}
  return next
}

export function t(key: TranslationKey, params: TranslationParams = {}): string {
  return tForLocale(locale.value, key, params)
}

export function tForLocale(targetLocale: AppLocale, key: TranslationKey, params: TranslationParams = {}): string {
  const template = targetLocale === 'en-US' ? englishMessages[key] : messages[key]
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`))
}

// Plural-aware lookup. Define `<key>.one` / `<key>.other` (and others the
// language needs) in the catalog; en-US picks by Intl.PluralRules, zh-TW only
// needs `.other`. Falls back to `.other`, then to the bare key. `{count}` is
// filled automatically.
export function tPlural(key: string, count: number, params: TranslationParams = {}): string {
  const loc = locale.value
  const category = new Intl.PluralRules(loc).select(count)
  const table: Record<string, string> = loc === 'en-US' ? englishMessages : messages
  const template = table[`${key}.${category}`] ?? table[`${key}.other`] ?? table[key]
  if (template === undefined) return key
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(name === 'count' ? count : (params[name] ?? `{${name}}`)))
}

export function translateBackendError(value: unknown): string {
  const raw = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : ''
  if (!raw) return t('design.operationFailed')
  if (locale.value === 'en-US') return raw

  const exact: Record<string, string> = zhTWErrors
  if (exact[raw]) return exact[raw]
  if (raw.startsWith('Configuration is not valid JSON:')) return `設定不是有效的 JSON：${raw.slice('Configuration is not valid JSON:'.length).trim()}`
  if (raw.startsWith('Configuration root must be an object:')) return `設定根節點必須是物件：${raw.slice('Configuration root must be an object:'.length).trim()}`
  if (raw.startsWith('Unsupported MCP client:')) return `不支援的 MCP client：${raw.slice('Unsupported MCP client:'.length).trim()}`
  if (raw.startsWith('MCP setup requires absolute')) return 'MCP 設定需要絕對的 Node.js 與 bridge 路徑'
  if (raw.startsWith('MCP removal requires absolute')) return 'MCP 移除需要絕對的 Node.js 與 bridge 路徑'
  const codexStatus = raw.match(/^Codex usage request failed \((\d+)\)\.$/)
  if (codexStatus) return `Codex 用量請求失敗（${codexStatus[1]}）。`
  const claudeStatus = raw.match(/^Claude usage request failed \((\d+)\)\.$/)
  if (claudeStatus) return `Claude 用量請求失敗（${claudeStatus[1]}）。`
  return raw
}
