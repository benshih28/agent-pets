import { ref } from 'vue'

export type PluginToastTone = 'success' | 'error' | 'info'

export interface PluginToastAction {
  label: string
  run: () => void
}

export interface PluginToast {
  id: number
  tone: PluginToastTone
  text: string
  detail?: string
  action?: PluginToastAction
  // 成功與資訊訊息會自動消失；錯誤需要使用者手動關閉。
  sticky: boolean
}

export interface PluginNotifyInput {
  tone: PluginToastTone
  text: string
  detail?: string
  action?: PluginToastAction
  // 毫秒；省略時成功 4 秒、資訊 6 秒、錯誤不自動消失（含動作的成功訊息給 8 秒）。
  durationMs?: number
}

export const SUCCESS_TOAST_MS = 4000
export const INFO_TOAST_MS = 6000
export const ACTION_TOAST_MS = 8000
export const MAX_VISIBLE_TOASTS = 3

export function toastDuration(input: Pick<PluginNotifyInput, 'tone' | 'action' | 'durationMs'>): number | null {
  if (input.durationMs !== undefined) return input.durationMs
  if (input.tone === 'error') return null
  if (input.action) return ACTION_TOAST_MS
  return input.tone === 'success' ? SUCCESS_TOAST_MS : INFO_TOAST_MS
}

// 佇列最多同時顯示 MAX_VISIBLE_TOASTS 則；相同文字的訊息會取代舊的，避免連點時堆疊。
export function usePluginNotify() {
  const toasts = ref<PluginToast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 1

  function clearTimer(id: number): void {
    const timer = timers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(id)
  }

  function dismiss(id: number): void {
    clearTimer(id)
    toasts.value = toasts.value.filter(toast => toast.id !== id)
  }

  function notify(input: PluginNotifyInput): number {
    for (const existing of toasts.value.filter(toast => toast.text === input.text && toast.tone === input.tone)) dismiss(existing.id)
    const duration = toastDuration(input)
    const toast: PluginToast = {
      id: nextId++,
      tone: input.tone,
      text: input.text,
      detail: input.detail,
      action: input.action,
      sticky: duration === null,
    }
    toasts.value = [...toasts.value, toast]
    while (toasts.value.length > MAX_VISIBLE_TOASTS) dismiss(toasts.value[0].id)
    if (duration !== null) timers.set(toast.id, setTimeout(() => dismiss(toast.id), duration))
    return toast.id
  }

  function runAction(id: number): void {
    const toast = toasts.value.find(item => item.id === id)
    dismiss(id)
    toast?.action?.run()
  }

  function dispose(): void {
    for (const id of [...timers.keys()]) clearTimer(id)
    toasts.value = []
  }

  return { toasts, notify, dismiss, runAction, dispose }
}
