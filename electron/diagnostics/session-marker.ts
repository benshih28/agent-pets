import * as fs from 'node:fs'
import * as path from 'node:path'

export interface RunMarker {
  /** True when the previous run left its marker behind (crash, kill, power loss). */
  previousRunUnclean: boolean
  clear(): void
}

/** Writes `running.lock` at startup; a normal quit removes it. */
export function acquireRunMarker(directory: string, now: () => number = Date.now): RunMarker {
  const file = path.join(directory, 'running.lock')
  let previousRunUnclean = false
  try { previousRunUnclean = fs.existsSync(file) } catch {}
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(file, String(now()), { mode: 0o600 })
  } catch {}
  return {
    previousRunUnclean,
    clear() { try { fs.rmSync(file, { force: true }) } catch {} },
  }
}
