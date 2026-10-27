<script setup lang="ts">
import { t } from '@/i18n'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import type { PluginInstallPlan } from '@/types/plugin'

defineProps<{
  plan: PluginInstallPlan | null
  pendingPluginName: string
  pendingPermissions: string[]
  pendingAddedPermissions: string[]
  removeName: string
  keepData: boolean
  secretConsentOpen: boolean
  displayFingerprint: (value: string | undefined) => string
  planKindLabel: (plan: PluginInstallPlan) => string
}>()

const emit = defineEmits<{
  confirmInstall: []
  cancelInstall: []
  confirmRemove: []
  cancelRemove: []
  updateKeepData: [value: boolean]
  confirmSecretConsent: []
  cancelSecretConsent: []
}>()
</script>

<template>
  <ConfirmDialog
    :open="plan !== null && plan.kind !== 'incompatible'"
    :title="t('pluginInstallConfirmTitle')"
    :message="t('pluginThirdPartyWarning')"
    :focus-cancel="plan?.requiresSignatureConfirmation === true"
    :confirm-label="t('pluginInstallConfirm')"
    :cancel-label="t('cancel')"
    @confirm="emit('confirmInstall')"
    @cancel="emit('cancelInstall')"
  >
    <div v-if="plan" class="plugin-plan-content">
      <p v-if="plan.source === 'catalog'" class="plugin-catalog-source">{{ t('pluginCatalogInstallSource') }}</p>
      <p>{{ t('pluginPlanSummary', { name: pendingPluginName, version: plan.version ?? '', author: plan.author ?? '', kind: planKindLabel(plan) }) }}</p>
      <p v-if="plan.developerMode" class="plugin-plan-warning">{{ t('pluginSignatureDeveloperUnverified') }}</p>
      <template v-else>
        <p class="plugin-signature-status">{{ t(plan.signatureStatus === 'valid' ? 'pluginSignatureVerified' : 'pluginSignatureUnsigned') }}</p>
        <p v-if="plan.signatureFingerprint" class="plugin-signature-fingerprint">
          {{ t('pluginSignatureFingerprint', { fingerprint: displayFingerprint(plan.signatureFingerprint) }) }}
        </p>
        <p v-if="plan.signatureChange === 'first-trust'" class="plugin-plan-warning">{{ t('pluginSignatureFirstTrust') }}</p>
        <p v-if="plan.signatureChange === 'unsigned-to-signed'" class="plugin-plan-warning">{{ t('pluginSignatureUnsignedToSigned') }}</p>
        <p v-if="plan.signatureChange === 'key-changed'" class="plugin-plan-warning">
          {{ t('pluginSignatureKeyChanged', { previous: displayFingerprint(plan.previousTrustedFingerprint) || t('pluginSignatureUnknownFingerprint'), next: displayFingerprint(plan.signatureFingerprint) }) }}
        </p>
        <p v-if="plan.signatureChange === 'signed-to-unsigned'" class="plugin-plan-warning">
          {{ t('pluginSignatureSignedToUnsigned', { previous: displayFingerprint(plan.previousTrustedFingerprint) || t('pluginSignatureUnknownFingerprint') }) }}
        </p>
      </template>
      <p v-if="plan.kind === 'downgrade'" class="plugin-plan-warning">{{ t('pluginDowngradeWarning') }}</p>
      <p v-if="plan.requiresReconsent" class="plugin-plan-warning">{{ t('pluginNewPermissionWarning') }}</p>
      <template v-if="plan.requiresReconsent && pendingAddedPermissions.length">
        <h3>{{ t('pluginAddedPermissions') }}</h3>
        <ul><li v-for="permission in pendingAddedPermissions" :key="permission">{{ permission }}</li></ul>
      </template>
      <h3>{{ t('pluginRequestedPermissions') }}</h3>
      <ul v-if="pendingPermissions.length">
        <li v-for="permission in pendingPermissions" :key="permission">{{ permission }}</li>
      </ul>
      <p v-else>{{ t('pluginNoExtraPermissions') }}</p>
    </div>
  </ConfirmDialog>

  <ConfirmDialog
    :open="Boolean(removeName)"
    :title="t('pluginRemoveConfirmTitle', { name: removeName })"
    :message="t('pluginRemoveConfirmHelp')"
    :confirm-label="t('remove')"
    :cancel-label="t('cancel')"
    tone="danger"
    @confirm="emit('confirmRemove')"
    @cancel="emit('cancelRemove')"
  >
    <label class="plugin-keep-data">
      <input type="checkbox" :checked="keepData" @change="emit('updateKeepData', ($event.target as HTMLInputElement).checked)" />
      <span>{{ t('pluginKeepData') }}</span>
    </label>
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
</template>

<style scoped>
.plugin-catalog-source { color: var(--text-secondary); font-weight: var(--weight-medium); }
.plugin-plan-content { color: var(--text-secondary); font-size: var(--font-xs); }
.plugin-plan-content p { margin: 0 0 6px; }
.plugin-plan-content h3 { margin: 8px 0 4px; color: var(--text-primary); font-size: var(--font-sm); }
.plugin-plan-content ul { max-height: 110px; overflow: auto; margin: 0; padding-left: 18px; }
.plugin-plan-warning { color: var(--text-warning, var(--text-secondary)); font-weight: var(--weight-medium); }
.plugin-keep-data { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--font-sm); }
.plugin-keep-data input { accent-color: var(--accent); }
</style>
