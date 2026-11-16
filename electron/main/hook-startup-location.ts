import * as os from 'node:os'
import * as path from 'node:path'
import { DEPLOY_DIR_NAME } from '../../src/types/local-wire.ts'
import { resolveLocalPorts } from './ports.ts'

/**
 * 啟動標記要寫在哪個資料夾、用哪個事件埠。純函式、不碰 Electron，所以可以在 main.ts 其餘模組載入之前呼叫，
 * 也能用測試和 `runtime.ts` 的 `localPorts()`、`setup.ts` 的 `hookScriptDeployPath()` 比對。
 * 部署資料夾是家目錄下的 `.desktop-pet`（main.ts 設定 setup 環境時沒有覆寫 homeDir）。
 */
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
