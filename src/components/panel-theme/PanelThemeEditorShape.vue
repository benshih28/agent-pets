<script setup lang="ts">
import { computed } from 'vue'
import { te, type ThemeEditorKey } from '@/utils/theme-editor-i18n'
import NumberField from '@/components/ui/NumberField.vue'
import Select from '@/components/ui/Select.vue'
import { USER_PANEL_THEME_FONT_STACK_IDS, type UserPanelThemeDefinition, type UserPanelThemeFontStackId } from '@/types/panel-theme-user'

// 主題編輯器的「字體」與「圓角」區塊（兩個模式共用，與插件主題相同：切換淺色／深色只換顏色）。
// 字型只能從系統字型組合中選，使用者主題不帶字型檔。

const props = defineProps<{ definition: UserPanelThemeDefinition }>()
const emit = defineEmits<{ change: [next: Pick<UserPanelThemeDefinition, 'typography' | 'shape'>] }>()

const FONT_LABEL: Record<UserPanelThemeFontStackId, ThemeEditorKey> = {
  builtin: 'themeEditor.font.builtin',
  system: 'themeEditor.font.system',
  rounded: 'themeEditor.font.rounded',
  humanist: 'themeEditor.font.humanist',
  serif: 'themeEditor.font.serif',
  mono: 'themeEditor.font.mono',
}
const RADII = [
  { key: 'radiusSm', label: 'themeEditor.radiusSm', max: 16 },
  { key: 'radiusMd', label: 'themeEditor.radiusMd', max: 24 },
  { key: 'radiusLg', label: 'themeEditor.radiusLg', max: 32 },
] as const

const shape = computed(() => props.definition.shape)
const radiusError = computed(() => (shape.value.radiusSm <= shape.value.radiusMd && shape.value.radiusMd <= shape.value.radiusLg ? '' : te('themeEditor.radiusOrder')))

function emitWith(mutate: (next: Pick<UserPanelThemeDefinition, 'typography' | 'shape'>) => void): void {
  const next = { typography: { ...props.definition.typography }, shape: { ...props.definition.shape } }
  mutate(next)
  emit('change', next)
}
</script>

<template>
  <section class="editor-section" aria-labelledby="editor-typography-title">
    <h3 id="editor-typography-title" class="editor-section-title">{{ te('themeEditor.typography') }}</h3>
    <div class="editor-grid">
      <label class="editor-field">
        <span class="editor-field-label">{{ te('themeEditor.bodyFont') }}</span>
        <Select :model-value="definition.typography.body" :aria-label="te('themeEditor.bodyFont')" data-testid="editor-body-font" @update:model-value="value => emitWith(next => { next.typography.body = value as UserPanelThemeFontStackId })">
          <option v-for="id in USER_PANEL_THEME_FONT_STACK_IDS" :key="id" :value="id">{{ te(FONT_LABEL[id]) }}</option>
        </Select>
      </label>
      <label class="editor-field">
        <span class="editor-field-label">{{ te('themeEditor.headingFont') }}</span>
        <Select :model-value="definition.typography.heading" :aria-label="te('themeEditor.headingFont')" @update:model-value="value => emitWith(next => { next.typography.heading = value as UserPanelThemeFontStackId })">
          <option v-for="id in USER_PANEL_THEME_FONT_STACK_IDS" :key="id" :value="id">{{ te(FONT_LABEL[id]) }}</option>
        </Select>
      </label>
      <NumberField
        :model-value="definition.typography.scale"
        :label="te('themeEditor.fontScale')"
        :min="0.92"
        :max="1.15"
        :step="0.01"
        @commit="value => emitWith(next => { next.typography.scale = Math.round(value * 100) / 100 })"
      />
    </div>
  </section>
  <section class="editor-section" aria-labelledby="editor-shape-title">
    <h3 id="editor-shape-title" class="editor-section-title">{{ te('themeEditor.shape') }}</h3>
    <div class="editor-grid">
      <NumberField
        v-for="radius in RADII"
        :key="radius.key"
        :model-value="shape[radius.key]"
        :label="te(radius.label)"
        :min="0"
        :max="radius.max"
        :error="radiusError"
        @commit="value => emitWith(next => { next.shape[radius.key] = Math.round(value) })"
      />
    </div>
  </section>
</template>

<style scoped src="@/components/panel-theme/PanelThemeEditorSections.css"></style>
