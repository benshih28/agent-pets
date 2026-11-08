// 寵物狀態列的寬度預算：狀態詞永遠完整、狀態列永遠單行。
// 放不下時依序拿掉「+N」、插件徽章（由後往前），再讓名稱以省略號縮短、拿掉名稱，最後才拿掉 Quota 百分比
// （分段條仍在，百分比也還在提示框與 aria-label 裡）。
// 寬度由呼叫端的 measure() 提供（renderer 用 canvas measureText，測試用假的），
// 這裡只做加總與取捨，所以是純函式。

export type StatusLinePart = 'label' | 'state' | 'badge' | 'readout'
export type MeasureText = (text: string, part: StatusLinePart) => number

export interface StatusLineFitInput {
  /** 狀態列的內容寬度（外寬扣掉 padding 與邊框）。 */
  contentWidth: number
  /** 工具家族名稱；沒有家族的整體狀態列為 ''。 */
  label: string
  /** 狀態列上的狀態詞，永遠不縮短。 */
  state: string
  /** Quota 百分比文字（如 '71%'）；沒有 Quota 時為 null。 */
  readout: string | null
  /** 插件徽章文字，依顯示順序。 */
  badges: readonly string[]
  /** 超過每隻寵物上限的徽章數（「+N」）。 */
  hiddenCount: number
}

export interface StatusLineFit {
  showLabel: boolean
  showReadout: boolean
  badgeCount: number
  showOverflow: boolean
}

// 與 DesktopPet.css 對應的尺寸；tests/status-line-fit.test.mts 會檢查兩邊一致。
export const STATUS_LINE_GEOMETRY = {
  /** .status-line 左右 padding 各 9px。 */
  paddingX: 9,
  /** .status-line 左右邊框各 1px。 */
  borderX: 1,
  /** .status-line 項目之間的 gap。 */
  gap: 5,
  /** .line-dot 寬度。 */
  dot: 8,
  /** .line-sep 的 margin-left。 */
  sepMarginLeft: 3,
  /** .line-text + .line-state 從 gap 拉回的距離，讓分隔點兩側都是 3px。 */
  statePullBack: 2,
  /** .plugin-status-badges 的 gap。 */
  badgeGap: 3,
  /** .plugin-badge-pill 左右 padding 各 5px（邊框同 borderX）。 */
  badgePaddingX: 5,
  /** .plugin-badge-anchor 的 max-width：徽章最寬到這裡，較長的文字以省略號收尾。 */
  badgeMax: 42,
  /** .plugin-badge-overflow 的 max-width。 */
  overflowMax: 36,
  /** .quota-readout 的 min-width。 */
  readoutMin: 25,
  /** .status-line 的 max-width 是 var(--pet-w) 減去這個值。 */
  petInsetX: 14,
  /** 多寵物狀態列寬度是 192px × 寵物倍率減去這個值。 */
  multiPetInsetX: 12,
  /** 預留給次像素捨入與字型差異的空間。 */
  slack: 2,
} as const

/** 多寵物狀態列的最小寬度（.multi-pet-status-line），仍在 0.6 倍寵物欄內。 */
export const MULTI_PET_LINE_MIN_W = 112
export const MULTI_PET_SPRITE_W = 192

// 各部分文字的字型；DesktopPet.vue 以此組出 canvas 字型，測試檢查它與 CSS 一致。
export const STATUS_TEXT_FONTS: Readonly<Record<StatusLinePart, { weight: number; sizeVar: string; sizeFallback: string; familyVar: string }>> = {
  label: { weight: 600, sizeVar: '--font-sm', sizeFallback: '12px', familyVar: '--organic-font-body' },
  state: { weight: 400, sizeVar: '--font-sm', sizeFallback: '12px', familyVar: '--organic-font-body' },
  badge: { weight: 600, sizeVar: '--font-xs', sizeFallback: '11px', familyVar: '--organic-font-body' },
  readout: { weight: 400, sizeVar: '--organic-font-body-lg', sizeFallback: '15px', familyVar: '--organic-font-heading' },
}

const g = STATUS_LINE_GEOMETRY
const CHROME_X = 2 * (g.paddingX + g.borderX)
const BADGE_CHROME_X = 2 * (g.badgePaddingX + g.borderX)

/**
 * 狀態列內容寬度。單寵物的上限是寵物視窗寬（--pet-w，即 store.scaledW）減 14px；
 * 多寵物填滿各自的寵物欄，最小 112px。
 */
export function statusLineContentWidth(multiPet: boolean, petScale: number, petWindowWidth: number): number {
  const outer = multiPet
    ? Math.max(MULTI_PET_SPRITE_W * petScale - g.multiPetInsetX, MULTI_PET_LINE_MIN_W)
    : petWindowWidth - g.petInsetX
  return outer - CHROME_X
}

/** 依取捨結果算出狀態列內容需要的寬度（不含 slack）。 */
export function statusLineWidth(input: StatusLineFitInput, fit: StatusLineFit, measure: MeasureText): number {
  const items = [g.dot, measure(input.state, 'state')]
  if (fit.showLabel && input.label) {
    // 徽章比名稱先讓位：只要還有徽章，名稱就要完整寬度；徽章都拿掉後，名稱才可縮到 CSS 的 min-width（2ch）。
    const sep = measure('·', 'state') + g.sepMarginLeft - g.statePullBack
    const full = measure(input.label, 'label')
    const keepFull = fit.badgeCount > 0 || (fit.showOverflow && input.hiddenCount > 0)
    items.push((keepFull ? full : Math.min(full, measure('00', 'label'))) + sep)
  }
  if (fit.showReadout && input.readout) items.push(Math.max(g.readoutMin, measure(input.readout, 'readout')))
  const group = input.badges.slice(0, fit.badgeCount).map(text => Math.min(g.badgeMax, measure(text, 'badge') + BADGE_CHROME_X))
  if (fit.showOverflow && input.hiddenCount > 0) {
    group.push(Math.min(g.overflowMax, measure(`+${input.hiddenCount}`, 'badge') + BADGE_CHROME_X))
  }
  if (group.length > 0) items.push(group.reduce((sum, w) => sum + w, 0) + g.badgeGap * (group.length - 1))
  return items.reduce((sum, w) => sum + w, 0) + g.gap * (items.length - 1)
}

export function fitStatusLine(input: StatusLineFitInput, measure: MeasureText): StatusLineFit {
  const budget = input.contentWidth - g.slack
  const badgeCount = input.badges.length
  const candidates: StatusLineFit[] = [
    { showLabel: true, showReadout: true, badgeCount, showOverflow: input.hiddenCount > 0 },
  ]
  if (input.hiddenCount > 0) candidates.push({ showLabel: true, showReadout: true, badgeCount, showOverflow: false })
  for (let count = badgeCount - 1; count >= 0; count -= 1) {
    candidates.push({ showLabel: true, showReadout: true, badgeCount: count, showOverflow: false })
  }
  candidates.push({ showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
  const last: StatusLineFit = { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false }
  return candidates.find(fit => statusLineWidth(input, fit, measure) <= budget) ?? last
}
