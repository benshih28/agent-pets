import { isPluginThemeSnapshot, PLUGIN_THEME_TOKENS, type PluginThemeSnapshot } from '../src/types/plugin-theme.ts'

// 只用 CSSOM 的 setProperty 寫入，不組 CSS 文字：插件頁面不允許 inline style，也無法注入其他宣告。
// preload 執行時 `<html>` 還不存在，所以先寫 adopted stylesheet 的 `:root` 規則，元素建立後再寫 inline style。

interface ThemeStyleTarget {
  setProperty(name: string, value: string): void
}

export interface PluginThemeDocument {
  readonly documentElement: { readonly style: ThemeStyleTarget } | null
  adoptedStyleSheets: unknown[]
  addEventListener(type: 'DOMContentLoaded', listener: () => void, options: { once: true }): void
}

export interface PluginThemeSheetFactory {
  (): { sheet: unknown; rule: ThemeStyleTarget }
}

function writeTokens(target: ThemeStyleTarget, snapshot: PluginThemeSnapshot): void {
  for (const name of PLUGIN_THEME_TOKENS) target.setProperty(name, snapshot.tokens[name])
}

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

export function constructRootThemeSheet(): { sheet: CSSStyleSheet; rule: CSSStyleDeclaration } {
  const sheet = new CSSStyleSheet()
  sheet.insertRule(':root {}')
  return { sheet, rule: (sheet.cssRules[0] as CSSStyleRule).style }
}
