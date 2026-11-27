#!/usr/bin/env node
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
