import fs from 'node:fs'
import { writeJsonAtomic } from './desktop-preferences.ts'
import { parsePanelUserSize, serializePanelUserSize, type PanelSize } from '../src/utils/panel-layout.ts'

// The one size the user dragged the control panel to. A single small versioned JSON;
// a missing, corrupt or tampered file is ignored and the first-run default applies.
export class PanelSizeStore {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: PanelSize | null | undefined

  private readonly filePath: string
  private readonly debounceMs: number

  constructor(filePath: string, debounceMs = 600) {
    this.filePath = filePath
    this.debounceMs = debounceMs
  }

  load(): PanelSize | null {
    try {
      return parsePanelUserSize(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch {
      return null
    }
  }

  // Dragging an edge fires continuously, so writes are coalesced. null clears the file.
  save(size: PanelSize | null): void {
    this.pending = size
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const pending = this.pending
    this.pending = undefined
    if (pending === undefined) return
    try {
      if (pending === null) fs.rmSync(this.filePath, { force: true })
      else writeJsonAtomic(this.filePath, serializePanelUserSize(pending))
    } catch {
      // Remembering the size is a convenience; a failed write must not affect the panel.
    }
  }
}
