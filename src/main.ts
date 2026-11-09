import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import '@/styles/tokens.css'
import '@/styles/base.css'
import App from '@/App.vue'
import RendererErrorBoundary from '@/components/RendererErrorBoundary.vue'
import { initTheme } from '@/composables/useTheme'

// 面板視窗載入 #panel；其餘（寵物視窗）用寵物外觀（useTheme.ts）。
initTheme(window.location.hash === '#panel' ? 'panel' : 'pet')
if (import.meta.env.MODE === 'gpu-safe') document.documentElement.dataset.gpuSafe = ''

type ErrorKind = 'vue' | 'unhandledrejection' | 'error'

function reportError(kind: ErrorKind, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    // Main redacts and rate-limits before anything is written to disk.
    window.electronAPI?.reportRendererError?.({ kind, message, stack })
  } catch {
    // Reporting must never throw back into the failing code path.
  }
}

const app = createApp({ render: () => h(RendererErrorBoundary, null, { default: () => h(App) }) })
app.config.errorHandler = (error) => reportError('vue', error)
window.addEventListener('unhandledrejection', event => reportError('unhandledrejection', event.reason))
window.addEventListener('error', event => reportError('error', event.error ?? event.message))
app.use(createPinia())
app.mount('#app')
