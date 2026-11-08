<script setup lang="ts">
// Replaces twelve hand-rolled button styles (.setup-btn, .import-btn,
// .usage-refresh, .history-action, .clear-offline-btn, .mood-reset-btn,
// .restart-btn, .quit-btn, .header-btn, .pet-edit, .pet-remove, .scale-option)
// that shared no declarations, so identical roles looked different.
//
// Pick the variant by ROLE, not by appearance:
//   primary   — the main action of a section
//   secondary — supporting actions (refresh, reset, export)
//   danger    — destructive or irreversible (quit, remove, clear)
//   ghost     — icon-only chrome (header controls, inline row actions)
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  disabled?: boolean
  active?: boolean
  iconOnly?: boolean
  block?: boolean
  /** Shows a spinner, sets aria-busy and ignores clicks until it clears. */
  loading?: boolean
}>(), {
  variant: 'secondary',
  size: 'md',
  type: 'button',
  disabled: false,
  active: false,
  iconOnly: false,
  block: false,
  loading: false,
})
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`variant-${variant}`, `size-${size}`, { active, 'icon-only': iconOnly, block, loading }]"
    :disabled="disabled"
    :aria-disabled="loading ? true : undefined"
    :aria-busy="loading ? true : undefined"
    :aria-pressed="active ? true : undefined"
    @click.capture="loading && ($event.preventDefault(), $event.stopImmediatePropagation())"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  font: inherit;
  font-family: var(--font-heading);
  font-weight: var(--weight-medium);
  line-height: 1;
  position: relative;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.block {
  width: 100%;
}

/* Invisible hit-area extension: small buttons stay visually compact but are
   always at least --hit-min tall/wide to the pointer (WCAG 2.5.8). */
.btn::after {
  content: '';
  position: absolute;
  inset-block: min(0px, calc((100% - var(--hit-min)) / 2));
  inset-inline: min(0px, calc((100% - var(--hit-min)) / 2));
}

.size-md {
  padding: 9px 15px;
  font-size: var(--font-sm);
}

.size-sm {
  padding: 7px 13.2px;
  font-size: var(--font-xs);
}

.icon-only {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: var(--radius-pill);
  font-size: var(--font-lg);
}

.btn:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.btn.loading {
  cursor: progress;
}

.spinner {
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-pill);
  animation: btn-spin 0.8s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    border-right-color: currentColor;
    opacity: 0.6;
  }
}

/* ── primary ─────────────────────────────────────────────────────────── */
.variant-primary {
  border-color: var(--accent-hover, var(--accent));
  background: var(--accent-hover, var(--accent));
  color: var(--accent-on);
}

.variant-primary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, black);
  background: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, black);
  color: var(--accent-on);
}

/* ── secondary ───────────────────────────────────────────────────────── */
.variant-secondary {
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-primary);
}

.variant-secondary:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

/* ── danger ──────────────────────────────────────────────────────────── */
.variant-danger {
  border-color: transparent;
  background: transparent;
  color: var(--accent-text, var(--state-error-soft));
}

.variant-danger:hover:not(:disabled) {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent-text, var(--state-error));
}

/* ── ghost ───────────────────────────────────────────────────────────── */
.variant-ghost {
  color: var(--text-secondary);
}

.variant-ghost:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

/* Selected state for segmented controls (pet size, tabs). */
.btn.active {
  border-color: var(--accent-hover, var(--accent));
  background: var(--accent-hover, var(--accent));
  color: var(--accent-on);
}
</style>
