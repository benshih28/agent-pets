import type { PluginInstancePreferences, PluginPanelSnapshot, PluginPreferences } from '../../types/plugin'

export type PluginPreferencePatch = Partial<Pick<PluginInstancePreferences, 'enabled' | 'muted' | 'rateLimitPer10Min' | 'targetPetId' | 'grantedHosts'>>

type SnapshotLike = Pick<PluginPanelSnapshot, 'plugins'> & { preferences: Pick<PluginPreferences, 'plugins'> }

/**
 * 樂觀更新：先把 patch 套到快照（卡片與偏好表兩處），回傳被覆蓋的舊值，失敗時用來回滾。
 * 只記錄 patch 碰到的欄位，所以排隊中的其他變更不會被整份快照覆寫。
 */
export function applyPreferencePatch(snapshot: SnapshotLike, pluginId: string, patch: PluginPreferencePatch): PluginPreferencePatch {
  const previous: Record<string, unknown> = {}
  const plugin = snapshot.plugins.find(item => item.id === pluginId)
  const stored = snapshot.preferences.plugins[pluginId]
  const targets = [plugin?.preference, stored].filter((value): value is PluginInstancePreferences => Boolean(value))
  for (const key of Object.keys(patch) as Array<keyof PluginPreferencePatch>) {
    if (targets[0]) previous[key] = targets[0][key]
    for (const target of targets) (target as unknown as Record<string, unknown>)[key] = patch[key]
  }
  return previous as PluginPreferencePatch
}

export function rollbackPreferencePatch(snapshot: SnapshotLike, pluginId: string, previous: PluginPreferencePatch): void {
  applyPreferencePatch(snapshot, pluginId, previous)
}

/** 以主行程回傳的完整偏好為準，同步到快照，不必整頁重新抓取。 */
export function mergePreferencesResult(snapshot: SnapshotLike & { preferences: PluginPreferences }, preferences: PluginPreferences): void {
  snapshot.preferences = preferences
  for (const plugin of snapshot.plugins) {
    const next = preferences.plugins[plugin.id]
    if (next) plugin.preference = { ...next }
  }
}

/** 依 key 串行執行：同一個 key 的工作一次一個、依序完成，不同 key 互不等待；前一個失敗不會卡住後面。 */
export function createSerialQueue() {
  const tails = new Map<string, Promise<unknown>>()
  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}
