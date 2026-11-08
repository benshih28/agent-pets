import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PetWindowMode } from '../src/types/pet-window'
import { createAttentionBitmap } from './tray-icon'
import { buildPluginTrayMenu, type PluginTrayCommandItem } from './plugin-tray'
import { buildTrayMenuTemplate } from './tray-menu'
import { locale, t } from '../src/i18n'
import { EMPTY_ATTENTION, type AttentionSummary } from './attention-tracker'

interface DesktopTrayActions {
  getPreferences: () => DesktopPreferences
  updatePreferences: (patch: DesktopPreferencesPatch) => void
  isPetVisible: () => boolean
  showPet: () => void
  hidePet: () => void
  openPanel: () => void
  openSettings: () => void
  getPetMode: () => PetWindowMode
  getPluginCommands: () => PluginTrayCommandItem[]
  invokePluginCommand: (pluginId: string, commandId: string) => void
  onPluginCommandsOmitted?: (pluginIds: string[]) => void
  toggleMiniMode: () => void
  reloadPet?: () => void
  quit: () => void
}

export class DesktopTrayController {
  private readonly iconPath: string
  private readonly actions: DesktopTrayActions
  private tray: Tray | null = null
  private baseIcon: NativeImage | null = null
  private attentionIcon: NativeImage | null = null
  private attention: AttentionSummary = EMPTY_ATTENTION
  private get attentionCount(): number { return this.attention.total }

  constructor(iconPath: string, actions: DesktopTrayActions) {
    this.iconPath = iconPath
    this.actions = actions
  }

  create(): void {
    if (this.tray) return
    const source = nativeImage.createFromPath(this.iconPath)
    if (source.isEmpty()) throw new Error(`Tray icon not found: ${this.iconPath}`)
    const size = process.platform === 'win32' ? 16 : 18
    this.baseIcon = source.resize({ width: size, height: size })
    try {
      this.attentionIcon = nativeImage.createFromBitmap(
        createAttentionBitmap(this.baseIcon.toBitmap(), size, size),
        { width: size, height: size, scaleFactor: 1 },
      )
      if (this.attentionIcon.isEmpty()) this.attentionIcon = null
    } catch (error) {
      // Without the badge icon the count still reaches the user through the
      // tooltip (and the menu-bar title on macOS), so say why it is missing.
      console.warn('Tray attention icon could not be created', error instanceof Error ? error.message : error)
      this.attentionIcon = null
    }
    this.tray = new Tray(this.baseIcon)
    // Same as the first menu item: toggle, instead of only ever showing.
    this.tray.on('click', () => (this.actions.isPetVisible() ? this.actions.hidePet() : this.actions.showPet()))
    this.rebuild()
  }

  rebuild(): void {
    if (!this.tray) return
    const preferences = this.actions.getPreferences()
    const visible = this.actions.isPetVisible()
    if (this.baseIcon) {
      this.tray.setImage(this.attentionCount > 0 && this.attentionIcon
        ? this.attentionIcon
        : this.baseIcon)
    }

    const tooltipParts = [t('appName')]
    if (preferences.dndEnabled) tooltipParts.push(t('dnd'))
    const summaryText = this.attentionSummaryText()
    if (summaryText) tooltipParts.push(summaryText)
    this.tray.setToolTip(tooltipParts.join(' · '))
    // macOS shows the number beside the icon; other platforms rely on the badge dot + tooltip.
    if (process.platform === 'darwin') this.tray.setTitle(this.attentionCount > 0 ? String(this.attentionCount) : '')

    const pluginMenu = buildPluginTrayMenu(
      this.actions.getPluginCommands(),
      locale.value,
      t('pluginTray'),
      (pluginId, commandId) => this.actions.invokePluginCommand(pluginId, commandId),
    )
    this.actions.onPluginCommandsOmitted?.(pluginMenu.omittedPluginIds)
    const template = buildTrayMenuTemplate(
      {
        preferences,
        petVisible: visible,
        petMode: this.actions.getPetMode(),
        attention: this.attention,
        attentionText: summaryText,
        pluginMenu: pluginMenu.menu,
        pluginOmittedCount: pluginMenu.omittedCount,
        now: Date.now(),
      },
      {
        updatePreferences: patch => this.safeUpdatePreferences(patch),
        showPet: () => this.actions.showPet(),
        hidePet: () => this.actions.hidePet(),
        openPanel: () => this.actions.openPanel(),
        openSettings: () => this.actions.openSettings(),
        toggleMiniMode: () => this.safeToggleMiniMode(),
        reloadPet: this.actions.reloadPet ? () => this.actions.reloadPet?.() : undefined,
        quit: () => this.actions.quit(),
      },
    )
    const e2e = (globalThis as typeof globalThis & {
      __agentPetsE2E?: { trayMenuTemplate?: Electron.MenuItemConstructorOptions[] }
    }).__agentPetsE2E
    if (e2e) e2e.trayMenuTemplate = template
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  setAttention(summary: AttentionSummary): void {
    const clean: AttentionSummary = {
      permission: Math.max(0, Math.floor(summary.permission)),
      external: Math.max(0, Math.floor(summary.external)),
      input: Math.max(0, Math.floor(summary.input)),
      total: 0,
    }
    clean.total = clean.permission + clean.external + clean.input
    const unchanged = clean.permission === this.attention.permission
      && clean.external === this.attention.external
      && clean.input === this.attention.input
    if (unchanged) return
    this.attention = clean
    this.rebuild()
  }

  private attentionSummaryText(): string {
    const parts: string[] = []
    if (this.attention.permission > 0) parts.push(t('permission.trayPermission', { count: this.attention.permission }))
    if (this.attention.external > 0) parts.push(t('permission.trayExternal', { count: this.attention.external }))
    if (this.attention.input > 0) parts.push(t('permission.trayInput', { count: this.attention.input }))
    return parts.join(t('permission.trayJoin'))
  }

  private safeUpdatePreferences(patch: DesktopPreferencesPatch): void {
    try {
      this.actions.updatePreferences(patch)
    } catch (error) {
      console.error('Failed to update desktop preferences from Tray', error)
      this.rebuild()
    }
  }

  private safeToggleMiniMode(): void {
    try {
      this.actions.toggleMiniMode()
    } catch (error) {
      console.error('Failed to toggle Mini Mode from Tray', error)
      this.rebuild()
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
    this.baseIcon = null
    this.attentionIcon = null
  }
}
