import { createRequire } from 'node:module'
import { join } from 'node:path'

// Windows 版「切換到 App」：用 koffi 呼叫 user32 / kernel32 / dwmapi，依 Z 順序找出屬於白名單
// 執行檔的最上層視窗並帶到前景。不啟動任何程序、不經過 shell，也不需要額外權限。
// 傳進來的只有 src/types/host-app.ts 白名單中的小寫 basename，不接受事件給的路徑或 PID。

export type WindowsActivationResult = 'activated' | 'not_found' | 'failed'

/** 原生層的最小介面；測試注入假的實作，絕不呼叫真的 Win32。 */
export interface WindowsWindowApi {
  /** Z 順序最上面的最上層視窗；沒有則 null。 */
  topWindow(): bigint | null
  nextWindow(handle: bigint): bigint | null
  isVisible(handle: bigint): boolean
  isCloaked(handle: bigint): boolean
  isMinimized(handle: bigint): boolean
  isToolWindow(handle: bigint): boolean
  hasOwner(handle: bigint): boolean
  processId(handle: bigint): number
  /** 該程序的完整映像路徑；無法取得（權限、已結束）時 null。 */
  imagePath(processId: number): string | null
  restore(handle: bigint): void
  setForeground(handle: bigint): boolean
  foregroundWindow(): bigint | null
  threadId(handle: bigint): number
  currentThreadId(): number
  attachThreadInput(fromThread: number, toThread: number, attach: boolean): boolean
}

// 防止異常的視窗鏈（或被中途改動）造成無窮迴圈。
const MAX_WINDOWS_SCANNED = 4000
const MAX_EXECUTABLE_NAME_LENGTH = 64

/**
 * 只比對 basename、不分大小寫、完全相等。刻意不比對目錄：安裝位置因安裝版／可攜版／Store 版而異，
 * 路徑白名單會很脆弱；而 `C:\evil\Code.exe` 即使通過，也只是把使用者自己帳號下的一個視窗帶到前景，
 * 不會執行任何東西。`Code.exe.evil`、`Code.exe ` 這類不是完全相等，一律拒絕。
 */
export function isAllowedWindowsExecutable(imagePath: string | null, allowed: ReadonlyArray<string>): boolean {
  if (typeof imagePath !== 'string' || imagePath.length === 0 || imagePath.length > 1024) return false
  const separator = Math.max(imagePath.lastIndexOf('\\'), imagePath.lastIndexOf('/'))
  const base = imagePath.slice(separator + 1).toLowerCase()
  if (base.length === 0 || base.length > MAX_EXECUTABLE_NAME_LENGTH) return false
  return allowed.some(name => name === base)
}

/**
 * 把原生層回傳的 HWND 統一成 `bigint | null`：null、undefined、0、0n 與無法辨識的型別都視為空；
 * number 轉 BigInt、bigint 原樣。koffi 的 `void *` 實際回傳 BigInt，但不依賴這個細節，
 * 免得同一視窗以不同型別或包裝物件出現時用 `===` 誤判成不同視窗。
 */
export function normalizeWindowHandle(value: unknown): bigint | null {
  // 包裝物件（Object(5n)、new Number(5)）取出原始值再比較。
  if (value instanceof BigInt || value instanceof Number) return normalizeWindowHandle(value.valueOf())
  if (typeof value === 'bigint') return value === 0n ? null : value
  if (typeof value === 'number') return Number.isSafeInteger(value) && value !== 0 ? BigInt(value) : null
  return null
}

function isSwitchableWindow(api: WindowsWindowApi, handle: bigint): boolean {
  // 隱藏、被 DWM 遮蔽（其他虛擬桌面）、工具視窗與有擁有者的對話框都不是使用者會想回去的主視窗。
  return api.isVisible(handle) && !api.isCloaked(handle) && !api.isToolWindow(handle) && !api.hasOwner(handle)
}

function findWindow(api: WindowsWindowApi, allowed: ReadonlyArray<string>): bigint | null {
  // 每次掃描只查一次各程序的映像路徑。
  const verdicts = new Map<number, boolean>()
  let handle = normalizeWindowHandle(api.topWindow())
  for (let scanned = 0; handle !== null && scanned < MAX_WINDOWS_SCANNED; scanned += 1) {
    if (isSwitchableWindow(api, handle)) {
      const pid = api.processId(handle)
      let allowedProcess = verdicts.get(pid)
      if (allowedProcess === undefined) {
        allowedProcess = pid > 0 && isAllowedWindowsExecutable(api.imagePath(pid), allowed)
        verdicts.set(pid, allowedProcess)
      }
      // Z 順序由上而下，第一個符合的就是最近用過的那個視窗。
      if (allowedProcess) return handle
    }
    handle = normalizeWindowHandle(api.nextWindow(handle))
  }
  return null
}

function bringForward(api: WindowsWindowApi, handle: bigint): boolean {
  if (api.isMinimized(handle)) api.restore(handle)
  // 使用者剛點了寵物或通知，本程序通常持有前景權，直接呼叫即可成功。
  if (api.setForeground(handle) && sameWindow(api.foregroundWindow(), handle)) return true
  // 前景鎖定擋下時的備援：暫時把本執行緒的輸入佇列接到目前前景視窗的執行緒再重試，
  // 這是不需權限的慣用做法；風險是兩個執行緒共用輸入狀態，所以限定單次、用完立刻解除。
  const foreground = normalizeWindowHandle(api.foregroundWindow())
  const foregroundThread = foreground === null ? 0 : api.threadId(foreground)
  const ownThread = api.currentThreadId()
  if (foregroundThread === 0 || foregroundThread === ownThread) return false
  if (!api.attachThreadInput(ownThread, foregroundThread, true)) return false
  try {
    api.setForeground(handle)
  } finally {
    api.attachThreadInput(ownThread, foregroundThread, false)
  }
  return sameWindow(api.foregroundWindow(), handle)
}

function sameWindow(left: unknown, right: unknown): boolean {
  const a = normalizeWindowHandle(left)
  const b = normalizeWindowHandle(right)
  return a !== null && b !== null && a === b
}

/** 純邏輯：原生層丟錯一律回 failed，不會往外拋。 */
export function activateWindowsHost(api: WindowsWindowApi, allowedExecutables: ReadonlyArray<string>): WindowsActivationResult {
  if (allowedExecutables.length === 0) return 'not_found'
  try {
    const handle = findWindow(api, allowedExecutables)
    if (handle === null) return 'not_found'
    return bringForward(api, handle) ? 'activated' : 'failed'
  } catch {
    return 'failed'
  }
}

// ── koffi 繫結（只在 win32 延遲載入） ──────────────────────────────────────────

// Win32 BOOL 是 4-byte int（不是 C++ bool）：回傳 BOOL 的函式一律宣告 int 並以 !== 0 判斷。
const GW_HWNDNEXT = 2
const GW_OWNER = 4
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x00000080
const SW_RESTORE = 9
const DWMWA_CLOAKED = 14
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const IMAGE_PATH_CAPACITY = 1024

type KoffiModule = typeof import('koffi')

function loadKoffi(): KoffiModule {
  const runtimeRequire = createRequire(typeof __filename === 'string' ? __filename : join(process.cwd(), 'package.json'))
  return runtimeRequire('koffi') as KoffiModule
}

export function createNativeWindowsApi(platform: NodeJS.Platform = process.platform): WindowsWindowApi | null {
  if (platform !== 'win32') return null
  try {
    const koffi = loadKoffi()
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    const getTopWindow = user32.func('void *GetTopWindow(void *hwnd)')
    const getWindow = user32.func('void *GetWindow(void *hwnd, uint32_t cmd)')
    const isWindowVisible = user32.func('int IsWindowVisible(void *hwnd)')
    const isIconic = user32.func('int IsIconic(void *hwnd)')
    const getWindowLong = user32.func('long GetWindowLongW(void *hwnd, int index)')
    const getWindowThreadProcessId = user32.func('uint32_t GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *processId)')
    const showWindow = user32.func('int ShowWindow(void *hwnd, int cmd)')
    const setForegroundWindow = user32.func('int SetForegroundWindow(void *hwnd)')
    const getForegroundWindow = user32.func('void *GetForegroundWindow()')
    const attachThreadInput = user32.func('int AttachThreadInput(uint32_t from, uint32_t to, int attach)')
    const getCurrentThreadId = kernel32.func('uint32_t GetCurrentThreadId()')
    const openProcess = kernel32.func('void *OpenProcess(uint32_t access, int inherit, uint32_t processId)')
    const closeHandle = kernel32.func('int CloseHandle(void *handle)')
    const queryImageName = kernel32.func('int QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)')
    const dwmGetAttribute = dwmapi.func('long DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)')

    return {
      topWindow: () => normalizeWindowHandle(getTopWindow(null)),
      nextWindow: handle => normalizeWindowHandle(getWindow(handle, GW_HWNDNEXT)),
      isVisible: handle => isWindowVisible(handle) !== 0,
      isCloaked: handle => {
        const out = [0]
        // 取不到就當作沒被遮蔽；其餘條件仍會把關。
        return dwmGetAttribute(handle, DWMWA_CLOAKED, out, 4) === 0 && out[0] !== 0
      },
      isMinimized: handle => isIconic(handle) !== 0,
      isToolWindow: handle => (Number(getWindowLong(handle, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) !== 0,
      hasOwner: handle => {
        return normalizeWindowHandle(getWindow(handle, GW_OWNER)) !== null
      },
      processId: handle => {
        const out = [0]
        getWindowThreadProcessId(handle, out)
        return out[0] ?? 0
      },
      imagePath: processId => {
        // 高權限程序也只需要 QUERY_LIMITED_INFORMATION；開不起來（受保護或已結束）就當作未知。
        const process = normalizeWindowHandle(openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, processId))
        if (process === null) return null
        try {
          const buffer = new Uint16Array(IMAGE_PATH_CAPACITY)
          const size = [IMAGE_PATH_CAPACITY]
          if (queryImageName(process, 0, buffer, size) === 0) return null
          const length = Math.min(size[0] ?? 0, IMAGE_PATH_CAPACITY)
          return String.fromCharCode(...buffer.subarray(0, length))
        } finally {
          closeHandle(process)
        }
      },
      restore: handle => { showWindow(handle, SW_RESTORE) },
      setForeground: handle => setForegroundWindow(handle) !== 0,
      foregroundWindow: () => normalizeWindowHandle(getForegroundWindow()),
      threadId: handle => getWindowThreadProcessId(handle, [0]),
      currentThreadId: () => getCurrentThreadId(),
      attachThreadInput: (from, to, attach) => attachThreadInput(from, to, attach ? 1 : 0) !== 0,
    }
  } catch (error) {
    console.error('Windows window activator failed to load', error)
    return null
  }
}

let cachedApi: WindowsWindowApi | null | undefined

/** 供 runtime 使用：koffi 載入失敗回 failed，下次仍會重試（但只會載入一次成功的繫結）。 */
export async function activateWindowsApp(
  allowedExecutables: ReadonlyArray<string>,
  api?: WindowsWindowApi | null,
): Promise<WindowsActivationResult> {
  const resolved = api ?? (cachedApi ??= createNativeWindowsApi())
  if (!resolved) {
    cachedApi = undefined
    return 'failed'
  }
  return activateWindowsHost(resolved, allowedExecutables)
}
