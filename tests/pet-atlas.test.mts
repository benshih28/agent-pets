import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import {
  PET_ATLAS_MAX_ROWS,
  PET_ATLAS_MOTIONS,
  PET_ATLAS_ROW_NAMES,
  PET_ATLAS_V2_ROWS,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_MOTION_MAX_FRAMES,
  PET_MOTION_MAX_FRAME_MS,
  PET_MOTION_MIN_FRAME_MS,
  PET_MOTION_NAMES,
  PET_DEFAULT_MOTION_TABLE,
  petAtlasGridFromSize,
  petMotionFitsAtlas,
  resolvePetMotion,
  resolvePetMotionTable,
} from '../src/types/pet-atlas.ts'
import { parsePetBehaviorManifest, parsePetBehaviorManifestDetailed } from '../electron/pet-behavior-manifest.ts'
import { SPRITE_MAX_HEIGHT, SPRITE_MAX_WIDTH, detectSpriteAtlas } from '../electron/pet-sprite-validation.ts'
import { PREVIEW_IDLE_FRAMES, atlasRowName } from '../src/utils/pet-atlas-preview.ts'

const V2 = { columns: 8, rows: 11 }
const V1 = { columns: 8, rows: 9 }

test('the atlas contract matches the bundled Codex fixtures', () => {
  assert.equal(PET_CELL_WIDTH, 192)
  assert.equal(PET_CELL_HEIGHT, 208)
  assert.deepEqual(petAtlasGridFromSize(1536, 2288), V2)
  assert.equal(PET_ATLAS_ROW_NAMES.length, PET_ATLAS_V2_ROWS)
  // 每個固定動作的列都在 v1 必備的範圍內，格數也放得進 8 欄。
  for (const motion of Object.values(PET_ATLAS_MOTIONS)) {
    assert.ok(motion.row < V1.rows, motion.name)
    assert.ok(motion.frameDurations.length <= V1.columns, motion.name)
    assert.equal(PET_ATLAS_ROW_NAMES[motion.row], motion.name)
  }
  const qitian = JSON.parse(readFileSync(new URL('../public/pets/qitian-dasheng/validation.json', import.meta.url), 'utf8'))
  assert.ok(JSON.stringify(qitian).includes('look-000-to-157.5'))
})

test('main-process validation, preview and renderer read the same grid', () => {
  assert.equal(SPRITE_MAX_WIDTH % PET_CELL_WIDTH, 0)
  assert.equal(SPRITE_MAX_HEIGHT, PET_CELL_HEIGHT * PET_ATLAS_MAX_ROWS)
  const atlas = detectSpriteAtlas({ width: 1536, height: 2288 })
  assert.equal(atlas.frameWidth, PET_CELL_WIDTH)
  assert.equal(atlas.frameHeight, PET_CELL_HEIGHT)
  assert.equal(PREVIEW_IDLE_FRAMES, PET_ATLAS_MOTIONS.idle.frameDurations.length)
  assert.equal(atlasRowName(3), 'waving')
  assert.equal(atlasRowName(40), 'row 40')
})

test('sprite code no longer repeats the cell size or the motion table', () => {
  const files = ['src', 'electron'].flatMap(function walk(dir: string): string[] {
    return readdirSync(new URL(`../${dir}/`, import.meta.url)).flatMap(name => {
      const path = `${dir}/${name}`
      if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) return walk(path)
      return /\.(ts|vue|css)$/.test(name) ? [path] : []
    })
  })
  const spriteFiles = files.filter(path => path !== 'src/types/pet-atlas.ts'
    && /PetAnimation|DesktopPet|pet-|status-line-fit|agentStore/.test(path))
  assert.ok(spriteFiles.length > 5)
  for (const path of spriteFiles) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\b(192|204|208)(px)?\b/, path)
    assert.doesNotMatch(source, /frameDurations: \[\d/, path)
  }
})

test('every motion can be overridden; invalid values fall back to the built-in motion', () => {
  const manifest = parsePetBehaviorManifest({
    idle: { row: 9, frames: 4, frameDurations: [10, 200, 9_999, 300] },
    review: { row: 2 },
    waving: { row: -1 },
    jumping: { row: 3, frames: 0 },
    failed: { row: 1.5 },
    waiting: { row: 4, frameDurations: [100, 'x'] },
    running: { row: 4, frameDurations: [] },
    sleep: { row: PET_ATLAS_MAX_ROWS },
    unknown: { row: 1 },
  })
  assert.deepEqual(manifest, {
    idle: { row: 9, frames: 4, frameDurations: [PET_MOTION_MIN_FRAME_MS, 200, PET_MOTION_MAX_FRAME_MS, 300] },
    review: { row: 2 },
  })
  for (const name of PET_MOTION_NAMES) {
    assert.equal(parsePetBehaviorManifest({ [name]: { row: 0 } })?.[name]?.row, 0, name)
  }
  assert.equal(parsePetBehaviorManifest({ walk: { row: 1, frames: PET_MOTION_MAX_FRAMES + 1 } }), undefined)
  assert.equal(parsePetBehaviorManifest({ walk: { row: 1, frameDurations: Array(PET_MOTION_MAX_FRAMES + 1).fill(100) } }), undefined)
  assert.equal(parsePetBehaviorManifest('not an object'), undefined)
  assert.equal(parsePetBehaviorManifest(null), undefined)
})

test('inherited keys are never read as motion overrides', () => {
  const inherited = Object.create({ idle: { row: 5 } }) as Record<string, unknown>
  assert.equal(parsePetBehaviorManifest(inherited), undefined)
})

test('a known grid drops overrides that do not fit the atlas', () => {
  const declared = { idle: { row: 9 }, waving: { row: 3, frames: 9 }, review: { row: 4 } }
  assert.deepEqual(parsePetBehaviorManifestDetailed(declared, V1), { manifest: { review: { row: 4 } }, outOfRange: true })
  assert.deepEqual(parsePetBehaviorManifestDetailed(declared, { columns: 10, rows: 11 }), {
    manifest: { idle: { row: 9 }, waving: { row: 3, frames: 9 }, review: { row: 4 } },
    outOfRange: false,
  })
})

test('resolvePetMotion keeps the built-in cadence and never returns a short timing list', () => {
  assert.equal(resolvePetMotion('waving', undefined, V2), PET_ATLAS_MOTIONS.waving)
  // 只改列號：沿用內建格數與時長。
  assert.deepEqual(resolvePetMotion('failed', { failed: { row: 2 } }, V2), { ...PET_ATLAS_MOTIONS.failed, row: 2 })
  // 給了格數但時長不足：補預設值，長度永遠等於格數。
  assert.deepEqual(resolvePetMotion('idle', { idle: { row: 9, frames: 4, frameDurations: [300] } }, V2).frameDurations, [300, 150, 150, 260])
  assert.deepEqual(resolvePetMotion('idle', { idle: { row: 9, frames: 2, frameDurations: [300, 200, 100] } }, V2).frameDurations, [300, 200])
})

test('walk and sleep fall back to idle (including an idle override) when undeclared or out of range', () => {
  assert.equal(resolvePetMotion('walk', undefined, V2), PET_ATLAS_MOTIONS.idle)
  const idleOverride = { idle: { row: 9 } }
  assert.deepEqual(resolvePetMotion('sleep', idleOverride, V2), { ...PET_ATLAS_MOTIONS.idle, row: 9 })
  // v1 圖集沒有第 9 列：idle 覆蓋值也放不下，回到內建 idle。
  assert.equal(resolvePetMotion('sleep', idleOverride, V1), PET_ATLAS_MOTIONS.idle)
  assert.equal(resolvePetMotion('walk', { walk: { row: 20 } }, V2), PET_ATLAS_MOTIONS.idle)
  // 圖未載入前格線未知：只靠解析器的上下限，先接受。
  assert.equal(resolvePetMotion('walk', { walk: { row: 20 } }, null).row, 20)
})

test('declared walk without frames uses one frame per atlas column, capped', () => {
  const walk = resolvePetMotion('walk', { walk: { row: 1 } }, V2)
  assert.deepEqual(walk, { name: 'walk', row: 1, frameDurations: [150, 150, 150, 150, 150, 150, 150, 260] })
  assert.equal(resolvePetMotion('walk', { walk: { row: 1 } }, { columns: 32, rows: 11 }).frameDurations.length, PET_MOTION_MAX_FRAMES)
  assert.equal(resolvePetMotion('walk', { walk: { row: 1 } }, null).frameDurations.length, PET_ATLAS_MOTIONS.idle.frameDurations.length)
})

test('a narrow atlas trims built-in motions instead of stepping into missing cells', () => {
  const narrow = { columns: 4, rows: 9 }
  assert.equal(resolvePetMotion('failed', undefined, narrow).frameDurations.length, 4)
  assert.equal(resolvePetMotion('waving', undefined, narrow), PET_ATLAS_MOTIONS.waving)
})

test('the shared motion table is frozen and reused when nothing is overridden', () => {
  assert.ok(Object.isFrozen(PET_ATLAS_MOTIONS))
  for (const motion of Object.values(PET_ATLAS_MOTIONS)) {
    assert.ok(Object.isFrozen(motion) && Object.isFrozen(motion.frameDurations), motion.name)
  }
  assert.throws(() => { (PET_ATLAS_MOTIONS.idle.frameDurations as number[])[0] = 1 }, TypeError)
  // 常見情況不配置新物件：同一個表，呼叫端用 === 就知道不必重排。
  assert.equal(resolvePetMotionTable(undefined, null), PET_DEFAULT_MOTION_TABLE)
  assert.equal(resolvePetMotionTable(undefined, V2), PET_DEFAULT_MOTION_TABLE)
  assert.equal(resolvePetMotionTable({}, V2), PET_DEFAULT_MOTION_TABLE)
  assert.equal(PET_DEFAULT_MOTION_TABLE.walk, PET_ATLAS_MOTIONS.idle)
})

test('a motion table resolves every motion once and stays frozen', () => {
  const table = resolvePetMotionTable({ idle: { row: 9, frames: 4 }, walk: { row: 1 } }, V2)
  assert.notEqual(table, PET_DEFAULT_MOTION_TABLE)
  assert.ok(Object.isFrozen(table) && Object.isFrozen(table.idle) && Object.isFrozen(table.idle.frameDurations))
  assert.deepEqual(Object.keys(table).sort(), [...PET_MOTION_NAMES].sort())
  assert.equal(table.idle.row, 9)
  assert.equal(table.idle.frameDurations.length, 4)
  assert.equal(table.walk.row, 1)
  // 沒宣告 sleep：回退到（被覆蓋的）idle。
  assert.equal(table.sleep.row, 9)
  assert.equal(table.waving, PET_ATLAS_MOTIONS.waving)
  // 窄圖集即使沒有 manifest 也要另外算，內建動作才不會踩進不存在的格。
  assert.notEqual(resolvePetMotionTable(undefined, { columns: 4, rows: 9 }), PET_DEFAULT_MOTION_TABLE)
})

test('the renderer re-checks rows even if a manifest skipped the parser', () => {
  for (const row of [-1, 1.5, Number.NaN, 11]) {
    assert.equal(petMotionFitsAtlas({ row }, V2), false, String(row))
    assert.equal(resolvePetMotion('idle', { idle: { row } }, V2), PET_ATLAS_MOTIONS.idle, String(row))
  }
  const inherited = Object.create({ idle: { row: 9 } }) as Record<string, unknown>
  assert.equal(resolvePetMotion('idle', inherited, V2), PET_ATLAS_MOTIONS.idle)
  assert.equal(resolvePetMotionTable(inherited, V2), PET_DEFAULT_MOTION_TABLE)
})

test('the renderer clamps frame timings that bypassed the main-process parser', () => {
  const resolved = resolvePetMotion('idle', { idle: { row: 1, frameDurations: [1, Number.NaN, 99_999] } }, V2)
  assert.deepEqual(resolved.frameDurations, [PET_MOTION_MIN_FRAME_MS, 150, PET_MOTION_MAX_FRAME_MS])
})
