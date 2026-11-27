import * as os from 'node:os'
import * as path from 'node:path'
import type { AgentConfigEnv } from './agent-config-dirs.ts'

export interface SetupEnvironment {
  homeDir(): string
  appData(): string
  userData(): string
  isPackaged(): boolean
  resourcesPath(): string
  integrationsDir(): string | null
  /** Bypasses shell lookup. */
  nodePath?(): string | null
  /** 未提供時讀 process.env。測試與隔離腳本傳 {}。 */
  agentConfigEnv?(): AgentConfigEnv
  /** 會改寫 agent 設定檔的流程先 await login shell 查詢。 */
  agentConfigEnvReady?(): Promise<void>
}

function defaultAppData(): string {
  const home = os.homedir()
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config')
}

let environment: SetupEnvironment = {
  homeDir: () => os.homedir(),
  appData: defaultAppData,
  userData: () => path.join(defaultAppData(), 'agent-pets'),
  isPackaged: () => false,
  resourcesPath: () => (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '',
  integrationsDir: () => (typeof __dirname === 'string' ? path.join(__dirname, '..', 'integrations') : null),
}

export function configureSetupEnvironment(overrides: Partial<SetupEnvironment>): void {
  environment = { ...environment, ...overrides }
}

export function setupEnvironment(): SetupEnvironment {
  return environment
}
