import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { USER_PANEL_THEME_MAX_BYTES, isUserPanelThemeId, type PanelThemeValidation, type UserPanelThemeRecord } from '../../src/types/panel-theme-user.ts'
import type { IpcErrorCode } from '../../src/types/ipc.ts'
import { UserPanelThemeStoreError, type UserPanelThemeStore, type UserPanelThemeStoreErrorCode } from '../panel-theme-user-store.ts'
import { parseUserPanelThemeExport, USER_PANEL_THEME_NAME_INPUT_MAX, userPanelThemeExport } from '../panel-theme-user.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

// 「我的主題」與主題編輯器的 IPC（spec R21、R22）。每個頻道都只接受設定面板的 main frame；
// payload 有大小上限（定義序列化後 ≤ 16 KiB、名稱在正規化前 ≤ 192 個 UTF-16 單位）並在主程序
// 嚴格解析，寫入前一律經過與插件主題相同的驗證器。
// 套用沿用 `panel-theme-slot-set`（擁有者 `_user`）；背景圖沿用既有的使用者圖片頻道。

type OpenDialogOptions = {
  title: string
  filters: Array<{ name: string; extensions: string[] }>
  properties: Array<'openFile'>
}
type SaveDialogOptions = {
  title: string
  filters: Array<{ name: string; extensions: string[] }>
  defaultPath: string
}

export interface UserPanelThemeRuntime {
  readonly userThemes: UserPanelThemeStore
  validate(definition: unknown): PanelThemeValidation
  refreshUserThemes(): void
}

export interface UserPanelThemeIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  getRuntime(): UserPanelThemeRuntime | null
  getPanelWindow(): BrowserWindow | null
  isDialogOpen(): boolean
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  translate(key: 'design.themeEditor.importDialogTitle' | 'design.themeEditor.exportDialogTitle' | 'design.themeEditor.fileFilter'): string
  readImportFile(filePath: string): { ok: true; value: unknown } | { ok: false }
  writeExportFile(filePath: string, contents: string): void
}

const STORE_ERRORS: Record<UserPanelThemeStoreErrorCode, IpcErrorCode> = {
  limit_reached: 'theme_limit_reached',
  not_found: 'theme_not_found',
  invalid_definition: 'invalid_panel_theme',
  invalid_name: 'invalid_request',
  too_large: 'invalid_request',
  unsafe_directory: 'preferences_unsafe',
}

/** 序列化後 ≤ 16 KiB 的值；無法序列化（循環、過深）一律視為過大。 */
function withinLimit(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value)
    return typeof encoded === 'string' && Buffer.byteLength(encoded, 'utf8') <= USER_PANEL_THEME_MAX_BYTES
  } catch {
    return false
  }
}

/** 名稱引數：字串且在正規化前就有長度上限（實際的清理與 1–48 字元規則在 store）。 */
function isNameArgument(value: unknown): value is string {
  return typeof value === 'string' && value.length <= USER_PANEL_THEME_NAME_INPUT_MAX
}

/** Windows 保留的裝置名稱（不分大小寫；`CON.json` 這種帶副檔名的也算）。 */
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
const EXPORT_NAME_MAX_CODE_POINTS = 40

/**
 * 名稱只用來組預設檔名：保留各語系的字母、數字與組合記號（中文名稱不會變成 `theme`），其餘
 * （路徑分隔、控制與格式字元、`<>:"/\|?*`、`.`）一律換成連字號；依碼位截斷（不切斷代理對），
 * 去掉頭尾的連字號，Windows 保留名稱改用 `theme`。
 */
export function exportFileName(name: string): string {
  const words = name.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}_-]+/gu, ' ').trim().replace(/\s+/g, '-')
  const stem = [...words].slice(0, EXPORT_NAME_MAX_CODE_POINTS).join('').replace(/^[-_]+|[-_]+$/g, '')
  return `${stem && !WINDOWS_RESERVED_NAME.test(stem) ? stem : 'theme'}.agent-pets-theme.json`
}

function failure(error: unknown) {
  if (error instanceof UserPanelThemeStoreError) {
    return { ok: false as const, error: STORE_ERRORS[error.code], ...(error.validation ? { validation: error.validation } : {}) }
  }
  return { ok: false as const, error: 'write_failed' as const }
}

export function registerUserPanelThemeIpc(deps: UserPanelThemeIpcDependencies): void {
  // 對話框篩選器名稱依目前語系（每次開啟時取，語系切換後立即生效）。
  const jsonFilter = () => [{ name: deps.translate('design.themeEditor.fileFilter'), extensions: ['json'] }]
  const listResult = (runtime: UserPanelThemeRuntime, id?: string) => ({
    ok: true as const,
    value: { themes: runtime.userThemes.list() as UserPanelThemeRecord[], ...(id ? { id } : {}) },
  })

  /** 寫入型操作的共同流程：取得 runtime、執行、重建目錄並廣播，再回傳最新清單。 */
  const mutate = (run: (runtime: UserPanelThemeRuntime) => string | undefined) => {
    const runtime = deps.getRuntime()
    if (!runtime) return { ok: false as const, error: 'plugin_service_unavailable' as const }
    let id: string | undefined
    try {
      id = run(runtime)
    } catch (error) {
      return failure(error)
    }
    runtime.refreshUserThemes()
    return listResult(runtime, id)
  }

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeValidate, deps.assertPluginPanelSender, (_event, definition: unknown, ...rest: unknown[]) => {
    const runtime = deps.getRuntime()
    if (!runtime) return { ok: false, error: 'plugin_service_unavailable' }
    if (rest.length > 0 || !withinLimit(definition)) return { ok: false, error: 'invalid_request' }
    return { ok: true, value: runtime.validate(definition) }
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserList, deps.assertPluginPanelSender, (_event, ...rest: unknown[]) => {
    const runtime = deps.getRuntime()
    if (!runtime) return { ok: false, error: 'plugin_service_unavailable' }
    if (rest.length > 0) return { ok: false, error: 'invalid_request' }
    return listResult(runtime)
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserCreate, deps.assertPluginPanelSender, (_event, name: unknown, definition: unknown, ...rest: unknown[]) => {
    if (rest.length > 0 || !isNameArgument(name) || !withinLimit(definition)) return { ok: false, error: 'invalid_request' }
    return mutate(runtime => runtime.userThemes.create(name, definition).id)
  })

  // 儲存：可選的 `name` 與定義一起寫入（一次原子寫入），編輯器的「儲存」不會只改到一半。
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserUpdate, deps.assertPluginPanelSender, (_event, id: unknown, definition: unknown, ...rest: unknown[]) => {
    const [name, ...extra] = rest
    if (extra.length > 0 || !isUserPanelThemeId(id) || (name !== undefined && !isNameArgument(name)) || !withinLimit(definition)) return { ok: false, error: 'invalid_request' }
    return mutate(runtime => runtime.userThemes.update(id, definition, name).id)
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserRename, deps.assertPluginPanelSender, (_event, id: unknown, name: unknown, ...rest: unknown[]) => {
    if (rest.length > 0 || !isUserPanelThemeId(id) || !isNameArgument(name)) return { ok: false, error: 'invalid_request' }
    return mutate(runtime => runtime.userThemes.rename(id, name).id)
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserDuplicate, deps.assertPluginPanelSender, (_event, id: unknown, name: unknown, ...rest: unknown[]) => {
    if (rest.length > 0 || !isUserPanelThemeId(id) || !isNameArgument(name)) return { ok: false, error: 'invalid_request' }
    return mutate(runtime => runtime.userThemes.duplicate(id, name).id)
  })

  // 刪除：refreshUserThemes 的修剪會清掉指向它的插槽（退回內建）與它的背景圖。
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserDelete, deps.assertPluginPanelSender, (_event, id: unknown, ...rest: unknown[]) => {
    if (rest.length > 0 || !isUserPanelThemeId(id)) return { ok: false, error: 'invalid_request' }
    return mutate(runtime => {
      if (!runtime.userThemes.delete(id)) throw new UserPanelThemeStoreError('not_found')
      return undefined
    })
  })

  const withDialog = async <T>(run: (window: BrowserWindow) => Promise<T>): Promise<T | { ok: false; error: IpcErrorCode }> => {
    const window = deps.getPanelWindow()
    if (!window || window.isDestroyed()) return { ok: false, error: 'plugin_service_unavailable' }
    if (deps.isDialogOpen()) return { ok: false, error: 'dialog_unavailable' }
    deps.setDialogOpen(true)
    try {
      return await run(window)
    } catch {
      return { ok: false, error: 'dialog_unavailable' }
    } finally {
      deps.setDialogOpen(false)
    }
  }

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserExport, deps.assertPluginPanelSender, async (_event, id: unknown, ...rest: unknown[]) => {
    const runtime = deps.getRuntime()
    if (!runtime) return { ok: false, error: 'plugin_service_unavailable' }
    if (rest.length > 0 || !isUserPanelThemeId(id)) return { ok: false, error: 'invalid_request' }
    const record = runtime.userThemes.get(id)
    if (!record) return { ok: false, error: 'theme_not_found' }
    const selection = await withDialog(window => deps.showSaveDialog(window, {
      title: deps.translate('design.themeEditor.exportDialogTitle'),
      defaultPath: exportFileName(record.name),
      filters: jsonFilter(),
    }))
    if ('ok' in selection) return selection
    if (selection.canceled || typeof selection.filePath !== 'string' || selection.filePath.length === 0) return { ok: false, error: 'cancelled', cancelled: true }
    try {
      deps.writeExportFile(selection.filePath, `${JSON.stringify(userPanelThemeExport(record), null, 2)}\n`)
    } catch {
      return { ok: false, error: 'write_failed' }
    }
    return listResult(runtime, id)
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserImport, deps.assertPluginPanelSender, async (_event, ...rest: unknown[]) => {
    if (!deps.getRuntime()) return { ok: false, error: 'plugin_service_unavailable' }
    if (rest.length > 0) return { ok: false, error: 'invalid_request' }
    const selection = await withDialog(window => deps.showOpenDialog(window, {
      title: deps.translate('design.themeEditor.importDialogTitle'),
      filters: jsonFilter(),
      properties: ['openFile'],
    }))
    if ('ok' in selection) return selection
    if (selection.canceled || typeof selection.filePaths[0] !== 'string') return { ok: false, error: 'cancelled', cancelled: true }
    const read = deps.readImportFile(selection.filePaths[0])
    if (!read.ok) return { ok: false, error: 'theme_import_invalid' }
    const parsed = parseUserPanelThemeExport(read.value)
    if (!parsed.ok) return { ok: false, error: 'theme_import_invalid' }
    return mutate(runtime => runtime.userThemes.create(parsed.value.name, parsed.value.definition).id)
  })
}
