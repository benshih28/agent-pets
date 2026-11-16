// 光暈色：由 sprite 像素算出，算不出來時沿用呼叫端給的 fallback（色盤的高光色）。
import { PET_CELL_HEIGHT, PET_CELL_WIDTH } from '@/types/pet-atlas'

export function deriveAuraTintFromPixels(pixels: Uint8ClampedArray, fallbackTint: string): string {
  try {
    let red = 0
    let green = 0
    let blue = 0
    let weightTotal = 0
    let fallbackRed = 0
    let fallbackGreen = 0
    let fallbackBlue = 0
    let fallbackWeight = 0

    for (let index = 0; index < pixels.length; index += 16) {
      const alpha = pixels[index + 3] / 255
      if (alpha < 0.25) continue
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      const brightness = Math.max(r, g, b)
      const fallback = alpha * Math.max(0.2, brightness / 255)
      fallbackRed += r * fallback
      fallbackGreen += g * fallback
      fallbackBlue += b * fallback
      fallbackWeight += fallback
      if (chroma < 24 || brightness < 48) continue
      const weight = alpha * chroma * (0.55 + brightness / 510)
      red += r * weight
      green += g * weight
      blue += b * weight
      weightTotal += weight
    }

    const divisor = weightTotal || fallbackWeight
    if (!divisor) return fallbackTint
    const sourceRed = weightTotal ? red : fallbackRed
    const sourceGreen = weightTotal ? green : fallbackGreen
    const sourceBlue = weightTotal ? blue : fallbackBlue
    const channels = [sourceRed / divisor, sourceGreen / divisor, sourceBlue / divisor]
    const strongest = Math.max(...channels)
    const lift = strongest > 0 ? Math.min(1.65, 220 / strongest) : 1
    const [r, g, b] = channels.map(channel => Math.round(Math.min(255, channel * lift + 18)))
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return fallbackTint
  }
}

export function deriveAuraTint(img: HTMLImageElement, fallbackTint: string): string {
  try {
    const sample = document.createElement('canvas')
    sample.width = PET_CELL_WIDTH
    sample.height = PET_CELL_HEIGHT
    const ctx = sample.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallbackTint
    ctx.drawImage(img, 0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT, 0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT)
    return deriveAuraTintFromPixels(ctx.getImageData(0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT).data, fallbackTint)
  } catch {
    return fallbackTint
  }
}
