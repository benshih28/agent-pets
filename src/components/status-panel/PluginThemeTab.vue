<script setup lang="ts">
import { t } from '@/i18n'
import PluginPanelThemes from '@/components/plugin-panel/PluginPanelThemes.vue'

// 主題插件的儀表板分頁主體：一個區塊容器，第一個區塊是主題清單（與設定 → 插件 → 詳情頁
// 共用同一個 PluginPanelThemes 元件，不重複邏輯），`#after-list` 插槽放「我的主題」與
// 主題編輯器的入口（由 PluginTabContent 填入）。
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
