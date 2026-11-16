// 檔案大小顯示：二進位單位（1 KB = 1024 B），小數至多一位；不依賴 i18n，單位符號跨語系一致。
const UNITS = ['B', 'KB', 'MB', 'GB'] as const

export function formatBytes(value: number): string {
  let amount = Number.isFinite(value) ? Math.max(0, value) : 0
  let unit = 0
  while (amount >= 1024 && unit < UNITS.length - 1) {
    amount /= 1024
    unit += 1
  }
  const text = unit === 0 ? String(Math.round(amount)) : (Math.round(amount * 10) / 10).toString()
  return `${text} ${UNITS[unit]}`
}
