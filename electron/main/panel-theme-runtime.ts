import { createHmac, randomBytes } from 'node:crypto'
import {
  buildPanelThemeState,
  checkPanelThemePackagedImage,
  checkPanelThemeUserImage,
  emptyPanelThemeState,
  isWoff2,
  PANEL_THEME_FONT_MAX_BYTES,
  PANEL_THEME_IMAGE_MAX_BYTES,
  PANEL_THEME_USER_IMAGE_MAX_BYTES,
  type PanelThemeSourcePlugin,
  type ResolvedPanelTheme,
} from '../plugin-panel-themes.ts'
import { PanelThemeStore, PANEL_THEME_USER_IMAGE_FILE } from '../panel-theme-store.ts'
import { panelThemePluginImageDirectory, removePluginImages, sweepOrphanUserImages, deleteUserImage } from '../panel-theme-images.ts'
import type { PluginLocalizedText, PluginManifest } from '../../src/types/plugin.ts'
import { PET_THEME_COLOR_PROPERTIES, type PanelThemeMode, type PanelThemeState, type PetThemeModeState, type PetThemeState } from '../../src/types/panel-theme.ts'
import type { PluginThemeSnapshot } from '../../src/types/plugin-theme.ts'
import { buildPluginThemeSnapshot } from '../plugin-theme-tokens.ts'
import { ContentHashCache, PanelThemeResolveCache } from './panel-theme-cache.ts'
import { UserPanelThemeStore } from '../panel-theme-user-store.ts'
import { parseUserPanelThemeDefinition, userPanelThemeContribution } from '../panel-theme-user.ts'
import { userPanelThemeSchemaFailure, validateUserPanelTheme } from '../panel-theme-diagnostics.ts'
import { USER_PANEL_THEME_MAX_COUNT, USER_PANEL_THEME_OWNER, USER_PANEL_THEME_SOURCE_NAME, type PanelThemeValidation } from '../../src/types/panel-theme-user.ts'

type AssetKind = 'image' | 'font' | 'user'

interface TokenAsset {
  kind: AssetKind
  root: string
  relativePath: string
  maxBytes: number
}

export interface PanelThemeRegistryEntry {
  id: string
  currentVersion: string
  status: string
}

export interface PanelThemeRuntimeContext {
  manifest: Pick<PluginManifest, 'name' | 'contributes'>
  enabled: boolean
  pluginsEnabled: boolean
}

export interface PanelThemeSyncInput {
  registry: readonly PanelThemeRegistryEntry[]
  contexts: ReadonlyMap<string, PanelThemeRuntimeContext>
  pluginsEnabled: boolean
}

export interface PanelThemeRuntimeOptions {
  userDataDirectory: string
  pluginRoot(pluginId: string, version: string): string
  readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array | null>
  send(state: PanelThemeState): void
  sendPetStatus(state: PetThemeState): void
  /** 允許跨來源讀取字型的來源（受信任的面板渲染端）。 */
  rendererOrigin(): string | null
  sendPluginTheme(snapshot: PluginThemeSnapshot): void
  initialMode?: PanelThemeMode
  schedulePluginTheme?: (callback: () => void) => void
  salt?: Uint8Array
  resolveCache?: PanelThemeResolveCache
}

export interface PanelAppearance {
  mode: PanelThemeMode
  forcedColors: boolean
}

export const PLUGIN_THEME_CHANGE_DELAY_MS = 100

const TOKEN_PATH = /^\/([0-9a-f]{32})$/

function hmacHex(salt: Uint8Array, value: string): string {
  return createHmac('sha256', salt).update(value, 'utf8').digest('hex')
}

export class PanelThemeRuntime {
  readonly store: PanelThemeStore
  readonly userThemes: UserPanelThemeStore
  private readonly options: PanelThemeRuntimeOptions
  private readonly salt: Uint8Array
  private readonly resolvedCache: PanelThemeResolveCache
  private lastKeyByVersion = new Map<string, string>()
  private sources: PanelThemeSourcePlugin[] = []
  private pluginSources: PanelThemeSourcePlugin[] = []
  private readonly userResolveCache = new PanelThemeResolveCache({ maxEntries: USER_PANEL_THEME_MAX_COUNT })
  private readonly validationCache = new ContentHashCache<PanelThemeValidation>(validateUserPanelTheme)
  private tokens = new Map<string, TokenAsset>()
  private state: PanelThemeState = emptyPanelThemeState()
  private stateHash = ''
  private petStatus: PetThemeState = { light: null, dark: null }
  private petStatusHash = JSON.stringify({ light: null, dark: null })
  private installed = new Set<string>([USER_PANEL_THEME_OWNER])
  private knownManifests = new Set<string>()
  private appearance: PanelAppearance
  private pluginTheme: PluginThemeSnapshot
  private pluginThemeSentHash: string
  private pluginThemeScheduled = false
  private readonly schedulePluginTheme: (callback: () => void) => void

  constructor(options: PanelThemeRuntimeOptions) {
    this.options = options
    this.salt = options.salt ?? randomBytes(32)
    this.resolvedCache = options.resolveCache ?? new PanelThemeResolveCache()
    this.store = new PanelThemeStore(options.userDataDirectory)
    this.userThemes = new UserPanelThemeStore(options.userDataDirectory, { validate: definition => this.validate(definition) })
    this.appearance = { mode: options.initialMode ?? 'light', forcedColors: false }
    this.pluginTheme = buildPluginThemeSnapshot(null, this.appearance.mode)
    this.pluginThemeSentHash = JSON.stringify(this.pluginTheme)
    this.schedulePluginTheme = options.schedulePluginTheme
      ?? (callback => { setTimeout(callback, PLUGIN_THEME_CHANGE_DELAY_MS) })
  }

  getPluginTheme(): PluginThemeSnapshot {
    return this.pluginTheme
  }

  getPanelAppearance(): PanelAppearance {
    return { ...this.appearance }
  }

  setPanelAppearance(next: PanelAppearance): void {
    if (next.mode === this.appearance.mode && next.forcedColors === this.appearance.forcedColors) return
    this.appearance = { mode: next.mode, forcedColors: next.forcedColors }
    this.refreshPluginTheme()
  }

  getState(): PanelThemeState {
    return this.state
  }

  getPetStatus(): PetThemeState {
    return this.petStatus
  }

  getSources(): readonly PanelThemeSourcePlugin[] {
    return this.sources
  }

  // 先做有界的結構解析（封閉鍵集合、固定深度）：失敗不碰快取，只有解析後的標準定義才雜湊，所以任意深的巢狀 payload 不會進到遞迴序列化。
  validate(definition: unknown): PanelThemeValidation {
    const parsed = parseUserPanelThemeDefinition(definition)
    if (!parsed.ok) return userPanelThemeSchemaFailure(parsed)
    return this.validationCache.lookup(parsed.value).result
  }

  refreshUserThemes(): void {
    this.sources = [...this.pluginSources, this.userSource()]
    this.prune()
    this.publish()
  }

  private userSource(): PanelThemeSourcePlugin {
    const themes: ResolvedPanelTheme[] = []
    const live = new Set<string>()
    for (const record of this.userThemes.list()) {
      const { key, themes: resolved } = this.userResolveCache.get([userPanelThemeContribution(record.id, record.name, record.definition)])
      live.add(key)
      if (resolved?.[0]) themes.push(resolved[0])
    }
    this.userResolveCache.retain(live)
    return { pluginId: USER_PANEL_THEME_OWNER, version: '1', pluginName: { ...USER_PANEL_THEME_SOURCE_NAME }, available: true, themes }
  }

  sync(input: PanelThemeSyncInput): void {
    const sources: PanelThemeSourcePlugin[] = []
    const liveKeys = new Set<string>()
    const keyByVersion = new Map<string, string>()
    this.installed = new Set(input.registry.map(entry => entry.id))
    this.knownManifests = new Set()
    for (const entry of input.registry) {
      const context = input.contexts.get(entry.id)
      const versionKey = `${entry.id}@${entry.currentVersion}`
      let themes: ResolvedPanelTheme[] | null | undefined
      let key: string | undefined
      if (context) {
        this.knownManifests.add(entry.id)
        const declared = context.manifest.contributes.panelThemes
        if (declared?.length) ({ key, themes } = this.resolvedCache.get(declared))
      } else {
        key = this.lastKeyByVersion.get(versionKey)
        themes = key === undefined ? undefined : this.resolvedCache.peek(key)
      }
      if (key !== undefined) {
        liveKeys.add(key)
        keyByVersion.set(versionKey, key)
      }
      if (!themes?.length) continue
      const statusOk = entry.status === 'installed' || entry.status === 'enabled'
      const available = Boolean(context && statusOk && context.enabled && context.pluginsEnabled && input.pluginsEnabled)
      sources.push({
        pluginId: entry.id,
        version: entry.currentVersion,
        pluginName: context ? { ...context.manifest.name } : fallbackName(entry.id),
        available,
        ...(available ? {} : { unavailableReason: input.pluginsEnabled ? 'plugin_disabled' as const : 'plugins_off' as const }),
        themes,
      })
    }
    this.resolvedCache.retain(liveKeys)
    this.lastKeyByVersion = keyByVersion
    this.pluginSources = sources
    this.installed.add(USER_PANEL_THEME_OWNER)
    this.refreshUserThemes()
  }

  publish(): void {
    const tokens = new Map<string, TokenAsset>()
    const imagesRoot = this.options.userDataDirectory
    const record = (token: string, asset: TokenAsset) => {
      tokens.set(token, asset)
      return `agent-pets://panel-theme/${token}`
    }
    const state = buildPanelThemeState(this.sources, this.store.get(), {
      packagedUrl: (kind, pluginId, version, relativePath) => {
        const token = hmacHex(this.salt, `${kind}\u0000${pluginId}\u0000${version}\u0000${relativePath}`).slice(0, 32)
        return record(token, {
          kind,
          root: this.options.pluginRoot(pluginId, version),
          relativePath,
          maxBytes: kind === 'font' ? PANEL_THEME_FONT_MAX_BYTES : PANEL_THEME_IMAGE_MAX_BYTES,
        })
      },
      fontAlias: (pluginId, version, themeId, fontId) => (
        `apt-${hmacHex(this.salt, `${pluginId}\u0000${version}\u0000${themeId}\u0000${fontId}`).slice(0, 16)}`
      ),
      userImageUrl: (pluginId, file) => {
        const directory = panelThemePluginImageDirectory(imagesRoot, pluginId)
        if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(file)) return null
        const token = hmacHex(this.salt, `user\u0000${file.slice(0, 64)}`).slice(0, 32)
        return record(token, { kind: 'user', root: directory, relativePath: file, maxBytes: PANEL_THEME_USER_IMAGE_MAX_BYTES })
      },
    })
    this.tokens = tokens
    this.state = state
    this.publishPetStatus(state)
    this.refreshPluginTheme()
    const hash = JSON.stringify(state)
    if (hash === this.stateHash) return
    this.stateHash = hash
    this.options.send(state)
  }

  private publishPetStatus(state: PanelThemeState): void {
    const forMode = (mode: PanelThemeMode): PetThemeModeState | null => {
      const slot = state.slots[mode]
      if (slot.status !== 'active' || !slot.ref) return null
      const entry = state.themes.find(theme => theme.ref.pluginId === slot.ref!.pluginId && theme.ref.themeId === slot.ref!.themeId)
      const modeState = entry?.modes[mode]
      if (!modeState) return null
      const colors = Object.fromEntries(PET_THEME_COLOR_PROPERTIES.map(name => [name, modeState.properties[name]])) as PetThemeModeState['colors']
      return { colors, status: modeState.petStatus ? { ...modeState.petStatus } : null }
    }
    const next: PetThemeState = { light: forMode('light'), dark: forMode('dark') }
    const hash = JSON.stringify(next)
    this.petStatus = next
    if (hash === this.petStatusHash) return
    this.petStatusHash = hash
    this.options.sendPetStatus(next)
  }

  private refreshPluginTheme(): void {
    const { mode, forcedColors } = this.appearance
    const slot = this.state.slots[mode]
    const theme = slot.status === 'active' && slot.ref && !forcedColors
      ? this.sources.find(source => source.pluginId === slot.ref!.pluginId)?.themes.find(candidate => candidate.id === slot.ref!.themeId) ?? null
      : null
    this.pluginTheme = buildPluginThemeSnapshot(theme, mode)
    if (this.pluginThemeScheduled) return
    this.pluginThemeScheduled = true
    this.schedulePluginTheme(() => {
      this.pluginThemeScheduled = false
      // 去重放在送出時：A→B→A 在合併期間內來回切換不會送出重複快照。
      const hash = JSON.stringify(this.pluginTheme)
      if (hash === this.pluginThemeSentHash) return
      this.pluginThemeSentHash = hash
      try { this.options.sendPluginTheme(this.pluginTheme) } catch {}
    })
  }

  removePlugin(pluginId: string): void {
    try { this.store.removePlugin(pluginId) } catch {}
    removePluginImages(this.options.userDataDirectory, pluginId)
  }

  sweep(): number {
    return sweepOrphanUserImages(this.options.userDataDirectory, this.store.referencedFiles())
  }

  private prune(): void {
    let removed: string[] = []
    try {
      removed = this.store.prune({
        isInstalled: pluginId => this.installed.has(pluginId),
        modeExists: (pluginId, themeId, mode) => this.modeKnown(pluginId, themeId, mode, false),
        allowsUserImage: (pluginId, themeId, mode) => this.modeKnown(pluginId, themeId, mode, true),
      })
    } catch {
      return
    }
    for (const entry of removed) {
      const separator = entry.indexOf('/')
      deleteUserImage(this.options.userDataDirectory, entry.slice(0, separator), entry.slice(separator + 1))
    }
  }

  // 未知的 manifest（例如因當機而被停用的插件）絕不修剪；「我的主題」以磁碟上的記錄為準，只有明確刪除才會清掉。
  private modeKnown(pluginId: string, themeId: string, mode: PanelThemeMode, needsUserImage: boolean): boolean {
    if (pluginId === USER_PANEL_THEME_OWNER) return this.userThemes.retains(themeId, mode, needsUserImage)
    if (!this.knownManifests.has(pluginId)) return true
    const theme = this.sources.find(source => source.pluginId === pluginId)?.themes.find(candidate => candidate.id === themeId)
    const resolved = theme?.modes[mode]
    return Boolean(resolved && (!needsUserImage || resolved.userImage))
  }

  // 只接受 token 與 GET，並對送出的位元組重新檢查檔頭。
  async handleRequest(rawUrl: string, method: string): Promise<Response> {
    if (method !== 'GET') return new Response('Method not allowed', { status: 405 })
    let url: URL
    try { url = new URL(rawUrl) } catch { return notFound() }
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'panel-theme' || url.search || url.hash
      || url.username || url.password || url.port) return notFound()
    const match = TOKEN_PATH.exec(url.pathname)
    const asset = match ? this.tokens.get(match[1]!) : undefined
    if (!asset) return notFound()
    const data = await this.options.readRegularFileWithin(asset.root, asset.relativePath, asset.maxBytes)
    if (!data) return notFound()
    let contentType: string
    if (asset.kind === 'font') {
      if (!isWoff2(data) || data.byteLength > PANEL_THEME_FONT_MAX_BYTES) return notFound()
      contentType = 'font/woff2'
    } else {
      const check = asset.kind === 'user' ? checkPanelThemeUserImage(data) : checkPanelThemePackagedImage(data)
      if (!check.ok) return notFound()
      contentType = check.type
    }
    const headers: Record<string, string> = {
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
    }
    // 字型一定是 CORS 請求；使用者圖片要讓主題編輯器在 canvas 上取色（crossOrigin 載入）。
    // 只回給受信任的面板來源，插件分區根本沒有這個 host。
    const origin = asset.kind === 'image' ? null : this.options.rendererOrigin()
    if (origin) {
      headers['access-control-allow-origin'] = origin
      headers.vary = 'Origin'
    }
    return new Response(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), { status: 200, headers })
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function fallbackName(pluginId: string): PluginLocalizedText {
  return { 'zh-TW': pluginId, 'en-US': pluginId }
}
