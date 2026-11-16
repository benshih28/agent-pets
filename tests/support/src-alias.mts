// 讓 Node 測試能直接載入使用 `@/` 別名的 renderer 模組（例如 Pinia store）。
// `@/` 只有 Vite／vue-tsc 認得；這裡以同步的 module hook 把 `@/x` 對應到 `src/x`，
// 沒有副檔名時依序補 `.ts`、`/index.ts`。只影響 import 這個檔案的測試行程
// （node --test 預設每個測試檔一個行程）。
import { existsSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = new URL('../../src/', import.meta.url)

function isFile(url: string): boolean {
  const path = fileURLToPath(url)
  return existsSync(path) && statSync(path).isFile()
}

function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith('@/')) return null
  const base = new URL(specifier.slice(2), SRC_ROOT).href
  return [base, `${base}.ts`, `${base}/index.ts`].find(isFile) ?? null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(resolveAlias(specifier) ?? specifier, context)
  },
})
