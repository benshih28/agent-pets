<script setup lang="ts">
// 寵物下方的單條狀態列：狀態點、名稱／狀態字、插件徽章、額度百分比、額度提示框與額度條。
// 單寵物與多寵物（每個家族一個）共用同一個模板；差異只在外層 class（multi-pet-status-line）。
// data-pet-hit-target 與 DOM 階層是點擊穿透命中測試的依據，不要改動。
import { computed } from 'vue'
import type { AgentState } from '@/types/agent'
import { tPlural } from '@/i18n'
import type { PluginBadgeView } from '@/types/plugin'
import { AGENT_STATE_PRESENTATION, stateLineLabel } from '@/utils/agent-state-presentation'
import type { StatusLineView } from '@/composables/usePetStatusLines'

const props = defineProps<{
  line: { label: string; state: AgentState }
  view: StatusLineView
  badgesVisible: boolean
  /** 額度動畫（光澤、危急警示）；對應「動態效果」偏好。 */
  motion: boolean
  draining: boolean
  badgeTooltip: (badge: PluginBadgeView) => string
}>()

const stateColor = computed(() => AGENT_STATE_PRESENTATION[props.line.state].color)
</script>

<template>
  <div
    class="status-line"
    role="group"
    :class="{
      'has-quota': view.quota,
      'quota-motion': motion,
      'quota-critical': motion && (view.quota?.remainingPercent ?? 100) < 10,
      'quota-drain': motion && draining,
    }"
    :data-quota-tier="view.quota?.tier"
    :aria-label="view.aria"
    :title="view.quota ? undefined : view.title"
    :tabindex="view.quota ? 0 : undefined"
    data-pet-hit-target="solid"
  >
    <span class="line-dot" :class="`dot-${line.state}`" :style="{ background: stateColor, color: stateColor }" />
    <span v-if="line.label && view.fit.showLabel" class="line-text">
      <span class="line-label">{{ line.label }}</span>
      <span class="line-sep">·</span>
    </span>
    <span class="line-state">{{ stateLineLabel(line.state) }}</span>
    <span v-if="badgesVisible" class="plugin-status-badges">
      <template v-for="badge in view.badges" :key="badge.pluginId">
        <span class="plugin-badge-anchor" tabindex="0" :aria-label="badgeTooltip(badge)">
          <span class="plugin-badge-pill" :class="`tone-${badge.tone}`">{{ badge.text }}</span>
          <span class="plugin-badge-tooltip" role="tooltip">{{ badgeTooltip(badge) }}</span>
        </span>
      </template>
      <span
        v-if="view.overflowCount > 0"
        class="plugin-badge-pill plugin-badge-overflow"
        :aria-label="tPlural('pluginBadgeOverflow', view.overflowCount)"
      >+{{ view.overflowCount }}</span>
    </span>
    <span v-if="view.quota && view.fit.showReadout" class="quota-readout">
      {{ view.quota.percent }}%
    </span>
    <span v-if="view.quota" class="quota-tooltip" role="tooltip">
      <span v-if="line.label" class="quota-tooltip-line">{{ view.text }}</span>
      <span
        v-for="row in view.quota.rows"
        :key="row.id"
        class="quota-tooltip-row"
      >
        <span class="quota-tooltip-summary">
          <strong>{{ row.label }}</strong>
          <strong class="quota-tooltip-percent">{{ row.percentText }}</strong>
        </span>
        <span class="quota-tooltip-reset">{{ row.resetLabel }}</span>
      </span>
    </span>
    <span
      v-if="view.quota"
      class="quota-meter"
      role="progressbar"
      :aria-label="view.quota.meterLabel"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="view.quota.remainingPercent"
    >
      <span class="quota-meter-fill" :style="{ width: view.quota.fillWidth }" />
    </span>
  </div>
</template>

<style scoped src="@/components/desktop-pet/PetStatusLine.css"></style>
