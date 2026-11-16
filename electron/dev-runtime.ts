/**
 * Some Windows display drivers crash Chromium's GPU process while the Vite
 * renderer is active. Limit software rendering to the explicit development
 * safe mode so packaged builds and other platforms retain acceleration.
 */
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

/** safe mode 偏好只經由 child process 環境交給主程序；沒選時清掉繼承來的舊值。 */
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
