import { ref } from 'vue'
import type { SettingsSectionId } from '@/utils/settingsRegistry'

// 面板內「前往這個設定區塊」的請求。導覽由 SettingsPage 負責；
// nonce 讓同一區塊的重複請求也會觸發。
export const settingsSectionRequest = ref<{ section: SettingsSectionId; nonce: number } | null>(null)
let nonce = 0

export function requestSettingsSection(section: SettingsSectionId): void {
  nonce += 1
  settingsSectionRequest.value = { section, nonce }
}

/**
 * 「開啟插件設定」與搜尋「面板主題」的目的地：主題插件有儀表板分頁時前往分頁（主題清單是分頁主體），
 * 否則前往設定 → 插件 → 詳情頁的面板主題；沒有主題插件時前往外觀狀態卡。分頁是否存在只有
 * StatusPanel 知道，所以這裡只發出請求，由 StatusPanel 決定去哪裡。
 */
export const panelThemeTargetRequest = ref<{ pluginId: string; nonce: number } | null>(null)

export function openPanelThemeSettings(pluginId: string | null): void {
  if (pluginId) {
    nonce += 1
    panelThemeTargetRequest.value = { pluginId, nonce }
  } else {
    requestSettingsSection('appearance')
  }
}
