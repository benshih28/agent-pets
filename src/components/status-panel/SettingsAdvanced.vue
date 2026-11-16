<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { useAppUpdateStore } from '@/stores/appUpdateStore'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Chip from '@/components/ui/Chip.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const updates = useAppUpdateStore()

onMounted(() => { void updates.refresh() })

const autoCheck = computed({
  get: () => updates.state?.enabled ?? false,
  set: value => { void updates.setEnabled(value) },
})

// 主程序回傳的最後結果；一次性提示（頻率限制、開啟失敗）優先顯示。
const updateStatus = computed(() => {
  if (updates.notice === 'rate_limited') return { tone: 'warn' as const, icon: 'alert', text: t('update.rateLimited') }
  if (updates.notice === 'open_failed') return { tone: 'warn' as const, icon: 'alert', text: t('update.openFailed') }
  const state = updates.state
  if (!state) return null
  // 最近一次檢查失敗但先前已確認有新版時，仍顯示新版並附註失敗。
  if (state.latestVersion) {
    const text = state.lastResult === 'failed'
      ? t('update.availableCheckFailed', { version: state.latestVersion })
      : t('update.available', { version: state.latestVersion })
    return { tone: 'info' as const, icon: 'sparkle', text }
  }
  if (state.lastResult === 'up_to_date') return { tone: 'success' as const, icon: 'check', text: t('update.upToDate') }
  if (state.lastResult === 'failed') return { tone: 'danger' as const, icon: 'alert', text: t('update.failed') }
  return null
})

function restartApp(): void {
  window.electronAPI?.restartApp()
}

const diagnosticsMessage = ref('')

async function exportDiagnostics(): Promise<void> {
  diagnosticsMessage.value = ''
  try {
    const result = await window.electronAPI?.exportDiagnostics()
    if (result?.ok) diagnosticsMessage.value = t('reliability.diagnostics.saved')
    else if (!result?.canceled) diagnosticsMessage.value = t('reliability.diagnostics.failed')
  } catch {
    diagnosticsMessage.value = t('reliability.diagnostics.failed')
  }
}

function quitApp(): void {
  window.electronAPI?.quitApp()
}
</script>

<template>
  <Card :title="t('update.title')">
    <p v-if="updates.state" class="section-copy">{{ t('update.currentVersion', { version: updates.state.currentVersion }) }}</p>
    <ToggleRow v-model="autoCheck" :label="t('update.autoCheck')" :help="t('update.autoCheckHelp')" :disabled="!updates.state" />
    <p class="section-copy update-meta">
      <span>{{ t('update.lastChecked') }}</span>
      <RelativeTime v-if="updates.state?.lastCheckedAt" :at="updates.state.lastCheckedAt" />
      <span v-else>{{ t('update.neverChecked') }}</span>
    </p>
    <Button variant="secondary" size="sm" block :loading="updates.checking" :disabled="!updates.state" @click="updates.checkNow()">
      {{ updates.checking ? t('update.checking') : t('update.checkNow') }}
    </Button>
    <div v-if="updateStatus" class="update-status" role="status">
      <Chip :tone="updateStatus.tone" :icon="updateStatus.icon">{{ updateStatus.text }}</Chip>
      <Button v-if="updates.updateAvailable && updates.notice !== 'rate_limited'" variant="primary" size="sm" @click="updates.openRelease()">{{ t('update.viewRelease') }}</Button>
    </div>
  </Card>
  <Card :title="t('presentationMcpSection')">
    <p class="section-copy">{{ t('presentationMcpSetupHelp') }}</p>
    <Button variant="primary" size="sm" block @click="store.openProjectMcpPanel">{{ t('projectMcpPanelTitle') }}</Button>
  </Card>
  <Card :title="t('reliability.diagnostics.title')">
    <p class="section-copy">{{ t('reliability.diagnostics.help') }}</p>
    <Button variant="secondary" size="sm" block @click="exportDiagnostics">{{ t('reliability.diagnostics.export') }}</Button>
    <p v-if="diagnosticsMessage" class="section-copy" role="status">{{ diagnosticsMessage }}</p>
  </Card>
  <Card :title="t('setupWizard')">
    <p class="section-copy">{{ t('panel.setupWizardHelp') }}</p>
    <Button variant="secondary" size="sm" block @click="store.openSetupWizard()">{{ t('setupWizard') }}</Button>
  </Card>
  <Card class="app-controls" tone="warn" :title="t('keepControl')">
    <p class="section-copy">{{ t('keepControlHelp') }}</p>
    <div class="advanced-actions">
      <Button variant="secondary" size="sm" block @click="restartApp">{{ t('restartPet') }}</Button>
      <Button variant="danger" size="sm" block @click="quitApp">{{ t('quit') }}</Button>
    </div>
  </Card>
</template>

<style scoped>
.update-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0;
}

.update-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

/* Destructive controls sit last and apart from the configuration cards. */
.app-controls {
  margin-top: var(--space-4);
}
</style>
