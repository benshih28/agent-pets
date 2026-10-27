<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const scaleOptions = [
  { value: 0.6, label: 'S' }, { value: 0.8, label: 'M' }, { value: 1.0, label: 'L' },
  { value: 1.2, label: 'XL' }, { value: 1.5, label: 'XXL' },
]
</script>

<template>
  <Card :title="t('petSize')">
    <div class="scale-options" role="group" :aria-label="t('petSize')">
      <Button
        v-for="opt in scaleOptions"
        :key="opt.value"
        size="sm"
        variant="secondary"
        :active="store.petScale === opt.value"
        @click="store.setScale(opt.value)"
      >
        {{ opt.label }}
      </Button>
    </div>
  </Card>

  <Card :title="t('petReactions')">
    <ToggleRow :model-value="store.reactionsEnabled" :label="t('bounceShake')" :help="t('animateStatus')" @update:model-value="store.setReactionsEnabled($event)" />
    <ToggleRow :model-value="store.bubbleEnabled" :label="t('statusBubble')" :help="t('showCompletionError')" @update:model-value="store.setBubbleEnabled($event)" />
  </Card>
</template>
