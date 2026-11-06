<script setup lang="ts">
// Replaces the settings nav's text glyphs (文 ◈ ⌘ ✦ ↗ ⋯). Those rendered
// through the system font, so their weight and alignment differed between
// Windows and macOS, and no CSS could correct it — 文 is CJK and picked up
// different font metrics from the Latin glyphs beside it, while ⌘ carries a
// real meaning on macOS (the Command key) that has nothing to do with the
// "Desktop" section it labelled.
//
// Inline SVG renders identically on both platforms and inherits currentColor.
const paths: Record<string, string> = {
  // Language — a globe with meridians.
  language: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M1.5 8h13M8 1.5c1.7 1.8 2.6 4.1 2.6 6.5S9.7 12.7 8 14.5M8 1.5C6.3 3.3 5.4 5.6 5.4 8s.9 4.7 2.6 6.5',
  // Appearance — a paint droplet.
  appearance: 'M8 1.8c2.6 3 4.3 5.3 4.3 7.4a4.3 4.3 0 0 1-8.6 0c0-2.1 1.7-4.4 4.3-7.4Z',
  // Desktop — a monitor on a stand.
  desktop: 'M2 3.2h12v7.4H2zM6.2 13.4h3.6M8 10.6v2.8',
  // Pets — a paw print.
  pets: 'M8 9.2c2 0 3.4 1.2 3.4 2.7 0 1.2-1 2-2.3 1.7l-1.1-.3-1.1.3c-1.3.3-2.3-.5-2.3-1.7 0-1.5 1.4-2.7 3.4-2.7ZM4.4 5.6a1.2 1.5 0 1 0 0 3 1.2 1.5 0 0 0 0-3M11.6 5.6a1.2 1.5 0 1 0 0 3 1.2 1.5 0 0 0 0-3M6.6 2.4a1.1 1.4 0 1 0 0 2.8 1.1 1.4 0 0 0 0-2.8M9.4 2.4a1.1 1.4 0 1 0 0 2.8 1.1 1.4 0 0 0 0-2.8',
  // Growth — an ascending trend line.
  growth: 'M2 12.2 6 8l2.6 2.6L14 5M10.4 4.6H14v3.6',
  // Trophy — a compact achievement mark for the Growth gallery.
  trophy: 'M5 2.4h6v2.1a3 3 0 0 1-2.2 2.9v1.5h1.8v1.4H5.4V8.9h1.8V7.4A3 3 0 0 1 5 4.5V2.4ZM5 3.2H3.2v1.2a2 2 0 0 0 2 2M11 3.2h1.8v1.2a2 2 0 0 1-2 2M4.2 13.6h7.6',
  // Lock — an unavailable achievement mark.
  lock: 'M4.2 7V5.3a3.8 3.8 0 0 1 7.6 0V7M3 7h10v6H3zM8 9.2v1.6',
  // Advanced — sliders.
  advanced: 'M2.6 4.6h10.8M2.6 11.4h10.8M6.2 2.9v3.4M10.4 9.7v3.4',
  // Chrome / inline actions.
  bell: 'M8 2.2a4 4 0 0 0-4 4v2.1c0 1.1-.4 2.2-1.1 3.1h10.2c-.7-.9-1.1-2-1.1-3.1V6.2a4 4 0 0 0-4-4ZM6.4 13.2a1.7 1.7 0 0 0 3.2 0',
  moon: 'M10.7 2.2a5.6 5.6 0 1 0 3.1 8.9A5.6 5.6 0 0 1 10.7 2.2Z',
  'volume-off': 'M2.2 6.2v3.6h2.1l3 2.4V3.8l-3 2.4H2.2ZM10.8 6.1l2.8 3.8M13.6 6.1l-2.8 3.8',
  maximize: 'M5.5 2.5h-3v3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  restore: 'M6.5 2.5h7v7M10 6H2.5v7.5H10z',
  plus: 'M8 2.2v11.6M2.2 8h11.6',
  check: 'm2.4 8.3 3.1 3.1 8.1-7.1',
  settings: 'M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2M13 8c0-.4 0-.7-.1-1l1.4-1.1-1.4-2.4-1.7.6a5.4 5.4 0 0 0-1.7-1L9.2 1.3H6.8l-.3 1.8c-.6.2-1.2.6-1.7 1l-1.7-.6-1.4 2.4L3.1 7a5.6 5.6 0 0 0 0 2l-1.4 1.1 1.4 2.4 1.7-.6c.5.4 1.1.8 1.7 1l.3 1.8h2.4l.3-1.8c.6-.2 1.2-.6 1.7-1l1.7.6 1.4-2.4L12.9 9c.1-.3.1-.6.1-1Z',
  close: 'M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8',
  back: 'M10 3.2 5.2 8l4.8 4.8',
  edit: 'M11.2 2.4 13.6 4.8 5.6 12.8 2.4 13.6l.8-3.2zM9.6 4l2.4 2.4',
  warning: 'M8 2.4 14.4 13.6H1.6zM8 6.4v3.2M8 11.6v.4',
}

withDefaults(defineProps<{
  name: keyof typeof paths | string
  size?: number
}>(), {
  size: 16,
})
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="paths[name] ?? ''" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: 0 0 auto;
}
</style>
