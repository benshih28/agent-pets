// Custom pet ids double as folder names under ~/.desktop-pet/custom, so they
// must be valid, distinct folder names on every platform the app ships for.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

export function sanitizePetId(id: string): string | null {
  if (typeof id !== 'string') return null
  const cleaned = id.replace(/[^a-zA-Z0-9_\-.]/g, '')
  if (cleaned.length === 0 || cleaned.length > 64) return null
  if (cleaned.includes('..')) return null
  // "." would resolve to custom/ itself; Windows drops a trailing dot and
  // treats CON, NUL, COM1, LPT1 ... (with any extension) as devices.
  if (cleaned === '.' || cleaned.endsWith('.') || WINDOWS_RESERVED_NAME.test(cleaned)) return null
  return cleaned
}
