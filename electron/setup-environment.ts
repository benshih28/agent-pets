import * as os from 'node:os'
import * as path from 'node:path'

// Everything setup.ts needs from the host (Electron's `app`, the user's home directory) goes through
// this small, Electron-free seam. The app wires it up in main.ts; the CLI installer and the tests
// supply their own values, so installs can be exercised against a temporary HOME.

export interface SetupEnvironment {
  homeDir(): string
  appData(): string
  userData(): string
  isPackaged(): boolean
  resourcesPath(): string
  /** Folder holding agent-hook.mjs / agent-hook.cmd / presentation-mcp.mjs. */
  integrationsDir(): string | null
  /** Fixed Node.js executable (CLI/tests); bypasses shell lookup. */
  nodePath?(): string | null
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
