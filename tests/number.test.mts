import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { clamp } from '../src/utils/number.ts'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) return sourceFiles(file)
    return /\.(?:ts|vue)$/.test(file) ? [file] : []
  })
}

test('clamp keeps the behaviour of the three copies it replaced', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-3, 0, 10), 0)
  assert.equal(clamp(42, 0, 10), 10)
  assert.equal(clamp(0, 0, 0), 0)
  // min > max：下限優先（拖曳時精靈比 work area 大，就貼齊左上角）。
  assert.equal(clamp(5, 10, 0), 10)
  assert.ok(Number.isNaN(clamp(Number.NaN, 0, 10)))
})

test('clamp has one implementation in the main process and the renderer', () => {
  const offenders = [...sourceFiles('electron'), ...sourceFiles('src')]
    .filter(file => file !== path.join('src', 'utils', 'number.ts'))
    .filter(file => /function clamp\(/.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders, [])
})
