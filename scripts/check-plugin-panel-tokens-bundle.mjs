#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../dist-electron/main.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const marker = '--surface-panel'

assert.ok(source.includes(marker), 'tokens.css must retain the expected shared token marker')
assert.ok(bundle.includes(marker), 'built Electron main bundle must embed shared tokens.css')
console.log('plugin panel shared tokens are embedded in dist-electron/main.js')
