<script setup lang="ts">
import { locale, t } from '@/i18n'
import { DEFAULT_PLUGIN_CATALOG_URL, shouldShowCatalogPermissionCheck } from '@/types/plugin-catalog'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import PluginPanelDialogs from '@/components/plugin-panel/PluginPanelDialogs.vue'
import { usePluginPanelController } from '@/composables/usePluginPanelController'

const props = defineProps<{ requestedPluginId?: string }>()
const {
  snapshot, notifications, logs, diagnostics, petOptions, pluginSettings, settingsDraft, secretDrafts,
  selectedPluginId, panelViewPluginId, panelViewOpenToken, panelViewFrame, panelViewContent,
  busy, invokingCommandId, loading, errorMessage, statusMessage, pendingPlan, pendingRemove,
  pendingSecretConsentKey, catalogItems, catalogCheckComplete, catalogSearch, catalogUrlDraft, keepData,
  plugins, selectedPlugin, panelViewPlugin, enabledGlobally, onlineCatalogEnabled, dailyUpdateCheck,
  filteredCatalogItems, pendingPluginName, resourceFields, failedPluginIconIds, pendingPermissions,
  pendingAddedPermissions, pluginName, pluginIconUrl, hidePluginIcon, restoreCatalogUrl,
  displayFingerprint, readPluginPanelViewBounds, sendPluginPanelViewBounds, openPluginPanelView,
  closePluginPanelView, handlePluginPanelViewClosed, pluginStatusLabel, pluginStatusTone, localizedError,
  setError, refreshNotifications, refreshPanel, loadPetOptions, refreshDiagnostics, refreshPluginSettings,
  commandTitle, invokePluginCommand, settingTitle, settingValue, updateSetting, savePluginSettings,
  savePluginSecret, confirmSecretConsent, updateGlobalPreferences, saveCatalogUrl, loadPluginCatalog,
  installCatalogPlugin, reportPluginIssue, updateResourceLimit, resourceInputValue, resourceBoundText,
  updatePluginPreference, updatePluginRate, updatePluginTarget, revokeGrantedHost, selectArchive,
  selectDeveloperFolder, planKindLabel, permissionLabel, confirmInstall, requestRemove, confirmRemove,
  markNotificationRead, openNotificationLink, clearNotifications, notificationSource, notificationTime,
  diagnosticTime, diagnosticCodeLabel,
} = usePluginPanelController(props)
</script>

<template>
  <section
    v-if="panelViewPlugin"
    ref="panelViewFrame"
    class="plugin-panel-view-frame"
    data-testid="plugin-panel-view-frame"
  >
    <header class="plugin-panel-view-chrome">
      <img v-if="pluginIconUrl(panelViewPlugin)" :src="pluginIconUrl(panelViewPlugin) ?? ''" alt="" @error="hidePluginIcon(panelViewPlugin.id)" />
      <span v-else class="plugin-panel-view-icon" aria-hidden="true">◇</span>
      <div class="plugin-panel-view-title">
        <strong>{{ pluginName(panelViewPlugin) }}</strong>
        <span>{{ t('pluginPanelContent') }}</span>
      </div>
      <button class="plugin-panel-view-close" type="button" :aria-label="t('pluginPanelClose')" @click="closePluginPanelView">×</button>
    </header>
    <div ref="panelViewContent" class="plugin-panel-view-content" data-testid="plugin-panel-view-content" />
  </section>

  <div v-else class="plugin-panel">
    <div class="plugin-toolbar">
      <ToggleRow
        :model-value="enabledGlobally"
        :label="t('pluginGlobalEnabled')"
        :help="t('pluginGlobalEnabledHelp')"
        :disabled="busy"
        @update:model-value="updateGlobalPreferences({ pluginsEnabled: $event })"
      />
      <div class="plugin-toolbar-actions">
        <Button variant="secondary" size="sm" :disabled="loading || busy" @click="refreshPanel">
          {{ loading ? t('checking') : t('refresh') }}
        </Button>
        <Button variant="primary" size="sm" :disabled="busy" @click="selectArchive">
          {{ t('pluginInstallButton') }}
        </Button>
        <Button v-if="snapshot?.preferences.developerMode" variant="secondary" size="sm" :disabled="busy" @click="selectDeveloperFolder">
          {{ t('pluginDeveloperLoadFolder') }}
        </Button>
      </div>
    </div>

    <Card :title="t('pluginAdvancedSettings')" class="plugin-section">
      <p class="plugin-limit-help">{{ t('pluginAdvancedSettingsHelp') }}</p>
      <ToggleRow
        :model-value="snapshot?.preferences.developerMode ?? false"
        :label="t('pluginDeveloperMode')"
        :help="t('pluginDeveloperModeHelp')"
        :disabled="busy || loading"
        @update:model-value="updateGlobalPreferences({ developerMode: $event })"
      />
      <div class="plugin-resource-grid">
        <label v-for="field in resourceFields" :key="field.key" class="plugin-resource-field">
          <span>{{ t(field.label) }}</span>
          <input
            type="number"
            :value="resourceInputValue(field.key, snapshot?.preferences.resources[field.key] ?? field.defaultValue)"
            :min="resourceInputValue(field.key, field.min)"
            :max="resourceInputValue(field.key, field.max)"
            step="1"
            :disabled="busy || loading"
            @change="updateResourceLimit(field.key, ($event.target as HTMLInputElement).value)"
          />
          <small>{{ t('pluginResourceRange', {
            default: resourceBoundText(field.key, field.defaultValue),
            min: resourceBoundText(field.key, field.min),
            max: resourceBoundText(field.key, field.max),
          }) }}</small>
        </label>
      </div>
    </Card>

    <Card :title="t('pluginCatalogHeading')" class="plugin-section">
      <ToggleRow
        :model-value="onlineCatalogEnabled"
        :label="t('pluginCatalogEnabled')"
        :help="t('pluginCatalogEnabledHelp')"
        :disabled="busy || loading"
        @update:model-value="updateGlobalPreferences({ onlineCatalogEnabled: $event })"
      />
      <template v-if="onlineCatalogEnabled">
        <div class="plugin-catalog-controls">
          <label class="plugin-preference-field">
            <span>{{ t('pluginCatalogUrlLabel') }}</span>
            <input v-model="catalogUrlDraft" type="url" maxlength="2048" autocomplete="url" :disabled="busy || loading" />
            <small>{{ t('pluginCatalogUrlHelp') }}</small>
          </label>
          <div class="plugin-toolbar-actions">
            <Button variant="secondary" size="sm" :disabled="busy || loading" @click="saveCatalogUrl">
              {{ t('pluginCatalogSaveUrl') }}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              :disabled="busy || loading || snapshot?.preferences.catalogUrl === DEFAULT_PLUGIN_CATALOG_URL"
              @click="restoreCatalogUrl"
            >
              {{ t('pluginCatalogRestoreDefault') }}
            </Button>
            <Button variant="primary" size="sm" :disabled="busy || loading || !snapshot?.preferences.catalogUrl" @click="loadPluginCatalog">
              {{ t('pluginCatalogLoad') }}
            </Button>
          </div>
        </div>
        <ToggleRow
          :model-value="dailyUpdateCheck"
          :label="t('pluginCatalogDailyCheck')"
          :help="t('pluginCatalogDailyCheckHelp')"
          :disabled="busy || loading || !snapshot?.preferences.catalogUrl"
          @update:model-value="updateGlobalPreferences({ dailyUpdateCheck: $event })"
        />
        <label v-if="catalogItems.length" class="plugin-preference-field">
          <span>{{ t('pluginCatalogSearchLabel') }}</span>
          <input v-model="catalogSearch" type="search" :placeholder="t('pluginCatalogSearchPlaceholder')" />
        </label>
        <div v-if="catalogItems.length === 0" class="plugin-empty">{{ t('pluginCatalogEmpty') }}</div>
        <div v-else-if="filteredCatalogItems.length === 0" class="plugin-empty">{{ t('pluginCatalogNoMatches') }}</div>
        <div v-else class="plugin-list" role="list" :aria-label="t('pluginCatalogHeading')">
          <Card v-for="item in filteredCatalogItems" :key="item.plugin.id" class="plugin-card" role="listitem">
            <div class="plugin-row">
              <div class="plugin-copy">
                <strong :title="item.plugin.name[locale]">{{ item.plugin.name[locale] }}</strong>
                <span>{{ item.plugin.id }} · {{ t('pluginCatalogAuthor', { author: item.plugin.author }) }}</span>
                <span>{{ item.plugin.description[locale] }}</span>
                <span>{{ t('pluginVersion', { version: item.latestVersion.version }) }}</span>
                <span v-if="item.plugin.publicKeyFingerprint" class="plugin-signature-fingerprint">
                  {{ t('pluginCatalogSignaturePinned', { fingerprint: displayFingerprint(item.plugin.publicKeyFingerprint) }) }}
                </span>
                <span v-else>{{ t('pluginCatalogSignatureUnpinned') }}</span>
                <span v-if="item.installedVersion">
                  {{ t('pluginCatalogInstalledVersion', { version: item.installedVersion }) }}
                </span>
                <span v-if="shouldShowCatalogPermissionCheck(item.permissionsIncreased, item.updateAvailable)">
                  {{ t('pluginCatalogPermissionsCheckOnUpdate') }}
                </span>
                <span v-if="item.updateAvailable && item.signingKeyChange === 'changed'" class="plugin-development-badge">
                  {{ t('pluginCatalogSigningKeyChanged') }}
                </span>
                <span v-else-if="item.updateAvailable && item.signingKeyChange === 'unchanged'">
                  {{ t('pluginCatalogSigningKeyUnchanged') }}
                </span>
                <span v-else-if="item.updateAvailable">
                  {{ t('pluginCatalogSigningKeyCheckOnUpdate') }}
                </span>
                <span v-if="item.catalogOlder" class="plugin-development-badge">
                  {{ t('pluginCatalogOlderThanInstalled') }}
                </span>
              </div>
              <Button variant="secondary" size="sm"
                :disabled="busy || (item.installedVersion !== null && !item.updateAvailable)"
                @click="installCatalogPlugin(item)">
                {{ t(!item.installedVersion ? 'pluginCatalogInstall' : item.updateAvailable ? 'pluginCatalogUpdate' : 'pluginCatalogUpToDate') }}
              </Button>
            </div>
          </Card>
        </div>
      </template>
    </Card>

    <div v-if="errorMessage" class="error-msg plugin-message" role="alert">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="plugin-message plugin-success" role="status" aria-live="polite">{{ statusMessage }}</div>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginInstalledHeading') }}</h3>
          <p>{{ t('pluginInstalledHelp') }}</p>
        </div>
        <span class="plugin-count" aria-live="polite">{{ plugins.length }}</span>
      </div>
      <div v-if="loading && plugins.length === 0" class="plugin-empty">{{ t('checking') }}</div>
      <div v-else-if="plugins.length === 0" class="plugin-empty">{{ t('pluginNoInstalled') }}</div>
      <div v-else class="plugin-list" role="list" :aria-label="t('pluginInstalledHeading')">
        <Card v-for="plugin in plugins" :key="plugin.id" class="plugin-card" role="listitem" :tone="pluginStatusTone(plugin)">
          <div class="plugin-row">
            <img v-if="pluginIconUrl(plugin)" class="plugin-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" @error="hidePluginIcon(plugin.id)" />
            <div v-else class="plugin-icon plugin-icon-placeholder" aria-hidden="true">◇</div>
            <div class="plugin-copy">
              <strong :title="pluginName(plugin)">{{ pluginName(plugin) }}</strong>
              <span>{{ plugin.id }} · {{ t('pluginVersion', { version: plugin.currentVersion }) }}</span>
              <span v-if="catalogCheckComplete && !catalogItems.some(item => item.plugin.id === plugin.id)" class="plugin-development-badge">
                {{ t('pluginCatalogNotOnline') }}
              </span>
              <span v-if="plugin.development || plugin.signatureStatus === 'unverified'" class="plugin-development-badge">{{ t('pluginSignatureDeveloperUnverified') }}</span>
              <span v-else class="plugin-signature-status">
                {{ t(plugin.signatureStatus === 'valid' ? 'pluginSignatureVerified' : 'pluginSignatureUnsigned') }}
              </span>
              <span v-if="!plugin.development && plugin.signatureFingerprint" class="plugin-signature-fingerprint">
                {{ t('pluginSignatureFingerprint', { fingerprint: displayFingerprint(plugin.signatureFingerprint) }) }}
              </span>
            </div>
            <span class="plugin-status" :class="`tone-${pluginStatusTone(plugin)}`">{{ pluginStatusLabel(plugin) }}</span>
          </div>
          <div class="plugin-controls">
            <ToggleRow
              :model-value="plugin.preference.enabled"
              :label="t('pluginEnabled')"
              :disabled="busy || !plugin.manifest || plugin.status === 'incompatible'"
              @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
            />
            <ToggleRow
              :model-value="plugin.preference.muted"
              :label="t('pluginMuted')"
              :disabled="busy || !plugin.manifest"
              @update:model-value="updatePluginPreference(plugin.id, { muted: $event })"
            />
            <label class="plugin-preference-field">
              <span>{{ t('pluginPerPluginRateLabel') }}</span>
              <input
                type="number"
                min="1"
                max="30"
                step="1"
                :value="String(plugin.preference.rateLimitPer10Min)"
                :disabled="busy || !plugin.manifest"
                @change="updatePluginRate(plugin.id, ($event.target as HTMLInputElement).value)"
              />
              <small>{{ t('pluginPerPluginRateHelp') }}</small>
            </label>
            <label class="plugin-preference-field">
              <span>{{ t('pluginTargetPetLabel') }}</span>
              <select
                :value="plugin.preference.targetPetId ?? ''"
                :disabled="busy || !plugin.manifest"
                @change="updatePluginTarget(plugin.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('pluginPrimaryPet') }}</option>
                <option v-for="pet in petOptions" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
              </select>
            </label>
            <Button variant="danger" size="sm" :disabled="busy" @click="requestRemove(plugin)">
              {{ t('remove') }}
            </Button>
            <Button variant="secondary" size="sm" :disabled="busy" @click="reportPluginIssue(plugin.id)">
              {{ t('pluginReportIssue') }}
            </Button>
            <Button
              v-if="plugin.manifest?.contributes.panelView"
              variant="secondary"
              size="sm"
              :disabled="busy || !plugin.preference.enabled || !enabledGlobally"
              @click="openPluginPanelView(plugin.id)"
            >
              {{ t('pluginOpenPanel') }}
            </Button>
          </div>
          <div class="plugin-granted-hosts">
            <strong>{{ t('pluginManifestHostsHeading') }}</strong>
            <p v-if="(plugin.manifest?.permissions.network?.hosts ?? []).length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
            <ul v-else>
              <li v-for="host in plugin.manifest?.permissions.network?.hosts ?? []" :key="host"><code>{{ host }}</code></li>
            </ul>
            <strong>{{ t('pluginGrantedHostsHeading') }}</strong>
            <p v-if="plugin.preference.grantedHosts.length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
            <ul v-else>
              <li v-for="host in plugin.preference.grantedHosts" :key="host">
                <code>{{ host }}</code>
                <Button variant="ghost" size="sm" :disabled="busy" @click="revokeGrantedHost(plugin, host)">
                  {{ t('pluginRevokeHost') }}
                </Button>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </section>

    <Card v-if="selectedPlugin?.manifest?.contributes.commands?.length" :title="t('pluginCommandsHeading')" class="plugin-section">
      <p class="plugin-limit-help">{{ t('pluginCommandsHelp') }}</p>
      <div class="plugin-command-list">
        <Button
          v-for="command in selectedPlugin.manifest.contributes.commands"
          :key="command.id"
          variant="secondary"
          size="sm"
          :disabled="Boolean(invokingCommandId) || !selectedPlugin.preference.enabled || !enabledGlobally"
          @click="invokePluginCommand(command.id)"
        >
          {{ commandTitle(command) }}
        </Button>
      </div>
    </Card>

    <Card v-if="selectedPlugin?.manifest?.contributes.settings" :title="t('pluginSettingsHeading')" class="plugin-section">
      <div v-for="(definition, key) in selectedPlugin.manifest.contributes.settings.properties" :key="key" class="plugin-setting-field">
        <template v-if="definition.format === 'secret'">
          <span class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</span>
          <p class="plugin-secret-state">
            {{ pluginSettings?.secrets[key] ? t('pluginSecretConfigured') : t('pluginSecretNotConfigured') }}
          </p>
          <div class="plugin-secret-control">
            <input
              v-model="secretDrafts[key]"
              type="password"
              autocomplete="new-password"
              :maxlength="definition.maxLength ?? 4096"
              :aria-label="settingTitle(definition.title, key)"
              :disabled="busy || loading"
            />
            <Button variant="secondary" size="sm" :disabled="busy || loading" @click="savePluginSecret(key)">
              {{ t('pluginSecretSave') }}
            </Button>
          </div>
        </template>
        <template v-else>
          <label :for="`plugin-setting-${key}`" class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</label>
          <input
            v-if="definition.type === 'boolean'"
            :id="`plugin-setting-${key}`"
            type="checkbox"
            :checked="Boolean(settingsDraft[key] ?? definition.default ?? false)"
            :disabled="busy || loading"
            @change="updateSetting(key, 'boolean', ($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="definition.enum"
            :id="`plugin-setting-${key}`"
            :value="settingValue(key, definition)"
            :disabled="busy || loading"
            @change="updateSetting(key, definition.type, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in definition.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
          </select>
          <input
            v-else
            :id="`plugin-setting-${key}`"
            :type="definition.type === 'number' ? 'number' : 'text'"
            :value="settingValue(key, definition)"
            :min="definition.minimum"
            :max="definition.maximum"
            :maxlength="definition.maxLength"
            :disabled="busy || loading"
            @input="updateSetting(key, definition.type, ($event.target as HTMLInputElement).value)"
          />
        </template>
      </div>
      <Button variant="primary" size="sm" :disabled="busy || loading" @click="savePluginSettings">
        {{ t('pluginSettingsSave') }}
      </Button>
    </Card>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginDiagnosticsHeading') }}</h3>
          <p>{{ t('pluginDiagnosticsHelp') }}</p>
        </div>
        <Select v-model="selectedPluginId" size="sm" :aria-label="t('pluginDiagnosticsHeading')" :disabled="plugins.length === 0">
          <option v-for="plugin in plugins" :key="plugin.id" :value="plugin.id">{{ pluginName(plugin) }}</option>
        </Select>
      </div>
      <template v-if="selectedPluginId">
        <div class="plugin-subheading">{{ t('pluginRecentLogs') }}</div>
        <div v-if="logs.length === 0" class="plugin-empty compact">{{ t('pluginNoLogs') }}</div>
        <ul v-else class="plugin-diagnostic-list">
          <li v-for="(entry, index) in logs" :key="`${entry.at}-${index}`">
            <time>{{ diagnosticTime(entry.at) }}</time>
            <span class="plugin-log-level" :class="`level-${entry.level}`">{{ entry.level }}</span>
            <span class="plugin-log-message">{{ entry.message }}</span>
          </li>
        </ul>
        <div class="plugin-subheading">{{ t('pluginRejectedCalls') }}</div>
        <div v-if="diagnostics.length === 0" class="plugin-empty compact">{{ t('pluginNoDiagnostics') }}</div>
        <ul v-else class="plugin-diagnostic-list">
          <li v-for="(entry, index) in diagnostics" :key="`${entry.at}-${index}`">
            <time>{{ diagnosticTime(entry.at) }}</time>
            <span class="plugin-log-message">{{ diagnosticCodeLabel(entry) }}</span>
          </li>
        </ul>
        <Button variant="secondary" size="sm" @click="refreshDiagnostics()">{{ t('refresh') }}</Button>
      </template>
      <div v-else class="plugin-empty compact">{{ t('pluginSelectForDiagnostics') }}</div>
    </section>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginNotificationsHeading') }}</h3>
          <p>{{ t('pluginNotificationsHelp') }}</p>
        </div>
        <Button variant="secondary" size="sm" :disabled="notifications.length === 0" @click="clearNotifications()">
          {{ t('pluginClearAll') }}
        </Button>
      </div>
      <div v-if="notifications.length === 0" class="plugin-empty">{{ t('pluginNoNotifications') }}</div>
      <ul v-else class="plugin-notification-list">
        <li v-for="record in notifications" :key="record.item.id" :class="{ read: record.read }">
          <div class="plugin-notification-copy">
            <strong>{{ notificationSource(record) }}</strong>
            <time>{{ notificationTime(record.item.createdAt) }}</time>
            <span>{{ record.item.title }} · {{ record.item.body }}</span>
          </div>
          <div class="plugin-notification-actions">
            <Button v-if="record.item.link" variant="ghost" size="sm" @click="openNotificationLink(record.item.id)">
              {{ t('pluginFeedOpenLink') }}
            </Button>
            <Button v-if="!record.read" variant="secondary" size="sm" @click="markNotificationRead(record.item.id)">
              {{ t('pluginMarkRead') }}
            </Button>
          </div>
        </li>
      </ul>
    </section>

    <PluginPanelDialogs
      :plan="pendingPlan"
      :pending-plugin-name="pendingPluginName"
      :pending-permissions="pendingPermissions"
      :pending-added-permissions="pendingAddedPermissions"
      :remove-name="pendingRemove ? pluginName(pendingRemove) : ''"
      :keep-data="keepData"
      :secret-consent-open="pendingSecretConsentKey !== ''"
      :display-fingerprint="displayFingerprint"
      :plan-kind-label="planKindLabel"
      @confirm-install="confirmInstall"
      @cancel-install="pendingPlan = null"
      @confirm-remove="confirmRemove"
      @cancel-remove="pendingRemove = null"
      @update-keep-data="keepData = $event"
      @confirm-secret-consent="confirmSecretConsent"
      @cancel-secret-consent="pendingSecretConsentKey = ''"
    />
  </div>
</template>

<style scoped src="./PluginPanel.css"></style>
