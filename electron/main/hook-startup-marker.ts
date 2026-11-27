import * as fs from 'node:fs'
import * as path from 'node:path'

// hook 只有在連線被拒時才看這個檔：有新標記就短暫重試，沒有就立刻結束，所以寵物沒開時不會拖慢 agent。
// 檔名帶事件埠，開發版或 e2e 改用別的埠時不影響正式版的 hook；格式必須與 integrations/agent-hook.mjs 的 appIsStarting 一致。
export function hookStartupMarkerName(eventPort: number): string {
  return `event-port-${eventPort}.starting`
}

// 埠開始監聽之後再留這麼久才移除，蓋過 hook 剛被拒、還沒來得及看標記的空檔。
export const HOOK_STARTUP_MARKER_LINGER_MS = 2_000

// 與 integrations/agent-hook.mjs 的 STARTUP_MARKER_MAX_AGE_MS 相同（契約，兩邊要一起改）：hook 會忽略更舊的標記。
export const HOOK_STARTUP_MARKER_MAX_AGE_MS = 20_000

export interface HookStartupMarker {
  listening(): void
  /** 只會移除本程序擁有的標記。 */
  clear(): void
  /** `--relaunch` 的新實例啟動時舊實例可能還活著而沒寫標記，舊實例結束時只會清掉自己的，所以取得鎖之後要接手。 */
  claim(): void
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM：程序存在但不屬於我們；只有 ESRCH 才表示已結束。
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readMarker(file: string): { pid: number; ageMs: number } | null {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.size > 32) return null
    const pid = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? { pid, ageMs: Date.now() - stat.mtimeMs } : null
  } catch {
    return null
  }
}

// 移除時先核對 pid，第二個實例或被接手的舊實例才不會刪掉別人的標記。
// 寫入發生在單一實例鎖之前：已有夠新且擁有者還活著的標記就不動它，否則第二個啟動的程序會蓋掉第一個實例的標記，再因拿不到鎖而清掉它。
// 所有檔案錯誤都吞掉：標記只是加速，不能擋住啟動。
export function writeHookStartupMarker(
  directory: string,
  eventPort: number,
  options: { pid?: number; setTimer?: (callback: () => void, ms: number) => unknown } = {},
): HookStartupMarker {
  const file = path.join(directory, hookStartupMarkerName(eventPort))
  const pid = options.pid ?? process.pid
  const owner = `${pid}\n`
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref())
  let lingering = false

  const create = () => {
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      // 先刪再以 wx 建立：舊檔或被換成的 symlink 都不會被跟著寫入。
      fs.rmSync(file, { force: true })
      fs.writeFileSync(file, owner, { mode: 0o600, flag: 'wx' })
    } catch {}
  }
  const ownsMarker = () => {
    try {
      const stat = fs.lstatSync(file)
      return stat.isFile() && stat.size <= 32 && fs.readFileSync(file, 'utf8') === owner
    } catch {
      return false
    }
  }
  const clear = () => {
    try {
      if (ownsMarker()) fs.rmSync(file, { force: true })
    } catch {}
  }

  const existing = readMarker(file)
  const heldByLiveOwner = existing !== null && existing.pid !== pid && existing.ageMs < HOOK_STARTUP_MARKER_MAX_AGE_MS && existing.ageMs > -1_000 && pidIsAlive(existing.pid)
  if (!heldByLiveOwner) create()

  return {
    listening() {
      if (lingering) return
      lingering = true
      setTimer(clear, HOOK_STARTUP_MARKER_LINGER_MS)
    },
    clear,
    claim() {
      if (lingering || ownsMarker()) return
      create()
    },
  }
}
