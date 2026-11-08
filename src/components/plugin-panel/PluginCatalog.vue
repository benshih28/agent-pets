<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { locale, t } from '@/i18n'
import { DEFAULT_PLUGIN_CATALOG_URL } from '@/types/plugin-catalog'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginCatalogPanelItem } from '@/types/plugin-catalog'
import { formatNumber, formatTime } from '@/utils/intl-format'

const props = defineProps<{ active: boolean }>()

const {
  snapshot, busy, isBusy, loading, catalogItems, catalogLoadedAt, catalogError, catalogSearch, catalogUrlDraft,
  onlineCatalogEnabled, dailyUpdateCheck, filteredCatalogItems, displayFingerprint, localizedError,
  saveCatalogUrl, restoreCatalogUrl, loadPluginCatalog, ensureCatalogLoaded, updateAllCatalogPlugins,
  installCatalogPlugin, updateGlobalPreferences,
} = usePluginController()

const catalogLoading = computed(() => isBusy('catalog'))
const updatable = computed(() => catalogItems.value.filter(item => item.updateAvailable))
const urlChanged = computed(() => catalogUrlDraft.value !== (snapshot.value?.preferences.catalogUrl ?? ''))
const isDefaultUrl = computed(() => snapshot.value?.preferences.catalogUrl === DEFAULT_PLUGIN_CATALOG_URL)
const lastChecked = computed(() => catalogLoadedAt.value === null
  ? ''
  : formatTime(catalogLoadedAt.value, locale.value))
const expanded = ref<Record<string, boolean>>({})

// 進入探索分頁（或啟用目錄）時自動載入一次。
watch(() => [props.active, onlineCatalogEnabled.value] as const, ([active, enabled]) => {
  if (active && enabled) void ensureCatalogLoaded()
}, { immediate: true })

function actionLabel(item: PluginCatalogPanelItem): string {
  if (!item.installedVersion) return t('pluginCatalogInstall')
  return item.updateAvailable ? t('pluginCatalogUpdate') : t('pluginCatalogUpToDate')
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${formatNumber(bytes / 1024 / 1024, locale.value, { maximumFractionDigits: 1 })} MB`
    : `${formatNumber(Math.max(1, bytes / 1024), locale.value, { maximumFractionDigits: 0 })} KB`
}
</script>

<template>
  <EmptyState
    v-if="!onlineCatalogEnabled"
    icon="plugin"
    :title="t('plugins.catalogOffTitle')"
    :description="t('plugins.catalogOffDescription')"
  >
    <Button variant="primary" size="sm" :disabled="busy || loading" @click="updateGlobalPreferences({ onlineCatalogEnabled: true })">
      {{ t('plugins.catalogEnable') }}
    </Button>
  </EmptyState>

  <section v-else class="catalog" :aria-label="t('pluginCatalogHeading')" :aria-busy="catalogLoading">
    <div class="catalog-bar">
      <p class="catalog-status">
        <template v-if="catalogLoading">{{ t('checking') }}</template>
        <template v-else-if="lastChecked">{{ t('plugins.catalogLastChecked', { time: lastChecked }) }}</template>
      </p>
      <div class="catalog-bar-actions">
        <Button v-if="updatable.length > 1" variant="primary" size="sm" :disabled="busy" @click="updateAllCatalogPlugins">
          {{ t('plugins.updateAll', { count: updatable.length }) }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="catalogLoading || !snapshot?.preferences.catalogUrl" @click="loadPluginCatalog()">
          <Icon name="refresh" :size="14" />
          {{ t('pluginCatalogLoad') }}
        </Button>
      </div>
    </div>

    <div v-if="catalogError" class="catalog-error" role="alert">
      <Icon name="warning" :size="16" />
      <span>{{ localizedError(catalogError) }}</span>
      <Button variant="secondary" size="sm" :disabled="catalogLoading" @click="loadPluginCatalog()">{{ t('plugins.retry') }}</Button>
    </div>

    <Input
      v-if="catalogItems.length"
      v-model="catalogSearch"
      type="search"
      size="sm"
      :aria-label="t('pluginCatalogSearchLabel')"
      :placeholder="t('pluginCatalogSearchPlaceholder')"
    />

    <div v-if="catalogLoading && catalogItems.length === 0" class="catalog-skeleton" role="status" aria-busy="true" :aria-label="t('panel.loading')">
      <Skeleton v-for="n in 3" :key="n" variant="block" height="88px" />
    </div>
    <EmptyState v-else-if="catalogItems.length === 0 && !catalogError" compact :title="t('plugins.catalogEmpty')" />
    <p v-else-if="catalogItems.length && filteredCatalogItems.length === 0" class="catalog-empty">{{ t('pluginCatalogNoMatches') }}</p>
    <ul v-else class="catalog-list" :aria-label="t('pluginCatalogHeading')">
      <li v-for="item in filteredCatalogItems" :key="item.plugin.id" class="catalog-card">
        <div class="card-head">
          <span class="card-icon" aria-hidden="true"><Icon name="plugin" :size="18" /></span>
          <div class="card-copy">
            <strong class="card-name" :title="item.plugin.name[locale]">{{ item.plugin.name[locale] }}</strong>
            <span class="card-meta">{{ t('pluginVersion', { version: item.latestVersion.version }) }} · {{ sizeLabel(item.latestVersion.size) }}</span>
          </div>
          <Button
            :variant="item.updateAvailable || !item.installedVersion ? 'primary' : 'secondary'"
            size="sm"
            :disabled="busy || (item.installedVersion !== null && !item.updateAvailable)"
            :aria-label="`${actionLabel(item)} ${item.plugin.name[locale]}`"
            @click="installCatalogPlugin(item)"
          >
            {{ actionLabel(item) }}
          </Button>
        </div>
        <p class="card-description">{{ item.plugin.description[locale] }}</p>
        <div class="card-chips">
          <Chip v-if="item.installedVersion" tone="success" icon="check">{{ t('pluginCatalogInstalledVersion', { version: item.installedVersion }) }}</Chip>
          <Chip v-if="item.updateAvailable" tone="info" icon="arrow-up">{{ t('plugins.updateTo', { version: item.latestVersion.version }) }}</Chip>
          <Chip v-if="item.updateAvailable && item.signingKeyChange === 'changed'" tone="danger" icon="warning">{{ t('pluginCatalogSigningKeyChanged') }}</Chip>
          <Chip v-if="item.catalogOlder" tone="warn" icon="warning">{{ t('pluginCatalogOlderThanInstalled') }}</Chip>
          <Chip v-if="item.plugin.publicKeyFingerprint" tone="neutral" icon="shield">{{ t('plugins.signaturePinned') }}</Chip>
        </div>
        <p v-if="item.updateAvailable" class="card-note">
          {{ item.signingKeyChange === 'unchanged' ? t('pluginCatalogSigningKeyUnchanged') : t('pluginCatalogPermissionsCheckOnUpdate') }}
        </p>
        <Button
          variant="ghost"
          size="sm"
          class="card-more"
          :aria-expanded="Boolean(expanded[item.plugin.id])"
          @click="expanded[item.plugin.id] = !expanded[item.plugin.id]"
        >
          {{ expanded[item.plugin.id] ? t('plugins.lessDetails') : t('plugins.moreDetails') }}
        </Button>
        <dl v-if="expanded[item.plugin.id]" class="card-details">
          <dt>ID</dt><dd><code>{{ item.plugin.id }}</code></dd>
          <dt>{{ t('plugins.detailAuthor') }}</dt><dd>{{ item.plugin.author }}</dd>
          <dt>{{ t('plugins.detailFingerprint') }}</dt>
          <dd>{{ item.plugin.publicKeyFingerprint ? displayFingerprint(item.plugin.publicKeyFingerprint) : t('pluginCatalogSignatureUnpinned') }}</dd>
        </dl>
      </li>
    </ul>

    <details class="catalog-settings">
      <summary>{{ t('plugins.catalogSettings') }}</summary>
      <div class="catalog-settings-body">
        <Input
          v-model="catalogUrlDraft"
          type="url"
          :label="t('pluginCatalogUrlLabel')"
          :help="t('pluginCatalogUrlHelp')"
          maxlength="2048"
          autocomplete="url"
          :disabled="busy || loading"
        />
        <div class="catalog-settings-actions">
          <Button variant="primary" size="sm" :disabled="busy || loading || !urlChanged" @click="saveCatalogUrl">{{ t('plugins.applyUrl') }}</Button>
          <Button variant="ghost" size="sm" :disabled="busy || loading || isDefaultUrl" @click="restoreCatalogUrl">{{ t('pluginCatalogRestoreDefault') }}</Button>
        </div>
        <ToggleRow
          :model-value="dailyUpdateCheck"
          :label="t('pluginCatalogDailyCheck')"
          :help="t('pluginCatalogDailyCheckHelp')"
          :disabled="busy || loading || !snapshot?.preferences.catalogUrl"
          @update:model-value="updateGlobalPreferences({ dailyUpdateCheck: $event })"
        />
        <ToggleRow
          :model-value="onlineCatalogEnabled"
          :label="t('pluginCatalogEnabled')"
          :help="t('pluginCatalogEnabledHelp')"
          :disabled="busy || loading"
          @update:model-value="updateGlobalPreferences({ onlineCatalogEnabled: $event })"
        />
      </div>
    </details>
  </section>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.catalog-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.catalog-bar-actions {
  display: flex;
  gap: var(--space-2);
}

.catalog-status,
.catalog-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.catalog-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--state-error);
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.catalog-error span {
  flex: 1 1 auto;
  min-width: 0;
}

.catalog-skeleton,
.catalog-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.catalog-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
}

.card-head {
  display: flex;
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
}

.card-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.card-name {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta,
.card-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
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

.card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.card-more {
  align-self: flex-start;
}

.catalog-settings summary:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.card-details {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.card-details dt {
  color: var(--text-muted);
}

.card-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.catalog-settings summary {
  color: var(--text-secondary);
  font-size: var(--font-sm);
  cursor: pointer;
}

.catalog-settings-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-3);
}

.catalog-settings-actions {
  display: flex;
  gap: var(--space-2);
}

@media (forced-colors: active) {
  .catalog-card {
    border: 1px solid CanvasText;
    box-shadow: none;
  }
}
</style>
