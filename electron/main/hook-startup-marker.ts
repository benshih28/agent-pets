import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 「app 正在啟動、還沒開始收事件」的標記，放在 hook 讀 token 的同一個資料夾（~/.desktop-pet）。
 * hook 只有在連線被拒時才看這個檔：有新的標記就短暫重試，沒有就立刻結束，所以寵物沒開時不會拖慢 agent。
 * 檔名帶事件埠，開發版或 e2e 改用別的埠時，不會影響送到正式版埠的 hook。
 * 檔名格式與 hook 的判斷（integrations/agent-hook.mjs 的 appIsStarting）必須一致，見 docs/dev/hook-delivery.md。
 */
export function hookStartupMarkerName(eventPort: number): string {
  return `event-port-${eventPort}.starting`
}

/** 埠開始監聽之後再留這麼久才移除，蓋過「hook 剛被拒、還沒來得及看標記」的空檔。 */
export const HOOK_STARTUP_MARKER_LINGER_MS = 2_000

export interface HookStartupMarker {
  /** 埠已開始監聽：稍後移除標記。 */
  listening(): void
  /** 啟動失敗、埠綁不上或 app 結束：立刻移除。 */
  clear(): void
}

/**
 * 寫入啟動標記。內容是本程序的 pid，移除時先核對，所以第二個實例（拿不到單一實例鎖）
 * 或已被新實例接手的舊實例，不會刪掉別人的標記。所有檔案錯誤都吞掉：標記只是加速，不能擋住啟動。
 */
export function writeHookStartupMarker(
  directory: string,
  eventPort: number,
  options: { pid?: number; setTimer?: (callback: () => void, ms: number) => unknown } = {},
): HookStartupMarker {
  const file = path.join(directory, hookStartupMarkerName(eventPort))
  const owner = `${options.pid ?? process.pid}\n`
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref())
  let lingering = false
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    // 先刪再以 wx 建立：舊檔或被換成的 symlink 都不會被跟著寫入。
    fs.rmSync(file, { force: true })
    fs.writeFileSync(file, owner, { mode: 0o600, flag: 'wx' })
  } catch {}

  const clear = () => {
    try {
      const stat = fs.lstatSync(file)
      if (stat.isFile() && stat.size <= 32 && fs.readFileSync(file, 'utf8') === owner) fs.rmSync(file, { force: true })
    } catch {}
  }
  return {
    listening() {
      if (lingering) return
      lingering = true
      setTimer(clear, HOOK_STARTUP_MARKER_LINGER_MS)
    },
    clear,
  }
}
