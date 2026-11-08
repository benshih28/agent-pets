import assert from 'node:assert/strict'
import test from 'node:test'
import { atlasCellStyle, atlasRowName, isImportPreviewUrl } from '../src/utils/pet-atlas-preview.ts'

const atlas = { version: 2 as const, columns: 8, rows: 11, width: 1536, height: 2288, frameWidth: 192, frameHeight: 208 }

test('atlas preview cells are scaled background slices of the staged sheet', () => {
  const url = `agent-pets://import-preview/${'f'.repeat(32)}/spritesheet`
  assert.deepEqual(atlasCellStyle(atlas, url, 2, 3, 0.25), {
    width: '48px', height: '52px', backgroundImage: `url("${url}")`, backgroundRepeat: 'no-repeat',
    backgroundSize: '384px 572px', backgroundPosition: '-144px -104px',
  })
  assert.equal(atlasRowName(1), 'running-right')
  assert.equal(atlasRowName(12), 'row 12')
})

test('only main-process import preview URLs are rendered', () => {
  assert.equal(isImportPreviewUrl(`agent-pets://import-preview/${'0'.repeat(32)}/spritesheet`), true)
  for (const value of ['file:///etc/passwd', 'agent-pets://custom/x/spritesheet.webp', `agent-pets://import-preview/${'0'.repeat(32)}/spritesheet")`, null]) {
    assert.equal(isImportPreviewUrl(value), false)
  }
})
