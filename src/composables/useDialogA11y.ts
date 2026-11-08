import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

// Shared modal behaviour: Esc to close, Tab focus trap, initial focus,
// focus restoration, and `inert` on everything behind the dialog.

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where Tab/Shift+Tab should move focus to keep it inside the dialog, or
 * `null` when the browser's default movement already stays inside.
 */
export function nextTrapIndex(count: number, activeIndex: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (activeIndex < 0) return shift ? count - 1 : 0
  if (shift && activeIndex === 0) return count - 1
  if (!shift && activeIndex === count - 1) return 0
  return null
}

export interface DialogA11yOptions {
  open: Ref<boolean>
  /** The dialog surface (role="dialog"); focus is trapped inside it. */
  container: Ref<HTMLElement | null>
  /** Outer overlay element; its siblings are made inert while open. */
  scope?: Ref<HTMLElement | null>
  onClose: () => void
  /** CSS selector (inside the dialog) for the element to focus on open. */
  initialFocus?: () => string | undefined
  closeOnEscape?: boolean
}

function visible(el: HTMLElement): boolean {
  return !el.hidden && el.getAttribute('aria-hidden') !== 'true'
}

export function useDialogA11y(options: DialogA11yOptions) {
  let restoreTarget: HTMLElement | null = null
  let inerted: Array<{ el: HTMLElement; had: boolean }> = []

  function focusables(): HTMLElement[] {
    const root = options.container.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(visible)
  }

  // A nested dialog inside the same overlay (e.g. ConfirmDialog) owns Esc/Tab while focus is in it.
  function focusInNestedDialog(): boolean {
    const scope = options.scope?.value
    const root = options.container.value
    const active = document.activeElement
    return !!(scope && root && active && scope.contains(active) && !root.contains(active))
  }

  function onKeydown(event: KeyboardEvent) {
    if (!options.open.value) return
    if (focusInNestedDialog()) return
    if (event.key === 'Escape' && options.closeOnEscape !== false) {
      event.preventDefault()
      event.stopPropagation()
      options.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusables()
    if (!items.length) {
      event.preventDefault()
      options.container.value?.focus()
      return
    }
    const target = nextTrapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
    if (target !== null) {
      event.preventDefault()
      items[target].focus()
    }
  }

  function setInert(on: boolean) {
    if (!on) {
      for (const { el, had } of inerted) if (!had) el.removeAttribute('inert')
      inerted = []
      return
    }
    const scope = options.scope?.value
    const parent = scope?.parentElement
    if (!scope || !parent) return
    for (const sibling of Array.from(parent.children) as HTMLElement[]) {
      if (sibling === scope) continue
      inerted.push({ el: sibling, had: sibling.hasAttribute('inert') })
      sibling.setAttribute('inert', '')
    }
  }

  async function activate() {
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.addEventListener('keydown', onKeydown, true)
    await nextTick()
    setInert(true)
    const root = options.container.value
    if (!root) return
    const selector = options.initialFocus?.()
    const preferred = selector ? root.querySelector<HTMLElement>(selector) : null
    const target = preferred ?? focusables()[0] ?? root
    target.focus()
  }

  function deactivate() {
    window.removeEventListener('keydown', onKeydown, true)
    setInert(false)
    const target = restoreTarget
    restoreTarget = null
    if (target && target.isConnected) target.focus()
  }

  watch(options.open, (open, was) => {
    if (open && !was) void activate()
    else if (!open && was) deactivate()
  }, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => {
    if (options.open.value) deactivate()
  })
}
