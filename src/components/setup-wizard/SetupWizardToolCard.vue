<script setup lang="ts">
// 設定精靈裡單一工具的卡片：健康狀態、動作按鈕、能力矩陣、安裝／測試／診斷結果。
// 所有狀態都由父層持有（工具清單會在重新偵測後保留結果），這裡只依 props 渲染並發出事件。
import { computed } from 'vue'
import { locale, t } from '@/i18n'
import { SOURCE_LABELS } from '@/types/agent'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import { formatTimeFull } from '@/utils/intl-format'
import {
  buildConfigDirNotes,
  capabilityRows,
  checkFix,
  checkText,
  healthLabel,
  outcomeText,
  RESTART_KEYS,
  summaryText,
  type ToolStatus,
} from '@/components/setup-wizard/setup-wizard-text'

const props = defineProps<{
  tool: ToolStatus
  /** 動作按鈕的文字（安裝／修復／重新安裝）。 */
  actionLabel: string
  /** 任一工具正在安裝、測試或診斷。 */
  busy: boolean
  /** 任一工具正在移除；移除中連安裝與等待都停用。 */
  removingAny: boolean
  removing: boolean
  testing: boolean
  diagnosing: boolean
  waiting: boolean
  waitRemainingMs: number
}>()

defineEmits<{
  install: []
  remove: []
  test: []
  diagnose: []
  'toggle-wait': []
}>()

// 每個卡片各自記憶；切換語系時 t() 會讓它們重算。
const capabilities = computed(() => capabilityRows(props.tool))
const configDirNotes = computed(() => buildConfigDirNotes(props.tool))
const diagnosisRows = computed(() => (props.tool.diagnosis?.checks ?? []).map(check => ({
  id: check.id,
  status: check.status,
  icon: check.status === 'pass' ? 'check' : check.status === 'warn' ? 'warning' : 'close',
  text: checkText(check),
  fix: checkFix(check),
})))
</script>

<template>
  <Card
    class="tool-item"
    :class="[`health-${tool.health}`, { connected: tool.health === 'ready', detected: tool.health !== 'ready' && tool.health !== 'error' }]"
    :tone="tool.health === 'ready' ? 'success' : tool.health === 'needs_install' ? 'accent' : 'neutral'"
  >
    <div class="tool-status">
      <span class="status-dot" :class="{ green: tool.health === 'ready', yellow: tool.health !== 'ready' && tool.health !== 'error', red: tool.health === 'error' }" />
      <span class="tool-name">{{ tool.displayName }}</span>
      <span class="tool-health">{{ healthLabel(tool) }}</span>
      <div class="tool-actions">
        <Button
          variant="secondary"
          size="sm"
          class="tool-action test-btn"
          v-if="tool.installable"
          :disabled="busy || removingAny"
          :title="t('onboarding.waitRealTitle')"
          @click="$emit('toggle-wait')"
        >
          {{ waiting ? t('cancel') : t('onboarding.waitReal') }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="tool-action test-btn"
          v-if="tool.testSource"
          :disabled="busy"
          :title="t('onboarding.testReceiverTitle')"
          @click="$emit('test')"
        >
          {{ testing ? t('testing') : t('onboarding.testReceiver') }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="tool-action test-btn"
          :disabled="busy"
          @click="$emit('diagnose')"
        >
          {{ diagnosing ? t('diagnosing') : t('diagnose') }}
        </Button>
        <Button
          :variant="tool.health === 'ready' ? 'secondary' : 'primary'"
          size="sm"
          class="tool-action install-action install-btn"
          v-if="tool.installable && tool.installTarget"
          :disabled="busy || removingAny"
          @click="$emit('install')"
        >
          {{ actionLabel }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="tool-action remove-btn"
          v-if="tool.installable && (tool.installed || tool.health === 'degraded')"
          :disabled="busy || removingAny"
          @click="$emit('remove')"
        >
          {{ removing ? t('removing') : t('remove') }}
        </Button>
      </div>
    </div>
    <div class="tool-desc">{{ summaryText(tool) }}</div>
    <div class="source-list">
      <span v-for="source in tool.sourceLabels" :key="source" class="source-chip">{{ source }}</span>
    </div>
    <p
      v-for="note in configDirNotes"
      :key="note.key"
      class="config-dir-note"
      :class="{ warn: note.warn }"
    >
      <Icon v-if="note.warn" name="warning" :size="13" />
      <span>{{ note.text }}</span>
    </p>
    <ul class="capability-list" :aria-label="t('onboarding.capTitle')">
      <li v-for="row in capabilities" :key="row.id" :class="row.supported ? 'cap-yes' : 'cap-no'">
        <Icon :name="row.supported ? 'check' : 'close'" :size="13" />
        <span>{{ row.label }}</span>
        <span class="visually-hidden">{{ row.supported ? t('onboarding.capSupported') : t('onboarding.capUnsupported') }}</span>
      </li>
    </ul>
    <div
      v-if="tool.outcome"
      class="test-result"
      :class="tool.outcome.action === 'failed' ? 'failed' : 'passed'"
      :role="tool.outcome.action === 'failed' ? 'alert' : 'status'"
    >
      {{ outcomeText(tool.outcome) }}
      <template v-if="tool.outcome.backupPaths.length">
        {{ t('onboarding.backupMade', { path: tool.outcome.backupPaths[0] ?? '' }) }}
      </template>
      <template v-if="tool.outcome.action === 'installed' || tool.outcome.action === 'repaired'">
        {{ t(RESTART_KEYS[tool.id]) }}
      </template>
    </div>
    <div v-if="waiting" class="test-result" role="status">
      {{ t('onboarding.waitingReal', { name: tool.displayName, seconds: Math.ceil(waitRemainingMs / 1000) }) }}
    </div>
    <div v-else-if="tool.realEvent" class="test-result passed" role="status">
      {{ t('onboarding.realEventOk', { source: SOURCE_LABELS[tool.realEvent.source], time: formatTimeFull(tool.realEvent.at, locale) }) }}
    </div>
    <div v-else-if="tool.realEventTimedOut" class="test-result failed" role="alert">
      {{ t('onboarding.realEventTimeout', { name: tool.displayName }) }}
    </div>
    <div v-if="tool.verifiedAt" class="test-result passed">
      {{ t('receiverVerifiedAt', { time: formatTimeFull(tool.verifiedAt, locale) }) }}
    </div>
    <div v-else-if="tool.testError" class="test-result failed">{{ tool.testError }}</div>
    <div v-if="tool.diagnosis" class="diagnosis-list">
      <div v-for="check in diagnosisRows" :key="check.id" class="diagnosis-row" :class="`diagnosis-${check.status}`">
        <Icon :name="check.icon" :size="14" />
        <span>{{ check.text }}<template v-if="check.fix"> {{ check.fix }}</template></span>
      </div>
    </div>
  </Card>
</template>

<style scoped src="@/components/setup-wizard/SetupWizardToolCard.css"></style>
