// localStorage 的唯一出入口：讀寫都不丟例外。隱私模式、storage 被停用、配額滿，
// 或像 Node 測試這樣根本沒有 localStorage 時，讀取回退 registry 的 fallback，寫入回傳 false。
// 這裡存的都是單一使用者的介面偏好；真正需要可靠持久化的資料由主程序寫進 userData。
// Node 測試會直接載入本檔，所以執行期 import 只用相對路徑（見 agent-pets-conventions §1）。
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

/** 寫入成功回傳 true；storage 不可用時靜默略過，呼叫端照常更新自己的狀態。 */
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

/** 給需要多個 key 原始值的遷移規則（`readPetFeedbackDefaults`）；讀取失敗當作沒有存值。 */
export const safeStorageReader = Object.freeze({
  getItem(key: string): string | null {
    try {
      return storageOrNull()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
})

// --- 跨視窗同步 ---------------------------------------------------------------
// 寵物與面板是兩個同源視窗、各有一份 Pinia store；同源視窗共用一份 localStorage，
// 一邊寫入時瀏覽器會在「其他」同源視窗觸發 `storage` 事件，所以不需要額外的 IPC。

export interface StorageSyncBinding {
  readonly key: string
  readonly apply: (raw: string | null) => void
}

/**
 * 把一個 `sync: true` 的 key 綁到處理函式。`value` 是 registry 解析後的值，`raw` 是事件的
 * `newValue`（key 被移除時為 null）；舊規則在空值時不更新的 key，由處理函式自己看 `raw`。
 */
export function syncOn<T>(
  entry: StorageKeyDefinition<T, never> & { readonly sync: true },
  handler: (value: T, raw: string | null) => void,
): StorageSyncBinding {
  return { key: entry.key, apply: raw => handler(entry.parse(raw), raw) }
}

/** 註冊一個 `storage` 監聽器，依 key 以 Map 分派；回傳移除監聽器的函式。 */
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
