<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

const store = useAgentStore()

function restartApp(): void {
  window.electronAPI?.restartApp()
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
  <Card :title="t('keepControl')">
    <p class="section-copy">{{ t('keepControlHelp') }}</p>
    <div class="advanced-actions">
      <Button variant="primary" size="sm" block @click="store.openSetupWizard()">{{ t('setupWizard') }}</Button>
      <Button variant="secondary" size="sm" block @click="restartApp">{{ t('restartPet') }}</Button>
      <Button variant="danger" size="sm" block @click="quitApp">{{ t('quit') }}</Button>
    </div>
  </Card>
</template>
