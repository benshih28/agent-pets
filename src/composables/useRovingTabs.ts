// Shared arrow-key behaviour for tablists and radio groups: ←/→ (or ↑/↓ when
// vertical) wrap around, Home/End jump to the ends. Pure helper kept separate
// from the DOM wiring so it can be unit tested.

export type RovingOrientation = 'horizontal' | 'vertical'

export function nextRovingId(
  ids: readonly string[],
  current: string,
  key: string,
  orientation: RovingOrientation = 'horizontal',
): string | null {
  if (ids.length === 0) return null
  const index = ids.indexOf(current)
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  if (key === forward) return ids[(index + 1 + ids.length) % ids.length]
  if (key === backward) return ids[(index - 1 + ids.length) % ids.length]
  return null
}

interface RovingTabsOptions {
  ids: () => readonly string[]
  current: () => string
  select: (id: string) => void
  /** DOM id of a tab: usually `${prefix}${id}`; focus follows the selection. */
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
