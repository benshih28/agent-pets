#!/usr/bin/env node
// .gitattributes 只在 Git 寫入時轉成 LF，工具直接寫出的 CRLF 會留在工作目錄，所以檢查工作目錄本身。
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = execFileSync('git', ['ls-files', '--eol', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})

const offenders = []
for (const record of output.split('\0')) {
  const tab = record.indexOf('\t')
  if (tab < 0) continue
  const working = record.slice(0, tab).split(/\s+/)[1]
  if (working === 'w/crlf' || working === 'w/mixed') offenders.push(record.slice(tab + 1))
}

if (offenders.length > 0) {
  console.error(`CRLF line endings found (convert to LF):\n${offenders.join('\n')}`)
  process.exit(1)
}
console.log('line-ending check passed')
