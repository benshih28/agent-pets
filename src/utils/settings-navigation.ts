import { ref } from 'vue'
import type { SettingsSectionId } from '@/utils/settingsRegistry'

// nonce 讓同一區塊的重複請求也會觸發。
export const settingsSectionRequest = ref<{ section: SettingsSectionId; nonce: number } | null>(null)
let nonce = 0

export function requestSettingsSection(section: SettingsSectionId): void {
  nonce += 1
  settingsSectionRequest.value = { section, nonce }
}

// 分頁是否存在只有 StatusPanel 知道，所以這裡只發出請求，由 StatusPanel 決定去哪裡。
export const panelThemeTargetRequest = ref<{ pluginId: string; nonce: number } | null>(null)

export function openPanelThemeSettings(pluginId: string | null): void {
  if (pluginId) {
    nonce += 1
    panelThemeTargetRequest.value = { pluginId, nonce }
  } else {
    requestSettingsSection('appearance')
  }
}
