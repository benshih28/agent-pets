import { t } from '@/i18n'

export function formatProject(project?: string): string {
  if (!project) return ''
  const parts = project.split(/[/\\]/)
  return parts[parts.length - 1] || project
}

// Backend window ids/labels vary by provider; anything unrecognised keeps the raw label.
export function quotaWindowLabel(id: string, label: string): string {
  const identity = `${id} ${label}`.toLowerCase()
  if (identity.includes('session') || identity.includes('five_hour')) return t('fiveHourLimit')
  if (identity.includes('weekly') || identity.includes('seven_day')) return t('weeklyLimit')
  return label
}

// Keep one decimal below 10%, where "0%" vs "0.4%" reads as empty vs nearly empty.
export function roundQuotaPercent(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
}
