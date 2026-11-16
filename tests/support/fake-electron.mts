import type { BrowserWindow, Display, IpcMainEvent, IpcMainInvokeEvent, Rectangle, WebContents } from 'electron'

// 受測程式只碰 Electron 物件的少數成員，完整實作上百個成員沒有意義。
// 呼叫端只給用到的成員（Partial 仍會檢查每個成員的型別），唯一的轉型集中在這裡。

export function fakeBrowserWindow(members: Partial<BrowserWindow> = {}): BrowserWindow {
  return members as unknown as BrowserWindow
}

export function fakeWebContents(members: Partial<WebContents> = {}): WebContents {
  return members as unknown as WebContents
}

/** 測試以物件身分（`===`）辨識事件來源，所以每次呼叫都回傳新的物件。 */
export function fakeIpcMainEvent(members: Partial<IpcMainEvent> = {}): IpcMainEvent {
  return { ...members } as unknown as IpcMainEvent
}

export function fakeIpcMainInvokeEvent(members: Partial<IpcMainInvokeEvent> = {}): IpcMainInvokeEvent {
  return { ...members } as unknown as IpcMainInvokeEvent
}

/** 受測程式只讀 id、bounds、workArea；其餘欄位補中性值，讓物件完整符合 `Display`（純資料型別，不需要轉型）。 */
export function fakeDisplay(id: number, bounds: Rectangle, workArea: Rectangle = bounds): Display {
  return {
    id, bounds, workArea, label: `display-${id}`, internal: false, detected: true, monochrome: false,
    accelerometerSupport: 'unknown', touchSupport: 'unknown', colorDepth: 24, depthPerComponent: 8, colorSpace: '',
    displayFrequency: 60, scaleFactor: 1, rotation: 0,
    maximumCursorSize: { width: 0, height: 0 }, nativeOrigin: { x: bounds.x, y: bounds.y },
    size: { width: bounds.width, height: bounds.height }, workAreaSize: { width: workArea.width, height: workArea.height },
  }
}
