import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { TypeObject } from 'koffi'

export interface WindowsRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface WindowsFullscreenWindowSnapshot {
  processId: number
  ownProcessId: number
  visible: boolean
  minimized: boolean
  cloaked: boolean
  frameBounds: WindowsRect
  monitorBounds: WindowsRect
  style: number
}

export interface WindowsFullscreenState {
  fullscreen: boolean
  petDisplayFullscreen: boolean
  panelDisplayFullscreen: boolean
}

export interface WindowsFullscreenTargets {
  pet: bigint | null
  panel: bigint | null
}

export interface WindowsFullscreenDetector {
  readonly available: boolean
  setTargetWindows(targets: WindowsFullscreenTargets): void
  start(): boolean
  stop(): void
  refresh(): void
}

const EMPTY_STATE: WindowsFullscreenState = {
  fullscreen: false,
  petDisplayFullscreen: false,
  panelDisplayFullscreen: false,
}

const FULLSCREEN_EDGE_TOLERANCE_PX = 1
const MONITOR_DEFAULTTONEAREST = 2
const GWL_STYLE = -16
const WS_CHILD = 0x40000000
const WS_CAPTION = 0x00c00000
const WS_THICKFRAME = 0x00040000
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const EVENT_SYSTEM_FOREGROUND = 0x0003
const EVENT_SYSTEM_MOVESIZEEND = 0x000b
const EVENT_SYSTEM_MINIMIZESTART = 0x0016
const EVENT_SYSTEM_MINIMIZEEND = 0x0017
const EVENT_OBJECT_DESTROY = 0x8001
const EVENT_OBJECT_SHOW = 0x8002
const EVENT_OBJECT_HIDE = 0x8003
const EVENT_OBJECT_LOCATIONCHANGE = 0x800b
const OBJID_WINDOW = 0
const CHILDID_SELF = 0
const WINEVENT_OUTOFCONTEXT = 0

const NATIVE_EVENTS = [
  EVENT_SYSTEM_FOREGROUND,
  EVENT_SYSTEM_MOVESIZEEND,
  EVENT_SYSTEM_MINIMIZESTART,
  EVENT_SYSTEM_MINIMIZEEND,
  EVENT_OBJECT_DESTROY,
  EVENT_OBJECT_SHOW,
  EVENT_OBJECT_HIDE,
  EVENT_OBJECT_LOCATIONCHANGE,
]

type KoffiModule = typeof import('koffi')

interface Win32Api {
  getForegroundWindow: () => unknown
  isWindowVisible: (windowHandle: unknown) => boolean
  isIconic: (windowHandle: unknown) => boolean
  getWindowThreadProcessId: (windowHandle: unknown, processId: number[]) => number
  getWindowLong: (windowHandle: unknown, index: number) => number
  monitorFromWindow: (windowHandle: unknown, flags: number) => unknown
  getMonitorInfo: (monitorHandle: unknown, info: NativeMonitorInfo) => boolean
  dwmGetWindowFrameAttribute: (
    windowHandle: unknown,
    attribute: number,
    output: WindowsRect,
    outputSize: number,
  ) => number
  dwmGetWindowCloakedAttribute: (
    windowHandle: unknown,
    attribute: number,
    output: number[],
    outputSize: number,
  ) => number
  setWinEventHook: (
    eventMin: number,
    eventMax: number,
    moduleHandle: unknown,
    callback: unknown,
    processId: number,
    threadId: number,
    flags: number,
  ) => unknown
  unhookWinEvent: (hook: unknown) => boolean
}

interface NativeMonitorInfo {
  cbSize: number
  rcMonitor: WindowsRect
  rcWork: WindowsRect
  dwFlags: number
}

interface Win32Binding {
  api: Win32Api
  koffi: KoffiModule
  eventCallbackPointerType: TypeObject
  rectSize: number
  monitorInfoSize: number
}

function isNullPointer(value: unknown): boolean {
  return value === null || value === undefined || value === 0n
}

function sameNativePointer(left: unknown, right: unknown): boolean {
  return !isNullPointer(left) && !isNullPointer(right) && left === right
}

/**
 * Electron exposes a Windows HWND as a little-endian byte buffer, while
 * Koffi represents Win32 pointers as BigInt values. Keep this conversion at
 * the boundary so the detector never passes the address of Electron's buffer
 * to a Win32 API by mistake.
 */
export function nativeWindowHandleToPointer(handle: Uint8Array | null): bigint | null {
  if (!handle || handle.byteLength === 0) return null
  const length = Math.min(handle.byteLength, 8)
  let pointer = 0n
  for (let index = 0; index < length; index += 1) {
    pointer |= BigInt(handle[index] ?? 0) << BigInt(index * 8)
  }
  return pointer === 0n ? null : pointer
}

function emptyRect(): WindowsRect {
  return { left: 0, top: 0, right: 0, bottom: 0 }
}

function isFiniteRect(rect: WindowsRect): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom].every(value => Number.isFinite(value))
}

function edgesMatch(left: WindowsRect, right: WindowsRect): boolean {
  return Math.abs(left.left - right.left) <= FULLSCREEN_EDGE_TOLERANCE_PX
    && Math.abs(left.top - right.top) <= FULLSCREEN_EDGE_TOLERANCE_PX
    && Math.abs(left.right - right.right) <= FULLSCREEN_EDGE_TOLERANCE_PX
    && Math.abs(left.bottom - right.bottom) <= FULLSCREEN_EDGE_TOLERANCE_PX
}

/**
 * A conservative, pure Win32 fullscreen rule. A normal maximized window ends
 * at rcWork (usually below the taskbar) and retains caption/frame styles, so
 * it does not qualify. Borderless windows must cover the complete monitor.
 */
export function isExternalFullscreenWindow(
  snapshot: WindowsFullscreenWindowSnapshot,
): boolean {
  if (snapshot.processId === snapshot.ownProcessId) return false
  if (!snapshot.visible || snapshot.minimized || snapshot.cloaked) return false
  if (!isFiniteRect(snapshot.frameBounds) || !isFiniteRect(snapshot.monitorBounds)) return false
  if (snapshot.frameBounds.right <= snapshot.frameBounds.left
    || snapshot.frameBounds.bottom <= snapshot.frameBounds.top
    || snapshot.monitorBounds.right <= snapshot.monitorBounds.left
    || snapshot.monitorBounds.bottom <= snapshot.monitorBounds.top) return false

  const style = snapshot.style >>> 0
  if ((style & WS_CHILD) !== 0) return false
  if ((style & WS_CAPTION) !== 0 || (style & WS_THICKFRAME) !== 0) return false
  return edgesMatch(snapshot.frameBounds, snapshot.monitorBounds)
}

function loadKoffi(): KoffiModule {
  const runtimeRequire = createRequire(
    typeof __filename === 'string' ? __filename : join(process.cwd(), 'package.json'),
  )
  return runtimeRequire('koffi') as KoffiModule
}

function createWin32Binding(koffi: KoffiModule): Win32Binding {
  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')
  const rectType = koffi.struct('AgentPetsFullscreenRect', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  })
  const monitorInfoType = koffi.struct('AgentPetsFullscreenMonitorInfo', {
    cbSize: 'uint32_t',
    rcMonitor: rectType,
    rcWork: rectType,
    dwFlags: 'uint32_t',
  })
  const eventCallbackType = koffi.proto(
    'void __stdcall AgentPetsWinEventProc(void *hook, uint32_t event, void *hwnd, int32_t objectId, int32_t childId, uint32_t threadId, uint32_t time)',
  )

  // Win32 BOOL 是 4-byte int，不是 1-byte bool：宣告 int 再以 !== 0 轉成 boolean，避免讀到未定義的高位元組。
  const isWindowVisible = user32.func('int IsWindowVisible(void *hwnd)')
  const isIconic = user32.func('int IsIconic(void *hwnd)')
  const getMonitorInfo = user32.func('int GetMonitorInfoW(void *monitor, _Inout_ AgentPetsFullscreenMonitorInfo *info)')
  const unhookWinEvent = user32.func('int UnhookWinEvent(void *hook)')

  return {
    koffi,
    eventCallbackPointerType: koffi.pointer(eventCallbackType),
    rectSize: koffi.sizeof(rectType),
    monitorInfoSize: koffi.sizeof(monitorInfoType),
    api: {
      getForegroundWindow: user32.func('void *GetForegroundWindow()') as Win32Api['getForegroundWindow'],
      isWindowVisible: windowHandle => isWindowVisible(windowHandle) !== 0,
      isIconic: windowHandle => isIconic(windowHandle) !== 0,
      getWindowThreadProcessId: user32.func(
        'uint32_t GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *processId)',
      ) as Win32Api['getWindowThreadProcessId'],
      getWindowLong: user32.func(
        'long GetWindowLongW(void *hwnd, int index)',
      ) as Win32Api['getWindowLong'],
      monitorFromWindow: user32.func(
        'void *MonitorFromWindow(void *hwnd, uint32_t flags)',
      ) as Win32Api['monitorFromWindow'],
      getMonitorInfo: (monitorHandle, info) => getMonitorInfo(monitorHandle, info) !== 0,
      dwmGetWindowFrameAttribute: dwmapi.func(
        'long DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ AgentPetsFullscreenRect *value, uint32_t size)',
      ) as Win32Api['dwmGetWindowFrameAttribute'],
      dwmGetWindowCloakedAttribute: dwmapi.func(
        'long DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)',
      ) as Win32Api['dwmGetWindowCloakedAttribute'],
      setWinEventHook: user32.func(
        'void *SetWinEventHook(uint32_t eventMin, uint32_t eventMax, void *module, AgentPetsWinEventProc *callback, uint32_t processId, uint32_t threadId, uint32_t flags)',
      ) as Win32Api['setWinEventHook'],
      unhookWinEvent: hook => unhookWinEvent(hook) !== 0,
    },
  }
}

class UnavailableWindowsFullscreenDetector implements WindowsFullscreenDetector {
  readonly available = false

  setTargetWindows(_targets: WindowsFullscreenTargets): void {}

  start(): boolean {
    return false
  }

  stop(): void {}

  refresh(): void {}
}

class NativeWindowsFullscreenDetector implements WindowsFullscreenDetector {
  private readonly binding: Win32Binding
  private readonly onStateChange: (state: WindowsFullscreenState) => void
  private nativeAvailable = true
  private running = false
  private hooks: unknown[] = []
  private callbackHandle: bigint | null = null
  private refreshHandle: ReturnType<typeof setTimeout> | null = null
  private targets: WindowsFullscreenTargets = { pet: null, panel: null }
  private lastState = EMPTY_STATE

  constructor(
    binding: Win32Binding,
    onStateChange: (state: WindowsFullscreenState) => void,
  ) {
    this.binding = binding
    this.onStateChange = onStateChange
  }

  get available(): boolean {
    return this.nativeAvailable
  }

  setTargetWindows(targets: WindowsFullscreenTargets): void {
    this.targets = {
      pet: targets.pet,
      panel: targets.panel,
    }
    if (this.running) this.queueRefresh()
  }

  start(): boolean {
    if (!this.nativeAvailable) return false
    if (this.running) return true

    try {
      const callback = this.binding.koffi.register(
        this.nativeEventCallback,
        this.binding.eventCallbackPointerType,
      )
      this.callbackHandle = callback
      for (const eventId of NATIVE_EVENTS) {
        const hook = this.binding.api.setWinEventHook(
          eventId,
          eventId,
          null,
          callback,
          0,
          0,
          WINEVENT_OUTOFCONTEXT,
        )
        if (isNullPointer(hook)) throw new Error(`SetWinEventHook failed for event ${eventId}`)
        this.hooks.push(hook)
      }
      this.running = true
      this.refresh()
      return true
    } catch (error) {
      console.error('Windows fullscreen detector failed to start', error)
      this.cleanupNativeHooks()
      this.nativeAvailable = false
      return false
    }
  }

  stop(): void {
    if (this.refreshHandle) clearTimeout(this.refreshHandle)
    this.refreshHandle = null
    this.cleanupNativeHooks()
    this.running = false
    this.lastState = EMPTY_STATE
  }

  refresh(): void {
    if (!this.running) return
    try {
      this.emitState(this.evaluate())
    } catch (error) {
      console.error('Windows fullscreen detector failed during evaluation', error)
      this.stop()
      this.nativeAvailable = false
      // A native failure must restore any windows hidden by the previous state.
      this.onStateChange(EMPTY_STATE)
    }
  }

  private readonly nativeEventCallback = (
    _hook: unknown,
    eventId: number,
    _windowHandle: unknown,
    objectId: number,
    childId: number,
    _threadId: number,
    _timestamp: number,
  ): void => {
    if (!this.running) return
    if (eventId >= 0x8000 && (objectId !== OBJID_WINDOW || childId !== CHILDID_SELF)) return
    this.queueRefresh()
  }

  private queueRefresh(): void {
    if (this.refreshHandle) return
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = null
      this.refresh()
    }, 50)
  }

  private evaluate(): WindowsFullscreenState {
    const fullscreenMonitor = this.inspectFullscreenMonitor()
    if (isNullPointer(fullscreenMonitor)) return EMPTY_STATE

    return {
      fullscreen: true,
      petDisplayFullscreen: this.targetIsOnMonitor(this.targets.pet, fullscreenMonitor),
      panelDisplayFullscreen: this.targetIsOnMonitor(this.targets.panel, fullscreenMonitor),
    }
  }

  private inspectFullscreenMonitor(): unknown | null {
    const windowHandle = this.binding.api.getForegroundWindow()
    if (isNullPointer(windowHandle)) return null

    const processId = [0]
    if (this.binding.api.getWindowThreadProcessId(windowHandle, processId) === 0) return null
    if (processId[0] === process.pid) return null
    if (!this.binding.api.isWindowVisible(windowHandle)
      || this.binding.api.isIconic(windowHandle)) return null

    const cloaked = [0]
    if (this.binding.api.dwmGetWindowCloakedAttribute(
      windowHandle,
      DWMWA_CLOAKED,
      cloaked,
      Uint32Array.BYTES_PER_ELEMENT,
    ) !== 0 || cloaked[0] !== 0) return null

    const monitorHandle = this.binding.api.monitorFromWindow(
      windowHandle,
      MONITOR_DEFAULTTONEAREST,
    )
    if (isNullPointer(monitorHandle)) return null

    const monitorInfo: NativeMonitorInfo = {
      cbSize: this.binding.monitorInfoSize,
      rcMonitor: emptyRect(),
      rcWork: emptyRect(),
      dwFlags: 0,
    }
    if (!this.binding.api.getMonitorInfo(monitorHandle, monitorInfo)) return null

    const frameBounds = emptyRect()
    if (this.binding.api.dwmGetWindowFrameAttribute(
      windowHandle,
      DWMWA_EXTENDED_FRAME_BOUNDS,
      frameBounds,
      this.binding.rectSize,
    ) !== 0) return null

    const snapshot: WindowsFullscreenWindowSnapshot = {
      processId: processId[0],
      ownProcessId: process.pid,
      visible: true,
      minimized: false,
      cloaked: false,
      frameBounds,
      monitorBounds: monitorInfo.rcMonitor,
      style: this.binding.api.getWindowLong(windowHandle, GWL_STYLE),
    }
    return isExternalFullscreenWindow(snapshot) ? monitorHandle : null
  }

  private targetIsOnMonitor(
    target: bigint | null,
    fullscreenMonitor: unknown,
  ): boolean {
    if (!target) return false
    const targetMonitor = this.binding.api.monitorFromWindow(target, MONITOR_DEFAULTTONEAREST)
    return sameNativePointer(targetMonitor, fullscreenMonitor)
  }

  private emitState(nextState: WindowsFullscreenState): void {
    if (nextState.fullscreen === this.lastState.fullscreen
      && nextState.petDisplayFullscreen === this.lastState.petDisplayFullscreen
      && nextState.panelDisplayFullscreen === this.lastState.panelDisplayFullscreen) return
    this.lastState = nextState
    try {
      this.onStateChange(nextState)
    } catch (error) {
      console.error('Windows fullscreen visibility update failed', error)
    }
  }

  private cleanupNativeHooks(): void {
    for (const hook of this.hooks) {
      try {
        this.binding.api.unhookWinEvent(hook)
      } catch (error) {
        console.error('Failed to remove Windows fullscreen event hook', error)
      }
    }
    this.hooks = []
    if (this.callbackHandle !== null) {
      try {
        this.binding.koffi.unregister(this.callbackHandle)
      } catch (error) {
        console.error('Failed to release Windows fullscreen callback', error)
      }
      this.callbackHandle = null
    }
  }
}

export function createWindowsFullscreenDetector(
  onStateChange: (state: WindowsFullscreenState) => void,
  platform: NodeJS.Platform = process.platform,
): WindowsFullscreenDetector {
  if (platform !== 'win32') return new UnavailableWindowsFullscreenDetector()
  try {
    const koffi = loadKoffi()
    return new NativeWindowsFullscreenDetector(createWin32Binding(koffi), onStateChange)
  } catch (error) {
    console.error('Windows fullscreen detector is unavailable', error)
    return new UnavailableWindowsFullscreenDetector()
  }
}
