import { isPluginThemeSnapshot, PLUGIN_THEME_TOKENS, type PluginThemeSnapshot } from '../src/types/plugin-theme.ts'

// 插件頁面上的 `--ap-*`（由 plugin-ui-preload 使用；不 import Electron，方便測試）。
//
// 名稱與值都先過白名單（isPluginThemeSnapshot），只用 CSSOM 的 setProperty 寫入，不組 CSS 或 HTML
// 文字：不受 CSP style-src 限制（插件頁面不允許 inline style），也無法注入其他宣告。寫兩個地方：
// - adopted stylesheet 的 `:root` 規則：preload 執行時 `<html>` 還不存在，但 document 已經在，
//   所以頁面的第一個 script 執行時就讀得到（排在文件樣式表之後，蓋過 tokens.css 的 `initial`）；
// - `<html>` 的 inline style：元素建立後寫入，優先於頁面自己的 `:root` 規則（與文件描述一致）。

interface ThemeStyleTarget {
  setProperty(name: string, value: string): void
}

export interface PluginThemeDocument {
  readonly documentElement: { readonly style: ThemeStyleTarget } | null
  adoptedStyleSheets: unknown[]
  addEventListener(type: 'DOMContentLoaded', listener: () => void, options: { once: true }): void
}

export interface PluginThemeSheetFactory {
  /** 建立一張只有一條空 `:root {}` 規則的樣式表，回傳樣式表與規則的宣告區塊。 */
  (): { sheet: unknown; rule: ThemeStyleTarget }
}

function writeTokens(target: ThemeStyleTarget, snapshot: PluginThemeSnapshot): void {
  for (const name of PLUGIN_THEME_TOKENS) target.setProperty(name, snapshot.tokens[name])
}

/** 回傳套用函式；無效的值一律忽略。建立樣式表失敗時仍以 inline style 運作。 */
export function createPluginThemeApplier(document: PluginThemeDocument, createSheet: PluginThemeSheetFactory): (value: unknown) => void {
  let rule: ThemeStyleTarget | null = null
  try {
    const created = createSheet()
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, created.sheet]
    rule = created.rule
  } catch {
    rule = null
  }
  let latest: PluginThemeSnapshot | null = null
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement
    if (latest && root) writeTokens(root.style, latest)
  }, { once: true })
  return value => {
    if (!isPluginThemeSnapshot(value)) return
    latest = value
    if (rule) writeTokens(rule, value)
    const root = document.documentElement
    if (root) writeTokens(root.style, value)
  }
}

/** 瀏覽器端的樣式表工廠（constructable stylesheet）。 */
export function constructRootThemeSheet(): { sheet: CSSStyleSheet; rule: CSSStyleDeclaration } {
  const sheet = new CSSStyleSheet()
  sheet.insertRule(':root {}')
  return { sheet, rule: (sheet.cssRules[0] as CSSStyleRule).style }
}
