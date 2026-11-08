import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PetWindowMode } from '../src/types/pet-window'
import { t } from '../src/i18n.ts'
import type { AttentionSummary } from './attention-tracker.ts'
import { dndRemainingMs, resolveDndUntil, type DndPreset } from './dnd-schedule.ts'

export interface TrayMenuActions {
  updatePreferences(patch: DesktopPreferencesPatch): void
  showPet(): void
  hidePet(): void
  openPanel(): void
  openSettings(): void
  toggleMiniMode(): void
  reloadPet?: () => void
  quit(): void
}

export interface TrayMenuContext {
  preferences: DesktopPreferences
  petVisible: boolean
  petMode: PetWindowMode
  attention: AttentionSummary
  attentionText: string
  /** Prebuilt plugin submenu (or null) and how many commands did not fit. */
  pluginMenu: MenuItemConstructorOptions | null
  pluginOmittedCount: number
  now: number
}

function dndRemainingLabel(preferences: DesktopPreferences, now: number): string {
  const remaining = dndRemainingMs(preferences.dndEnabled, preferences.dndUntil, now)
  if (remaining === null) return preferences.dndEnabled ? t('permission.trayDndOn') : ''
  const minutes = Math.max(1, Math.ceil(remaining / 60_000))
  return minutes >= 120
    ? t('permission.trayDndRemainingHours', { hours: Math.ceil(minutes / 60) })
    : t('permission.trayDndRemainingMinutes', { minutes })
}

/**
 * Builds the Tray menu as plain data so its structure can be tested without
 * Electron. Order: what needs attention, pet, notifications / DND, advanced,
 * plugins, settings, quit. The plugin submenu is inserted at an explicit slot,
 * never found by comparing labels.
 */
export function buildTrayMenuTemplate(context: TrayMenuContext, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  const { preferences, now } = context
  const update = (patch: DesktopPreferencesPatch) => actions.updatePreferences(patch)

  const startDnd = (preset: DndPreset) => update({ dndEnabled: true, dndUntil: resolveDndUntil(preset, now) })
  const dndStatus = dndRemainingLabel(preferences, now)
  const dndLabel = dndStatus ? `${t('dnd')}（${dndStatus}）` : t('dnd')

  const template: MenuItemConstructorOptions[] = []

  if (context.attention.total > 0) {
    template.push(
      {
        label: t('permission.trayPending', { count: context.attention.total, detail: context.attentionText }),
        click: () => actions.openPanel(),
      },
      { type: 'separator' },
    )
  }

  template.push(
    {
      label: context.petVisible ? t('hidePets') : t('showPets'),
      click: () => (context.petVisible ? actions.hidePet() : actions.showPet()),
    },
    { label: t('openControlPanel'), click: () => actions.openPanel() },
    {
      label: t('miniMode'),
      type: 'checkbox',
      checked: context.petMode === 'mini',
      click: () => actions.toggleMiniMode(),
    },
    { type: 'separator' },
    {
      label: dndLabel,
      submenu: [
        { label: t('permission.trayDndOff'), type: 'radio', checked: !preferences.dndEnabled, click: () => update({ dndEnabled: false, dndUntil: null }) },
        { label: t('permission.trayDnd30m'), type: 'radio', checked: false, click: () => startDnd('30m') },
        { label: t('permission.trayDnd1h'), type: 'radio', checked: false, click: () => startDnd('1h') },
        { label: t('permission.trayDndTomorrow'), type: 'radio', checked: false, click: () => startDnd('tomorrow') },
        {
          label: t('permission.trayDndAlways'),
          type: 'radio',
          checked: preferences.dndEnabled && preferences.dndUntil === null,
          click: () => update({ dndEnabled: true, dndUntil: null }),
        },
      ],
    },
    {
      label: t('notifications'),
      type: 'checkbox',
      checked: preferences.notificationsEnabled,
      click: item => update({ notificationsEnabled: item.checked }),
    },
    {
      label: t('sound'),
      type: 'checkbox',
      checked: preferences.soundEnabled,
      click: item => update({ soundEnabled: item.checked }),
    },
    {
      label: t('permissionBubble'),
      type: 'checkbox',
      checked: preferences.permissionBubbleEnabled,
      click: item => update({ permissionBubbleEnabled: item.checked }),
    },
    { type: 'separator' },
    {
      label: t('permission.trayAdvanced'),
      submenu: [
        {
          label: t('edgePeekMode'),
          type: 'checkbox',
          checked: preferences.edgeModeEnabled,
          click: item => update({ edgeModeEnabled: item.checked }),
        },
        {
          label: t('presentationMcp'),
          type: 'checkbox',
          checked: preferences.presentationMcpEnabled,
          click: item => update({ presentationMcpEnabled: item.checked }),
        },
        {
          label: t('fullscreenAutoHide'),
          type: 'checkbox',
          checked: preferences.fullscreenAutoHideEnabled,
          enabled: preferences.visibilityCapabilities.fullscreenAutoHide.supported,
          click: item => update({ fullscreenAutoHideEnabled: item.checked }),
        },
        {
          label: preferences.launchAtStartup && preferences.launchAtStartupStatus === 'requires-approval'
            ? `${t('launchAtStartup')}${t('reliability.launch.trayPending')}`
            : t('launchAtStartup'),
          type: 'checkbox',
          checked: preferences.launchAtStartup,
          enabled: preferences.launchAtStartupSupported,
          click: item => update({ launchAtStartup: item.checked }),
        },
        ...(actions.reloadPet
          ? [{ label: t('reliability.tray.reloadPet'), click: () => actions.reloadPet?.() } satisfies MenuItemConstructorOptions]
          : []),
      ],
    },
  )

  // Plugin slot.
  if (context.pluginMenu) {
    const pluginItem = { ...context.pluginMenu }
    if (context.pluginOmittedCount > 0 && Array.isArray(pluginItem.submenu)) {
      pluginItem.submenu = [
        ...pluginItem.submenu,
        { type: 'separator' },
        { label: t('permission.trayPluginsOmitted', { count: context.pluginOmittedCount }), enabled: false },
      ]
    }
    template.push(pluginItem)
  }

  template.push(
    { label: t('openSettings'), click: () => actions.openSettings() },
    { type: 'separator' },
    { label: t('quit'), click: () => actions.quit() },
  )
  return template
}
