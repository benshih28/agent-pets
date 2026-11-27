import { fillTemplate, locale, type TranslationParams } from '@/i18n'
import zhTW from '@/locales/themeEditor/zh-TW.json'
import enUS from '@/locales/themeEditor/en-US.json'

// 只由編輯器的 chunk 引入，所以第一次開啟編輯器時才載入，不增加面板啟動時的共用 chunk。

export type ThemeEditorKey = keyof typeof zhTW

const english: Record<ThemeEditorKey, string> = enUS
const chinese: Record<ThemeEditorKey, string> = zhTW

export function te(key: ThemeEditorKey, params: TranslationParams = {}): string {
  return fillTemplate(locale.value === 'en-US' ? english[key] : chinese[key], params)
}
