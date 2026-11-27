// 對比、亮度與明暗方向的問題在明度上是單調的，所以每個方向先二分搜尋邊界；
// 結果與由近而遠逐格搜尋相同，且是確定性的。

import { formatPanelThemeColor, oklchToRgb, rgbToOklch, type PanelThemeRgba } from './panel-theme-color.ts'
import {
  PANEL_THEME_STATE_HUES,
  minimumPanelThemeOverlay,
  panelThemeModeCheckInput,
  panelThemeModeIssues,
  panelThemeModeIssuesReading,
  PanelThemeValidationError,
  resolvePanelThemes,
  type PanelThemeIssue,
  type PanelThemeModeCheckInput,
} from './plugin-panel-themes.ts'
import { parseUserPanelThemeDefinition, userPanelThemeContribution, type UserThemeParseResult } from './panel-theme-user.ts'
import { PANEL_THEME_MODES, type PanelThemeMode } from '../src/types/panel-theme.ts'
import type { PanelThemeDiagnostic, PanelThemeValidation } from '../src/types/panel-theme-user.ts'

export const PANEL_THEME_DIAGNOSTIC_MAX_ISSUES = 64
// 每個模式各自的候選數上限，讓最壞情況的時間有界。
export const PANEL_THEME_SUGGESTION_BUDGET = 1600
const LIGHTNESS_STEP = 0.01
const MAX_STEPS = 100
const MONOTONE_KINDS: ReadonlySet<PanelThemeIssue['kind']> = new Set(['contrast', 'luminance', 'direction'])
const STATE_MIN_SUGGESTED_CHROMA = 0.09

function issueId(issue: PanelThemeIssue): string {
  return `${issue.path}\u0000${issue.kind}\u0000${issue.foreground ?? ''}\u0000${issue.background ?? ''}`
}

// 取區間內最典型的色相而非最近的邊界，避免把「危險」建議成接近橘色的值。
export const PANEL_THEME_STATE_PREFERRED_HUES: Readonly<Record<keyof typeof PANEL_THEME_STATE_HUES, number>> = Object.freeze({
  dangerText: 27,
  successText: 140,
  warnText: 75,
  infoText: 250,
})

function replaced(input: PanelThemeModeCheckInput, group: 'colors' | 'petStatus', key: string, color: PanelThemeRgba): PanelThemeModeCheckInput {
  if (group === 'colors') return { ...input, colors: { ...input.colors, [key]: color } }
  return { ...input, petStatus: { ...input.petStatus!, [key]: color } }
}

interface Budget { remaining: number }

interface CandidateResult {
  fixed: boolean
  /** 不能產生原本不存在的新問題。 */
  accepted: boolean
}

function suggestColor(input: PanelThemeModeCheckInput, issue: PanelThemeIssue, current: readonly PanelThemeIssue[], budget: Budget): string | undefined {
  const match = /^(colors|petStatus)\.([A-Za-z0-9]+)$/.exec(issue.path)
  if (!match) return undefined
  const group = match[1] as 'colors' | 'petStatus'
  const key = match[2]!
  const color = group === 'colors' ? input.colors[key as keyof typeof input.colors] : input.petStatus?.[key as keyof NonNullable<typeof input.petStatus>]
  if (!color) return undefined
  const baseline = new Set<string>()
  const failing = new Set<string>()
  let monotone = true
  for (const other of current) {
    if (other.path !== issue.path) {
      baseline.add(issueId(other))
      continue
    }
    failing.add(issueId(other))
    if (!MONOTONE_KINDS.has(other.kind)) monotone = false
  }
  const evaluate = (candidate: PanelThemeRgba): CandidateResult => {
    budget.remaining -= 1
    let accepted = true
    for (const next of panelThemeModeIssuesReading(replaced(input, group, key, candidate), issue.path)) {
      if (next.path === issue.path) {
        if (failing.has(issueId(next))) return { fixed: false, accepted: false }
        accepted = false
      } else if (!baseline.has(issueId(next))) {
        accepted = false
      }
    }
    return { fixed: true, accepted }
  }
  if (issue.kind === 'alpha') {
    const candidate = { ...color, a: issue.required ?? 1 }
    return evaluate(candidate).accepted ? formatPanelThemeColor(candidate) : undefined
  }
  const start = rgbToOklch(color)
  let hue = start.h
  let chroma = start.c
  if (group === 'colors' && current.some(other => other.path === issue.path && (other.kind === 'hue' || other.kind === 'chroma'))) {
    hue = PANEL_THEME_STATE_PREFERRED_HUES[key as keyof typeof PANEL_THEME_STATE_PREFERRED_HUES] ?? hue
    chroma = Math.max(chroma, STATE_MIN_SUGGESTED_CHROMA)
  }
  const lightnessAt = (step: number) => start.l + step * LIGHTNESS_STEP
  const inRange = (step: number) => {
    const lightness = lightnessAt(step)
    return lightness >= 0 && lightness <= 1
  }
  const results = new Map<number, CandidateResult | null>()
  const resultAt = (step: number): CandidateResult | null => {
    if (results.has(step)) return results.get(step)!
    const candidate = oklchToRgb(lightnessAt(step), chroma, hue, color.a)
    let result: CandidateResult | null
    if (candidate.r === color.r && candidate.g === color.g && candidate.b === color.b) result = { fixed: false, accepted: false }
    else if (budget.remaining <= 0) result = null
    else result = evaluate(candidate)
    results.set(step, result)
    return result
  }
  const format = (step: number) => formatPanelThemeColor(oklchToRgb(lightnessAt(step), chroma, hue, color.a))
  if (resultAt(0)?.accepted) return format(0)
  const firstAccepted = (direction: 1 | -1, limit: number): number | null => {
    let last = Math.min(MAX_STEPS, limit)
    while (last > 0 && !inRange(direction * last)) last -= 1
    if (last < 1) return null
    let from = 1
    if (monotone) {
      const far = resultAt(direction * last)
      if (!far?.fixed) return null
      let low = 1
      let high = last
      while (low < high) {
        const middle = (low + high) >> 1
        const result = resultAt(direction * middle)
        if (result === null) return null
        if (result.fixed) high = middle
        else low = middle + 1
      }
      from = low
    }
    for (let step = from; step <= last; step += 1) {
      const result = resultAt(direction * step)
      if (result === null) return null
      if (result.accepted) return step
    }
    return null
  }
  // 暗的方向只需要找比亮的方向更近的解。
  const lighter = firstAccepted(1, MAX_STEPS)
  const darker = firstAccepted(-1, lighter === null ? MAX_STEPS : lighter - 1)
  if (darker !== null) return format(-darker)
  return lighter === null ? undefined : format(lighter)
}

function suggestion(input: PanelThemeModeCheckInput, issue: PanelThemeIssue, current: readonly PanelThemeIssue[], budget: Budget): string | number | undefined {
  if (issue.kind === 'overlay') return issue.required
  return suggestColor(input, issue, current, budget)
}

export function userPanelThemeSchemaFailure(parsed: Extract<UserThemeParseResult<unknown>, { ok: false }>): PanelThemeValidation {
  return { valid: false, schemaError: { path: parsed.path, problem: parsed.problem }, issues: [], minDim: {} }
}

export function validateUserPanelTheme(value: unknown): PanelThemeValidation {
  const parsed = parseUserPanelThemeDefinition(value)
  if (!parsed.ok) return userPanelThemeSchemaFailure(parsed)
  const contribution = userPanelThemeContribution('draft', 'Draft', parsed.value)
  const modes = contribution.modes as Record<PanelThemeMode, unknown>
  const issues: PanelThemeDiagnostic[] = []
  const minDim: Partial<Record<PanelThemeMode, number>> = {}
  for (const mode of PANEL_THEME_MODES) {
    const budget: Budget = { remaining: PANEL_THEME_SUGGESTION_BUDGET }
    let input: PanelThemeModeCheckInput
    try {
      input = panelThemeModeCheckInput(modes[mode], mode)
    } catch (error) {
      if (!(error instanceof PanelThemeValidationError)) throw error
      return { valid: false, schemaError: { path: mode, problem: error.diagnostic }, issues: [], minDim: {} }
    }
    if (input.userImageOverlay) {
      const minimum = minimumPanelThemeOverlay(input.colors, input.userImageOverlay.color, 1)
      if (minimum !== null) minDim[mode] = minimum
    }
    const modeIssues = [...panelThemeModeIssues(input)]
    const suggested = new Map<string, string | number | undefined>()
    for (const issue of modeIssues) {
      if (issues.length >= PANEL_THEME_DIAGNOSTIC_MAX_ISSUES) break
      if (!suggested.has(issue.path)) suggested.set(issue.path, suggestion(input, issue, modeIssues, budget))
      const value = suggested.get(issue.path)
      issues.push({ mode, ...issue, ...(value !== undefined ? { suggested: value } : {}) })
    }
  }
  const valid = issues.length === 0 && resolvePanelThemes([contribution]) !== null
  return { valid, issues, minDim }
}
