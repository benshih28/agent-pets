export type BubbleKind =
  | 'permission-request'
  | 'permission-notice'
  | 'agent-toast'
  | 'presentation-say'
  | 'plugin-feed-normal'
  | 'activity'
  | 'plugin-feed-low'

export interface PluginBubbleControls {
  pluginsEnabled: boolean
  enabled: boolean
  muted: boolean
  dnd: boolean
  visible: boolean
}

export interface PluginBubbleCandidate {
  priority: 'low' | 'normal'
  controls: PluginBubbleControls
}

export interface BubbleCandidates {
  permissionRequest?: boolean
  permissionNotice?: boolean
  agentToast?: boolean
  presentationSay?: boolean
  pluginFeed?: PluginBubbleCandidate | null
  activity?: boolean
}

/** Selects one visible bubble from already-gated Agent and plugin candidates. */
export function selectBubble(candidates: BubbleCandidates): BubbleKind | null {
  if (candidates.permissionRequest) return 'permission-request'
  if (candidates.permissionNotice) return 'permission-notice'
  if (candidates.presentationSay) return 'presentation-say'
  if (candidates.agentToast) return 'agent-toast'

  const plugin = candidates.pluginFeed
  const pluginCanShow = Boolean(
    plugin
    && plugin.controls.pluginsEnabled
    && plugin.controls.enabled
    && !plugin.controls.muted
    && !plugin.controls.dnd
    && plugin.controls.visible,
  )
  if (pluginCanShow && plugin?.priority === 'normal') return 'plugin-feed-normal'
  if (candidates.activity) return 'activity'
  if (pluginCanShow && plugin?.priority === 'low') return 'plugin-feed-low'
  return null
}
