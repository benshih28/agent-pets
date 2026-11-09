<script setup lang="ts">
import { computed } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import { te, type ThemeEditorKey } from '@/utils/theme-editor-i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import NumberField from '@/components/ui/NumberField.vue'
import Select from '@/components/ui/Select.vue'
import PanelThemeColorField, { type ColorFieldIssue } from '@/components/panel-theme/PanelThemeColorField.vue'
import PanelThemeImageControls from '@/components/panel-theme/PanelThemeImageControls.vue'
import { PANEL_THEME_FITS, PANEL_THEME_POSITIONS, type PanelThemeCatalogEntry, type PanelThemeFit, type PanelThemeMode, type PanelThemePosition } from '@/types/panel-theme'
import type { UserPanelThemeModeDefinition } from '@/types/panel-theme-user'

// 主題編輯器的「背景」區塊（一個模式）：純色（背景色）、線性或放射漸層（2–5 個色標），
// 或使用者自己的背景圖（遮罩色、預設遮罩不低於計算出的最小值、填滿方式）。圖片本身沿用
// 主機的匯入流程：主題存檔後才有地方放，選圖、位置、模糊與遮罩由 PanelThemeImageControls 處理。

type BackgroundKind = 'solid' | 'linear' | 'radial' | 'image'

const props = defineProps<{
  mode: PanelThemeMode
  definition: UserPanelThemeModeDefinition
  issues: readonly ColorFieldIssue[]
  minDim: number | null
  savedEntry: PanelThemeCatalogEntry | null
  busy: boolean
}>()
const emit = defineEmits<{ change: [next: UserPanelThemeModeDefinition]; fix: [path: string, value: string | number]; chooseImage: [] }>()

const KIND_LABEL: Record<BackgroundKind, ThemeEditorKey> = {
  solid: 'themeEditor.bgSolid',
  linear: 'themeEditor.bgLinear',
  radial: 'themeEditor.bgRadial',
  image: 'themeEditor.bgImage',
}
const FIT_LABEL: Record<PanelThemeFit, TranslationKey> = {
  cover: 'design.panelTheme.image.fitCover', contain: 'design.panelTheme.image.fitContain', tile: 'design.panelTheme.image.fitTile',
}
const POSITION_LABEL: Record<PanelThemePosition, TranslationKey> = {
  center: 'design.panelTheme.image.positionCenter', top: 'design.panelTheme.image.positionTop', bottom: 'design.panelTheme.image.positionBottom',
  left: 'design.panelTheme.image.positionLeft', right: 'design.panelTheme.image.positionRight',
  'top-left': 'design.panelTheme.image.positionTopLeft', 'top-right': 'design.panelTheme.image.positionTopRight',
  'bottom-left': 'design.panelTheme.image.positionBottomLeft', 'bottom-right': 'design.panelTheme.image.positionBottomRight',
}
const MAX_STOPS = 5
const MIN_STOPS = 2

const kind = computed<BackgroundKind>(() => {
  if (props.definition.image) return 'image'
  return props.definition.background.type === 'gradient' ? props.definition.background.kind : 'solid'
})
const stops = computed(() => (props.definition.background.type === 'gradient' ? props.definition.background.stops : []))
const savedImage = computed(() => props.savedEntry?.modes[props.mode]?.userImage ?? null)

function emitWith(mutate: (next: UserPanelThemeModeDefinition) => void): void {
  const next = structuredClone(props.definition)
  mutate(next)
  emit('change', next)
}

const KIND_BUILDERS: Record<BackgroundKind, (next: UserPanelThemeModeDefinition) => void> = {
  solid: next => {
    next.background = { type: 'solid' }
    next.image = null
  },
  linear: next => {
    next.background = { type: 'gradient', kind: 'linear', angle: 180, stops: defaultStops(next) }
    next.image = null
  },
  radial: next => {
    next.background = { type: 'gradient', kind: 'radial', position: 'center', stops: defaultStops(next) }
    next.image = null
  },
  image: next => {
    next.background = { type: 'solid' }
    next.image = { fit: 'cover', overlayColor: next.colors.bg, dim: 0.9 }
  },
}

/** 換成漸層時保留原本的色標，沒有時從背景色漸到表面色。 */
function defaultStops(next: UserPanelThemeModeDefinition) {
  return stops.value.length >= MIN_STOPS ? structuredClone(stops.value) : [{ color: next.colors.bg, at: 0 }, { color: next.colors.surface, at: 100 }]
}

function setKind(value: string): void {
  const builder = KIND_BUILDERS[value as BackgroundKind]
  if (builder && value !== kind.value) emitWith(builder)
}

function setStop(index: number, patch: { color?: string; at?: number }): void {
  emitWith(next => {
    if (next.background.type !== 'gradient') return
    Object.assign(next.background.stops[index]!, patch)
    // 位置不能遞減：改了一個色標的位置後依位置重新排序。
    next.background.stops.sort((first, second) => first.at - second.at)
  })
}

function addStop(): void {
  emitWith(next => {
    if (next.background.type !== 'gradient' || next.background.stops.length >= MAX_STOPS) return
    const last = next.background.stops.at(-1)!
    next.background.stops.push({ color: last.color, at: 100 })
  })
}

function removeStop(index: number): void {
  emitWith(next => {
    if (next.background.type === 'gradient' && next.background.stops.length > MIN_STOPS) next.background.stops.splice(index, 1)
  })
}

function setAngle(value: number): void {
  emitWith(next => { if (next.background.type === 'gradient' && next.background.kind === 'linear') next.background.angle = Math.round(value) })
}

function setPosition(value: string): void {
  emitWith(next => { if (next.background.type === 'gradient' && next.background.kind === 'radial') next.background.position = value as PanelThemePosition })
}

function setImage(patch: Partial<NonNullable<UserPanelThemeModeDefinition['image']>>): void {
  emitWith(next => { if (next.image) Object.assign(next.image, patch) })
}
</script>

<template>
  <section class="editor-section" aria-labelledby="editor-background-title">
    <h3 id="editor-background-title" class="editor-section-title">{{ te('themeEditor.background') }}</h3>
    <label class="editor-field">
      <span class="editor-field-label">{{ te('themeEditor.backgroundType') }}</span>
      <Select :model-value="kind" :aria-label="te('themeEditor.backgroundType')" data-testid="editor-background-type" @update:model-value="setKind">
        <option v-for="(label, value) in KIND_LABEL" :key="value" :value="value">{{ te(label) }}</option>
      </Select>
    </label>

    <template v-if="definition.background.type === 'gradient'">
      <NumberField
        v-if="definition.background.kind === 'linear'"
        :model-value="definition.background.angle"
        :label="te('themeEditor.angle')"
        :min="0"
        :max="359"
        @commit="setAngle"
      />
      <label v-else class="editor-field">
        <span class="editor-field-label">{{ te('themeEditor.radialPosition') }}</span>
        <Select :model-value="definition.background.position" :aria-label="te('themeEditor.radialPosition')" @update:model-value="setPosition">
          <option v-for="position in PANEL_THEME_POSITIONS" :key="position" :value="position">{{ t(POSITION_LABEL[position]) }}</option>
        </Select>
      </label>
      <fieldset class="editor-group">
        <legend class="editor-group-title">{{ te('themeEditor.stops') }}</legend>
        <div v-for="(stop, index) in stops" :key="index" class="stop-row">
          <PanelThemeColorField
            class="stop-color"
            :label="te('themeEditor.stopColor', { index: index + 1 })"
            :usage="te('themeEditor.stops')"
            :value="stop.color"
            :issues="[]"
            :test-id="`stop-${index}`"
            @update="value => setStop(index, { color: value })"
          />
          <NumberField :model-value="stop.at" :label="te('themeEditor.stopAt', { index: index + 1 })" :min="0" :max="100" hide-label @commit="value => setStop(index, { at: Math.round(value) })" />
          <Button size="sm" variant="ghost" icon-only :disabled="stops.length <= MIN_STOPS" :aria-label="te('themeEditor.removeStop', { index: index + 1 })" @click="removeStop(index)">
            <Icon name="close" :size="14" />
          </Button>
        </div>
        <Button size="sm" variant="secondary" :disabled="stops.length >= MAX_STOPS" @click="addStop">{{ te('themeEditor.addStop') }}</Button>
      </fieldset>
    </template>

    <template v-if="definition.image">
      <p class="editor-help">{{ te('themeEditor.imageHelp') }}</p>
      <PanelThemeColorField
        :label="te('themeEditor.overlayColor')"
        :usage="te('themeEditor.overlayColor')"
        :value="definition.image.overlayColor"
        :issues="[]"
        test-id="overlay"
        @update="value => setImage({ overlayColor: value.replace(/\/ [\d.]+\)$/, '/ 1)') })"
      />
      <NumberField
        :model-value="definition.image.dim"
        :label="te('themeEditor.defaultDim')"
        :min="0.5"
        :max="0.95"
        :step="0.01"
        :help="minDim === null ? undefined : te('themeEditor.minDim', { percent: Math.round(minDim * 100) })"
        @commit="value => setImage({ dim: Math.round(value * 100) / 100 })"
      />
      <ul v-if="issues.length" class="editor-issues">
        <li v-for="(issue, index) in issues" :key="index" class="editor-issue">
          <span>{{ issue.text }}</span>
          <Button v-if="issue.fix" size="sm" variant="secondary" :aria-label="issue.fix.label" data-testid="use-suggested-dim" @click="emit('fix', issue.fix.path, issue.fix.value)">{{ te('themeEditor.useSuggested') }}</Button>
        </li>
      </ul>
      <label class="editor-field">
        <span class="editor-field-label">{{ t('design.panelTheme.image.fit') }}</span>
        <Select :model-value="definition.image.fit" :aria-label="t('design.panelTheme.image.fit')" @update:model-value="value => setImage({ fit: value as PanelThemeFit })">
          <option v-for="fit in PANEL_THEME_FITS" :key="fit" :value="fit">{{ t(FIT_LABEL[fit]) }}</option>
        </Select>
      </label>
      <PanelThemeImageControls v-if="savedEntry && savedImage" :theme-ref="savedEntry.ref" :mode="mode" :user-image="savedImage" />
      <Button v-else size="sm" variant="secondary" :disabled="busy" data-testid="editor-choose-image" @click="emit('chooseImage')">{{ t('design.panelTheme.image.choose') }}</Button>
    </template>
  </section>
</template>

<style scoped src="@/components/panel-theme/PanelThemeEditorSections.css"></style>
<style scoped>
.stop-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5em auto;
  align-items: center;
  gap: var(--space-2);
}

.stop-color {
  min-width: 0;
}
</style>
