<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
</script>

<template>
  <Card :title="t('windowModes')">
    <ToggleRow :model-value="store.petWindowMode.mode === 'mini'" :label="t('miniMode')" :help="t('miniModeHelp')" @update:model-value="store.setPetMode($event ? 'mini' : 'normal')" />
    <ToggleRow :model-value="store.edgeModeEnabled" :label="t('edgePeek')" :help="t('edgePeekHelp')" @update:model-value="store.setEdgeModeEnabled($event)" />
  </Card>

  <Card :title="t('desktopBehavior')">
    <ToggleRow :model-value="store.shimejiEnabled" :label="t('shimejiBehavior')" :help="t('shimejiBehaviorHelp')" @update:model-value="store.setShimejiEnabled($event)" />
    <ToggleRow
      :model-value="store.captureExclusionEnabled"
      :label="t('captureExclusion')"
      :help="store.desktopVisibilityCapabilities.captureExclusion.supported ? t('captureExclusionHelp') : t('captureExclusionUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.captureExclusion.supported"
      @update:model-value="store.setCaptureExclusionEnabled($event)"
    />
    <ToggleRow
      :model-value="store.fullscreenAutoHideEnabled"
      :label="t('fullscreenAutoHide')"
      :help="store.desktopVisibilityCapabilities.fullscreenAutoHide.supported ? t('fullscreenAutoHideHelp') : t('fullscreenAutoHideUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.fullscreenAutoHide.supported"
      @update:model-value="store.setFullscreenAutoHideEnabled($event)"
    />
    <ToggleRow :model-value="store.rightClickHideEnabled" :label="t('rightClickHide')" :help="t('rightClickHideHelp')" @update:model-value="store.setRightClickHideEnabled($event)" />
    <ToggleRow :model-value="store.permissionBubbleEnabled" :label="t('permissionBubble')" :help="t('permissionBubbleHelp')" @update:model-value="store.setPermissionBubbleEnabled($event)" />
  </Card>

  <Card :title="t('system')">
    <ToggleRow :model-value="store.presentationMcpEnabled" :label="t('presentationMcp')" :help="t('presentationMcpHelp')" @update:model-value="store.setPresentationMcpEnabled($event)" />
    <ToggleRow
      :model-value="store.launchAtStartup"
      :label="t('launchAtStartup')"
      :help="store.launchAtStartupSupported ? t('launchAtStartupHelp') : t('availablePackaged')"
      :disabled="!store.launchAtStartupSupported"
      @update:model-value="store.setLaunchAtStartup($event)"
    />
  </Card>
</template>
