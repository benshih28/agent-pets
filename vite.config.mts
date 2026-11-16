import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import type { SpawnOptions } from 'node:child_process'
import { resolve } from 'path'
// 啟動參數與環境放在不依賴 vite 的模組：測試只載入它，tests 的型別檢查才不會經由 vite 的宣告檔多帶進一份 @types/node。
import { electronDevArgv, electronDevEnvironment, GPU_SAFE_DEV_MODE } from './electron/dev-runtime.ts'

const createElectronStarter = (gpuSafeMode: boolean) => ({
  startup,
}: {
  startup: (argv?: string[], options?: SpawnOptions) => Promise<boolean>
}) => {
  // vite-plugin-electron otherwise appends --no-sandbox. Agent Pets already
  // supports Chromium sandboxing and should use the same argv as `electron .`.
  void startup(electronDevArgv(), {
    env: electronDevEnvironment(process.env, gpuSafeMode),
  })
}

export default defineConfig(({ mode }) => {
  const startElectron = createElectronStarter(mode === GPU_SAFE_DEV_MODE)

  return {
    build: {
      rollupOptions: {
        output: {
          // Vue 執行期與 Pinia 兩個視窗一開始都會載入，獨立成一個 chunk，讓共用 chunk 只放 app 程式碼、
          // 不超過 scripts/check-bundle-size.mjs 的單一 chunk 上限；只挑這幾個套件，避免把只在延遲載入頁面
          // 用到的相依拉進首屏。
          manualChunks: (id: string) => (/[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@vue|vue|pinia)[\\/]/.test(id) ? 'vue-vendor' : undefined),
        },
      },
    },
    plugins: [
      vue(),
      electron({
        main: {
          entry: 'electron/main.ts',
          onstart: startElectron,
        },
        preload: [
          {
            input: 'electron/preload.ts',
            // This is the sole preload allowed to perform the initial launch.
            onstart: startElectron,
          },
          {
            input: 'electron/plugin-host-preload.ts',
            // The simple plugin disables code splitting for preload outputs,
            // so a multi-entry object cannot be built. Build this preload as
            // its own entry without starting another Electron process.
            onstart: () => {},
          },
          {
            input: 'electron/plugin-ui-preload.ts',
            onstart: () => {},
          },
        ],
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
  }
})
