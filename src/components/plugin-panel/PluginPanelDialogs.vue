<script setup lang="ts">
import { t } from '@/i18n'
import Checkbox from '@/components/ui/Checkbox.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

defineProps<{
  removeName: string
  reportName: string
  keepData: boolean
  secretConsentOpen: boolean
}>()

const emit = defineEmits<{
  confirmReport: []
  cancelReport: []
  confirmRemove: []
  cancelRemove: []
  updateKeepData: [value: boolean]
  confirmSecretConsent: []
  cancelSecretConsent: []
}>()
</script>

<template>
  <ConfirmDialog
    :open="Boolean(removeName)"
    :title="t('pluginRemoveConfirmTitle', { name: removeName })"
    :message="t('plugins.removeHelp')"
    :confirm-label="t('remove')"
    :cancel-label="t('cancel')"
    tone="danger"
    @confirm="emit('confirmRemove')"
    @cancel="emit('cancelRemove')"
  >
    <Checkbox
      :model-value="!keepData"
      :label="t('plugins.removeDeleteData')"
      :help="t('plugins.removeDeleteDataHelp')"
      @update:model-value="emit('updateKeepData', !$event)"
    />
  </ConfirmDialog>

  <ConfirmDialog
    :open="secretConsentOpen"
    :title="t('pluginSecretConsentTitle')"
    :message="t('pluginSecretConsentMessage')"
    :confirm-label="t('pluginSecretConsentConfirm')"
    :cancel-label="t('cancel')"
    @confirm="emit('confirmSecretConsent')"
    @cancel="emit('cancelSecretConsent')"
  />

  <ConfirmDialog
    :open="Boolean(reportName)"
    :title="t('plugins.reportTitle', { name: reportName })"
    :message="t('plugins.reportPreview')"
    :confirm-label="t('plugins.reportOpen')"
    :cancel-label="t('cancel')"
    @confirm="emit('confirmReport')"
    @cancel="emit('cancelReport')"
  />
</template>
