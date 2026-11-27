#!/usr/bin/env node
// Dependency-free so it can run before `pnpm install` finishes in CI.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const defaultRoot = join(here, '..')

function walk(dir, pattern = /\.(css|vue|ts)$/, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, pattern, out)
    else if (pattern.test(name)) out.push(full)
  }
  return out
}

const PALETTE_SOURCE = /^--builtin-organic-/
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const HEX = /#[0-9a-f]{3,8}\b/i
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

// 第一個符合的規則勝出。
const RAW_COLOR_GROUPS = [
  { group: 'pet-bubbles', test: ({ token }) => /^--pet-bubble-/.test(token ?? '') },
  { group: 'pet-status-pill', test: ({ token }) => /^--organic-status-/.test(token ?? '') },
  { group: 'quota-meters', test: ({ token }) => /^--organic-quota-/.test(token ?? '') },
  { group: 'panel-elevation', test: ({ token }) => /^--organic-[a-z]+-shadow$/.test(token ?? '') },
  { group: 'pet-window-chrome', test: ({ token }) => /^--(?:pet-drag-shadow|shadow-edge-handle)$/.test(token ?? '') },
  { group: 'pet-window-glass-light', test: ({ selector }) => /\.desktop-pet\b/.test(selector ?? '') },
  { group: 'scrollbars', test: ({ token }) => /^--scrollbar-/.test(token ?? '') },
  { group: 'agent-brand', test: ({ token }) => /-claude$/.test(token ?? '') },
  { group: 'agent-state-colours', test: ({ file, token }) => /src\/utils\/agent-state-presentation\.ts$/.test(file) || /^--state-(?:idle|offline)$/.test(token ?? '') },
  { group: 'pet-sprite-effects', test: ({ file }) => /src\/components\/PetAnimation\.(?:vue|css)$/.test(file) },
  { group: 'pet-window-chrome', test: ({ file }) => /src\/components\/DesktopPet[A-Za-z]*\.(?:vue|css)$/.test(file) },
  { group: 'shared-controls', test: ({ file }) => /src\/components\/ui\//.test(file) },
  { group: 'shared-glass-layer', test: ({ token }) => /^--(?:surface|border|accent|text|state|gradient|shadow|focus-ring)-?/.test(token ?? '') },
]

function rawColorGroup(entry) {
  return RAW_COLOR_GROUPS.find(rule => rule.test(entry))?.group ?? 'other'
}

// 括號內的 `;`、`{`、`}`（如 data: URL）不算分隔。
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

// 註解先去掉，避免把文件裡的格式說明算進來。
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

const blank = (m) => m.replace(/[^\n]/g, ' ')

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank)
}

function styleOnly(file, text) {
  if (!file.endsWith('.vue')) return text
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

// docs/plugins/ux-guidelines.md 承諾給插件頁面的 token；app 自己沒用到也不算 unused（刪掉會弄壞插件）。
export const PLUGIN_SHARED_TOKENS = new Set([
  '--surface-panel', '--surface-raised', '--surface-raised-hover', '--surface-sunken', '--surface-overlay',
  '--text-primary', '--text-secondary', '--text-muted', '--text-danger', '--text-success', '--text-warning',
  '--border-subtle', '--border-strong', '--border-accent',
  '--state-success', '--state-warn', '--state-error', '--state-info',
  '--font-xs', '--font-sm', '--font-md', '--font-lg', '--font-xl', '--font-2xl',
  '--weight-normal', '--weight-medium', '--weight-bold', '--font-ui',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--hit-min', '--focus-ring-color', '--focus-ring-width', '--focus-ring-offset', '--transition-fast', '--transition-base',
])

const SPACING_PROPERTY = /^(?:(?:margin|padding)(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?|gap|row-gap|column-gap)$/i
const TRANSITION_PROPERTY = /^transition(?:-duration|-delay)?$/i
const ANIMATION_PROPERTY = /^animation(?:-duration|-delay)?$/i
const TIME_LITERAL = /^\d*\.?\d+m?s$/i
const PX_LITERAL = /^(-?)(\d*\.?\d+)px$/i
const CUBIC_BEZIER = /\bcubic-bezier\(/i
const INNER_FUNCTION = /[a-z-]*\([^()]*\)/gi
const SPACE_TOKEN = /^--space-[0-9-]+$/

function topLevelWords(value) {
  let v = value
  for (let prev = ''; prev !== v;) { prev = v; v = v.replace(INNER_FUNCTION, ' ') }
  return v.split(/[\s,/]+/).filter(Boolean)
}

function spacingScale(decls) {
  const scale = new Map()
  for (const { property, value, path } of decls) {
    if (path.length !== 1 || path[0] !== ':root' || !SPACE_TOKEN.test(property)) continue
    const m = value.match(PX_LITERAL)
    if (m && !m[1] && !scale.has(m[2])) scale.set(m[2], property)
  }
  return scale
}

function inlineStyleDeclarations(template) {
  const out = []
  template.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\sstyle="([^"]*)"/g)) {
      for (const part of m[1].split(';')) {
        const d = part.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i)
        if (d) out.push({ property: d[1], value: d[2], line: i + 1, selector: 'style=""', path: [] })
      }
    }
  })
  return out
}

function loadSource(file) {
  const raw = readFileSync(file, 'utf8')
  const isVue = file.endsWith('.vue')
  const isScript = file.endsWith('.ts')
  const css = isScript ? '' : stripComments(styleOnly(file, raw))
  // withComments 保留 HTML 註解，給 raw-control 讀理由。
  const withComments = isVue ? raw.replace(/<script\b[\s\S]*?<\/script>/g, blank).replace(/<style\b[\s\S]*?<\/style>/g, blank) : ''
  const template = withComments.replace(/<!--[\s\S]*?-->/g, blank)
  const script = isScript ? raw : isVue ? raw.replace(/<style\b[\s\S]*?<\/style>/g, blank) : ''
  const decls = isScript ? [] : cssDeclarations(css)
  if (isVue) decls.push(...inlineStyleDeclarations(template))
  return { file, raw, isVue, isScript, css, template, withComments, script, decls }
}

const RAW_CONTROL = /<(button|select|input)\b/
const RAW_CONTROL_REASON = /<!--\s*raw-control:\s*(.+?)\s*-->/
const GLYPH = /[×←-➿⬀-⯿]|\p{Extended_Pictographic}/u
const ENGLISH_TEXT = />([^<>{}]*[A-Za-z]{4,}[^<>{}]*)</g
const VAR_USE = /var\(\s*(--[a-z0-9-]+)\s*(,)?/gi
const DECLARED_PROPERTY = /(?:^|[\s;{"'`])(--[a-z0-9-]+)\s*:/gi
const DECLARED_STRING = /['"`](--[a-z0-9-]+)['"`]/gi
const TOKEN_DECLARATION = /^\s*(--[a-z0-9-]+)\s*:/gim

export function analyze(root = defaultRoot) {
  const srcDir = join(root, 'src')
  const tokensPath = join(srcDir, 'styles', 'tokens.css')
  const sources = walk(srcDir).map(loadSource)
  const declared = new Set()
  const used = new Map()
  const findings = []
  const rel = (f) => relative(root, f).split(sep).join('/')
  const tokens = sources.find(source => source.file === tokensPath)
  const scale = spacingScale(tokens?.decls ?? [])
  const info = { unused: [], rawColors: [], rawControls: [], rawControlsAccepted: [], rawSpacing: [], rawMotion: [] }

  for (const { raw, isScript } of sources) {
    if (isScript) continue
    for (const m of raw.matchAll(DECLARED_PROPERTY)) declared.add(m[1])
    for (const m of raw.matchAll(DECLARED_STRING)) declared.add(m[1])
  }

  for (const source of sources) {
    const { file, isVue, isScript, css, template, withComments, script, decls } = source
    const isTokens = file === tokensPath
    const where = rel(file)

    // TS 與 Vue script／template 裡的 var(--x) 字串（例如 :style 綁定）也算使用，否則會誤報為未使用。
    for (const m of script.matchAll(VAR_USE)) if (!used.has(m[1])) used.set(m[1], [])
    for (const hit of scriptColorLines(script)) {
      const entry = { file: where, line: hit.line, token: null, selector: '', value: hit.value }
      info.rawColors.push({ ...entry, group: rawColorGroup(entry) })
    }
    if (isScript) continue

    css.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(VAR_USE)) {
        const list = used.get(m[1]) ?? []
        list.push({ file, line: i + 1, fallback: Boolean(m[2]) })
        used.set(m[1], list)
      }
      if (isTokens) return
      if (/#[0-9a-f]{3,8}\b/i.test(line.replace(/url\([^)]*\)/g, ''))) {
        findings.push({ rule: 'bare-color', file: where, line: i + 1, text: line.trim() })
      } else if (/\b(?:rgba?|hsla?)\(/i.test(line)) {
        findings.push({ rule: 'bare-color', file: where, line: i + 1, text: line.trim() })
      }
      if (/backdrop-filter:\s*blur\(\s*[\d.]+px/i.test(line)) {
        findings.push({ rule: 'literal-blur', file: where, line: i + 1, text: line.trim() })
      }
      const fs = line.match(/font-size:\s*(?:max\(\s*)?([\d.]+)px/i)
      if (fs && Number(fs[1]) < 11) {
        findings.push({ rule: 'small-font', file: where, line: i + 1, text: line.trim() })
      }
    })

    for (const { property, value, line, selector } of decls) {
      if (cssValueHasColor(property, value) && !(isTokens && PALETTE_SOURCE.test(property))) {
        const entry = { file: where, line, token: property.startsWith('--') ? property : null, selector, value }
        info.rawColors.push({ ...entry, group: rawColorGroup(entry) })
      }
      if (isTokens) continue
      const text = `${property}: ${value}`
      if (CUBIC_BEZIER.test(value)) findings.push({ rule: 'literal-easing', file: where, line, text })
      const transition = TRANSITION_PROPERTY.test(property)
      const animation = ANIMATION_PROPERTY.test(property)
      const spacing = SPACING_PROPERTY.test(property)
      if (!transition && !animation && !spacing) continue
      for (const word of topLevelWords(value)) {
        if (TIME_LITERAL.test(word)) {
          if (transition) findings.push({ rule: 'literal-transition', file: where, line, text })
          else if (animation) info.rawMotion.push({ file: where, line, value: word, text })
          continue
        }
        const px = spacing && word.match(PX_LITERAL)
        if (!px || Number(px[2]) === 0) continue
        const token = !px[1] && scale.get(px[2])
        if (token) findings.push({ rule: 'literal-spacing', file: where, line, text: `${text} (${word} → var(${token}))` })
        else info.rawSpacing.push({ file: where, line, value: word, text })
      }
    }

    if (!isVue) continue
    const templateLines = template.split('\n')
    const commentLines = withComments.split('\n')
    const isIcon = file.endsWith(`${sep}Icon.vue`)
    const inUi = file.includes(`${sep}components${sep}ui${sep}`)
    templateLines.forEach((line, i) => {
      if (!isIcon && GLYPH.test(line)) findings.push({ rule: 'glyph-icon', file: where, line: i + 1, text: line.trim() })
      for (const m of line.matchAll(ENGLISH_TEXT)) {
        findings.push({ rule: 'english-literal', file: where, line: i + 1, text: m[1].trim() })
      }
      if (inUi || !RAW_CONTROL.test(line)) return
      let j = i - 1
      while (j >= 0 && !commentLines[j].trim()) j -= 1
      const reason = j >= 0 ? commentLines[j].match(RAW_CONTROL_REASON)?.[1] : undefined
      if (reason) info.rawControlsAccepted.push({ location: `${where}:${i + 1}`, reason })
      else info.rawControls.push(`${where}:${i + 1}`)
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

  const unused = new Set()
  for (const m of (tokens?.css ?? '').matchAll(TOKEN_DECLARATION)) {
    if (!used.has(m[1]) && !PLUGIN_SHARED_TOKENS.has(m[1])) unused.add(m[1])
  }
  info.unused = [...unused]
  return { findings, info }
}

export function summarize({ findings, info }) {
  const byRule = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  const rawColorsByGroup = {}
  for (const entry of info.rawColors) rawColorsByGroup[entry.group] = (rawColorsByGroup[entry.group] ?? 0) + 1
  return {
    byRule,
    unused: info.unused.length,
    rawControls: info.rawControls.length,
    rawControlsAccepted: info.rawControlsAccepted.length,
    rawSpacing: info.rawSpacing.length,
    rawMotion: info.rawMotion.length,
    rawColors: info.rawColors.length,
    rawColorsByGroup,
  }
}

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
  if (verbose) {
    if (result.info.unused.length) console.log('unused tokens:', result.info.unused.join(' '))
    for (const location of result.info.rawControls) console.log(`raw-control\t${location}`)
    for (const { location, reason } of result.info.rawControlsAccepted) console.log(`raw-control (accepted)\t${location}\t${reason}`)
    for (const entry of result.info.rawSpacing) console.log(`raw-spacing\t${entry.file}:${entry.line}\t${entry.text}`)
    for (const entry of result.info.rawMotion) console.log(`raw-motion\t${entry.file}:${entry.line}\t${entry.text}`)
  }
  if (process.argv.includes('--raw-colors')) {
    for (const entry of result.info.rawColors) console.log(`raw-color\t${entry.group}\t${entry.file}:${entry.line}\t${entry.token ?? ''}\t${entry.value}`)
  }
  if (shouldFail(result, { strict, rawColorsFail })) {
    console.error(`design-token check failed (${rawColorsFail && result.info.rawColors.length ? '--raw-colors=fail' : '--strict'})`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
