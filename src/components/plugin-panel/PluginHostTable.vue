<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginPanelPlugin } from '@/types/plugin'

const props = defineProps<{ plugin: PluginPanelPlugin }>()
const { busy, revokeGrantedHost } = usePluginController()

// One row per network host: what the plugin declares and whether the user has
// allowed it yet. Hosts granted but no longer declared stay visible so they
// can still be revoked.
const rows = computed(() => {
  const declared = props.plugin.manifest?.permissions.network?.hosts ?? []
  const granted = props.plugin.preference.grantedHosts
  const hosts = [...new Set([...declared, ...granted])]
  return hosts.map(host => ({ host, declared: declared.includes(host), granted: granted.includes(host) }))
})
</script>

<template>
  <div class="host-table">
    <p v-if="rows.length === 0" class="host-empty">{{ t('pluginGrantedHostsEmpty') }}</p>
    <table v-else>
      <caption class="sr-only">{{ t('plugins.hostTableCaption') }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ t('plugins.hostColumnDomain') }}</th>
          <th scope="col">{{ t('plugins.hostColumnDeclared') }}</th>
          <th scope="col">{{ t('plugins.hostColumnStatus') }}</th>
          <th scope="col"><span class="sr-only">{{ t('pluginRevokeHost') }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.host">
          <td><code>{{ row.host }}</code></td>
          <td>{{ row.declared ? t('plugins.hostDeclaredYes') : t('plugins.hostDeclaredNo') }}</td>
          <td>
            <Chip :tone="row.granted ? 'success' : 'neutral'" :icon="row.granted ? 'check' : undefined">
              {{ row.granted ? t('plugins.hostAllowed') : t('plugins.hostAsk') }}
            </Chip>
          </td>
          <td class="cell-action">
            <Button
              v-if="row.granted"
              variant="ghost"
              size="sm"
              :disabled="busy"
              :aria-label="t('plugins.revokeHostNamed', { host: row.host })"
              @click="revokeGrantedHost(plugin, row.host)"
            >
              {{ t('pluginRevokeHost') }}
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="host-help">{{ t('plugins.hostHelp') }}</p>
  </div>
</template>

<style scoped>
.host-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-xs);
}

th {
  padding: var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-weight: var(--weight-medium);
  text-align: left;
}

td {
  padding: var(--space-1) var(--space-2);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

code {
  overflow-wrap: anywhere;
  color: var(--text-primary);
}

.cell-action {
  text-align: right;
}

.host-empty,
.host-help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
