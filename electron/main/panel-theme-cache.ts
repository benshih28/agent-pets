import { createHash } from 'node:crypto'
import { resolvePanelThemes, type ResolvedPanelTheme } from '../plugin-panel-themes.ts'

// 解析後主題的快取（spec §16.5「validation cached by theme hash」）。鍵是宣告內容的
// SHA-256（鍵排序後的 JSON），所以同版本號下內容改變（開發者資料夾重新載入）一定重新驗證，
// 內容相同的插件更新則直接命中。容量有上限（LRU），sync 時再把已移除插件的項目丟掉。

/** 預設容量：遠大於一般安裝量，但讓惡意或異常的大量插件無法讓快取無限成長。 */
export const PANEL_THEME_CACHE_MAX_ENTRIES = 32

type Resolve = (declared: unknown) => ResolvedPanelTheme[] | null

/**
 * 巢狀深度上限。呼叫端只傳入解析後的主題（深度約 8），這只是縱深防禦：不受信任的深層巢狀
 * 會得到一個可預期的 RangeError，而不是耗盡呼叫堆疊。
 */
export const CANONICAL_JSON_MAX_DEPTH = 32

/** 鍵排序後的 JSON：同樣的內容不論屬性順序都得到同一個字串。 */
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

/**
 * 以內容雜湊為鍵、有上限的 LRU：同樣的內容（不論屬性順序）只計算一次。插件主題的解析結果與
 * 主題編輯器的驗證診斷共用這個實作（spec R17、R20）。
 */
export class ContentHashCache<T> {
  private readonly entries = new Map<string, T>()
  // 同一份 manifest 物件在多次 sync 之間不變：記住它的雜湊，不必每次重新序列化。
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

  /** 回傳結果與它的鍵；未命中時計算一次並存入（最近使用的排在最後）。 */
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

  /** 只依鍵取值，不改變使用順序。 */
  peek(key: string): T | undefined {
    return this.entries.get(key)
  }

  /** 丟掉不在 `live` 裡的項目。 */
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

/** 解析後插件主題的快取；插件暫時沒有 manifest 時以 `peek` 沿用最後一次的結果。 */
export class PanelThemeResolveCache extends ContentHashCache<ResolvedPanelTheme[] | null> {
  constructor(options: { maxEntries?: number; resolve?: Resolve } = {}) {
    super(options.resolve ?? resolvePanelThemes, options.maxEntries)
  }

  get(declared: unknown): { key: string; themes: ResolvedPanelTheme[] | null } {
    const { key, result } = this.lookup(declared)
    return { key, themes: result }
  }
}
