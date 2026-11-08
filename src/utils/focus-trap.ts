// Tab 焦點陷阱的純函式：給 ConfirmDialog 與安裝 Sheet 共用。
export const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 回傳 Tab / Shift+Tab 之後應該聚焦的索引；null 代表瀏覽器預設行為即可。 */
export function nextTrapIndex(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null
  if (backwards && current <= 0) return count - 1
  if (!backwards && current === count - 1) return 0
  if (current < 0) return backwards ? count - 1 : 0
  return null
}
