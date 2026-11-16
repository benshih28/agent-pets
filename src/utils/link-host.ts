/** 只取連結的主機名稱供顯示；無法解析時回傳空字串。 */
export function linkHost(link: string | undefined): string {
  if (!link) return ''
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}
