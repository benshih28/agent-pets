<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useReducedMotion } from '@/composables/useReducedMotion'
import { useRovingTabs } from '@/composables/useRovingTabs'
import Badge from '@/components/ui/Badge.vue'
import Icon from '@/components/ui/Icon.vue'
import { overflowState, pageScrollDelta, scrollLeftToReveal, wheelScrollDelta } from '@/utils/tab-overflow'

// One pill-shaped selector for both navigation (role=tablist, pairs with a
// tabpanel) and single-choice settings (role=radiogroup). Replaces the dashboard
// tab strip, the settings nav pills and the hand-rolled pet size buttons so
// all three share keyboard handling (arrows, Home/End) and focus styling.
export interface SegmentedOption {
  value: string
  label: string
  icon?: string
  /** Small count shown next to the label; hidden when 0 or undefined. */
  badge?: number
  /** A dot signalling something needs attention. */
  attention?: boolean
  title?: string
  /** Image shown instead of `icon` (e.g. a plugin icon); the caller vets the URL. */
  iconUrl?: string
  /** Short text rendered in a ui/Badge next to the label; hidden when empty. */
  badgeText?: string
  /** Ellipsize a long label. */
  truncate?: boolean
}

const props = withDefaults(defineProps<{
  options: readonly SegmentedOption[]
  ariaLabel: string
  /** tabs → role=tablist/tab; radio → role=radiogroup/radio. */
  semantics?: 'tabs' | 'radio'
  /** DOM id prefix for each segment (`${idPrefix}${value}`). */
  idPrefix?: string
  /** For tabs: id prefix of the controlled tabpanel (`${panelIdPrefix}${value}`). */
  panelIdPrefix?: string
  /** For tabs sharing one tabpanel element: its fixed id (overrides panelIdPrefix). */
  panelId?: string
  size?: 'sm' | 'md'
  fill?: boolean
  /**
   * Keep every segment at its natural width and scroll horizontally when they do not
   * fit: edge fade masks, ‹ › buttons, wheel / trackpad scrolling, and the active or
   * focused segment is kept in view.
   */
  scrollable?: boolean
  scrollPrevLabel?: string
  scrollNextLabel?: string
}>(), {
  semantics: 'tabs',
  idPrefix: 'segment-',
  panelIdPrefix: '',
  size: 'md',
  fill: false,
  scrollable: false,
  scrollPrevLabel: '',
  scrollNextLabel: '',
})

const model = defineModel<string>({ required: true })

const { onKeydown } = useRovingTabs({
  ids: () => props.options.map(option => option.value),
  current: () => model.value,
  select: value => { model.value = value },
  elementId: value => `${props.idPrefix}${value}`,
})

const track = ref<HTMLElement | null>(null)
const edges = ref({ overflowing: false, start: false, end: false })
let resizeObserver: ResizeObserver | null = null
const REVEAL_PADDING = 28
const reducedMotion = useReducedMotion()

function updateEdges(): void {
  const el = track.value
  if (!props.scrollable || !el) return
  edges.value = overflowState(el)
}

function reveal(button: HTMLElement | null): void {
  const el = track.value
  if (!props.scrollable || !el || !button) return
  const left = scrollLeftToReveal(el, { left: button.offsetLeft, width: button.offsetWidth }, REVEAL_PADDING)
  if (left !== el.scrollLeft) el.scrollTo({ left, behavior: reducedMotion.value ? 'auto' : 'smooth' })
}

function onFocusIn(event: FocusEvent): void {
  reveal((event.target as HTMLElement | null)?.closest<HTMLElement>('.segment') ?? null)
}

function scrollPage(direction: -1 | 1): void {
  const el = track.value
  if (!el) return
  el.scrollBy({ left: pageScrollDelta(el.clientWidth, direction), behavior: reducedMotion.value ? 'auto' : 'smooth' })
}

function onWheel(event: WheelEvent): void {
  const el = track.value
  if (!props.scrollable || !el) return
  const delta = wheelScrollDelta(event, edges.value.overflowing)
  if (delta === null) return
  event.preventDefault()
  el.scrollLeft += delta
}

watch(model, async () => {
  await nextTick()
  reveal(track.value?.querySelector<HTMLElement>('.segment.active') ?? null)
})
watch(() => props.options.map(option => option.value).join('|'), async () => {
  await nextTick()
  updateEdges()
  reveal(track.value?.querySelector<HTMLElement>('.segment.active') ?? null)
})

onMounted(() => {
  if (!props.scrollable || !track.value) return
  resizeObserver = new ResizeObserver(updateEdges)
  resizeObserver.observe(track.value)
  updateEdges()
  reveal(track.value.querySelector<HTMLElement>('.segment.active'))
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div v-if="scrollable" class="segmented-scroll" :class="{ 'has-start': edges.start, 'has-end': edges.end }">
    <button
      v-if="edges.start"
      type="button"
      class="scroll-button scroll-prev"
      tabindex="-1"
      :aria-label="scrollPrevLabel"
      :title="scrollPrevLabel"
      @click="scrollPage(-1)"
    >
      <Icon name="chevron-right" :size="12" />
    </button>
    <div
      ref="track"
      class="segmented"
      :class="[`size-${size}`, { fill }]"
      :role="semantics === 'tabs' ? 'tablist' : 'radiogroup'"
      :aria-label="ariaLabel"
      @scroll.passive="updateEdges"
      @wheel="onWheel"
      @focusin="onFocusIn"
    >
      <button
        v-for="option in options"
        :id="`${idPrefix}${option.value}`"
        :key="option.value"
        type="button"
        class="segment"
        :class="{ active: model === option.value, truncate: option.truncate }"
        :role="semantics === 'tabs' ? 'tab' : 'radio'"
        :aria-selected="semantics === 'tabs' ? model === option.value : undefined"
        :aria-checked="semantics === 'radio' ? model === option.value : undefined"
        :aria-controls="semantics !== 'tabs' ? undefined : (panelId && model === option.value ? panelId : (!panelId && panelIdPrefix ? `${panelIdPrefix}${option.value}` : undefined))"
        :tabindex="model === option.value ? 0 : -1"
        :title="option.title ?? (option.truncate ? option.label : undefined)"
        @click="model = option.value"
        @keydown="onKeydown"
      >
        <img v-if="option.iconUrl" class="segment-image" :src="option.iconUrl" alt="">
        <Icon v-else-if="option.icon" :name="option.icon" :size="14" />
        <span class="segment-label">{{ option.label }}</span>
        <span v-if="option.badge" class="segment-badge">{{ option.badge }}</span>
        <Badge v-if="option.badgeText" count tone="accent" class="segment-ui-badge">{{ option.badgeText }}</Badge>
        <span v-if="option.attention" class="segment-dot" aria-hidden="true" />
      </button>
    </div>
    <button
      v-if="edges.end"
      type="button"
      class="scroll-button scroll-next"
      tabindex="-1"
      :aria-label="scrollNextLabel"
      :title="scrollNextLabel"
      @click="scrollPage(1)"
    >
      <Icon name="chevron-right" :size="12" />
    </button>
  </div>
  <div
    v-else
    class="segmented"
    :class="[`size-${size}`, { fill }]"
    :role="semantics === 'tabs' ? 'tablist' : 'radiogroup'"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :id="`${idPrefix}${option.value}`"
      :key="option.value"
      type="button"
      class="segment"
      :class="{ active: model === option.value }"
      :role="semantics === 'tabs' ? 'tab' : 'radio'"
      :aria-selected="semantics === 'tabs' ? model === option.value : undefined"
      :aria-checked="semantics === 'radio' ? model === option.value : undefined"
      :aria-controls="semantics !== 'tabs' ? undefined : (panelId && model === option.value ? panelId : (!panelId && panelIdPrefix ? `${panelIdPrefix}${option.value}` : undefined))"
      :tabindex="model === option.value ? 0 : -1"
      :title="option.title"
      @click="model = option.value"
      @keydown="onKeydown"
    >
      <Icon v-if="option.icon" :name="option.icon" :size="14" />
      <span class="segment-label">{{ option.label }}</span>
      <span v-if="option.badge" class="segment-badge">{{ option.badge }}</span>
      <span v-if="option.attention" class="segment-dot" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  min-width: 0;
  max-width: 100%;
  gap: var(--space-1);
  padding: var(--space-1);
  overflow-x: auto;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  scrollbar-width: none;
}

.segmented.fill {
  display: flex;
  width: 100%;
}

.segmented::-webkit-scrollbar {
  display: none;
}

.segment {
  position: relative;
  display: inline-flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-heading, var(--font-ui));
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.fill .segment {
  flex: 1 1 0;
}

.size-md .segment {
  padding: 7px var(--space-3);
  font-size: var(--font-body-md, var(--font-sm));
}

.size-sm .segment {
  padding: 5px var(--space-3);
  font-size: var(--font-body-sm, var(--font-xs));
}

.segment:hover:not(.active) {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

/* 文字放在實心強調色上時用 accentHover：onAccent 在其上保證 >= 4.5:1（在 accent 上只保證 3:1）。 */
.segment.active {
  background: var(--accent-hover);
  color: var(--accent-bright);
}

.segment:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.segment-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.segment-image {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.segment.truncate {
  max-width: 14ch;
}

.segment.truncate .segment-label {
  min-width: 0;
}

/* Scrollable variant: fade masks hint at hidden segments, ‹ › buttons page the bar. */
.segmented-scroll {
  position: relative;
  display: flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
}

.segmented-scroll > .segmented {
  flex: 1 1 auto;
  scroll-behavior: auto;
  overscroll-behavior-x: contain;
}

.segmented-scroll.has-start > .segmented {
  mask-image: linear-gradient(to right, transparent 0, var(--surface-sunken) var(--space-5));
  -webkit-mask-image: linear-gradient(to right, transparent 0, var(--surface-sunken) var(--space-5));
}

.segmented-scroll.has-end > .segmented {
  mask-image: linear-gradient(to left, transparent 0, var(--surface-sunken) var(--space-5));
  -webkit-mask-image: linear-gradient(to left, transparent 0, var(--surface-sunken) var(--space-5));
}

.segmented-scroll.has-start.has-end > .segmented {
  mask-image: linear-gradient(to right, transparent 0, var(--surface-sunken) var(--space-5), var(--surface-sunken) calc(100% - var(--space-5)), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, var(--surface-sunken) var(--space-5), var(--surface-sunken) calc(100% - var(--space-5)), transparent 100%);
}

.scroll-button {
  display: inline-flex;
  width: var(--space-5);
  height: var(--space-5);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin-inline: var(--space-1);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}

.scroll-button:hover {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.scroll-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.scroll-prev :deep(svg) {
  transform: scaleX(-1);
}

.segment-badge {
  min-width: 18px;
  padding: 1px var(--space-1-5);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--font-label, var(--font-xs));
  line-height: 1.4;
}

/* 主動分頁上的數字徽章：accentHover 字在 onAccent 底上 >= 4.5:1（accent 只保證 3:1）。 */
.active .segment-badge {
  background: var(--accent-bright);
  color: var(--accent-hover);
}

.segment-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--accent-text);
}

.active .segment-dot {
  background: var(--accent-bright);
}
</style>
