import type { InjectionKey, Ref } from 'vue'

// 遮罩掛到面板根元素而非 `body`（透明視窗，body 遮罩會畫到圓角外）；巢狀對話框不搬，否則外層 Esc／Tab 不會讓位。
export const DIALOG_HOST_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> = Symbol('dialog-host')
export const DIALOG_NESTED_KEY: InjectionKey<boolean> = Symbol('dialog-nested')

export function dialogTeleportTarget<T>(host: T | null | undefined, nested: boolean): T | null {
  return nested ? null : host ?? null
}
