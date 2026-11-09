import { deflateSync } from 'node:zlib'
import { formatPanelThemeColor } from '../../electron/panel-theme-color.ts'
import { builtinPanelThemeColors } from '../../electron/plugin-panel-themes.ts'
import type { PanelThemeMode } from '../../src/types/panel-theme.ts'
import { USER_PANEL_THEME_COLOR_KEYS, type UserPanelThemeDefinition } from '../../src/types/panel-theme-user.ts'

// 面板主題測試共用的建構器：一個有效的雙模式主題，以及
// 檔頭正確的圖片位元組（PNG、APNG、WebP、JPEG），不需要真正的解碼器。

export const LIGHT_COLORS = {
  bg: '#eef6f6', surface: '#f8fcfc', surface2: '#e2eeee',
  text: '#10282c', textSecondary: '#2f4a4f', textMuted: '#3d585c',
  accent: '#1f7a80', accentText: '#135a5f', onAccent: '#ffffff',
  border: 'rgb(16 40 44 / 0.18)',
}

export const DARK_COLORS = {
  bg: '#0d1b22', surface: '#13252e', surface2: '#1b313b',
  text: '#e6f4f5', textSecondary: '#c0d8db', textMuted: '#a3c0c4',
  accent: '#4fc3c9', accentText: '#8adfe3', onAccent: '#0d1b22',
  border: 'rgb(230 244 245 / 0.18)',
}

export function theme(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aurora',
    displayName: { 'zh-TW': '極光', 'en-US': 'Aurora' },
    modes: {
      light: { colors: { ...LIGHT_COLORS } },
      dark: { colors: { ...DARK_COLORS } },
    },
    ...overrides,
  }
}

export function lightTheme(mode: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return theme({ modes: { light: { colors: { ...LIGHT_COLORS }, ...mode } }, ...extra })
}

export function manifest(panelThemes: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'theme-pack',
    name: { 'zh-TW': '主題包', 'en-US': 'Theme Pack' },
    version: '1.0.0',
    apiVersion: '1',
    author: 'Agent Pets Test Fixture',
    permissions: {},
    contributes: { panelThemes },
    ...extra,
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

/** 真正（可解碼）的 RGB PNG；`animated` 會在 IDAT 前插入 acTL chunk。 */
export function png(width: number, height: number, options: { animated?: boolean; exifOrientation?: number } = {}): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const rows = Math.min(height, 4)
  const raw = Buffer.alloc(rows * (1 + Math.min(width, 4) * 3))
  const chunks = [chunk('IHDR', header)]
  if (options.animated) chunks.push(chunk('acTL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])))
  if (options.exifOrientation) chunks.push(chunk('eXIf', tiffOrientation(options.exifOrientation)))
  chunks.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array()))
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]))
}

function tiffOrientation(value: number): Buffer {
  // 只有一個 IFD 項目的 big-endian TIFF：Orientation (0x0112)、SHORT、count 1。
  return Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0, 0, 0])
}

function riff(chunks: Buffer[]): Uint8Array {
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks])
  const size = Buffer.alloc(4)
  size.writeUInt32LE(body.length)
  return new Uint8Array(Buffer.concat([Buffer.from('RIFF', 'ascii'), size, body]))
}

function webpChunk(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32LE(data.length)
  return Buffer.concat([Buffer.from(type, 'ascii'), size, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)])
}

/** 帶 VP8X 檔頭（只有尺寸）的 WebP；`animated` 會設定旗標並加入 ANIM。 */
export function webp(width: number, height: number, options: { animated?: boolean } = {}): Uint8Array {
  const vp8x = Buffer.alloc(10)
  vp8x[0] = options.animated ? 0x02 : 0
  vp8x.writeUIntLE(width - 1, 4, 3)
  vp8x.writeUIntLE(height - 1, 7, 3)
  const chunks = [webpChunk('VP8X', vp8x)]
  if (options.animated) chunks.push(webpChunk('ANIM', Buffer.alloc(6)))
  chunks.push(webpChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])))
  return riff(chunks)
}

/** 帶選用 EXIF orientation、一個 SOF0 與最小掃描段的 JPEG。 */
export function jpeg(width: number, height: number, options: { orientation?: number; secondSof?: boolean } = {}): Uint8Array {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  if (options.orientation) {
    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiffOrientation(options.orientation)])
    const length = Buffer.alloc(2)
    length.writeUInt16BE(exif.length + 2)
    parts.push(Buffer.from([0xff, 0xe1]), length, exif)
  }
  const sof = (w: number, h: number) => Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])
  parts.push(sof(width, height))
  if (options.secondSof) parts.push(sof(64, 64))
  parts.push(Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0]), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9]))
  return new Uint8Array(Buffer.concat(parts))
}

export function woff2(size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x77, 0x4f, 0x46, 0x32])
  return bytes
}

/** 以內建淺色與深色色盤組成的「我的主題」定義（每個鍵都明確宣告）。 */
export function builtinDefinition(): UserPanelThemeDefinition {
  const mode = (name: PanelThemeMode) => {
    const colors = builtinPanelThemeColors(name)
    return {
      colors: Object.fromEntries(USER_PANEL_THEME_COLOR_KEYS.map(key => [key, formatPanelThemeColor(colors[key])])) as UserPanelThemeDefinition['modes']['light']['colors'],
      background: { type: 'solid' as const },
      image: null,
      petStatus: null,
    }
  }
  return { typography: { body: 'builtin', heading: 'builtin', scale: 1 }, shape: { radiusSm: 8, radiusMd: 16, radiusLg: 28 }, modes: { light: mode('light'), dark: mode('dark') } }
}
