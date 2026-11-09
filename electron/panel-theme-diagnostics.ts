// 主題編輯器的驗證診斷（spec R21）。純函式：不 import Electron 或 Node。
//
// 與插件主題用同一個驗證器：先嚴格解析使用者定義，再把每個模式交給 panelThemeModeIssues
// （parsePanelThemes 只取它的第一個值）。這裡走完所有問題，並為每個出錯的鍵找一個「建議值」：
// 保留色相與色度、只在 OKLCH 明度上找離原值最近的格點（0.01），接受的條件是「這個鍵的問題全部
// 消失，而且沒有產生任何新問題」。狀態色的色相／色度問題先把色相移進允許區間。
//
// 演算法：只換一個鍵時，沒讀到這個鍵的檢查結果不變，所以每個候選色只重跑讀到它的檢查
// （panelThemeModeIssuesReading）。對比、亮度與明暗方向的問題在明度上是單調的（往任一方向
// 離開失敗區間之後就一直通過），所以每個方向先二分搜尋「原本的問題消失」的邊界，再從邊界
// 往外逐格找第一個完全被接受的值——結果與由近而遠逐格搜尋相同。每個模式各自有候選數上限，
// 所以最壞情況的時間是有界的；結果是確定性的（同樣的輸入一定得到同樣的建議）。

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

/** 回傳的問題數上限（payload 有界）。 */
export const PANEL_THEME_DIAGNOSTIC_MAX_ISSUES = 64
/** 每個模式最多評估的候選色數（該模式所有鍵合計）；一個模式用完不影響另一個模式的建議。 */
export const PANEL_THEME_SUGGESTION_BUDGET = 1600
const LIGHTNESS_STEP = 0.01
const MAX_STEPS = 100
/** 在 OKLCH 明度上單調的問題種類：可以二分搜尋邊界。 */
const MONOTONE_KINDS: ReadonlySet<PanelThemeIssue['kind']> = new Set(['contrast', 'luminance', 'direction'])
const STATE_MIN_SUGGESTED_CHROMA = 0.09

function issueId(issue: PanelThemeIssue): string {
  return `${issue.path}\u0000${issue.kind}\u0000${issue.foreground ?? ''}\u0000${issue.background ?? ''}`
}

/**
 * 狀態色的建議色相：各自允許區間（PANEL_THEME_STATE_HUES）裡最典型的位置（紅、綠、琥珀、藍），
 * 而不是離目前色相最近的邊界，避免把「危險」建議成接近橘色的邊界值。
 */
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
  /** 原本這個鍵的問題都消失了（不論是否產生新問題）。 */
  fixed: boolean
  /** 這個鍵沒有任何問題，而且沒有出現原本不存在的問題。 */
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
  // 同一個格點只評估一次（二分搜尋與逐格搜尋共用）。原色本身一定還有原本的問題，不必評估。
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
  /** 一個方向上第一個被接受的格數（不超過 limit）；沒有或候選數用完時為 null。 */
  const firstAccepted = (direction: 1 | -1, limit: number): number | null => {
    let last = Math.min(MAX_STEPS, limit)
    while (last > 0 && !inRange(direction * last)) last -= 1
    if (last < 1) return null
    let from = 1
    if (monotone) {
      // 最遠的格點都還沒修好，這個方向就沒有解。
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
  // 與由近而遠、先亮後暗的逐格搜尋相同：暗的方向只需要找比亮的方向更近的解。
  const lighter = firstAccepted(1, MAX_STEPS)
  const darker = firstAccepted(-1, lighter === null ? MAX_STEPS : lighter - 1)
  if (darker !== null) return format(-darker)
  return lighter === null ? undefined : format(lighter)
}

function suggestion(input: PanelThemeModeCheckInput, issue: PanelThemeIssue, current: readonly PanelThemeIssue[], budget: Budget): string | number | undefined {
  // 覆蓋層：最小值就是建議值（沒有任何值能通過時不給建議）。
  if (issue.kind === 'overlay') return issue.required
  return suggestColor(input, issue, current, budget)
}

/** 結構或文法錯誤的驗證結果（不做任何語意檢查）。 */
export function userPanelThemeSchemaFailure(parsed: Extract<UserThemeParseResult<unknown>, { ok: false }>): PanelThemeValidation {
  return { valid: false, schemaError: { path: parsed.path, problem: parsed.problem }, issues: [], minDim: {} }
}

/**
 * 驗證一份「我的主題」定義（不安裝、不儲存）。結構或文法錯誤只回報第一個；語意問題全部列出
 * （每個模式依驗證器的順序，總數有上限），每個出錯的鍵附上建議值。
 */
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
  // 最後以安裝／套用時的同一個入口再確認一次（字型組合、圓角與兩個模式一起）。
  const valid = issues.length === 0 && resolvePanelThemes([contribution]) !== null
  return { valid, issues, minDim }
}
