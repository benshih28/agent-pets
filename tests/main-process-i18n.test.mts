import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'electron')
const files = [
  join(root, 'main.ts'),
  ...readdirSync(join(root, 'main')).filter(file => file.endsWith('.ts')).map(file => join(root, 'main', file)),
  ...readdirSync(join(root, 'diagnostics')).filter(file => file.endsWith('.ts')).map(file => join(root, 'diagnostics', file)),
]

test('main-process composition and runtime files contain no CJK string literals', () => {
  const offenders: string[] = []
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      const code = line.replace(/\s\/\/.*$/, '')
      if (/[一-鿿]/.test(code)) offenders.push(`${file.slice(root.length + 1)}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
})
