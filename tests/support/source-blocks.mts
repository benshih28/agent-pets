import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function blockLines(source: string, start: RegExp): string[] {
  const match = start.exec(source)
  if (!match) throw new Error(`block not found: ${start}`)
  const open = source.indexOf('{', match.index + match[0].length - 1)
  let depth = 0
  let end = open
  for (; end < source.length; end += 1) {
    const char = source[end]
    if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) break
  }
  return source.slice(open + 1, end).split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('//'))
}

export function readSources(directory: string, extra: readonly string[] = []): string {
  const files = readdirSync(directory).filter(name => name.endsWith('.ts')).map(name => join(directory, name))
  return [...files, ...extra].map(file => readFileSync(file, 'utf8')).join('\n')
}
