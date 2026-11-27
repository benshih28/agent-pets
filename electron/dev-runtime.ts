// Some Windows display drivers crash Chromium's GPU process under the Vite renderer; software rendering is limited to the explicit dev safe mode.
export function shouldDisableDevHardwareAcceleration(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  devServerUrl: string | undefined,
  safeModePreference: string | undefined,
): boolean {
  return platform === 'win32'
    && !isPackaged
    && Boolean(devServerUrl)
    && safeModePreference === '1'
}

export const GPU_SAFE_DEV_MODE = 'gpu-safe'

/** 和 `electron .` 相同：vite-plugin-electron 預設會多帶 `--no-sandbox`。 */
export const electronDevArgv = (): string[] => ['.']

export const electronDevEnvironment = (
  environment: NodeJS.ProcessEnv,
  gpuSafeMode: boolean,
): NodeJS.ProcessEnv => {
  const childEnvironment = { ...environment }
  if (gpuSafeMode) {
    childEnvironment.AGENT_PETS_GPU_SAFE_MODE = '1'
  } else {
    delete childEnvironment.AGENT_PETS_GPU_SAFE_MODE
  }
  return childEnvironment
}
