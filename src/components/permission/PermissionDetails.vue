<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import type { PermissionRequestView } from '@/types/permission'
import { permissionSourceName } from '@/utils/permission-source'

// Shared by the pet bubble and the panel card. Everything shown here was
// already sanitized and redacted in the main process; the copy button only
// ever copies that same text.
const props = defineProps<{
  request: PermissionRequestView
  idPrefix: string
}>()

const expanded = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.request.requestId, () => {
  expanded.value = false
  copied.value = false
})

const hasDetails = computed(() => props.request.details.length > 0)
const detailText = computed(() => props.request.details.join('\n'))
// Description is a summary when details exist, otherwise it is the content.
const canExpand = computed(() => hasDetails.value || props.request.description.length > 90)

async function copy(): Promise<void> {
  const text = [props.request.description, ...props.request.details].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1800)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="permission-details" :class="{ expanded }">
    <p :id="`${idPrefix}-description`" class="permission-details-summary">{{ request.description }}</p>
    <pre v-if="hasDetails" class="permission-details-code" tabindex="0" :aria-label="t('permission.argumentsLabel')">{{ detailText }}</pre>
    <p v-if="request.truncated" class="permission-details-truncated">
      {{ t('permissionWarning', { count: request.truncatedChars, source: permissionSourceName(request.agentId) }) }}
    </p>
    <div class="permission-details-tools">
      <!-- raw-control: 權限泡泡內的文字連結；有框的 Button 會和允許／拒絕按鈕搶視覺層級 -->
      <button
        v-if="canExpand"
        type="button"
        class="permission-details-link"
        :aria-expanded="expanded"
        @mousedown.stop
        @click.stop="expanded = !expanded"
      >
        {{ expanded ? t('permission.collapse') : t('permission.expand') }}
      </button>
      <!-- raw-control: 權限泡泡內的文字連結；有框的 Button 會和允許／拒絕按鈕搶視覺層級 -->
      <button
        type="button"
        class="permission-details-link"
        @mousedown.stop
        @click.stop="copy"
      >
        {{ copied ? t('permission.copied') : t('permission.copy') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.permission-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.permission-details-summary,
.permission-details-truncated {
  display: -webkit-box;
  margin: 0 1px;
  overflow: hidden;
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.permission-details.expanded .permission-details-summary {
  -webkit-line-clamp: unset;
}

.permission-details-truncated {
  -webkit-line-clamp: 3;
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.permission-details > * {
  flex: none;
}

/* 容器（寵物的權限泡泡）高度不夠時，只有程式碼框縮短，至少留一行；完整內容用「展開」或「複製」。 */
.permission-details-code {
  flex: 0 1 auto;
  min-height: calc(1.4em + var(--space-2) * 2);
  max-height: calc(1.4em * 3 + var(--space-2) * 2);
  margin: 0;
  padding: var(--space-2);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, currentColor 10%, transparent);
  font: var(--weight-medium) var(--font-xs) / 1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  word-break: break-all;
}

.permission-details.expanded .permission-details-code {
  max-height: 9.5em;
  overflow: auto;
}

.permission-details-tools {
  display: flex;
  gap: var(--space-3);
}

/* Visually compact; the pointer target still reaches --hit-min. */
.permission-details-link::after {
  content: '';
  position: absolute;
  inset-block: min(0px, calc((100% - var(--hit-min)) / 2));
  inset-inline: -4px;
}

.permission-details-link {
  position: relative;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: var(--weight-medium) var(--font-xs) / 1 var(--font-ui);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.permission-details-link:focus-visible,
.permission-details-code:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
</style>
