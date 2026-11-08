<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { locale, t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Card from '@/components/ui/Card.vue'
import Chip from '@/components/ui/Chip.vue'
import Icon from '@/components/ui/Icon.vue'
import ActionMenu from '@/components/ui/ActionMenu.vue'
import NumberField from '@/components/ui/NumberField.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import PluginDiagnostics from '@/components/plugin-panel/PluginDiagnostics.vue'
import PluginHostTable from '@/components/plugin-panel/PluginHostTable.vue'
import PluginSettingsForm from '@/components/plugin-panel/PluginSettingsForm.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginDetailSection } from '@/composables/usePluginPanelController'

const {
  liveBadges, eventSourceStatuses, diagnostics, pluginBusy, enabledGlobally, detailPlugin: plugin, detailSection, petOptions, invokingCommandId,
  pluginName, pluginIconUrl, hidePluginIcon, displayFingerprint, pluginStatusLabel, pluginStatusTone,
  pendingLeave, confirmDiscardSettings, closePluginDetail, openPluginPanelView, updatePluginPreference, requestRemove, requestReport,
  commandTitle, invokePluginCommand,
} = usePluginController()

const root = ref<HTMLElement | null>(null)
const trayCount = computed(() => plugin.value?.manifest?.contributes.tray?.commands.length ?? 0)
const trayOverflow = computed(() => diagnostics.value.some(entry => entry.code === 'too_many_enabled' && entry.method === 'plugin.tray'))
const badge = computed(() => liveBadges.value.find(item => item.pluginId === plugin.value?.id))
const skinCount = computed(() => plugin.value?.manifest?.contributes.skins?.length ?? 0)
const eventSource = computed(() => {
  const names = plugin.value?.manifest?.name
  return names ? eventSourceStatuses.value.find(item => item.pluginName['zh-TW'] === names['zh-TW'] && item.pluginName['en-US'] === names['en-US']) : undefined
})
const hasPresence = computed(() => trayCount.value > 0 || Boolean(plugin.value?.manifest?.contributes.badge) || skinCount.value > 0 || Boolean(plugin.value?.manifest?.contributes.eventSource))
const name = computed(() => (plugin.value ? pluginName(plugin.value) : ''))
const tone = computed(() => (plugin.value ? pluginStatusTone(plugin.value) : 'neutral'))
const commands = computed(() => plugin.value?.manifest?.contributes.commands ?? [])
const hasSettings = computed(() => Boolean(plugin.value?.manifest?.contributes.settings))
const hasPanel = computed(() => Boolean(plugin.value?.manifest?.contributes.panelView))
const sections = computed(() => [
  { id: 'overview', label: t('plugins.sectionOverview') },
  ...(hasSettings.value ? [{ id: 'settings', label: t('plugins.sectionSettings') }] : []),
  ...(commands.value.length ? [{ id: 'commands', label: t('plugins.sectionCommands') }] : []),
  { id: 'diagnostics', label: t('plugins.sectionDiagnostics') },
])
const section = computed({
  get: () => detailSection.value,
  set: (value: string) => { detailSection.value = value as PluginDetailSection },
})
const commandsDisabledReason = computed(() => {
  if (!enabledGlobally.value) return t('plugins.reasonGlobalOff')
  if (!plugin.value?.preference.enabled) return t('plugins.reasonPluginOff')
  return ''
})
const menuItems = computed(() => [
  { id: 'report', label: t('pluginReportIssue') },
  { id: 'remove', label: t('plugins.removeEllipsis'), danger: true },
])
const targetPet = computed({
  get: () => plugin.value?.preference.targetPetId ?? '',
  set: (value: string) => {
    if (plugin.value) void updatePluginPreference(plugin.value.id, { targetPetId: value || null })
  },
})

function onMenu(id: string): void {
  if (!plugin.value) return
  if (id === 'report') requestReport(plugin.value.id)
  else if (id === 'remove') requestRemove(plugin.value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !event.defaultPrevented) {
    event.preventDefault()
    closePluginDetail()
  }
}

// Move focus to the heading when a detail page opens so keyboard and screen
// reader users land on the new content instead of the card they came from.
watch(plugin, async (value, previous) => {
  if (value && !previous) {
    await nextTick()
    root.value?.querySelector<HTMLElement>('[data-detail-heading]')?.focus()
  }
}, { flush: 'post' })
</script>

<template>
  <section v-if="plugin" ref="root" class="detail" :aria-label="name" @keydown="onKeydown">
    <nav class="detail-nav" :aria-label="t('plugins.breadcrumb')">
      <Button variant="ghost" size="sm" @click="closePluginDetail">
        <Icon name="back" :size="14" />
        {{ t('plugins') }}
      </Button>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <span class="crumb-current" :title="name">{{ name }}</span>
      <span class="nav-spacer" />
      <ActionMenu :items="menuItems" :aria-label="t('plugins.moreNamed', { name })" icon-only variant="ghost" :disabled="pluginBusy(plugin.id)" @select="onMenu">
        <Icon name="more" :size="18" />
      </ActionMenu>
    </nav>

    <Card class="detail-identity">
      <div class="identity-row">
        <img v-if="pluginIconUrl(plugin)" class="identity-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" @error="hidePluginIcon(plugin.id)" />
        <span v-else class="identity-icon" aria-hidden="true"><Icon name="plugin" :size="22" /></span>
        <div class="identity-copy">
          <h3 class="identity-name" tabindex="-1" data-detail-heading>{{ name }}</h3>
          <span class="identity-meta">
            {{ t('pluginVersion', { version: plugin.currentVersion }) }}
            <template v-if="plugin.manifest?.author"> · {{ t('pluginCatalogAuthor', { author: plugin.manifest.author }) }}</template>
          </span>
        </div>
        <Chip :tone="tone === 'success' ? 'success' : tone === 'warn' ? 'warn' : 'neutral'" :icon="tone === 'success' ? 'check' : tone === 'warn' ? 'warning' : undefined">
          {{ pluginStatusLabel(plugin) }}
        </Chip>
      </div>
      <div class="identity-trust">
        <Chip v-if="plugin.development" tone="warn" icon="warning">{{ t('pluginSignatureDeveloperUnverified') }}</Chip>
        <Chip v-else-if="plugin.signatureStatus === 'unverified'" tone="warn" icon="warning">{{ t('plugins.sigUnverified') }}</Chip>
        <Chip v-else-if="plugin.signatureStatus === 'valid'" tone="success" icon="shield">{{ t('pluginSignatureVerified') }}</Chip>
        <Chip v-else tone="neutral" icon="info">{{ t('pluginSignatureUnsigned') }}</Chip>
        <span v-if="!plugin.development && plugin.signatureFingerprint" class="identity-fingerprint">
          {{ t('pluginSignatureFingerprint', { fingerprint: displayFingerprint(plugin.signatureFingerprint) }) }}
        </span>
      </div>
      <ToggleRow
        :model-value="plugin.preference.enabled"
        :label="t('pluginEnabled')"
        :aria-label="t('plugins.enableNamed', { name })"
        :disabled="pluginBusy(plugin.id) || !plugin.manifest || plugin.status === 'incompatible'"
        @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
      />
      <div v-if="hasPanel" class="identity-actions">
        <Button
          variant="primary"
          size="sm"
          :disabled="pluginBusy(plugin.id) || !plugin.preference.enabled || !enabledGlobally"
          @click="openPluginPanelView(plugin.id)"
        >
          {{ t('pluginOpenPanel') }}
        </Button>
      </div>
    </Card>

    <SegmentedTabs v-model="section" :tabs="sections" :aria-label="t('plugins.detailSections')" id-prefix="plugin-detail" />

    <div :id="`plugin-detail-panel-${section}`" role="tabpanel" :aria-labelledby="`plugin-detail-tab-${section}`" class="detail-body">
      <template v-if="section === 'overview'">
        <Card :title="t('plugins.notifyHeading', { name })">
          <ToggleRow
            :model-value="plugin.preference.muted"
            :label="t('pluginMuted')"
            :aria-label="t('plugins.muteNamed', { name })"
            :disabled="pluginBusy(plugin.id) || !plugin.manifest"
            @update:model-value="updatePluginPreference(plugin.id, { muted: $event })"
          />
          <NumberField
            :model-value="plugin.preference.rateLimitPer10Min"
            :label="t('pluginPerPluginRateLabel')"
            :help="t('pluginPerPluginRateHelp')"
            :range-text="t('pluginPerPluginRateRange')"
            :min="1"
            :max="30"
            :disabled="pluginBusy(plugin.id) || !plugin.manifest"
            @commit="updatePluginPreference(plugin.id, { rateLimitPer10Min: $event })"
          />
          <div class="pet-target">
            <span class="pet-target-label">{{ t('plugins.targetPetLabel') }}</span>
            <Select v-model="targetPet" size="sm" :aria-label="t('plugins.targetPetLabel')" :disabled="pluginBusy(plugin.id) || !plugin.manifest">
              <option value="">{{ t('pluginPrimaryPet') }}</option>
              <option v-for="pet in petOptions" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
            </Select>
            <small class="pet-target-help">{{ t('plugins.targetPetHelp') }}</small>
          </div>
        </Card>
        <Card v-if="hasPresence" :title="t('plugins.presenceHeading')">
          <ul class="presence">
            <li v-if="trayCount">{{ t('plugins.presenceTray', { count: trayCount }) }}<template v-if="trayOverflow"> · {{ t('plugins.presenceTrayOverflow') }}</template></li>
            <li v-if="plugin.manifest?.contributes.badge">{{ badge ? t('plugins.presenceBadge', { text: badge.text }) : t('plugins.presenceBadgeNone') }}</li>
            <li v-if="skinCount">{{ t('plugins.presenceSkins', { count: skinCount }) }}</li>
            <li v-if="plugin.manifest?.contributes.eventSource">{{ eventSource ? t('plugins.presenceEventSource', { name: eventSource.displayName[locale] }) : t('plugins.presenceEventSourceNone') }}</li>
          </ul>
        </Card>
        <Card :title="t('pluginManifestHostsHeading')">
          <PluginHostTable :plugin="plugin" />
        </Card>
      </template>

      <Card v-else-if="section === 'settings'" :title="t('plugins.settingsNamed', { name })">
        <PluginSettingsForm />
      </Card>

      <Card v-else-if="section === 'commands'" :title="t('pluginCommandsHeading')">
        <p class="help">{{ commandsDisabledReason || t('pluginCommandsHelp') }}</p>
        <div class="command-list">
          <Button
            v-for="command in commands"
            :key="command.id"
            variant="secondary"
            size="sm"
            :disabled="Boolean(invokingCommandId) || Boolean(commandsDisabledReason)"
            @click="invokePluginCommand(command.id)"
          >
            {{ invokingCommandId === command.id ? t('plugins.commandRunning') : commandTitle(command) }}
          </Button>
        </div>
      </Card>

      <Card v-else :title="t('pluginDiagnosticsHeading')">
        <PluginDiagnostics />
      </Card>
    </div>
    <ConfirmDialog
      :open="pendingLeave !== null"
      :title="t('plugins.discardTitle')"
      :message="t('plugins.discardHelp')"
      :confirm-label="t('plugins.discardConfirm')"
      :cancel-label="t('plugins.keepEditing')"
      tone="danger"
      @confirm="confirmDiscardSettings"
      @cancel="pendingLeave = null"
    />
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.detail-nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.crumb-sep {
  color: var(--text-muted);
}

.crumb-current {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-spacer {
  flex: 1 1 auto;
}

.identity-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.identity-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  object-fit: contain;
}

.identity-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.identity-name {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-name:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.identity-meta,
.identity-fingerprint,
.help,
.pet-target-help {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.identity-trust {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.help {
  margin: 0;
  line-height: var(--leading-relaxed);
}

.command-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.presence {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-4);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
}

.pet-target {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.pet-target-label {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}
</style>
