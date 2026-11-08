<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, t } from '@/i18n'
import { useHistoryFormat } from '@/composables/useHistoryFormat'
import type { HistoryDailyStat } from '@/types/history'
import { niceCeiling } from '@/utils/token-format'
import { axisLabelParts, axisLabelVisible, dayLabel } from '@/utils/history-axis'

const props = defineProps<{ days: HistoryDailyStat[]; todayKey: string; weekdayLabels: boolean }>()
const { tokens, duration } = useHistoryFormat()
const activeDay = ref<string | null>(null)

const maxTokens = computed(() => niceCeiling(Math.max(1, ...props.days.map(day => day.tokenInput + day.tokenOutput))))
const gridLines = computed(() => [1, 0.5].map(fraction => ({
  fraction,
  label: tokens(Math.round(maxTokens.value * fraction)),
})))
// About seven axis labels whatever the range.
const labelStep = computed(() => Math.max(1, Math.ceil(props.days.length / 7)))

function dateLabel(day: HistoryDailyStat, withWeekday: boolean): string {
  return dayLabel(day.localDate, withWeekday, locale.value)
}

function total(day: HistoryDailyStat): number {
  return day.tokenInput + day.tokenOutput
}

function hasActivity(day: HistoryDailyStat): boolean {
  return total(day) + day.sessionsCompleted + day.sessionsFailed + day.activeMs > 0
}

function segmentHeight(value: number): string {
  return `${Math.min(100, (value / maxTokens.value) * 100)}%`
}

// 依 days 與語系預先算好；hover 只改 activeDay，不該重新格式化每一根長條的標籤。
const barAriaLabels = computed(() => props.days.map(day => t('growth.barAria', {
  date: dateLabel(day, true),
  tokens: tokens(total(day), 'full'),
  completed: day.sessionsCompleted,
  failed: day.sessionsFailed,
})))

const axisLabels = computed(() => props.days.map((day, index) => (
  axisLabelVisible(index, props.days.length, labelStep.value)
    ? axisLabelParts(day.localDate, props.weekdayLabels, locale.value)
    : null
)))

const detail = computed(() => {
  const day = props.days.find(entry => entry.localDate === activeDay.value)
  if (!day) return t('growth.detailDefault')
  if (!hasActivity(day)) return `${dateLabel(day, true)} · ${t('growth.noActivityDay')}`
  return t('growth.detailLine', {
    date: dateLabel(day, true),
    input: tokens(day.tokenInput, 'full'),
    output: tokens(day.tokenOutput, 'full'),
    completed: day.sessionsCompleted,
    failed: day.sessionsFailed,
    active: duration(day.activeMs),
  })
})
</script>

<template>
  <div class="history-chart">
    <div class="history-legend" role="list" :aria-label="t('growth.legendLabel')">
      <span class="legend-item" role="listitem"><i class="swatch input" aria-hidden="true" />{{ t('growth.legendInput') }}</span>
      <span class="legend-item" role="listitem"><i class="swatch output" aria-hidden="true" />{{ t('growth.legendOutput') }}</span>
    </div>
    <div class="plot">
      <div class="grid" aria-hidden="true">
        <div v-for="line in gridLines" :key="line.fraction" class="grid-line" :style="{ bottom: `${line.fraction * 100}%` }">
          <span class="grid-label">{{ line.label }}</span>
        </div>
      </div>
      <div class="bars" role="group" :aria-label="t('growth.chartSummary')">
        <div
          v-for="(day, index) in days"
          :key="day.localDate"
          class="bar"
          :class="{ today: day.localDate === todayKey, idle: !hasActivity(day) }"
          tabindex="0"
          role="img"
          :aria-label="barAriaLabels[index]"
          @mouseenter="activeDay = day.localDate"
          @mouseleave="activeDay = null"
          @focus="activeDay = day.localDate"
          @blur="activeDay = null"
        >
          <div class="stack">
            <div class="segment output" :style="{ height: segmentHeight(day.tokenOutput) }" />
            <div class="segment input" :style="{ height: segmentHeight(day.tokenInput) }" />
          </div>
        </div>
      </div>
    </div>
    <div class="axis" aria-hidden="true">
      <span
        v-for="(day, index) in days"
        :key="day.localDate"
        class="axis-label"
        :class="{ today: day.localDate === todayKey }"
      ><template v-if="axisLabels[index]"
        ><span class="axis-date">{{ axisLabels[index]!.date }}</span
        ><span v-if="axisLabels[index]!.weekday" class="axis-weekday">{{ axisLabels[index]!.weekday }}</span
      ></template></span>
    </div>
    <p class="history-detail" aria-live="polite">{{ detail }}</p>
    <table class="sr-only">
      <caption>{{ t('growth.chartSummary') }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ t('growth.tableDate') }}</th>
          <th scope="col">{{ t('growth.legendInput') }}</th>
          <th scope="col">{{ t('growth.legendOutput') }}</th>
          <th scope="col">{{ t('growth.tableCompleted') }}</th>
          <th scope="col">{{ t('growth.tableFailed') }}</th>
          <th scope="col">{{ t('growth.tableActive') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="day in days" :key="day.localDate">
          <th scope="row">{{ day.localDate }}</th>
          <td>{{ day.tokenInput }}</td>
          <td>{{ day.tokenOutput }}</td>
          <td>{{ day.sessionsCompleted }}</td>
          <td>{{ day.sessionsFailed }}</td>
          <td>{{ duration(day.activeMs) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.history-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.history-legend {
  display: flex;
  gap: var(--space-4);
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
}

.swatch.input,
.segment.input {
  background: var(--accent);
}

.swatch.output,
.segment.output {
  background: var(--state-success);
}

.plot {
  position: relative;
  height: 96px;
  /* Room for the top grid label, which sits above the plot's first line. */
  margin-top: var(--space-3);
}

.grid {
  position: absolute;
  inset: 0;
}

.grid-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--border-subtle);
}

.grid-label {
  position: absolute;
  top: -1.1em;
  left: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.bars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
  border-bottom: 1px solid var(--border-strong);
}

.bar {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  align-items: flex-end;
  border-radius: var(--radius-sm);
}

.bar:hover,
.bar:focus-visible {
  background: var(--surface-raised-hover);
}

.bar:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 1px;
}

.stack {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
}

.segment {
  width: 100%;
  min-height: 0;
}

.bar.today .segment.input {
  background: var(--accent-bright);
}

/* A day with no activity keeps a dashed base so it reads as "nothing
   happened", distinct from a tiny non-zero bar. */
.bar.idle::after {
  position: absolute;
  right: 15%;
  bottom: 0;
  left: 15%;
  border-bottom: 2px dashed var(--border-strong);
  content: '';
}

.axis {
  display: flex;
  gap: 2px;
}

.axis-label {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  overflow: visible;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-tight);
  text-align: center;
  white-space: nowrap;
}

/* The 7-day view labels every column, so a label may not spill into its
   neighbour; the 30/90-day views label every few columns and may. */
.axis-label:has(.axis-weekday) {
  overflow: hidden;
}

.axis-date,
.axis-weekday {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.axis-label:not(:has(.axis-weekday)) .axis-date {
  max-width: none;
  overflow: visible;
}

.axis-label.today {
  color: var(--text-primary);
  font-weight: var(--weight-bold);
}

.history-detail {
  min-height: 2.6em;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
