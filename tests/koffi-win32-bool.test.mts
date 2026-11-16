import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// 回歸：Win32 BOOL 是 4-byte int；koffi 的 `bool` 只讀 1 byte，回傳值的高位元組未定義。
// 這兩個檔案的 koffi 簽章都不能把 `bool` 當回傳型別或參數型別。
const FILES = ['../electron/windows-window-activator.ts', '../electron/windows-fullscreen-detector.ts']

test('koffi Win32 signatures declare BOOL as int', () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const signatures = [...source.matchAll(/\.func\(\s*'([^']+)'/g)].map(match => match[1])
    assert.ok(signatures.length > 0, `${file} declares koffi functions`)
    for (const signature of signatures) {
      assert.doesNotMatch(signature, /(^|[(,\s])bool\s/, `${file}: ${signature}`)
    }
  }
})
