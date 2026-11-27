import { inject, type InjectionKey } from 'vue'
import type { usePluginPanelController } from '@/composables/usePluginPanelController'

export type PluginPanelController = ReturnType<typeof usePluginPanelController>

export const PLUGIN_PANEL_CONTROLLER: InjectionKey<PluginPanelController> = Symbol('plugin-panel-controller')

export function usePluginController(): PluginPanelController {
  const controller = inject(PLUGIN_PANEL_CONTROLLER)
  if (!controller) throw new Error('Plugin panel controller is not provided')
  return controller
}
