<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

const store = useAgentStore()

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
/* Destructive controls sit last and apart from the configuration cards. */
.app-controls {
  margin-top: var(--space-4);
}
</style>
