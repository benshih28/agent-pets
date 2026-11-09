import type { InjectionKey, Ref } from 'vue'

// 對話框的遮罩要蓋住整個面板。Dialog 的 `.scrim` 是 `position: absolute; inset: 0`，沒有搬家時
// 它的包含區塊是最近的定位祖先（例如 Card 的 `position: relative`），而且會被中間的捲動區
// （`overflow: auto`）裁掉——結果只有那張卡片變暗，標題列、搜尋與分頁仍清楚可按；`inert`
// 也只套在卡片內的兄弟元素上。所以面板（StatusPanel）提供自己的根元素當掛載點，Dialog
// 以 Teleport 掛到那裡：遮罩就是面板的直接子元素，跟著面板的圓角裁切，其他子元素全部 inert。
//
// 不搬到 `body` 是因為面板視窗是透明的：`body` 大小的遮罩會畫在面板圓角外的透明區域。
// 巢狀對話框（例如主題編輯器裡的確認框）不搬：它在外層對話框的遮罩裡已經蓋滿面板，搬出去
// 反而會離開外層的範圍，外層的 Esc／Tab 處理就不會讓位給它。

/** 面板提供的掛載點（面板根元素）；面板外的對話框（設定精靈、Project MCP）沒有，原地顯示。 */
export const DIALOG_HOST_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> = Symbol('dialog-host')
/** 是否位於另一個對話框之內。 */
export const DIALOG_NESTED_KEY: InjectionKey<boolean> = Symbol('dialog-nested')

/** Teleport 的目標；null 表示原地顯示（沒有掛載點、掛載點尚未建立，或位於另一個對話框內）。 */
export function dialogTeleportTarget<T>(host: T | null | undefined, nested: boolean): T | null {
  return nested ? null : host ?? null
}
