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
//
// Dependency-free so it can run before `pnpm install` finishes in CI.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const defaultRoot = join(here, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(css|vue)$/.test(name)) out.push(full)
  }
  return out
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

  const info = { unused }
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
  return { byRule, unused: info.unused.length, rawControls: info.rawControls.length }
}

function main() {
  const strict = process.argv.includes('--strict')
  const verbose = process.argv.includes('--verbose')
  const result = analyze()
  const sum = summarize(result)
  for (const f of result.findings) {
    if (verbose || f.rule === 'undefined-var') console.log(`${f.rule}\t${f.file}:${f.line}\t${f.text}`)
  }
  console.log('design-token report:', JSON.stringify(sum))
  if (verbose && result.info.unused.length) console.log('unused tokens:', result.info.unused.join(' '))
  if (strict && result.findings.length > 0) {
    console.error('design-token check failed (--strict)')
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
