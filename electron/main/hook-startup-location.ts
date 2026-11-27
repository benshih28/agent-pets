import * as os from 'node:os'
import * as path from 'node:path'
import { DEPLOY_DIR_NAME } from '../../src/types/local-wire.ts'
import { resolveLocalPorts } from './ports.ts'

// 純函式、不碰 Electron，才能在 main.ts 其餘模組載入之前呼叫。
export function hookStartupLocation(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  homeDir: string = os.homedir(),
): { directory: string; eventPort: number } {
  return {
    directory: path.join(homeDir, DEPLOY_DIR_NAME),
    eventPort: resolveLocalPorts(env, isPackaged).event,
  }
}
