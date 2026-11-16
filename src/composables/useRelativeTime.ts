import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { locale } from '@/i18n'
import { useNow } from '@/composables/useNow'
import { formatRelative, type RelativeTimeOptions } from '@/utils/intl-format'

/**
 * 隨共用時鐘（`useNow`）更新的相對時間標籤。過去的時間戳不可能晚於現在，所以先夾到 `now`：
 * 時鐘在兩次 tick 之間、文件隱藏暫停時，或來源時鐘稍微超前時，都不會顯示成「…後」。
 * `computed` 只在字串真的改變時才通知使用端，每秒 tick 不會讓整列重新繪製。
 */
export function useRelativeTime(
  at: MaybeRefOrGetter<number>,
  options: MaybeRefOrGetter<RelativeTimeOptions | undefined> = {},
): ComputedRef<string> {
  const now = useNow()
  return computed(() => formatRelative(Math.min(toValue(at), now.value), now.value, locale.value, toValue(options)))
}
