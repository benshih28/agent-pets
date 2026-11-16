// 寵物視窗的插件徽章：訂閱主程序推送的徽章、依寵物分組摘要，並決定目前是否顯示。
// revision 計數避免「初次 get 的回應」蓋掉較新的推送。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { locale, t } from '@/i18n'
import type { PluginBadgeView } from '@/types/plugin'
import { summarizePluginBadgesForPet } from '@/utils/plugin-badges'

export type PluginBadgeSummary = ReturnType<typeof summarizePluginBadgesForPet>

const NO_BADGES: PluginBadgeSummary = { badges: [], hiddenCount: 0 }

export function usePetPluginBadges(feedTargetPetId: () => string) {
  const store = useAgentStore()
  const badges = ref<PluginBadgeView[]>([])
  const documentVisible = ref(true)
  let cleanupListener: (() => void) | null = null
  let revision = 0

  const visible = computed(() => documentVisible.value && store.petWindowMode.mode === 'normal')

  function summaryFor(petId: string): PluginBadgeSummary {
    if (!visible.value) return NO_BADGES
    return summarizePluginBadgesForPet(badges.value, petId, feedTargetPetId())
  }

  function tooltip(badge: PluginBadgeView): string {
    return t('pluginBadgeTooltip', { plugin: badge.pluginName[locale.value], text: badge.text })
  }

  function onVisibilityChange(): void {
    documentVisible.value = document.visibilityState === 'visible'
  }

  onMounted(() => {
    documentVisible.value = document.visibilityState === 'visible'
    document.addEventListener('visibilitychange', onVisibilityChange)
    cleanupListener = window.electronAPI?.onPluginBadgesChanged?.((next) => {
      revision += 1
      badges.value = next
    }) ?? null
    const getPluginBadges = window.electronAPI?.getPluginBadges
    if (getPluginBadges) {
      const startedAt = revision
      void getPluginBadges().then((next) => {
        if (revision === startedAt) badges.value = next
      }).catch(() => {})
    }
  })

  onBeforeUnmount(() => {
    cleanupListener?.()
    cleanupListener = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { visible, summaryFor, tooltip }
}
