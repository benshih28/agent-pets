import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { locale } from '@/i18n'
import { useNow } from '@/composables/useNow'
import { formatRelative, type RelativeTimeOptions } from '@/utils/intl-format'

// 夾到 `now`：時鐘暫停或來源時鐘略超前時，過去的時間戳不會顯示成「…後」。
export function useRelativeTime(
  at: MaybeRefOrGetter<number>,
  options: MaybeRefOrGetter<RelativeTimeOptions | undefined> = {},
): ComputedRef<string> {
  const now = useNow()
  return computed(() => formatRelative(Math.min(toValue(at), now.value), now.value, locale.value, toValue(options)))
}
