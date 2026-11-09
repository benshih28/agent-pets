import { formatPanelThemeColor, oklchToRgb, rgbToOklab, rgbToOklch, validateUserPanelTheme, withAlpha, type PanelThemeRgba } from './panel-theme-host.ts'
import type { PanelThemeMode } from '../types/panel-theme.ts'
import type { UserPanelThemeDefinition } from '../types/panel-theme-user.ts'
import type { PluginPanelThemeColorKey } from '../types/plugin.ts'

// 主題編輯器的色盤產生器（spec R23）。純函式、確定性：同樣的輸入一定得到同樣的色盤。
//
// 1. 種子色 → 淺色與深色兩套完整色盤：在 OKLCH 中以固定的明度階層排出表面、文字與強調色，
//    中性色只帶一點種子色相；狀態色固定在各自的色相區間（紅、綠、琥珀、藍）。排好之後交給
//    與插件主題相同的驗證器，逐輪套用它的建議值（最多 PALETTE_REPAIR_ROUNDS 輪），所以產出的
//    色盤一定符合所有不變量，或明確回報仍有問題。
// 2. 背景圖 → 主色：渲染端把圖片縮到 ≤ 128 px 畫在 canvas 上，這裡對像素做固定次數的
//    k-means（OKLab 空間，O(n·k·迭代)），挑出最常見且夠鮮豔的顏色當種子。

type ColorRecord = Record<PluginPanelThemeColorKey, string>

export const PALETTE_REPAIR_ROUNDS = 4
export const IMAGE_SAMPLE_MAX_SIDE = 128
export const IMAGE_CLUSTER_COUNT = 6
export const IMAGE_KMEANS_ITERATIONS = 8
/** k-means 處理的像素上限（≤ 128 × 128）；更大的輸入以固定間隔取樣。 */
export const IMAGE_MAX_SAMPLES = IMAGE_SAMPLE_MAX_SIDE * IMAGE_SAMPLE_MAX_SIDE

/** 狀態色的色相與色度（OKLCH），在兩個模式都落在驗證器的區間內。 */
const STATE_TONES = {
  dangerText: { h: 27, c: 0.15 },
  successText: { h: 140, c: 0.12 },
  warnText: { h: 75, c: 0.12 },
  infoText: { h: 250, c: 0.11 },
} as const
const SAGE_HUE = 125

interface Seed { l: number; c: number; h: number }

function rgb(l: number, c: number, h: number, alpha = 1): PanelThemeRgba {
  return oklchToRgb(l, c, h, alpha)
}

function format(color: PanelThemeRgba): string {
  return formatPanelThemeColor(color)
}

/**
 * 一個模式的初始色盤。`neutralHue` 讓中性色（背景、表面、文字）帶一點顏色；
 * 灰色種子（色度很低）時中性色與強調色都維持灰階附近。
 */
function basePalette(mode: PanelThemeMode, seed: Seed, neutralHue: number): ColorRecord {
  const tint = Math.min(seed.c, 0.12) * 0.25
  const accentChroma = Math.min(Math.max(seed.c, 0.02), 0.16)
  const light = mode === 'light'
  const n = (l: number, scale = 1) => format(rgb(l, tint * scale, neutralHue))
  const text = rgb(light ? 0.24 : 0.94, tint * 0.6, neutralHue)
  const accent = rgb(light ? 0.56 : 0.72, accentChroma, seed.h)
  const state = (tone: { h: number; c: number }) => format(rgb(light ? 0.47 : 0.8, tone.c, tone.h))
  const sageDark = rgb(light ? 0.37 : 0.86, 0.06, SAGE_HUE)
  const textAlpha = (alpha: number) => format(withAlpha(text, alpha))
  return {
    bg: n(light ? 0.95 : 0.2),
    surface: n(light ? 0.975 : 0.24),
    surface2: n(light ? 0.925 : 0.28),
    surfaceWarm: format(rgb(light ? 0.93 : 0.32, Math.min(accentChroma, 0.05), seed.h)),
    surfaceSage: format(rgb(light ? 0.93 : 0.3, 0.04, SAGE_HUE)),
    surfaceSageSoft: format(rgb(light ? 0.965 : 0.27, 0.025, SAGE_HUE)),
    surfaceOff: n(light ? 0.88 : 0.33),
    text: format(text),
    textSecondary: n(light ? 0.42 : 0.82, 0.8),
    textMuted: n(light ? 0.44 : 0.76, 0.8),
    textFaint: n(light ? 0.58 : 0.6, 0.6),
    accent: format(accent),
    accentHover: format(rgb(light ? 0.48 : 0.78, accentChroma, seed.h)),
    accentText: format(rgb(light ? 0.42 : 0.82, Math.min(accentChroma, 0.13), seed.h)),
    onAccent: format(light ? rgb(0.99, 0.01, seed.h) : rgb(0.2, tint * 0.6, neutralHue)),
    accentGlow: format(withAlpha(accent, light ? 0.2 : 0.28)),
    accentTrack: textAlpha(light ? 0.08 : 0.1),
    accentOnHover: textAlpha(light ? 0.05 : 0.06),
    sage: format(rgb(light ? 0.62 : 0.72, 0.06, SAGE_HUE)),
    sageDeep: format(rgb(light ? 0.45 : 0.78, 0.07, SAGE_HUE)),
    sageDark: format(sageDark),
    sageTrack: format(withAlpha(sageDark, light ? 0.16 : 0.18)),
    border: textAlpha(light ? 0.16 : 0.18),
    borderSoft: textAlpha(0.1),
    dangerText: state(STATE_TONES.dangerText),
    successText: state(STATE_TONES.successText),
    warnText: state(STATE_TONES.warnText),
    infoText: state(STATE_TONES.infoText),
    scrim: format(light ? rgb(0.3, tint, neutralHue, 0.42) : rgb(0, 0, 0, 0.55)),
    shadow: format(rgb(light ? 0.26 : 0, light ? tint : 0, neutralHue)),
    highlight: format(rgb(1, 0, 0)),
  }
}

export interface PaletteResult {
  definition: UserPanelThemeDefinition
  /** 套用建議值之後是否完全通過；false 時剩下的問題會在編輯器中逐一顯示。 */
  valid: boolean
}

/**
 * 以驗證器的建議值修正色盤：每輪把每個有建議的顏色鍵（以及背景圖的最小遮罩）換成建議值，
 * 直到通過或達到輪數上限。只改顏色與遮罩，不改背景類型、字型或圓角。
 */
export function repairPalette(definition: UserPanelThemeDefinition): PaletteResult {
  let current = structuredClone(definition)
  for (let round = 0; round < PALETTE_REPAIR_ROUNDS; round += 1) {
    const result = validateUserPanelTheme(current)
    if (result.valid) return { definition: current, valid: true }
    if (result.schemaError) return { definition: current, valid: false }
    let changed = false
    const next = structuredClone(current)
    for (const issue of result.issues) {
      const mode = next.modes[issue.mode]
      if (typeof issue.suggested === 'number' && issue.path === 'userImage.overlay.opacity' && mode.image) {
        changed ||= mode.image.dim !== issue.suggested
        mode.image.dim = issue.suggested
        continue
      }
      if (typeof issue.suggested !== 'string') continue
      const [group, key] = issue.path.split('.') as [string, string]
      if (group === 'colors' && mode.colors[key as PluginPanelThemeColorKey] !== issue.suggested) {
        mode.colors[key as PluginPanelThemeColorKey] = issue.suggested
        changed = true
      } else if (group === 'petStatus' && mode.petStatus && mode.petStatus[key as keyof typeof mode.petStatus] !== issue.suggested) {
        mode.petStatus[key as keyof typeof mode.petStatus] = issue.suggested
        changed = true
      }
    }
    if (!changed) return { definition: current, valid: false }
    current = next
  }
  return { definition: current, valid: validateUserPanelTheme(current).valid }
}

export interface SeedOptions {
  /** 中性色的色相；預設與種子相同（背景圖產生時用圖片最常見的顏色）。 */
  neutralHue?: number
}

/** 種子色 → 兩個模式的完整色盤，套在 `base` 上（保留背景、背景圖、膠囊、字型與圓角設定）。 */
export function paletteFromSeed(seedColor: PanelThemeRgba, base: UserPanelThemeDefinition, options: SeedOptions = {}): PaletteResult {
  const seed = rgbToOklch({ ...seedColor, a: 1 })
  // 灰色的色相沒有意義（atan2 的雜訊）；固定為 0 讓結果確定。
  const hue = seed.c < 0.01 ? 0 : seed.h
  const neutralHue = options.neutralHue ?? hue
  const definition = structuredClone(base)
  for (const mode of ['light', 'dark'] as const) {
    definition.modes[mode].colors = basePalette(mode, { l: seed.l, c: seed.c, h: hue }, neutralHue)
    // 背景圖的遮罩預設用新的 bg 色；最小值由修正流程補上。
    const image = definition.modes[mode].image
    if (image) image.overlayColor = definition.modes[mode].colors.bg
  }
  return repairPalette(definition)
}

// ── 背景圖取色 ───────────────────────────────────────────────────────

export interface ImageCluster {
  color: PanelThemeRgba
  /** 該群占取樣像素的比例（0–1）。 */
  weight: number
  chroma: number
}

interface Lab { l: number; a: number; b: number }

/**
 * 對 RGBA 像素（canvas getImageData 的格式）做 k-means。忽略 alpha < 128 的像素；超過
 * IMAGE_MAX_SAMPLES 時以固定間隔取樣。初始中心以確定性的「最遠點」挑選（第一個是亮度中位數
 * 附近的像素），迭代次數固定，所以同一張圖一定得到同樣的結果。依權重由大到小排序。
 */
export function extractDominantColors(pixels: ArrayLike<number>, width: number, height: number, k = IMAGE_CLUSTER_COUNT): ImageCluster[] {
  const total = Math.max(0, Math.floor(width) * Math.floor(height))
  if (total === 0 || pixels.length < total * 4 || k < 1) return []
  const stride = Math.max(1, Math.ceil(total / IMAGE_MAX_SAMPLES))
  const samples: Lab[] = []
  for (let index = 0; index < total; index += stride) {
    const offset = index * 4
    if (pixels[offset + 3]! < 128) continue
    samples.push(rgbToOklab({ r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]!, a: 1 }))
  }
  if (samples.length === 0) return []
  const count = Math.min(k, samples.length)
  const distance = (x: Lab, y: Lab) => (x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2
  const sortedByLightness = samples.map((sample, index) => [sample.l, index] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const centers: Lab[] = [{ ...samples[sortedByLightness[Math.floor(sortedByLightness.length / 2)]![1]]! }]
  const nearest = samples.map(sample => distance(sample, centers[0]!))
  while (centers.length < count) {
    let farthest = 0
    for (let index = 1; index < samples.length; index += 1) if (nearest[index]! > nearest[farthest]!) farthest = index
    if (nearest[farthest]! === 0) break
    const center = { ...samples[farthest]! }
    centers.push(center)
    for (let index = 0; index < samples.length; index += 1) nearest[index] = Math.min(nearest[index]!, distance(samples[index]!, center))
  }
  const assignment = new Uint16Array(samples.length)
  for (let iteration = 0; iteration < IMAGE_KMEANS_ITERATIONS; iteration += 1) {
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, n: 0 }))
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let center = 0; center < centers.length; center += 1) {
        const value = distance(sample, centers[center]!)
        if (value < bestDistance) {
          bestDistance = value
          best = center
        }
      }
      assignment[index] = best
      const sum = sums[best]!
      sum.l += sample.l
      sum.a += sample.a
      sum.b += sample.b
      sum.n += 1
    }
    for (let center = 0; center < centers.length; center += 1) {
      const sum = sums[center]!
      if (sum.n > 0) centers[center] = { l: sum.l / sum.n, a: sum.a / sum.n, b: sum.b / sum.n }
    }
  }
  const sizes = new Array<number>(centers.length).fill(0)
  for (const index of assignment) sizes[index]! += 1
  return centers
    .map((center, index) => {
      const chroma = Math.hypot(center.a, center.b)
      const hue = (Math.atan2(center.b, center.a) * 180) / Math.PI
      return { color: oklchToRgb(center.l, chroma, hue < 0 ? hue + 360 : hue), weight: sizes[index]! / samples.length, chroma }
    })
    .filter(cluster => cluster.weight > 0)
    .sort((x, y) => y.weight - x.weight || y.chroma - x.chroma)
}

/**
 * 從主色挑種子：權重 × (0.25 + 色度) 最高者，讓「大面積又有顏色」的群勝出；全部都很灰時取最大群。
 * 中性色相取最大群（圖片的整體色調）。
 */
export function seedFromClusters(clusters: readonly ImageCluster[]): { seed: PanelThemeRgba; neutralHue: number } | null {
  if (clusters.length === 0) return null
  let best = clusters[0]!
  for (const cluster of clusters) if (cluster.weight * (0.25 + cluster.chroma) > best.weight * (0.25 + best.chroma)) best = cluster
  const dominant = rgbToOklch(clusters[0]!.color)
  return { seed: best.color, neutralHue: dominant.c < 0.01 ? rgbToOklch(best.color).h : dominant.h }
}

/** 縮圖後的尺寸：長邊 ≤ IMAGE_SAMPLE_MAX_SIDE，維持比例，至少 1 px。 */
export function sampleSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_SAMPLE_MAX_SIDE / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
