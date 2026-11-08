<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import type { PetImportDecision, PetImportPreview, PetImportWarning } from '@/types/pet-import'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import {
  PREVIEW_IDLE_FRAMES,
  PREVIEW_IDLE_FRAME_MS,
  PREVIEW_MAX_ROWS,
  atlasCellStyle,
  atlasRowName,
  isImportPreviewUrl,
} from '@/utils/pet-atlas-preview'

const props = defineProps<{
  preview: PetImportPreview | null
  busy: boolean
  error: string
}>()

const emit = defineEmits<{ cancel: []; commit: [decision: PetImportDecision] }>()

const WARNING_KEYS: Record<PetImportWarning, TranslationKey> = {
  'declared-version-mismatch': 'pet.importWarning.declared-version-mismatch',
  'unexpected-row-count': 'pet.importWarning.unexpected-row-count',
  'unexpected-column-count': 'pet.importWarning.unexpected-column-count',
  'behavior-row-out-of-range': 'pet.importWarning.behavior-row-out-of-range',
  'ignored-entries': 'pet.importWarning.ignored-entries',
}

const IDLE_SCALE = 0.5
const ROW_SCALE = 0.25

// 只接受主程序產生的 import-preview URL；其他值一律不渲染成背景圖。
const previewUrl = computed(() => (isImportPreviewUrl(props.preview?.previewUrl) ? props.preview!.previewUrl : null))
const idleFrame = ref(0)
const idleColumns = computed(() => Math.max(1, Math.min(PREVIEW_IDLE_FRAMES, props.preview?.atlas.columns ?? 1)))
const idleStyle = computed(() => (props.preview && previewUrl.value
  ? atlasCellStyle(props.preview.atlas, previewUrl.value, 0, idleFrame.value, IDLE_SCALE)
  : {}))
const rows = computed(() => {
  const preview = props.preview
  if (!preview || !previewUrl.value) return []
  return Array.from({ length: Math.min(preview.atlas.rows, PREVIEW_MAX_ROWS) }, (_, row) => ({
    row,
    name: atlasRowName(row),
    style: atlasCellStyle(preview.atlas, previewUrl.value!, row, 0, ROW_SCALE),
  }))
})
const facts = computed(() => {
  const preview = props.preview
  if (!preview) return []
  const { atlas } = preview
  return [
    { label: t('pet.importPreviewId'), value: preview.id },
    { label: t('pet.importPreviewVersion'), value: `v${atlas.version}` },
    { label: t('pet.importPreviewFrame'), value: `${atlas.frameWidth} \u00d7 ${atlas.frameHeight}` },
    { label: t('pet.importPreviewGrid'), value: `${atlas.columns} \u00d7 ${atlas.rows}` },
  ]
})
const conflictMessage = computed(() => {
  const conflict = props.preview?.conflict
  if (!conflict) return ''
  return conflict.builtIn
    ? t('pet.importConflictBuiltIn', { id: conflict.id, suggested: conflict.suggestedId })
    : `${t('pet.importConflict', { id: conflict.id })} ${t('pet.importConflictChoice', { suggested: conflict.suggestedId })}`
})

// 待命動畫用計時器切換背景位置；減少動態效果時只顯示第一格。
let idleTimer: ReturnType<typeof setInterval> | null = null
function stopIdle(): void {
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = null
  idleFrame.value = 0
}
function startIdle(): void {
  stopIdle()
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced || !props.preview) return
  idleTimer = setInterval(() => { idleFrame.value = (idleFrame.value + 1) % idleColumns.value }, PREVIEW_IDLE_FRAME_MS)
}

watch(() => props.preview?.token, token => (token ? startIdle() : stopIdle()), { immediate: true })
onUnmounted(stopIdle)
</script>

<template>
  <Dialog
    :open="preview !== null"
    :title="t('pet.importPreviewTitle')"
    role="alertdialog"
    size="md"
    :dismiss-on-scrim="false"
    initial-focus="[data-cancel]"
    @close="emit('cancel')"
  >
    <div v-if="preview" class="import-preview">
      <div class="preview-head">
        <div class="preview-idle" :style="idleStyle" role="img" :aria-label="t('pet.importPreviewIdle')" />
        <div class="preview-summary">
          <p class="pet-title" :title="preview.displayName">{{ preview.displayName }}</p>
          <dl class="preview-facts">
            <div v-for="fact in facts" :key="fact.label" class="fact"><dt>{{ fact.label }}</dt><dd :title="fact.value">{{ fact.value }}</dd></div>
          </dl>
        </div>
      </div>

      <section class="preview-rows" :aria-label="t('pet.importPreviewRows')">
        <h3 class="section-label">{{ t('pet.importPreviewRows') }}</h3>
        <ul class="row-grid">
          <li v-for="item in rows" :key="item.row" class="row-cell">
            <span class="row-frame" :style="item.style" aria-hidden="true" />
            <span class="row-name" :title="item.name">{{ item.row }} · {{ item.name }}</span>
          </li>
        </ul>
      </section>

      <section v-if="preview.warnings.length > 0 || preview.autoBehaviors.length > 0" class="preview-notes">
        <h3 class="section-label">{{ t('pet.importPreviewWarnings') }}</h3>
        <ul class="note-list">
          <li v-if="preview.autoBehaviors.includes('walk')" class="note">{{ t('pet.importAutoWalk') }}</li>
          <li v-for="warning in preview.warnings" :key="warning" class="note note-warn">{{ t(WARNING_KEYS[warning]) }}</li>
        </ul>
      </section>

      <p v-if="conflictMessage" class="conflict" role="status">{{ conflictMessage }}</p>
      <p v-if="error" class="import-dialog-error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <Button variant="secondary" size="sm" data-cancel :disabled="busy" @click="emit('cancel')">{{ t('cancel') }}</Button>
      <template v-if="preview?.conflict">
        <Button v-if="!preview.conflict.builtIn" variant="danger" size="sm" :disabled="busy" @click="emit('commit', 'replace')">{{ t('pet.importReplace') }}</Button>
        <Button variant="primary" size="sm" :disabled="busy" @click="emit('commit', 'keep-both')">{{ t('pet.importKeepBoth') }}</Button>
      </template>
      <Button v-else variant="primary" size="sm" :disabled="busy" @click="emit('commit', 'install')">{{ busy ? t('importing') : t('pet.importInstall') }}</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.import-preview {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.preview-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.preview-idle,
.row-frame {
  flex: none;
  image-orientation: none;
  border-radius: var(--radius-sm);
  background-color: var(--surface-sunken);
}

.preview-facts {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
  margin: 0;
}

.fact {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--font-xs);
}

.fact dt {
  flex: none;
  color: var(--text-secondary);
}

.fact dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-summary {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}

.pet-title {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-label {
  margin: 0 0 var(--space-1);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.row-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: var(--space-2);
  max-height: 168px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.row-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.row-name {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.note,
.conflict {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.note-warn,
.conflict {
  color: var(--text-warning);
}

.import-dialog-error {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}

</style>
