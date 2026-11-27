import { nextTabId, type TabOrientation } from '../utils/tab-navigation.ts'

export type RovingOrientation = TabOrientation

export function nextRovingId(
  ids: readonly string[],
  current: string,
  key: string,
  orientation: RovingOrientation = 'horizontal',
): string | null {
  return nextTabId(ids.map(id => ({ id })), current, key, orientation)
}

interface RovingTabsOptions {
  ids: () => readonly string[]
  current: () => string
  select: (id: string) => void
  elementId: (id: string) => string
  orientation?: RovingOrientation
}

export function useRovingTabs(options: RovingTabsOptions) {
  function onKeydown(event: KeyboardEvent): void {
    const next = nextRovingId(options.ids(), options.current(), event.key, options.orientation)
    if (!next) return
    event.preventDefault()
    options.select(next)
    document.getElementById(options.elementId(next))?.focus()
  }
  return { onKeydown }
}
