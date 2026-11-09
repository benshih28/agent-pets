import { fillTemplate, locale, type TranslationParams } from '@/i18n'
import zhTW from '@/locales/themeEditor/zh-TW.json'
import enUS from '@/locales/themeEditor/en-US.json'

// 主題編輯器專用的文案（約 200 則，每種語言約 12 KB）。只由編輯器的 chunk 引入，所以在
// 第一次開啟編輯器時才載入，不增加面板啟動時的共用 chunk；在其他地方也會出現的文案
// （「我的主題」、匯入、匯出、錯誤）仍在 design 領域。

export type ThemeEditorKey = keyof typeof zhTW

// 顯式標註：en-US.json 缺漏或多出 key 時編譯期報錯（與 i18n.ts 的做法相同）。
const english: Record<ThemeEditorKey, string> = enUS
const chinese: Record<ThemeEditorKey, string> = zhTW

export function te(key: ThemeEditorKey, params: TranslationParams = {}): string {
  return fillTemplate(locale.value === 'en-US' ? english[key] : chinese[key], params)
}
