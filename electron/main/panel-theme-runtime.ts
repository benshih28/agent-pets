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

// 主程序中插件面板主題的擁有者：store、每個工作階段的
// salt、由 `agent-pets://panel-theme/<token>` 提供的 token -> 資產對應表、
// 解析後主題的快取，以及狀態廣播（spec §7）。

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
  /** 只把新狀態送給面板視窗。 */
  send(state: PanelThemeState): void
  /** 只把寵物狀態膠囊顏色送給寵物視窗。 */
  sendPetStatus(state: PetThemeState): void
  /** 允許跨來源讀取字型的來源（受信任的面板渲染端）。 */
  rendererOrigin(): string | null
  /** 插件主題快照有變動時送給所有 Worker 與開啟中的 panelView（已合併、去重）。 */
  sendPluginTheme(snapshot: PluginThemeSnapshot): void
  /** 面板 renderer 回報前使用的模式（系統外觀）。 */
  initialMode?: PanelThemeMode
  /** 合併短時間內的多次變動；預設延後 PLUGIN_THEME_CHANGE_DELAY_MS 毫秒。 */
  schedulePluginTheme?: (callback: () => void) => void
  salt?: Uint8Array
  /** 測試用：注入解析快取以觀察命中與上限。 */
  resolveCache?: PanelThemeResolveCache
}

export interface PanelAppearance {
  mode: PanelThemeMode
  forcedColors: boolean
}

/** 連續切換（例如快速點淺色／深色、同步多個插件）只會送出最後一份快照。 */
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
  /** `id@version` → 最後一次解析的內容鍵；插件暫時沒有 manifest（載入失敗）時沿用。 */
  private lastKeyByVersion = new Map<string, string>()
  private sources: PanelThemeSourcePlugin[] = []
  /** 最後一次 sync 的插件來源；「我的主題」變動時只重建使用者來源。 */
  private pluginSources: PanelThemeSourcePlugin[] = []
  /** 每個使用者主題各自解析（一個無效不影響其他），以內容雜湊快取。 */
  private readonly userResolveCache = new PanelThemeResolveCache({ maxEntries: USER_PANEL_THEME_MAX_COUNT })
  /** 編輯器的驗證請求：同樣的草稿只驗證一次（spec R21，沿用 R17 的 LRU）。 */
  private readonly validationCache = new ContentHashCache<PanelThemeValidation>(validateUserPanelTheme)
  private tokens = new Map<string, TokenAsset>()
  private state: PanelThemeState = emptyPanelThemeState()
  private stateHash = ''
  private petStatus: PetThemeState = { light: null, dark: null }
  private petStatusHash = JSON.stringify({ light: null, dark: null })
  private installed = new Set<string>([USER_PANEL_THEME_OWNER])
  /** 這次 sync 有 manifest 的插件；「我的主題」不在這裡，它另外依磁碟上的記錄判斷。 */
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

  /** 插件可讀的主題快照（凍結物件，所有插件拿到的內容相同）。 */
  getPluginTheme(): PluginThemeSnapshot {
    return this.pluginTheme
  }

  getPanelAppearance(): PanelAppearance {
    return { ...this.appearance }
  }

  /** 面板 renderer 回報實際生效的淺色／深色與 forced-colors；沒有變動就不重算。 */
  setPanelAppearance(next: PanelAppearance): void {
    if (next.mode === this.appearance.mode && next.forcedColors === this.appearance.forcedColors) return
    this.appearance = { mode: next.mode, forcedColors: next.forcedColors }
    this.refreshPluginTheme()
  }

  getState(): PanelThemeState {
    return this.state
  }

  /** 各模式啟用中主題的膠囊顏色（null = 內建）。 */
  getPetStatus(): PetThemeState {
    return this.petStatus
  }

  getSources(): readonly PanelThemeSourcePlugin[] {
    return this.sources
  }

  /**
   * 驗證一份「我的主題」草稿（不安裝、不儲存）。先做有界的結構解析（封閉的鍵集合，深度固定）：
   * 失敗時直接回傳文法錯誤、不碰快取；只有解析後的標準定義才拿去雜湊與快取，所以任意深的巢狀
   * payload 不會進到遞迴的序列化。
   */
  validate(definition: unknown): PanelThemeValidation {
    const parsed = parseUserPanelThemeDefinition(definition)
    if (!parsed.ok) return userPanelThemeSchemaFailure(parsed)
    return this.validationCache.lookup(parsed.value).result
  }

  /** 「我的主題」新增、修改或刪除之後：重建使用者來源、修剪 store（刪掉的主題的插槽與圖片），再發布。 */
  refreshUserThemes(): void {
    this.sources = [...this.pluginSources, this.userSource()]
    this.prune()
    this.publish()
  }

  /** 使用者主題永遠可用（不受插件開關影響）；無效的記錄不會出現在目錄中。 */
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

  /** 從插件 runtime 重新推導來源、修剪 store，有變動時才發布。 */
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
    // 只保留仍安裝中的插件用到的內容：已移除或被不同內容取代的項目會被丟棄。
    this.resolvedCache.retain(liveKeys)
    this.lastKeyByVersion = keyByVersion
    this.pluginSources = sources
    this.installed.add(USER_PANEL_THEME_OWNER)
    this.refreshUserThemes()
  }

  /** 依目前來源與 store 重建狀態與 token 對應表；狀態有變動時才送出。 */
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

  /** 寵物視窗只收到它用得到的色盤子集與狀態膠囊顏色（spec §16.5）。 */
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

  /** 與設定面板看到的一致：槽位 active 才用插件主題，forced-colors 時面板退回內建，插件也一樣。 */
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
      // 去重放在送出時：A→B→A 在合併期間內來回切換不會送出重複的快照。
      const hash = JSON.stringify(this.pluginTheme)
      if (hash === this.pluginThemeSentHash) return
      this.pluginThemeSentHash = hash
      try { this.options.sendPluginTheme(this.pluginTheme) } catch {}
    })
  }

  /** 插件被移除：清掉插槽、store 項目與其圖片目錄。 */
  removePlugin(pluginId: string): void {
    try { this.store.removePlugin(pluginId) } catch {}
    removePluginImages(this.options.userDataDirectory, pluginId)
  }

  /** 啟動時清掃未被引用的圖片檔（有上限）。 */
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

  /**
   * 未知的 manifest（例如因當機而被停用的插件）會保留，絕不修剪。「我的主題」以磁碟上的記錄為準：
   * 目錄不完整、記錄仍存在（即使驗證規則日後變嚴格而無法套用）都保留；只有明確刪除才會清掉。
   */
  private modeKnown(pluginId: string, themeId: string, mode: PanelThemeMode, needsUserImage: boolean): boolean {
    if (pluginId === USER_PANEL_THEME_OWNER) return this.userThemes.retains(themeId, mode, needsUserImage)
    if (!this.knownManifests.has(pluginId)) return true
    const theme = this.sources.find(source => source.pluginId === pluginId)?.themes.find(candidate => candidate.id === themeId)
    const resolved = theme?.modes[mode]
    return Boolean(resolved && (!needsUserImage || resolved.userImage))
  }

  /** `agent-pets://panel-theme/<token>`：只接受 token、只接受 GET，並對送出的位元組重新檢查檔頭。 */
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
