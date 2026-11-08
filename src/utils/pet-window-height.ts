// 寵物視窗高度預算。狀態列以 DOM 量測畫出，但視窗大小由這裡事先決定；
// 少算的高度會讓內容往上擠進 tooltip 預留空間，Windows 分層視窗會直接裁掉。
// 狀態列一律是單行細條（專案名稱只在 tooltip / aria-label），所以只看行數。

export const PET_BASE_H = 232 // canvas + 1 status line
export const STATUS_LINE_EXTRA_H = 22 // per additional status line beyond the first
// The quota tooltip pops open above the status line and is rendered at a
// fixed (unscaled) size regardless of pet size (see DesktopPet.vue), so this
// headroom must stay fixed too rather than scaling with petScale. Without
// it the pet window's transparent canvas is sized exactly to the visible
// sprite + status line with no slack above — fine on macOS, where the
// compositor tolerates content painted slightly outside a layer-backed
// window's bounds, but Windows' layered-window transparency hard-clips to
// the window rectangle, so the tooltip got cut off / visibly broken there.
export const QUOTA_TOOLTIP_HEADROOM_H = 190

export function petWindowHeight(lineCount: number, multiPet: boolean, petScale: number): number {
  // Multi-pet mode lays families out side by side with one short label
  // each, instead of stacking a status line per family, so it doesn't
  // need the per-line height growth the single-pet mode does.
  const extraLines = multiPet ? 0 : (Math.max(1, lineCount) - 1) * STATUS_LINE_EXTRA_H
  return Math.round((PET_BASE_H + extraLines) * petScale) + QUOTA_TOOLTIP_HEADROOM_H
}
