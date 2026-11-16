import type { AgentAdapterId, InstallErrorCode, InstallOutcome, InstallReport } from '../src/types/agent-adapter.ts'
import type { ConfigRefusalCode, ConfigWriteResult } from './safe-config-write.ts'
import { ConfigRefusedError } from './safe-config-write.ts'
import { NodeNotFoundError, NodeUnsupportedError } from './node-resolver.ts'
import { AgentConfigDirError } from './agent-config-dirs.ts'

// Record 而不是巢狀三元：新增 ConfigRefusalCode 時型別檢查會強迫這裡補上對應。
const CONFIG_REFUSAL_TO_INSTALL_ERROR: Record<ConfigRefusalCode, InstallErrorCode> = {
  unparseable: 'config_unparseable',
  not_object: 'config_unparseable',
  unsafe: 'config_unsafe',
  too_large: 'config_too_large',
  changed_during_write: 'config_changed',
}

export function reportFromWrites(results: ReadonlyArray<ConfigWriteResult>): InstallReport {
  const written = results.filter(result => result.status === 'written')
  return {
    changedFiles: written.map(result => result.path),
    backupPaths: written.flatMap(result => (result.backupPath ? [result.backupPath] : [])),
  }
}

export function classifyInstallError(error: unknown): { code: InstallErrorCode, path?: string } {
  if (error instanceof ConfigRefusedError) {
    return { code: CONFIG_REFUSAL_TO_INSTALL_ERROR[error.code], path: error.filePath }
  }
  if (error instanceof NodeNotFoundError) return { code: 'node_missing' }
  if (error instanceof NodeUnsupportedError) return { code: 'node_unsupported' }
  // 只回報變數名稱，不回報它的值。
  if (error instanceof AgentConfigDirError) return { code: 'config_dir_unusable', path: error.variable }
  const errno = (error as NodeJS.ErrnoException | null)?.code
  const target = (error as NodeJS.ErrnoException | null)?.path
  const path = typeof target === 'string' ? target : undefined
  if (errno === 'EACCES' || errno === 'EPERM') return { code: 'permission_denied', path }
  if (errno === 'EBUSY') return { code: 'file_busy', path }
  if (errno === 'EROFS') return { code: 'read_only', path }
  return { code: 'unknown', path }
}

/**
 * `before` is the health before the install: a degraded integration that gets files rewritten is
 * a repair; nothing rewritten is "unchanged".
 */
export function buildOutcome(
  adapterId: AgentAdapterId,
  report: InstallReport,
  before: 'ready' | 'needs_install' | 'degraded' | 'needs_approval' | 'error',
): InstallOutcome {
  const action = report.changedFiles.length === 0
    ? 'unchanged'
    : before === 'degraded' ? 'repaired' : 'installed'
  return { adapterId, action, changedFiles: report.changedFiles, backupPaths: report.backupPaths }
}

export function failedOutcome(adapterId: AgentAdapterId, error: unknown): InstallOutcome {
  const { code, path } = classifyInstallError(error)
  return {
    adapterId,
    action: 'failed',
    changedFiles: [],
    backupPaths: [],
    errorCode: code,
    ...(path ? { errorPath: path } : {}),
  }
}
