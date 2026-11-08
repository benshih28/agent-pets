import type { TranslationKey } from '../i18n.ts'

// Single source of truth for the settings information architecture: which
// group a section lives in, and the searchable entries inside each section.
// The settings pages render sections; search matches entries and jumps to the
// section that owns them.

export type SettingsGroupId = 'general' | 'pets' | 'desktop' | 'integrations' | 'plugins'
export type SettingsSectionId =
  | 'language' | 'appearance' | 'pets' | 'growth'
  | 'notifications' | 'desktop' | 'plugins' | 'advanced'

export interface SettingsGroupDefinition {
  id: SettingsGroupId
  icon: string
  labelKey: TranslationKey
  sections: readonly SettingsSectionId[]
}

export const SETTINGS_GROUPS: readonly SettingsGroupDefinition[] = [
  { id: 'general', icon: 'appearance', labelKey: 'panel.groupGeneral', sections: ['language', 'appearance'] },
  { id: 'pets', icon: 'pets', labelKey: 'panel.groupPets', sections: ['pets', 'growth'] },
  { id: 'desktop', icon: 'desktop', labelKey: 'panel.groupDesktop', sections: ['notifications', 'desktop'] },
  { id: 'integrations', icon: 'advanced', labelKey: 'panel.groupIntegrations', sections: ['advanced'] },
  { id: 'plugins', icon: 'plugin', labelKey: 'panel.groupPlugins', sections: ['plugins'] },
]

export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = 'general'

export function isSettingsGroupId(value: unknown): value is SettingsGroupId {
  return SETTINGS_GROUPS.some(group => group.id === value)
}

export function groupOfSection(section: SettingsSectionId): SettingsGroupId {
  return SETTINGS_GROUPS.find(group => group.sections.includes(section))?.id ?? DEFAULT_SETTINGS_GROUP
}

export interface SettingsEntry {
  id: string
  section: SettingsSectionId
  labelKey: TranslationKey
  helpKey?: TranslationKey
  /** Extra search terms (synonyms in both locales); not user-visible copy. */
  keywords: readonly string[]
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { id: 'language', section: 'language', labelKey: 'language', helpKey: 'languageHint', keywords: ['locale', '語系', '中文', 'english'] },
  { id: 'themePanel', section: 'appearance', labelKey: 'design.theme.panelEntry', helpKey: 'design.theme.help', keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'system', '主題', '深色', '淺色', '外觀', '面板'] },
  { id: 'themePet', section: 'appearance', labelKey: 'design.theme.petEntry', helpKey: 'design.theme.help', keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'bubble', '主題', '深色', '淺色', '外觀', '寵物', '氣泡'] },
  { id: 'petSize', section: 'appearance', labelKey: 'petSize', keywords: ['scale', 'size', '縮放', '大小', '尺寸'] },
  { id: 'reactions', section: 'appearance', labelKey: 'bounceShake', helpKey: 'animateStatus', keywords: ['animation', '動畫', '彈跳', '晃動', 'reaction'] },
  { id: 'statusBubble', section: 'appearance', labelKey: 'statusBubble', helpKey: 'showCompletionError', keywords: ['bubble', '氣泡', '提示'] },
  { id: 'pets', section: 'pets', labelKey: 'pets', keywords: ['sprite', 'skin', '素材', '匯入', 'import', '角色'] },
  { id: 'multiPet', section: 'pets', labelKey: 'multiPet', keywords: ['多隻', 'multiple'] },
  { id: 'projectPets', section: 'pets', labelKey: 'projectPets', keywords: ['專案', 'project', 'binding', '綁定'] },
  { id: 'moodVisuals', section: 'growth', labelKey: 'moodVisuals', helpKey: 'moodVisualsHelp', keywords: ['mood', '心情', '情緒'] },
  { id: 'growth', section: 'growth', labelKey: 'growth', keywords: ['xp', 'level', '等級', '經驗', 'streak', '連續'] },
  { id: 'achievements', section: 'growth', labelKey: 'achievements', keywords: ['achievement', '成就', '徽章'] },
  { id: 'notifications', section: 'notifications', labelKey: 'notifications', keywords: ['notify', 'toast', '通知', '提醒'] },
  { id: 'dnd', section: 'notifications', labelKey: 'dnd', keywords: ['dnd', 'focus', 'do not disturb', '勿擾', '免打擾', '專注'] },
  { id: 'sound', section: 'notifications', labelKey: 'sound', keywords: ['audio', 'mute', '音效', '聲音', '靜音'] },
  { id: 'mini', section: 'desktop', labelKey: 'miniMode', helpKey: 'miniModeHelp', keywords: ['window', '視窗', 'compact', '迷你'] },
  { id: 'edgePeek', section: 'desktop', labelKey: 'edgePeek', helpKey: 'edgePeekHelp', keywords: ['edge', '邊緣', '貼邊'] },
  { id: 'shimeji', section: 'desktop', labelKey: 'shimejiBehavior', helpKey: 'shimejiBehaviorHelp', keywords: ['wander', '走動', '自主'] },
  { id: 'captureExclusion', section: 'desktop', labelKey: 'captureExclusion', helpKey: 'captureExclusionHelp', keywords: ['screenshot', 'recording', '截圖', '錄影', '分享螢幕'] },
  { id: 'fullscreenAutoHide', section: 'desktop', labelKey: 'fullscreenAutoHide', helpKey: 'fullscreenAutoHideHelp', keywords: ['fullscreen', '全螢幕', '簡報'] },
  { id: 'completionMarkers', section: 'desktop', labelKey: 'completionMarkers', helpKey: 'completionMarkersHelp', keywords: ['completion', 'badge', 'unread', 'check', 'done', '完成標記', '完成', '標記', '徽章', '未讀', '勾'] },
  { id: 'rightClickHide', section: 'desktop', labelKey: 'rightClickHide', helpKey: 'rightClickHideHelp', keywords: ['right click', 'context', '右鍵', '隱藏'] },
  { id: 'permissionBubble', section: 'desktop', labelKey: 'permissionBubble', helpKey: 'permissionBubbleHelp', keywords: ['permission', '權限', '批准', '氣泡'] },
  { id: 'claudePermissionRespond', section: 'desktop', labelKey: 'permission.claudeRespond', helpKey: 'permission.claudeRespondHelp', keywords: ['claude', 'permission', 'approve', 'terminal', '權限', '核准', '終端機', '回覆'] },
  { id: 'presentationMcp', section: 'desktop', labelKey: 'presentationMcp', helpKey: 'presentationMcpHelp', keywords: ['mcp', '簡報', 'presentation'] },
  { id: 'launchAtStartup', section: 'desktop', labelKey: 'launchAtStartup', keywords: ['startup', 'login', 'autostart', '開機', '登入', '自動啟動'] },
  { id: 'projectMcp', section: 'advanced', labelKey: 'projectMcpPanelTitle', helpKey: 'presentationMcpSetupHelp', keywords: ['mcp', '專案', 'project'] },
  { id: 'setupWizard', section: 'advanced', labelKey: 'setupWizard', keywords: ['wizard', 'onboarding', 'hook', '精靈', '安裝', '引導'] },
  { id: 'restart', section: 'advanced', labelKey: 'restartPet', keywords: ['relaunch', 'reboot', '重啟', '重新啟動'] },
  { id: 'quit', section: 'advanced', labelKey: 'quit', keywords: ['exit', 'close app', '退出', '結束', '離開'] },
  { id: 'plugins', section: 'plugins', labelKey: 'plugins', keywords: ['extension', 'addon', '外掛', '擴充', '插件'] },
]

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

export interface SettingsSearchHit {
  entry: SettingsEntry
  label: string
  help: string
}

// Every whitespace-separated term must match the label, help text or a keyword.
export function searchSettings(
  query: string,
  translate: (key: TranslationKey) => string,
  entries: readonly SettingsEntry[] = SETTINGS_ENTRIES,
): SettingsSearchHit[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const hits: SettingsSearchHit[] = []
  for (const entry of entries) {
    const label = translate(entry.labelKey)
    const help = entry.helpKey ? translate(entry.helpKey) : ''
    const haystack = normalize([label, help, ...entry.keywords].join('\n'))
    if (terms.every(term => haystack.includes(term))) hits.push({ entry, label, help })
  }
  return hits
}
