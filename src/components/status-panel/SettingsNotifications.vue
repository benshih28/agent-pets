<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Card from '@/components/ui/Card.vue'
import ToggleChip from '@/components/ui/ToggleChip.vue'

const store = useAgentStore()
</script>

<template>
  <Card :title="t('panel.notificationsCard')">
    <div class="settings-quick-toggles" role="group" :aria-label="t('quickSettings')">
      <ToggleChip
        :model-value="store.notificationsEnabled"
        :label="t('notifications')"
        :state-label="store.notificationsEnabled ? t('panel.stateOn') : t('panel.stateOff')"
        :overridden="store.dndEnabled"
        :overridden-label="t('panel.pausedByDnd')"
        icon="bell"
        @update:model-value="store.setNotificationsEnabled($event)"
      />
      <ToggleChip
        :model-value="store.dndEnabled"
        :label="t('dnd')"
        :state-label="store.dndEnabled ? t('panel.stateOn') : t('panel.stateOff')"
        icon="bell-off"
        @update:model-value="store.setDndEnabled($event)"
      />
      <ToggleChip
        :model-value="store.soundEnabled"
        :label="t('sound')"
        :state-label="store.soundEnabled ? t('panel.stateOn') : t('panel.stateOff')"
        icon="volume"
        icon-off="volume-off"
        @update:model-value="store.setSoundEnabled($event)"
      />
    </div>
    <p class="section-copy">{{ t('panel.dndExplain') }}</p>
  </Card>
</template>
