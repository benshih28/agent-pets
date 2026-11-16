// App 新版檢查：主程序是唯一的真相（開關、上次檢查、最新已知版本都存在主程序），renderer 只保存快照。
//
// - 事件輸入：設定頁的進階分頁掛載時 `refresh()`；開關 `setEnabled()`、按鈕 `checkNow()`、`openRelease()`。
//   沒有主程序廣播：自動檢查的結果在下次開啟設定頁時讀到，新版提示另走通知中心。
// - 計時器：無。
// - storage：無（不在 renderer 保存任何東西，release 網址也不會進 renderer）。
// - 跨視窗同步：只有設定面板會用，不同步。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppUpdateOutcomeView, AppUpdateState } from '@/types/app-update'

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const state = ref<AppUpdateState | null>(null)
  const checking = ref(false)
  /** 最近一次手動操作的結果（頻率限制／開啟失敗）；refresh 與下一次檢查會清掉。 */
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
