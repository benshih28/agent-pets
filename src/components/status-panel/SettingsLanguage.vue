<script setup lang="ts">
import { locale, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'

const store = useAgentStore()
</script>

<template>
  <Card :title="t('languageSection')">
    <p class="section-copy">{{ t('languageHelp') }}</p>
    <div class="field-row">
      <span class="field-copy">
        <span class="field-label">{{ t('language') }}</span>
        <span class="field-help">{{ t('languageHint') }}</span>
      </span>
      <Select
        :model-value="locale"
        :aria-label="t('language')"
        class="field-control"
        @update:model-value="store.setLocalePreference($event as 'zh-TW' | 'en-US')"
      >
        <option value="zh-TW">{{ t('localeTraditionalChinese') }}</option>
        <option value="en-US">{{ t('localeEnglish') }}</option>
      </Select>
    </div>
  </Card>
</template>
