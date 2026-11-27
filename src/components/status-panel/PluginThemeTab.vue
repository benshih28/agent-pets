<script setup lang="ts">
import { t } from '@/i18n'
import PluginPanelThemes from '@/components/plugin-panel/PluginPanelThemes.vue'

defineProps<{ pluginId: string }>()
</script>

<template>
  <div class="plugin-theme-tab" data-testid="plugin-theme-tab">
    <section class="plugin-theme-tab-section" :aria-label="t('plugins.sectionPanelThemes')">
      <h2>{{ t('plugins.sectionPanelThemes') }}</h2>
      <!-- 分頁只出現在已啟用的插件上（visiblePluginTabPlugins），所以這裡一定是啟用狀態。 -->
      <PluginPanelThemes :plugin-id="pluginId" :plugin-enabled="true" />
    </section>
    <slot name="after-list" />
  </div>
</template>

<style scoped>
.plugin-theme-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.plugin-theme-tab-section {
  padding: var(--space-3);
}

.plugin-theme-tab-section h2 {
  margin: 0 0 var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}
</style>
