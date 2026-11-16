import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MULTI_PET_CELL_W,
  PET_BASE_H,
  PET_BASE_W,
  PET_WINDOW_DIMENSION_LIMITS,
  QUOTA_TOOLTIP_HEADROOM_H,
  QUOTA_TOOLTIP_MIN_W,
  STATUS_LINE_EXTRA_H,
  clampPetWindowDimension,
  initialPetWindowSize,
  petWindowHeight,
  petWindowWidth,
} from '../src/utils/pet-window-size.ts'

// 重構前（1.12.5）的公式原樣抄在這裡，當作行為基準：主行程 createPetWindow() 的冷啟動預設值、
// agentStore 的 scaledW 與 pet-window-height.ts 的 petWindowHeight()。抽成共用模組後必須逐值相同。
const legacy = {
  coldStartWidth: (scale: number) => Math.max(Math.round(250 * scale), 260),
  coldStartHeight: (scale: number) => Math.round(232 * scale) + 190,
  width: (count: number, multiPet: boolean, scale: number) => multiPet
    ? Math.round((count * (192 + 12) + 16) * scale)
    : Math.max(Math.round(250 * scale), 260),
  height: (lines: number, multiPet: boolean, scale: number) => {
    const extra = multiPet ? 0 : (Math.max(1, lines) - 1) * 22
    return Math.round((232 + extra) * scale) + 190
  },
}
const SCALES = [0.3, 0.45, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5]

test('the size constants keep their 1.12.5 values', () => {
  assert.equal(PET_BASE_W, 250)
  assert.equal(PET_BASE_H, 232)
  assert.equal(STATUS_LINE_EXTRA_H, 22)
  assert.equal(QUOTA_TOOLTIP_HEADROOM_H, 190)
  assert.equal(QUOTA_TOOLTIP_MIN_W, 260)
  assert.equal(MULTI_PET_CELL_W, 204)
  assert.deepEqual(PET_WINDOW_DIMENSION_LIMITS, { min: 80, max: 1_600 })
})

test('cold start without a saved size: one pet, one status line, tooltip headroom reserved', () => {
  assert.deepEqual(initialPetWindowSize(1), { width: 260, height: 422 })
  assert.deepEqual(initialPetWindowSize(0.3), { width: 260, height: 260 })
  assert.deepEqual(initialPetWindowSize(2), { width: 500, height: 654 })
  assert.deepEqual(initialPetWindowSize(5), { width: 1_250, height: 1_350 })
  for (const scale of SCALES) {
    assert.deepEqual(initialPetWindowSize(scale), { width: legacy.coldStartWidth(scale), height: legacy.coldStartHeight(scale) }, String(scale))
  }
})

test('single pet width never drops below the tooltip minimum; multi pet width grows per pet', () => {
  assert.equal(petWindowWidth(1, false, 1), 260)
  assert.equal(petWindowWidth(1, false, 0.5), 260)
  assert.equal(petWindowWidth(1, false, 1.5), 375)
  assert.equal(petWindowWidth(2, true, 1), 424)
  assert.equal(petWindowWidth(3, true, 0.5), 314)
  for (const scale of SCALES) {
    for (const count of [1, 2, 3, 4]) {
      for (const multiPet of [false, true]) {
        assert.equal(petWindowWidth(count, multiPet, scale), legacy.width(count, multiPet, scale), `${count}/${multiPet}/${scale}`)
      }
    }
  }
})

test('saved sizes and pet-resize requests are clamped to 80-1600 and rounded', () => {
  assert.equal(clampPetWindowDimension(20), 80)
  assert.equal(clampPetWindowDimension(2_000), 1_600)
  assert.equal(clampPetWindowDimension(421.6), 422)
  assert.equal(clampPetWindowDimension(80), 80)
  assert.equal(clampPetWindowDimension(1_600), 1_600)
})

test('main and renderer read the pet window size from the shared module only', () => {
  const runtime = readFileSync('electron/main/runtime.ts', 'utf8')
  const create = runtime.slice(runtime.indexOf('export function createPetWindow()'), runtime.indexOf('mainState.petWindow = new BrowserWindow('))
  assert.match(create, /initialPetWindowSize\(scale\)/)
  assert.doesNotMatch(create, /\b(?:250|260|232|190|1_600)\b/)
  assert.doesNotMatch(runtime, /PET_WINDOW_TOP_HEADROOM/)
  assert.doesNotMatch(readFileSync('electron/ipc/window-controls.ts', 'utf8'), /clamp\(raw(?:Width|Height), 80, 1_600\)/)
  const store = ['src/stores/agentStore.ts', 'src/stores/agent/session-views.ts'].map(path => readFileSync(path, 'utf8')).join('\n')
  assert.doesNotMatch(store, /PET_BASE_W|QUOTA_TOOLTIP_MIN_W|MULTI_PET_CELL_W/)
  assert.match(store, /petWindowWidth\(familyLines\.value\.length, isMultiPet\.value, petScale\.value\)/)
})

test('single pet: each extra status line adds one thin row, scaled with the sprite part', () => {
  assert.equal(petWindowHeight(0, false, 1), 422)
  assert.equal(petWindowHeight(1, false, 1), 422)
  assert.equal(petWindowHeight(3, false, 1), 466)
  // tooltip 留白不隨寵物大小縮放。
  assert.equal(petWindowHeight(1, false, 0.5), 306)
  assert.equal(petWindowHeight(1, false, 0.3), 260)
  assert.equal(petWindowHeight(2, false, 2), 698)
})

test('multi pet: pills share one row, so the line count adds nothing', () => {
  assert.equal(petWindowHeight(2, true, 1), 422)
  assert.equal(petWindowHeight(3, true, 1), 422)
})

test('the height matches the 1.12.5 formula for every scale and line count', () => {
  for (const scale of SCALES) {
    for (const lines of [0, 1, 2, 3, 4, 5]) {
      for (const multiPet of [false, true]) {
        assert.equal(petWindowHeight(lines, multiPet, scale), legacy.height(lines, multiPet, scale), `${lines}/${multiPet}/${scale}`)
      }
    }
  }
})
