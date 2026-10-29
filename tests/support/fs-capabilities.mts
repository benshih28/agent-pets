import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function canCreateFileSymlinks(): boolean {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-symlink-probe-'))
  try {
    fs.writeFileSync(path.join(directory, 'target'), '')
    fs.symlinkSync(path.join(directory, 'target'), path.join(directory, 'link'))
    return true
  } catch {
    return false
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

// Windows 未開啟開發者模式時，一般使用者不能建立檔案 symlink；以實際探測決定，
// 能建立的環境（macOS、Linux、開了開發者模式的 Windows）照常執行，不一律略過。
export const SKIP_WITHOUT_FILE_SYMLINKS: string | false = canCreateFileSymlinks()
  ? false
  : 'file symlinks need Developer Mode or elevated privileges on Windows'

// Windows 不套用 POSIX 權限位元，0o600 寫入後仍回報 0o666。
export const POSIX_FILE_MODES = process.platform !== 'win32'
