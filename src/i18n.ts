import { ref } from 'vue'
import zhTWMessages from './locales/zh-TW.json' with { type: 'json' }
import enUSMessages from './locales/en-US.json' with { type: 'json' }
import zhTWErrors from './locales/errors.zh-TW.json' with { type: 'json' }
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './types/locale.ts'

export type TranslationParams = Record<string, string | number>

const messages = zhTWMessages

export type TranslationKey = keyof typeof messages

// 顯式標註 Record<TranslationKey, string>：若 en-US.json 缺漏或多出 key，這裡會編譯期報錯
const englishMessages: Record<TranslationKey, string> = enUSMessages

function readPersistedLocale(): AppLocale {
  try {
    if (typeof localStorage !== 'undefined' && isAppLocale(localStorage.getItem('agent-pet-locale'))) {
      return localStorage.getItem('agent-pet-locale') as AppLocale
    }
  } catch {}
  return DEFAULT_LOCALE
}

export const locale = ref<AppLocale>(readPersistedLocale())

export function getLocale(): AppLocale {
  return locale.value
}

export function setLocale(value: unknown): AppLocale {
  const next = isAppLocale(value) ? value : DEFAULT_LOCALE
  locale.value = next
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

export function translateBackendError(value: unknown): string {
  const raw = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : ''
  if (!raw) return '操作失敗'
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
