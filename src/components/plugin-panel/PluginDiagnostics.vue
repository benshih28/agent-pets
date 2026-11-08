<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import Select from '@/components/ui/Select.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginBrokerLogEntry } from '@/types/plugin'

const {
  logs, diagnostics, selectedPluginId, refreshDiagnostics, diagnosticTime, diagnosticCodeLabel, diagnosticTechnical, setStatus,
} = usePluginController()

type LevelFilter = 'all' | 'error' | 'warn'
const level = ref<LevelFilter>('all')
const showAll = ref(false)
const SUMMARY_COUNT = 3

const filteredLogs = computed(() => logs.value.filter(entry => level.value === 'all' || entry.level === level.value))
const shownLogs = computed(() => (showAll.value ? filteredLogs.value : filteredLogs.value.slice(-SUMMARY_COUNT)))
const shownDiagnostics = computed(() => (showAll.value ? diagnostics.value : diagnostics.value.slice(-SUMMARY_COUNT)))
const hiddenCount = computed(() => filteredLogs.value.length - shownLogs.value.length + diagnostics.value.length - shownDiagnostics.value.length)

const levelTone = { error: 'danger', warn: 'warn', info: 'neutral' } as const
const levelKey = { error: 'plugins.levelError', warn: 'plugins.levelWarn', info: 'plugins.levelInfo' } as const
const levelIcon = { error: 'warning', warn: 'warning', info: 'info' } as const

function line(entry: PluginBrokerLogEntry): string {
  return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.message}`
}

async function copy(): Promise<void> {
  const text = [
    ...logs.value.map(line),
    ...diagnostics.value.map(entry => `${new Date(entry.at).toISOString()} [rejected] ${entry.code} ${entry.method ?? ''}`.trim()),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    setStatus(t('plugins.diagnosticsCopied'))
  } catch {
    setStatus(t('plugins.diagnosticsCopyFailed'))
  }
}
</script>

<template>
  <section class="diagnostics" :aria-label="t('pluginDiagnosticsHeading')">
    <p class="help">{{ t('pluginDiagnosticsHelp') }}</p>
    <div class="toolbar">
      <Select v-model="level" size="sm" :aria-label="t('plugins.levelFilter')">
        <option value="all">{{ t('plugins.levelAll') }}</option>
        <option value="error">{{ t('plugins.levelError') }}</option>
        <option value="warn">{{ t('plugins.levelWarn') }}</option>
      </Select>
      <span class="spacer" />
      <Button variant="secondary" size="sm" :disabled="logs.length + diagnostics.length === 0" @click="copy">{{ t('plugins.copyDiagnostics') }}</Button>
      <Button variant="secondary" size="sm" @click="refreshDiagnostics(selectedPluginId)">{{ t('refresh') }}</Button>
    </div>
    <h4 class="subheading">{{ t('pluginRecentLogs') }} <span class="note">{{ t('plugins.providedByPlugin') }}</span></h4>
    <p v-if="shownLogs.length === 0" class="empty">{{ t('pluginNoLogs') }}</p>
    <ul v-else class="entries">
      <li v-for="(entry, index) in shownLogs" :key="`${entry.at}-${index}`">
        <time>{{ diagnosticTime(entry.at) }}</time>
        <Chip :tone="levelTone[entry.level]" :icon="levelIcon[entry.level]">{{ t(levelKey[entry.level]) }}</Chip>
        <span class="message">{{ entry.message }}</span>
      </li>
    </ul>
    <h4 class="subheading">{{ t('pluginRejectedCalls') }}</h4>
    <p v-if="shownDiagnostics.length === 0" class="empty">{{ t('pluginNoDiagnostics') }}</p>
    <ul v-else class="entries">
      <li v-for="(entry, index) in shownDiagnostics" :key="`${entry.at}-${index}`">
        <time>{{ diagnosticTime(entry.at) }}</time>
        <span class="message">{{ diagnosticCodeLabel(entry) }}</span>
        <code class="technical" :title="t('plugins.technicalDetails')">{{ diagnosticTechnical(entry) }}</code>
      </li>
    </ul>
    <Button v-if="hiddenCount > 0 || showAll" variant="ghost" size="sm" class="toggle" :aria-expanded="showAll" @click="showAll = !showAll">
      {{ showAll ? t('plugins.showRecentOnly') : t('plugins.showAllEntries', { count: hiddenCount }) }}
    </Button>
  </section>
</template>

<style scoped>
.diagnostics {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.help,
.empty,
.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.note {
  font-weight: var(--weight-normal);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.spacer {
  flex: 1 1 auto;
}

.subheading {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.entries {
  max-height: 240px;
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  list-style: none;
}

.entries li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-xs);
}

.entries li:last-child {
  border-bottom: 0;
}

time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.technical {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.message {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.toggle {
  align-self: flex-start;
}
</style>
