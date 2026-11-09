import { ref, shallowRef } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import type { PanelThemeRef } from '@/types/panel-theme'
import type { UserPanelThemeIpcResult, UserPanelThemeRecord } from '@/types/panel-theme-user'

// 「我的主題」清單與主題編輯器的開啟請求（spec R22、R24）。清單只由主程序的回應更新；
// 編輯器全面板只有一個實例（StatusPanel 掛載），外觀設定與主題插件的分頁都只送出請求。

export const userPanelThemes = shallowRef<UserPanelThemeRecord[]>([])

let refreshInFlight: Promise<void> | null = null

export function refreshUserPanelThemes(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      const result = await window.electronAPI?.listUserPanelThemes()
      if (result?.ok) userPanelThemes.value = result.value.themes
    } catch {
      // 下一次操作的回應仍會帶回最新清單。
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export interface PanelThemeEditorRequest {
  /** 要編輯的「我的主題」；null = 新主題。 */
  id: string | null
  /** 新主題的起點（目錄中的插件主題）；沒有時從內建外觀開始。 */
  from?: PanelThemeRef
  nonce: number
}

export const panelThemeEditorRequest = ref<PanelThemeEditorRequest | null>(null)
let nonce = 0

export function openPanelThemeEditor(id: string | null = null, from?: PanelThemeRef): void {
  nonce += 1
  panelThemeEditorRequest.value = { id, ...(from ? { from: { ...from } } : {}), nonce }
}

export function closePanelThemeEditor(): void {
  panelThemeEditorRequest.value = null
}

const ERROR_KEY: Record<string, TranslationKey> = {
  theme_limit_reached: 'design.themeEditor.error.limitReached',
  theme_not_found: 'design.themeEditor.error.notFound',
  theme_import_invalid: 'design.themeEditor.error.importInvalid',
  invalid_panel_theme: 'design.themeEditor.error.invalid',
  // invalid_request 涵蓋所有被主程序拒絕的參數（名稱、過大的定義、多餘的參數、錯誤的 id），
  // 不能只說「名稱無效」；名稱本身在送出前已由輸入框檢查。
  invalid_request: 'design.themeEditor.error.invalidRequest',
}

export function userThemeErrorText(result: Extract<UserPanelThemeIpcResult, { ok: false }>): string {
  return t(ERROR_KEY[result.error] ?? 'design.themeEditor.error.failed')
}

/** 一次只執行一個操作；成功時更新清單並回傳結果，失敗（取消除外）時設定錯誤文字。 */
export function useUserThemeActions() {
  const busy = ref(false)
  const status = ref('')
  const error = ref('')

  async function run(task: () => Promise<UserPanelThemeIpcResult | undefined> | undefined, success = ''): Promise<UserPanelThemeIpcResult | null> {
    if (busy.value) return null
    busy.value = true
    try {
      const result = await task()
      if (!result) return null
      if (result.ok) {
        userPanelThemes.value = result.value.themes
        status.value = success
        error.value = ''
      } else if (!result.cancelled) {
        error.value = userThemeErrorText(result)
        status.value = ''
      }
      return result
    } catch {
      error.value = t('design.themeEditor.error.failed')
      return null
    } finally {
      busy.value = false
    }
  }

  return { busy, status, error, run }
}
