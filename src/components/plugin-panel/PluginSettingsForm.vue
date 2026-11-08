<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Chip from '@/components/ui/Chip.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Input from '@/components/ui/Input.vue'
import NumberField from '@/components/ui/NumberField.vue'
import Select from '@/components/ui/Select.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { SettingErrorCode } from '@/utils/plugin-settings-form'

const {
  loading, isBusy, selectedPluginId, selectedPlugin, pluginSettings, settingsDraft, secretDrafts, settingsErrors,
  settingsDirty, pendingSecretRemoveKey, settingTitle, settingValue, updateSetting, savePluginSettings,
  savePluginSecret, removePluginSecret, resetSettingsDraft, resetSettingsToDefaults,
} = usePluginController()

const errorKeys = {
  required: 'plugins.settingErrorRequired',
  range: 'plugins.settingErrorRange',
  too_long: 'plugins.settingErrorTooLong',
  not_allowed: 'plugins.settingErrorNotAllowed',
} as const

function errorText(code: SettingErrorCode | undefined): string | undefined {
  return code ? t(errorKeys[code]) : undefined
}

const busyNow = () => loading.value || isBusy(`plugin:${selectedPluginId.value}`)
</script>

<template>
  <form v-if="selectedPlugin?.manifest?.contributes.settings" class="settings-form" @submit.prevent="savePluginSettings">
    <template v-for="(definition, key) in selectedPlugin.manifest.contributes.settings.properties" :key="key">
      <section v-if="definition.format === 'secret'" class="field secret" :aria-label="settingTitle(definition.title, key)">
        <div class="secret-head">
          <span class="field-title">{{ settingTitle(definition.title, key) }}</span>
          <Chip :tone="pluginSettings?.secrets[key] ? 'success' : 'neutral'" :icon="pluginSettings?.secrets[key] ? 'check' : undefined">
            {{ pluginSettings?.secrets[key] ? t('pluginSecretConfigured') : t('pluginSecretNotConfigured') }}
          </Chip>
        </div>
        <Input
          v-model="secretDrafts[key]"
          type="password"
          autocomplete="new-password"
          :maxlength="definition.maxLength ?? 4096"
          :aria-label="settingTitle(definition.title, key)"
          :placeholder="pluginSettings?.secrets[key] ? t('plugins.secretReplacePlaceholder') : ''"
          :disabled="busyNow()"
        />
        <div class="secret-actions">
          <Button type="button" variant="secondary" size="sm" :disabled="busyNow() || !(secretDrafts[key] ?? '').length" @click="savePluginSecret(key)">
            {{ pluginSettings?.secrets[key] ? t('plugins.secretUpdate') : t('plugins.secretSet') }}
          </Button>
          <Button v-if="pluginSettings?.secrets[key]" type="button" variant="danger" size="sm" :disabled="busyNow()" @click="pendingSecretRemoveKey = key">
            {{ t('plugins.secretRemove') }}
          </Button>
        </div>
        <p class="field-help">{{ t('plugins.secretStorageNote') }}</p>
      </section>

      <Checkbox
        v-else-if="definition.type === 'boolean'"
        :model-value="Boolean(settingsDraft[key] ?? definition.default ?? false)"
        :label="settingTitle(definition.title, key)"
        :disabled="busyNow()"
        @update:model-value="updateSetting(key, 'boolean', $event)"
      />

      <div v-else-if="definition.enum" class="field">
        <span class="field-title">{{ settingTitle(definition.title, key) }}</span>
        <Select
          :model-value="settingValue(key, definition)"
          :aria-label="settingTitle(definition.title, key)"
          :disabled="busyNow()"
          @update:model-value="updateSetting(key, definition.type, $event)"
        >
          <option v-for="option in definition.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
        </Select>
        <p v-if="settingsErrors[key]" class="field-error" role="alert">{{ errorText(settingsErrors[key]) }}</p>
      </div>

      <NumberField
        v-else-if="definition.type === 'number'"
        :model-value="Number(settingValue(key, definition))"
        :label="settingTitle(definition.title, key)"
        :min="definition.minimum"
        :max="definition.maximum"
        :error="errorText(settingsErrors[key])"
        :disabled="busyNow()"
        @commit="updateSetting(key, 'number', $event)"
      />

      <Input
        v-else
        :model-value="settingValue(key, definition)"
        :label="settingTitle(definition.title, key)"
        :maxlength="definition.maxLength"
        :error="errorText(settingsErrors[key])"
        :disabled="busyNow()"
        @update:model-value="updateSetting(key, definition.type, String($event))"
      />
    </template>

    <div class="form-bar">
      <p class="dirty" :class="{ on: settingsDirty }" role="status">{{ settingsDirty ? t('plugins.settingsUnsaved') : t('plugins.settingsSavedState') }}</p>
      <Button type="button" variant="ghost" size="sm" :disabled="busyNow()" @click="resetSettingsToDefaults">{{ t('plugins.settingsDefaults') }}</Button>
      <Button type="button" variant="secondary" size="sm" :disabled="busyNow() || !settingsDirty" @click="resetSettingsDraft">{{ t('plugins.settingsRevert') }}</Button>
      <Button type="submit" variant="primary" size="sm" :disabled="busyNow() || !settingsDirty">{{ t('pluginSettingsSave') }}</Button>
    </div>

    <ConfirmDialog
      :open="pendingSecretRemoveKey !== ''"
      :title="t('plugins.secretRemoveTitle')"
      :message="t('plugins.secretRemoveHelp')"
      :confirm-label="t('plugins.secretRemove')"
      :cancel-label="t('cancel')"
      tone="danger"
      @confirm="removePluginSecret(pendingSecretRemoveKey)"
      @cancel="pendingSecretRemoveKey = ''"
    />
  </form>
</template>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-title {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.secret-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.secret-actions {
  display: flex;
  gap: var(--space-2);
}

.field-help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.field-error {
  margin: 0;
  color: var(--state-error-soft);
  font-size: var(--font-xs);
}

.form-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.dirty {
  flex: 1 1 auto;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.dirty.on {
  color: var(--state-warn-bright);
}
</style>
