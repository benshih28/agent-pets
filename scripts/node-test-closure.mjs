// 測試若（直接或遞移）載入 tests/support/src-alias.mts，該行程已註冊 `@/` 的 resolver，
// 閉包不受限制（node --test 每個測試檔一個行程）。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// `import type` 與 `export type` 會被 strip，不算執行期相依。
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

const importCache = new Map()
function runtimeImports(file) {
  let targets = importCache.get(file)
  if (targets) return targets
  targets = []
  if (/\.(?:ts|mts|mjs)$/.test(file)) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)) {
      const specifier = match[2] ?? match[3]
      if (match[1] || !specifier.startsWith('.')) continue
      const target = resolve(dirname(file), specifier)
      if (existsSync(target)) targets.push(target)
    }
  }
  importCache.set(file, targets)
  return targets
}

function runtimeFiles(entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    stack.push(...runtimeImports(file))
  }
  return seen
}

export function nodeTestClosure(root) {
  const aliasHook = join(root, 'tests/support/src-alias.mts')
  const closure = new Set()
  for (const name of readdirSync(join(root, 'tests')).filter(entry => entry.endsWith('.test.mts'))) {
    const files = runtimeFiles(join(root, 'tests', name))
    if (files.has(aliasHook)) continue
    for (const file of files) closure.add(file)
  }
  return [...closure]
    .map(file => relative(root, file).split('\\').join('/'))
    .filter(file => file.startsWith('src/'))
    .sort()
}
