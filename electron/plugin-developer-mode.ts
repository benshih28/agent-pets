import * as fs from 'node:fs'
import * as path from 'node:path'

interface WatchedSource {
  pluginId: string
  root: string
  onChange: () => void | Promise<void>
  watcher: fs.FSWatcher
  debounce: ReturnType<typeof setTimeout> | null
}

/** Watches one selected source tree recursively and coalesces edits. */
export class PluginDeveloperModeWatcher {
  private readonly sources = new Map<string, WatchedSource>()
  private readonly debounceMs: number

  constructor(debounceMs = 500) {
    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0 || debounceMs > 10_000) {
      throw new TypeError('invalid developer watcher debounce')
    }
    this.debounceMs = debounceMs
  }

  watch(pluginId: string, directory: string, onChange: () => void | Promise<void>): boolean {
    this.unwatch(pluginId)
    if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId) || typeof onChange !== 'function') return false
    const selectedRoot = path.resolve(directory)
    try {
      const stat = fs.lstatSync(selectedRoot)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false
      const root = fs.realpathSync(selectedRoot)
      const watcher = fs.watch(root, { recursive: true, persistent: false }, () => this.schedule(pluginId))
      const source: WatchedSource = { pluginId, root, onChange, watcher, debounce: null }
      this.sources.set(pluginId, source)
      watcher.on('error', () => this.unwatch(pluginId))
      return true
    } catch {
      return false
    }
  }

  unwatch(pluginId: string): void {
    const source = this.sources.get(pluginId)
    if (!source) return
    this.sources.delete(pluginId)
    if (source.debounce) clearTimeout(source.debounce)
    source.watcher.close()
  }

  clear(): void {
    for (const pluginId of this.sources.keys()) this.unwatch(pluginId)
  }

  isWatching(pluginId: string, directory?: string): boolean {
    const source = this.sources.get(pluginId)
    if (!source || directory === undefined) return Boolean(source)
    try { return source.root === fs.realpathSync(path.resolve(directory)) } catch { return false }
  }

  destroy(): void {
    this.clear()
  }

  private schedule(pluginId: string): void {
    const source = this.sources.get(pluginId)
    if (!source) return
    if (source.debounce) clearTimeout(source.debounce)
    source.debounce = setTimeout(() => {
      source.debounce = null
      if (this.sources.get(pluginId) !== source) return
      try { void Promise.resolve(source.onChange()).catch(() => {}) } catch {}
    }, this.debounceMs)
  }
}
