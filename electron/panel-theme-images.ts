import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { checkPanelThemeUserImage, PANEL_THEME_USER_IMAGE_MAX_BYTES, type PanelThemeImageKind } from './plugin-panel-themes.ts'
import { PANEL_THEME_USER_IMAGE_FILE } from './panel-theme-store.ts'
import { isPanelThemeOwnerId } from '../src/types/panel-theme-user.ts'

// 使用者匯入的面板背景圖片（spec §4.3）。來源檔案只透過一個已檢查的
// descriptor 讀取一次；所有檢查都在這份位元組上執行。
// 儲存的副本位於 `userData/panel-theme-images/<pluginId>/<sha256>.<ext>`
// （目錄 0o700、檔案 0o600），以暫存檔 + rename 寫入。

export const PANEL_THEME_IMAGES_DIRECTORY = 'panel-theme-images'
export const PANEL_THEME_SWEEP_LIMIT = 256

const EXTENSION: Record<PanelThemeImageKind, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type UserImageReadError = 'image_invalid' | 'image_too_large'

export type UserImagePrepared =
  | { ok: true; bytes: Uint8Array; type: PanelThemeImageKind; width: number; height: number; sha256: string; file: string }
  | { ok: false; error: 'image_invalid' | 'image_too_large'; reason?: 'animated' }

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

/**
 * lstat（一般檔案、非 symlink、大小上限），以 O_NOFOLLOW 開啟，fstat
 * （dev/ino/size 相同），再一次讀入記憶體。
 */
export async function readUserImageSource(filePath: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: UserImageReadError }> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { ok: false, error: 'image_invalid' }
  let handle: fs.promises.FileHandle | null = null
  try {
    const linkStat = await fs.promises.lstat(filePath)
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { ok: false, error: 'image_invalid' }
    if (linkStat.size > PANEL_THEME_USER_IMAGE_MAX_BYTES) return { ok: false, error: 'image_too_large' }
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== linkStat.dev || opened.ino !== linkStat.ino || opened.size !== linkStat.size) {
      return { ok: false, error: 'image_invalid' }
    }
    const bytes = new Uint8Array(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== bytes.length) return { ok: false, error: 'image_invalid' }
    return { ok: true, bytes }
  } catch {
    return { ok: false, error: 'image_invalid' }
  } finally {
    try { await handle?.close() } catch {}
  }
}

/** 驗證記憶體中的位元組（只看檔頭、絕不解碼），並為儲存的副本命名。 */
export function prepareUserImage(bytes: Uint8Array): UserImagePrepared {
  const check = checkPanelThemeUserImage(bytes)
  if (!check.ok) {
    return check.error === 'image_animated'
      ? { ok: false, error: 'image_invalid', reason: 'animated' }
      : { ok: false, error: check.error }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { ok: true, bytes, type: check.type, width: check.width, height: check.height, sha256, file: `${sha256}.${EXTENSION[check.type]}` }
}

function assertRealDirectory(directory: string): void {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe panel theme image directory')
}

function ensurePrivateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (!isErrorCode(error, 'EEXIST')) throw error
  }
  assertRealDirectory(directory)
  if (process.platform !== 'win32') {
    try { fs.chmodSync(directory, 0o700) } catch {}
  }
}

export function panelThemeImagesRoot(userDataDirectory: string): string {
  return path.join(userDataDirectory, PANEL_THEME_IMAGES_DIRECTORY)
}

/** 單一插件的圖片目錄；id 無效時為 null。 */
export function panelThemePluginImageDirectory(userDataDirectory: string, pluginId: string): string | null {
  return isPanelThemeOwnerId(pluginId) ? path.join(panelThemeImagesRoot(userDataDirectory), pluginId) : null
}

/** 將驗證過的位元組寫成 `<root>/<pluginId>/<sha256>.<ext>`（暫存檔 + rename）。 */
export function storeUserImage(userDataDirectory: string, pluginId: string, prepared: Extract<UserImagePrepared, { ok: true }>): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(prepared.file)) throw new TypeError('invalid panel theme image target')
  assertRealDirectory(userDataDirectory)
  ensurePrivateDirectory(panelThemeImagesRoot(userDataDirectory))
  ensurePrivateDirectory(directory)
  const target = path.join(directory, prepared.file)
  try {
    const existing = fs.lstatSync(target)
    // 以內容定址：相同的一般檔案已經存在。
    if (existing.isFile() && !existing.isSymbolicLink() && existing.size === prepared.bytes.byteLength) return
    if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError('unsafe panel theme image file')
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) throw error
  }
  const temporary = path.join(directory, `.${prepared.sha256}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, prepared.bytes, { mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}

/** 刪除一個已儲存的圖片檔（絕不跟隨 symlink）。 */
export function deleteUserImage(userDataDirectory: string, pluginId: string, file: string): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(file)) return
  try {
    assertRealDirectory(directory)
    const target = path.join(directory, file)
    const stat = fs.lstatSync(target)
    if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(target, { force: true })
  } catch {}
}

/** 確認 `panel-theme-images/<pluginId>` 是真正的目錄後才移除。 */
export function removePluginImages(userDataDirectory: string, pluginId: string): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory) return
  try {
    assertRealDirectory(panelThemeImagesRoot(userDataDirectory))
    const stat = fs.lstatSync(directory)
    if (stat.isSymbolicLink()) {
      fs.rmSync(directory, { force: true })
      return
    }
    if (stat.isDirectory()) fs.rmSync(directory, { recursive: true, force: true })
  } catch {}
}

/**
 * 啟動清掃：刪除 store 未引用的檔案（以及殘留的暫存檔）。
 * 有上限：最多檢查 PANEL_THEME_SWEEP_LIMIT 個目錄項目。
 */
export function sweepOrphanUserImages(userDataDirectory: string, referenced: ReadonlySet<string>, limit = PANEL_THEME_SWEEP_LIMIT): number {
  const root = panelThemeImagesRoot(userDataDirectory)
  let examined = 0
  let removed = 0
  try {
    assertRealDirectory(root)
  } catch {
    return 0
  }
  let plugins: fs.Dirent[]
  try { plugins = fs.readdirSync(root, { withFileTypes: true }) } catch { return 0 }
  for (const plugin of plugins) {
    if (examined >= limit) break
    examined += 1
    const pluginDirectory = path.join(root, plugin.name)
    if (!plugin.isDirectory() || plugin.isSymbolicLink() || !isPanelThemeOwnerId(plugin.name)) {
      try { fs.rmSync(pluginDirectory, { force: true, recursive: plugin.isDirectory() && !plugin.isSymbolicLink() }) } catch {}
      removed += 1
      continue
    }
    let files: fs.Dirent[]
    try { files = fs.readdirSync(pluginDirectory, { withFileTypes: true }) } catch { continue }
    for (const file of files) {
      if (examined >= limit) break
      examined += 1
      if (file.isFile() && PANEL_THEME_USER_IMAGE_FILE.test(file.name) && referenced.has(`${plugin.name}/${file.name}`)) continue
      try {
        fs.rmSync(path.join(pluginDirectory, file.name), { force: true, recursive: file.isDirectory() && !file.isSymbolicLink() })
        removed += 1
      } catch {}
    }
    try {
      if (fs.readdirSync(pluginDirectory).length === 0) fs.rmdirSync(pluginDirectory)
    } catch {}
  }
  return removed
}
