#!/usr/bin/env node
// Renderer bundle budget: fails when any single JS chunk grows past the limit.
// Run after `vite build`. Raise the limit deliberately, in the same PR as the growth.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LIMIT_BYTES = 250 * 1024
const directory = new URL('../dist/assets/', import.meta.url).pathname
const offenders = readdirSync(directory)
  .filter(name => name.endsWith('.js'))
  .map(name => ({ name, size: statSync(join(directory, name)).size }))
  .filter(item => item.size > LIMIT_BYTES)
if (offenders.length > 0) {
  for (const item of offenders) console.error(`${item.name}: ${(item.size / 1024).toFixed(1)} KB exceeds ${LIMIT_BYTES / 1024} KB`)
  process.exit(1)
}
console.log('renderer chunks are within the size budget')
