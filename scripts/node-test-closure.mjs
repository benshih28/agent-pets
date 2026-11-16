// 計算「tests/*.test.mts 在 Node 執行期（沒有 bundler）會載入的 src 檔案」閉包。
// 這些檔案不認得 tsconfig 的 `@/` alias，值 import 必須用相對路徑；ESLint 設定
// 用這份清單決定哪些檔案要反過來禁止 `@/`（import type 除外），所以清單不會和程式碼脫節。
// 例外：測試若（直接或遞移）載入 tests/support/src-alias.mts，該行程已註冊 `@/` 的 resolver，
// 這個測試的閉包不受限制（node --test 每個測試檔一個行程，所以以測試檔為單位判斷）。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// 只收值 import／re-export／動態 import；`import type` 與 `export type` 會被 strip，不算執行期相依。
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

// 每個檔案的直接值相依只解析一次；上百個測試檔共用同一批 src 檔，不必每個測試重讀重掃。
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

/** 單一測試檔在執行期會載入的所有檔案（絕對路徑）。 */
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

/** 回傳以 `/` 分隔、相對於 root 的 src 檔案路徑（已排序）。 */
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
