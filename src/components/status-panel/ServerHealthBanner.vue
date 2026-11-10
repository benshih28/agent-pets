<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import type { LocalServerHealth } from '@/types/reliability'

const servers = ref<LocalServerHealth[]>([])
let dispose: (() => void) | null = null

const offline = computed(() => servers.value.filter(server => server.state === 'retrying' || server.state === 'failed'))

function describe(server: LocalServerHealth): string {
  const name = t(`reliability.server.name.${server.id}`)
  if (server.state === 'failed') return `${name}：${t('reliability.server.bannerFailed', { port: server.port, code: server.code ?? 'UNKNOWN' })}`
  if (server.occupant === 'agent-pets') return `${name}：${t('reliability.server.bannerBusyAgentPets', { port: server.port })}`
  return `${name}：${t('reliability.server.bannerBusy', { port: server.port })}`
}

const expanded = ref(false)
const allRetrying = computed(() => offline.value.every(server => server.state === 'retrying' && server.occupant !== 'agent-pets'))
const summary = computed(() => t(allRetrying.value ? 'reliability.server.summaryBusy' : 'reliability.server.summaryMixed', { count: offline.value.length }))

function retry() {
  void window.electronAPI?.retryServerHealth?.().then(snapshot => { servers.value = snapshot.servers }).catch(() => {})
}

onMounted(() => {
  void window.electronAPI?.getServerHealth?.().then(snapshot => { servers.value = snapshot.servers }).catch(() => {})
  dispose = window.electronAPI?.onServerHealthChanged?.(snapshot => { servers.value = snapshot.servers }) ?? null
})
onUnmounted(() => dispose?.())
</script>

<template>
  <div v-if="offline.length > 0" class="server-health-banner" role="alert">
    <Icon name="warning" :size="18" />
    <div class="server-health-text">
      <strong class="server-health-summary">{{ summary }}</strong>
      <ul v-if="expanded" id="server-health-details" class="server-health-details">
        <li v-for="server in offline" :key="server.id">{{ describe(server) }}</li>
      </ul>
    </div>
    <div class="server-health-actions">
      <Button size="sm" variant="secondary" @click="retry">{{ t('reliability.server.retry') }}</Button>
      <Button size="sm" variant="ghost" :aria-expanded="expanded" aria-controls="server-health-details" @click="expanded = !expanded">
        {{ expanded ? t('reliability.server.hideDetails') : t('reliability.server.showDetails') }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.server-health-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--organic-space-2);
  margin: 0 var(--organic-space-4) var(--organic-space-3);
  padding: var(--organic-space-3) var(--organic-space-4);
  border-radius: var(--organic-radius-md);
  background: var(--organic-surface-warm);
  color: var(--organic-accent-text);
}

.server-health-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0-5);
}

.server-health-text strong {
  font-family: var(--font-heading);
  font-size: var(--font-heading-sm);
}

.server-health-summary {
  line-height: 1.4;
}

.server-health-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  margin: var(--organic-space-1) 0 0;
  padding: 0;
  font-size: var(--font-body-sm);
  line-height: 1.45;
  list-style: none;
}

.server-health-actions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: var(--organic-space-1);
}
</style>
