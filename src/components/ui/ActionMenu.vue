<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

// A small popup of actions anchored to a trigger button. It is rendered inside
// the page (not a native menu) so it keeps the panel's focus: a native menu
// would blur the window, which the main process reads as "hide the panel".
export interface ActionMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
  /** Optional leading icon (Icon name). */
  icon?: string
  /** Optional current-state text shown at the end of the row. */
  state?: string
  /** Optional shortcut hint shown after the state. */
  shortcut?: string
  /** ARIA role; defaults to a plain menuitem. */
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'
  /** aria-checked for the checkbox / radio roles. */
  checked?: boolean
}

withDefaults(defineProps<{
  items: ActionMenuItem[]
  ariaLabel?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  iconOnly?: boolean
  disabled?: boolean
  align?: 'start' | 'end'
}>(), {
  variant: 'ghost',
  size: 'sm',
  iconOnly: false,
  disabled: false,
  align: 'end',
})

const emit = defineEmits<{ select: [id: string] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menuId = `action-menu-${useId()}`

function menuButtons(): HTMLButtonElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])
}

function onDocumentPointerDown(event: Event): void {
  if (root.value && !root.value.contains(event.target as Node)) close()
}

function close(restoreFocus = false): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  if (restoreFocus) root.value?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
}

async function toggle(): Promise<void> {
  if (open.value) {
    close()
    return
  }
  open.value = true
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  await nextTick()
  menuButtons()[0]?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) {
    if (event.key === 'ArrowDown' && (event.target as HTMLElement).closest('[aria-haspopup]')) {
      event.preventDefault()
      void toggle()
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  const buttons = menuButtons()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    buttons[(index + step + buttons.length) % buttons.length]?.focus()
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
  } else if (event.key === 'Tab') {
    close()
  }
}

function pick(id: string): void {
  close(true)
  emit('select', id)
}

onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))
</script>

<template>
  <div ref="root" class="action-menu" @keydown="onKeydown">
    <Button
      :variant="variant"
      :size="size"
      :icon-only="iconOnly"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <slot />
    </Button>
    <div v-if="open" :id="menuId" class="menu" :class="`align-${align}`" role="menu" :aria-label="ariaLabel">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        :role="item.role ?? 'menuitem'"
        :aria-checked="item.role && item.role !== 'menuitem' ? !!item.checked : undefined"
        class="menu-item"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="pick(item.id)"
      >
        <Icon v-if="item.icon" class="menu-item-icon" :name="item.icon" :size="16" />
        <span class="menu-item-label">{{ item.label }}</span>
        <span v-if="item.state" class="menu-item-state">{{ item.state }}</span>
        <span v-if="item.shortcut" class="menu-item-shortcut">{{ item.shortcut }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.action-menu {
  position: relative;
  display: inline-flex;
}

.menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  z-index: var(--z-popover);
  display: flex;
  min-width: 180px;
  flex-direction: column;
  padding: var(--space-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
}

.align-end {
  right: 0;
}

.align-start {
  left: 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 32px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-sm);
  text-align: left;
  cursor: pointer;
}

.menu-item:hover:not(:disabled),
.menu-item:focus-visible {
  background: var(--surface-raised-hover);
}

.menu-item:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: calc(var(--focus-ring-offset) * -1);
}

.menu-item-icon {
  flex: 0 0 auto;
  color: var(--text-secondary);
}

.menu-item-label {
  flex: 1 1 auto;
  white-space: nowrap;
}

.menu-item-state,
.menu-item-shortcut {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-xs);
  white-space: nowrap;
}

.menu-item.danger {
  color: var(--text-danger);
}

.menu-item:disabled {
  cursor: default;
  opacity: 0.55;
}
</style>
