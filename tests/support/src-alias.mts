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
