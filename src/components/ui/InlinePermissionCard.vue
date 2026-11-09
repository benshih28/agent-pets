<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PermissionDecisionValue, PermissionRequestView } from '@/types/permission'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { alsoAnswerableKey, permissionSourceName } from '@/utils/permission-source'
import { formatDuration } from '@/utils/permission-view'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import PermissionRiskBadge from '@/components/permission/PermissionRiskBadge.vue'
import PermissionDetails from '@/components/permission/PermissionDetails.vue'
import PermissionCountdown from '@/components/permission/PermissionCountdown.vue'
import { usePermissionClock } from '@/components/permission/usePermissionClock'

const props = defineProps<{
  request: PermissionRequestView
}>()

const emit = defineEmits<{
  decide: [decision: PermissionDecisionValue]
}>()

const store = useAgentStore()
const now = usePermissionClock()
const deciding = ref<PermissionDecisionValue | null>(null)

const title = computed(() => `${permissionSourceName(props.request.agentId)} · ${t('permissionInlineTitle')}`)
const waited = computed(() => formatDuration(now.value - props.request.receivedAt))
const alsoAnswerKey = computed(() => alsoAnswerableKey(props.request.agentId))

// A failed decision leaves the buttons usable again so the user can retry or
// go back to the agent; the card says why instead of silently resetting.
const decideError = computed(() => {
  const outcome = store.permissionOutcome
  if (!outcome || outcome.requestId !== props.request.requestId) return null
  const key = outcome.kind === 'delivery_failed' ? 'permission.outcomeDeliveryFailed' : 'permission.outcomeError'
  return t(key, { source: permissionSourceName(props.request.agentId) })
})

watch(() => store.permissionOutcome, (outcome) => {
  if (outcome?.requestId === props.request.requestId) deciding.value = null
})

watch(() => props.request.requestId, () => {
  deciding.value = null
})

const canAllow = () => props.request.allowedDecisions.includes('allow_once')
const canDeny = () => props.request.allowedDecisions.includes('deny')

function decide(decision: PermissionDecisionValue): void {
  if (props.request.status !== 'pending' || deciding.value) return
  if (decision === 'allow_once' && !canAllow()) return
  if (decision === 'deny' && !canDeny()) return
  deciding.value = decision
  emit('decide', decision)
}
</script>

<template>
  <section
    class="inline-permission-card"
    aria-labelledby="inline-permission-title"
    aria-describedby="inline-permission-context inline-permission-description"
  >
    <div class="inline-permission-heading">
      <Icon name="warning" :size="18" />
      <div class="inline-permission-copy">
        <strong id="inline-permission-title">{{ title }}</strong>
        <span id="inline-permission-context">
          {{ request.projectId || t('projectUnknown') }} · {{ t('permission.waited', { time: waited }) }} · <code>{{ request.action }}</code>
        </span>
      </div>
    </div>
    <PermissionRiskBadge class="inline-permission-risk" :risk="request.risk" :network="request.network" />
    <PermissionDetails :request="request" id-prefix="inline-permission" />
    <PermissionCountdown class="inline-permission-countdown" :request="request" :now="now" />
    <p v-if="!canAllow()" class="inline-permission-hint">{{ t('permission.allowNeedsFullView', { source: permissionSourceName(request.agentId) }) }}</p>
    <p v-if="alsoAnswerKey" class="inline-permission-hint">{{ t(alsoAnswerKey, { source: permissionSourceName(request.agentId) }) }}</p>
    <p v-if="decideError" class="inline-permission-warning" role="alert">{{ decideError }}</p>
    <div class="inline-permission-actions">
      <Button
        v-if="canAllow()"
        variant="primary"
        class="permission-button permission-allow"
        :disabled="request.status !== 'pending' || deciding !== null"
        @click="decide('allow_once')"
      >
        {{ deciding === 'allow_once' ? t('sending') : t('permissionAllowOnce') }}
      </Button>
      <Button
        v-if="canDeny()"
        variant="secondary"
        class="permission-button permission-deny"
        :disabled="request.status !== 'pending' || deciding !== null"
        @click="decide('deny')"
      >
        {{ deciding === 'deny' ? t('sending') : t('permissionDeny') }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
.inline-permission-card {
  display: flex;
  flex-direction: column;
  gap: var(--organic-space-3, var(--space-3));
  padding: 15px var(--organic-space-4, var(--space-4));
  border: 2px solid var(--accent);
  border-radius: var(--organic-radius-md, var(--radius-md));
  /* 以浮層表面承載內容、強調色只做外框：提示、倒數與風險徽章的文字都放在
     驗證器保證 >= 4.5:1 的表面上（舊版放在強調色填色上，淺色只有 3.29:1 甚至更低）。 */
  background: var(--surface-overlay);
  color: var(--text-primary);
  box-shadow: var(--shadow-hero, var(--shadow-panel));
}

.inline-permission-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--organic-space-2, var(--space-2));
}

.inline-permission-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.inline-permission-copy strong {
  overflow: hidden;
  font-family: var(--font-heading, var(--font-ui));
  font-size: var(--font-heading-sm, var(--font-md));
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-permission-copy span {
  overflow: hidden;
  font-size: var(--font-body-sm, var(--font-sm));
  line-height: 1.45;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-permission-copy code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.inline-permission-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-body-sm, var(--font-sm));
  line-height: 1.45;
}

.inline-permission-warning {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-body-sm, var(--font-sm));
  font-weight: var(--weight-medium);
  line-height: 1.45;
}

.inline-permission-risk {
  align-self: flex-start;
  padding: 1px var(--space-2);
  border: 1px solid currentColor;
  border-radius: var(--radius-pill);
  background: var(--surface-overlay);
}

.inline-permission-countdown {
  margin: 0;
}

.inline-permission-actions {
  display: flex;
  gap: var(--organic-space-2, var(--space-2));
}

.permission-button {
  flex: 1;
}

.permission-allow {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
  color: var(--accent-on);
}

/* 與 Button 的主要按鈕相同：往文字色混 12%，onAccent 對比只增不減。 */
.permission-allow:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-hover) 88%, var(--text-primary));
  background: color-mix(in srgb, var(--accent-hover) 88%, var(--text-primary));
}

.permission-deny {
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-primary);
}

.permission-deny:hover:not(:disabled) {
  border-color: var(--text-primary);
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}
</style>
