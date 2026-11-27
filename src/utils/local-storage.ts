// 讀寫都不丟例外：沒有 localStorage（隱私模式、配額滿、Node 測試）時，讀取回退 fallback，寫入回傳 false。
// Node 測試會直接載入本檔，所以執行期 import 只用相對路徑。
import type { StorageKeyDefinition } from './storage-keys.ts'

// 某些環境光是讀 `localStorage` 這個屬性就會丟 SecurityError，所以取用本身也要包在 try 裡。
function storageOrNull(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function readStored<T>(entry: StorageKeyDefinition<T, never>): T {
  try {
    const storage = storageOrNull()
    return storage ? entry.parse(storage.getItem(entry.key)) : entry.fallback
  } catch {
    return entry.fallback
  }
}

export function writeStored<W>(entry: StorageKeyDefinition<unknown, W>, value: NoInfer<W>): boolean {
  try {
    const storage = storageOrNull()
    if (!storage) return false
    storage.setItem(entry.key, entry.serialize(value))
    return true
  } catch {
    return false
  }
}

export const safeStorageReader = Object.freeze({
  getItem(key: string): string | null {
    try {
      return storageOrNull()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
})

export interface StorageSyncBinding {
  readonly key: string
  readonly apply: (raw: string | null) => void
}

/** `raw` 是事件的 `newValue`（key 被移除時為 null）；空值時不更新的 key，由處理函式自己看 `raw`。 */
export function syncOn<T>(
  entry: StorageKeyDefinition<T, never> & { readonly sync: true },
  handler: (value: T, raw: string | null) => void,
): StorageSyncBinding {
  return { key: entry.key, apply: raw => handler(entry.parse(raw), raw) }
}

export function listenStorageSync(bindings: readonly StorageSyncBinding[]): () => void {
  const byKey = new Map(bindings.map(binding => [binding.key, binding.apply]))
  if (byKey.size !== bindings.length) throw new Error('listenStorageSync: duplicate storage key binding')
  // `localStorage.clear()` 送出的事件 key 是 null，舊實作也不處理它。
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null) byKey.get(event.key)?.(event.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
