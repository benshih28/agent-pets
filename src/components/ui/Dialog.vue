<script setup lang="ts">
import { computed, inject, provide, ref, toRef, useId } from 'vue'
import { t } from '@/i18n'
import { useDialogA11y } from '@/composables/useDialogA11y'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { DIALOG_HOST_KEY, DIALOG_NESTED_KEY, dialogTeleportTarget } from '@/components/ui/dialog-host'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  role?: 'dialog' | 'alertdialog'
  initialFocus?: string
  showClose?: boolean
  dismissOnScrim?: boolean
  size?: 'sm' | 'md' | 'lg' | 'full'
}>(), {
  role: 'dialog',
  showClose: false,
  dismissOnScrim: true,
  size: 'sm',
})

const emit = defineEmits<{ close: [] }>()

const uid = useId()
const titleId = `dialog-${uid}-title`
const descriptionId = `dialog-${uid}-description`

const scopeRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)

useDialogA11y({
  open: toRef(props, 'open'),
  container: dialogRef,
  scope: scopeRef,
  onClose: () => emit('close'),
  initialFocus: () => props.initialFocus,
})

const describedBy = computed(() => (props.description ? descriptionId : undefined))

// 遮罩掛到面板根元素，才不會被所在卡片或捲動區裁切。
const host = inject(DIALOG_HOST_KEY, null)
const nested = inject(DIALOG_NESTED_KEY, false)
provide(DIALOG_NESTED_KEY, true)
const teleportTarget = computed(() => dialogTeleportTarget(host?.value, nested))
</script>

<template>
  <Teleport :to="teleportTarget ?? 'body'" :disabled="!teleportTarget">
    <Transition name="dialog">
      <div v-if="open" ref="scopeRef" class="scrim" @click.self="dismissOnScrim && emit('close')">
        <div
          ref="dialogRef"
          class="dialog"
          :class="`size-${size}`"
          :role="role"
          aria-modal="true"
          tabindex="-1"
          :aria-labelledby="titleId"
          :aria-describedby="describedBy"
        >
          <header class="head">
            <h2 :id="titleId" class="title">{{ title }}</h2>
            <Button
              v-if="showClose"
              variant="ghost"
              size="sm"
              icon-only
              :aria-label="t('close')"
              @click="emit('close')"
            >
              <Icon name="close" :size="14" />
            </Button>
          </header>
          <div v-if="description || $slots.default" class="body">
            <p v-if="description" :id="descriptionId" class="description">{{ description }}</p>
            <slot />
          </div>
          <footer v-if="$slots.footer" class="footer"><slot name="footer" /></footer>
        </div>
        <slot name="overlay" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: var(--surface-scrim);
  -webkit-backdrop-filter: var(--blur-scrim);
  backdrop-filter: var(--blur-scrim);
}

.dialog {
  display: flex;
  width: 100%;
  max-height: 100%;
  flex-direction: column;
  gap: var(--space-2);
  overflow: hidden;
  padding: var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
}

/* tabindex=-1 的程式聚焦目標，滑鼠點到時不畫環。 */
.dialog:focus:not(:focus-visible) {
  outline: none;
}

.size-sm { max-width: 300px; }
.size-md { max-width: 420px; }
.size-lg { max-width: 560px; }
/* .body 不捲動，由內容自己捲，避免兩層捲軸。 */
.size-full {
  max-width: none;
  height: 100%;
}

.size-full > .body {
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

/* 負外距加等量內距，讓捲動容器不裁掉子元素的焦點框。 */
.body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-2);
  margin: calc(-1 * var(--space-1));
  padding: var(--space-1);
  overflow-y: auto;
}

.head,
.footer {
  flex: 0 0 auto;
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: var(--font-md);
  font-weight: var(--weight-medium);
}

.description {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--transition-fast);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-transparency: reduce) {
  .scrim {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
</style>
