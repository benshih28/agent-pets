<script setup lang="ts">
import PluginPanel from '@/components/PluginPanel.vue'

defineProps<{ requestedPluginId: string }>()
</script>

<template>
  <PluginPanel :requested-plugin-id="requestedPluginId" />
</template>
