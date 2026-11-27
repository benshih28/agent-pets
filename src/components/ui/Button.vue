<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  disabled?: boolean
  active?: boolean
  iconOnly?: boolean
  block?: boolean
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
  /* 不用標題字體：它對中英混合標籤會變成三種字體。 */
  font-family: var(--font-body);
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

/* Invisible hit-area extension so small buttons still reach --hit-min (WCAG 2.5.8). */
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
  animation: btn-spin var(--duration-spin) linear infinite;
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

.variant-primary {
  border-color: var(--accent-hover, var(--accent));
  background: var(--accent-hover, var(--accent));
  color: var(--accent-on);
}

/* 12% 混色比例與驗證器 PANEL_THEME_PRESSED_MIX 一致。 */
.variant-primary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, var(--text-primary));
  background: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, var(--text-primary));
  color: var(--accent-on);
}

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

/* 懸停底 12% 與驗證器 PANEL_THEME_STATE_TINT_ALPHA 一致，插件主題的危險文字才保證可讀。 */
.variant-danger {
  border-color: color-mix(in srgb, var(--text-danger) 45%, transparent);
  background: transparent;
  color: var(--text-danger);
}

.variant-danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--text-danger) 45%, transparent);
  background: color-mix(in srgb, var(--text-danger) 12%, transparent);
  color: var(--text-danger);
}

.variant-ghost {
  color: var(--text-secondary);
}

.variant-ghost:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.btn.active {
  border-color: var(--accent-hover, var(--accent));
  background: var(--accent-hover, var(--accent));
  color: var(--accent-on);
}
</style>
