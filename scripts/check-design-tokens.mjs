#!/usr/bin/env node
// Design-token guard (report-only by default; pass --strict to fail on findings).
//
// Checks renderer CSS/Vue sources against docs in
// .agents/skills/pet-skill/references/ui-design-system.md:
//   undefined-var   var(--x) with no declaration anywhere in src/
//   bare-color      hex / rgb()/rgba()/hsl() literal outside tokens.css
//   small-font      font-size below 11px (or a non-token px size under 11)
//   literal-blur    backdrop-filter blur(<n>px) instead of a --blur-* token
//   unused-token    --token declared in tokens.css but never referenced
//                   (informational; never fails --strict)
//   glyph-icon     arrow/dingbat/emoji/× glyph in a .vue template (use ui/Icon.vue)
//   english-literal  untranslated [A-Za-z]{4,} text node in a .vue template (use t())
//   raw-control     <button|select|input> outside src/components/ui (informational)
//   raw-color       任何寫死的顏色（hex、rgb()/hsl()/oklch() 等、CSS 具名色、
//                   TS／Vue script 字串中的顏色），只有主題色盤來源 `--builtin-organic-*`
//                   例外。目前是基準模式（只回報、不讓 --strict 失敗）；
//                   `--raw-colors=fail` 會讓它失敗，統一主題完成後 CI 改用此旗標
//                   （見 docs/design/theme-token-audit.md）。
//
// Dependency-free so it can run before `pnpm install` finishes in CI.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const defaultRoot = join(here, '..')

function walk(dir, pattern = /\.(css|vue)$/, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, pattern, out)
    else if (pattern.test(name)) out.push(full)
  }
  return out
}

// ── raw-color ────────────────────────────────────────────────────────────
// 主題色盤的唯一字面值來源；其餘地方都必須經由 token 取得顏色。
const PALETTE_SOURCE = /^--builtin-organic-/
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const HEX = /#[0-9a-f]{3,8}\b/i
// CSS 具名色（不含 transparent、currentcolor 與 forced-colors 用的系統色）。
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod '
  + 'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
  + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew '
  + 'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
  + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream '
  + 'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen '
  + 'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown '
  + 'royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '))
const COLOR_PROPERTY = /^(?:--[a-z0-9-]+|color|background(?:-color|-image)?|border(?:-[a-z-]+)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|filter|stop-color|flood-color|lighting-color)$/i

function hasNamedColor(value) {
  for (const word of value.replace(/var\([^)]*\)/g, ' ').match(/(?<![-\w#])[a-z]+(?![-\w(])/gi) ?? []) {
    if (NAMED_COLORS.has(word.toLowerCase())) return true
  }
  return false
}

function cssValueHasColor(property, value) {
  const bare = value.replace(/url\([^)]*\)/g, '')
  return HEX.test(bare) || COLOR_FUNCTION.test(bare) || (COLOR_PROPERTY.test(property) && hasNamedColor(bare))
}

/**
 * 每筆字面顏色歸到一個介面群組，作為統一主題（spec §16）的工作清單。
 * 依 token 名稱或檔案判斷；第一個符合的規則勝出。
 */
const RAW_COLOR_GROUPS = [
  { group: 'pet-bubbles', test: ({ token }) => /^--pet-bubble-/.test(token ?? '') },
  { group: 'pet-status-pill', test: ({ token }) => /^--organic-status-/.test(token ?? '') },
  { group: 'quota-meters', test: ({ token }) => /^--organic-quota-/.test(token ?? '') },
  { group: 'panel-elevation', test: ({ token }) => /^--organic-[a-z]+-shadow$/.test(token ?? '') },
  { group: 'pet-window-chrome', test: ({ token }) => /^--(?:pet-drag-shadow|shadow-edge-handle)$/.test(token ?? '') },
  { group: 'pet-window-glass-light', test: ({ selector }) => /\.desktop-pet\b/.test(selector ?? '') },
  { group: 'scrollbars', test: ({ token }) => /^--scrollbar-/.test(token ?? '') },
  { group: 'agent-brand', test: ({ token }) => /-claude$/.test(token ?? '') },
  { group: 'agent-state-colours', test: ({ file, token }) => /src\/types\/agent\.ts$/.test(file) || /^--state-(?:idle|offline)$/.test(token ?? '') },
  { group: 'pet-sprite-effects', test: ({ file }) => /src\/components\/PetAnimation\.(?:vue|css)$/.test(file) },
  { group: 'pet-window-chrome', test: ({ file }) => /src\/components\/DesktopPet[A-Za-z]*\.(?:vue|css)$/.test(file) },
  { group: 'shared-controls', test: ({ file }) => /src\/components\/ui\//.test(file) },
  { group: 'shared-glass-layer', test: ({ token }) => /^--(?:surface|border|accent|text|state|gradient|shadow|focus-ring)-?/.test(token ?? '') },
]

function rawColorGroup(entry) {
  return RAW_COLOR_GROUPS.find(rule => rule.test(entry))?.group ?? 'other'
}

/**
 * 依宣告（而非逐行）切開 CSS：跨多行的值（例如多層 box-shadow）也會完整檢查。
 * 括號內的 `;`、`{`、`}`（如 data: URL）不算分隔。回傳每筆宣告的起始行、所屬選擇器
 * 與外層路徑（`path`，含 @media 等外層區塊）。
 */
export function cssDeclarations(css) {
  const out = []
  const selectors = []
  let buffer = ''
  let start = 1
  let line = 1
  let parens = 0
  for (const ch of css) {
    if (ch === '(') parens += 1
    else if (ch === ')') parens = Math.max(0, parens - 1)
    if (parens === 0 && (ch === '{' || ch === ';' || ch === '}')) {
      const text = buffer.trim()
      if (ch === '{') selectors.push(text)
      else if (text) {
        const m = text.match(/^(--[a-z0-9-]+|[a-z-]+)\s*:\s*([\s\S]+)$/i)
        if (m) out.push({ property: m[1], value: m[2].replace(/\s+/g, ' ').trim(), line: start, selector: selectors.at(-1) ?? '', path: [...selectors] })
      }
      if (ch === '}') selectors.pop()
      buffer = ''
    } else {
      if (!buffer.trim() && ch.trim()) start = line
      buffer += ch
    }
    if (ch === '\n') line += 1
  }
  return out
}

/** TS／Vue script 只看字串字面值；註解先去掉，避免把文件裡的格式說明算進來。 */
function scriptColorLines(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const hits = []
  code.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const literal = m[2]
      if (HEX.test(literal) && /^#[0-9a-f]{3,8}$/i.test(literal.trim())) hits.push({ line: i + 1, value: literal.trim() })
      else if (/\b(?:rgba?|hsla?|oklch)\(\s*[\d.]/i.test(literal)) hits.push({ line: i + 1, value: literal.trim() })
    }
  })
  return hits
}

/** Strip /* *\/ comments but keep line numbers stable. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function styleOnly(file, text) {
  if (!file.endsWith('.vue')) return text
  // Only analyse <style> blocks, but keep line numbers.
  const lines = text.split('\n')
  const keep = lines.map(() => false)
  let inStyle = false
  lines.forEach((line, i) => {
    if (/<style\b/.test(line)) { inStyle = true; return }
    if (/<\/style>/.test(line)) { inStyle = false; return }
    if (inStyle) keep[i] = true
  })
  return lines.map((l, i) => (keep[i] ? l : '')).join('\n')
}

export function analyze(root = defaultRoot) {
  const srcDir = join(root, 'src')
  const files = walk(srcDir)
  const tokensPath = join(srcDir, 'styles', 'tokens.css')
  const declared = new Set()
  const used = new Map() // name -> [{file,line,fallback}]
  const findings = []
  const rel = (f) => relative(root, f).split(sep).join('/')

  // Runtime-defined variables (style bindings / setProperty) count as declared.
  const allText = new Map()
  for (const file of files) allText.set(file, readFileSync(file, 'utf8'))
  for (const [file, text] of allText) {
    for (const m of text.matchAll(/(?:^|[\s;{"'`])(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1])
    for (const m of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/gi)) declared.add(m[1])
  }

  for (const [file, raw] of allText) {
    const isTokens = file === tokensPath
    const css = stripComments(styleOnly(file, raw))
    css.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
        const list = used.get(m[1]) ?? []
        list.push({ file, line: i + 1, fallback: Boolean(m[2]) })
        used.set(m[1], list)
      }
      if (isTokens) return
      if (/#[0-9a-f]{3,8}\b/i.test(line.replace(/url\([^)]*\)/g, ''))) {
        findings.push({ rule: 'bare-color', file: rel(file), line: i + 1, text: line.trim() })
      } else if (/\b(?:rgba?|hsla?)\(/i.test(line)) {
        findings.push({ rule: 'bare-color', file: rel(file), line: i + 1, text: line.trim() })
      }
      if (/backdrop-filter:\s*blur\(\s*[\d.]+px/i.test(line)) {
        findings.push({ rule: 'literal-blur', file: rel(file), line: i + 1, text: line.trim() })
      }
      const fs = line.match(/font-size:\s*(?:max\(\s*)?([\d.]+)px/i)
      if (fs && Number(fs[1]) < 11) {
        findings.push({ rule: 'small-font', file: rel(file), line: i + 1, text: line.trim() })
      }
    })
  }

  for (const [name, uses] of used) {
    if (declared.has(name)) continue
    for (const u of uses) {
      findings.push({
        rule: 'undefined-var', file: rel(u.file), line: u.line,
        text: `${name}${u.fallback ? ' (has fallback)' : ''}`,
      })
    }
  }

  // TS 與 Vue script／template 裡的 var(--x) 字串（例如 :style 綁定）也算使用，否則會誤報為未使用。
  for (const file of walk(srcDir, /\.(ts|vue)$/)) {
    let text = allText.get(file) ?? readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) text = text.replace(/<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ' '))
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) if (!used.has(m[1])) used.set(m[1], [])
  }

  const tokenText = allText.get(tokensPath) ?? ''
  const unused = []
  for (const m of stripComments(tokenText).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
    if (!used.has(m[1])) unused.push(m[1])
  }

  const glyph = /[\u00D7\u2190-\u27BF\u2B00-\u2BFF]|\p{Extended_Pictographic}/u
  for (const [file, text] of allText) {
    if (!file.endsWith('.vue') || file.endsWith(`${sep}Icon.vue`)) continue
    const tpl = text.split('<style')[0].replace(/<script[\s\S]*?<\/script>/g, (m) => m.replace(/[^\n]/g, ' '))
    tpl.split('\n').forEach((line, i) => {
      const visible = line.replace(/<!--[\s\S]*?-->/g, '')
      if (glyph.test(visible)) findings.push({ rule: 'glyph-icon', file: rel(file), line: i + 1, text: visible.trim() })
    })
  }

  for (const [file, text] of allText) {
    if (!file.endsWith('.vue')) continue
    const tpl = text.split('<style')[0].replace(/<script[\s\S]*?<\/script>/g, (m) => m.replace(/[^\n]/g, ' '))
    tpl.split('\n').forEach((line, i) => {
      for (const m of line.replace(/<!--[\s\S]*?-->/g, '').matchAll(/>([^<>{}]*[A-Za-z]{4,}[^<>{}]*)</g)) {
        findings.push({ rule: 'english-literal', file: rel(file), line: i + 1, text: m[1].trim() })
      }
    })
  }

  const rawColors = []
  for (const [file, raw] of allText) {
    const isTokens = file === tokensPath
    for (const { property, value, line, selector } of cssDeclarations(stripComments(styleOnly(file, raw)))) {
      if (!cssValueHasColor(property, value)) continue
      if (isTokens && PALETTE_SOURCE.test(property)) continue
      const entry = { file: rel(file), line, token: property.startsWith('--') ? property : null, selector, value }
      rawColors.push({ ...entry, group: rawColorGroup(entry) })
    }
  }
  for (const file of walk(srcDir, /\.(ts|vue)$/)) {
    let text = allText.get(file) ?? readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) text = text.replace(/<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ' '))
    for (const hit of scriptColorLines(text)) {
      const entry = { file: rel(file), line: hit.line, token: null, selector: '', value: hit.value }
      rawColors.push({ ...entry, group: rawColorGroup(entry) })
    }
  }

  const info = { unused, rawColors }
  info.rawControls = []
  for (const [file, text] of allText) {
    if (!file.endsWith('.vue') || file.includes(`${sep}components${sep}ui${sep}`)) continue
    const tpl = text.split('<style')[0]
    tpl.split('\n').forEach((line, i) => {
      if (/<(button|select|input)\b/.test(line)) info.rawControls.push(`${rel(file)}:${i + 1}`)
    })
  }
  return { findings, info }
}

export function summarize({ findings, info }) {
  const byRule = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  const rawColorsByGroup = {}
  for (const entry of info.rawColors) rawColorsByGroup[entry.group] = (rawColorsByGroup[entry.group] ?? 0) + 1
  return { byRule, unused: info.unused.length, rawControls: info.rawControls.length, rawColors: info.rawColors.length, rawColorsByGroup }
}

/** raw-color 目前只回報；`rawColorsFail` 開啟後（統一主題完成時）任何一筆都會失敗。 */
export function shouldFail(result, { strict = false, rawColorsFail = false } = {}) {
  return (strict && result.findings.length > 0) || (rawColorsFail && result.info.rawColors.length > 0)
}

function main() {
  const strict = process.argv.includes('--strict')
  const verbose = process.argv.includes('--verbose')
  const rawColorsFail = process.argv.includes('--raw-colors=fail')
  const result = analyze()
  const sum = summarize(result)
  for (const f of result.findings) {
    if (verbose || f.rule === 'undefined-var') console.log(`${f.rule}\t${f.file}:${f.line}\t${f.text}`)
  }
  console.log('design-token report:', JSON.stringify(sum))
  if (verbose && result.info.unused.length) console.log('unused tokens:', result.info.unused.join(' '))
  if (process.argv.includes('--raw-colors')) {
    for (const entry of result.info.rawColors) console.log(`raw-color\t${entry.group}\t${entry.file}:${entry.line}\t${entry.token ?? ''}\t${entry.value}`)
  }
  if (shouldFail(result, { strict, rawColorsFail })) {
    console.error(`design-token check failed (${rawColorsFail && result.info.rawColors.length ? '--raw-colors=fail' : '--strict'})`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
