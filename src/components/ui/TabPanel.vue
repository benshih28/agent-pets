<script setup lang="ts">
import { panelDomId, tabDomId } from '@/utils/tab-navigation'

defineProps<{
  idPrefix: string
  id: string
  active: boolean
}>()
</script>

<template>
  <div
    :id="panelDomId(idPrefix, id)"
    class="tab-panel"
    role="tabpanel"
    :aria-labelledby="tabDomId(idPrefix, id)"
    :hidden="!active"
  >
    <slot />
  </div>
</template>

<style scoped>
/* `hidden` must win over a consumer's `display: flex` of equal specificity. */
.tab-panel[hidden] {
  display: none !important;
}
</style>
