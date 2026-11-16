// Shared arrow-key wiring for tablists and radio groups. 演算法只有一份
// （utils/tab-navigation 的 nextTabId）；這裡只負責把純字串 id 轉成它的輸入，
// 並保留 nextRovingId 這個匯出名稱給既有呼叫端與測試。
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
