// Pure keyboard navigation for the Tabs primitive (WAI-ARIA tabs pattern).
export type TabOrientation = 'horizontal' | 'vertical'

export interface TabNavItem {
  id: string
  disabled?: boolean
}

/**
 * The tab that should receive focus after `key`, or `null` when the key is
 * not a navigation key for this orientation. Wraps around; skips disabled.
 */
export function nextTabId(
  items: readonly TabNavItem[],
  currentId: string,
  key: string,
  orientation: TabOrientation = 'horizontal',
): string | null {
  const enabled = items.filter((item) => !item.disabled)
  if (!enabled.length) return null
  const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  if (key === 'Home') return enabled[0].id
  if (key === 'End') return enabled[enabled.length - 1].id
  if (key !== prev && key !== next) return null
  const index = enabled.findIndex((item) => item.id === currentId)
  const step = key === next ? 1 : -1
  const from = index < 0 ? (step > 0 ? -1 : 0) : index
  return enabled[(from + step + enabled.length) % enabled.length].id
}

export function tabDomId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`
}

export function panelDomId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`
}
