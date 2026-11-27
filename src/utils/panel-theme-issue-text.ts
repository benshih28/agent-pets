import type { PanelThemeDiagnostic } from '../types/panel-theme-user.ts'

export type IssueTranslate = (key: string, params?: Record<string, string | number>) => string

const STATE_KEYS = new Set(['dangerText', 'successText', 'warnText', 'infoText'])

interface SurfaceRule {
  pattern: RegExp
  render: (match: RegExpExecArray, label: (name: string) => string, translate: IssueTranslate) => string
}

/** 依序比對；組合型的名稱（焦點框、額度條）先拆外層再遞迴處理內層。 */
const SURFACE_RULES: readonly SurfaceRule[] = [
  { pattern: /^(.+) \(focus ring\)$/, render: (m, label, tr) => tr('themeEditor.surface.focus', { base: label(m[1]!) }) },
  { pattern: /^(.+) \(quota fill\)$/, render: (m, label, tr) => tr('themeEditor.surface.quotaFill', { base: label(m[1]!) }) },
  { pattern: /^(?:the quota track on the|quotaTrack on the) (.+)$/, render: (m, label, tr) => tr('themeEditor.surface.quotaTrack', { base: label(m[1]!) }) },
  { pattern: /^accentOnHover over (\w+)$/, render: (m, label, tr) => tr('themeEditor.surface.hover', { base: label(m[1]!) }) },
  { pattern: /^(\w+) at [\d.]+ over (\w+) \(state chip\)$/, render: (m, label, tr) => tr('themeEditor.surface.chip', { state: label(m[1]!), base: label(m[2]!) }) },
  { pattern: /^pet bubble over a (black|white) desktop$/, render: (m, _label, tr) => tr('themeEditor.surface.petBubble', { desktop: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^dangerText at [\d.]+ over the pet overlay over a (black|white) desktop \(danger button hover\)$/, render: (m, _label, tr) => tr('themeEditor.surface.petOverlayDangerHover', { desktop: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^pet overlay over a (black|white) desktop$/, render: (m, _label, tr) => tr('themeEditor.surface.petOverlay', { desktop: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^(?:pet status pill|pill) over a (black|white) desktop$/, render: (m, _label, tr) => tr('themeEditor.surface.petPill', { desktop: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^gradient stop (\d+)$/, render: (m, _label, tr) => tr('themeEditor.surface.gradientStop', { index: Number(m[1]) + 1 }) },
  { pattern: /^gradient between stops (\d+) and (\d+)$/, render: (m, _label, tr) => tr('themeEditor.surface.gradientBetween', { from: Number(m[1]) + 1, to: Number(m[2]) + 1 }) },
  { pattern: /^overlay over a (black|white) pixel$/, render: (m, _label, tr) => tr('themeEditor.surface.overlayPixel', { pixel: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^(black|white) image pixel$/, render: (m, _label, tr) => tr('themeEditor.surface.imagePixel', { pixel: tr(`themeEditor.desktop.${m[1]}`) }) },
  { pattern: /^(\w+) \(badge fill\)$/, render: (m, label, tr) => tr('themeEditor.surface.badgeFill', { state: label(m[1]!) }) },
  { pattern: /^accentHover mixed 12% toward text \(hovered primary button\)$/, render: (_m, _label, tr) => tr('themeEditor.surface.pressed') },
]

/** 規則表涵蓋驗證器會產生的每一種名稱（測試逐一列舉）；新名稱顯示中性的「另一個表面」，不顯示英文內部名稱。 */
export function surfaceLabel(name: string, keyLabel: (key: string) => string | null, translate: IssueTranslate): string {
  const label = (inner: string): string => surfaceLabel(inner, keyLabel, translate)
  for (const rule of SURFACE_RULES) {
    const match = rule.pattern.exec(name)
    if (match) return rule.render(match, label, translate)
  }
  return keyLabel(name) ?? translate('themeEditor.surface.other')
}

function ratio(value: number | undefined): string {
  return value === undefined ? '' : (Math.floor(value * 100) / 100).toFixed(2)
}

export function describeIssue(issue: PanelThemeDiagnostic, keyLabel: (key: string) => string | null, translate: IssueTranslate): string {
  const ownKey = issue.path.split('.')[1] ?? ''
  const surface = (name: string | undefined) => surfaceLabel(name ?? '', keyLabel, translate)
  switch (issue.kind) {
    case 'contrast': {
      const params = { measured: ratio(issue.measured), background: surface(issue.background), required: issue.required ?? '' }
      // 被歸咎的是半透明的底（懸停底）時，說出是哪個文字在它上面不夠清楚。
      return issue.foreground && issue.foreground !== ownKey
        ? translate('themeEditor.issue.contrastPair', { ...params, foreground: keyLabel(issue.foreground) ?? translate('themeEditor.surface.otherText') })
        : translate('themeEditor.issue.contrast', params)
    }
    case 'hue':
      return STATE_KEYS.has(ownKey)
        ? translate('themeEditor.issue.hue', { meaning: translate(`themeEditor.meaning.${ownKey}`), measured: Math.round(issue.measured ?? 0) })
        : translate('themeEditor.issue.chroma')
    case 'chroma':
      return translate('themeEditor.issue.chroma')
    case 'distance':
      return translate('themeEditor.issue.distance', { background: surface(issue.background) })
    case 'direction':
      return translate(issue.mode === 'light' ? 'themeEditor.issue.directionLight' : 'themeEditor.issue.directionDark')
    case 'luminance':
      return translate(issue.path === 'colors.shadow' ? 'themeEditor.issue.shadow' : 'themeEditor.issue.highlight')
    case 'alpha':
      return translate('themeEditor.issue.alpha')
    case 'overlay':
      return issue.required === undefined
        ? translate('themeEditor.issue.overlayNone')
        : translate('themeEditor.issue.overlay', { measured: issue.measured ?? '', required: issue.required })
  }
}
