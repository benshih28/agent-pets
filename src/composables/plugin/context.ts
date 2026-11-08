import { inject, type InjectionKey } from 'vue'
import type { usePluginPanelController } from '../usePluginPanelController'

export type PluginPanelController = ReturnType<typeof usePluginPanelController>

// PluginPanel provides the controller once; the section components pull what
// they need instead of threading 100+ props through every level.
export const PLUGIN_PANEL_CONTROLLER: InjectionKey<PluginPanelController> = Symbol('plugin-panel-controller')

export function usePluginController(): PluginPanelController {
  const controller = inject(PLUGIN_PANEL_CONTROLLER)
  if (!controller) throw new Error('Plugin panel controller is not provided')
  return controller
}
