<script setup lang="ts">
import { computed } from 'vue'
import { locale } from '@/i18n'
import { useRelativeTime } from '@/composables/useRelativeTime'
import { formatDateTimeFull, type RelativeTimeOptions } from '@/utils/intl-format'

// 每個時間戳自己訂閱共用時鐘，只有標籤字串改變的那一列會重新繪製。
const props = defineProps<{ at: number; options?: RelativeTimeOptions }>()
const label = useRelativeTime(() => props.at, () => props.options)
const iso = computed(() => new Date(props.at).toISOString())
const full = computed(() => formatDateTimeFull(props.at, locale.value))
</script>

<template>
  <time :datetime="iso" :title="full">{{ label }}</time>
</template>
