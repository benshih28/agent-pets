<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PluginCard from '@/components/plugin-panel/PluginCard.vue'
import { usePluginController } from '@/composables/plugin/context'

const emit = defineEmits<{ explore: [] }>()
const { plugins, filteredPlugins, installedSearch, installedFilter, loading, busy, selectArchive } = usePluginController()
</script>

<template>
  <section class="plugin-section" :aria-label="t('pluginInstalledHeading')">
    <p class="plugin-limit-help">{{ t('pluginInstalledHelp') }}</p>
    <div v-if="loading && plugins.length === 0" class="plugin-empty">{{ t('checking') }}</div>
    <EmptyState
      v-else-if="plugins.length === 0"
      icon="plugin"
      :title="t('plugins.emptyTitle')"
      :description="t('plugins.emptyDescription')"
    >
      <Button variant="primary" size="sm" @click="emit('explore')">{{ t('plugins.browseCatalog') }}</Button>
      <Button variant="secondary" size="sm" :disabled="busy" @click="selectArchive">{{ t('plugins.installFromFile') }}</Button>
    </EmptyState>
    <template v-else>
      <div v-if="plugins.length > 3" class="plugin-filters">
        <Input v-model="installedSearch" type="search" size="sm" :aria-label="t('plugins.searchInstalled')" :placeholder="t('plugins.searchInstalled')" />
        <Select v-model="installedFilter" size="sm" :aria-label="t('plugins.filterLabel')">
          <option value="all">{{ t('plugins.filterAll') }}</option>
          <option value="enabled">{{ t('plugins.filterEnabled') }}</option>
          <option value="updates">{{ t('plugins.filterUpdates') }}</option>
          <option value="issues">{{ t('plugins.filterIssues') }}</option>
        </Select>
      </div>
      <p v-if="filteredPlugins.length === 0" class="plugin-empty">{{ t('plugins.noMatches') }}</p>
      <ul v-else class="plugin-list" :aria-label="t('pluginInstalledHeading')">
        <PluginCard v-for="plugin in filteredPlugins" :key="plugin.id" :plugin="plugin" />
      </ul>
    </template>
  </section>
</template>

<style scoped>
.plugin-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plugin-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.plugin-filters > :first-child {
  min-width: 160px;
  flex: 1 1 200px;
}

.plugin-limit-help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.plugin-empty {
  padding: var(--space-3);
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
}
</style>
