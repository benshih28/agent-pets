// 主程序是唯一的真相；renderer 不保存任何東西，release 網址也不會進 renderer。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppUpdateOutcomeView, AppUpdateState } from '@/types/app-update'

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const state = ref<AppUpdateState | null>(null)
  const checking = ref(false)
  const notice = ref<AppUpdateOutcomeView | null>(null)

  const updateAvailable = computed(() => !!state.value?.latestVersion)

  function apply(next: unknown): void {
    if (!next || typeof next !== 'object') return
    const value = next as Partial<AppUpdateState>
    if (typeof value.currentVersion !== 'string' || typeof value.enabled !== 'boolean') return
    state.value = {
      currentVersion: value.currentVersion,
      enabled: value.enabled,
      lastCheckedAt: typeof value.lastCheckedAt === 'number' ? value.lastCheckedAt : null,
      lastResult: value.lastResult === 'up_to_date' || value.lastResult === 'update_available' || value.lastResult === 'failed'
        ? value.lastResult : null,
      latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : null,
    }
  }

  async function refresh(): Promise<void> {
    try { apply(await window.electronAPI?.getAppUpdateState?.()) } catch { /* 保持目前畫面 */ }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    notice.value = null
    try { apply(await window.electronAPI?.setAppUpdateEnabled?.(enabled)) } catch { await refresh() }
  }

  async function checkNow(): Promise<void> {
    if (checking.value) return
    checking.value = true
    notice.value = null
    try {
      const response = await window.electronAPI?.checkAppUpdate?.()
      if (response) {
        apply(response.state)
        if (response.outcome === 'rate_limited') notice.value = 'rate_limited'
      }
    } catch {
      await refresh()
    } finally {
      checking.value = false
    }
  }

  async function openRelease(): Promise<void> {
    notice.value = null
    try {
      if (!(await window.electronAPI?.openAppUpdateRelease?.())) notice.value = 'open_failed'
    } catch {
      notice.value = 'open_failed'
    }
  }

  return { state, checking, notice, updateAvailable, refresh, setEnabled, checkNow, openRelease }
})
