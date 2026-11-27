// 不得有任何 import：目錄驗證器會連同 plugin-panel-themes.ts 一起 vendor 這個檔。

interface RasterSignature {
  readonly type: string
  readonly parts: readonly (readonly [offset: number, magic: readonly number[]])[]
}

const RASTER_SIGNATURES = [
  { type: 'image/png', parts: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]] },
  { type: 'image/jpeg', parts: [[0, [0xff, 0xd8, 0xff]]] },
  // RIFF 的位移 4–7 是長度，不比對。
  { type: 'image/webp', parts: [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]] },
] as const satisfies readonly RasterSignature[]

export type RasterImageType = (typeof RASTER_SIGNATURES)[number]['type']

function matches(bytes: Uint8Array, parts: RasterSignature['parts']): boolean {
  return parts.every(([offset, magic]) => bytes.length >= offset + magic.length
    && magic.every((value, index) => bytes[offset + index] === value))
}

export function sniffRasterImageType(bytes: Uint8Array): RasterImageType | null {
  return RASTER_SIGNATURES.find(signature => matches(bytes, signature.parts))?.type ?? null
}

export function rasterImageTypeIn(bytes: Uint8Array, allowed: ReadonlySet<RasterImageType>): RasterImageType | null {
  const type = sniffRasterImageType(bytes)
  return type !== null && allowed.has(type) ? type : null
}
