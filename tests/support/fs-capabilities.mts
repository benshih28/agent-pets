import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { removeTempTree } from './temp-dir.mts'

function canCreateFileSymlinks(): boolean {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-symlink-probe-'))
  try {
    fs.writeFileSync(path.join(directory, 'target'), '')
    fs.symlinkSync(path.join(directory, 'target'), path.join(directory, 'link'))
    return true
  } catch {
    return false
  } finally {
    // 探測在 import 時執行：這裡拋錯會讓整個測試檔在跑任何 test 之前失敗，
    // 摘要只剩一行 'test failed'（F2 的 1831 tests／38 skip 就是這樣來的）。
    // 重試後仍刪不掉只會在暫存目錄留下一個空目錄，不影響結果，所以吞掉。
    try { removeTempTree(directory) } catch {}
  }
}

// Windows 未開啟開發者模式時，一般使用者不能建立檔案 symlink；以實際探測決定，
// 能建立的環境（macOS、Linux、開了開發者模式的 Windows）照常執行，不一律略過。
export const SKIP_WITHOUT_FILE_SYMLINKS: string | false = canCreateFileSymlinks()
  ? false
  : 'file symlinks need Developer Mode or elevated privileges on Windows'

// 目錄連結測試驗證的是受測程式碼不跟隨連結，而受測程式碼只靠 lstat().isSymbolicLink()、
// readdir 的 Dirent 與 realpath 判斷；Node 在 Windows 對 junction 的這些回報與目錄 symlink 一致，
// 且 junction 不需要開發者模式，所以用它讓這些安全測試在 Windows 也真正執行，而不是略過。
// 其他平台會忽略 'junction' 型別，照常建立目錄 symlink。
export function linkDirectory(target: string, link: string): void {
  fs.symlinkSync(target, link, 'junction')
}

// Windows 不套用 POSIX 權限位元，0o600 寫入後仍回報 0o666。
export const POSIX_FILE_MODES = process.platform !== 'win32'
