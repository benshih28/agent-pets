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

<style scoped src="@/components/growth/HistoryChart.css"></style>
