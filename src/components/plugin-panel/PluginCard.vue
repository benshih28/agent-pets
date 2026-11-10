<script setup lang="ts">
import { computed } from 'vue'
import { locale, t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ActionMenu from '@/components/ui/ActionMenu.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { pluginCapabilities } from '@/utils/plugin-capabilities'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginPanelPlugin } from '@/types/plugin'
import { panelThemeState } from '@/composables/usePanelTheme'

const props = defineProps<{ plugin: PluginPanelPlugin }>()

const {
  pluginBusy, enabledGlobally, pluginName, pluginIconUrl, hidePluginIcon, pluginStatusLabel, pluginStatusTone,
  catalogItemFor, catalogCheckComplete, installCatalogPlugin, openPluginDetail, openPluginPanelView, updatePluginPreference, requestRemove, requestReport,
} = usePluginController()

const name = computed(() => pluginName(props.plugin))
const tone = computed(() => pluginStatusTone(props.plugin))
const hasSettings = computed(() => Boolean(props.plugin.manifest?.contributes.settings))
const catalogItem = computed(() => catalogItemFor(props.plugin.id))
const localOnly = computed(() => catalogCheckComplete.value && !catalogItem.value)
const capabilities = computed(() => pluginCapabilities(props.plugin.manifest))
const panelThemeActive = computed(() => (['light', 'dark'] as const)
  .some(mode => panelThemeState.value?.slots[mode].status === 'active' && panelThemeState.value.slots[mode].ref?.pluginId === props.plugin.id))
const hasPanel = computed(() => Boolean(props.plugin.manifest?.contributes.panelView))
const needsAttention = computed(() => tone.value === 'warn')
const menuItems = computed(() => [
  { id: 'detail', label: t('plugins.menuDetails') },
  { id: 'report', label: t('pluginReportIssue') },
  { id: 'remove', label: t('remove'), danger: true },
])

function onMenu(id: string): void {
  if (id === 'detail') openPluginDetail(props.plugin.id)
  else if (id === 'report') requestReport(props.plugin.id)
  else if (id === 'remove') requestRemove(props.plugin)
}
</script>

<template>
  <li class="plugin-card" :class="{ attention: needsAttention }" :aria-label="name" :aria-busy="pluginBusy(plugin.id)">
    <div class="card-head">
      <img v-if="pluginIconUrl(plugin)" class="card-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" @error="hidePluginIcon(plugin.id)" />
      <span v-else class="card-icon card-icon-placeholder" aria-hidden="true"><Icon name="plugin" :size="18" /></span>
      <div class="card-copy">
        <strong class="card-name" :title="name">{{ name }}</strong>
        <span class="card-meta">
          {{ t('pluginVersion', { version: plugin.currentVersion }) }}
          <template v-if="plugin.manifest?.author"> · {{ plugin.manifest.author }}</template>
        </span>
      </div>
      <Spinner v-if="pluginBusy(plugin.id)" />
      <Chip :tone="tone === 'success' ? 'success' : tone === 'warn' ? 'warn' : 'neutral'" :icon="tone === 'success' ? 'check' : tone === 'warn' ? 'warning' : undefined">
        {{ pluginStatusLabel(plugin) }}
      </Chip>
    </div>
    <ul v-if="capabilities.length" class="card-capabilities" :aria-label="t('plugins.provides')">
      <li v-for="capability in capabilities" :key="capability"><Chip>{{ capability === 'panelThemes' ? t('plugins.cap.panelThemesCount', { count: plugin.manifest?.contributes.panelThemes?.length ?? 0 }) : t(`plugins.cap.${capability}`) }}</Chip></li>
      <li v-if="panelThemeActive"><Chip tone="success" icon="check">{{ t('plugins.cap.panelThemesActive') }}</Chip></li>
    </ul>
    <p v-if="catalogItem" class="card-description">{{ catalogItem.plugin.description[locale] }}</p>
    <div v-if="localOnly || catalogItem?.updateAvailable" class="card-update">
      <Chip v-if="localOnly" tone="neutral" icon="info">{{ t('plugins.localInstall') }}</Chip>
      <template v-if="catalogItem?.updateAvailable">
        <Chip tone="info" icon="arrow-up">{{ t('plugins.updateTo', { version: catalogItem.latestVersion.version }) }}</Chip>
        <Button variant="secondary" size="sm" :disabled="pluginBusy(plugin.id)" :aria-label="t('plugins.updateNamed', { name })" @click="installCatalogPlugin(catalogItem)">
          {{ t('pluginCatalogUpdate') }}
        </Button>
      </template>
    </div>
    <div class="card-actions">
      <Button
        v-if="hasPanel"
        variant="primary"
        size="sm"
        :disabled="pluginBusy(plugin.id) || !plugin.preference.enabled || !enabledGlobally"
        :aria-label="t('plugins.openPanelNamed', { name })"
        @click="openPluginPanelView(plugin.id)"
      >
        {{ t('pluginOpenPanel') }}
      </Button>
      <Button
        v-if="hasSettings"
        variant="secondary"
        size="sm"
        :aria-label="t('plugins.settingsNamed', { name })"
        @click="openPluginDetail(plugin.id, 'settings')"
      >
        {{ t('plugins.settings') }}
      </Button>
      <Button variant="ghost" size="sm" :aria-label="t('plugins.detailsNamed', { name })" @click="openPluginDetail(plugin.id)">
        {{ t('plugins.details') }}
        <Icon name="chevron-right" :size="14" />
      </Button>
      <span class="card-spacer" />
      <ToggleRow
        class="card-toggle"
        :model-value="plugin.preference.enabled"
        :label="t('pluginEnabled')"
        :aria-label="t('plugins.enableNamed', { name })"
        :disabled="!plugin.manifest || plugin.status === 'incompatible'"
        @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
      />
      <ActionMenu
        :items="menuItems"
        :aria-label="t('plugins.moreNamed', { name })"
        icon-only
        variant="ghost"
        :disabled="pluginBusy(plugin.id)"
        @select="onMenu"
      >
        <Icon name="more" :size="18" />
      </ActionMenu>
    </div>
  </li>
</template>

<style scoped>
.plugin-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
  list-style: none;
}

.plugin-card.attention {
  box-shadow: inset 0 0 0 1px var(--state-warn);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.card-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  object-fit: contain;
}

.card-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-0-5);
}

.card-name {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.card-description {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.card-update {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.card-spacer {
  flex: 1 1 auto;
}

.card-toggle {
  flex: 0 0 auto;
  gap: var(--space-2);
}

.card-toggle :deep(.label) {
  font-size: var(--font-sm);
}

@media (forced-colors: active) {
  .plugin-card {
    border: 1px solid CanvasText;
    box-shadow: none;
  }
}
</style>
