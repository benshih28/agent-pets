<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Chip from '@/components/ui/Chip.vue'
import Icon from '@/components/ui/Icon.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PermissionGroupView } from '@/composables/usePluginPanelController'
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '@/utils/focus-trap'
import { shouldFocusCancelOnInstall, type InstallAcknowledgementReason } from '@/utils/plugin-permissions'

// Install / update / downgrade confirmation. This is the consent screen for
// untrusted code, so it is a scrollable sheet with a fixed header and a sticky
// action bar: the permission list is never clipped, and the decision buttons
// are always reachable. High-risk changes additionally need an explicit
// acknowledgement checkbox and start with focus on Cancel. The IPC payload sent
// on confirm is unchanged; the checkbox only gates the button in the UI.
const {
  pendingPlan: plan, pendingPluginName, pendingPermissionSections: sections, installAcknowledgements: reasons,
  busy, displayFingerprint, planKindLabel, confirmInstall,
} = usePluginController()

const titleId = useId()
const sheetRef = ref<HTMLElement | null>(null)
const acknowledged = ref(false)
const open = computed(() => plan.value !== null)
const incompatible = computed(() => plan.value?.kind === 'incompatible')
const needsAcknowledgement = computed(() => reasons.value.length > 0)
const canConfirm = computed(() => !busy.value && (!needsAcknowledgement.value || acknowledged.value))
const sourceLabel = computed(() => {
  if (plan.value?.source === 'catalog') return t('plugins.sheetFromCatalog')
  return plan.value?.developerMode ? t('plugins.sheetFromFolder') : t('plugins.sheetFromFile')
})
const title = computed(() => {
  const name = pendingPluginName.value
  switch (plan.value?.kind) {
    case 'update': return t('plugins.sheetUpdateTitle', { name })
    case 'downgrade': return t('plugins.sheetDowngradeTitle', { name })
    case 'reinstall': return t('plugins.sheetReinstallTitle', { name })
    case 'incompatible': return t('plugins.sheetIncompatibleTitle', { name })
    default: return t('plugins.sheetInstallTitle', { name })
  }
})
const reasonKeys: Record<InstallAcknowledgementReason, 'plugins.ackReasonKeyChanged' | 'plugins.ackReasonRemoved' | 'plugins.ackReasonNetwork' | 'plugins.ackReasonSecrets'> = {
  'signature-key-changed': 'plugins.ackReasonKeyChanged',
  'signature-removed': 'plugins.ackReasonRemoved',
  'added-network': 'plugins.ackReasonNetwork',
  'added-secrets': 'plugins.ackReasonSecrets',
}
const groupKeys = { network: 'plugins.groupNetwork', data: 'plugins.groupData', display: 'plugins.groupDisplay' } as const
const riskKeys = { high: 'plugins.riskHigh', medium: 'plugins.riskMedium', low: 'plugins.riskLow' } as const
const riskTone = { high: 'danger', medium: 'warn', low: 'neutral' } as const
const riskIcon = { high: 'warning', medium: 'info', low: undefined } as const

function groupLabel(group: PermissionGroupView): string {
  return t(groupKeys[group.id])
}

let returnFocusTo: HTMLElement | null = null

function focusables(): HTMLElement[] {
  return Array.from(sheetRef.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
}

function cancel(): void {
  plan.value = null
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  const target = nextTrapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
  if (target !== null) {
    event.preventDefault()
    items[target].focus()
  }
}

watch(open, async value => {
  if (value) {
    acknowledged.value = false
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.addEventListener('keydown', onKeydown, true)
    await nextTick()
    const initial = incompatible.value || shouldFocusCancelOnInstall(plan.value) ? '[data-cancel]' : '[data-confirm]'
    sheetRef.value?.querySelector<HTMLElement>(initial)?.focus()
  } else {
    window.removeEventListener('keydown', onKeydown, true)
    if (returnFocusTo?.isConnected) returnFocusTo.focus()
    returnFocusTo = null
  }
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Transition name="sheet">
    <div v-if="open && plan" class="sheet-scrim" @click.self="cancel">
      <div
        ref="sheetRef"
        class="sheet"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        data-testid="plugin-install-sheet"
      >
        <header class="sheet-header">
          <div class="sheet-heading">
            <h2 :id="titleId" class="sheet-title">{{ title }}</h2>
            <p class="sheet-meta">
              <Chip tone="info">{{ planKindLabel(plan) }}</Chip>
              <span v-if="plan.version">
                {{ plan.previousVersion && plan.kind !== 'new' ? t('plugins.sheetVersionChange', { previous: plan.previousVersion, version: plan.version }) : t('pluginVersion', { version: plan.version }) }}
              </span>
              <span v-if="plan.author">· {{ t('pluginCatalogAuthor', { author: plan.author }) }}</span>
            </p>
            <p class="sheet-source">{{ sourceLabel }}</p>
          </div>
        </header>

        <div class="sheet-body">
          <template v-if="incompatible">
            <p class="notice notice-danger" role="alert">
              <Icon name="warning" :size="16" />
              <span>{{ t('pluginIncompatible') }} {{ t('plugins.sheetIncompatibleBody') }}</span>
            </p>
          </template>
          <template v-else>
            <p class="notice">
              <Icon name="info" :size="16" />
              <span>{{ t('pluginThirdPartyWarning') }}</span>
            </p>

            <section class="block" :aria-label="t('plugins.sheetSignature')">
              <h3 class="block-title">{{ t('plugins.sheetSignature') }}</h3>
              <Chip v-if="plan.developerMode" tone="warn" icon="warning">{{ t('pluginSignatureDeveloperUnverified') }}</Chip>
              <template v-else>
                <Chip v-if="plan.signatureChange === 'key-changed'" tone="danger" icon="warning">{{ t('plugins.sigKeyChanged') }}</Chip>
                <Chip v-else-if="plan.signatureChange === 'signed-to-unsigned'" tone="danger" icon="warning">{{ t('plugins.sigRemoved') }}</Chip>
                <Chip v-else-if="plan.signatureStatus === 'valid'" tone="success" icon="shield">{{ t('pluginSignatureVerified') }}</Chip>
                <Chip v-else tone="warn" icon="warning">{{ t('pluginSignatureUnsigned') }}</Chip>
                <p v-if="plan.signatureFingerprint" class="fingerprint">
                  {{ t('pluginSignatureFingerprint', { fingerprint: displayFingerprint(plan.signatureFingerprint) }) }}
                </p>
                <p v-if="plan.signatureChange === 'first-trust'" class="note">{{ t('pluginSignatureFirstTrust') }}</p>
                <p v-if="plan.signatureChange === 'unsigned-to-signed'" class="note">{{ t('pluginSignatureUnsignedToSigned') }}</p>
                <p v-if="plan.signatureChange === 'key-changed'" class="note note-danger">
                  {{ t('pluginSignatureKeyChanged', { previous: displayFingerprint(plan.previousTrustedFingerprint) || t('pluginSignatureUnknownFingerprint'), next: displayFingerprint(plan.signatureFingerprint) }) }}
                </p>
                <p v-if="plan.signatureChange === 'signed-to-unsigned'" class="note note-danger">
                  {{ t('pluginSignatureSignedToUnsigned', { previous: displayFingerprint(plan.previousTrustedFingerprint) || t('pluginSignatureUnknownFingerprint') }) }}
                </p>
              </template>
            </section>

            <p v-if="plan.kind === 'downgrade'" class="notice notice-warn">
              <Icon name="warning" :size="16" />
              <span>{{ t('pluginDowngradeWarning') }}</span>
            </p>
            <p v-if="plan.requiresReconsent" class="notice notice-warn">
              <Icon name="warning" :size="16" />
              <span>{{ t('pluginNewPermissionWarning') }}</span>
            </p>

            <section class="block" :aria-label="sections.isUpdate ? t('plugins.sheetAddedHeading') : t('plugins.sheetAllHeading')">
              <h3 class="block-title">{{ sections.isUpdate ? t('plugins.sheetAddedHeading') : t('plugins.sheetAllHeading') }}</h3>
              <p v-if="sections.added.length === 0" class="note">{{ t('pluginNoExtraPermissions') }}</p>
              <div v-for="group in sections.added" :key="group.id" class="perm-group">
                <div class="perm-group-head">
                  <span class="perm-group-name">{{ groupLabel(group) }}</span>
                  <Chip :tone="riskTone[group.risk]" :icon="riskIcon[group.risk]">{{ t(riskKeys[group.risk]) }}</Chip>
                </div>
                <ul class="perm-list">
                  <li v-for="entry in group.entries" :key="entry.unit" class="perm-item" :class="`risk-${entry.risk}`">
                    <span v-if="sections.isUpdate" class="perm-plus" aria-hidden="true">+</span>
                    <span class="perm-copy">
                      <span class="perm-label">{{ entry.label }}</span>
                      <span class="perm-hint">{{ entry.hint }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <details v-if="sections.isUpdate && sections.existingCount" class="block existing">
              <summary>{{ t('plugins.sheetExistingHeading', { count: sections.existingCount }) }}</summary>
              <div v-for="group in sections.existing" :key="group.id" class="perm-group">
                <div class="perm-group-head">
                  <span class="perm-group-name">{{ groupLabel(group) }}</span>
                </div>
                <ul class="perm-list">
                  <li v-for="entry in group.entries" :key="entry.unit" class="perm-item">
                    <span class="perm-copy">
                      <span class="perm-label">{{ entry.label }}</span>
                      <span class="perm-hint">{{ entry.hint }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </details>

            <section v-if="needsAcknowledgement" class="block ack" :aria-label="t('plugins.ackHeading')">
              <h3 class="block-title">{{ t('plugins.ackHeading') }}</h3>
              <ul class="ack-reasons">
                <li v-for="reason in reasons" :key="reason">{{ t(reasonKeys[reason]) }}</li>
              </ul>
              <Checkbox v-model="acknowledged" :label="t('plugins.ackLabel')" />
            </section>
          </template>
        </div>

        <footer class="sheet-actions">
          <Button variant="secondary" size="sm" data-cancel @click="cancel">
            {{ incompatible ? t('plugins.sheetClose') : t('cancel') }}
          </Button>
          <Button v-if="!incompatible" variant="primary" size="sm" data-confirm :disabled="!canConfirm" @click="confirmInstall">
            {{ t('pluginInstallConfirm') }}
          </Button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped src="@/components/plugin-panel/PluginInstallSheet.css"></style>
