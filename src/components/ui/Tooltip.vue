<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

// Styled, keyboard-reachable replacement for the native `title=` tooltip
// (slow, unstyleable, unavailable to touch and keyboard). Shows on hover
// (after `delay`) and on focus, hides on leave / blur / Esc, and links the
// text to the first focusable child via aria-describedby.
//
// Positioned with `position: fixed` and clamped to the viewport so the
// panel's `overflow: hidden` cannot clip it.
const props = withDefaults(defineProps<{
  text: string
  placement?: 'top' | 'bottom'
  delay?: number
}>(), {
  placement: 'top',
  delay: 300,
})

const id = `tooltip-${useId()}`
const anchor = ref<HTMLElement | null>(null)
const bubble = ref<HTMLElement | null>(null)
const open = ref(false)
const style = ref<Record<string, string>>({})
let timer: ReturnType<typeof setTimeout> | undefined

const MARGIN = 8

async function place() {
  await nextTick()
  const a = anchor.value?.getBoundingClientRect()
  const b = bubble.value?.getBoundingClientRect()
  if (!a || !b) return
  const maxLeft = Math.max(MARGIN, window.innerWidth - b.width - MARGIN)
  const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - b.width / 2), maxLeft)
  const fitsAbove = a.top - b.height - MARGIN >= 0
  const above = props.placement === 'top' ? fitsAbove : !(a.bottom + b.height + MARGIN <= window.innerHeight)
  const top = above ? a.top - b.height - MARGIN / 2 : a.bottom + MARGIN / 2
  style.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}

function show(immediate = false) {
  clearTimeout(timer)
  if (!props.text) return
  const reveal = () => { open.value = true; void place() }
  if (immediate) reveal()
  else timer = setTimeout(reveal, props.delay)
}

function hide() {
  clearTimeout(timer)
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    // Close the tooltip only; do not let Esc also dismiss a parent dialog.
    event.stopPropagation()
    hide()
  }
}

onMounted(() => {
  const target = anchor.value?.firstElementChild
  if (target && !target.getAttribute('aria-describedby')) target.setAttribute('aria-describedby', id)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span
    ref="anchor"
    class="tooltip-anchor"
    @mouseenter="show()"
    @mouseleave="hide"
    @focusin="show(true)"
    @focusout="hide"
    @keydown="onKeydown"
  >
    <slot />
    <span
      v-show="open"
      :id="id"
      ref="bubble"
      class="tooltip"
      role="tooltip"
      :style="style"
    >{{ text }}</span>
  </span>
</template>

<style scoped>
.tooltip-anchor {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.tooltip {
  position: fixed;
  z-index: var(--z-popover);
  max-width: min(240px, calc(100vw - 16px));
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-raised);
  color: var(--text-primary);
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
  pointer-events: none;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (forced-colors: active) {
  .tooltip {
    border-color: CanvasText;
  }
}
</style>
