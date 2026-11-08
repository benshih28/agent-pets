<script setup lang="ts">
import PluginPanel from '@/components/PluginPanel.vue'

defineProps<{ requestedPluginId: string; requestNonce?: number }>()
</script>

<template>
  <PluginPanel :requested-plugin-id="requestedPluginId" :request-nonce="requestNonce" />
</template>
