#!/usr/bin/env node
// Dependency-free guard for the failure classes behind RL-01/RL-02:
// floating loadURL() promises and a main entry without process-level handlers.
// A full ESLint setup with no-floating-promises can replace this later.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const problems = []

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
  })
}

for (const file of walk(join(root, 'electron'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    const code = line.trim()
    if (code.startsWith('//') || !code.includes('.loadURL(')) return
    const handled = /\.catch\(|await |void |return |=\s*\S*\.?(?:webContents|\w+)\.loadURL|const \w+ =|\? .*\.loadURL|: .*\.loadURL/.test(code)
    if (!handled) problems.push(`${relative(root, file)}:${index + 1}: loadURL() promise is not handled`)
  })
}

const main = readFileSync(join(root, 'electron/main.ts'), 'utf8')
if (!/installCrashGuard\(/.test(main)) problems.push('electron/main.ts must install the crash guard (uncaughtException / unhandledRejection)')
if (!/whenReady\(\)\.then\([\w.]+\)\.catch\(/.test(main)) problems.push('app.whenReady() chain must end with .catch()')

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('main-process lint passed')
