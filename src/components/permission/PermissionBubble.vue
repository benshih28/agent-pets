<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, tPlural, type TranslationKey } from '@/i18n'
import { alsoAnswerableKey, permissionSourceName } from '@/utils/permission-source'
import type { PermissionOutcomeKind } from '@/types/permission'
import Button from '@/components/ui/Button.vue'
import PermissionRiskBadge from '@/components/permission/PermissionRiskBadge.vue'
import PermissionDetails from '@/components/permission/PermissionDetails.vue'
import PermissionCountdown from '@/components/permission/PermissionCountdown.vue'
import PermissionQueueOverview from '@/components/permission/PermissionQueueOverview.vue'
import { usePermissionClickGuard } from '@/components/permission/usePermissionClickGuard'
import { usePermissionClock } from '@/components/permission/usePermissionClock'
import { usePermissionKeyboard } from '@/components/permission/usePermissionKeyboard'

const store = useAgentStore()
const now = usePermissionClock()
const request = computed(() => store.permissionRequest)
const outcome = computed(() => store.permissionOutcome)

const OUTCOME_KEYS: Record<PermissionOutcomeKind, TranslationKey> = {
  expired: 'permission.outcomeExpired',
  cancelled: 'permission.outcomeCancelled',
  delivery_failed: 'permission.outcomeDeliveryFailed',
  conflict: 'permission.outcomeConflict',
  error: 'permission.outcomeError',
}

function outcomeText(kind: PermissionOutcomeKind, agentId: string): string {
  return t(OUTCOME_KEYS[kind], { source: permissionSourceName(agentId) })
}

// A request that is still pending but whose last decision attempt errored.
const inlineError = computed(() => {
  const current = request.value
  const result = outcome.value
  if (!current || !result || result.requestId !== current.requestId || result.kind !== 'error') return null
  return outcomeText(result.kind, current.agentId)
})

// A new request ignores clicks for a moment (see usePermissionClickGuard); then the safe
// choice (Deny) takes focus, but only if this window already has focus: stealing focus
// from another app's text field would be worse than not focusing at all.
const denyButton = ref<InstanceType<typeof Button> | null>(null)
const { armed, arm } = usePermissionClickGuard(() => {
  if (document.hasFocus()) (denyButton.value?.$el as HTMLButtonElement | undefined)?.focus({ preventScroll: true })
})

function decide(decision: 'allow_once' | 'deny', viaKeyboard = false): void {
  const current = request.value
  if (!current || current.status !== 'pending') return
  if (!current.allowedDecisions.includes(decision)) return
  // Denying is always safe, so the keyboard may deny straight away.
  if (!armed.value && !(viaKeyboard && decision === 'deny')) return
  void store.decidePermission(current.requestId, decision)
}

// --- Queue overview -----------------------------------------------------------
const queueOpen = ref(false)
const hasQueue = computed(() => store.permissionRequests.length > 1)

function toggleQueue(): void {
  queueOpen.value = !queueOpen.value
}

const RISK_LABEL_KEYS: Record<string, TranslationKey> = {
  high: 'permissionRiskHigh',
  medium: 'permissionRiskMedium',
  low: 'permissionRiskLow',
}

const announcement = computed(() => {
  const current = request.value
  if (!current) return ''
  return t('permission.announce', {
    source: permissionSourceName(current.agentId),
    action: current.action,
    risk: t(RISK_LABEL_KEYS[current.risk] ?? 'permissionRiskUnknown'),
  })
})

// Global shortcut labels come from the main process (platform-correct); they
// are only advertised when the shortcut is actually registered.
const hotkey = computed(() => request.value?.hotkey ?? null)
const showHotkeys = computed(() => hotkey.value?.status === 'active')
// Main reports a platform-formatted label ("⌘⇧Y" or "Ctrl+Shift+Y"); render one key cap per key.
function keyCaps(label: string | undefined): string[] {
  if (!label) return []
  return label.includes('+') ? label.split('+').filter(Boolean) : Array.from(label)
}
const denyKeyCaps = computed(() => keyCaps(hotkey.value?.denyLabel))
const allowKeyCaps = computed(() => keyCaps(hotkey.value?.allowLabel))
// 模板裡多處用到，算一次。
const sourceName = computed(() => (request.value ? permissionSourceName(request.value.agentId) : ''))
const hotkeyBlocked = computed(() => hotkey.value?.status === 'unavailable')
const alsoAnswerKey = computed(() => (request.value ? alsoAnswerableKey(request.value.agentId) : null))
// The broker drops allow_once for a risky request whose arguments were cut off.
const canAllow = computed(() => request.value?.allowedDecisions.includes('allow_once') ?? false)

// --- In-window keyboard (only while focus is inside the bubble) --------------
const { needsHold, holdProgress, cancelHold, onKeydown, onKeyup } = usePermissionKeyboard({
  risk: computed(() => request.value?.risk),
  decide,
})

watch(() => request.value?.requestId, (id) => {
  cancelHold()
  queueOpen.value = false
  if (id) arm()
}, { immediate: true })
</script>

<template>
  <section
    v-if="request"
    class="permission-request"
    :class="[`risk-${request.risk}`, { deciding: request.status === 'deciding' }]"
    role="alertdialog"
    aria-labelledby="permission-request-title"
    aria-describedby="permission-request-description"
    data-pet-hit-target="solid"
    @mousedown.stop
    @click.stop
    @keydown="onKeydown"
    @keyup="onKeyup"
    @focusout="cancelHold"
  >
    <span class="permission-sr-only" aria-live="assertive">{{ announcement }}</span>
    <header class="permission-request-header">
      <span class="permission-request-source">{{ sourceName }}</span>
      <span class="permission-request-project" :title="request.projectId">{{ request.projectId || t('projectUnknown') }}</span>
      <Button
        v-if="hasQueue"
        variant="ghost"
        size="sm"
        class="permission-request-queue permission-queue-toggle"
        :aria-expanded="queueOpen"
        :aria-label="tPlural('permission.queueToggle', request.queueSize)"
        @mousedown.stop
        @click.stop="toggleQueue"
      >
        {{ request.queuePosition }}/{{ request.queueSize }}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="queueOpen ? 'M3 10.5 8 5.5l5 5' : 'M3 5.5l5 5 5-5'" />
        </svg>
      </Button>
      <span v-else class="permission-request-queue">{{ request.queuePosition }}/{{ request.queueSize }}</span>
    </header>
    <PermissionQueueOverview v-if="queueOpen && hasQueue" :now="now" />
    <p class="permission-request-heading">
      <strong id="permission-request-title">{{ request.action }}</strong>
      <PermissionRiskBadge :risk="request.risk" :network="request.network" />
    </p>
    <PermissionDetails :request="request" id-prefix="permission-request" />
    <PermissionCountdown :request="request" :now="now" />
    <p v-if="inlineError" class="permission-request-error" role="alert">{{ inlineError }}</p>
    <div class="permission-request-actions">
      <Button
        ref="denyButton"
        class="permission-button deny"
        :disabled="request.status !== 'pending' || !armed"
        @mousedown.stop
        @click.stop="decide('deny')"
      >
        {{ t('permissionDeny') }}
        <span v-if="showHotkeys" class="permission-keycaps"><kbd v-for="key in denyKeyCaps" :key="key">{{ key }}</kbd></span>
      </Button>
      <Button
        class="permission-button allow"
        :disabled="request.status !== 'pending' || !armed || !canAllow"
        @mousedown.stop
        @click.stop="decide('allow_once')"
      >
        {{ request.status === 'deciding' ? t('sending') : t('permissionAllowOnce') }}
        <span v-if="showHotkeys" class="permission-keycaps"><kbd v-for="key in allowKeyCaps" :key="key">{{ key }}</kbd></span>
      </Button>
    </div>
    <p v-if="!canAllow" class="permission-request-hint">{{ t('permission.allowNeedsFullView', { source: sourceName }) }}</p>
    <p v-if="alsoAnswerKey" class="permission-request-hint">{{ t(alsoAnswerKey, { source: sourceName }) }}</p>
    <p v-if="hotkeyBlocked" class="permission-request-hint">{{ t('permission.hotkeyUnavailable') }}</p>
    <p class="permission-request-hint permission-keyboard-hint" :class="{ holding: holdProgress }">
      {{ needsHold ? t('permission.keyboardHint') : t('permission.keyboardHintLow') }}
    </p>
  </section>

  <section
    v-else-if="outcome"
    class="permission-request permission-outcome"
    :class="`outcome-${outcome.kind}`"
    role="status"
    aria-live="polite"
    data-pet-hit-target="solid"
    @mousedown.stop
    @click.stop
  >
    <p class="permission-outcome-text">{{ outcomeText(outcome.kind, outcome.agentId) }}</p>
    <div class="permission-request-actions">
      <Button class="permission-button deny" @mousedown.stop @click.stop="store.dismissPermissionOutcome()">
        {{ t('permission.dismiss') }}
      </Button>
      <Button class="permission-button allow" @mousedown.stop @click.stop="store.togglePanel()">
        {{ t('permission.viewInPanel') }}
      </Button>
    </div>
  </section>
</template>

<style scoped src="@/components/permission/PermissionBubble.css"></style>
