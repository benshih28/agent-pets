import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { zipSync } from 'fflate'
import { guardArchive } from './archive-guard.ts'
import { parsePluginManifest } from './plugin-manifest.ts'
import { verifyPluginSignature } from './plugin-signature.ts'
import type { PluginManifest, PluginRuntimeState } from '../src/types/plugin.ts'
import type { PluginRegistryError } from '../src/types/ipc.ts'

export const PLUGIN_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024
export const PLUGIN_ARCHIVE_SKIN_MAX_BYTES = 25 * 1024 * 1024
export const PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const PLUGIN_ARCHIVE_MAX_FILES = 64
export const PLUGIN_REGISTRY_FILENAME = 'registry.json'

export type PluginInstallKind = 'new' | 'update' | 'downgrade' | 'reinstall' | 'incompatible'

export interface PluginRegistryEntry {
  id: string
  currentVersion: string
  status: PluginRuntimeState
  installedAt: number
  grantedPermissions: unknown
  signatureStatus?: 'unsigned' | 'valid' | 'unverified'
  signatureFingerprint?: string
  trustedKeyFingerprint?: string
}

export interface PluginInstallPlan {
  token: string
  kind: PluginInstallKind
  pluginId?: string
  name?: PluginManifest['name']
  version?: string
  author?: string
  previousVersion?: string
  permissions?: PluginManifest['permissions']
  contributes?: PluginManifest['contributes']
  addedPermissions: string[]
  requiresReconsent: boolean
  signatureStatus?: 'unsigned' | 'valid'
  signatureFingerprint?: string
  previousTrustedFingerprint?: string
  signatureChange?: 'first-trust' | 'unsigned-to-signed' | 'key-changed' | 'signed-to-unsigned' | 'unchanged' | 'developer-unverified'
  requiresSignatureConfirmation?: boolean
  developerMode?: boolean
}

export type { PluginRegistryError } from '../src/types/ipc.ts'

export type PluginRegistryResult<T> = { ok: true; value: T } | { ok: false; error: PluginRegistryError }

interface PreparedPlan {
  publicPlan: PluginInstallPlan
  files: Map<string, Uint8Array>
  manifest: PluginManifest | null
  createdAt: number
}

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const ALLOWED_EXTENSIONS = ['.js', '.json', '.png', '.webp', '.html', '.css'] as const
const PLAN_TTL_MS = 10 * 60 * 1_000
const REGISTRY_MAX_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value)
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function permissionUnits(manifest: PluginManifest): string[] {
  const result = new Set<string>()
  for (const [key, value] of Object.entries(manifest.permissions)) {
    if (key === 'network' && value && typeof value === 'object' && !Array.isArray(value) && 'hosts' in value) {
      const network = value as { hosts: string[]; userGranted?: boolean }
      for (const host of network.hosts) result.add(`network:${host}`)
      if (network.userGranted) result.add('network:userGranted')
    } else if (key === 'links' && value && typeof value === 'object' && !Array.isArray(value) && 'hosts' in value) {
      for (const host of (value as { hosts: string[] }).hosts) result.add(`links:${host}`)
    } else if (key === 'secrets' && Array.isArray(value)) {
      for (const secret of value) result.add(`secrets:${secret}`)
    } else if (key === 'schedule' && value) {
      result.add('schedule')
    } else if (value === true) {
      result.add(key)
    }
  }
  if (manifest.contributes.feed) result.add('contributes:feed')
  if (manifest.contributes.reaction) result.add('contributes:reaction')
  if (manifest.contributes.panelView) result.add('contributes:panelView')
  if (manifest.contributes.commands?.length) result.add('contributes:commands')
  if (manifest.contributes.tray?.commands.length) result.add('contributes:tray')
  if (manifest.contributes.badge) result.add('contributes:badge')
  if (manifest.contributes.skins?.length) result.add(`contributes:skins:${manifest.contributes.skins.length}`)
  if (manifest.contributes.eventSource) result.add('contributes:eventSource')
  return [...result].sort()
}

function hasRasterSignature(data: Uint8Array): boolean {
  const png = data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  const webp = data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
  return png || webp
}

function regularDirectory(directory: string): boolean {
  try {
    const stat = fs.lstatSync(directory)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch (error) {
    if (isFsError(error, 'ENOENT')) return false
    throw error
  }
}

function isFsError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function ensureDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  } catch (error) {
    if (!isFsError(error, 'EEXIST')) throw error
  }
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe plugin directory')
}

function assertSafeExistingDirectory(directory: string): void {
  if (!regularDirectory(directory)) throw new TypeError('unsafe plugin directory')
  const real = fs.realpathSync(directory)
  if (path.resolve(real) !== path.resolve(directory)) throw new TypeError('plugin directory path is redirected')
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath)
  ensureDirectory(directory)
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, filePath)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}

function readRegistry(filePath: string): Record<string, PluginRegistryEntry> {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(filePath)
  } catch (error) {
    if (isFsError(error, 'ENOENT')) return {}
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > REGISTRY_MAX_BYTES) throw new TypeError('unsafe plugin registry')
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  } catch {
    throw new TypeError('invalid plugin registry')
  }
  if (!isRecord(value) || !isRecord(value.plugins)) throw new TypeError('invalid plugin registry')
  const entries: Record<string, PluginRegistryEntry> = {}
  for (const [id, raw] of Object.entries(value.plugins)) {
    if (!PLUGIN_ID.test(id) || !isRecord(raw) || raw.id !== id || !isVersion(raw.currentVersion)
      || !Number.isSafeInteger(raw.installedAt)
      || (raw.status !== 'installed' && raw.status !== 'enabled' && raw.status !== 'disabled_crashed' && raw.status !== 'incompatible')) {
      continue
    }
    const signatureStatus = raw.signatureStatus === 'valid' || raw.signatureStatus === 'unverified'
      ? raw.signatureStatus
      : 'unsigned'
    const signatureFingerprint = typeof raw.signatureFingerprint === 'string' && /^[a-f0-9]{16}$/.test(raw.signatureFingerprint)
      ? raw.signatureFingerprint
      : undefined
    const trustedKeyFingerprint = typeof raw.trustedKeyFingerprint === 'string' && /^[a-f0-9]{16}$/.test(raw.trustedKeyFingerprint)
      ? raw.trustedKeyFingerprint
      : undefined
    entries[id] = {
      id,
      currentVersion: raw.currentVersion,
      status: raw.status,
      installedAt: raw.installedAt as number,
      grantedPermissions: raw.grantedPermissions ?? {},
      signatureStatus,
      ...(signatureFingerprint ? { signatureFingerprint } : {}),
      ...(trustedKeyFingerprint ? { trustedKeyFingerprint } : {}),
    }
  }
  return entries
}

function manifestFromUnsupportedApi(value: unknown): { id?: string; name?: PluginManifest['name']; version?: string; author?: string } {
  if (!isRecord(value)) return {}
  const id = typeof value.id === 'string' && PLUGIN_ID.test(value.id) ? value.id : undefined
  const version = isVersion(value.version) ? value.version : undefined
  const author = typeof value.author === 'string' && value.author.length <= 64 ? value.author : undefined
  const name = isRecord(value.name)
    && typeof value.name['zh-TW'] === 'string' && value.name['zh-TW'].length <= 48
    && typeof value.name['en-US'] === 'string' && value.name['en-US'].length <= 48
    ? { 'zh-TW': value.name['zh-TW'], 'en-US': value.name['en-US'] }
    : undefined
  return { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(version ? { version } : {}), ...(author ? { author } : {}) }
}

export class PluginRegistry {
  private readonly pluginsDirectory: string
  private readonly registryPath: string
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly plans = new Map<string, PreparedPlan>()

  constructor(userDataDirectory: string, options: { now?: () => number; createToken?: () => string } = {}) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('Plugin registry requires an absolute userData directory')
    let canonicalUserData: string
    try {
      const stat = fs.lstatSync(path.resolve(userDataDirectory))
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe userData directory')
      canonicalUserData = fs.realpathSync(userDataDirectory)
    } catch {
      throw new TypeError('Plugin registry requires a safe userData directory')
    }
    this.pluginsDirectory = path.join(canonicalUserData, 'plugins')
    this.registryPath = path.join(this.pluginsDirectory, PLUGIN_REGISTRY_FILENAME)
    this.now = options.now ?? Date.now
    this.createToken = options.createToken ?? randomUUID
  }

  list(): PluginRegistryEntry[] {
    try {
      return Object.values(readRegistry(this.registryPath)).map(entry => ({ ...entry }))
    } catch {
      return []
    }
  }

  setStatus(pluginId: string, status: PluginRuntimeState): boolean {
    if (!PLUGIN_ID.test(pluginId)
      || (status !== 'installed' && status !== 'enabled' && status !== 'disabled_crashed' && status !== 'incompatible')) return false
    try {
      const entries = readRegistry(this.registryPath)
      const current = entries[pluginId]
      if (!current) return false
      atomicWriteJson(this.registryPath, { plugins: { ...entries, [pluginId]: { ...current, status } } })
      return true
    } catch {
      return false
    }
  }

  planInstall(archive: Uint8Array): PluginRegistryResult<PluginInstallPlan> {
    return this.planInstallArchive(archive, false)
  }

  private planInstallArchive(archive: Uint8Array, developerMode: boolean): PluginRegistryResult<PluginInstallPlan> {
    if (!(archive instanceof Uint8Array) || archive.byteLength > PLUGIN_ARCHIVE_SKIN_MAX_BYTES) {
      return { ok: false, error: 'archive_too_large' }
    }
    const guarded = guardArchive(archive, {
      maxTotalBytes: PLUGIN_ARCHIVE_SKIN_MAX_BYTES,
      maxFileBytes: PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES,
      maxFiles: PLUGIN_ARCHIVE_MAX_FILES,
      allowedExtensions: ALLOWED_EXTENSIONS,
      mode: 'strict',
    })
    if (!guarded.ok) return { ok: false, error: 'invalid_archive' }
    const signature = developerMode ? { status: 'unsigned' as const } : verifyPluginSignature(guarded.files)
    if (signature.status === 'invalid') return { ok: false, error: 'signature_invalid' }
    const manifestBytes = guarded.files.get('plugin.json')
    if (!manifestBytes || manifestBytes.byteLength > 256 * 1024) return { ok: false, error: 'invalid_manifest' }
    let rawManifest: unknown
    try {
      rawManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as unknown
    } catch {
      return { ok: false, error: 'invalid_manifest' }
    }
    const parsed = parsePluginManifest(rawManifest)
    if (!parsed.ok) {
      if (parsed.error === 'unsupported_api_version') {
        const unsupported = manifestFromUnsupportedApi(rawManifest)
        return this.keepPlan({
          kind: 'incompatible',
          ...(unsupported.id ? { pluginId: unsupported.id } : {}),
          ...(unsupported.name ? { name: unsupported.name } : {}),
          ...(unsupported.version ? { version: unsupported.version } : {}),
          ...(unsupported.author ? { author: unsupported.author } : {}),
          addedPermissions: [],
          requiresReconsent: false,
          signatureStatus: signature.status,
          ...(signature.status === 'valid' ? { signatureFingerprint: signature.fingerprint } : {}),
          signatureChange: developerMode ? 'developer-unverified' : 'unchanged',
          requiresSignatureConfirmation: false,
          developerMode,
        }, guarded.files, null)
      }
      return { ok: false, error: 'invalid_manifest' }
    }
    const manifest = parsed.manifest
    const skinPaths = new Set((manifest.contributes.skins ?? []).map(skin => skin.spritesheet))
    const totalBytes = [...guarded.files.values()].reduce((total, bytes) => total + bytes.byteLength, 0)
    const archiveLimit = skinPaths.size > 0 ? PLUGIN_ARCHIVE_SKIN_MAX_BYTES : PLUGIN_ARCHIVE_MAX_BYTES
    if (totalBytes > archiveLimit || (archive.byteLength > PLUGIN_ARCHIVE_MAX_BYTES && skinPaths.size === 0)) {
      return { ok: false, error: 'archive_too_large' }
    }
    for (const [name, bytes] of guarded.files) {
      const fileLimit = skinPaths.has(name) ? PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES : PLUGIN_ARCHIVE_MAX_BYTES
      if (bytes.byteLength > fileLimit) return { ok: false, error: 'archive_too_large' }
    }
    if (manifest.entry && !guarded.files.has(manifest.entry)) return { ok: false, error: 'missing_entry' }
    for (const skin of manifest.contributes.skins ?? []) {
      const spritesheet = guarded.files.get(skin.spritesheet)
      if (!spritesheet) return { ok: false, error: 'invalid_manifest' }
      if (spritesheet.byteLength > PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES || !hasRasterSignature(spritesheet)) {
        return { ok: false, error: 'invalid_manifest' }
      }
    }
    if (manifest.icon) {
      const icon = guarded.files.get(manifest.icon)
      if (!icon) return { ok: false, error: 'missing_icon' }
      if (!hasRasterSignature(icon)) return { ok: false, error: 'invalid_icon' }
    }
    if (manifest.contributes.panelView) {
      const entry = manifest.contributes.panelView.entry
      if (!guarded.files.has(entry)) return { ok: false, error: 'missing_panel_entry' }
    }
    const panelDirectory = manifest.contributes.panelView
      ? path.posix.dirname(manifest.contributes.panelView.entry)
      : null
    for (const name of guarded.files.keys()) {
      if (path.posix.extname(name).toLowerCase() === '.html' && path.posix.dirname(name) !== panelDirectory) {
        return { ok: false, error: 'invalid_html_location' }
      }
    }

    let existing: PluginRegistryEntry | undefined
    try {
      existing = readRegistry(this.registryPath)[manifest.id]
    } catch {
      return { ok: false, error: 'registry_unavailable' }
    }
    const comparison = existing ? compareVersions(manifest.version, existing.currentVersion) : 1
    const kind: PluginInstallKind = !existing
      ? 'new'
      : comparison > 0 ? 'update'
        : comparison < 0 ? 'downgrade' : 'reinstall'
    const requestedPermissions = permissionUnits(manifest)
    const grantedPermissions = isRecord(existing?.grantedPermissions) && Array.isArray(existing.grantedPermissions.units)
      ? existing.grantedPermissions.units.filter((value): value is string => typeof value === 'string')
      : []
    const addedPermissions = requestedPermissions.filter(value => !grantedPermissions.includes(value))
    const trustedFingerprint = existing?.trustedKeyFingerprint
      ?? (existing?.signatureStatus === 'valid' ? existing.signatureFingerprint : undefined)
    const signatureChange = developerMode
      ? 'developer-unverified'
      : signature.status === 'valid'
        ? !existing ? 'first-trust'
          : !trustedFingerprint ? existing.signatureStatus === 'valid' ? 'key-changed' : 'unsigned-to-signed'
            : trustedFingerprint === signature.fingerprint ? 'unchanged' : 'key-changed'
        : existing?.signatureStatus === 'valid' || trustedFingerprint ? 'signed-to-unsigned' : 'unchanged'
    const requiresSignatureConfirmation = signatureChange === 'key-changed' || signatureChange === 'signed-to-unsigned'
    return this.keepPlan({
      kind,
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      ...(existing ? { previousVersion: existing.currentVersion } : {}),
      permissions: manifest.permissions,
      contributes: manifest.contributes,
      addedPermissions,
      requiresReconsent: Boolean(existing && addedPermissions.length > 0),
      signatureStatus: signature.status,
      ...(signature.status === 'valid' ? { signatureFingerprint: signature.fingerprint } : {}),
      ...(trustedFingerprint ? { previousTrustedFingerprint: trustedFingerprint } : {}),
      signatureChange,
      requiresSignatureConfirmation,
      developerMode,
    }, guarded.files, manifest)
  }

  /** Package a developer-selected folder in memory, then run the exact archive validator. */
  async planInstallDirectory(directory: string): Promise<PluginRegistryResult<PluginInstallPlan>> {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) return { ok: false, error: 'invalid_archive' }
    const root = path.resolve(directory)
    let rootReal: string
    try {
      const stat = await fs.promises.lstat(root)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, error: 'filesystem_unsafe' }
      rootReal = await fs.promises.realpath(root)
    } catch {
      return { ok: false, error: 'invalid_archive' }
    }

    const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
    let totalBytes = 0
    let fileCount = 0
    const collect = async (current: string, relativeDirectory: string): Promise<boolean> => {
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(current, { withFileTypes: true }) } catch { return false }
      for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
        const absolutePath = path.join(current, entry.name)
        let stat: fs.Stats
        try { stat = await fs.promises.lstat(absolutePath) } catch { return false }
        if (stat.isSymbolicLink()) return false
        if (stat.isDirectory()) {
          if (!await collect(absolutePath, relativePath)) return false
          continue
        }
        if (!stat.isFile()) return false
        fileCount += 1
        if (fileCount > PLUGIN_ARCHIVE_MAX_FILES || stat.size > PLUGIN_ARCHIVE_SKIN_IMAGE_MAX_BYTES) return false
        totalBytes += stat.size
        if (!Number.isSafeInteger(totalBytes) || totalBytes > PLUGIN_ARCHIVE_SKIN_MAX_BYTES) return false
        let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null
        try {
          const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
          handle = await fs.promises.open(absolutePath, fs.constants.O_RDONLY | noFollow)
          const opened = await handle.stat()
          const realPath = await fs.promises.realpath(absolutePath)
          const relativeRealPath = path.relative(rootReal, realPath)
          if (!opened.isFile() || opened.isSymbolicLink() || opened.size !== stat.size
            || opened.dev !== stat.dev || opened.ino !== stat.ino
            || relativeRealPath === '..' || relativeRealPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealPath)) return false
          files[relativePath] = await handle.readFile()
        } catch {
          return false
        } finally {
          try { await handle?.close() } catch {}
        }
      }
      return true
    }

    if (!await collect(rootReal, '') || fileCount === 0) return { ok: false, error: 'invalid_archive' }
    try {
      const archive = zipSync(files, { level: 0 })
      return this.planInstallArchive(archive, true)
    } catch {
      return { ok: false, error: 'invalid_archive' }
    }
  }

  install(planToken: string, acceptAdditionalPermissions = false, acceptSignatureChange = false): PluginRegistryResult<PluginRegistryEntry> {
    const prepared = this.getPlan(planToken)
    if (!prepared) return { ok: false, error: 'plan_not_found' }
    if (prepared.publicPlan.kind === 'incompatible' || !prepared.manifest || !prepared.publicPlan.pluginId) {
      return { ok: false, error: 'incompatible' }
    }
    if (prepared.publicPlan.requiresReconsent && !acceptAdditionalPermissions) {
      return { ok: false, error: 'permission_reconsent_required' }
    }
    if (prepared.publicPlan.requiresSignatureConfirmation && !acceptSignatureChange) {
      return { ok: false, error: 'signature_confirmation_required' }
    }
    const manifest = prepared.manifest
    const pluginId = manifest.id
    const now = this.safeNow()
    if (now === null) return { ok: false, error: 'install_failed' }
    const pluginDirectory = path.join(this.pluginsDirectory, pluginId)
    const versionDirectory = path.join(pluginDirectory, manifest.version)
    const stagingDirectory = path.join(pluginDirectory, `.staging-${this.createToken()}`)
    const backupDirectory = path.join(pluginDirectory, `.backup-${this.createToken()}`)
    let backedUpExisting = false
    let stagedInstalled = false
    let previousEntries: Record<string, PluginRegistryEntry>
    let entries: Record<string, PluginRegistryEntry>
    try {
      ensureDirectory(this.pluginsDirectory)
      assertSafeExistingDirectory(this.pluginsDirectory)
      ensureDirectory(pluginDirectory)
      assertSafeExistingDirectory(pluginDirectory)
      previousEntries = readRegistry(this.registryPath)
      entries = { ...previousEntries }
      const existingTarget = fs.existsSync(versionDirectory)
      if (existingTarget) {
        const stat = fs.lstatSync(versionDirectory)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe plugin version directory')
      }
      ensureDirectory(stagingDirectory)
      for (const [relativePath, bytes] of prepared.files) {
        const output = path.resolve(stagingDirectory, relativePath)
        const relative = path.relative(stagingDirectory, output)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new TypeError('unsafe plugin file path')
        ensureDirectory(path.dirname(output))
        fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 })
      }
      if (existingTarget) {
        renameSyncWithRetry(versionDirectory, backupDirectory)
        backedUpExisting = true
      }
      renameSyncWithRetry(stagingDirectory, versionDirectory)
      stagedInstalled = true
      const previousEntry = entries[pluginId]
      const signatureFingerprint = prepared.publicPlan.developerMode
        ? undefined
        : prepared.publicPlan.signatureStatus === 'valid' ? prepared.publicPlan.signatureFingerprint : undefined
      const trustedKeyFingerprint = signatureFingerprint ?? previousEntry?.trustedKeyFingerprint
        ?? (previousEntry?.signatureStatus === 'valid' ? previousEntry.signatureFingerprint : undefined)
      const entry: PluginRegistryEntry = {
        id: pluginId,
        currentVersion: manifest.version,
        status: 'installed',
        installedAt: now,
        grantedPermissions: { units: permissionUnits(manifest) },
        signatureStatus: prepared.publicPlan.developerMode ? 'unverified' : prepared.publicPlan.signatureStatus ?? 'unsigned',
        ...(signatureFingerprint ? { signatureFingerprint } : {}),
        ...(trustedKeyFingerprint ? { trustedKeyFingerprint } : {}),
      }
      entries[pluginId] = entry
      atomicWriteJson(this.registryPath, { plugins: entries })
      this.plans.delete(planToken)
      if (backedUpExisting) fs.rmSync(backupDirectory, { recursive: true, force: true })
      for (const name of fs.readdirSync(pluginDirectory)) {
        if (name === 'data' || name === manifest.version || name.startsWith('.')) continue
        const oldVersion = path.join(pluginDirectory, name)
        try {
          const stat = fs.lstatSync(oldVersion)
          if (stat.isDirectory() && !stat.isSymbolicLink() && isVersion(name)) fs.rmSync(oldVersion, { recursive: true, force: true })
        } catch {}
      }
      return { ok: true, value: { ...entry } }
    } catch (error) {
      try { fs.rmSync(stagingDirectory, { recursive: true, force: true }) } catch {}
      if (stagedInstalled) {
        try { fs.rmSync(versionDirectory, { recursive: true, force: true }) } catch {}
      }
      if (backedUpExisting) {
        try { renameSyncWithRetry(backupDirectory, versionDirectory) } catch {}
      }
      if (isFsError(error, 'ELOOP') || (error instanceof TypeError && error.message.includes('unsafe'))) {
        return { ok: false, error: 'filesystem_unsafe' }
      }
      return { ok: false, error: 'install_failed' }
    }
  }

  discardPlan(planToken: string): void {
    if (typeof planToken === 'string') this.plans.delete(planToken)
  }

  remove(pluginId: string, keepData: boolean): PluginRegistryResult<{ removed: true; keptData: boolean }> {
    if (!PLUGIN_ID.test(pluginId) || typeof keepData !== 'boolean') return { ok: false, error: 'plugin_not_found' }
    let entries: Record<string, PluginRegistryEntry>
    try {
      entries = readRegistry(this.registryPath)
    } catch {
      return { ok: false, error: 'registry_unavailable' }
    }
    if (!entries[pluginId]) return { ok: false, error: 'plugin_not_found' }
    const pluginDirectory = path.join(this.pluginsDirectory, pluginId)
    const removalDirectory = path.join(this.pluginsDirectory, `.${pluginId}.removing-${this.createToken()}`)
    let movedPluginDirectory = false
    try {
      assertSafeExistingDirectory(this.pluginsDirectory)
      assertSafeExistingDirectory(pluginDirectory)
      const dataDirectory = path.join(pluginDirectory, 'data')
      if (fs.existsSync(dataDirectory)) {
        const stat = fs.lstatSync(dataDirectory)
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe plugin data directory')
      }
      const hadData = keepData && fs.existsSync(dataDirectory)
      renameSyncWithRetry(pluginDirectory, removalDirectory)
      movedPluginDirectory = true
      if (keepData) {
        ensureDirectory(pluginDirectory)
        if (hadData) renameSyncWithRetry(path.join(removalDirectory, 'data'), dataDirectory)
      }
      const next = { ...entries }
      delete next[pluginId]
      atomicWriteJson(this.registryPath, { plugins: next })
      fs.rmSync(removalDirectory, { recursive: true, force: true })
      if (!keepData) fs.rmSync(pluginDirectory, { recursive: true, force: true })
      return { ok: true, value: { removed: true, keptData: keepData } }
    } catch (error) {
      try {
        if (movedPluginDirectory && fs.existsSync(removalDirectory)) {
          if (keepData && fs.existsSync(path.join(pluginDirectory, 'data'))
            && !fs.existsSync(path.join(removalDirectory, 'data'))) {
            renameSyncWithRetry(path.join(pluginDirectory, 'data'), path.join(removalDirectory, 'data'))
          }
          if (fs.existsSync(pluginDirectory)) fs.rmSync(pluginDirectory, { recursive: true, force: true })
          renameSyncWithRetry(removalDirectory, pluginDirectory)
        }
      } catch {}
      return {
        ok: false,
        error: error instanceof TypeError && error.message.includes('unsafe') ? 'filesystem_unsafe' : 'install_failed',
      }
    }
  }

  private keepPlan(
    publicPlan: Omit<PluginInstallPlan, 'token'>,
    files: Map<string, Uint8Array>,
    manifest: PluginManifest | null,
  ): PluginRegistryResult<PluginInstallPlan> {
    const now = this.safeNow()
    if (now === null) return { ok: false, error: 'install_failed' }
    for (const [token, plan] of this.plans) {
      if (now - plan.createdAt > PLAN_TTL_MS) this.plans.delete(token)
    }
    const token = this.createToken()
    const plan = { ...publicPlan, token }
    this.plans.set(token, { publicPlan: plan, files, manifest, createdAt: now })
    return { ok: true, value: plan }
  }

  private getPlan(token: string): PreparedPlan | null {
    if (typeof token !== 'string' || token.length > 128) return null
    const plan = this.plans.get(token)
    if (!plan) return null
    const now = this.safeNow()
    if (now === null || now - plan.createdAt > PLAN_TTL_MS) {
      this.plans.delete(token)
      return null
    }
    return plan
  }

  private safeNow(): number | null {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}
