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
    // 探測在 import 時執行，拋錯會讓整個測試檔在跑任何 test 之前失敗；刪不掉只留空暫存目錄，所以吞掉。
    try { removeTempTree(directory) } catch {}
  }
}

// Windows 未開啟開發者模式時一般使用者不能建立檔案 symlink，以實際探測決定是否略過。
export const SKIP_WITHOUT_FILE_SYMLINKS: string | false = canCreateFileSymlinks()
  ? false
  : 'file symlinks need Developer Mode or elevated privileges on Windows'

// Windows 的 junction 對 lstat／Dirent／realpath 的回報與目錄 symlink 一致且不需開發者模式；其他平台忽略 'junction' 型別。
export function linkDirectory(target: string, link: string): void {
  fs.symlinkSync(target, link, 'junction')
}

// Windows 不套用 POSIX 權限位元，0o600 寫入後仍回報 0o666。
export const POSIX_FILE_MODES = process.platform !== 'win32'
