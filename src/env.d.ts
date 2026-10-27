/// <reference types="vite/client" />

import type { ElectronAPI } from '@/types/electron-api'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
