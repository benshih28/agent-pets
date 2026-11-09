<script setup lang="ts">
import { computed, inject, provide, ref, toRef, useId } from 'vue'
import { t } from '@/i18n'
import { useDialogA11y } from '@/composables/useDialogA11y'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { DIALOG_HOST_KEY, DIALOG_NESTED_KEY, dialogTeleportTarget } from '@/components/ui/dialog-host'

// The one modal shell: scrim, titled surface, optional description and
// footer, with Esc / Tab trap / initial focus / focus restore / inert
// background provided by useDialogA11y. ConfirmDialog is built on it;
// SetupWizard and ProjectMcpPanel should adopt it too.
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  /** Short description; referenced by aria-describedby. */
  description?: string
  /** "alertdialog" for interruptions that need an explicit answer. */
  role?: 'dialog' | 'alertdialog'
  /** Selector (inside the dialog) focused on open; defaults to the first control. */
  initialFocus?: string
  showClose?: boolean
  dismissOnScrim?: boolean
  /** `full` fills the panel (theme editor); the others cap the width. */
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

// 遮罩掛到面板根元素（見 dialog-host.ts），不受所在卡片或捲動區的範圍限制。
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
          <p v-if="description" :id="descriptionId" class="description">{{ description }}</p>
          <slot />
          <footer v-if="$slots.footer" class="footer"><slot name="footer" /></footer>
        </div>
        <!-- A dialog opened from inside this one: inside the scope (so its siblings go inert and this
             dialog's key handling steps aside) but outside the trapped surface. -->
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
  overflow: auto;
  padding: var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
}

.dialog:focus:not(:focus-visible) {
  outline: none;
}

.size-sm { max-width: 300px; }
.size-md { max-width: 420px; }
.size-lg { max-width: 560px; }
/* 全面板的工具（主題編輯器）：對話框本身不捲動，標題與底部按鈕一直看得到，也不會出現兩層
   捲軸。內容自己是捲動區（min-height: 0; flex: 1 1 auto; overflow-y: auto）。 */
.size-full {
  max-width: none;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
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
