import { createHash } from 'node:crypto'
import { resolvePanelThemes, type ResolvedPanelTheme } from '../plugin-panel-themes.ts'

// 鍵是宣告內容的 SHA-256，所以同版本號下內容改變（開發者資料夾重新載入）一定重新驗證。
// 容量有上限，惡意或異常的大量插件無法讓快取無限成長。
export const PANEL_THEME_CACHE_MAX_ENTRIES = 32

type Resolve = (declared: unknown) => ResolvedPanelTheme[] | null

// 縱深防禦：不受信任的深層巢狀會得到可預期的 RangeError，而不是耗盡呼叫堆疊。
export const CANONICAL_JSON_MAX_DEPTH = 32

export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > CANONICAL_JSON_MAX_DEPTH) throw new RangeError('content is nested too deeply to hash')
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function panelThemeContentHash(declared: unknown): string {
  return createHash('sha256').update(canonicalJson(declared), 'utf8').digest('hex')
}

export class ContentHashCache<T> {
  private readonly entries = new Map<string, T>()
  private readonly hashes = new WeakMap<object, string>()
  private readonly maxEntries: number
  private readonly compute: (value: unknown) => T
  private hitCount = 0
  private missCount = 0

  constructor(compute: (value: unknown) => T, maxEntries = PANEL_THEME_CACHE_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries)
    this.compute = compute
  }

  keyOf(value: unknown): string {
    if (!value || typeof value !== 'object') return panelThemeContentHash(value)
    const known = this.hashes.get(value)
    if (known) return known
    const hash = panelThemeContentHash(value)
    this.hashes.set(value, hash)
    return hash
  }

  lookup(value: unknown): { key: string; result: T } {
    const key = this.keyOf(value)
    if (this.entries.has(key)) {
      const result = this.entries.get(key)!
      this.entries.delete(key)
      this.entries.set(key, result)
      this.hitCount += 1
      return { key, result }
    }
    this.missCount += 1
    const result = this.compute(value)
    this.entries.set(key, result)
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return { key, result }
  }

  peek(key: string): T | undefined {
    return this.entries.get(key)
  }

  retain(live: ReadonlySet<string>): void {
    for (const key of [...this.entries.keys()]) if (!live.has(key)) this.entries.delete(key)
  }

  get size(): number {
    return this.entries.size
  }

  get stats(): { hits: number; misses: number } {
    return { hits: this.hitCount, misses: this.missCount }
  }
}

export class PanelThemeResolveCache extends ContentHashCache<ResolvedPanelTheme[] | null> {
  constructor(options: { maxEntries?: number; resolve?: Resolve } = {}) {
    super(options.resolve ?? resolvePanelThemes, options.maxEntries)
  }

  get(declared: unknown): { key: string; themes: ResolvedPanelTheme[] | null } {
    const { key, result } = this.lookup(declared)
    return { key, themes: result }
  }
}
