<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { te } from '@/utils/theme-editor-i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import NumberField from '@/components/ui/NumberField.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import { colorAlpha, colorFromHex, colorFromOklch, colorToHex, colorToOklch, parseColorInput, type OklchValue } from '@/utils/panel-theme-editor'

// 主題編輯器的一個顏色鍵：原生取色器、可輸入 #hex／rgb()／hsl()／oklch() 的文字欄位、
// 說明這個鍵用在哪裡的提示，以及可展開的 OKLCH 明度／彩度／色相微調。驗證問題由父層傳入，
// 每個問題可一鍵「使用建議值」。值一律是主機標準的 rgb() 字串。

export interface ColorFieldIssue {
  text: string
  fix: { path: string; value: string | number; label: string } | null
}

const props = defineProps<{
  label: string
  usage: string
  value: string
  issues: readonly ColorFieldIssue[]
  testId: string
}>()
const emit = defineEmits<{ update: [value: string]; fix: [path: string, value: string | number] }>()

const uid = useId()
const issuesId = `${uid}-issues`
const fineTuneId = `${uid}-fine`
const text = ref(props.value)
const textError = ref('')
const fineTuneOpen = ref(false)
const oklch = ref<OklchValue>(colorToOklch(props.value))

watch(() => props.value, value => {
  text.value = value
  textError.value = ''
  oklch.value = colorToOklch(value)
})

const hex = computed(() => colorToHex(props.value))
/** 背景色同時是表面也是背景，同一句話會出現兩次：只列一次。 */
const issueTexts = computed(() => [...new Set(props.issues.map(issue => issue.text))])
/** 同一個鍵的多個問題通常共用同一個建議值：每個不同的修正只顯示一個按鈕。 */
const fixes = computed(() => {
  const seen = new Map<string, NonNullable<ColorFieldIssue['fix']>>()
  for (const issue of props.issues) if (issue.fix) seen.set(`${issue.fix.path}\u0000${issue.fix.value}`, issue.fix)
  return [...seen.values()]
})
const alphaText = computed(() => {
  const alpha = colorAlpha(props.value)
  return alpha < 1 ? `${Math.round(alpha * 100)}%` : ''
})

function commitText(): void {
  const parsed = parseColorInput(text.value)
  if (!parsed) {
    textError.value = te('themeEditor.invalidColor')
    return
  }
  textError.value = ''
  if (parsed !== props.value) emit('update', parsed)
}

function onPicker(event: Event): void {
  const next = colorFromHex((event.target as HTMLInputElement).value, props.value)
  if (next && next !== props.value) emit('update', next)
}

function commitOklch(): void {
  const next = colorFromOklch(oklch.value, props.value)
  if (next !== props.value) emit('update', next)
}
</script>

<template>
  <div class="color-field" :class="{ invalid: issues.length > 0 }" :data-testid="`color-field-${testId}`">
    <div class="color-row">
      <input
        class="color-swatch"
        type="color"
        :value="hex"
        :aria-label="te('themeEditor.colorPicker', { key: label })"
        :data-testid="`color-picker-${testId}`"
        @change="onPicker"
      />
      <span class="color-name">
        <span class="color-label">{{ label }}</span>
        <span v-if="alphaText" class="color-alpha">{{ alphaText }}</span>
      </span>
      <Tooltip :text="usage">
        <button type="button" class="color-usage" :aria-label="te('themeEditor.usageButton', { key: label })">
          <Icon name="info" :size="14" />
        </button>
      </Tooltip>
      <input
        v-model="text"
        class="color-text"
        type="text"
        spellcheck="false"
        autocomplete="off"
        maxlength="64"
        :aria-label="te('themeEditor.colorValue', { key: label })"
        :aria-invalid="Boolean(textError) || issues.length > 0"
        :aria-describedby="issues.length || textError ? issuesId : undefined"
        :data-testid="`color-text-${testId}`"
        @change="commitText"
        @keydown.enter.prevent="commitText"
      />
      <Button
        variant="ghost"
        size="sm"
        icon-only
        :aria-label="te('themeEditor.fineTune', { key: label })"
        :aria-expanded="fineTuneOpen"
        :aria-controls="fineTuneId"
        @click="fineTuneOpen = !fineTuneOpen"
      >
        <Icon name="settings" :size="14" />
      </Button>
    </div>
    <div v-if="fineTuneOpen" :id="fineTuneId" class="color-fine">
      <NumberField v-model="oklch.l" :label="te('themeEditor.lightness')" :min="0" :max="1" :step="0.01" @commit="commitOklch" />
      <NumberField v-model="oklch.c" :label="te('themeEditor.chroma')" :min="0" :max="0.4" :step="0.005" @commit="commitOklch" />
      <NumberField v-model="oklch.h" :label="te('themeEditor.hue')" :min="0" :max="360" :step="1" @commit="commitOklch" />
    </div>
    <div v-if="issues.length || textError" :id="issuesId" class="color-issues">
      <p v-if="textError" class="color-issue" role="alert">{{ textError }}</p>
      <ul v-if="issueTexts.length" class="color-issue-list">
        <li v-for="text in issueTexts" :key="text" class="color-issue">{{ text }}</li>
      </ul>
      <div v-if="fixes.length" class="color-fixes">
        <Button
          v-for="fix in fixes"
          :key="`${fix.path}-${fix.value}`"
          size="sm"
          variant="secondary"
          :aria-label="fix.label"
          :data-testid="`use-suggested-${testId}`"
          @click="emit('fix', fix.path, fix.value)"
        >
          {{ te('themeEditor.useSuggested') }}
          <span class="color-fix-value">{{ fix.value }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1) 0;
}

.color-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.color-swatch {
  width: var(--hit-min);
  height: var(--hit-min);
  flex: none;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  cursor: pointer;
}

.color-swatch:focus-visible,
.color-usage:focus-visible,
.color-text:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.color-name {
  display: flex;
  min-width: 0;
  flex: 1 1 8em;
  align-items: baseline;
  gap: var(--space-1);
}

.color-label {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-alpha {
  flex: none;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.color-usage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: help;
}

.color-usage:hover {
  background: var(--color-hover);
  color: var(--text-primary);
}

.color-text {
  width: 11.5em;
  min-width: 0;
  flex: 0 1 11.5em;
  height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
}

.invalid .color-text {
  border-color: var(--text-danger);
}

.color-fine {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding-left: calc(var(--hit-min) + var(--space-2));
}

.color-issues {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-left: calc(var(--hit-min) + var(--space-2));
}

.color-issue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.color-issue {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.color-fixes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* 數值和輸入框一樣用內文字體的一般字重，與按鈕標籤的「使用建議值」區分。 */
.color-fix-value {
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-normal);
}

/* 區塊寬度放不下「名稱 + 完整的 rgb(255 255 255 / 0.18)」時（預設 460 px 與 360 px 寬的面板都是）：
   顏色文字欄位換到自己的一行並佔滿寬度，值才讀得完整；OKLCH 微調改為一欄。 */
@container (width < 26rem) {
  .color-row {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  .color-text {
    order: 1;
    width: auto;
    flex: 1 1 calc(100% - var(--hit-min) - var(--space-2));
    margin-left: calc(var(--hit-min) + var(--space-2));
  }

  .color-fine {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (forced-colors: active) {
  .invalid .color-text {
    border-color: Mark;
  }
}
</style>
