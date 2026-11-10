// Pure helpers behind the pet's result bubble: how long it stays, how an
// elapsed time is spelled, and how a raw tool identifier becomes something a
// person can read.

export const TOAST_SUCCESS_MS = 4_500
export const TOAST_ERROR_MS = 7_500

export const TOAST_WAITING_MS = 8_000
/** A prompt that just appeared is often answered within seconds; wait before nagging. */
export const WAITING_INPUT_DELAY_MS = 5_000
/** No pet interaction for this long means the user was probably away. */
export const UNREAD_AWAY_MS = 45_000

export type ToastTone = 'success' | 'error' | 'waiting'

export function toastDurationFor(tone: ToastTone): number {
  if (tone === 'error') return TOAST_ERROR_MS
  if (tone === 'waiting') return TOAST_WAITING_MS
  return TOAST_SUCCESS_MS
}

/** "45s", "2m 14s", "1h 05m". Returns null when there is nothing worth showing. */
export function formatElapsedShort(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 5_000) return null
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

export interface ToolDescription {
  /** Locale key under the `pet.tool.*` namespace. */
  key: 'pet.tool.run' | 'pet.tool.edit' | 'pet.tool.read' | 'pet.tool.search'
    | 'pet.tool.web' | 'pet.tool.agent' | 'pet.tool.plan' | 'pet.tool.mcp' | 'pet.tool.generic'
  params: Record<string, string>
}

const MAX_NAME_LENGTH = 28

function clip(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim()
  return clean.length > MAX_NAME_LENGTH ? `${clean.slice(0, MAX_NAME_LENGTH - 1)}…` : clean
}

const EXACT: Record<string, ToolDescription['key']> = {
  bash: 'pet.tool.run',
  shell: 'pet.tool.run',
  exec: 'pet.tool.run',
  edit: 'pet.tool.edit',
  multiedit: 'pet.tool.edit',
  write: 'pet.tool.edit',
  notebookedit: 'pet.tool.edit',
  apply_patch: 'pet.tool.edit',
  patch: 'pet.tool.edit',
  read: 'pet.tool.read',
  ls: 'pet.tool.read',
  grep: 'pet.tool.search',
  glob: 'pet.tool.search',
  webfetch: 'pet.tool.web',
  websearch: 'pet.tool.web',
  task: 'pet.tool.agent',
  agent: 'pet.tool.agent',
  todowrite: 'pet.tool.plan',
}

export function describeTool(rawName: string): ToolDescription {
  const name = rawName.trim()
  const mcp = /^mcp__([^_][^]*?)__/.exec(name)
  if (mcp) return { key: 'pet.tool.mcp', params: { server: clip(mcp[1]) } }
  const known = EXACT[name.toLowerCase()]
  if (known) return { key: known, params: {} }
  return { key: 'pet.tool.generic', params: { name: clip(name) } }
}
