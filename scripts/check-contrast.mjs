#!/usr/bin/env node
// WCAG 對比檢查：依 tokens.css 的層疊（選擇器特異度與檔案順序）解析每個情境下的
// token，跟著 var() 別名、color-mix(in srgb, …) 與 rgb()/hex 算出實際顏色，
// 再檢查 PAIRS 列出的每一組。半透明的背景（寵物泡泡、膠囊、玻璃層）會分別疊在
// 最差情況的黑色與白色桌面上，取兩者中較低的比值；半透明的前景再疊到該背景上。
// 任何一組低於門檻或無法解析就失敗（exit 1）。
// 插件主題由執行期驗證器（electron/plugin-panel-themes.ts）以同樣的規則檢查。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cssDeclarations } from './check-design-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const tokensPath = join(here, '..', 'src', 'styles', 'tokens.css')

// 每個情境＝套用到該視窗根元素的選擇器（不含 @media 區塊）。
export const CONTEXTS = {
  light: [':root', ":root[data-window='panel']", ":root[data-theme='light']"],
  dark: [':root', ":root[data-window='panel']", ":root[data-theme='dark']"],
  'pet-dark': [':root', ":root[data-window='pet']", ":root[data-theme='dark']", '.desktop-pet'],
  'pet-light': [':root', ":root[data-window='pet']", ":root[data-theme='light']", '.desktop-pet'],
}

// [前景 token, 背景 token, 最低比值, 說明]；4.5 = 內文，3 = 大字／圖形／焦點環。
export const PAIRS = [
  ['--organic-text', '--organic-bg', 4.5, 'body text'],
  ['--organic-text', '--organic-surface', 4.5, 'body text on card'],
  ['--organic-text-secondary', '--organic-surface', 4.5, 'secondary text'],
  ['--organic-text-secondary', '--organic-surface-2', 4.5, 'secondary text on hover'],
  ['--organic-text-muted', '--organic-bg', 4.5, 'muted text'],
  ['--organic-text-muted', '--organic-surface', 4.5, 'muted text on card'],
  ['--organic-text-muted', '--organic-surface-2', 4.5, 'muted text on hover'],
  ['--organic-text-faint', '--organic-surface', 3, 'decorative only, never text'],
  ['--organic-accent-text', '--organic-surface', 4.5, 'accent used as text'],
  ['--organic-accent-contrast', '--organic-accent-hover', 4.5, 'primary button label'],
  ['--organic-danger-text', '--organic-surface', 4.5, 'danger text'],
  ['--organic-success-text', '--organic-surface', 4.5, 'success text'],
  ['--organic-warn-text', '--organic-surface', 4.5, 'warning text'],
  ['--organic-danger-text', '--organic-surface-2', 4.5, 'danger text on hover'],
  ['--organic-warn-text', '--organic-surface-2', 4.5, 'warning text on hover'],
  ['--organic-success-text', '--organic-surface-2', 4.5, 'success text on hover'],
  ['--color-info', '--color-surface', 4.5, 'info text'],
  ['--color-info', '--color-surface-2', 4.5, 'info text on hover'],
  ['--color-focus', '--color-bg', 3, 'focus ring on the panel'],
  ['--color-focus', '--color-surface', 3, 'focus ring on a card'],
  ['--color-focus', '--color-surface-2', 3, 'focus ring on a hovered row'],
  ['--color-focus', '--organic-surface-warm', 3, 'focus ring on an accent-soft chip'],
  ['--accent-on', '--accent-hover', 4.5, 'primary button label'],
  ['--text-primary', '--surface-overlay', 4.5, 'dialog, menu, tooltip and toast text'],
  ['--text-muted', '--surface-overlay', 4.5, 'dialog helper text'],
  // 危險按鈕（Button variant="danger"）：對話框、卡片與面板底上的標籤，以及懸停時 12% 危險色的底。
  ['--text-danger', '--surface-overlay', 4.5, 'danger button label in a dialog'],
  ['--text-danger', 'color-mix(in srgb, var(--text-danger) 12%, var(--surface-overlay))', 4.5, 'hovered danger button in a dialog'],
  ['--text-danger', '--surface-raised', 4.5, 'danger button label on a card'],
  ['--text-danger', 'color-mix(in srgb, var(--text-danger) 12%, var(--surface-raised))', 4.5, 'hovered danger button on a card'],
  ['--text-danger', '--color-bg', 4.5, 'danger button label on the panel'],
  ['--text-danger', 'color-mix(in srgb, var(--text-danger) 12%, var(--color-bg))', 4.5, 'hovered danger button on the panel'],
  ['--state-idle', '--surface-raised', 4.5, 'idle state (may carry text)'],
  ['--state-offline', '--surface-raised', 3, 'offline state graphic'],
]

// 寵物視窗：泡泡、玻璃層與狀態膠囊浮在桌面上，半透明表面以黑、白桌面的較差者計算。
export const PET_PAIRS = [
  ['--pet-bubble-text', '--pet-bubble-surface', 4.5, 'bubble text'],
  ['--pet-bubble-success-text', '--pet-bubble-surface', 4.5, 'bubble success text'],
  ['--pet-bubble-error-text', '--pet-bubble-surface', 4.5, 'bubble error text'],
  ['--pet-bubble-warn-accent', '--pet-bubble-surface', 4.5, 'bubble waiting text'],
  ['--pet-bubble-info-accent', '--pet-bubble-surface', 4.5, 'bubble info text and icon'],
  ['--color-text-2', '--pet-bubble-surface', 4.5, 'bubble secondary text'],
  ['--color-text-3', '--pet-bubble-surface', 4.5, 'bubble source and time text'],
  ['--text-bright', '--surface-overlay', 4.5, 'permission bubble text'],
  ['--text-secondary', '--surface-overlay', 4.5, 'permission bubble secondary text'],
  ['--state-warn-bright', '--surface-overlay', 4.5, 'permission bubble warning text'],
  ['--text-danger', '--surface-overlay', 4.5, 'permission bubble danger text'],
  ['--state-success', '--surface-overlay', 4.5, 'permission bubble allow label'],
  ['--focus-ring-color', '--pet-bubble-surface', 3, 'focus ring on a bubble'],
  ['--focus-ring-color', '--organic-status-surface', 3, 'focus ring on the pill'],
  ['--organic-status-text', '--organic-status-surface', 4.5, 'pet status line text'],
  ['--organic-status-tooltip-text', '--organic-status-tooltip-surface', 4.5, 'pet quota tooltip text'],
  ['--organic-status-tooltip-muted', '--organic-status-tooltip-surface', 4.5, 'pet quota tooltip secondary text'],
  ['--organic-quota-sage', '--organic-status-surface', 3, 'quota fill (normal)'],
  ['--organic-quota-accent', '--organic-status-surface', 3, 'quota fill (Claude)'],
  ['--organic-quota-warning', '--organic-status-surface', 3, 'quota fill (low)'],
  ['--organic-quota-error', '--organic-status-surface', 3, 'quota fill (critical)'],
  ['--state-active', '--organic-status-surface', 3, 'thinking/tool state dot'],
  ['--state-idle', '--organic-status-surface', 3, 'idle state dot'],
  ['--color-bg', '--state-error', 4.5, 'error badge label'],
  ['--color-bg', '--state-success', 4.5, 'result badge label'],
]

const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const NAMED = { transparent: { r: 0, g: 0, b: 0, a: 0 }, black: BLACK, white: WHITE }

function specificity(selector) {
  return (selector.match(/\[[^\]]*\]|\.[a-z][a-z0-9-]*|:(?!:)[a-z-]+/gi) ?? []).length
}

/** 在 `context` 情境下每個自訂屬性的宣告值（依特異度、再依檔案順序覆寫）。 */
export function tokenMap(context = 'light', css = readFileSync(tokensPath, 'utf8')) {
  const applies = new Set(CONTEXTS[context])
  if (applies.size === 0) throw new TypeError(`unknown context ${context}`)
  const winners = new Map()
  cssDeclarations(css.replace(/\/\*[\s\S]*?\*\//g, '')).forEach((declaration, order) => {
    if (declaration.path.length !== 1 || !declaration.property.startsWith('--')) return
    const parts = declaration.selector.split(',').map(part => part.trim().replace(/\s+/g, ' ')).filter(part => applies.has(part))
    if (parts.length === 0) return
    const weight = Math.max(...parts.map(specificity))
    const current = winners.get(declaration.property)
    if (!current || weight > current.weight || (weight === current.weight && order > current.order)) {
      winners.set(declaration.property, { value: declaration.value, weight, order })
    }
  })
  return new Map([...winners].map(([name, { value }]) => [name, value]))
}

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += ch
  }
  parts.push(current.trim())
  return parts
}

function channel(value, scale) {
  return value.endsWith('%') ? (Number.parseFloat(value) / 100) * scale : Number.parseFloat(value)
}

/** color-mix(in srgb)：以預乘 alpha 內插，與 Chromium 相同。 */
function mixColors(first, p, second) {
  const a = first.a * p + second.a * (1 - p)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = key => (first[key] * first.a * p + second[key] * second.a * (1 - p)) / a
  return { r: mix('r'), g: mix('g'), b: mix('b'), a }
}

/** 把 token 名稱或 CSS 顏色值解析成 { r, g, b, a }（0–255、0–1）；無法解析時回傳 null。 */
export function resolveColor(map, value, depth = 0) {
  if (depth > 16 || typeof value !== 'string') return null
  const text = value.trim()
  if (text.startsWith('--')) return resolveColor(map, map.get(text), depth + 1)
  const named = NAMED[text.toLowerCase()]
  if (named) return { ...named }
  const variable = text.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i)
  if (variable) {
    const own = map.get(variable[1])
    const resolved = own && own !== 'initial' ? resolveColor(map, own, depth + 1) : null
    return resolved ?? (variable[2] ? resolveColor(map, variable[2], depth + 1) : null)
  }
  const hex = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    const [r, g, b, a = 255] = digits.match(/../g).map(pair => Number.parseInt(pair, 16))
    return { r, g, b, a: a / 255 }
  }
  const rgb = text.match(/^rgba?\(([^)]*)\)$/i)
  if (rgb) {
    const parts = rgb[1].includes(',') ? rgb[1].split(',').map(part => part.trim()) : rgb[1].replace('/', ' ').trim().split(/\s+/)
    if (parts.length < 3) return null
    return { r: channel(parts[0], 255), g: channel(parts[1], 255), b: channel(parts[2], 255), a: parts[3] === undefined ? 1 : channel(parts[3], 1) }
  }
  const mix = text.match(/^color-mix\(\s*in srgb\s*,([\s\S]*)\)$/i)
  if (mix) {
    const args = splitTopLevel(mix[1]).map(part => {
      const m = part.match(/^([\s\S]*?)(?:\s+([\d.]+)%)?$/)
      return { color: resolveColor(map, m[1], depth + 1), weight: m[2] === undefined ? null : Number(m[2]) / 100 }
    })
    if (args.length !== 2 || !args[0].color || !args[1].color) return null
    const p = args[0].weight ?? (args[1].weight === null ? 0.5 : 1 - args[1].weight)
    return mixColors(args[0].color, p, args[1].color)
  }
  return null
}

export function composite(foreground, background) {
  const a = foreground.a + background.a * (1 - foreground.a)
  const blend = key => (foreground[key] * foreground.a + background[key] * background.a * (1 - foreground.a)) / a
  return { r: blend('r'), g: blend('g'), b: blend('b'), a }
}

function toColor(value) {
  return typeof value === 'string' ? resolveColor(new Map(), value) : value
}

export function luminance(value) {
  const color = toColor(value)
  const [r, g, b] = [color.r, color.g, color.b]
    .map(v => v / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 前景對背景的最差比值：半透明背景分別疊在黑、白桌面上，半透明前景再疊上去。 */
export function worstContrast(foreground, background) {
  const bases = background.a >= 1 ? [background] : [BLACK, WHITE].map(desktop => composite(background, desktop))
  return Math.min(...bases.map(base => contrast(foreground.a >= 1 ? foreground : composite(foreground, base), base)))
}

export function evaluate(map = tokenMap(), pairs = PAIRS) {
  return pairs.map(([fg, bg, min, note]) => {
    const f = resolveColor(map, fg)
    const b = resolveColor(map, bg)
    const ratio = f && b ? worstContrast(f, b) : null
    return { fg, bg, min, note, ratio, ok: ratio !== null && ratio >= min }
  })
}

export function pairsFor(context) {
  return context.startsWith('pet-') ? PET_PAIRS : PAIRS
}

function main() {
  let failed = 0
  for (const context of Object.keys(CONTEXTS)) {
    console.log(`# ${context}`)
    for (const r of evaluate(tokenMap(context), pairsFor(context))) {
      const shown = r.ratio === null ? 'unresolved' : r.ratio.toFixed(2)
      if (!r.ok) failed++
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${shown.padStart(6)} (min ${r.min})  ${r.fg} on ${r.bg}  — ${r.note}`)
    }
  }
  if (failed) {
    console.error(`${failed} contrast pair(s) below threshold`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
