// One decoded spritesheet (and its aura tint) per source, shared by every
// PetAnimation instance: the main pet, each multi-pet slot and the edge avatar
// no longer decode the same multi-megabyte image separately.

const images = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<HTMLImageElement | null>>()
const tints = new Map<string, string>()

export function getCachedSprite(key: string): HTMLImageElement | undefined {
  return images.get(key)
}

export function getCachedTint(key: string): string | undefined {
  return tints.get(key)
}

export function setCachedTint(key: string, tint: string): void {
  tints.set(key, tint)
}

/** Drops a sprite (e.g. after a custom pet is re-imported or removed). */
export function invalidatePetSprite(keyPrefix: string): void {
  for (const key of [...images.keys()]) if (key.startsWith(keyPrefix)) images.delete(key)
  for (const key of [...tints.keys()]) if (key.startsWith(keyPrefix)) tints.delete(key)
  for (const key of [...pending.keys()]) if (key.startsWith(keyPrefix)) pending.delete(key)
}

/** Loads (or joins the in-flight load of) a spritesheet; resolves null on failure. */
export function loadPetSprite(key: string, src: string): Promise<HTMLImageElement | null> {
  const cached = images.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(key)
  if (inflight) return inflight
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    // Imports reject EXIF rotation; this keeps any other source on the raw
    // pixel grid too, since a rotated sheet would swap the 192x208 cells.
    img.style.imageOrientation = 'none'
    img.onload = () => {
      images.set(key, img)
      pending.delete(key)
      resolve(img)
    }
    img.onerror = () => {
      pending.delete(key)
      resolve(null)
    }
    img.src = src
  })
  pending.set(key, promise)
  return promise
}
