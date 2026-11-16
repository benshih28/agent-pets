#!/usr/bin/env node
// 主程序 entry 的 crash guard 檢查：ESLint 不好表達「main.ts 必須安裝 handler」這類跨檔契約，所以留在這裡。
// 未處理的 Promise（RL-01 的 loadURL）已改由 eslint.config.mjs 的 `@typescript-eslint/no-floating-promises` 檢查；
// `pnpm lint` 先跑 ESLint 再跑這支。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// URL.pathname 在 Windows 會變成 `/C:/...`，再被 join 成 `C:\C:\...`；fileURLToPath 才是跨平台的轉法。
const root = fileURLToPath(new URL('..', import.meta.url))
const problems = []

const main = readFileSync(join(root, 'electron/main.ts'), 'utf8')
if (!/installCrashGuard\(/.test(main)) problems.push('electron/main.ts must install the crash guard (uncaughtException / unhandledRejection)')
if (!/whenReady\(\)\.then\([\w.]+\)\.catch\(/.test(main)) problems.push('app.whenReady() chain must end with .catch()')

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('main-process lint passed')
