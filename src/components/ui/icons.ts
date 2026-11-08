// Icon path data on a 16x16 grid, 1.4 stroke, round caps. Kept out of the
// component so it can be unit-tested and imported by non-Vue code.
export const ICON_PATHS: Record<string, string> = {
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
  // Do Not Disturb: a struck-through bell. Not a moon, which reads as a dark-mode toggle.
  'bell-off': 'M8 2.2a4 4 0 0 0-4 4v2.1c0 1.1-.4 2.2-1.1 3.1h10.2c-.7-.9-1.1-2-1.1-3.1V6.2a4 4 0 0 0-4-4ZM6.4 13.2a1.7 1.7 0 0 0 3.2 0M2.4 2.4l11.2 11.2',
  // Light mode: a sun with eight rays.
  sun: 'M8 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2M8 1.6v1.4M8 13v1.4M1.6 8H3M13 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1',
  // Follow system: a circle with the left half filled by an outline.
  'theme-auto': 'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4ZM8 1.8a6.2 6.2 0 0 0 0 12.4Z',
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
  info: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8M8 7.2v3.6M8 4.8v.2',
  warning: 'M8 2.4 14.4 13.6H1.6zM8 6.4v3.2M8 11.6v.4',
  heart: 'M8 13.6 2.9 8.5a3.1 3.1 0 0 1 4.4-4.4L8 4.8l.7-.7a3.1 3.1 0 0 1 4.4 4.4Z',
  question: 'M5.6 6.2a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.6M8 12.2v.4',
  exclaim: 'M8 3v6.4M8 12.4v.4',
  dots: 'M3.6 8v.01M8 8v.01M12.4 8v.01',
  search: 'M7 2.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2M10.4 10.4l3.2 3.2',
  volume: 'M2.2 6.2v3.6h2.1l3 2.4V3.8l-3 2.4H2.2ZM10.2 5.6a3.4 3.4 0 0 1 0 4.8M12 3.8a6 6 0 0 1 0 8.4',
  'chevron-right': 'M6 3.2 10.8 8 6 12.8',
  // Pin — keeps a floating panel open (angled push-pin).
  pin: 'M9.8 2.2 13.8 6.2l-1.5.5-2.3 2.3.2 2.2-1 1L5 8.6 2.6 11l-.6-.6L4.4 8 1.8 5.5l1-1 2.2.2L7.3 2.4zM2.4 13.6l2.6-2.6',
  // DS-06: replacements for text glyphs in the pet layer / plugin pages.
  sparkle: 'M8 1.8c.4 2.9 1.5 4 4.4 4.4-2.9.4-4 1.5-4.4 4.4-.4-2.9-1.5-4-4.4-4.4 2.9-.4 4-1.5 4.4-4.4ZM12.6 10.6c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2Z',
  wrench: 'M10.2 2.4a3.4 3.4 0 0 0-3.1 4.5L2.4 11.6a1.4 1.4 0 0 0 2 2l4.7-4.7a3.4 3.4 0 0 0 4.5-3.1l-2 2-1.9-.4-.4-1.9 2-2a3.4 3.4 0 0 0-1.1-.1Z',
  alert: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8M8 4.8v4M8 11v.4',
  plugin: 'M6 2.4v2.4M10 2.4v2.4M4 4.8h8v3.2a4 4 0 0 1-8 0V4.8ZM8 12v2',
  'external-link': 'M9.4 2.6h4v4M13.4 2.6 7.4 8.6M11.6 9.4v3.2a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5.4a1 1 0 0 1 1-1h3.2',
  // Plugin area: overflow menu, refresh, trust shield, trash, update arrow.
  // Vertical kebab (⋮) for every overflow menu.
  // 溢出選單（kebab）：三個垂直置中的實心圓點，比例同 Material 的 more_vert
  // （24 格 r 2、y 6/12/18 → 16 格 r 1.333、y 4/8/12）。以填色繪製（見 FILLED_ICONS），每點兩段半圓弧。
  more: 'M8 2.667a1.333 1.333 0 1 1 0 2.666 1.333 1.333 0 0 1 0-2.666ZM8 6.667a1.333 1.333 0 1 1 0 2.666 1.333 1.333 0 0 1 0-2.666ZM8 10.667a1.333 1.333 0 1 1 0 2.666 1.333 1.333 0 0 1 0-2.666Z',
  refresh: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.7M13.2 2.6v2.8H10.4',
  shield: 'M8 1.8 13 3.6v4c0 3-2.2 5.2-5 6.6-2.8-1.4-5-3.6-5-6.6v-4zM5.8 8l1.6 1.6 3-3.2',
  trash: 'M3 4.4h10M6.2 4.4V2.8h3.6v1.6M4.4 4.4l.5 8.8h6.2l.5-8.8M6.8 7v3.8M9.2 7v3.8',
  'arrow-up': 'M8 13V3M3.8 7.2 8 3l4.2 4.2',
}

export type IconName = keyof typeof ICON_PATHS

// 以實心繪製（fill currentColor、不描線）的圖示；ICON_PATHS 其餘圖示維持 1.4 線條。
export const FILLED_ICONS: ReadonlySet<string> = new Set(['more'])
