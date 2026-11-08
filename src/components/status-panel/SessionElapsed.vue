<script setup lang="ts">
import { computed } from 'vue'
import { useNow } from '@/composables/useNow'
import { formatElapsed } from '@/utils/session-view'

// Only this label re-renders each second, and only while it is mounted.
const props = defineProps<{ since: number }>()
const now = useNow()
const label = computed(() => formatElapsed(now.value - props.since))
</script>

<template>
  <span class="session-time">{{ label }}</span>
</template>
