<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Card from '@/components/ui/Card.vue'
import NumberField from '@/components/ui/NumberField.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  snapshot, busy, loading, resourceFields, updateGlobalPreferences, updateResourceLimit,
  resourceInputValue, resourceBoundText,
} = usePluginController()

const customize = ref(false)
const usingDefaults = computed(() => resourceFields.every(
  field => (snapshot.value?.preferences.resources[field.key] ?? field.defaultValue) === field.defaultValue,
))
const developerMode = computed(() => snapshot.value?.preferences.developerMode ?? false)

function resetResources(): void {
  void updateGlobalPreferences({ resources: Object.fromEntries(resourceFields.map(field => [field.key, field.defaultValue])) })
}
</script>

<template>
  <Card :title="t('pluginAdvancedSettings')" class="advanced">
    <p class="help">{{ t('pluginAdvancedSettingsHelp') }}</p>
    <ToggleRow
      :model-value="snapshot?.preferences.developerMode ?? false"
      :label="t('pluginDeveloperMode')"
      :help="t('pluginDeveloperModeHelp')"
      :disabled="busy || loading"
      @update:model-value="updateGlobalPreferences({ developerMode: $event })"
    />
    <div v-if="developerMode" class="dev-warning" role="note">
      <Icon name="warning" :size="16" />
      <span>{{ t('plugins.developerWarning') }}</span>
    </div>
    <div class="resource-summary">
      <span>{{ usingDefaults ? t('plugins.limitsDefault') : t('plugins.limitsCustom') }}</span>
      <Button variant="ghost" size="sm" :aria-expanded="customize" @click="customize = !customize">
        {{ customize ? t('plugins.limitsHide') : t('plugins.limitsCustomize') }}
      </Button>
      <Button variant="secondary" size="sm" :disabled="busy || loading || usingDefaults" @click="resetResources">
        {{ t('plugins.limitsReset') }}
      </Button>
    </div>
    <div v-if="customize" class="resource-grid">
      <NumberField
        v-for="field in resourceFields"
        :key="field.key"
        :model-value="Number(resourceInputValue(field.key, snapshot?.preferences.resources[field.key] ?? field.defaultValue))"
        :label="t(field.label)"
        :min="Number(resourceInputValue(field.key, field.min))"
        :max="Number(resourceInputValue(field.key, field.max))"
        :disabled="busy || loading"
        :help="t('pluginResourceRange', {
          default: resourceBoundText(field.key, field.defaultValue),
          min: resourceBoundText(field.key, field.min),
          max: resourceBoundText(field.key, field.max),
        })"
        @commit="updateResourceLimit(field.key, String($event))"
      />
    </div>
  </Card>
</template>

<style scoped>
.help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.dev-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--state-warn);
  color: var(--state-warn-bright);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.resource-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.resource-summary > span {
  flex: 1 1 auto;
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}
</style>
