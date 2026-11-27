export function createAttentionBitmap(
  source: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const expectedBytes = width * height * 4
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
    throw new RangeError('Tray bitmap dimensions must be integers of at least 8 px')
  }
  if (source.byteLength !== expectedBytes) {
    throw new RangeError('Tray bitmap byte length does not match its dimensions')
  }

  const result = Buffer.from(source)
  const outerRadius = Math.max(2, Math.floor(Math.min(width, height) * 0.22))
  const innerRadius = Math.max(1, outerRadius - 1)
  const centerX = width - outerRadius
  const centerY = outerRadius

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distanceSquared = ((x - centerX) ** 2) + ((y - centerY) ** 2)
      if (distanceSquared > outerRadius ** 2) continue
      const offset = ((y * width) + x) * 4
      const isInner = distanceSquared <= innerRadius ** 2

      // NativeImage bitmap channel order is platform-dependent; magenta looks the same with red and blue swapped.
      result[offset] = 255
      result[offset + 1] = isInner ? 64 : 255
      result[offset + 2] = 255
      result[offset + 3] = 255
    }
  }

  return result
}
