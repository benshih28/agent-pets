import { reactive } from 'vue'

// Shared toast queue for the Toast primitive. Rendering lives in
// components/ui/ToastHost.vue; callers only push.
export type ToastTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'

export interface ToastOptions {
  tone?: ToastTone
  title?: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 5000 (danger: 8000). */
  duration?: number
}

export interface ToastItem extends Required<Pick<ToastOptions, 'tone' | 'duration'>> {
  id: number
  title?: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

/** At most this many toasts are visible; the oldest is dropped first. */
export const MAX_TOASTS = 3

const state = reactive<{ items: ToastItem[] }>({ items: [] })
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1

export function defaultDuration(tone: ToastTone): number {
  return tone === 'danger' ? 8000 : 5000
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
}

export function pushToast(options: ToastOptions): number {
  const tone = options.tone ?? 'neutral'
  const item: ToastItem = {
    id: nextId++,
    tone,
    duration: options.duration ?? defaultDuration(tone),
    title: options.title,
    message: options.message,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
  }
  state.items.push(item)
  while (state.items.length > MAX_TOASTS) dismissToast(state.items[0].id)
  if (item.duration > 0) timers.set(item.id, setTimeout(() => dismissToast(item.id), item.duration))
  return item.id
}

export function clearToasts(): void {
  for (const item of [...state.items]) dismissToast(item.id)
}

export function useToast() {
  return { toasts: state.items, push: pushToast, dismiss: dismissToast, clear: clearToasts }
}
