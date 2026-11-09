import assert from 'node:assert/strict'
import test from 'node:test'
import { oklchToRgb, relativeLuminance, parsePanelThemeColor, rgbToOklch } from '../electron/panel-theme-color.ts'
import { validateUserPanelTheme } from '../electron/panel-theme-diagnostics.ts'
import { PANEL_THEME_STATE_HUES } from '../electron/plugin-panel-themes.ts'
import {
  IMAGE_CLUSTER_COUNT,
  IMAGE_SAMPLE_MAX_SIDE,
  extractDominantColors,
  paletteFromSeed,
  repairPalette,
  sampleSize,
  seedFromClusters,
} from '../src/utils/panel-theme-palette.ts'
import { builtinDefinition } from './support/panel-theme-fixtures.mts'

function color(value: string) {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) throw new Error(value)
  return parsed.color
}

test('every seed — greys, extremes and every hue — yields light and dark palettes that pass all invariants', () => {
  const seeds = []
  for (const lightness of [0, 0.15, 0.5, 0.85, 1]) {
    for (const chroma of [0, 0.004, 0.05, 0.12, 0.25, 0.37]) {
      for (let hue = 0; hue < 360; hue += 10) seeds.push(oklchToRgb(lightness, chroma, hue))
    }
  }
  seeds.push({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }, { r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 255, b: 0, a: 1 }, { r: 0, g: 0, b: 255, a: 1 })
  for (const seed of seeds) {
    const result = paletteFromSeed(seed, builtinDefinition())
    assert.equal(result.valid, true, JSON.stringify(seed))
    for (const mode of ['light', 'dark'] as const) {
      const colors = result.definition.modes[mode].colors
      const bg = relativeLuminance(color(colors.bg))
      assert.ok(mode === 'light' ? bg >= 0.45 : bg <= 0.12, `${mode} bg direction for ${JSON.stringify(seed)}`)
      for (const [key, ranges] of Object.entries(PANEL_THEME_STATE_HUES)) {
        const { h } = rgbToOklch(color(colors[key as keyof typeof colors]))
        assert.ok(ranges.some(([from, to]) => h >= from && h <= to), `${mode}.${key} hue ${h}`)
      }
    }
  }
})

test('the seed generator is deterministic and keeps background, image, font and shape settings', () => {
  const base = builtinDefinition()
  base.typography = { body: 'rounded', heading: 'serif', scale: 1.05 }
  base.shape = { radiusSm: 4, radiusMd: 10, radiusLg: 20 }
  base.modes.light.background = { type: 'gradient', kind: 'linear', angle: 90, stops: [{ color: 'rgb(250 240 240 / 1)', at: 0 }, { color: 'rgb(245 235 230 / 1)', at: 100 }] }
  base.modes.dark.image = { fit: 'cover', overlayColor: 'rgb(0 0 0 / 1)', dim: 0.5 }
  const seed = { r: 180, g: 70, b: 110, a: 1 }
  const first = paletteFromSeed(seed, base)
  assert.deepEqual(paletteFromSeed(seed, base), first)
  assert.equal(first.valid, true)
  assert.deepEqual(first.definition.typography, base.typography)
  assert.deepEqual(first.definition.shape, base.shape)
  assert.deepEqual(first.definition.modes.light.background, base.modes.light.background)
  // 背景圖的遮罩色改成新的 bg，預設遮罩被修正到最小值以上。
  const image = first.definition.modes.dark.image!
  assert.equal(image.overlayColor, first.definition.modes.dark.colors.bg)
  assert.ok(image.dim >= validateUserPanelTheme(first.definition).minDim.dark!)
  // 強調色跟著種子色相走。
  const accent = rgbToOklch(color(first.definition.modes.light.colors.accent))
  assert.ok(Math.abs(accent.h - rgbToOklch(seed).h) < 8)
})

test('repair applies validator suggestions until the definition passes', () => {
  const broken = builtinDefinition()
  broken.modes.light.colors.textMuted = 'rgb(190 180 170 / 1)'
  broken.modes.dark.colors.successText = 'rgb(200 80 80 / 1)'
  assert.equal(validateUserPanelTheme(broken).valid, false)
  const repaired = repairPalette(broken)
  assert.equal(repaired.valid, true)
  assert.equal(validateUserPanelTheme(repaired.definition).valid, true)
  assert.notEqual(repaired.definition.modes.light.colors.textMuted, broken.modes.light.colors.textMuted)
})

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels.set(paint(x, y), (y * width + x) * 4)
  }
  return pixels
}

test('image extraction finds the dominant colours with their weights, ignoring transparent pixels', () => {
  // 3/4 深藍、1/4 橘色，再加一塊完全透明的紅色（不能被算進去）。
  const pixels = image(64, 64, (x, y) => {
    if (y < 8 && x < 8) return [255, 0, 0, 0]
    return x < 48 ? [20, 40, 120, 255] : [240, 140, 30, 255]
  })
  const clusters = extractDominantColors(pixels, 64, 64, 3)
  assert.ok(clusters.length >= 2 && clusters.length <= 3)
  const [first, second] = clusters
  assert.ok(first!.weight > second!.weight)
  assert.ok(Math.abs(first!.color.b - 120) <= 3 && Math.abs(first!.color.r - 20) <= 3)
  assert.ok(Math.abs(second!.color.r - 240) <= 3 && Math.abs(second!.color.g - 140) <= 3)
  assert.ok(Math.abs(first!.weight - 0.75) < 0.03)
  assert.ok(!clusters.some(cluster => cluster.color.r > 200 && cluster.color.g < 30))
  // 種子取「大面積又有顏色」：橘色色度高，深藍面積大；中性色相取最大群（藍）。
  const picked = seedFromClusters(clusters)!
  assert.ok(picked.neutralHue > 200 && picked.neutralHue < 300)
  const result = paletteFromSeed(picked.seed, builtinDefinition(), { neutralHue: picked.neutralHue })
  assert.equal(result.valid, true)
})

test('image extraction is deterministic and bounded for large inputs', () => {
  const width = 1024
  const height = 768
  const pixels = image(width, height, (x, y) => [(x * 7 + y * 3) % 256, (x * 13) % 256, (y * 5) % 256, 255])
  const started = performance.now()
  const first = extractDominantColors(pixels, width, height)
  const elapsed = performance.now() - started
  assert.ok(first.length <= IMAGE_CLUSTER_COUNT)
  assert.ok(Math.abs(first.reduce((sum, cluster) => sum + cluster.weight, 0) - 1) < 1e-9)
  assert.deepEqual(extractDominantColors(pixels, width, height), first)
  // 取樣上限讓 786k 像素的輸入也維持在 16k 像素的工作量（寬鬆上限，避免機器差異造成誤判）。
  assert.ok(elapsed < 2000, `took ${elapsed} ms`)
})

test('degenerate images return nothing or one cluster instead of throwing', () => {
  assert.deepEqual(extractDominantColors(new Uint8ClampedArray(0), 0, 0), [])
  assert.deepEqual(extractDominantColors(image(4, 4, () => [0, 0, 0, 0]), 4, 4), [])
  assert.deepEqual(extractDominantColors(new Uint8ClampedArray(8), 4, 4), [])
  const flat = extractDominantColors(image(10, 10, () => [128, 128, 128, 255]), 10, 10)
  assert.equal(flat.length, 1)
  assert.equal(flat[0]!.weight, 1)
  assert.equal(seedFromClusters([]), null)
  assert.equal(paletteFromSeed(seedFromClusters(flat)!.seed, builtinDefinition()).valid, true)
})

test('the canvas sample keeps the aspect ratio within the 128 px bound', () => {
  assert.deepEqual(sampleSize(4000, 3000), { width: IMAGE_SAMPLE_MAX_SIDE, height: 96 })
  assert.deepEqual(sampleSize(64, 300), { width: 27, height: IMAGE_SAMPLE_MAX_SIDE })
  assert.deepEqual(sampleSize(100, 50), { width: 100, height: 50 })
  assert.deepEqual(sampleSize(8192, 1), { width: 128, height: 1 })
})
