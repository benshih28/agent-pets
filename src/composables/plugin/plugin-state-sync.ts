import type { PluginInstancePreferences, PluginPanelSnapshot, PluginPreferences } from '../../types/plugin'

export type PluginPreferencePatch = Partial<Pick<PluginInstancePreferences, 'enabled' | 'muted' | 'rateLimitPer10Min' | 'targetPetId' | 'grantedHosts'>>

type SnapshotLike = Pick<PluginPanelSnapshot, 'plugins'> & { preferences: Pick<PluginPreferences, 'plugins'> }

// 只記錄 patch 碰到的欄位，回滾時才不會覆寫排隊中的其他變更。
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

export function mergePreferencesResult(snapshot: SnapshotLike & { preferences: PluginPreferences }, preferences: PluginPreferences): void {
  snapshot.preferences = preferences
  for (const plugin of snapshot.plugins) {
    const next = preferences.plugins[plugin.id]
    if (next) plugin.preference = { ...next }
  }
}

// 前一個任務失敗不會卡住同 key 後面的任務。
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
