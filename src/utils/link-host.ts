export function linkHost(link: string | undefined): string {
  if (!link) return ''
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}
